// Turning what a slider *shows* back into the value it stores.
//
// Split out of `Scrubber.tsx` so it can be checked without React in the
// bundle (see `slider-value.check.ts`), the same way `font-rows.ts` is.

/** The first number in a formatted value — "40%" -> 40, "1.6x" -> 1.6,
 * "-5°" -> -5. `null` when the format prints no number at all, which is the
 * signal that it cannot be typed into. */
export const numericPart = (text: string): number | null => {
	const match = text.match(/-?\d+(?:\.\d+)?/);
	return match ? Number(match[0]) : null;
};

/**
 * The value whose formatted display is `target`, found by searching the step
 * grid rather than by inverting `format`.
 *
 * `format` cannot be inverted directly: eleven sliders in this app print
 * `Math.round(v * 100)%`, so the number on screen is a hundred times the
 * stored one, and reading the typed digits as a value would write 40 where
 * 0.4 was meant — clamped to the maximum, silently. Others add a suffix, or
 * round, or both.
 *
 * So the comparison happens in display space, where the typed number and the
 * printed number mean the same thing, and the search runs over the only
 * values a commit can actually produce (`min + i * step`). That needs nothing
 * from `format` but monotonicity, which is checked below rather than assumed.
 * Roughly 20 evaluations even for a 400,000-step range.
 */
export function valueFromDisplay(
	target: number,
	min: number,
	max: number,
	step: number,
	format: (value: number) => string,
): number | null {
	const steps = Math.max(1, Math.round((max - min) / step));
	const displayAt = (index: number) => numericPart(format(min + index * step));

	const first = displayAt(0);
	const last = displayAt(steps);
	if (first === null || last === null) return null;
	// A format that runs backwards (or not at all) would make the search walk
	// the wrong way; refuse rather than return a confidently wrong value.
	if (last <= first) return null;

	// Lower bound: the first grid point that displays at or past the target.
	let low = 0;
	let high = steps;
	while (low < high) {
		const mid = (low + high) >> 1;
		const display = displayAt(mid);
		if (display === null) return null;
		if (display < target) low = mid + 1;
		else high = mid;
	}

	const lowDisplay = displayAt(low);
	if (lowDisplay === null) return null;

	// A rounding format maps a whole run of values onto one printed number:
	// with `Math.round` and a 0.01 step, everything from 1233.5 to 1234.49
	// prints as "1234". Landing on the first of that run would store 1233.5
	// for a typed 1234 — right on screen, wrong in the file. Take the middle
	// of the run instead, which is the value the number most fairly stands
	// for.
	if (lowDisplay === target) {
		let runEnd = low;
		let above = steps;
		while (runEnd < above) {
			const mid = (runEnd + above) >> 1;
			const display = displayAt(mid);
			if (display === null) return null;
			if (display <= target) runEnd = mid + 1;
			else above = mid;
		}
		const middle = (min + low * step + (min + (runEnd - 1) * step)) / 2;
		return min + Math.round((middle - min) / step) * step;
	}

	// No grid point prints the target exactly — "1.6" against a 0.5 grid — so
	// take whichever neighbour prints closest to it.
	if (low === 0) return min;
	const belowValue = min + (low - 1) * step;
	const belowDisplay = displayAt(low - 1);
	if (belowDisplay === null) return min + low * step;
	return Math.abs(lowDisplay - target) < Math.abs(target - belowDisplay)
		? min + low * step
		: belowValue;
}
