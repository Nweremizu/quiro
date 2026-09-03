import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerTransform } from "@/utils/tauri";
import { useScreenshotEditorContext } from "./context";
import {
	clientToFrame,
	type FramePx,
	framePt,
	type Pt,
	type Rect,
} from "./space";
import {
	clampTransform,
	hitTestCard,
	isIdentityTransform,
	MAX_LAYER_SCALE,
	MIN_LAYER_SCALE,
	offsetForCentre,
	rectCentre,
	rotateFramePoint,
} from "./transform";

// The capture's own manipulator: drag, uniform scale, in-plane rotation, with
// the canvas as a fixed clipping viewport underneath.
//
// There is no tool to arm. Pressing on the capture moves it, the way pressing
// on an annotation moves that — a mode you have to select first is a mode you
// have to remember, and the capture is the one object in the editor that is
// always there. So this is mounted for the whole of select mode and decides
// for itself whether a press was meant for it, by reading the rendered alpha
// under the pointer. A press that misses is handed back to the caller, which
// deselects and pans.
//
// It sits *below* the annotation layer: annotations are drawn on top of the
// capture, so they win a press where the two overlap. The cost is that a
// corner handle under an annotation is unreachable — accepted, since the
// handles are at the card's corners and annotations rarely are.
//
// Two properties do most of the work of making this feel solid.
//
// **Every gesture is absolute, not incremental.** Pointer-down snapshots the
// transform, the pointer, and the card's *laid-out* rect — the one padding and
// aspect ratio produce, which no gesture can change — and every subsequent
// move recomputes the result from that snapshot. Nothing accumulates, so
// rounding never drifts, and the config value the gesture is writing can never
// feed back into the gesture that is writing it. Incremental deltas against a
// live rect are exactly where the jitter in a drag like this comes from.
//
// **Input rate is decoupled from render rate.** A high-polling-rate mouse
// fires pointermove far faster than a frame, and each one here would otherwise
// become a React commit plus an IPC push at the renderer. Moves land in a ref
// and one rAF drains it, so the cost per frame is fixed however fast the
// device reports.

type Corner = "nw" | "ne" | "sw" | "se";

type Gesture = {
	kind: "move" | "scale" | "rotate";
	pointerId: number;
	corner: Corner | null;
	/** Pointer at gesture start, in frame pixels. */
	origin: Pt<FramePx>;
	transform: LayerTransform;
	/** The card as it stood at gesture start — already transformed, so this is
	 * what the pointer was actually pointing at. */
	rect: Rect<FramePx>;
	/** Angle from the card centre to the pointer at gesture start, radians. */
	angle: number;
	/** Releases the history pause, so the whole gesture is one undo entry. */
	release: () => void;
};

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

const cornerPoint = (rect: Rect<FramePx>, corner: Corner): Pt<FramePx> =>
	framePt(
		corner === "nw" || corner === "sw" ? rect.x : rect.x + rect.width,
		corner === "nw" || corner === "ne" ? rect.y : rect.y + rect.height,
	);

const OPPOSITE: Record<Corner, Corner> = {
	nw: "se",
	ne: "sw",
	sw: "ne",
	se: "nw",
};

/** Rotation snaps to this under Shift. Nothing snaps otherwise: a capture
 * nudged to a deliberate 3-degree tilt must stay at 3 degrees. */
const ROTATION_SNAP_DEG = 15;

const clamp = (value: number, min: number, max: number) =>
	value < min ? min : value > max ? max : value;

const NUDGE: Record<string, [number, number]> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
};

/** How long a burst of discrete edits — wheel ticks, arrow-key repeats — stays
 * open as one undo entry after the last one arrives. */
const BURST_IDLE_MS = 400;

export function TransformGizmo({
	bounds,
	cssWidth,
	cssHeight,
	laidOutRect,
	imageRect,
	transform,
	cssRotation,
	onMiss,
	disabled,
}: {
	bounds: Rect<FramePx>;
	cssWidth: number;
	cssHeight: number;
	/** The capture where layout alone would put it — before any transform.
	 * Held constant for the duration of a gesture, which is what lets the
	 * result be recomputed from the snapshot rather than accumulated. */
	laidOutRect: Rect<FramePx>;
	/** Where the capture actually is, transform applied. */
	imageRect: Rect<FramePx>;
	transform: LayerTransform;
	/** The rotation the browser is applying, which is not the transform's own
	 * whenever the capture is tilted — the renderer bakes the spin in then. The
	 * hit test has to undo exactly what the browser did. */
	cssRotation: number;
	/** Called when a press lands on the canvas rather than the capture. */
	onMiss: (event: React.PointerEvent) => void;
	/** Suppresses the gizmo entirely — space is held, so the gesture is a pan. */
	disabled: boolean;
}) {
	const {
		updateBackground,
		history,
		cardCanvas,
		captureSelected,
		setCaptureSelected,
	} = useScreenshotEditorContext();

	const [hovering, setHovering] = useState(false);

	const svgRef = useRef<SVGSVGElement>(null);
	const gestureRef = useRef<Gesture | null>(null);
	const pendingRef = useRef<PointerEvent | null>(null);
	const frameRef = useRef<number | null>(null);
	const [activeGesture, setActiveGesture] = useState<Gesture["kind"] | null>(
		null,
	);

	// Live values the rAF drain reads. It runs outside React's render, so it
	// cannot close over props without going stale on the very first frame of a
	// gesture — which is the frame that decides whether a drag feels attached
	// to the pointer or a step behind it.
	const latest = useRef({ bounds, laidOutRect, transform });
	latest.current = { bounds, laidOutRect, transform };

	const commit = useCallback(
		(next: LayerTransform) => {
			const clamped = clampTransform(next);
			updateBackground({
				// An identity transform is stored as `None` so a capture returned to
				// its laid-out position takes the renderer's untransformed path
				// again, rather than carrying a no-op matrix forever.
				displayTransform: isIdentityTransform(clamped) ? null : clamped,
			});
		},
		[updateBackground],
	);

	const centre = rectCentre(imageRect);

	const applyPointer = useCallback(
		(event: PointerEvent) => {
			const gesture = gestureRef.current;
			const svg = svgRef.current;
			if (!gesture || !svg) return;

			const { bounds, laidOutRect, transform } = latest.current;
			const canvas = { width: bounds.width, height: bounds.height };
			const laidOutCentre = rectCentre(laidOutRect);
			const start = gesture.transform;
			const startCentre = rectCentre(gesture.rect);
			const pointer = clientToFrame(event, svg, bounds);

			if (gesture.kind === "move") {
				let dx = pointer.x - gesture.origin.x;
				let dy = pointer.y - gesture.origin.y;
				// Shift locks to whichever axis the gesture has committed to so
				// far, rather than to the instantaneous direction — the latter
				// flickers between axes near the diagonal.
				if (event.shiftKey) {
					if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
					else dx = 0;
				}
				commit({
					...transform,
					offset: offsetForCentre(
						framePt(startCentre.x + dx, startCentre.y + dy),
						laidOutCentre,
						canvas,
					),
				});
				return;
			}

			if (gesture.kind === "rotate") {
				const angle = Math.atan2(
					pointer.y - startCentre.y,
					pointer.x - startCentre.x,
				);
				const degrees =
					start.rotation + ((angle - gesture.angle) * 180) / Math.PI;
				commit({
					...transform,
					rotation: event.shiftKey
						? Math.round(degrees / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG
						: degrees,
				});
				return;
			}

			const corner = gesture.corner;
			if (!corner) return;

			// Alt scales about the card's own centre; otherwise the corner
			// diagonally opposite the one being dragged stays nailed down, which
			// is what makes a corner drag feel like it is pulling that corner
			// rather than resizing something nearby.
			const anchor = event.altKey
				? startCentre
				: rotateFramePoint(
						cornerPoint(gesture.rect, OPPOSITE[corner]),
						startCentre,
						start.rotation,
					);
			const handle = rotateFramePoint(
				cornerPoint(gesture.rect, corner),
				startCentre,
				start.rotation,
			);

			// Projected onto the start diagonal rather than taken as a raw
			// distance ratio: distance alone grows again once the pointer crosses
			// the anchor, so the card would rebound instead of bottoming out.
			const axisX = handle.x - anchor.x;
			const axisY = handle.y - anchor.y;
			const axisLength = Math.hypot(axisX, axisY);
			if (axisLength < 1e-6) return;

			const ratio =
				((pointer.x - anchor.x) * axisX + (pointer.y - anchor.y) * axisY) /
				(axisLength * axisLength);
			const scale = clamp(
				start.scale * ratio,
				MIN_LAYER_SCALE,
				MAX_LAYER_SCALE,
			);
			const growth = scale / start.scale;

			commit({
				...transform,
				scale,
				offset: offsetForCentre(
					framePt(
						anchor.x + (startCentre.x - anchor.x) * growth,
						anchor.y + (startCentre.y - anchor.y) * growth,
					),
					laidOutCentre,
					canvas,
				),
			});
		},
		[commit],
	);

	const schedule = useCallback(
		(event: PointerEvent) => {
			pendingRef.current = event;
			if (frameRef.current !== null) return;
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = null;
				const pending = pendingRef.current;
				pendingRef.current = null;
				if (pending) applyPointer(pending);
			});
		},
		[applyPointer],
	);

	const endGesture = useCallback(() => {
		const gesture = gestureRef.current;
		if (!gesture) return;
		gestureRef.current = null;
		pendingRef.current = null;
		if (frameRef.current !== null) {
			cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
		}
		gesture.release();
		setActiveGesture(null);
	}, []);

	useEffect(() => {
		const handleMove = (event: PointerEvent) => {
			if (gestureRef.current?.pointerId !== event.pointerId) return;
			event.preventDefault();
			schedule(event);
		};
		const handleUp = (event: PointerEvent) => {
			if (gestureRef.current?.pointerId !== event.pointerId) return;
			// Drain the last position synchronously: the rAF that would have
			// carried it is cancelled on the next line, and dropping it leaves the
			// card a frame short of where the pointer was released.
			applyPointer(event);
			endGesture();
		};

		window.addEventListener("pointermove", handleMove, { passive: false });
		window.addEventListener("pointerup", handleUp);
		window.addEventListener("pointercancel", handleUp);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", handleUp);
			window.removeEventListener("pointercancel", handleUp);
		};
	}, [schedule, applyPointer, endGesture]);

	useEffect(() => endGesture, [endGesture]);

	// Wheel ticks and arrow-key repeats arrive as a burst of separate commits,
	// and one undo entry per tick would make backing out of a zoom a hundred
	// presses of Cmd-Z. They share a pause held open for as long as the burst
	// keeps arriving, so a run of them lands as a single entry — the same
	// granularity a drag gets.
	const burstRef = useRef<{ release: () => void; timer: number } | null>(null);
	const coalesce = useCallback(() => {
		const burst = burstRef.current;
		if (burst) window.clearTimeout(burst.timer);
		const release = burst?.release ?? history.pause();
		burstRef.current = {
			release,
			timer: window.setTimeout(() => {
				burstRef.current = null;
				release();
			}, BURST_IDLE_MS),
		};
	}, [history]);

	useEffect(
		() => () => {
			const burst = burstRef.current;
			if (!burst) return;
			window.clearTimeout(burst.timer);
			burst.release();
		},
		[],
	);

	const beginGesture = (
		event: React.PointerEvent,
		kind: Gesture["kind"],
		corner: Corner | null,
	) => {
		if (event.button !== 0) return;
		const svg = svgRef.current;
		if (!svg) return;
		event.preventDefault();
		event.stopPropagation();

		const origin = clientToFrame(event.nativeEvent, svg, bounds);
		gestureRef.current = {
			kind,
			corner,
			pointerId: event.pointerId,
			origin,
			transform,
			rect: imageRect,
			angle: Math.atan2(origin.y - centre.y, origin.x - centre.x),
			release: history.pause(),
		};
		setActiveGesture(kind);
	};

	// Wheel scales the capture about its own centre. Registered natively and
	// non-passive because the preview's own wheel handler — pan and viewport
	// zoom — sits on an ancestor, and the only way to keep both from firing is
	// to stop this one propagating, which a passive React listener cannot do.
	//
	// Ctrl/Cmd-wheel and trackpad pinch are deliberately let through: those zoom
	// the *viewport*, and taking them here would leave no way to look closer at
	// a capture while placing it.
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;

		const handleWheel = (event: WheelEvent) => {
			if (event.ctrlKey || event.metaKey) return;
			event.preventDefault();
			event.stopPropagation();
			coalesce();
			// Exponential in the delta, so scaling up and the same distance back
			// down returns to exactly where it started rather than drifting.
			const step = Math.exp(-event.deltaY * 0.0015);
			commit({
				...transform,
				scale: clamp(transform.scale * step, MIN_LAYER_SCALE, MAX_LAYER_SCALE),
			});
		};

		svg.addEventListener("wheel", handleWheel, { passive: false });
		return () => svg.removeEventListener("wheel", handleWheel);
	}, [commit, coalesce, transform]);

	// Arrow keys nudge in frame pixels, which is the unit the user can see;
	// Shift takes the coarse step. Held keys repeat through the OS, so there is
	// no timer here.
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			)
				return;

			const nudge = NUDGE[event.key];
			if (!nudge) return;
			event.preventDefault();
			coalesce();

			// The step is in frame pixels, which is the unit on screen, converted
			// to canvas fractions per axis — one pixel down is a smaller fraction
			// than one pixel across on any frame that is not square.
			const framePixels = event.shiftKey ? 10 : 1;
			commit({
				...transform,
				offset: {
					x:
						transform.offset.x +
						(nudge[0] * framePixels) / Math.max(1, bounds.width),
					y:
						transform.offset.y +
						(nudge[1] * framePixels) / Math.max(1, bounds.height),
				},
			});
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [commit, coalesce, transform, bounds.width, bounds.height]);

	// Sized in frame pixels but constant on screen, so a handle stays the same
	// physical size whatever the viewport zoom or the output resolution.
	const perScreenPx = cssWidth === 0 ? 0 : bounds.width / cssWidth;
	const handleSize = 9 * perScreenPx;
	const stroke = 1.5 * perScreenPx;
	const rotationArm = 28 * perScreenPx;

	const rotationHandle = useMemo(
		() => framePt(centre.x, imageRect.y - rotationArm),
		[centre.x, imageRect.y, rotationArm],
	);

	const spin = `rotate(${transform.rotation} ${centre.x} ${centre.y})`;

	return (
		<svg
			aria-label="Screenshot placement"
			ref={svgRef}
			viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
			style={{
				width: `${cssWidth}px`,
				height: `${cssHeight}px`,
				position: "absolute",
				top: 0,
				left: 0,
				zIndex: 10,
				// The canvas clips the rendered capture, but not its manipulator: a
				// card dragged half off the edge keeps handles outside the frame,
				// and hiding them would strand it somewhere unreachable.
				overflow: "visible",
				// Transparent to the pointer while a pan is armed, so space+drag
				// reaches the canvas underneath even over the capture.
				pointerEvents: disabled ? "none" : "all",
				cursor:
					activeGesture === "move" ? "grabbing" : hovering ? "move" : undefined,
				touchAction: "none",
			}}
			onPointerLeave={() => setHovering(false)}
			onPointerMove={(event) => {
				// Bounding box, not alpha: a cursor does not need pixel accuracy,
				// and a canvas readback on every pointer move would be a readback
				// on every pointer move.
				if (gestureRef.current) return;
				const svg = svgRef.current;
				if (!svg) return;
				const point = clientToFrame(event.nativeEvent, svg, bounds);
				setHovering(
					point.x >= imageRect.x &&
						point.y >= imageRect.y &&
						point.x <= imageRect.x + imageRect.width &&
						point.y <= imageRect.y + imageRect.height,
				);
			}}
			onPointerDown={(event) => {
				const svg = svgRef.current;
				if (!svg) return;
				const point = clientToFrame(event.nativeEvent, svg, bounds);
				if (
					!hitTestCard(
						cardCanvas,
						point,
						transform,
						laidOutRect,
						{ width: bounds.width, height: bounds.height },
						cssRotation,
					)
				) {
					onMiss(event);
					return;
				}
				// Selecting and moving are the same press: requiring a click to
				// select and then a second drag to move would put the mode back,
				// just spelled differently.
				setCaptureSelected(true);
				beginGesture(event, "move", null);
			}}
		>
			<title>Screenshot placement</title>
			<g transform={spin}>
				{(captureSelected || hovering) && (
					<rect
						x={imageRect.x}
						y={imageRect.y}
						width={imageRect.width}
						height={imageRect.height}
						fill="transparent"
						stroke="#4785FF"
						// Faint while merely hovered: the outline is there to say the
						// capture is grabbable, not to compete with a selection.
						strokeOpacity={captureSelected ? 1 : 0.4}
						strokeWidth={stroke}
						vectorEffect="non-scaling-stroke"
						pointerEvents="none"
					/>
				)}

				{/* Scale and rotate need a selection first. Move does not — that is
				    the one gesture worth having without a click of setup, and
				    showing five handles around an unselected capture would make the
				    canvas noisy for the majority of edits that never touch it. */}
				{captureSelected && (
					<>
						<line
							x1={centre.x}
							y1={imageRect.y}
							x2={rotationHandle.x}
							y2={rotationHandle.y}
							stroke="#4785FF"
							strokeWidth={stroke}
						/>
						<circle
							cx={rotationHandle.x}
							cy={rotationHandle.y}
							r={handleSize / 2}
							fill="#fff"
							stroke="#4785FF"
							strokeWidth={stroke}
							style={{ cursor: "crosshair" }}
							onPointerDown={(event) => beginGesture(event, "rotate", null)}
						/>

						{CORNERS.map((corner) => {
							const point = cornerPoint(imageRect, corner);
							return (
								<rect
									key={corner}
									x={point.x - handleSize / 2}
									y={point.y - handleSize / 2}
									width={handleSize}
									height={handleSize}
									fill="#fff"
									stroke="#4785FF"
									strokeWidth={stroke}
									style={{
										cursor:
											corner === "nw" || corner === "se"
												? "nwse-resize"
												: "nesw-resize",
									}}
									onPointerDown={(event) =>
										beginGesture(event, "scale", corner)
									}
								/>
							);
						})}
					</>
				)}
			</g>
		</svg>
	);
}
