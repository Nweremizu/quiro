import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useRef } from "react";
import { PanelSection } from "@/components/PanelSection";
import type { LayerTransform, PerspectiveConfiguration } from "@/utils/tauri";
import IconLucideMove from "~icons/lucide/move";
import IconLucideRotate3d from "~icons/lucide/rotate-3d";
import IconLucideSearch from "~icons/lucide/search";
import { useScreenshotEditorContext } from "./context";
import { getImageRect } from "./layout";
import { IDENTITY_TRANSFORM } from "./transform";
import { Slider } from "./ui";

// Zoom / Position / Rotation for the capture — the three things you can do to
// the card once the background around it is settled. Replaces the old
// perspective popover, which offered four tilt sliders and a depth dial from
// a toolbar bubble; this is a docked panel because placing a card is not a
// one-slider job you do and dismiss.
//
// Every control writes to a field that already existed, with one exception:
//
//   Zoom scale     → displayTransform.scale
//   Zoom focus     → displayTransform.scaleOrigin   (new)
//   Position X/Y   → displayTransform.offset
//   Rotation X/Y/Z → perspective.tiltX / tiltY / rotate
//
// Position and Zoom therefore share `displayTransform` with the on-canvas drag
// gizmo, so moving the card by hand and moving it by slider are the same edit
// and stay in sync. Rotation X/Y have no gizmo — there is nothing to grab for
// an out-of-plane tilt — which is exactly why they need sliders.

/** Tilting past 90° would put the card edge-on and then show its back; the
 * panel stops at the edge. Z is a spin within the plane, so it can go all the
 * way round. */
const MAX_TILT_DEG = 90;
const MAX_SPIN_DEG = 180;

/** Zoom only — shrinking the card is what Position and the background's own
 * padding are for, and starting the range at 1 keeps the useful half of the
 * slider from being spent on sizes nobody picks. `MAX_LAYER_SCALE` is 8, so
 * this is a deliberate subset of what the field allows; a project scaled
 * beyond 6 by the drag gizmo still renders, the slider just pins at its end. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
/** Half-step increments: 1x, 1.5x, 2x… A finer step made the number churn
 * through values nobody was aiming for on the way to the one they wanted,
 * and at this range the in-between sizes are not distinguishable anyway. */
const ZOOM_STEP = 0.5;

/** Snap targets in the position pad: fifths across, thirds down, matching the
 * 5×3 dot grid it draws. */
const SNAP_COLUMNS = 5;
const SNAP_ROWS = 3;
/** How close a drag has to get before it magnetises, as a fraction of the
 * pad. Roughly a third of the gap between neighbouring dots — near enough to
 * feel intentional, far enough that the space between dots is still usable. */
const SNAP_RADIUS = 0.06;

/** Where `snap` actually pulls to, precomputed so the pad draws its targets
 * from the same numbers the snapping uses rather than a parallel copy. */
const SNAP_POINTS = Array.from({ length: SNAP_ROWS }).flatMap((_, row) =>
	Array.from({ length: SNAP_COLUMNS }).map((__, column) => ({
		x: column / (SNAP_COLUMNS - 1),
		y: row / (SNAP_ROWS - 1),
	})),
);

const FLAT_PERSPECTIVE: PerspectiveConfiguration = {
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
			className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-accent-solid shadow-md"
			style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
		/>
	);
}

export function TransformPanel() {
	const {
		project,
		updateBackground,
		instance,
		history,
		latestFrame,
		originalImageSize,
	} = useScreenshotEditorContext();

	// Everything below runs before the "nothing loaded yet" guard, because
	// `useNormalisedDrag` calls hooks: returning early above it would change
	// the hook order between the render where the project is still loading and
	// the one after it, which React rejects outright. So the values fall back
	// to sane defaults and the writers no-op until there is a project.
	const transform: LayerTransform =
		project?.background.displayTransform ?? IDENTITY_TRANSFORM;
	const perspective = project?.background.perspective ?? FLAT_PERSPECTIVE;

	const setTransform = (patch: Partial<LayerTransform>) => {
		if (!project) return;
		updateBackground({ displayTransform: { ...transform, ...patch } });
	};

	const setPerspective = (patch: Partial<PerspectiveConfiguration>) => {
		if (!project) return;
		updateBackground({ perspective: { ...perspective, ...patch } });
	};

	// One undo entry per drag rather than one per pointer move — the same
	// scope the sliders in AnnotationConfig use.
	const dragScope = () => history.pause();

	// Position is expressed as the card's own centre inside the canvas — the
	// question "where is the screenshot in the frame" — rather than as the
	// raw `offset` delta the config stores. The delta is meaningless on its
	// own: it is measured from wherever layout happened to put the card, which
	// moves whenever padding, crop or aspect ratio changes.
	//
	// `latestFrame` is the canvas: the rendered output frame, which is the
	// screenshot plus its padding, not the screenshot's own dimensions. Using
	// the latter (as this first did) makes every conversion wrong by the
	// padding factor.
	const canvas = {
		width: latestFrame?.width ?? 0,
		height: latestFrame?.height ?? 0,
	};
	const hasCanvas = canvas.width > 0 && canvas.height > 0;

	// Where layout alone would put the card, with no transform applied — the
	// fixed reference the stored offset is measured from.
	const laidOut = getImageRect(
		canvas,
		originalImageSize,
		project?.background.padding ?? 0,
		project?.background.crop ?? null,
		project?.aspectRatio ?? null,
		null,
	);
	const laidOutCentre = {
		x: laidOut.x + laidOut.width / 2,
		y: laidOut.y + laidOut.height / 2,
	};

	/** The card's centre in output pixels, which is what the sliders show. */
	const centrePx = {
		x: laidOutCentre.x + transform.offset.x * canvas.width,
		y: laidOutCentre.y + transform.offset.y * canvas.height,
	};

	/** Inverse: put the centre at a given output-pixel point. */
	const setCentrePx = (x: number, y: number) => {
		if (!hasCanvas) return;
		setTransform({
			offset: {
				x: (x - laidOutCentre.x) / canvas.width,
				y: (y - laidOutCentre.y) / canvas.height,
			},
		});
	};

	const focus = useNormalisedDrag((x, y) =>
		setTransform({ scaleOrigin: { x, y } }),
	);

	// The pad *is* the canvas: its box maps 1:1 onto the output frame, so the
	// handle sits where the screenshot actually sits. Dragging to a corner
	// puts the card's centre in that corner, which is as far as this panel
	// goes — the on-canvas gizmo is still the way to push a card fully off
	// frame.
	const position = useNormalisedDrag((x, y) => {
		const snapped = { x: snap(x, SNAP_COLUMNS), y: snap(y, SNAP_ROWS) };
		setCentrePx(snapped.x * canvas.width, snapped.y * canvas.height);
	});

	if (!project || !instance) return null;

	// The handle is simply the centre as a fraction of the canvas.
	const positionHandle = {
		x: hasCanvas ? clamp01(centrePx.x / canvas.width) : 0.5,
		y: hasCanvas ? clamp01(centrePx.y / canvas.height) : 0.5,
	};

	return (
		<div className="flex h-full w-full min-h-0 flex-col overflow-y-auto">
			<PanelSection
				icon={<IconLucideSearch className="size-3.5" />}
				title="Zoom"
			>
				<div className="flex flex-col gap-2 px-3 pb-3">
					{/* Deliberately the flat screenshot rather than a live render:
					    this is a surface for placing the focal point on, and the
					    thing being pointed at is a location in the capture, not in
					    the composed frame. A live preview would cost a second
					    render target to say the same thing less clearly. */}
					<div
						ref={focus.ref}
						onPointerDown={focus.onPointerDown}
						onPointerMove={focus.onPointerMove}
						className="relative cursor-crosshair overflow-hidden rounded-lg border border-gray-4 bg-gray-2 touch-none"
						style={{
							aspectRatio: `${instance.imageWidth} / ${instance.imageHeight}`,
						}}
					>
						<img
							src={convertFileSrc(instance.path)}
							alt=""
							draggable={false}
							className="pointer-events-none size-full object-cover"
						/>
						<Handle
							x={transform.scaleOrigin?.x ?? 0.5}
							y={transform.scaleOrigin?.y ?? 0.5}
						/>
					</div>

					<Slider
						label="Scale"
						ariaLabel="Zoom scale"
						value={transform.scale}
						min={MIN_ZOOM}
						max={MAX_ZOOM}
						step={ZOOM_STEP}
						format={(v) => `${v.toFixed(1)}x`}
						onChange={(scale) => setTransform({ scale })}
						onDragEnd={dragScope()}
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
						className="relative cursor-crosshair rounded-lg bg-gray-3 touch-none p-3 flex items-center justify-center"
						style={{
							aspectRatio: hasCanvas
								? `${canvas.width} / ${canvas.height}`
								: "16 / 9",
						}}
					>
						{/* Snap targets, drawn where `snap` actually pulls to. */}
						<div className="pointer-events-none absolute inset-3">
							{SNAP_POINTS.map((point) => (
								<div
									key={`${point.x}x${point.y}`}
									className="pointer-events-none absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-8"
									style={{
										left: `${point.x * 100}%`,
										top: `${point.y * 100}%`,
									}}
								/>
							))}
						</div>
						<Handle x={positionHandle.x} y={positionHandle.y} />
					</div>

					<Slider
						label="X"
						ariaLabel="Horizontal position"
						value={centrePx.x}
						min={0}
						max={canvas.width}
						format={(v) => `${Math.round(v)}`}
						onChange={(x) => setCentrePx(x, centrePx.y)}
						onDragEnd={dragScope()}
					/>
					<Slider
						label="Y"
						ariaLabel="Vertical position"
						value={centrePx.y}
						min={0}
						max={canvas.height}
						format={(v) => `${Math.round(v)}`}
						onChange={(y) => setCentrePx(centrePx.x, y)}
						onDragEnd={dragScope()}
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
						onChange={(tiltX) => setPerspective({ tiltX })}
						onDragEnd={dragScope()}
					/>
					<Slider
						label="Y"
						ariaLabel="Tilt about the vertical axis"
						value={perspective.tiltY}
						min={-MAX_TILT_DEG}
						max={MAX_TILT_DEG}
						format={(v) => `${Math.round(v)}`}
						onChange={(tiltY) => setPerspective({ tiltY })}
						onDragEnd={dragScope()}
					/>
					<Slider
						label="Z"
						ariaLabel="Spin within the plane"
						value={perspective.rotate}
						min={-MAX_SPIN_DEG}
						max={MAX_SPIN_DEG}
						format={(v) => `${Math.round(v)}`}
						onChange={(rotate) => setPerspective({ rotate })}
						onDragEnd={dragScope()}
					/>
				</div>
			</PanelSection>
		</div>
	);
}
