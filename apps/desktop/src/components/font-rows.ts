// The font picker's list-building, kept apart from the component so it can
// be checked without React or the generated bindings in the bundle (see
// `font-rows.check.ts`). Everything here is pure: given what is installed,
// what Google offers, and what the user typed, it decides which rows the
// popover shows.

/** Google's category strings, in the order the list shows them. */
export const CATEGORIES = [
	{ id: "sans-serif", label: "Sans Serif" },
	{ id: "serif", label: "Serif" },
	{ id: "display", label: "Display" },
	{ id: "handwriting", label: "Handwriting" },
	{ id: "monospace", label: "Monospace" },
] as const;

/** The CSS generics the renderer pins per platform (`layers/mod.rs`'s
 * `new_font_system`) and that the text model defaults to. They are not
 * fontdb family names, so they never appear in `listFontFamilies()` — but
 * they are always valid, and a document already using one needs to be able
 * to find it here. */
export const GENERIC_FAMILIES = ["sans-serif", "serif", "monospace"];

/** Rendering every one of Google's ~1900 families would put ~1900 rows in
 * the DOM and ask Google for ~1900 preview subsets. The list is cut to this
 * many *after* filtering, which is what makes searching the full catalogue
 * cheap — the search box is the way to reach anything past the cut. */
export const MAX_ROWS = 60;

export type CatalogEntry = { family: string; category: string };

export type FontRows = {
	/** Always-valid CSS generics. */
	generic: string[];
	/** Families the shaping engine can already resolve. */
	installed: string[];
	/** Google families that would be downloaded on pick, grouped in
	 * `CATEGORIES` order and already excluding anything installed. */
	google: Array<{ id: string; label: string; fonts: CatalogEntry[] }>;
};

export function buildFontRows({
	installed,
	catalog,
	search,
	category,
}: {
	installed: string[];
	catalog: CatalogEntry[];
	search: string;
	/** `"all"`, `"installed"`, or one of `CATEGORIES`' ids. */
	category: string;
}): FontRows {
	const query = search.trim().toLowerCase();
	const matches = (name: string) =>
		!query || name.toLowerCase().includes(query);

	// A Google category filter is a statement about Google's catalogue, so
	// it hides the two local groups entirely rather than showing them
	// unfiltered underneath it.
	const localVisible = category === "all" || category === "installed";
	const generic = localVisible ? GENERIC_FAMILIES.filter(matches) : [];
	const installedRows = localVisible
		? installed.filter(matches).slice(0, MAX_ROWS)
		: [];

	const installedLower = new Set(installed.map((name) => name.toLowerCase()));
	const remaining = MAX_ROWS - installedRows.length - generic.length;

	const googleRows =
		category === "installed" || remaining <= 0
			? []
			: catalog
					.filter(
						(font) =>
							// Already resolvable locally — it would otherwise appear
							// twice, once as instant and once as a download.
							!installedLower.has(font.family.toLowerCase()) &&
							matches(font.family) &&
							(category === "all" || font.category === category),
					)
					.slice(0, remaining);

	return {
		generic,
		installed: installedRows,
		google: CATEGORIES.map((entry) => ({
			id: entry.id,
			label: entry.label,
			fonts: googleRows.filter((font) => font.category === entry.id),
		})).filter((group) => group.fonts.length > 0),
	};
}
