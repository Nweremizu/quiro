import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DisplayHint from "@/components/DisplayHint";
import SelectionHint from "@/components/SelectionHint";
import {
	type AreaSelectionPreferences,
	type Bounds,
	EXTRA_AREA_RATIOS,
	fillBounds,
	findClosestRatio,
	getLockedAreaBounds,
	isValidAreaBounds,
	MIN_AREA_SIZE,
	QUICK_AREA_RATIOS,
	type Ratio,
	ratiosEqual,
	readAreaSelectionPreferences,
	writeAreaSelectionPreferences,
} from "@/utils/area-selection";
import { useTauriEventListener } from "@/utils/createEventListner";
import {
	commands,
	events,
	type LogicalBounds,
	type RecordingMode,
	type RecordingTargetMode,
	type ScreenCaptureTarget,
	type TargetUnderCursor,
} from "@/utils/tauri";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideLock from "~icons/lucide/lock";
import IconLucideMaximize2 from "~icons/lucide/maximize-2";
import IconLucideRatio from "~icons/lucide/ratio";
import IconLucideRotateCcw from "~icons/lucide/rotate-ccw";
import IconLucideVideo from "~icons/lucide/video";
import IconLucideX from "~icons/lucide/x";
import IconQuiroCamera from "~icons/quiro/camera";
import {
	RecordingOptionsProvider,
	useRecordingOptions,
} from "./launch/options-context";

// Rust spawns one of these transparent, always-on-top windows per display and
// points it at `/target-select-overlay?displayId=…&targetMode=…` (see
// windows/variants/overlays.rs). A background task polls the cursor and emits
// `targetUnderCursor`, so this window only ever *reacts* — it never polls.

const EMPTY_TARGET: TargetUnderCursor = { display_id: null, window: null };

// Matches Cap's target-select-overlay.tsx exactly (same class, same name) —
// the frosted card every one of its confirm panels sits in.
const LIQUID_GLASS_SURFACE_CLASS =
	"rounded-2xl border border-gray-12/10 bg-gray-1/82 shadow-xl shadow-black/20 backdrop-blur-xl dark:border-white/10 dark:bg-gray-2/82";

/**
 * The picker's confirm step — styled after Cap's RecordingControls pill
 * (same glass card, circular close button, gradient action pill with an
 * icon + two-line label), generalized across every mode that reaches it.
 * Trimmed to what actually has behavior behind it: no mode-switch caret
 * (would need this to react live to a mode change), no countdown gear
 * (GeneralSettingsStore.recordingCountdown is stored but nothing reads it
 * yet — both takeScreenshot and startRecording fire immediately, so a
 * countdown menu here would set a value with no effect).
 *
 * Instant mode is deliberately not wired here: Cap's Instant is a
 * cloud-upload feature (sign-in, live S3 segments) baked into its own
 * `start_recording`, not something the local `studio_recording` actor does
 * — faking it as a local recording under the "Instant" label would be
 * misleading, so this shows it as unavailable instead of silently running
 * a Studio recording.
 */
function ConfirmPanel({
	mode,
	onSelect,
	onCancel,
}: {
	mode: RecordingMode;
	onSelect: () => void;
	onCancel: () => void;
}) {
	const available = mode !== "instant";
	const Icon = mode === "screenshot" ? IconQuiroCamera : IconLucideVideo;
	const title =
		mode === "screenshot"
			? "Take Screenshot"
			: mode === "instant"
				? "Instant Recording"
				: "Start Recording";
	const subtitle =
		mode === "screenshot"
			? "Screenshot Mode"
			: mode === "instant"
				? "Not available yet — use Studio mode"
				: "Studio Mode";

	return (
		<div
			className={`pointer-events-auto w-104 max-w-[90vw] ${LIQUID_GLASS_SURFACE_CLASS} p-3`}
		>
			<div className="flex items-center gap-2.5">
				<button
					type="button"
					onClick={onCancel}
					aria-label="Cancel"
					className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-12 text-gray-1 transition-opacity hover:opacity-80"
				>
					<IconLucideX className="size-3" />
				</button>
				<button
					type="button"
					disabled={!available}
					onClick={available ? onSelect : undefined}
					className={`flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full pl-4 pr-5 text-white transition-[filter] ${
						available
							? "bg-linear-60 from-accent-solid via-accent-solid-hover to-accent-solid-active hover:brightness-110"
							: "cursor-not-allowed bg-gray-7 text-gray-12"
					}`}
				>
					<Icon className="size-4 shrink-0" />
					<span className="flex min-w-0 flex-col items-start text-left">
						<span className="text-[0.95rem] font-medium leading-tight text-nowrap">
							{title}
						</span>
						<span
							className={`text-[11px] font-light leading-tight text-nowrap ${available ? "text-white/90" : "text-gray-10"}`}
						>
							{subtitle}
						</span>
					</span>
				</button>
			</div>
		</div>
	);
}

export default function TargetSelectOverlay() {
	return (
		<RecordingOptionsProvider>
			<Inner />
		</RecordingOptionsProvider>
	);
}

function Inner() {
	const [searchParams] = useSearchParams();
	const displayId = searchParams.get("displayId") ?? "";
	const targetMode = (searchParams.get("targetMode") ??
		"display") as RecordingTargetMode;

	const { rawOptions, setOptions } = useRecordingOptions();

	const [targetUnderCursor, setTargetUnderCursor] =
		useState<TargetUnderCursor>(EMPTY_TARGET);

	useTauriEventListener(events.targetUnderCursor, setTargetUnderCursor);

	// The cursor poll only *emits on change*, and this webview finishes loading
	// after that loop is already running — so an overlay opened under a
	// stationary cursor would otherwise never learn it's the active display and
	// sit inert until the cursor left and came back. Seed from the current
	// value instead of waiting for the next change.
	useEffect(() => {
		let cancelled = false;
		commands.getTargetUnderCursor().then((current) => {
			if (cancelled || !current) return;
			// A real event may have landed while this was in flight; don't
			// clobber fresher data with the mount-time snapshot.
			setTargetUnderCursor((existing) =>
				existing.display_id === null && existing.window === null
					? current
					: existing,
			);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// This display is "active" only while the cursor is actually over it. With
	// multiple monitors every display has its own overlay window listening to
	// the same event, so each one has to decide for itself whether it's the one
	// being pointed at.
	const isActiveDisplay =
		targetUnderCursor.display_id !== null &&
		targetUnderCursor.display_id === displayId;

	const hoveredWindow = isActiveDisplay ? targetUnderCursor.window : null;

	const dismiss = useCallback(() => {
		void commands.closeTargetSelectOverlays();
	}, []);

	const cancel = useCallback(() => {
		setOptions({ targetMode: null, targetModeDismissal: "cancelled" });
		dismiss();
	}, [setOptions, dismiss]);

	// The overlays are transparent and may not hold keyboard focus, so Escape
	// arrives as a global shortcut relayed from Rust rather than a DOM keydown.
	useTauriEventListener(events.onEscapePress, cancel);

	const commit = useCallback(
		(captureTarget: ScreenCaptureTarget) => {
			setOptions({ captureTarget, targetMode: null });

			// The confirm panel's button is what actually fires the capture —
			// this only runs once the user has pressed it. Rust hides the
			// overlays itself before capturing/recording starts (see
			// capture.rs / recording.rs), so the dismissal below racing that
			// can't leak the overlay into the shot or the first frame.
			if (rawOptions.mode === "screenshot") {
				setOptions({ targetModeDismissal: "screenshot" });
				commands.takeScreenshot(captureTarget).then((result) => {
					if (result.status === "error") {
						console.error("Screenshot failed:", result.error);
					}
				});
			} else if (rawOptions.mode === "studio") {
				setOptions({ targetModeDismissal: "recordingStudio" });
				commands.startRecording(captureTarget).then((result) => {
					if (result.status === "error") {
						console.error("Failed to start recording:", result.error);
					}
				});
			}
			// Instant mode has no backend to call yet — the confirm panel
			// disables its button for that mode instead of reaching here.

			dismiss();
		},
		[setOptions, dismiss, rawOptions.mode],
	);

	const selectDisplay = useCallback(() => {
		commit({ variant: "display", id: displayId });
	}, [commit, displayId]);

	const selectWindow = useCallback(() => {
		if (!hoveredWindow) return;
		commit({ variant: "window", id: hoveredWindow.id });
	}, [commit, hoveredWindow]);

	const selectArea = useCallback(
		(bounds: LogicalBounds) => {
			commit({ variant: "area", screen: displayId, bounds });
		},
		[commit, displayId],
	);

	if (targetMode === "area") {
		// Prefer a locked area (explicitly pinned for reuse), then fall back to
		// whatever area is currently selected for this display — either way,
		// reopening the picker doesn't mean redrawing from scratch.
		const existing = rawOptions.captureTarget;
		const initialBounds =
			getLockedAreaBounds(readAreaSelectionPreferences(), displayId) ??
			(existing.variant === "area" && existing.screen === displayId
				? {
						x: existing.bounds.position.x,
						y: existing.bounds.position.y,
						width: existing.bounds.size.width,
						height: existing.bounds.size.height,
					}
				: null);

		return (
			<AreaSelectOverlay
				active={isActiveDisplay}
				displayId={displayId}
				mode={rawOptions.mode}
				initialBounds={initialBounds}
				onSelect={selectArea}
				onCancel={cancel}
			/>
		);
	}

	if (targetMode === "window") {
		return (
			<WindowSelectOverlay
				window={hoveredWindow}
				mode={rawOptions.mode}
				onSelect={selectWindow}
				onCancel={cancel}
			/>
		);
	}

	return (
		<DisplaySelectOverlay
			active={isActiveDisplay}
			displayId={displayId}
			mode={rawOptions.mode}
			onSelect={selectDisplay}
			onCancel={cancel}
		/>
	);
}

// --- Display mode --------------------------------------------------------

function DisplaySelectOverlay({
	active,
	displayId,
	mode,
	onSelect,
	onCancel,
}: {
	active: boolean;
	displayId: string;
	mode: RecordingMode;
	onSelect: () => void;
	onCancel: () => void;
}) {
	// Every mode confirms via the panel rather than committing on the first
	// click — a recording target used to arm immediately on click, but
	// that's no different from a screenshot committing instantly: neither
	// gives you a chance to back out, and starting a recording is the
	// harder of the two to walk back once it's underway.
	return (
		<OverlayRoot onContextMenu={onCancel}>
			<div
				className={`absolute inset-0 h-full w-full border-[3px] transition-colors duration-100 ${
					active
						? "border-accent-border-selected bg-accent-solid/30"
						: "border-transparent bg-transparent"
				}`}
			>
				<DisplayHint
					show={active}
					displayId={displayId}
					footer={
						<ConfirmPanel mode={mode} onSelect={onSelect} onCancel={onCancel} />
					}
				/>
			</div>
		</OverlayRoot>
	);
}

// --- Window mode ---------------------------------------------------------

function WindowInfoCard({
	window,
	icon,
}: {
	window: NonNullable<TargetUnderCursor["window"]>;
	icon: string | null | undefined;
}) {
	return (
		<span className="pointer-events-none flex items-center gap-2.5 rounded-xl bg-gray-1/90 px-3.5 py-2.5 text-gray-12 shadow-xl backdrop-blur-md">
			{icon && (
				<img
					src={icon}
					alt=""
					className="size-8 shrink-0 object-contain"
					draggable={false}
				/>
			)}
			<span className="flex min-w-0 flex-col text-left">
				<span className="truncate text-sm font-medium">{window.app_name}</span>
				<span className="text-[11px] text-gray-11 tabular-nums">
					{Math.round(window.bounds.size.width)} ×{" "}
					{Math.round(window.bounds.size.height)}
				</span>
			</span>
		</span>
	);
}

function WindowSelectOverlay({
	window,
	mode,
	onSelect,
	onCancel,
}: {
	window: TargetUnderCursor["window"];
	mode: RecordingMode;
	onSelect: () => void;
	onCancel: () => void;
}) {
	const windowId = window?.id ?? null;

	const icon = useQuery({
		queryKey: ["windowIcon", windowId] as const,
		queryFn: async () => {
			if (!windowId) return null;
			const result = await commands.getWindowIcon(windowId);
			return result.status === "ok" ? result.data : null;
		},
		enabled: windowId !== null,
		// Icons never change for a given window, and the cursor can sweep back
		// over the same window repeatedly while picking.
		staleTime: 5 * 60 * 1000,
	});

	return (
		<OverlayRoot onContextMenu={onCancel}>
			{window ? (
				<div
					className="absolute border-[3px] border-accent-border-selected bg-accent-solid/30 transition-[left,top,width,height] duration-75"
					style={{
						left: `${window.bounds.position.x}px`,
						top: `${window.bounds.position.y}px`,
						width: `${window.bounds.size.width}px`,
						height: `${window.bounds.size.height}px`,
					}}
				>
					<div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
						<WindowInfoCard window={window} icon={icon.data} />
						<ConfirmPanel mode={mode} onSelect={onSelect} onCancel={onCancel} />
					</div>
				</div>
			) : (
				<Hint>Point at a window · Esc to cancel</Hint>
			)}
		</OverlayRoot>
	);
}

// --- Area mode -----------------------------------------------------------

type Direction = "n" | "e" | "s" | "w" | "nw" | "ne" | "se" | "sw";

/** Corner + edge handles, mirroring Cap's cropper. */
const HANDLES: readonly {
	direction: Direction;
	cursor: string;
	left: string;
	top: string;
}[] = [
	{ direction: "nw", cursor: "nwse-resize", left: "0%", top: "0%" },
	{ direction: "n", cursor: "ns-resize", left: "50%", top: "0%" },
	{ direction: "ne", cursor: "nesw-resize", left: "100%", top: "0%" },
	{ direction: "e", cursor: "ew-resize", left: "100%", top: "50%" },
	{ direction: "se", cursor: "nwse-resize", left: "100%", top: "100%" },
	{ direction: "s", cursor: "ns-resize", left: "50%", top: "100%" },
	{ direction: "sw", cursor: "nesw-resize", left: "0%", top: "100%" },
	{ direction: "w", cursor: "ew-resize", left: "0%", top: "50%" },
];

type Interaction =
	| { kind: "draw"; originX: number; originY: number }
	| { kind: "move"; startX: number; startY: number; start: Bounds }
	| {
			kind: "resize";
			direction: Direction;
			startX: number;
			startY: number;
			start: Bounds;
	  };

const viewportSize = () => ({
	width: window.innerWidth,
	height: window.innerHeight,
});

/**
 * Force `bounds` onto `ratio`, keeping whichever edges the gesture isn't
 * dragging pinned in place. Edge handles resize symmetrically about the
 * opposite axis, matching how Cap's cropper behaves.
 */
function constrainToRatio(
	bounds: Bounds,
	ratio: Ratio,
	direction: Direction | "draw",
): Bounds {
	const target = ratio[0] / ratio[1];
	let { x, y, width, height } = bounds;

	if (direction === "n" || direction === "s") {
		width = height * target;
		x = bounds.x + bounds.width / 2 - width / 2;
	} else if (direction === "e" || direction === "w") {
		height = width / target;
		y = bounds.y + bounds.height / 2 - height / 2;
	} else {
		// Corner or freshly-drawn: width leads, and the anchored corner stays put.
		height = width / target;
		if (direction !== "draw") {
			if (direction.includes("w")) x = bounds.x + bounds.width - width;
			if (direction.includes("n")) y = bounds.y + bounds.height - height;
		}
	}

	return { x, y, width, height };
}

/** Shrink to fit the display without breaking the ratio, then nudge on-screen. */
function fitWithinViewport(bounds: Bounds, ratio: Ratio | null): Bounds {
	const view = viewportSize();
	let { x, y, width, height } = bounds;

	if (ratio) {
		const scale = Math.min(1, view.width / width, view.height / height);
		width *= scale;
		height *= scale;
	} else {
		width = Math.min(width, view.width);
		height = Math.min(height, view.height);
	}

	x = Math.max(0, Math.min(x, view.width - width));
	y = Math.max(0, Math.min(y, view.height - height));

	return { x, y, width, height };
}

function resizeBounds(
	start: Bounds,
	direction: Direction,
	dx: number,
	dy: number,
	ratio: Ratio | null,
	snap: boolean,
): Bounds {
	const view = viewportSize();
	const clampX = (v: number) => Math.max(0, Math.min(v, view.width));
	const clampY = (v: number) => Math.max(0, Math.min(v, view.height));

	let left = start.x;
	let top = start.y;
	let right = start.x + start.width;
	let bottom = start.y + start.height;

	if (direction.includes("w")) left = clampX(start.x + dx);
	if (direction.includes("e")) right = clampX(right + dx);
	if (direction.includes("n")) top = clampY(start.y + dy);
	if (direction.includes("s")) bottom = clampY(bottom + dy);

	// Don't let the dragged edge cross (or crowd) the pinned one.
	if (direction.includes("w"))
		left = Math.min(left, right - MIN_AREA_SIZE.width);
	if (direction.includes("e"))
		right = Math.max(right, left + MIN_AREA_SIZE.width);
	if (direction.includes("n"))
		top = Math.min(top, bottom - MIN_AREA_SIZE.height);
	if (direction.includes("s"))
		bottom = Math.max(bottom, top + MIN_AREA_SIZE.height);

	const next = { x: left, y: top, width: right - left, height: bottom - top };
	if (ratio) {
		return fitWithinViewport(constrainToRatio(next, ratio, direction), ratio);
	}

	// Free-form: if a corner drag lands very close to a common ratio, settle
	// onto it exactly. Corners only — nudging a single edge is usually a
	// deliberate one-axis adjustment, and snapping would fight the user.
	if (snap && direction.length === 2) {
		const closest = findClosestRatio(next.width, next.height);
		if (closest) {
			return fitWithinViewport(
				constrainToRatio(next, closest, direction),
				closest,
			);
		}
	}

	return next;
}

/** Translate the selection, keeping it fully on-screen. */
function moveBounds(start: Bounds, dx: number, dy: number): Bounds {
	const view = viewportSize();
	return {
		...start,
		x: Math.max(0, Math.min(start.x + dx, view.width - start.width)),
		y: Math.max(0, Math.min(start.y + dy, view.height - start.height)),
	};
}

function AreaSelectOverlay({
	active,
	displayId,
	mode,
	initialBounds,
	onSelect,
	onCancel,
}: {
	active: boolean;
	displayId: string;
	mode: RecordingMode;
	initialBounds: Bounds | null;
	onSelect: (bounds: LogicalBounds) => void;
	onCancel: () => void;
}) {
	const [preferences, setPreferences] = useState(readAreaSelectionPreferences);
	const [ratio, setRatio] = useState<Ratio | null>(
		() => readAreaSelectionPreferences().aspectRatio,
	);
	const [bounds, setBounds] = useState<Bounds | null>(initialBounds);
	const [interaction, setInteraction] = useState<Interaction | null>(null);
	const [ratioMenuOpen, setRatioMenuOpen] = useState(false);

	const isBusy = interaction !== null;
	// Read inside the pointerup handler, which binds once per interaction —
	// reading state there would see the value captured at pointerdown.
	const boundsRef = useRef<Bounds | null>(bounds);
	boundsRef.current = bounds;
	const ratioRef = useRef<Ratio | null>(ratio);
	ratioRef.current = ratio;
	const snapRef = useRef(preferences.snapToRatio);
	snapRef.current = preferences.snapToRatio;

	const beginDraw = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		setRatioMenuOpen(false);
		setBounds(null);
		setInteraction({
			kind: "draw",
			originX: event.clientX,
			originY: event.clientY,
		});
	};

	const beginMove = (event: React.PointerEvent<HTMLElement>) => {
		if (event.button !== 0 || !bounds) return;
		event.stopPropagation();
		setInteraction({
			kind: "move",
			startX: event.clientX,
			startY: event.clientY,
			start: bounds,
		});
	};

	const beginResize = (
		event: React.PointerEvent<HTMLElement>,
		direction: Direction,
	) => {
		if (event.button !== 0 || !bounds) return;
		event.stopPropagation();
		setInteraction({
			kind: "resize",
			direction,
			startX: event.clientX,
			startY: event.clientY,
			start: bounds,
		});
	};

	// Bound on window rather than the element so a drag that leaves the overlay
	// still tracks. Depends on `isBusy`, not the live pointer position, so the
	// listeners bind once per interaction instead of on every move.
	useEffect(() => {
		if (!isBusy) return;

		const handleMove = (event: PointerEvent) => {
			setInteraction((current) => {
				if (!current) return current;
				const activeRatio = ratioRef.current;
				// Holding Shift suspends snapping, matching Cap — the escape
				// hatch for when you want a size a snap keeps stealing.
				const snap = snapRef.current && !event.shiftKey;

				if (current.kind === "draw") {
					const drawn = {
						x: Math.min(current.originX, event.clientX),
						y: Math.min(current.originY, event.clientY),
						width: Math.abs(event.clientX - current.originX),
						height: Math.abs(event.clientY - current.originY),
					};

					if (activeRatio) {
						setBounds(
							fitWithinViewport(
								constrainToRatio(drawn, activeRatio, "draw"),
								activeRatio,
							),
						);
					} else {
						const closest = snap
							? findClosestRatio(drawn.width, drawn.height)
							: null;
						setBounds(
							closest
								? fitWithinViewport(
										constrainToRatio(drawn, closest, "draw"),
										closest,
									)
								: drawn,
						);
					}
				} else if (current.kind === "move") {
					setBounds(
						moveBounds(
							current.start,
							event.clientX - current.startX,
							event.clientY - current.startY,
						),
					);
				} else {
					setBounds(
						resizeBounds(
							current.start,
							current.direction,
							event.clientX - current.startX,
							event.clientY - current.startY,
							activeRatio,
							snap,
						),
					);
				}

				return current;
			});
		};

		const handleUp = () => {
			setInteraction(null);
			// A plain click leaves a zero-size box behind — drop it so the hint
			// comes back instead of showing an "invalid selection" warning.
			const settled = boundsRef.current;
			if (settled && (settled.width < 2 || settled.height < 2)) {
				setBounds(null);
			}
		};

		window.addEventListener("pointermove", handleMove);
		window.addEventListener("pointerup", handleUp);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", handleUp);
		};
	}, [isBusy]);

	const isValid = isValidAreaBounds(bounds);
	// See ConfirmPanel's doc comment — Instant mode has no local backend to
	// call into yet, so its button here stays disabled the same way.
	const confirmAvailable = mode !== "instant";
	const confirmLabel =
		mode === "screenshot"
			? "Take Screenshot"
			: mode === "instant"
				? "Not available yet"
				: "Start Recording";

	const applyRatio = (next: Ratio | null) => {
		setRatio(next);
		setRatioMenuOpen(false);
		persistPreferences({ aspectRatio: next });
		if (next && bounds) {
			setBounds(
				fitWithinViewport(constrainToRatio(bounds, next, "draw"), next),
			);
		}
	};

	const persistPreferences = (patch: Partial<AreaSelectionPreferences>) => {
		setPreferences((prev) => {
			const next = { ...prev, ...patch };
			writeAreaSelectionPreferences(next);
			return next;
		});
	};

	const toggleLocked = () => {
		if (!isValid) return;
		const locked = !preferences.locked;
		persistPreferences({
			locked,
			bounds: locked ? bounds : null,
			screenId: locked ? displayId : null,
		});
	};

	const confirm = () => {
		if (!bounds || !isValid) return;
		if (preferences.locked) {
			persistPreferences({ bounds });
		}
		onSelect({
			position: { x: Math.round(bounds.x), y: Math.round(bounds.y) },
			size: {
				width: Math.round(bounds.width),
				height: Math.round(bounds.height),
			},
		});
	};

	// Prefer below the selection; flip above when it would run off-screen.
	const toolbarBelow =
		bounds !== null && bounds.y + bounds.height + 56 < window.innerHeight;

	return (
		<OverlayRoot onContextMenu={onCancel}>
			<div
				onPointerDown={active ? beginDraw : undefined}
				className={`absolute inset-0 h-full w-full ${
					active ? "cursor-crosshair" : ""
				} ${bounds ? "" : active ? "bg-black/25" : "bg-black/10"}`}
			>
				{active && (
					<AreaToolbar
						bounds={bounds}
						isValid={isValid}
						ratio={ratio}
						locked={preferences.locked}
						ratioMenuOpen={ratioMenuOpen}
						snapToRatio={preferences.snapToRatio}
						onToggleRatioMenu={() => setRatioMenuOpen((open) => !open)}
						onSelectRatio={applyRatio}
						onToggleSnap={() =>
							persistPreferences({ snapToRatio: !preferences.snapToRatio })
						}
						onReset={() => {
							setBounds(null);
							setRatioMenuOpen(false);
						}}
						onFill={() =>
							setBounds(fillBounds(viewportSize(), ratioRef.current))
						}
						onToggleLocked={toggleLocked}
					/>
				)}

				{bounds && (
					<div
						className="absolute"
						style={{
							left: `${bounds.x}px`,
							top: `${bounds.y}px`,
							width: `${bounds.width}px`,
							height: `${bounds.height}px`,
							// Dims everything outside the selection in one paint, rather
							// than four separate backdrop elements.
							boxShadow: "0 0 0 100vmax rgba(0,0,0,0.45)",
						}}
					>
						<div
							onPointerDown={beginMove}
							className={`absolute inset-0 cursor-move border-2 ${
								isValid ? "border-accent-border-selected" : "border-red-500"
							}`}
						>
							{/* Rule-of-thirds guides, hidden while idle to keep it calm. */}
							{isBusy && (
								<>
									<div className="pointer-events-none absolute left-0 top-1/3 h-px w-full bg-white/40" />
									<div className="pointer-events-none absolute left-0 top-2/3 h-px w-full bg-white/40" />
									<div className="pointer-events-none absolute left-1/3 top-0 h-full w-px bg-white/40" />
									<div className="pointer-events-none absolute left-2/3 top-0 h-full w-px bg-white/40" />
								</>
							)}
						</div>

						{HANDLES.map((handle) => (
							<button
								key={handle.direction}
								type="button"
								tabIndex={-1}
								aria-label={`Resize ${handle.direction}`}
								onPointerDown={(event) => beginResize(event, handle.direction)}
								className="absolute size-3 -translate-x-1/2 -translate-y-1/2  border-[1.5px] border-accent-border-selected bg-gray-1 shadow-sm focus:outline-none"
								style={{
									left: handle.left,
									top: handle.top,
									cursor: handle.cursor,
								}}
							/>
						))}

						{!isBusy && (
							<div
								className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
								style={
									toolbarBelow
										? { top: "calc(100% + 10px)" }
										: { bottom: "calc(100% + 10px)" }
								}
							>
								{!isValid && (
									<div className="rounded-xl border border-red-500/40 bg-gray-1/95 px-3 py-2 text-center text-xs text-gray-12 shadow-xl backdrop-blur-md">
										<p className="font-medium">
											Minimum size is {MIN_AREA_SIZE.width} ×{" "}
											{MIN_AREA_SIZE.height}
										</p>
										<p className="text-gray-11 tabular-nums">
											{Math.round(bounds.width)} × {Math.round(bounds.height)}{" "}
											is too small
										</p>
									</div>
								)}
								<div className="flex items-center gap-1.5 rounded-xl bg-gray-1/95 p-1.5 shadow-xl backdrop-blur-md">
									<button
										type="button"
										onPointerDown={(event) => event.stopPropagation()}
										onClick={onCancel}
										className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-11 transition-colors hover:bg-gray-4 hover:text-gray-12"
									>
										Cancel
									</button>
									<button
										type="button"
										disabled={!isValid || !confirmAvailable}
										onPointerDown={(event) => event.stopPropagation()}
										onClick={confirm}
										className="rounded-lg bg-accent-solid px-3 py-1.5 text-xs font-medium text-accent-on-solid transition-colors hover:bg-accent-solid-hover disabled:cursor-not-allowed disabled:opacity-40"
									>
										{confirmLabel}
									</button>
								</div>
							</div>
						)}
					</div>
				)}

				{!bounds && active && <SelectionHint show />}
			</div>
		</OverlayRoot>
	);
}

function AreaToolbar({
	bounds,
	isValid,
	ratio,
	locked,
	ratioMenuOpen,
	snapToRatio,
	onToggleRatioMenu,
	onSelectRatio,
	onToggleSnap,
	onReset,
	onFill,
	onToggleLocked,
}: {
	bounds: Bounds | null;
	isValid: boolean;
	ratio: Ratio | null;
	locked: boolean;
	ratioMenuOpen: boolean;
	snapToRatio: boolean;
	onToggleRatioMenu: () => void;
	onSelectRatio: (ratio: Ratio | null) => void;
	onToggleSnap: () => void;
	onReset: () => void;
	onFill: () => void;
	onToggleLocked: () => void;
}) {
	const stop = (event: React.PointerEvent) => event.stopPropagation();

	return (
		<div className="fixed left-1/2 top-4 z-[60] max-w-[calc(100vw-2rem)] -translate-x-1/2">
			<div
				onPointerDown={stop}
				className="flex h-12 items-center gap-1.5 rounded-2xl border border-gray-12/10 bg-gray-1/85 p-1.5 text-gray-12 shadow-xl shadow-black/20 backdrop-blur-xl"
			>
				<div className="min-w-28 px-2 text-base font-normal leading-none tracking-[-0.01em] tabular-nums">
					{bounds
						? `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`
						: "Draw an area"}
				</div>

				<div className="h-6 w-px bg-gray-5" />

				<div className="flex items-center gap-0.5 rounded-xl bg-gray-12/6 p-0.5">
					<RatioButton
						selected={ratio === null}
						onClick={() => onSelectRatio(null)}
					>
						Free
					</RatioButton>
					{QUICK_AREA_RATIOS.map((quick) => (
						<RatioButton
							key={`${quick[0]}:${quick[1]}`}
							selected={ratiosEqual(ratio, quick)}
							onClick={() => onSelectRatio(quick)}
						>
							{quick[0]}:{quick[1]}
						</RatioButton>
					))}
				</div>

				<div className="relative">
					<ToolbarIconButton
						label="More aspect ratios"
						active={ratioMenuOpen}
						onClick={onToggleRatioMenu}
					>
						<IconLucideRatio className="size-4" />
					</ToolbarIconButton>
					{ratioMenuOpen && (
						<div className="absolute right-0 top-11 flex w-36 flex-col rounded-xl border border-gray-12/10 bg-gray-1/95 p-1 shadow-xl backdrop-blur-xl">
							{EXTRA_AREA_RATIOS.map((extra) => (
								<button
									key={`${extra[0]}:${extra[1]}`}
									type="button"
									onClick={() => onSelectRatio(extra)}
									className={`rounded-lg px-2.5 py-1.5 text-left text-xs tabular-nums transition-colors ${
										ratiosEqual(ratio, extra)
											? "bg-gray-12/12 text-gray-12"
											: "text-gray-11 hover:bg-gray-12/8 hover:text-gray-12"
									}`}
								>
									{extra[0]}:{extra[1]}
								</button>
							))}
							<div className="my-1 h-px bg-gray-5" />
							<button
								type="button"
								onClick={onToggleSnap}
								aria-pressed={snapToRatio}
								title="Snap free selections to nearby common ratios (hold Shift to override)"
								className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
									snapToRatio
										? "text-gray-12 hover:bg-gray-12/8"
										: "text-gray-11 hover:bg-gray-12/8 hover:text-gray-12"
								}`}
							>
								Snap to ratio
								{snapToRatio && <IconLucideCheck className="size-3.5" />}
							</button>
						</div>
					)}
				</div>

				<div className="h-6 w-px bg-gray-5" />

				<ToolbarIconButton label="Reset selection" onClick={onReset}>
					<IconLucideRotateCcw className="size-4" />
				</ToolbarIconButton>
				<ToolbarIconButton label="Fill display" onClick={onFill}>
					<IconLucideMaximize2 className="size-4" />
				</ToolbarIconButton>

				<button
					type="button"
					disabled={!isValid}
					onClick={onToggleLocked}
					aria-pressed={locked}
					title={
						locked
							? "Stop reusing this area"
							: "Reuse this area for future recordings"
					}
					className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-normal transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
						locked
							? "bg-accent-solid text-accent-on-solid shadow-sm"
							: "text-gray-11 hover:bg-gray-12/8 hover:text-gray-12"
					}`}
				>
					<IconLucideLock className="size-3.5" />
					{locked ? "Locked" : "Lock"}
				</button>
			</div>
		</div>
	);
}

function RatioButton({
	selected,
	onClick,
	children,
}: {
	selected: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={selected}
			className={`h-8 rounded-lg px-2 text-xs font-normal tabular-nums transition-colors ${
				selected
					? "bg-gray-12/12 text-gray-12"
					: "text-gray-11 hover:bg-gray-12/8"
			}`}
		>
			{children}
		</button>
	);
}

function ToolbarIconButton({
	label,
	active,
	onClick,
	children,
}: {
	label: string;
	active?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			aria-label={label}
			className={`flex size-9 items-center justify-center rounded-xl transition-colors ${
				active
					? "bg-gray-12/12 text-gray-12"
					: "text-gray-11 hover:bg-gray-12/8 hover:text-gray-12"
			}`}
		>
			{children}
		</button>
	);
}

// --- Shared chrome -------------------------------------------------------

function OverlayRoot({
	children,
	onContextMenu,
}: {
	children: React.ReactNode;
	onContextMenu: () => void;
}) {
	return (
		<div
			className="fixed inset-0 h-screen w-screen overflow-hidden bg-transparent select-none"
			onContextMenu={(event) => {
				event.preventDefault();
				onContextMenu();
			}}
		>
			{children}
		</div>
	);
}

function Hint({ children }: { children: React.ReactNode }) {
	return (
		<span className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 rounded-full bg-gray-2/90 px-5 py-2.5 text-base font-medium text-gray-12 shadow-xl backdrop-blur-md">
			{children}
		</span>
	);
}
