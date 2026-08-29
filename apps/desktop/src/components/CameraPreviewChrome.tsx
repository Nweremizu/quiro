import { cn } from "@quiro/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BackgroundBlurMode, CameraPreviewShape } from "@/utils/tauri";
import IconLucideCircle from "~icons/lucide/circle";
import IconLucideCircleX from "~icons/lucide/circle-x";
import IconLucideFlipHorizontal from "~icons/lucide/flip-horizontal";
import IconLucideMaximize2 from "~icons/lucide/maximize-2";
import IconLucideMinimize2 from "~icons/lucide/minimize-2";
import IconLucidePersonStanding from "~icons/lucide/person-standing";
import IconLucideRectangleHorizontal from "~icons/lucide/rectangle-horizontal";
import IconLucideSquare from "~icons/lucide/square";

// React port of Cap's components/CameraPreviewChrome.tsx — the floating
// toolbar and corner resize handles that sit over the camera bubble.
//
// Every number here mirrors a Rust-side constant so the two agree on window
// geometry: MIN/MAX/DEFAULT size are camera.rs's MIN_CAMERA_SIZE /
// MAX_CAMERA_SIZE / DEFAULT_CAMERA_SIZE, the toolbar height is camera.rs's
// TOOLBAR_HEIGHT, and the wide aspect ratio is WIDE_CAMERA_ASPECT_RATIO.
// Rust owns the actual window resize (see camera_commands.rs); this side
// only needs them to lay the preview out to match.

export type CameraWindowState = {
	size: number;
	shape: CameraPreviewShape;
	mirrored: boolean;
	backgroundBlur: BackgroundBlurMode;
};

export const CAMERA_MIN_SIZE = 150;
export const CAMERA_MAX_SIZE = 600;
export const CAMERA_DEFAULT_SIZE = 230;
export const CAMERA_PRESET_SMALL = 230;
export const CAMERA_PRESET_LARGE = 400;
export const CAMERA_TOOLBAR_HEIGHT = 56;
export const CAMERA_WIDE_ASPECT_RATIO = 16 / 9;

const BLUR_MODES: BackgroundBlurMode[] = ["off", "light", "heavy"];
const RESIZE_CORNERS = ["nw", "ne", "sw", "se"] as const;
type ResizeCorner = (typeof RESIZE_CORNERS)[number];

export const getDefaultCameraWindowState = (): CameraWindowState => ({
	size: CAMERA_DEFAULT_SIZE,
	shape: "round",
	mirrored: false,
	backgroundBlur: "off",
});

export const clampCameraSize = (size: number) =>
	Math.max(CAMERA_MIN_SIZE, Math.min(CAMERA_MAX_SIZE, size));

export const cameraPreviewAspectRatio = (
	shape: CameraPreviewShape,
	frameAspectRatio?: number | null,
) => {
	if (shape !== "full") return 1;
	if (
		typeof frameAspectRatio === "number" &&
		Number.isFinite(frameAspectRatio) &&
		frameAspectRatio > 0
	) {
		return Math.max(frameAspectRatio, CAMERA_WIDE_ASPECT_RATIO);
	}
	return CAMERA_WIDE_ASPECT_RATIO;
};

export const cycleBlurMode = (
	current: BackgroundBlurMode,
): BackgroundBlurMode =>
	BLUR_MODES[(BLUR_MODES.indexOf(current) + 1) % BLUR_MODES.length];

export const blurModeLabel = (mode: BackgroundBlurMode) =>
	mode === "light" ? "Light" : mode === "heavy" ? "Heavy" : "";

export const cycleShape = (shape: CameraPreviewShape): CameraPreviewShape =>
	shape === "round" ? "square" : shape === "square" ? "full" : "round";

// The toolbar is a fixed pixel size, so at a 150px bubble it would visually
// swamp the video and at 600px look lost — scale it with the bubble instead.
export const cameraToolbarScale = (size: number) =>
	0.7 +
	((clampCameraSize(size) - CAMERA_MIN_SIZE) /
		(CAMERA_MAX_SIZE - CAMERA_MIN_SIZE)) *
		0.3;

export function cameraBorderRadius(state: CameraWindowState) {
	if (state.shape === "round") return "9999px";
	const normalized =
		(clampCameraSize(state.size) - CAMERA_MIN_SIZE) /
		(CAMERA_MAX_SIZE - CAMERA_MIN_SIZE);
	return `${3 + normalized * 1.5}rem`;
}

function ControlButton({
	pressed,
	onClick,
	title,
	children,
}: {
	pressed?: boolean;
	onClick: () => void;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			aria-pressed={pressed}
			// Without this the toolbar row counts as window-drag surface and
			// the clicks never reach the buttons.
			data-tauri-drag-region="false"
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			className={cn(
				"rounded-lg p-2 transition-colors",
				pressed ? "bg-gray-3 text-gray-12" : "hover:bg-gray-3/60",
			)}
		>
			{children}
		</button>
	);
}

export function CameraPreviewToolbar({
	state,
	onChange,
	visible,
	scale = 1,
	onClose,
}: {
	state: CameraWindowState;
	onChange: (patch: Partial<CameraWindowState>) => void;
	visible: boolean;
	scale?: number;
	onClose?: () => void;
}) {
	const blurOn = state.backgroundBlur !== "off";

	return (
		<div
			data-tauri-drag-region="false"
			style={{ transform: `scale(${scale})` }}
			className={cn(
				"flex flex-row gap-1 rounded-xl border border-white-transparent-20 bg-gray-1 p-1 text-gray-10 transition-[opacity,transform]",
				visible ? "opacity-100" : "pointer-events-none opacity-0",
			)}
		>
			{onClose && (
				<ControlButton title="Close camera" onClick={onClose}>
					<IconLucideCircleX className="size-5" />
				</ControlButton>
			)}
			<ControlButton
				title={state.size >= CAMERA_PRESET_LARGE ? "Shrink" : "Enlarge"}
				pressed={state.size >= CAMERA_PRESET_LARGE}
				onClick={() =>
					onChange({
						size:
							state.size < CAMERA_PRESET_LARGE
								? CAMERA_PRESET_LARGE
								: CAMERA_PRESET_SMALL,
					})
				}
			>
				{state.size >= CAMERA_PRESET_LARGE ? (
					<IconLucideMinimize2 className="size-5" />
				) : (
					<IconLucideMaximize2 className="size-5" />
				)}
			</ControlButton>
			<ControlButton
				title={`Shape: ${state.shape}`}
				pressed={state.shape !== "round"}
				onClick={() => onChange({ shape: cycleShape(state.shape) })}
			>
				{state.shape === "round" && <IconLucideCircle className="size-5" />}
				{state.shape === "square" && <IconLucideSquare className="size-5" />}
				{state.shape === "full" && (
					<IconLucideRectangleHorizontal className="size-5" />
				)}
			</ControlButton>
			<ControlButton
				title="Mirror"
				pressed={state.mirrored}
				onClick={() => onChange({ mirrored: !state.mirrored })}
			>
				<IconLucideFlipHorizontal className="size-5" />
			</ControlButton>
			<ControlButton
				title={`Background blur: ${state.backgroundBlur}`}
				pressed={blurOn}
				onClick={() =>
					onChange({ backgroundBlur: cycleBlurMode(state.backgroundBlur) })
				}
			>
				<div className="relative">
					<IconLucidePersonStanding className="size-5" />
					{blurOn && (
						<span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[7px] font-bold leading-none">
							{blurModeLabel(state.backgroundBlur)}
						</span>
					)}
				</div>
			</ControlButton>
		</div>
	);
}

export function CameraResizeHandles({
	size,
	onResize,
	onResizeEnd,
	toolbarHeight,
	visible,
}: {
	size: number;
	onResize: (size: number) => void;
	onResizeEnd?: () => void;
	toolbarHeight: number;
	visible: boolean;
}) {
	const [activeCorner, setActiveCorner] = useState<ResizeCorner | null>(null);
	// A ref, not state: the window-level mousemove handler below reads this on
	// every pointer event, and re-subscribing per render just to see a fresh
	// value would drop events mid-drag.
	const dragRef = useRef<{
		startSize: number;
		x: number;
		y: number;
		corner: ResizeCorner;
	} | null>(null);

	const handleMove = useCallback(
		(e: MouseEvent) => {
			const drag = dragRef.current;
			if (!drag) return;

			const deltaX = e.clientX - drag.x;
			const deltaY = e.clientY - drag.y;
			// Dragging away from the window's centre grows it, regardless of
			// which corner is held: "e"/"s" corners grow on positive delta,
			// "w"/"n" on negative.
			const dx = drag.corner.includes("e") ? deltaX : -deltaX;
			const dy = drag.corner.includes("s") ? deltaY : -deltaY;

			onResize(clampCameraSize(drag.startSize + Math.max(dx, dy)));
		},
		[onResize],
	);

	useEffect(() => {
		if (!activeCorner) return;

		const handleUp = () => {
			dragRef.current = null;
			setActiveCorner(null);
			onResizeEnd?.();
		};

		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
		return () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
		};
	}, [activeCorner, handleMove, onResizeEnd]);

	const startResize = (corner: ResizeCorner) => (e: React.MouseEvent) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		dragRef.current = { startSize: size, x: e.clientX, y: e.clientY, corner };
		setActiveCorner(corner);
	};

	return (
		<div
			className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
			style={{ top: `${toolbarHeight}px` }}
		>
			{RESIZE_CORNERS.map((corner) => (
				<ResizeCornerHandle
					key={corner}
					corner={corner}
					onMouseDown={startResize(corner)}
					active={activeCorner === corner}
					visible={visible || activeCorner !== null}
				/>
			))}
		</div>
	);
}

const HIT_AREA_CLASS: Record<ResizeCorner, string> = {
	nw: "top-0 left-0 cursor-nw-resize",
	ne: "top-0 right-0 cursor-ne-resize",
	sw: "bottom-0 left-0 cursor-sw-resize",
	se: "bottom-0 right-0 cursor-se-resize",
};

const BRACKET_CLASS: Record<ResizeCorner, string> = {
	nw: "top-1.5 left-1.5 border-t-2 border-l-2 rounded-tl-[6px]",
	ne: "top-1.5 right-1.5 border-t-2 border-r-2 rounded-tr-[6px]",
	sw: "bottom-1.5 left-1.5 border-b-2 border-l-2 rounded-bl-[6px]",
	se: "bottom-1.5 right-1.5 border-b-2 border-r-2 rounded-br-[6px]",
};

function ResizeCornerHandle({
	corner,
	onMouseDown,
	active,
	visible,
}: {
	corner: ResizeCorner;
	onMouseDown: (e: React.MouseEvent) => void;
	active: boolean;
	visible: boolean;
}) {
	return (
		// A drag-resize affordance has no keyboard equivalent; size is also
		// settable from the toolbar's enlarge button, which is a real button.
		<div
			data-tauri-drag-region="false"
			onMouseDown={onMouseDown}
			className={cn(
				"group/handle pointer-events-auto absolute z-20 size-7 select-none",
				HIT_AREA_CLASS[corner],
			)}
		>
			<div
				style={{ filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6))" }}
				className={cn(
					"pointer-events-none absolute size-3.5 border-white transition-[opacity,transform] duration-150 ease-out",
					visible ? "scale-100 opacity-70" : "scale-90 opacity-0",
					"group-hover/handle:scale-110! group-hover/handle:opacity-100!",
					active && "scale-110! opacity-100!",
					BRACKET_CLASS[corner],
				)}
			/>
		</div>
	);
}
