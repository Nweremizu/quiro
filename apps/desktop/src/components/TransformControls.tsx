import { type ReactNode, useCallback, useRef } from "react";
import { PanelSection } from "@/components/PanelSection";
import { Slider } from "@/routes/screenshot-editor/ui";
import type { LayerTransform, PerspectiveConfiguration } from "@/utils/tauri";
import IconLucideMove from "~icons/lucide/move";
import IconLucideRotate3d from "~icons/lucide/rotate-3d";
import IconLucideSearch from "~icons/lucide/search";

// Zoom / Position / Rotation for the capture — the three things you can do to
// it once the background around it is settled.
//
// Presentational on purpose: it holds no context and reads no store, so the
// screenshot editor can point it at the project-wide
// `background.displayTransform` / `background.perspective` while the video
// editor points it at the selected clip's own `transform` / `perspective`.
// Those are different documents at different scopes; the controls are not.
//
//   Zoom scale     → transform.scale
//   Zoom focus     → transform.scaleOrigin
//   Position X/Y   → transform.offset
//   Rotation X/Y/Z → perspective.tiltX / tiltY / rotate

/** Tilting past 90° would put the card edge-on and then show its back; the
 * panel stops at the edge. Z is a spin within the plane, so it can go all the
 * way round. */
const MAX_TILT_DEG = 90;
const MAX_SPIN_DEG = 180;

/** Zoom only — shrinking the card is what Position and the background's own
 * padding are for, and starting the range at 1 keeps the useful half of the
 * slider from being spent on sizes nobody picks. `MAX_LAYER_SCALE` is 8, so
 * this is a deliberate subset of what the field allows; a project scaled
 * beyond 5 by the drag gizmo still renders, the slider just pins at its end. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
/** Half-step increments: 1x, 1.5x, 2x… A finer step made the number churn
 * through values nobody was aiming for on the way to the one they wanted. */
const ZOOM_STEP = 0.5;

/** Snap targets in the position pad: fifths across, thirds down, matching the
 * 5×3 dot grid it draws. */
const SNAP_COLUMNS = 5;
const SNAP_ROWS = 3;
/** How close a drag has to get before it magnetises, as a fraction of the pad.
 * Roughly a third of the gap between neighbouring dots. */
const SNAP_RADIUS = 0.06;

/** Where `snap` actually pulls to, precomputed so the pad draws its targets
 * from the same numbers the snapping uses rather than a parallel copy. */
const SNAP_POINTS = Array.from({ length: SNAP_ROWS }).flatMap((_, row) =>
	Array.from({ length: SNAP_COLUMNS }).map((__, column) => ({
		x: column / (SNAP_COLUMNS - 1),
		y: row / (SNAP_ROWS - 1),
	})),
);

export const IDENTITY_LAYER_TRANSFORM: LayerTransform = {
	offset: { x: 0, y: 0 },
	scale: 1,
	scaleOrigin: { x: 0.5, y: 0.5 },
	rotation: 0,
};

export const FLAT_PERSPECTIVE: PerspectiveConfiguration = {
	tiltX: 0,
	tiltY: 0,
	rotate: 0,
};

function snap(value: number, divisions: number) {
	// Dots sit at the edges as well as between, so N columns means N targets
	// spanning 0..1 inclusive.
	const step = 1 / (divisions - 1);
	const nearest = Math.round(value / step) * step;
	return Math.abs(nearest - value) <= SNAP_RADIUS ? nearest : value;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Pointer position within an element, as a 0–1 fraction of its box. Shared by
 * both draggable pads. */
function useNormalisedDrag(onMove: (x: number, y: number) => void) {
	const ref = useRef<HTMLDivElement>(null);

	const handle = useCallback(
		(event: PointerEvent | React.PointerEvent) => {
			const box = ref.current?.getBoundingClientRect();
			if (!box || box.width === 0 || box.height === 0) return;
			onMove(
				clamp01((event.clientX - box.left) / box.width),
				clamp01((event.clientY - box.top) / box.height),
			);
		},
		[onMove],
	);

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			// Capture on the element itself, so a drag that leaves the pad keeps
			// tracking instead of stopping at the edge.
			event.currentTarget.setPointerCapture(event.pointerId);
			handle(event);
		},
		[handle],
	);

	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
			handle(event);
		},
		[handle],
	);

	return { ref, onPointerDown, onPointerMove };
}

/** The blue handle both pads share. Positioned by percentage so it tracks the
 * pad through any resize without recomputing. */
function Handle({ x, y }: { x: number; y: number }) {
	return (
		<div
			className="pointer-events-none absolute size-6 -translate-x-1/2 dark-button-shadow -translate-y-1/2 rounded-full border-4 border-white bg-accent-solid shadow-md"
			style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
		/>
	);
}

export function TransformControls({
	transform,
	perspective,
	canvas,
	laidOutCentre,
	focusBackdrop,
	positionPadStyle = "classic",
	onTransformChange,
	onPerspectiveChange,
	onDragEnd,
}: {
	transform: LayerTransform;
	perspective: PerspectiveConfiguration;
	/** The output frame, in pixels — what Position is measured across. */
	canvas: { width: number; height: number };
	/** Where layout alone would put the card's centre, in output pixels. The
	 * fixed reference the stored `offset` delta is measured from; without it
	 * the delta is meaningless, since it starts from wherever layout happened
	 * to place the card. */
	laidOutCentre: { x: number; y: number };
	/** What the focus pad shows behind its handle. The screenshot editor passes
	 * the still being annotated; a caller with no single frame to show passes
	 * `null` and gets the Scale slider without the pad, since a focal point
	 * picked against a blank square is a worse control than none. */
	focusBackdrop?: ReactNode;
	positionPadStyle?: "classic" | "zoom";
	onTransformChange: (patch: Partial<LayerTransform>) => void;
	onPerspectiveChange: (patch: Partial<PerspectiveConfiguration>) => void;
	/** Called when a drag begins, returning nothing — callers use it to open a
	 * single undo scope per drag rather than one entry per pointer move. */
	onDragEnd?: () => void;
}) {
	const hasCanvas = canvas.width > 0 && canvas.height > 0;
	const zoomPositionPad = positionPadStyle === "zoom";
	const positionInset = zoomPositionPad ? 0.08 : 0;
	const positionPercent = (value: number) =>
		(positionInset + value * (1 - 2 * positionInset)) * 100;
	const positionPoints = zoomPositionPad
		? SNAP_POINTS.filter(
				(point) => point.x === 0 || point.x === 0.5 || point.x === 1,
			)
		: SNAP_POINTS;

	// Position is expressed as the card's own centre inside the canvas — the
	// question "where is the capture in the frame" — rather than as the raw
	// `offset` delta the config stores.
	const centrePx = {
		x: laidOutCentre.x + transform.offset.x * canvas.width,
		y: laidOutCentre.y + transform.offset.y * canvas.height,
	};

	const setCentrePx = (x: number, y: number) => {
		if (!hasCanvas) return;
		onTransformChange({
			offset: {
				x: (x - laidOutCentre.x) / canvas.width,
				y: (y - laidOutCentre.y) / canvas.height,
			},
		});
	};

	const focus = useNormalisedDrag((x, y) =>
		onTransformChange({ scaleOrigin: { x, y } }),
	);

	// The pad *is* the canvas: its box maps 1:1 onto the output frame, so the
	// handle sits where the capture actually sits.
	const position = useNormalisedDrag((x, y) => {
		const normalise = (value: number) =>
			clamp01((value - positionInset) / (1 - 2 * positionInset));
		const snapped = {
			x: snap(normalise(x), zoomPositionPad ? 3 : SNAP_COLUMNS),
			y: snap(normalise(y), SNAP_ROWS),
		};
		setCentrePx(snapped.x * canvas.width, snapped.y * canvas.height);
	});

	const positionHandle = {
		x: hasCanvas ? clamp01(centrePx.x / canvas.width) : 0.5,
		y: hasCanvas ? clamp01(centrePx.y / canvas.height) : 0.5,
	};

	return (
		<>
			<PanelSection
				icon={<IconLucideSearch className="size-3.5" />}
				title="Zoom"
			>
				<div className="flex flex-col gap-2 px-3 pb-3">
					{focusBackdrop && (
						<div
							ref={focus.ref}
							onPointerDown={focus.onPointerDown}
							onPointerMove={focus.onPointerMove}
							className="relative cursor-crosshair overflow-hidden rounded-lg border border-gray-4 bg-gray-2 touch-none"
							style={{
								aspectRatio: hasCanvas
									? `${canvas.width} / ${canvas.height}`
									: "16 / 9",
							}}
						>
							{focusBackdrop}
							<Handle
								x={transform.scaleOrigin?.x ?? 0.5}
								y={transform.scaleOrigin?.y ?? 0.5}
							/>
						</div>
					)}

					<Slider
						label="Scale"
						ariaLabel="Zoom scale"
						value={transform.scale}
						min={MIN_ZOOM}
						max={MAX_ZOOM}
						step={ZOOM_STEP}
						format={(v) => `${v.toFixed(1)}x`}
						onChange={(scale) => onTransformChange({ scale })}
						onDragEnd={onDragEnd}
					/>
				</div>
			</PanelSection>

			<PanelSection
				icon={<IconLucideMove className="size-3.5" />}
				title="Position"
			>
				<div className="flex flex-col gap-2 px-3 pb-3">
					<div
						ref={position.ref}
						onPointerDown={position.onPointerDown}
						onPointerMove={position.onPointerMove}
						className={
							zoomPositionPad
								? "relative aspect-video cursor-crosshair touch-none select-none overflow-hidden rounded-xl bg-gray-3"
								: "relative cursor-crosshair rounded-lg bg-gray-3 touch-none p-3 flex items-center justify-center"
						}
						style={{
							aspectRatio: hasCanvas
								? `${canvas.width} / ${canvas.height}`
								: "16 / 9",
						}}
					>
						{zoomPositionPad && (
							<>
								<span
									aria-hidden="true"
									className="pointer-events-none absolute inset-x-[8%] top-1/2 h-px bg-gray-5"
								/>
								<span
									aria-hidden="true"
									className="pointer-events-none absolute inset-y-[8%] left-1/2 w-px bg-gray-5"
								/>
							</>
						)}
						<div
							aria-hidden="true"
							className={
								zoomPositionPad
									? "pointer-events-none absolute inset-0"
									: "pointer-events-none absolute inset-3"
							}
						>
							{positionPoints.map((point) => (
								<div
									key={`${point.x}x${point.y}`}
									className={
										zoomPositionPad
											? "pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-8"
											: "pointer-events-none absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-8"
									}
									style={{
										left: `${positionPercent(point.x)}%`,
										top: `${positionPercent(point.y)}%`,
									}}
								/>
							))}
						</div>
						{zoomPositionPad ? (
							<span
								aria-hidden="true"
								className="pointer-events-none absolute z-20 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-gray-5 bg-accent-solid"
								style={{
									left: `${positionPercent(positionHandle.x)}%`,
									top: `${positionPercent(positionHandle.y)}%`,
								}}
							/>
						) : (
							<Handle x={positionHandle.x} y={positionHandle.y} />
						)}
					</div>

					<Slider
						label="X"
						ariaLabel="Horizontal position"
						value={centrePx.x}
						min={0}
						max={canvas.width}
						format={(v) => `${Math.round(v)}`}
						onChange={(x) => setCentrePx(x, centrePx.y)}
						onDragEnd={onDragEnd}
					/>
					<Slider
						label="Y"
						ariaLabel="Vertical position"
						value={centrePx.y}
						min={0}
						max={canvas.height}
						format={(v) => `${Math.round(v)}`}
						onChange={(y) => setCentrePx(centrePx.x, y)}
						onDragEnd={onDragEnd}
					/>
				</div>
			</PanelSection>

			<PanelSection
				icon={<IconLucideRotate3d className="size-3.5" />}
				title="Rotation"
			>
				<div className="flex flex-col gap-2 px-3 pb-3">
					<Slider
						label="X"
						ariaLabel="Tilt about the horizontal axis"
						value={perspective.tiltX}
						min={-MAX_TILT_DEG}
						max={MAX_TILT_DEG}
						format={(v) => `${Math.round(v)}`}
						onChange={(tiltX) => onPerspectiveChange({ tiltX })}
						onDragEnd={onDragEnd}
					/>
					<Slider
						label="Y"
						ariaLabel="Tilt about the vertical axis"
						value={perspective.tiltY}
						min={-MAX_TILT_DEG}
						max={MAX_TILT_DEG}
						format={(v) => `${Math.round(v)}`}
						onChange={(tiltY) => onPerspectiveChange({ tiltY })}
						onDragEnd={onDragEnd}
					/>
					<Slider
						label="Z"
						ariaLabel="Spin within the plane"
						value={perspective.rotate}
						min={-MAX_SPIN_DEG}
						max={MAX_SPIN_DEG}
						format={(v) => `${Math.round(v)}`}
						onChange={(rotate) => onPerspectiveChange({ rotate })}
						onDragEnd={onDragEnd}
					/>
				</div>
			</PanelSection>
		</>
	);
}
