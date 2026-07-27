import { describe, expect, it } from "vitest";
import { ZOOM_DEPTH_SCALES } from "@/types/editor";
import {
	computeCursorFollowFocus,
	createCursorFollowCameraState,
	SNAP_TO_EDGES_RATIO_AUTO,
} from "./cursorFollowCamera";

describe("computeCursorFollowFocus", () => {
	it("holds the camera while the cursor stays inside the safe zone", () => {
		const state = createCursorFollowCameraState();
		const cursorSamples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" as const },
			{ timeMs: 100, cx: 0.6, cy: 0.58, interactionType: "move" as const },
		];

		const initialFocus = computeCursorFollowFocus(
			state,
			cursorSamples,
			0,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);
		const heldFocus = computeCursorFollowFocus(
			state,
			cursorSamples,
			100,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		expect(initialFocus).toEqual({ cx: 0.5, cy: 0.5 });
		expect(heldFocus).toEqual(initialFocus);
	});

	it("recenters the cursor after it leaves the safe zone", () => {
		const state = createCursorFollowCameraState();
		const cursorSamples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" as const },
			{ timeMs: 100, cx: 0.7, cy: 0.5, interactionType: "move" as const },
			{ timeMs: 200, cx: 0.72, cy: 0.5, interactionType: "move" as const },
		];

		computeCursorFollowFocus(
			state,
			cursorSamples,
			0,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		const firstShift = computeCursorFollowFocus(
			state,
			cursorSamples,
			100,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);
		const secondShift = computeCursorFollowFocus(
			state,
			cursorSamples,
			200,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		expect(firstShift.cx).toBeCloseTo(0.7, 6);
		expect(firstShift.cy).toBeCloseTo(0.5, 6);
		expect(secondShift.cx).toBeCloseTo(0.7, 6);
		expect(secondShift.cy).toBeCloseTo(0.5, 6);
	});

	it("clamps the camera when the cursor pushes past the stage edge", () => {
		const state = createCursorFollowCameraState();
		const cursorSamples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" as const },
			{ timeMs: 100, cx: 1, cy: 1, interactionType: "move" as const },
		];

		computeCursorFollowFocus(
			state,
			cursorSamples,
			0,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		const clampedFocus = computeCursorFollowFocus(
			state,
			cursorSamples,
			100,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		expect(clampedFocus).toEqual({ cx: 0.75, cy: 0.75 });
	});
});

// ---------------------------------------------------------------------------
// Edge behaviour across every zoom depth (#20)
//
// The camera holds a persistent centre and only recenters once the cursor
// leaves an inner safe zone. The safe zone is expressed as a fraction of the
// *visible* span, so the question this suite answers is whether that produces
// the same feel at 1.25x as at 5x.
// ---------------------------------------------------------------------------

const DEPTH_SCALES = Object.values(ZOOM_DEPTH_SCALES);
// The shipped ratio, plus a deliberately different one: the uniformity
// property must hold for any ratio, not just the value we happen to ship.
const SNAP_RATIOS = [SNAP_TO_EDGES_RATIO_AUTO, 0.4];

function follow(
	zoomScale: number,
	snapToEdgesRatio: number,
	cursor: { cx: number; cy: number },
	startFocus = { cx: 0.5, cy: 0.5 },
) {
	const state = createCursorFollowCameraState();
	const samples = [
		{ timeMs: 0, cx: startFocus.cx, cy: startFocus.cy, interactionType: "move" as const },
		{ timeMs: 100, cx: cursor.cx, cy: cursor.cy, interactionType: "move" as const },
	];
	computeCursorFollowFocus(state, samples, 0, zoomScale, 1, startFocus, {
		snapToEdgesRatio,
	});
	return computeCursorFollowFocus(state, samples, 100, zoomScale, 1, startFocus, {
		snapToEdgesRatio,
	});
}

function marginFor(zoomScale: number) {
	return 1 / (2 * zoomScale);
}

describe.each(SNAP_RATIOS)("edge pinning at snap ratio %s", (ratio) => {
	it.each(DEPTH_SCALES)("pins to every edge at zoom scale %s", (zoomScale) => {
		const margin = marginFor(zoomScale);

		const left = follow(zoomScale, ratio, { cx: 0, cy: 0.5 });
		expect(left.cx).toBeCloseTo(margin, 6);

		const right = follow(zoomScale, ratio, { cx: 1, cy: 0.5 });
		expect(right.cx).toBeCloseTo(1 - margin, 6);

		const top = follow(zoomScale, ratio, { cx: 0.5, cy: 0 });
		expect(top.cy).toBeCloseTo(margin, 6);

		const bottom = follow(zoomScale, ratio, { cx: 0.5, cy: 1 });
		expect(bottom.cy).toBeCloseTo(1 - margin, 6);
	});

	it.each(DEPTH_SCALES)(
		"never lets the frame leave the video at zoom scale %s",
		(zoomScale) => {
			const margin = marginFor(zoomScale);
			for (let c = 0; c <= 1.0001; c += 0.02) {
				const focus = follow(zoomScale, ratio, { cx: c, cy: c });
				expect(focus.cx).toBeGreaterThanOrEqual(margin - 1e-9);
				expect(focus.cx).toBeLessThanOrEqual(1 - margin + 1e-9);
				expect(focus.cy).toBeGreaterThanOrEqual(margin - 1e-9);
				expect(focus.cy).toBeLessThanOrEqual(1 - margin + 1e-9);
			}
		},
	);

	it.each(DEPTH_SCALES)(
		"holds the camera still inside the safe zone at zoom scale %s",
		(zoomScale) => {
			const halfSpan = 1 / (2 * zoomScale);
			// Comfortably inside: the safe edge sits at halfSpan * (1 - 2 * ratio).
			const inside = 0.5 + halfSpan * (1 - 2 * ratio) * 0.5;
			expect(follow(zoomScale, ratio, { cx: inside, cy: 0.5 })).toEqual({
				cx: 0.5,
				cy: 0.5,
			});
		},
	);
});

describe("safe zone uniformity across depths", () => {
	// The claim under test: the camera starts moving at the same *proportion*
	// of the visible span at every depth. If this drifted, a zoom would feel
	// different at depth 1 than at depth 6 — the symptom #20 exists to catch.
	it.each(SNAP_RATIOS)(
		"starts moving at the same fraction of the visible span at ratio %s",
		(ratio) => {
			const fractions = DEPTH_SCALES.map((zoomScale) => {
				const halfSpan = 1 / (2 * zoomScale);
				// Walk the cursor out from the centre until the camera reacts.
				let threshold = 0.5;
				for (let step = 0; step <= 2000; step += 1) {
					const cx = 0.5 + (step / 2000) * halfSpan;
					if (follow(zoomScale, ratio, { cx, cy: 0.5 }).cx !== 0.5) {
						threshold = cx;
						break;
					}
				}
				return (threshold - 0.5) / halfSpan;
			});

			for (const fraction of fractions) {
				expect(fraction).toBeCloseTo(fractions[0], 2);
			}
			// And it is the documented fraction, not an accident.
			expect(fractions[0]).toBeCloseTo(1 - 2 * ratio, 2);
		},
	);
});

describe.each(SNAP_RATIOS)("recenter target at snap ratio %s", (ratio) => {
	// Pinning tests alone cannot tell "centre on the cursor" apart from
	// "shift just enough to bring the cursor back inside the zone" — both clamp
	// to the same value at an edge. This pins which one ships, so the tuning
	// sweep changes it deliberately rather than by accident.
	it("centres on the cursor once it leaves the zone", () => {
		const exercised: number[] = [];

		for (const zoomScale of DEPTH_SCALES) {
			const halfSpan = 1 / (2 * zoomScale);
			const margin = marginFor(zoomScale);
			const safeRight = 0.5 + halfSpan * (1 - 2 * ratio);
			const upperBound = 1 - margin;
			// Shallow depths show so much of the frame that the bounds clamp
			// starts before the safe zone ends; there the landing point is
			// unobservable and the pinning tests already cover it.
			if (safeRight >= upperBound) {
				continue;
			}

			const cursorCx = (safeRight + upperBound) / 2;
			expect([
				zoomScale,
				follow(zoomScale, ratio, { cx: cursorCx, cy: 0.5 }).cx,
			]).toEqual([zoomScale, expect.closeTo(cursorCx, 6)]);
			exercised.push(zoomScale);
		}

		// Guard against the loop skipping everything and passing vacuously.
		expect(exercised.length).toBeGreaterThanOrEqual(3);
	});
});
