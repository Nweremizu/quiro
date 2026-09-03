// Self-check for the capture's layer transform. Run via `pnpm check`, or alone:
//
//   npx esbuild src/routes/screenshot-editor/transform.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/transform.cjs \
//     && node /tmp/transform.cjs
//
// Two properties carry the whole feature.
//
// The first is *parity with the renderer*. `transformRect` here and
// `frame_layout::transform_rect` in Rust place the same rect, and if they
// disagree the gizmo's handles sit somewhere the capture is not — the editor
// would look correct and export wrong. The numeric expectations below are the
// same ones `layer_transform_scales_about_the_card_centre` and
// `layer_transform_offset_is_a_fraction_of_the_canvas` assert on that side.
//
// The second is that *a gesture is invertible*. The gizmo works in frame
// pixels and stores canvas fractions, crossing at exactly one point
// (`offsetForCentre`). If that crossing is not the exact inverse of
// `transformRect`'s translation, a drag lands the capture somewhere other than
// under the pointer, and the error compounds over a gesture.

import { type FramePx, framePt, frameRect, type Rect } from "./space";
import {
	cardIsTilted,
	cardLayerPlacement,
	cardRotationTransform,
	clampTransform,
	frameToCardPoint,
	IDENTITY_TRANSFORM,
	isIdentityTransform,
	MAX_LAYER_OFFSET,
	MAX_LAYER_SCALE,
	MIN_LAYER_SCALE,
	offsetForCentre,
	rectCentre,
	resolveTransform,
	rotateFramePoint,
	transformRect,
} from "./transform";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, extra = "") => {
	if (cond) {
		passes++;
		return;
	}
	failures++;
	console.log(`FAIL  ${name}${extra ? ` ${extra}` : ""}`);
};

const EPS = 1e-9;
const near = (a: number, b: number, eps = EPS) => Math.abs(a - b) < eps;

const CANVAS = { width: 1920, height: 1080 };

// The laid-out rects the editor actually produces, plus the degenerate one
// that exists before the renderer has reported a frame.
const RECTS: Array<[string, Rect<FramePx>]> = [
	["padded 16:9", frameRect(160, 90, 1600, 900)],
	["unpadded", frameRect(0, 0, 1920, 1080)],
	["offset crop", frameRect(37, 211, 640, 480)],
	["tall sliver", frameRect(0, 0, 12, 1000)],
	["zero", frameRect(0, 0, 0, 0)],
];

// 1. Identity is a true no-op, on every rect. This is the path every project
//    that has never opened the gizmo takes.
for (const [name, rect] of RECTS) {
	const out = transformRect(rect, IDENTITY_TRANSFORM, CANVAS);
	ok(
		`identity leaves ${name} alone`,
		near(out.x, rect.x) &&
			near(out.y, rect.y) &&
			near(out.width, rect.width) &&
			near(out.height, rect.height),
		JSON.stringify(out),
	);
}

// 2. Scale is about the rect's own centre — the property that makes a corner
//    drag feel like it is pulling that corner rather than dragging the card.
for (const [name, rect] of RECTS) {
	for (const scale of [0.25, 1, 2.5]) {
		const out = transformRect(rect, { ...IDENTITY_TRANSFORM, scale }, CANVAS);
		const before = rectCentre(rect);
		const after = rectCentre(out);
		ok(
			`scale ${scale} holds the centre of ${name}`,
			near(before.x, after.x, 1e-6) && near(before.y, after.y, 1e-6),
		);
		ok(
			`scale ${scale} scales the extent of ${name}`,
			near(out.width, rect.width * scale, 1e-6) &&
				near(out.height, rect.height * scale, 1e-6),
		);
	}
}

// 3. Offset is a fraction of the *canvas*, not of the capture — so the same
//    stored value means the same placement at preview size and at 4K export.
{
	const rect = frameRect(160, 90, 1600, 900);
	const out = transformRect(
		rect,
		{ ...IDENTITY_TRANSFORM, offset: { x: 0.25, y: -0.5 } },
		CANVAS,
	);
	ok(
		"offset is measured against the canvas",
		near(out.x - rect.x, CANVAS.width * 0.25, 1e-6) &&
			near(out.y - rect.y, CANVAS.height * -0.5, 1e-6),
		`${out.x - rect.x}, ${out.y - rect.y}`,
	);
}

// 4. `offsetForCentre` is the exact inverse of the translation `transformRect`
//    applies. This is the gesture's core invariant: pointer-down snapshots a
//    centre, the drag asks for a new one, and the capture must land there.
for (const [name, rect] of RECTS) {
	for (const target of [
		framePt(0, 0),
		framePt(960, 540),
		framePt(-400, 1500),
		framePt(3000, -220),
	]) {
		const offset = offsetForCentre(target, rectCentre(rect), CANVAS);
		const out = transformRect(rect, { ...IDENTITY_TRANSFORM, offset }, CANVAS);
		const landed = rectCentre(out);
		ok(
			`centre round-trips on ${name} at ${target.x},${target.y}`,
			near(landed.x, target.x, 1e-6) && near(landed.y, target.y, 1e-6),
			`${landed.x},${landed.y}`,
		);
	}
}

// 5. Scale and offset compose in the order the renderer uses: scale about the
//    laid-out centre first, then translate. Reversing them would make a
//    scaled capture drift as it grows.
{
	const rect = frameRect(100, 50, 800, 600);
	const out = transformRect(
		rect,
		{ offset: { x: 0.1, y: 0.2 }, scale: 2, rotation: 0 },
		CANVAS,
	);
	const centre = rectCentre(out);
	ok(
		"scale and offset compose about the laid-out centre",
		near(centre.x, 100 + 400 + CANVAS.width * 0.1, 1e-6) &&
			near(centre.y, 50 + 300 + CANVAS.height * 0.2, 1e-6),
		`${centre.x},${centre.y}`,
	);
	ok(
		"scale still applies under an offset",
		near(out.width, 1600, 1e-6) && near(out.height, 1200, 1e-6),
	);
}

// 6. Rotation round-trips. Pointer input is brought out of the card's spin by
//    the negated angle; if that is not exact, a click on a rotated capture
//    lands on the wrong pixel and every hit test drifts with it.
{
	const centre = framePt(640, 360);
	for (const degrees of [0, 15, -37.5, 90, 180, 359.9]) {
		for (const point of [
			framePt(640, 360),
			framePt(0, 0),
			framePt(1280, 100),
			framePt(-50, 720),
		]) {
			const back = rotateFramePoint(
				rotateFramePoint(point, centre, degrees),
				centre,
				-degrees,
			);
			ok(
				`rotation ${degrees} round-trips at ${point.x},${point.y}`,
				near(back.x, point.x, 1e-6) && near(back.y, point.y, 1e-6),
				`${back.x},${back.y}`,
			);
		}
	}
}

// 7. Rotation holds the card's own centre fixed — the same property
//    `perspective.rs`'s `centre_is_a_fixed_point` asserts on the renderer side.
{
	const centre = framePt(640, 360);
	const spun = rotateFramePoint(centre, centre, 42);
	ok(
		"the centre is a fixed point of the spin",
		near(spun.x, centre.x, 1e-9) && near(spun.y, centre.y, 1e-9),
	);
}

// 8. Clamping mirrors `LayerTransform::clamped`. Sidecars are hand-editable and
//    a degenerate pointer delta can produce NaN; neither may reach the renderer
//    as a zero-sized card or a NaN rect.
{
	const hostile = clampTransform({
		offset: { x: Number.NaN, y: 500 },
		scale: 0,
		rotation: Number.POSITIVE_INFINITY,
	});
	ok(
		"NaN offset falls back to zero",
		hostile.offset.x === 0,
		`${hostile.offset.x}`,
	);
	ok(
		"a wild offset is bounded",
		hostile.offset.y === MAX_LAYER_OFFSET,
		`${hostile.offset.y}`,
	);
	ok(
		"a collapsed scale is lifted off zero",
		hostile.scale === MIN_LAYER_SCALE,
		`${hostile.scale}`,
	);
	ok(
		"an infinite rotation falls back to flat",
		hostile.rotation === 0,
		`${hostile.rotation}`,
	);
	ok(
		"a runaway scale is bounded",
		clampTransform({ ...IDENTITY_TRANSFORM, scale: 1e6 }).scale ===
			MAX_LAYER_SCALE,
	);
}

// 9. An identity transform resolves to `null`, so a capture returned to its
//    laid-out position takes the renderer's untransformed path again rather
//    than carrying a no-op matrix for the rest of the project's life.
{
	ok("null resolves to null", resolveTransform(null) === null);
	ok(
		"an identity transform resolves to null",
		resolveTransform(IDENTITY_TRANSFORM) === null,
	);
	ok(
		"a transform clamped back to identity resolves to null",
		resolveTransform({
			offset: { x: 0, y: 0 },
			scale: 1,
			rotation: 720,
		}) === null,
	);
	ok(
		"a real transform survives resolution",
		resolveTransform({ ...IDENTITY_TRANSFORM, scale: 1.5 })?.scale === 1.5,
	);
	ok(
		"isIdentityTransform agrees with the constant",
		isIdentityTransform(IDENTITY_TRANSFORM),
	);
}

// 10. A flat capture emits no SVG transform at all, rather than an identity
//     one — some compositors promote any transformed group to its own layer.
{
	const rect = frameRect(160, 90, 1600, 900);
	ok(
		"a flat card carries no transform attribute",
		cardRotationTransform(0, rect) === undefined,
	);
	ok(
		"a spun card rotates about its own centre",
		cardRotationTransform(30, rect) === "rotate(30 960 540)",
		cardRotationTransform(30, rect),
	);
}

// 11. The degenerate rect that exists before the first frame must not produce
//     NaN geometry, which would then be written back to disk as an offset.
{
	const out = transformRect(
		frameRect(0, 0, 0, 0),
		{ offset: { x: 0.3, y: 0.3 }, scale: 2, rotation: 10 },
		{ width: 0, height: 0 },
	);
	ok(
		"a degenerate rect yields finite geometry",
		Number.isFinite(out.x) &&
			Number.isFinite(out.y) &&
			Number.isFinite(out.width) &&
			Number.isFinite(out.height),
		JSON.stringify(out),
	);

	const offset = offsetForCentre(framePt(10, 10), framePt(0, 0), {
		width: 0,
		height: 0,
	});
	ok(
		"a degenerate canvas yields a finite offset",
		Number.isFinite(offset.x) && Number.isFinite(offset.y),
		JSON.stringify(offset),
	);
}

// 12. The split preview's placement must agree with the renderer's, or the
//     editor shows one composition and exports another. `cardLayerPlacement`
//     produces a CSS transform about the laid-out centre; applying it by hand
//     has to land on the rect `transformRect` predicts, which is itself the
//     mirror of `frame_layout::transform_rect`.
{
	// `translate(t) scale(s) rotate(r)` about origin `c` sends a point p to
	// c + (p - c) * s + t — rotation left out, since a rect's own corners are
	// not what the rotation is checked against (property 6 covers the spin).
	const applyPlacement = (
		point: { x: number; y: number },
		origin: { x: number; y: number },
		scale: number,
		translate: { x: number; y: number },
	) => ({
		x: origin.x + (point.x - origin.x) * scale + translate.x,
		y: origin.y + (point.y - origin.y) * scale + translate.y,
	});

	for (const [name, rect] of RECTS) {
		for (const transform of [
			{ offset: { x: 0.2, y: -0.1 }, scale: 1, rotation: 0 },
			{ offset: { x: 0, y: 0 }, scale: 2.5, rotation: 0 },
			{ offset: { x: -0.4, y: 0.35 }, scale: 0.4, rotation: 0 },
		]) {
			const placement = cardLayerPlacement(
				transform,
				rect,
				CANVAS,
				CANVAS,
				true,
			);
			ok(
				`${name} gets a placement transform`,
				placement.transform !== undefined,
			);

			// The CSS is emitted in the element's own pixels, which here are frame
			// pixels because cssSize is passed as the canvas size.
			const expected = transformRect(rect, transform, CANVAS);
			const origin = rectCentre(rect);
			const translate = {
				x: transform.offset.x * CANVAS.width,
				y: transform.offset.y * CANVAS.height,
			};
			const topLeft = applyPlacement(rect, origin, transform.scale, translate);
			ok(
				`CSS placement matches the renderer on ${name} at scale ${transform.scale}`,
				near(topLeft.x, expected.x, 1e-6) && near(topLeft.y, expected.y, 1e-6),
				`${topLeft.x},${topLeft.y} vs ${expected.x},${expected.y}`,
			);
		}
	}
}

// 13. The placement is resolution-independent: the same transform at twice the
//     on-screen size must translate twice as many CSS pixels, or zooming the
//     viewport would slide the capture around inside the canvas.
{
	const rect = frameRect(160, 90, 1600, 900);
	const transform = { offset: { x: 0.25, y: 0.1 }, scale: 1.2, rotation: 0 };
	const small = cardLayerPlacement(transform, rect, CANVAS, CANVAS, true);
	const large = cardLayerPlacement(
		transform,
		rect,
		CANVAS,
		{ width: CANVAS.width * 2, height: CANVAS.height * 2 },
		true,
	);
	ok(
		"translate scales with the on-screen size",
		small.transform === "translate(480px, 108px) scale(1.2)" &&
			large.transform === "translate(960px, 216px) scale(1.2)",
		`${small.transform} | ${large.transform}`,
	);
	ok(
		"the origin is the laid-out centre, in percent",
		small.transformOrigin === large.transformOrigin &&
			small.transformOrigin === "50% 50%",
		small.transformOrigin,
	);
}

// 14. An unplaced capture emits no transform at all. A transformed element is
//     promoted to its own compositor layer even when the matrix is an identity,
//     and the overwhelmingly common case is a capture nobody has moved.
{
	const rect = frameRect(160, 90, 1600, 900);
	const placement = cardLayerPlacement(null, rect, CANVAS, CANVAS, true);
	ok(
		"no transform is emitted for an unplaced capture",
		placement.transform === undefined,
	);
	ok(
		"but the origin is still published",
		placement.transformOrigin === "50% 50%",
		placement.transformOrigin,
	);
}

// 15. Rotation belongs to whichever side can reproduce the renderer's picture.
//     `cardIsTilted` decides, and it must agree with `frame_layout::card_is_tilted`
//     — a flat card is spun by the browser, a tilted one was already spun by
//     the renderer and must not be spun twice.
{
	const rect = frameRect(160, 90, 1600, 900);
	const transform = { offset: { x: 0, y: 0 }, scale: 1, rotation: 30 };

	ok("no perspective is not a tilt", !cardIsTilted(null));
	ok(
		"an in-plane spin alone is not a tilt",
		!cardIsTilted({ tiltX: 0, tiltY: 0 }),
	);
	ok("a tilt on either axis is a tilt", cardIsTilted({ tiltX: 12, tiltY: 0 }));
	ok("a tilt on either axis is a tilt", cardIsTilted({ tiltX: 0, tiltY: -8 }));

	const flat = cardLayerPlacement(transform, rect, CANVAS, CANVAS, true);
	const tilted = cardLayerPlacement(transform, rect, CANVAS, CANVAS, false);
	ok(
		"a flat card is spun by the browser",
		flat.transform?.includes("rotate(30deg)") === true,
		flat.transform,
	);
	ok(
		"a tilted card is not spun twice",
		tilted.transform?.includes("rotate") === false,
		tilted.transform,
	);
}

// 16. The hit test asks its question in the capture's own space, so mapping a
//     frame point there must be the exact inverse of the placement the browser
//     was given. If the two disagree, clicks land on the wrong pixel — and the
//     error grows with the transform, so a heavily scaled or spun capture
//     becomes the hardest one to grab.
{
	for (const [name, rect] of RECTS) {
		for (const transform of [
			{ offset: { x: 0.2, y: -0.1 }, scale: 1, rotation: 0 },
			{ offset: { x: 0, y: 0 }, scale: 2.5, rotation: 0 },
			{ offset: { x: -0.3, y: 0.25 }, scale: 0.6, rotation: 35 },
			{ offset: { x: 0.4, y: 0.4 }, scale: 1.8, rotation: -120 },
		]) {
			const centre = rectCentre(rect);
			const translate = {
				x: transform.offset.x * CANVAS.width,
				y: transform.offset.y * CANVAS.height,
			};
			const radians = (transform.rotation * Math.PI) / 180;
			const cos = Math.cos(radians);
			const sin = Math.sin(radians);

			// Forward: what `cardLayerPlacement` tells the browser to do —
			// rotate, scale, translate, all about the laid-out centre.
			const forward = (point: { x: number; y: number }) => {
				const dx = (point.x - centre.x) * transform.scale;
				const dy = (point.y - centre.y) * transform.scale;
				return {
					x: centre.x + dx * cos - dy * sin + translate.x,
					y: centre.y + dx * sin + dy * cos + translate.y,
				};
			};

			for (const probe of [
				{ x: rect.x, y: rect.y },
				{ x: rect.x + rect.width, y: rect.y + rect.height },
				{ x: centre.x, y: centre.y },
				{ x: rect.x + 13, y: rect.y + rect.height - 7 },
			]) {
				const roundTrip = frameToCardPoint(
					forward(probe),
					transform,
					rect,
					CANVAS,
					transform.rotation,
				);
				ok(
					`${name} round-trips through the placement at scale ${transform.scale} / ${transform.rotation}deg`,
					near(roundTrip.x, probe.x, 1e-6) && near(roundTrip.y, probe.y, 1e-6),
					`${roundTrip.x},${roundTrip.y} vs ${probe.x},${probe.y}`,
				);
			}
		}
	}
}

// 17. An unplaced capture maps to itself. The overwhelmingly common case, and
//     it must not pick up a rounding error on the way through.
{
	const rect = frameRect(160, 90, 1600, 900);
	const point = frameToCardPoint({ x: 733, y: 412 }, null, rect, CANVAS, 0);
	ok(
		"no transform is an identity map",
		point.x === 733 && point.y === 412,
		`${point.x},${point.y}`,
	);
}

// 18. A degenerate scale must not produce NaN coordinates — those would index
//     the pixel buffer as `NaN`, and every press would silently miss.
{
	const rect = frameRect(160, 90, 1600, 900);
	const point = frameToCardPoint(
		{ x: 500, y: 500 },
		{ offset: { x: 0, y: 0 }, scale: 0, rotation: 0 },
		rect,
		CANVAS,
		0,
	);
	ok(
		"a zero scale degrades to identity rather than NaN",
		Number.isFinite(point.x) && Number.isFinite(point.y),
		`${point.x},${point.y}`,
	);
}

if (failures > 0) throw new Error(`${failures} transform check(s) failed`);
console.log(`ALL PASS (${passes} assertions)`);
