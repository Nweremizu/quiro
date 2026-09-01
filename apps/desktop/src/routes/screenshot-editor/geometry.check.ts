// Self-check for the four-corner geometry layer. No test runner here, so run
// it directly:
//
//   npx esbuild src/routes/screenshot-editor/geometry.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/geom.cjs && node /tmp/geom.cjs
//
// The property that matters: whichever handle you drag, at whatever rotation,
// the corner opposite it must not move.

import type { Annotation } from "@/utils/tauri";
import {
	type Corners,
	pointsAABB,
	pointsToGeometry,
	resizeByHandle,
	shapePoints,
} from "./geometry";

// Hundreds of cases run here, so only failures are printed.
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

const shape = (over: Partial<Annotation> = {}): Annotation =>
	({
		id: "t",
		type: "rectangle",
		x: 40,
		y: 25,
		width: 120,
		height: 80,
		strokeColor: "#000",
		strokeWidth: 4,
		fillColor: "transparent",
		opacity: 1,
		rotation: 0,
		text: null,
		...over,
	}) as Annotation;

const HANDLES = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];
const ANGLES = [0, 15, 37, 90, 133, 180, -45, -120];
const DELTAS: Array<[number, number]> = [
	[20, 0],
	[0, 20],
	[-30, 18],
	[45, -22],
	[-15, -40],
];

// 1. The anchor corner never moves, at any rotation, for any handle.
for (const rotation of ANGLES) {
	for (const handle of HANDLES) {
		for (const [dx, dy] of DELTAS) {
			const a = shape({ rotation });
			const before = shapePoints(a);
			const west = handle.includes("w");
			const north = handle.includes("n");
			const idx = west ? (north ? 2 : 1) : north ? 3 : 0;

			const g = resizeByHandle(a, handle, dx, dy, false);
			const after = shapePoints({ ...a, ...g } as Annotation);

			const moved = Math.hypot(
				after[idx].x - before[idx].x,
				after[idx].y - before[idx].y,
			);
			ok(
				`anchor pinned rot=${rotation} ${handle} d=(${dx},${dy})`,
				moved < 1e-9,
				`(moved ${moved.toExponential(2)})`,
			);
		}
	}
}

// 2. Resizing never changes the rotation.
for (const rotation of ANGLES) {
	const a = shape({ rotation });
	const g = resizeByHandle(a, "se", 33, -17, false);
	ok(`rotation preserved rot=${rotation}`, g.rotation === rotation);
}

// 3. At rotation 0 the result matches the plain axis-aligned arithmetic the
//    old code did, so upright behaviour is unchanged.
for (const [dx, dy] of DELTAS) {
	const a = shape();
	for (const handle of HANDLES) {
		const g = resizeByHandle(a, handle, dx, dy, false);
		const w =
			a.width + (handle.includes("e") ? dx : handle.includes("w") ? -dx : 0);
		const h =
			a.height + (handle.includes("s") ? dy : handle.includes("n") ? -dy : 0);
		const x = a.x + (handle.includes("w") ? dx : 0);
		const y = a.y + (handle.includes("n") ? dy : 0);
		ok(
			`upright matches old math ${handle} d=(${dx},${dy})`,
			Math.abs(g.width - w) < 1e-9 &&
				Math.abs(g.height - h) < 1e-9 &&
				Math.abs(g.x - x) < 1e-9 &&
				Math.abs(g.y - y) < 1e-9,
			`(got ${g.x.toFixed(2)},${g.y.toFixed(2)} ${g.width.toFixed(2)}x${g.height.toFixed(2)} want ${x},${y} ${w}x${h})`,
		);
	}
}

// 4. shapePoints / pointsToGeometry round-trip.
for (const rotation of ANGLES) {
	const a = shape({ rotation });
	const g = pointsToGeometry(shapePoints(a), rotation);
	// atan2 returns (-180,180]; 180 and -180 are the same orientation.
	const sameAngle =
		Math.abs(g.rotation - rotation) < 1e-6 ||
		Math.abs(Math.abs(g.rotation - rotation) - 360) < 1e-6;
	ok(
		`round-trip rot=${rotation}`,
		Math.abs(g.x - a.x) < 1e-9 &&
			Math.abs(g.y - a.y) < 1e-9 &&
			Math.abs(g.width - a.width) < 1e-9 &&
			Math.abs(g.height - a.height) < 1e-9 &&
			sameAngle,
		`(got ${g.x.toFixed(3)},${g.y.toFixed(3)} ${g.width.toFixed(3)}x${g.height.toFixed(3)} @${g.rotation.toFixed(3)})`,
	);
}

// 5. Aspect lock produces a square, and still pins the anchor.
for (const rotation of [0, 30, 90]) {
	const a = shape({ rotation });
	const g = resizeByHandle(a, "se", 50, 5, true);
	ok(
		`aspect lock squares rot=${rotation}`,
		Math.abs(Math.abs(g.width) - Math.abs(g.height)) < 1e-9,
		`(${g.width.toFixed(2)}x${g.height.toFixed(2)})`,
	);
	const before = shapePoints(a);
	const after = shapePoints({ ...a, ...g } as Annotation);
	ok(
		`aspect lock pins anchor rot=${rotation}`,
		Math.hypot(after[0].x - before[0].x, after[0].y - before[0].y) < 1e-9,
	);
}

// 6. A degenerate (zero-width) shape keeps its rotation instead of reading
//    noise off atan2.
{
	const pts: Corners = [
		{ x: 10, y: 10 },
		{ x: 10, y: 10 },
		{ x: 10, y: 90 },
		{ x: 10, y: 90 },
	];
	const g = pointsToGeometry(pts, 42);
	ok("degenerate keeps fallback rotation", g.rotation === 42);
}

// 7. AABB of a rotated square is the expected larger box.
{
	const a = shape({ x: 0, y: 0, width: 100, height: 100, rotation: 45 });
	const box = pointsAABB(shapePoints(a));
	const expected = 100 * Math.SQRT2;
	ok(
		"AABB of 45° square",
		Math.abs(box.width - expected) < 1e-9 &&
			Math.abs(box.height - expected) < 1e-9,
		`(${box.width.toFixed(3)} vs ${expected.toFixed(3)})`,
	);
}

if (failures > 0) throw new Error(`${failures} geometry check(s) failed`);
console.log(`ALL PASS (${passes} assertions)`);
