// Self-check for the coordinate-space layer. Run via `pnpm check`, or alone:
//
//   npx esbuild src/routes/screenshot-editor/space.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/space.cjs && node /tmp/space.cjs
//
// The property that matters: a position converted out of frame space and back
// must land where it started, for every anchor rect the editor can produce —
// including the degenerate ones that exist before the first frame arrives.
// Plan 002 stores all geometry normalized, so any drift here becomes drift in
// every annotation on every edit.

import {
	canvasNormRectToFrame,
	captureNormRectToFrame,
	captureNormToFrame,
	type FramePx,
	framePt,
	frameRect,
	frameRectToCanvasNorm,
	frameRectToCaptureNorm,
	frameToCaptureNorm,
	normalizeAnnotation,
	type Rect,
	resolveAnnotation,
} from "./space";

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

// Anchor rects the editor actually produces: a centred image inside a padded
// frame, an unpadded one, an offset crop, extreme aspect ratios, and the
// zero-sized rect `getImageRect` returns before the renderer reports a frame.
const REFS: Array<[string, Rect<FramePx>]> = [
	["padded 16:9", frameRect(160, 90, 1600, 900)],
	["unpadded", frameRect(0, 0, 1920, 1080)],
	["offset crop", frameRect(37, 211, 640, 480)],
	["tall sliver", frameRect(0, 0, 12, 2000)],
	["wide sliver", frameRect(0, 0, 2000, 12)],
	["single pixel", frameRect(5, 5, 1, 1)],
	["degenerate", frameRect(0, 0, 0, 0)],
];

const POINTS: Array<[number, number]> = [
	[0, 0],
	[160, 90],
	[960, 540],
	[1919, 1079],
	[-40, -25], // outside the anchor: an object dragged off the image
	[3000, 2200],
];

// 1. Point round-trip through image-normalized space.
for (const [refName, ref] of REFS) {
	for (const [x, y] of POINTS) {
		const p = framePt(x, y);
		const back = captureNormToFrame(frameToCaptureNorm(p, ref), ref);
		// A degenerate anchor cannot preserve position — width 0 is divided as
		// 1, so the result collapses onto the origin. That is the documented
		// behaviour, and the check asserts it rather than pretending otherwise.
		if (ref.width <= 1 || ref.height <= 1) {
			ok(
				`degenerate stays finite (${refName} @ ${x},${y})`,
				Number.isFinite(back.x) && Number.isFinite(back.y),
			);
			continue;
		}
		ok(
			`point round-trip (${refName} @ ${x},${y})`,
			near(back.x, x, 1e-9) && near(back.y, y, 1e-9),
			`(${back.x}, ${back.y})`,
		);
	}
}

// 2. Rect round-trip, including the signed extents a right-to-left drag makes.
{
	const RECTS: Array<[number, number, number, number]> = [
		[200, 150, 400, 300],
		[0, 0, 1920, 1080],
		[900, 500, -120, -80], // dragged up and to the left
		[-50, -50, 100, 100], // straddling the image edge
	];
	for (const [refName, ref] of REFS) {
		if (ref.width <= 1 || ref.height <= 1) continue;
		for (const [x, y, w, h] of RECTS) {
			const r = frameRect(x, y, w, h);
			const back = captureNormRectToFrame(frameRectToCaptureNorm(r, ref), ref);
			ok(
				`rect round-trip (${refName} @ ${x},${y} ${w}x${h})`,
				near(back.x, x, 1e-9) &&
					near(back.y, y, 1e-9) &&
					near(back.width, w, 1e-9) &&
					near(back.height, h, 1e-9),
			);
		}
	}
}

// 3. Negative extents survive as negative — normalising a backwards drag must
//    not silently flip it, because `AnnotationLayer` relies on the sign until
//    the gesture commits.
{
	const ref = frameRect(0, 0, 1000, 1000);
	const n = frameRectToCaptureNorm(frameRect(500, 500, -200, -100), ref);
	ok("negative width stays negative", n.width < 0, `${n.width}`);
	ok("negative height stays negative", n.height < 0, `${n.height}`);
}

// 4. The anchor's own corners map to exactly 0 and 1 — the property that makes
//    an image-anchored object survive a padding change.
for (const [refName, ref] of REFS) {
	if (ref.width <= 1 || ref.height <= 1) continue;
	const tl = frameToCaptureNorm(framePt(ref.x, ref.y), ref);
	const br = frameToCaptureNorm(
		framePt(ref.x + ref.width, ref.y + ref.height),
		ref,
	);
	ok(
		`anchor corners are 0 and 1 (${refName})`,
		near(tl.x, 0) && near(tl.y, 0) && near(br.x, 1) && near(br.y, 1),
		`tl=(${tl.x},${tl.y}) br=(${br.x},${br.y})`,
	);
}

// 5. The padding-change property, stated directly: the same normalized point
//    resolves onto the same feature of the image after the image rect moves
//    and shrinks inside a larger frame. This is the bug plan 002 fixes,
//    asserted here at the level the maths can express it.
{
	const before = frameRect(0, 0, 1000, 1000); // no padding
	const after = frameRect(100, 100, 800, 800); // padding dragged up

	// A point 30% across and 60% down the screenshot.
	const norm = frameToCaptureNorm(framePt(300, 600), before);
	const resolved = captureNormToFrame(norm, after);

	ok(
		"normalized point tracks the image through a padding change",
		near(resolved.x, 100 + 0.3 * 800) && near(resolved.y, 100 + 0.6 * 800),
		`(${resolved.x}, ${resolved.y})`,
	);

	// The same point stored in frame px would not have moved at all — which is
	// precisely the drift. Assert the contrast so the check documents it.
	ok(
		"frame-px storage would have drifted",
		Math.abs(300 - resolved.x) > 1 || Math.abs(600 - resolved.y) > 1,
	);
}

// 6. Canvas-anchored geometry is independent of the image rect: an object
//    pinned to the frame must not move when the image moves inside it.
{
	const bounds = frameRect(0, 0, 1920, 1080);
	const r = frameRect(1500, 60, 360, 120); // a caption in the top-right margin
	const norm = frameRectToCanvasNorm(r, bounds);
	const back = canvasNormRectToFrame(norm, bounds);
	ok(
		"canvas-anchored rect round-trips",
		near(back.x, 1500) &&
			near(back.y, 60) &&
			near(back.width, 360) &&
			near(back.height, 120),
	);
	ok(
		"canvas-anchored values are frame-relative",
		near(norm.x, 1500 / 1920) && near(norm.y, 60 / 1080),
	);
}

// 7. No conversion emits a non-finite number, whatever it is handed. An
//    Infinity here would reach the annotation list and persist to disk.
{
	const ref = frameRect(0, 0, 0, 0);
	const n = frameRectToCaptureNorm(frameRect(10, 10, 20, 20), ref);
	ok(
		"degenerate anchor yields finite normalized values",
		Number.isFinite(n.x) &&
			Number.isFinite(n.y) &&
			Number.isFinite(n.width) &&
			Number.isFinite(n.height),
		`(${n.x}, ${n.y}, ${n.width}, ${n.height})`,
	);
}

// 8. The annotation storage boundary round-trips, and agrees with the Rust
//    migration's convention: positions shift by the anchor origin, extents do
//    not, and stroke width is normalized against height alone.
{
	const anchor = frameRect(160, 90, 1600, 900);
	const stored = {
		x: 0.25,
		y: 0.5,
		width: 0.1,
		height: -0.2,
		strokeWidth: 0.004,
		arrowHeadSize: 0.02,
	};

	const resolved = resolveAnnotation(stored, anchor);
	ok(
		"resolve places the origin inside the anchor",
		near(resolved.x, 160 + 0.25 * 1600) && near(resolved.y, 90 + 0.5 * 900),
		`(${resolved.x}, ${resolved.y})`,
	);
	ok(
		"resolve scales extents without the origin shift",
		near(resolved.width, 0.1 * 1600) && near(resolved.height, -0.2 * 900),
	);
	ok(
		"stroke width resolves against height only",
		near(resolved.strokeWidth, 0.004 * 900),
	);
	ok(
		"arrow head size travels with the stroke",
		near(resolved.arrowHeadSize, 0.02 * 900),
	);

	const back = normalizeAnnotation(resolved, anchor);
	ok(
		"annotation round-trips through the boundary",
		near(back.x, stored.x) &&
			near(back.y, stored.y) &&
			near(back.width, stored.width) &&
			near(back.height, stored.height) &&
			near(back.strokeWidth, stored.strokeWidth) &&
			near(back.arrowHeadSize, stored.arrowHeadSize),
	);
}

// 9. An annotation with no arrow head must not gain one, and a null must
//    survive rather than becoming NaN.
{
	const anchor = frameRect(0, 0, 1000, 1000);
	const plain = { x: 0.1, y: 0.1, width: 0.2, height: 0.2, strokeWidth: 0.01 };
	const resolved = resolveAnnotation(plain, anchor);
	ok("no arrowHeadSize is not invented", !("arrowHeadSize" in resolved));

	const withNull = { ...plain, arrowHeadSize: null };
	const resolvedNull = resolveAnnotation(withNull, anchor);
	ok("null arrowHeadSize stays null", resolvedNull.arrowHeadSize === null);
}

// 10. A degenerate anchor must not produce NaN geometry that would then be
//     written back to disk.
{
	const anchor = frameRect(0, 0, 0, 0);
	const n = normalizeAnnotation(
		{ x: 10, y: 10, width: 20, height: 20, strokeWidth: 2 },
		anchor,
	);
	ok(
		"degenerate anchor yields finite annotation geometry",
		Number.isFinite(n.x) &&
			Number.isFinite(n.y) &&
			Number.isFinite(n.width) &&
			Number.isFinite(n.height) &&
			Number.isFinite(n.strokeWidth),
	);
}

if (failures > 0) throw new Error(`${failures} space check(s) failed`);
console.log(`ALL PASS (${passes} assertions)`);
