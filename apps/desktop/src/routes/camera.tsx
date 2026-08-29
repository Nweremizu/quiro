import { cn } from "@quiro/ui";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	CAMERA_TOOLBAR_HEIGHT,
	CameraPreviewToolbar,
	CameraResizeHandles,
	type CameraWindowState,
	cameraBorderRadius,
	cameraToolbarScale,
	clampCameraSize,
	getDefaultCameraWindowState,
} from "@/components/CameraPreviewChrome";
import { useCameraFrameSocket } from "@/utils/camera-frame-socket";
import { useTauriEventListener } from "@/utils/createEventListner";
import { commands, events } from "@/utils/tauri";

// The floating camera preview bubble, ported from Cap's routes/camera.tsx.
//
// Only Cap's "legacy" (WebSocket) path is ported: Cap's other path renders
// natively via wgpu straight onto the window surface, which Quiro's camera.rs
// also supports — but only on macOS (native_camera_preview_enabled() returns
// false everywhere else), and it drives its own window sizing internally. On
// the WS path nothing was moving the window, which is why the Rust command
// below owns the resize.

type CameraPreviewIssue = { title: string; message: string };

const CAMERA_DISCONNECTED_ISSUE: CameraPreviewIssue = {
	title: "Camera disconnected",
	message: "The selected camera stopped sending video.",
};

declare global {
	interface Window {
		__QUIRO__?: {
			cameraWsPort?: number;
			cameraOnlyMode?: boolean;
			enableNativeCameraPreview?: boolean;
		};
	}
}

export default function Camera() {
	const [wsPort] = useState(() => window.__QUIRO__?.cameraWsPort ?? null);
	const [cameraOnlyMode] = useState(
		() => window.__QUIRO__?.cameraOnlyMode ?? false,
	);

	const [state, setState] = useState<CameraWindowState>(
		getDefaultCameraWindowState,
	);
	const [issue, setIssue] = useState<CameraPreviewIssue | null>(null);
	const [chromeVisible, setChromeVisible] = useState(false);

	// Only Full shape uses this (to widen the window past 16:9 for an
	// ultra-wide camera), and it arrives asynchronously with the first frame —
	// a ref rather than state, so learning it doesn't re-render the preview.
	const frameAspectRef = useRef<number | null>(null);

	const wsUrl = wsPort ? `ws://localhost:${wsPort}` : null;

	// Rust is the source of truth (it persists to its own store and the
	// window-open path reads the same state to size the window), so seed from
	// it rather than from localStorage like Cap does.
	useEffect(() => {
		let cancelled = false;
		commands
			.getCameraPreviewState()
			.then((result) => {
				if (cancelled) return;
				if (result.status !== "ok") {
					console.error("Failed to load camera preview state:", result.error);
					return;
				}
				const loaded = result.data;
				setState({
					size: clampCameraSize(loaded.size),
					shape: loaded.shape,
					mirrored: loaded.mirrored,
					backgroundBlur: loaded.background_blur ?? "off",
				});
			})
			.catch((error) =>
				console.error("Failed to load camera preview state:", error),
			);
		return () => {
			cancelled = true;
		};
	}, []);

	// Mirrors `state` so the callbacks below can read the latest value without
	// listing it as a dependency. Keeping them stable matters for the resize
	// drag: CameraResizeHandles subscribes a window-level mousemove listener
	// keyed on the callback's identity, and a new identity per render would
	// tear that listener down and re-add it on every single pointer move.
	const stateRef = useRef(state);
	stateRef.current = state;

	// One place that pushes to Rust, so every caller (toolbar, resize drag)
	// stays in sync with what's persisted and with the window size. Note this
	// is deliberately NOT called from inside a setState updater — those must
	// stay pure, or StrictMode's double-invoke fires the command twice.
	const applyState = useCallback((patch: Partial<CameraWindowState>) => {
		const next = { ...stateRef.current, ...patch };
		stateRef.current = next;
		setState(next);
		commands
			.setCameraPreviewState(
				{
					size: next.size,
					shape: next.shape,
					mirrored: next.mirrored,
					background_blur: next.backgroundBlur,
				},
				frameAspectRef.current,
			)
			.catch((error) =>
				console.error("Failed to save camera preview state:", error),
			);
	}, []);

	// Learning the camera's real aspect only matters for Full shape, where the
	// window is sized from it — so re-push state in that case to widen a window
	// that was opened at the 16:9 fallback.
	const handleFrameSize = useCallback(
		({ width, height }: { width: number; height: number }) => {
			if (height <= 0) return;
			frameAspectRef.current = width / height;
			if (stateRef.current.shape === "full") applyState({});
		},
		[applyState],
	);

	const { canvasRef, hasFrame } = useCameraFrameSocket(wsUrl, handleFrameSize);

	// Resize fires per mousemove. Rust already debounces its disk write in
	// CameraPreviewManager::set_state, so pushing every move is fine and keeps
	// the window tracking the cursor.
	const handleResize = useCallback(
		(size: number) => applyState({ size }),
		[applyState],
	);

	useEffect(() => {
		let cancelled = false;
		const unlistens = [
			listen<CameraPreviewIssue>("camera-preview-error", ({ payload }) => {
				if (!cancelled) setIssue(payload);
			}),
			listen("camera-preview-clear", () => {
				if (!cancelled) setIssue(null);
			}),
		];
		return () => {
			cancelled = true;
			for (const p of unlistens) p.then((un) => un()).catch(() => {});
		};
	}, []);

	// A camera unplugged mid-session doesn't produce a preview error — the feed
	// just stops — so the recording layer's own input events cover that case.
	useTauriEventListener(events.recordingEvent, (payload) => {
		if (payload.variant === "InputLost" && payload.input === "camera") {
			setIssue(CAMERA_DISCONNECTED_ISSUE);
		} else if (
			payload.variant === "InputRestored" &&
			payload.input === "camera"
		) {
			setIssue(null);
		}
	});

	// Persist where the user drags the bubble to. Rust ignores saves made
	// while its CameraWindowPositionGuard is armed, which is how programmatic
	// moves (resize clamping, centering) avoid being stored as user intent.
	useEffect(() => {
		const window_ = getCurrentWindow();
		let unlisten: (() => void) | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let cancelled = false;

		window_
			.onMoved(async ({ payload }) => {
				if (cancelled) return;
				if (timeout) clearTimeout(timeout);
				timeout = setTimeout(async () => {
					try {
						const scale = await window_.scaleFactor();
						const logical = payload.toLogical(scale);
						await commands.setCameraWindowPosition(logical.x, logical.y);
					} catch (error) {
						console.error("Failed to save camera window position:", error);
					}
				}, 200);
			})
			.then((un) => {
				if (cancelled) un();
				else unlisten = un;
			});

		return () => {
			cancelled = true;
			if (timeout) clearTimeout(timeout);
			unlisten?.();
		};
	}, []);

	const borderRadius = cameraBorderRadius(state);

	return (
		// The window body itself: pointer enter/leave only reveal the chrome,
		// and every action that chrome exposes is a real button.
		<div
			data-tauri-drag-region
			className="relative flex h-screen w-screen cursor-move flex-col"
			onPointerMove={() => setChromeVisible(true)}
			onPointerLeave={() => setChromeVisible(false)}
			onPointerCancel={() => setChromeVisible(false)}
		>
			<div
				className="flex shrink-0 flex-row items-center justify-center"
				style={{ height: `${CAMERA_TOOLBAR_HEIGHT}px` }}
				data-tauri-drag-region
			>
				<CameraPreviewToolbar
					state={state}
					onChange={applyState}
					visible={chromeVisible}
					scale={cameraToolbarScale(state.size)}
					onClose={() => void commands.closeCameraWindow()}
				/>
			</div>

			<CameraResizeHandles
				size={state.size}
				onResize={handleResize}
				toolbarHeight={CAMERA_TOOLBAR_HEIGHT}
				visible={chromeVisible}
			/>

			<div
				data-tauri-drag-region
				style={{ borderRadius: cameraOnlyMode ? undefined : borderRadius }}
				className={cn(
					"relative flex-1 overflow-hidden bg-gray-1 text-gray-12 shadow-lg",
					cameraOnlyMode && "rounded-none",
				)}
			>
				<canvas
					ref={canvasRef}
					data-tauri-drag-region
					style={{ transform: state.mirrored ? "scaleX(-1)" : undefined }}
					// The canvas's intrinsic size is the camera's frame size, which
					// rarely matches the bubble's shape — object-cover crops to fill
					// instead of letterboxing, the same fit Cap computes by hand.
					className="absolute inset-0 h-full w-full object-cover"
				/>

				{!hasFrame && !issue && (
					<div className="absolute inset-0 flex items-center justify-center">
						<p className="text-xs text-gray-11">Loading camera…</p>
					</div>
				)}

				{issue && (
					<div
						style={{ borderRadius: "inherit" }}
						className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-black/75 px-4 backdrop-blur-xs"
					>
						<div className="flex max-w-[16rem] flex-col items-center gap-1.5 text-center text-white">
							<p className="text-sm font-semibold">{issue.title}</p>
							<p className="text-[11px] leading-snug text-white/75">
								{issue.message}
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
