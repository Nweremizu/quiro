// Self-check for typing an exact value into a slider. Run via `pnpm check`.
//
// The property that matters is the percentage case. Eleven sliders in this
// app print `Math.round(v * 100)%`, so the number on screen is a hundred
// times the stored one. Reading the typed digits as a value would write 40
// where 0.4 was meant, clamp it to the maximum, and silently change a
// setting — the kind of bug nobody reports because it looks like they
// mis-dragged. Every format actually used in the app is exercised here.

import { numericPart, valueFromDisplay } from "./slider-value";

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
const close = (a: number | null, b: number, tolerance = 1e-9) =>
	a !== null && Math.abs(a - b) <= tolerance;

// The six format shapes in use, from a survey of every `format={...}` prop.
const percent = (v: number) => `${Math.round(v * 100)}%`;
const degrees = (v: number) => `${Math.round(v)}°`;
const times = (v: number) => `${v.toFixed(1)}x`;
const seconds = (v: number) => `${v.toFixed(2)}s`;
const plain = (v: number) => `${v}`;

// 1. Numbers come out of whatever the format wrapped them in.
ok("percent suffix", numericPart("40%") === 40);
ok("multiplier suffix", numericPart("1.6x") === 1.6);
ok("degree suffix", numericPart("-5°") === -5);
ok("bare number", numericPart("701") === 701);
ok("no number at all", numericPart("auto") === null);

// 2. THE ONE THAT MATTERS. Typing "40" into a percentage slider must store
//    0.4, not 40.
{
	const got = valueFromDisplay(40, 0, 1, 0.01, percent);
	ok(
		"typing 40 into a 0..1 percent slider stores 0.4",
		close(got, 0.4),
		`got ${got}`,
	);
	ok(
		"typing 100 stores 1",
		close(valueFromDisplay(100, 0, 1, 0.01, percent), 1),
	);
	ok("typing 0 stores 0", close(valueFromDisplay(0, 0, 1, 0.01, percent), 0));
}

// 3. Identity formats round-trip unchanged.
ok("degrees round-trip", close(valueFromDisplay(28, -90, 90, 1, degrees), 28));
ok(
	"negative degrees round-trip",
	close(valueFromDisplay(-45, -90, 90, 1, degrees), -45),
);
ok("plain round-trips", close(valueFromDisplay(701, 0, 2000, 1, plain), 701));
ok(
	"seconds round-trip",
	close(valueFromDisplay(0.35, 0, 2, 0.05, seconds), 0.35, 1e-6),
);

// 4. A typed value that falls between step grid points lands on the nearer
//    one, not merely the next one up — 1.6 on a 0.5 grid is 1.5.
{
	const got = valueFromDisplay(1.6, 1, 6, 0.5, times);
	ok(
		"1.6 on a 0.5 grid snaps down to 1.5",
		close(got, 1.5, 1e-6),
		`got ${got}`,
	);
	const up = valueFromDisplay(1.8, 1, 6, 0.5, times);
	ok("1.8 on a 0.5 grid snaps up to 2", close(up, 2, 1e-6), `got ${up}`);
	ok(
		"an exact grid point is itself",
		close(valueFromDisplay(2.5, 1, 6, 0.5, times), 2.5, 1e-6),
	);
}

// 5. Out-of-range input is pinned to the range rather than escaping it — the
//    caller clamps too, but the search must not walk off its own grid.
{
	const overMax = valueFromDisplay(500, 0, 1, 0.01, percent);
	ok(
		"far above the range stops at the max",
		close(overMax, 1),
		`got ${overMax}`,
	);
	const underMin = valueFromDisplay(-500, 0, 1, 0.01, percent);
	ok(
		"far below the range stops at the min",
		close(underMin, 0),
		`got ${underMin}`,
	);
}

// 6. A format the search cannot reason about is refused rather than guessed
//    at — returning a confidently wrong value is the failure mode this whole
//    approach exists to avoid.
ok(
	"a format with no digits is refused",
	valueFromDisplay(1, 0, 10, 1, () => "auto") === null,
);
ok(
	"a descending format is refused",
	valueFromDisplay(5, 0, 10, 1, (v) => `${10 - v}`) === null,
);
ok(
	"a constant format is refused",
	valueFromDisplay(5, 0, 10, 1, () => "7") === null,
);

// 7. A wide range stays cheap: the search is over grid indices, so a
//    400,000-step slider costs about twenty format calls, not 400,000.
{
	let calls = 0;
	const counted = (v: number) => {
		calls++;
		return `${Math.round(v)}`;
	};
	const got = valueFromDisplay(1234, 0, 4000, 0.01, counted);
	ok("wide range resolves", close(got, 1234, 0.01), `got ${got}`);
	ok(`wide range stays cheap (${calls} calls)`, calls < 64, `got ${calls}`);
}

if (failures > 0) throw new Error(`${failures} slider-value check(s) failed`);
console.log(`ALL PASS (${passes} assertions)`);
