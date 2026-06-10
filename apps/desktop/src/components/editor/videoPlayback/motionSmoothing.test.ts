import { describe, expect, it } from "vitest";

import {
	type SpringState,
	clampDeltaMs,
	createSpringState,
	getCursorSpringConfig,
	resetSpringState,
	stepSpringValue,
} from "./motionSmoothing";

/** Create an already-initialized spring at a given position and optional velocity. */
function makeStateAt(value: number, velocity = 0): SpringState {
	return { value, velocity, initialized: true };
}

const DEFAULT_CONFIG = getCursorSpringConfig(0.67); // typical editor smoothing

describe("clampDeltaMs", () => {
	it("passes valid deltas unchanged within [1, 80] ms", () => {
		expect(clampDeltaMs(16.67)).toBeCloseTo(16.67);
		expect(clampDeltaMs(1)).toBe(1);
		expect(clampDeltaMs(80)).toBe(80);
	});

	it("clamps sub-1 ms deltas to 1 ms", () => {
		expect(clampDeltaMs(0.5)).toBe(1);
		expect(clampDeltaMs(0)).toBe(1000 / 60); // zero → fallback
	});

	it("clamps huge deltas to 80 ms — prevents teleport on tab-wakeup", () => {
		expect(clampDeltaMs(500)).toBe(80);
		expect(clampDeltaMs(Number.POSITIVE_INFINITY)).toBe(1000 / 60);
		expect(clampDeltaMs(Number.NaN)).toBe(1000 / 60);
	});
});

describe("stepSpringValue — jitter regression", () => {
	/**
	 * This suite validates the root-cause fix for cursor jitter during playback.
	 *
	 * Context
	 * -------
	 * The Pixi ticker fires at ~60 fps (wall-clock ≈ 16.67 ms / tick).
	 * requestVideoFrameCallback fires at ~30 fps (≈ 33 ms / video frame).
	 * Between VFC callbacks currentTimeRef.current stays constant, so the
	 * ticker computes a video-time delta of 0 every other tick.
	 *
	 * Before the fix: deltaMs = Math.max(1, videoTimeDelta)
	 *   Tick A (same frame) → deltaMs = 1 ms   → spring barely moves
	 *   Tick B (new frame)  → deltaMs = 33 ms  → spring takes a big step
	 *   The ≈ 33× step-ratio produces visible jump-stall-jump-stall jitter.
	 *
	 * After the fix: deltaMs = Math.max(1, wallClockDelta)
	 *   Every tick         → deltaMs ≈ 16.67 ms → spring advances uniformly.
	 */

	it("demonstrates the jitter mechanism: 1 ms step moves cursor 30× less than a 33 ms step", () => {
		// Two identical springs, one stepped with the 'same-frame' delta (1 ms)
		// and one with the 'new-frame' delta (33 ms).  The displacement ratio
		// quantifies how bad the jitter was before the fix.
		const stateA = makeStateAt(0);
		const displacement1ms = stepSpringValue(stateA, 1, 1, DEFAULT_CONFIG) - 0;

		const stateB = makeStateAt(0);
		const displacement33ms = stepSpringValue(stateB, 1, 33, DEFAULT_CONFIG) - 0;

		expect(displacement1ms).toBeGreaterThan(0);
		expect(displacement33ms).toBeGreaterThan(0);

		// The 33 ms step should move the cursor dramatically further.
		// Before the fix this ratio was ≈ 900 in practice; asserting > 30
		// still clearly documents the jitter magnitude.
		const ratio = displacement33ms / displacement1ms;
		expect(ratio).toBeGreaterThan(30);
	});

	it("uniform 16.67 ms steps produce smooth, consistent motion (the fix)", () => {
		// Two consecutive uniform ticks as the fix produces them.
		const state = makeStateAt(0);
		const pos1 = stepSpringValue(state, 1, 16.67, DEFAULT_CONFIG);
		const pos2 = stepSpringValue(state, 1, 16.67, DEFAULT_CONFIG);

		const disp1 = pos1 - 0;
		const disp2 = pos2 - pos1;

		// Both displacements are positive (spring is converging).
		expect(disp1).toBeGreaterThan(0);
		expect(disp2).toBeGreaterThan(0);

		// The spring naturally accelerates from rest, so disp2 > disp1 is
		// expected and looks smooth.  What we require is that neither step
		// dwarfs the other by more than 10× — that threshold catches jitter
		// while allowing natural spring acceleration.
		const ratio = Math.max(disp1, disp2) / Math.min(disp1, disp2);
		expect(ratio).toBeLessThan(10);
	});

	it("step-size ratio is dramatically lower with uniform deltas than with alternating 1 ms / 33 ms", () => {
		// --- Jitter pattern (before fix): alternating 1 ms / 33 ms steps ---
		const jitterState = makeStateAt(0);
		const jPos1 = stepSpringValue(jitterState, 1, 1, DEFAULT_CONFIG);
		const jPos2 = stepSpringValue(jitterState, 1, 33, DEFAULT_CONFIG);
		const jRatio =
			Math.max(jPos2 - jPos1, jPos1) / Math.min(jPos2 - jPos1, jPos1);

		// --- Fixed pattern: uniform 16.67 ms steps ---
		const smoothState = makeStateAt(0);
		const sPos1 = stepSpringValue(smoothState, 1, 16.67, DEFAULT_CONFIG);
		const sPos2 = stepSpringValue(smoothState, 1, 16.67, DEFAULT_CONFIG);
		const sRatio =
			Math.max(sPos2 - sPos1, sPos1) / Math.min(sPos2 - sPos1, sPos1);

		// The jitter pattern's step ratio should be at least 5× worse than the
		// uniform pattern's ratio, regardless of spring config.
		expect(jRatio).toBeGreaterThan(sRatio * 5);
	});

	it("spring converges to target within 2 seconds at 60 fps with typical smoothing", () => {
		const state = makeStateAt(0);
		for (let tick = 0; tick < 120; tick++) {
			stepSpringValue(state, 1, 16.67, DEFAULT_CONFIG);
		}
		expect(state.value).toBeCloseTo(1, 2);
	});

	it("resetSpringState re-initializes spring to snap on next step", () => {
		const state = createSpringState(0);
		// Warm up the spring
		stepSpringValue(state, 1, 16.67, DEFAULT_CONFIG);
		stepSpringValue(state, 1, 16.67, DEFAULT_CONFIG);
		expect(state.value).toBeGreaterThan(0);

		// After reset, next step should snap to target
		resetSpringState(state);
		const snapped = stepSpringValue(state, 0.5, 16.67, DEFAULT_CONFIG);
		expect(snapped).toBe(0.5);
	});
});

describe("getCursorSpringConfig", () => {
	it("smoothing=0 returns an instant snap config (very high stiffness)", () => {
		const config = getCursorSpringConfig(0);
		expect(config.stiffness).toBeGreaterThan(500);
		expect(config.damping).toBeGreaterThan(50);
	});

	it("higher smoothing returns lower stiffness (slower, floatier spring)", () => {
		const low = getCursorSpringConfig(0.3);
		const high = getCursorSpringConfig(1.5);
		expect(high.stiffness).toBeLessThan(low.stiffness);
	});

	it("smoothing is clamped to [0, 2] — values outside the range behave like the boundary", () => {
		const atZero = getCursorSpringConfig(0);
		const belowZero = getCursorSpringConfig(-1);
		expect(belowZero).toEqual(atZero);

		const atMax = getCursorSpringConfig(2);
		const aboveMax = getCursorSpringConfig(5);
		expect(aboveMax).toEqual(atMax);
	});

	it("tuning multipliers scale individual spring parameters", () => {
		const base = getCursorSpringConfig(1);
		const stiffer = getCursorSpringConfig(1, { stiffnessMultiplier: 2 });
		const softer = getCursorSpringConfig(1, { dampingMultiplier: 0.5 });

		expect(stiffer.stiffness).toBeCloseTo(base.stiffness * 2, 5);
		expect(softer.damping).toBeCloseTo(base.damping * 0.5, 5);
	});
});
