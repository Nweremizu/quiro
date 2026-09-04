// Self-check for the font picker's list-building. Run via `pnpm check`, or
// alone:
//
//   npx esbuild src/components/font-rows.check.ts \
//     --bundle --platform=node --format=esm --outfile=/tmp/fr.mjs && node /tmp/fr.mjs
//
// The properties that matter: a family the shaping engine already has is
// never also offered as a download (picking the wrong one of a duplicate
// pair would download a font that is already there), the CSS generics stay
// reachable even though they are not real fontdb families, and the row cap
// that keeps ~1900 catalogue entries out of the DOM is actually enforced.

import { buildFontRows, GENERIC_FAMILIES, MAX_ROWS } from "./font-rows";

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

const catalog = [
	{ family: "Inter", category: "sans-serif" },
	{ family: "Roboto", category: "sans-serif" },
	{ family: "Merriweather", category: "serif" },
	{ family: "Lobster", category: "display" },
	{ family: "Caveat", category: "handwriting" },
	{ family: "Fira Code", category: "monospace" },
];

const googleFamilies = (rows: ReturnType<typeof buildFontRows>) =>
	rows.google.flatMap((group) => group.fonts.map((font) => font.family));

// 1. The generics are always reachable — they are what the text model
//    defaults to, and they are not in any font database's family list.
{
	const rows = buildFontRows({
		installed: [],
		catalog: [],
		search: "",
		category: "all",
	});
	ok(
		"generics are listed with no fonts at all",
		rows.generic.join(",") === GENERIC_FAMILIES.join(","),
	);
}

// 2. An installed family is not also offered as a download.
{
	const rows = buildFontRows({
		installed: ["Inter", "Arial"],
		catalog,
		search: "",
		category: "all",
	});
	ok(
		"installed family is listed as installed",
		rows.installed.includes("Inter"),
	);
	ok(
		"installed family is not also a Google download",
		!googleFamilies(rows).includes("Inter"),
	);
	ok("other Google families survive", googleFamilies(rows).includes("Roboto"));
}

// 3. …case-insensitively, since the two lists come from different sources
//    (fontdb's own casing vs. Google's catalogue casing).
{
	const rows = buildFontRows({
		installed: ["fira code"],
		catalog,
		search: "",
		category: "all",
	});
	ok(
		"dedupe ignores case",
		!googleFamilies(rows).includes("Fira Code"),
		googleFamilies(rows).join(","),
	);
}

// 4. Search filters every group, case-insensitively.
{
	const rows = buildFontRows({
		installed: ["Arial", "Inter Tight"],
		catalog,
		search: "inter",
		category: "all",
	});
	ok("search filters installed", rows.installed.join(",") === "Inter Tight");
	ok("search filters Google", googleFamilies(rows).join(",") === "Inter");
	ok("search filters the generics out too", rows.generic.length === 0);
}

// 5. A category filter is a statement about Google's catalogue, so it hides
//    the local groups rather than showing them unfiltered underneath.
{
	const rows = buildFontRows({
		installed: ["Arial"],
		catalog,
		search: "",
		category: "serif",
	});
	ok("category hides installed", rows.installed.length === 0);
	ok("category hides generics", rows.generic.length === 0);
	ok(
		"category keeps its own fonts",
		googleFamilies(rows).join(",") === "Merriweather",
	);
}

// 6. "Installed" shows only what is already resolvable — no downloads.
{
	const rows = buildFontRows({
		installed: ["Arial"],
		catalog,
		search: "",
		category: "installed",
	});
	ok("installed-only keeps installed", rows.installed.join(",") === "Arial");
	ok(
		"installed-only keeps generics",
		rows.generic.length === GENERIC_FAMILIES.length,
	);
	ok("installed-only offers no downloads", googleFamilies(rows).length === 0);
}

// 7. The row cap holds across all groups together — this is what keeps the
//    full catalogue out of the DOM.
{
	const big = Array.from({ length: 500 }, (_, i) => ({
		family: `Font ${i}`,
		category: "sans-serif",
	}));
	const rows = buildFontRows({
		installed: [],
		catalog: big,
		search: "",
		category: "all",
	});
	const total =
		rows.generic.length + rows.installed.length + googleFamilies(rows).length;
	ok("total rows are capped", total <= MAX_ROWS, `got ${total}`);
	ok("but the list is not empty", total > 0);
}

// 8. A long installed list cannot crowd out its own cap either.
{
	const many = Array.from({ length: 500 }, (_, i) => `Local ${i}`);
	const rows = buildFontRows({
		installed: many,
		catalog,
		search: "",
		category: "all",
	});
	ok("installed rows are capped", rows.installed.length <= MAX_ROWS);
	ok(
		"a full installed list leaves no room for downloads",
		googleFamilies(rows).length === 0,
	);
}

// 9. Groups are only emitted when they have something in them, so the list
//    never shows an empty heading.
{
	const rows = buildFontRows({
		installed: [],
		catalog,
		search: "lobster",
		category: "all",
	});
	ok("only the matching group is emitted", rows.google.length === 1);
	ok("and it is the right one", rows.google[0]?.id === "display");
}

if (failures > 0) throw new Error(`${failures} font-rows check(s) failed`);
console.log(`ALL PASS (${passes} assertions)`);
