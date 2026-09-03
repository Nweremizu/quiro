// The screenshot as an independently placed layer inside the canvas.
//
// The canvas is a viewport, not a bounding box: it fixes the output size and
// owns the background, and whatever the capture puts outside it is clipped by
// the render target rather than growing the frame. This module is the frontend
// half of `LayerTransform` in `configuration.rs` — the same offset/scale/
// rotation triple, the same clamps, and the same rect maths as
// `frame_layout::transform_rect`, so `getImageRect` predicts where the renderer
// will actually put the capture.
//
// Rotation is deliberately *not* folded into the rect. The renderer carries it
// in the card homography (`perspective.rs`), which leaves offset and scale
// describing an axis-aligned rect that layout, hit-testing and the annotation
// anchor can all still reason about. Everything that needs the rotated shape
// asks for it explicitly, via `rotateFramePoint` or `cardRotationCss`.

import type { LayerTransform } from "@/utils/tauri";
import { type FramePx, framePt, frameRect, type Pt, type Rect } from "./space";

/** Mirrors `MIN_LAYER_SCALE` / `MAX_LAYER_SCALE` / `MAX_LAYER_OFFSET`. */
export const MIN_LAYER_SCALE = 0.05;
export const MAX_LAYER_SCALE = 8;
export const MAX_LAYER_OFFSET = 2;

export const IDENTITY_TRANSFORM: LayerTransform = {
	offset: { x: 0, y: 0 },
	scale: 1,
	rotation: 0,
};

const finite = (value: number, fallback: number) =>
	Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number) =>
	value < min ? min : value > max ? max : value;

/** The transform the renderer will actually use. Applied on the way *out* of
 * a gesture as well as on the way in, so what the preview draws and what the
 * config stores can never disagree about a clamped value. */
export const clampTransform = (transform: LayerTransform): LayerTransform => ({
	offset: {
		x: clamp(
			finite(transform.offset.x, 0),
			-MAX_LAYER_OFFSET,
			MAX_LAYER_OFFSET,
		),
		y: clamp(
			finite(transform.offset.y, 0),
			-MAX_LAYER_OFFSET,
			MAX_LAYER_OFFSET,
		),
	},
	scale: clamp(finite(transform.scale, 1), MIN_LAYER_SCALE, MAX_LAYER_SCALE),
	rotation: finite(transform.rotation, 0) % 360,
});

export const isIdentityTransform = (transform: LayerTransform) =>
	transform.offset.x === 0 &&
	transform.offset.y === 0 &&
	transform.scale === 1 &&
	transform.rotation === 0;

/** The transform to apply, or `null` when there is nothing to apply — the
 * signal to take the untransformed path rather than multiply by an identity.
 * Mirrors `frame_layout::display_transform`. */
export function resolveTransform(
	transform: LayerTransform | null | undefined,
): LayerTransform | null {
	if (!transform) return null;
	const clamped = clampTransform(transform);
	return isIdentityTransform(clamped) ? null : clamped;
}

/**
 * Moves and scales a laid-out rect by a layer transform — the mirror of
 * `frame_layout::transform_rect`.
 *
 * Scale is about the rect's own centre so the capture grows in place rather
 * than walking toward the frame origin, and the offset is a fraction of the
 * canvas so it means the same thing at preview resolution and at export.
 */
export function transformRect(
	rect: Rect<FramePx>,
	transform: LayerTransform,
	canvas: { width: number; height: number },
): Rect<FramePx> {
	const width = rect.width * transform.scale;
	const height = rect.height * transform.scale;
	const centreX = rect.x + rect.width / 2 + transform.offset.x * canvas.width;
	const centreY = rect.y + rect.height / 2 + transform.offset.y * canvas.height;
	return frameRect(centreX - width / 2, centreY - height / 2, width, height);
}

/** Frame-space rect in either form. The branded `Rect<FramePx>` is what this
 * module produces, but the annotation layer carries the same pixels in a plain
 * struct, and both need the card's centre. */
type FrameRectLike = { x: number; y: number; width: number; height: number };

export const rectCentre = (rect: FrameRectLike): Pt<FramePx> =>
	framePt(rect.x + rect.width / 2, rect.y + rect.height / 2);

/** Spins a frame-space point about `centre`. `degrees` is the card's own
 * rotation for going with the card, and its negation for going against it —
 * which is how pointer input gets back into the capture's unrotated space. */
export function rotateFramePoint(
	point: Pt<FramePx>,
	centre: Pt<FramePx>,
	degrees: number,
): Pt<FramePx> {
	if (degrees === 0) return point;
	const radians = (degrees * Math.PI) / 180;
	const sin = Math.sin(radians);
	const cos = Math.cos(radians);
	const dx = point.x - centre.x;
	const dy = point.y - centre.y;
	return framePt(
		centre.x + dx * cos - dy * sin,
		centre.y + dx * sin + dy * cos,
	);
}

/** An SVG/CSS `rotate(deg cx cy)` for the card, or `undefined` when flat so
 * the element keeps no transform at all rather than an identity one — a
 * transformed SVG group is promoted to its own layer by some compositors even
 * when the matrix is the identity. */
export function cardRotationTransform(
	rotationDegrees: number,
	rect: FrameRectLike,
): string | undefined {
	if (rotationDegrees === 0) return undefined;
	const centre = rectCentre(rect);
	return `rotate(${rotationDegrees} ${centre.x} ${centre.y})`;
}

/** The offset that lands the card's centre on a given frame-space point,
 * expressed in the canvas fractions the config stores. The gizmo works in
 * frame pixels throughout a gesture and crosses back here exactly once, on
 * commit, so a drag never accumulates conversion error. */
export function offsetForCentre(
	centre: Pt<FramePx>,
	laidOutCentre: Pt<FramePx>,
	canvas: { width: number; height: number },
): { x: number; y: number } {
	return {
		x: (centre.x - laidOutCentre.x) / Math.max(1, canvas.width),
		y: (centre.y - laidOutCentre.y) / Math.max(1, canvas.height),
	};
}

/**
 * Whether the capture is tilted out of the screen plane.
 *
 * The mirror of `frame_layout::card_is_tilted`, and it has to stay one: it
 * decides which side of the boundary owns the rotation. A flat card is spun by
 * the browser, so a rotation gesture never reaches the renderer; a tilted one
 * is spun by the renderer, because it folds spin *into* the tilt and rotating
 * an already-tilted image in screen space is a different picture.
 */
export const cardIsTilted = (
	perspective: { tiltX: number; tiltY: number } | null | undefined,
) => !!perspective && (perspective.tiltX !== 0 || perspective.tiltY !== 0);

/**
 * How the split preview places the capture's layer over the canvas layer.
 *
 * The renderer hands over a card image drawn where layout alone would put it,
 * at the canvas's own size, so the two layers stack without measurement and
 * everything the transform does is expressed here — which is what makes a drag
 * cost a compositor transform rather than a GPU render and a frame over a
 * socket.
 *
 * CSS applies transforms right to left, so this reads as: spin about the card's
 * centre, scale about the same point, then translate. That is the order
 * `display_layout` uses, which is why the two agree.
 */
export function cardLayerPlacement(
	transform: LayerTransform | null,
	laidOutRect: FrameRectLike,
	frameSize: { width: number; height: number },
	cssSize: { width: number; height: number },
	rotateInCss: boolean,
	/** Extra pixels the card layer carries on every side so its shadow is
	 * complete. The layer is that much larger than the canvas and hangs over
	 * each edge, so its own centre is offset from the canvas's by this much. */
	bleed = 0,
): {
	transform: string | undefined;
	transformOrigin: string;
	inset: { left: number; top: number; width: number; height: number };
} {
	const centre = rectCentre(laidOutRect);
	const scale = cssSize.width / Math.max(1, frameSize.width);
	const bleedCss = bleed * scale;

	// The layer is positioned by its own box, which is the canvas grown by the
	// bleed on every side. Everything below is measured in that box, not the
	// canvas — including the origin, which is the card's centre and has to
	// account for the card sitting `bleed` further in.
	const inset = {
		left: -bleedCss,
		top: -bleedCss,
		width: cssSize.width + bleedCss * 2,
		height: cssSize.height + bleedCss * 2,
	};

	// A percentage origin, so it survives the viewport zoom rescaling the
	// element underneath it without being recomputed.
	const transformOrigin = `${
		((centre.x + bleed) / Math.max(1, frameSize.width + bleed * 2)) * 100
	}% ${((centre.y + bleed) / Math.max(1, frameSize.height + bleed * 2)) * 100}%`;

	if (!transform) return { transform: undefined, transformOrigin, inset };

	const rotation = rotateInCss ? transform.rotation : 0;
	const parts = [
		`translate(${transform.offset.x * cssSize.width}px, ${
			transform.offset.y * cssSize.height
		}px)`,
		`scale(${transform.scale})`,
		...(rotation === 0 ? [] : [`rotate(${rotation}deg)`]),
	];

	return { transform: parts.join(" "), transformOrigin, inset };
}

/**
 * Maps a frame-space point back into the capture's own untransformed space.
 *
 * The inverse of what `cardLayerPlacement` hands the browser, and it has to be
 * — the rendered capture only exists untransformed (that is the whole point of
 * the split), so any question about *which pixel of the capture* a pointer is
 * over has to be asked there.
 *
 * `cssRotation` rather than the transform's own: when the capture is tilted the
 * renderer has already baked the spin into the image, so the browser applies
 * none and neither does this. See `cardIsTilted`.
 */
export function frameToCardPoint(
	point: { x: number; y: number },
	transform: LayerTransform | null,
	laidOutRect: FrameRectLike,
	canvas: { width: number; height: number },
	cssRotation: number,
): Pt<FramePx> {
	if (!transform) return framePt(point.x, point.y);

	const centre = rectCentre(laidOutRect);
	const dx = point.x - transform.offset.x * canvas.width - centre.x;
	const dy = point.y - transform.offset.y * canvas.height - centre.y;

	const radians = (-cssRotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const scale = transform.scale === 0 ? 1 : transform.scale;

	return framePt(
		centre.x + (dx * cos - dy * sin) / scale,
		centre.y + (dx * sin + dy * cos) / scale,
	);
}

/** Alpha below this reads as "not the capture". Not zero: the card's edge is
 * antialiased and its shadow fades out over a wide, mostly-empty region, and
 * treating the faintest tail of a shadow as a grab target makes the capture
 * feel like it has a halo you keep catching on. */
const CARD_HIT_ALPHA = 24;

/**
 * Whether a frame-space point is on the capture itself.
 *
 * Reads the rendered alpha rather than testing the bounding box, so a click in
 * the empty corner of a rotated card, or in the gap a transparent screenshot
 * leaves, falls through to whatever is behind it — which is what makes the
 * capture feel like an object rather than a rectangle.
 */
export function hitTestCard(
	cardCanvas: HTMLCanvasElement | null,
	point: { x: number; y: number },
	transform: LayerTransform | null,
	laidOutRect: FrameRectLike,
	canvas: { width: number; height: number },
	cssRotation: number,
): boolean {
	if (!cardCanvas || cardCanvas.width === 0) return false;

	const local = frameToCardPoint(
		point,
		transform,
		laidOutRect,
		canvas,
		cssRotation,
	);
	const x = Math.floor(local.x);
	const y = Math.floor(local.y);
	if (x < 0 || y < 0 || x >= cardCanvas.width || y >= cardCanvas.height)
		return false;

	// `willReadFrequently` keeps this on a CPU-backed surface: without it a
	// readback per press stalls on a GPU round trip, and the press is the one
	// moment a gesture cannot afford a hitch.
	const ctx = cardCanvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return false;

	try {
		return ctx.getImageData(x, y, 1, 1).data[3] > CARD_HIT_ALPHA;
	} catch {
		// A tainted canvas would throw. Nothing here is cross-origin, but a
		// failed probe should fall through to the background rather than trap
		// the pointer.
		return false;
	}
}
