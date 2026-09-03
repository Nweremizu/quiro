// Coordinate spaces, as types.
//
// The Rust renderer already models this properly. `rendering/src/coord.rs`
// declares `RawDisplaySpace`, `CroppedDisplaySpace`, `FrameSpace` and
// `ZoomedFrameSpace` as distinct types behind a `Coord<TSpace>`, so a value
// from one space cannot be passed where another is wanted and the conversions
// are the only way across.
//
// The TypeScript half of the same pipeline had none of that: every position
// was a bare `number`, and at least four spaces are live in this editor. They
// were mixed inside a single struct — `Annotation.x/y/width/height` are frame
// pixels while `Annotation.focus.{x,y}` on the very same record is normalized
// 0..1 — with the distinction recorded only in a comment.
//
// Brands are erased at runtime: `FramePx` is `number` once compiled, so this
// costs nothing in the bundle and nothing at execution. What it buys is that
// the constructors below are the only places a raw `number` becomes a spaced
// value, which makes every entry point greppable and every conversion checked.

declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

/** Viewport pixels — `event.clientX/Y`. Only ever an input. */
export type ClientPx = Branded<number, "client">;

/** Pixels in the rendered output frame, which is the SVG's viewBox space.
 * Recomputed from scratch whenever padding, crop or aspect ratio changes, so
 * nothing durable should be stored in it. */
export type FramePx = Branded<number, "frame">;

/** 0..1 across the capture itself — the screenshot content, not the frame
 * around it. Survives a change of padding, crop, aspect ratio or output size.
 * This is `AnnotationAnchor::Capture` in `configuration.rs`; the anchor rect it
 * is measured against is `getImageRect`'s result. */
export type CaptureNorm = Branded<number, "capture-norm">;

/** 0..1 across the padded output frame. Survives output size, but *not* a
 * change of padding or aspect — an object anchored here is pinned to the frame,
 * so the capture moving inside it is exactly what you want to ignore. This is
 * `AnnotationAnchor::Canvas`. */
export type CanvasNorm = Branded<number, "canvas-norm">;

/** Any of the normalized spaces. Conversions are written against this so the
 * two anchors share one implementation without being interchangeable. */
export type Norm = CaptureNorm | CanvasNorm;

export type Pt<U> = { x: U; y: U };
export type Rect<U> = { x: U; y: U; width: U; height: U };

// --- constructors --------------------------------------------------------
//
// The only sanctioned way from `number` into a space. Deliberately unchecked:
// they assert intent, they do not validate. Clamping is a separate decision
// and has its own helper below.

export const clientPx = (n: number) => n as ClientPx;
export const framePx = (n: number) => n as FramePx;
export const captureNorm = (n: number) => n as CaptureNorm;
export const canvasNorm = (n: number) => n as CanvasNorm;

export const framePt = (x: number, y: number): Pt<FramePx> => ({
	x: framePx(x),
	y: framePx(y),
});

export const frameRect = (
	x: number,
	y: number,
	width: number,
	height: number,
): Rect<FramePx> => ({
	x: framePx(x),
	y: framePx(y),
	width: framePx(width),
	height: framePx(height),
});

/** Normalized values are only meaningful in 0..1; anything outside is an
 * object dragged off its anchor. Callers decide whether that is legal —
 * masks clamp, free-floating shapes do not. */
export const clampNorm = <U extends Norm>(n: number): U =>
	(n < 0 ? 0 : n > 1 ? 1 : n) as U;

// --- conversions ---------------------------------------------------------
//
// Every normalized space is defined against some rect in frame space: the
// image rect for `CaptureNorm`, the frame bounds for `CanvasNorm`. The maths is
// therefore one implementation, exposed twice with different brands so the
// two cannot be crossed by accident.
//
// `layout.ts` already guards its divisors with `Math.max(1, …)` because the
// image rect is legitimately zero-sized during first layout, before the
// renderer has reported a frame. These do the same rather than emitting
// Infinity into the annotation list.

const span = (n: number) => (n > 1 ? n : 1);

function toNorm<U extends Norm>(p: Pt<FramePx>, ref: Rect<FramePx>): Pt<U> {
	return {
		x: ((p.x - ref.x) / span(ref.width)) as U,
		y: ((p.y - ref.y) / span(ref.height)) as U,
	};
}

function fromNorm<U extends Norm>(p: Pt<U>, ref: Rect<FramePx>): Pt<FramePx> {
	return framePt(ref.x + p.x * span(ref.width), ref.y + p.y * span(ref.height));
}

function rectToNorm<U extends Norm>(
	r: Rect<FramePx>,
	ref: Rect<FramePx>,
): Rect<U> {
	const origin = toNorm<U>({ x: r.x, y: r.y }, ref);
	return {
		x: origin.x,
		y: origin.y,
		// Extents are differences, not positions, so they scale without the
		// origin shift — and stay signed, because a shape dragged right-to-left
		// legitimately has negative width until it is normalised on commit.
		width: (r.width / span(ref.width)) as U,
		height: (r.height / span(ref.height)) as U,
	};
}

function rectFromNorm<U extends Norm>(
	r: Rect<U>,
	ref: Rect<FramePx>,
): Rect<FramePx> {
	const origin = fromNorm(r, ref);
	return {
		x: origin.x,
		y: origin.y,
		width: framePx(r.width * span(ref.width)),
		height: framePx(r.height * span(ref.height)),
	};
}

/** Frame px → 0..1 across the capture. `imageRect` comes from `getImageRect`
 * in `layout.ts` — named for the image it bounds, but it *is* the capture rect
 * that `AnnotationAnchor::Capture` is defined against. */
export const frameToCaptureNorm = (p: Pt<FramePx>, imageRect: Rect<FramePx>) =>
	toNorm<CaptureNorm>(p, imageRect);

export const captureNormToFrame = (
	p: Pt<CaptureNorm>,
	imageRect: Rect<FramePx>,
) => fromNorm(p, imageRect);

export const frameRectToCaptureNorm = (
	r: Rect<FramePx>,
	imageRect: Rect<FramePx>,
) => rectToNorm<CaptureNorm>(r, imageRect);

export const captureNormRectToFrame = (
	r: Rect<CaptureNorm>,
	imageRect: Rect<FramePx>,
) => rectFromNorm(r, imageRect);

/** Frame px → 0..1 across the padded output frame. `bounds` is the frame
 * itself, so this is usually a plain divide — but it is written against the
 * same rect form so a future inset or letterbox needs no new call site. */
export const frameToCanvasNorm = (p: Pt<FramePx>, bounds: Rect<FramePx>) =>
	toNorm<CanvasNorm>(p, bounds);

export const canvasNormToFrame = (p: Pt<CanvasNorm>, bounds: Rect<FramePx>) =>
	fromNorm(p, bounds);

export const frameRectToCanvasNorm = (
	r: Rect<FramePx>,
	bounds: Rect<FramePx>,
) => rectToNorm<CanvasNorm>(r, bounds);

export const canvasNormRectToFrame = (
	r: Rect<CanvasNorm>,
	bounds: Rect<FramePx>,
) => rectFromNorm(r, bounds);

/**
 * Viewport coords → frame px, via the SVG's on-screen box.
 *
 * The element is laid out at whatever size the pan/zoom viewport gives it
 * while its viewBox stays in frame pixels, so the ratio between the two is
 * the scale factor. This is the sole entry point for pointer input.
 *
 * `unrotate` undoes the capture's own in-plane rotation about the given
 * centre. Content drawn on top of a rotated capture is rendered inside a
 * matching rotated group, so a pointer landing on it has to come back through
 * the same rotation before it means anything to geometry expressed in the
 * capture's unrotated frame — which is all of it. Omitted (or zero degrees)
 * this is the pre-rotation path, unchanged.
 */
export function clientToFrame(
	event: { clientX: number; clientY: number },
	svg: SVGSVGElement,
	bounds: Rect<FramePx>,
	unrotate?: { degrees: number; centre: Pt<FramePx> },
): Pt<FramePx> {
	const box = svg.getBoundingClientRect();
	const point = framePt(
		bounds.x + ((event.clientX - box.left) / span(box.width)) * bounds.width,
		bounds.y + ((event.clientY - box.top) / span(box.height)) * bounds.height,
	);

	if (!unrotate || unrotate.degrees === 0) return point;

	const radians = (-unrotate.degrees * Math.PI) / 180;
	const sin = Math.sin(radians);
	const cos = Math.cos(radians);
	const dx = point.x - unrotate.centre.x;
	const dy = point.y - unrotate.centre.y;
	return framePt(
		unrotate.centre.x + dx * cos - dy * sin,
		unrotate.centre.y + dx * sin + dy * cos,
	);
}

// --- the annotation storage boundary --------------------------------------
//
// Stored annotations are normalized to their anchor (`annotationSpaceVersion`
// 1); the interaction layer — hit-testing, drag, resize, snapping, arrow
// geometry — works in frame pixels and stays that way. These two functions are
// the only crossing, applied once on the way out of storage and once on the
// way back in, so a gesture runs entirely in one space.
//
// They mirror `ProjectConfiguration::migrate_annotation_space` in
// `configuration.rs` field for field. If one changes, the other must.

/** Fields that are lengths along a single axis rather than positions. Stroke
 * width is normalized against height only: against both axes it would change
 * thickness whenever the aspect ratio did. */
const resolveAxial = (value: number, anchor: Rect<FramePx>) =>
	value * anchor.height;
const normalizeAxial = (value: number, anchor: Rect<FramePx>) =>
	value / span(anchor.height);

export function resolveAnnotation<A extends AnnotationGeometry>(
	a: A,
	anchor: Rect<FramePx>,
): A {
	return {
		...a,
		x: anchor.x + a.x * span(anchor.width),
		y: anchor.y + a.y * span(anchor.height),
		width: a.width * span(anchor.width),
		height: a.height * span(anchor.height),
		strokeWidth: resolveAxial(a.strokeWidth, anchor),
		...(a.arrowHeadSize != null
			? { arrowHeadSize: resolveAxial(a.arrowHeadSize, anchor) }
			: {}),
	};
}

export function normalizeAnnotation<A extends AnnotationGeometry>(
	a: A,
	anchor: Rect<FramePx>,
): A {
	return {
		...a,
		x: (a.x - anchor.x) / span(anchor.width),
		y: (a.y - anchor.y) / span(anchor.height),
		width: a.width / span(anchor.width),
		height: a.height / span(anchor.height),
		strokeWidth: normalizeAxial(a.strokeWidth, anchor),
		...(a.arrowHeadSize != null
			? { arrowHeadSize: normalizeAxial(a.arrowHeadSize, anchor) }
			: {}),
	};
}

/** The subset of `Annotation` these two touch. Structural rather than the
 * imported type, so `space.ts` stays free of a `@/utils/tauri` dependency and
 * the check file can exercise it without the generated bindings. */
export type AnnotationGeometry = {
	x: number;
	y: number;
	width: number;
	height: number;
	strokeWidth: number;
	arrowHeadSize?: number | null;
};
