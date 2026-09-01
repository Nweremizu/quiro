// Self-check for the arrow geometry in `arrow.js`. There is no test runner in
// this app, so run it directly:
//
//   npx esbuild src/routes/screenshot-editor/arrow.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/arrow.cjs && node /tmp/arrow.cjs
//
// Exits non-zero on failure. Covers the parts that are easy to get subtly
// wrong: the bend handle riding on the curve, the exact Bézier bounds, and the
// arrowhead staying joined to the shaft.

import {
	type ArrowSpec,
	arrowBounds,
	bendFromHandle,
	bendHandle,
	buildArrow,
	sampleArrow,
} from "./arrow";

let failures = 0;
const ok = (name: string, cond: boolean, extra = "") => {
	if (!cond) failures++;
	console.log(`${cond ? "  ok" : "FAIL"}  ${name}${extra ? ` ${extra}` : ""}`);
};

const base: ArrowSpec = {
	start: { x: 60, y: 60 },
	end: { x: 230, y: 140 },
	bend: 0,
	curve: "straight",
	strokeWidth: 8,
	headScale: 1,
	startHead: "none",
	endHead: "triangle",
	lineStyle: "solid",
	taper: false,
};

for (const curve of ["quadratic", "cubic"] as const) {
	for (const bend of [-0.6, -0.2, 0.35, 0.9]) {
		const spec: ArrowSpec = { ...base, curve, bend };

		// 1. The bend handle must lie ON the curve (that is the whole point).
		const h = bendHandle(spec);
		if (!h) {
			ok(`${curve} b=${bend}: handle exists`, false);
			continue;
		}
		const pts = sampleArrow(spec);
		const nearest = Math.min(
			...pts.map((p) => Math.hypot(p.x - h.x, p.y - h.y)),
		);
		ok(
			`${curve} b=${bend}: handle on curve`,
			nearest < 0.5,
			`(dist ${nearest.toFixed(4)})`,
		);

		// 2. Round-trip: dragging the handle to where it already is is a no-op.
		const back = bendFromHandle(spec, h);
		ok(
			`${curve} b=${bend}: bend round-trips`,
			Math.abs(back - bend) < 1e-9,
			`(${back.toFixed(9)})`,
		);

		// 3. Dragging to an arbitrary target puts the curve under the cursor.
		const target = { x: h.x + 40, y: h.y - 25 };
		const moved: ArrowSpec = { ...spec, bend: bendFromHandle(spec, target) };
		const h2 = bendHandle(moved);
		// Only the perpendicular component is controllable by one scalar, so
		// compare the perpendicular offsets rather than the raw points.
		const dx = spec.end.x - spec.start.x;
		const dy = spec.end.y - spec.start.y;
		const len = Math.hypot(dx, dy);
		const perp = (p: { x: number; y: number }) =>
			((p.x - spec.start.x) * -dy + (p.y - spec.start.y) * dx) / len;
		ok(
			`${curve} b=${bend}: drag lands on cursor (perp)`,
			h2 != null && Math.abs(perp(h2) - perp(target)) < 1e-6,
		);

		// 4. Exact bounds must contain a dense sampling of the real curve.
		const b = arrowBounds(spec);
		const built = buildArrow(spec);
		const all = [...built.samples, ...built.shaft];
		const inside = all.every(
			(p) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY,
		);
		ok(`${curve} b=${bend}: bounds contain curve`, inside);

		// ...and must be tight: no more than a stroke-width of slack past the
		// widest thing actually drawn (curve extremes + head points).
		const headPts = [built.startHead, built.endHead].flatMap((s) =>
			s.kind === "none"
				? []
				: s.kind === "circle"
					? [
							{ x: s.c.x - s.r, y: s.c.y - s.r },
							{ x: s.c.x + s.r, y: s.c.y + s.r },
						]
					: s.points,
		);
		const drawn = [...all, ...headPts];
		// Slack should be exactly the stroke half-width (4 here). It can read a
		// hair higher because `samples` can miss the true extreme by a fraction
		// of a pixel — which is the whole reason the exact roots are better.
		const pad = spec.strokeWidth / 2;
		const slackX = Math.min(...drawn.map((p) => p.x)) - b.minX;
		const slackY = Math.min(...drawn.map((p) => p.y)) - b.minY;
		ok(
			`${curve} b=${bend}: bounds are tight`,
			slackX >= pad - 1e-6 &&
				slackY >= pad - 1e-6 &&
				slackX <= pad + 0.5 &&
				slackY <= pad + 0.5,
			`(slack ${slackX.toFixed(2)}, ${slackY.toFixed(2)}, pad ${pad})`,
		);

		// Concretely better than the old `strokeWidth * 6` pad on sampled points.
		const oldPad = spec.strokeWidth * 6;
		const oldW =
			Math.max(...built.samples.map((p) => p.x)) -
			Math.min(...built.samples.map((p) => p.x)) +
			oldPad * 2;
		ok(
			`${curve} b=${bend}: narrower than the old pad`,
			b.maxX - b.minX < oldW,
			`(${(b.maxX - b.minX).toFixed(1)} vs ${oldW.toFixed(1)})`,
		);
	}
}

// 5. A straight arrow is unchanged by all of this.
{
	const built = buildArrow(base);
	ok("straight: shaft starts at start", built.shaft[0].x === 60);
	ok("straight: head is a triangle", built.endHead.kind === "triangle");
	const b = arrowBounds(base);
	ok(
		"straight: bounds contain both endpoints",
		b.minX <= 60 && b.maxX >= 230 && b.minY <= 60 && b.maxY >= 140,
	);
	ok("straight: no bend handle", bendHandle(base) === null);
}

// 6. Head sits flush on the shaft end for every curve mode.
for (const curve of ["straight", "quadratic", "cubic", "elbow"] as const) {
	const spec: ArrowSpec = { ...base, curve, bend: 0.7 };
	const built = buildArrow(spec);
	const shaftEnd = built.shaft[built.shaft.length - 1];
	const head = built.endHead;
	if (head.kind === "triangle" || head.kind === "arrow") {
		// Base midpoint of the head must be the shaft's last point.
		const mid = {
			x: (head.points[0].x + head.points[2].x) / 2,
			y: (head.points[0].y + head.points[2].y) / 2,
		};
		const gap = Math.hypot(mid.x - shaftEnd.x, mid.y - shaftEnd.y);
		ok(`${curve}: head joins shaft`, gap < 1e-9, `(gap ${gap.toFixed(9)})`);
		// Apex must be exactly the arrow's endpoint.
		const tipOff = Math.hypot(
			head.points[1].x - spec.end.x,
			head.points[1].y - spec.end.y,
		);
		ok(`${curve}: head apex at endpoint`, tipOff < 1e-9);
	}
}

// Throwing rather than `process.exit` keeps this file free of node types while
// still failing the run with a non-zero status.
if (failures > 0) throw new Error(`${failures} arrow geometry check(s) failed`);
console.log("\nALL PASS");
