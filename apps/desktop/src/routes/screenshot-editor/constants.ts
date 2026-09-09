import type {
	AspectRatio,
	BackgroundConfiguration,
	FocusConfig,
} from "@/utils/tauri";

/** Mirrors `FocusConfig::default()` in `quiro-project`. Duplicated rather than
 * fetched because a new focus is created client-side and never round-trips
 * through Rust first. Deliberately understated — enabling the tool should read
 * as photographic depth, not as a blurred screenshot. */
export const DEFAULT_FOCUS: FocusConfig = {
	x: 0.5,
	y: 0.5,
	radiusX: 0.2,
	radiusY: 0.16,
	rotation: 0,
	shape: "ellipse",
	blur: 18,
	depth: 26,
	// Low on purpose: this drives a real highlight expansion in linear light,
	// so a little goes a long way on a bright UI screenshot.
	lens: 5,
	nearBlur: 0.55,
	farBlur: 0.55,
};

/** Master strength of a new focus, held just off full so the effect reads as a
 * treatment over the screenshot rather than a replacement of it. Lives on the
 * annotation's `opacity`, not in `FocusConfig`. */
export const DEFAULT_FOCUS_STRENGTH = 0.95;

/** Cap's background swatch palette. */
export const BACKGROUND_COLORS: Array<[number, number, number]> = [
	[255, 0, 0],
	[255, 69, 0],
	[255, 140, 0],
	[255, 215, 0],
	[255, 255, 0],
	[173, 255, 47],
	[50, 205, 50],
	[0, 128, 0],
	[0, 206, 209],
	[71, 133, 255],
	[0, 0, 255],
	[75, 0, 130],
	[128, 0, 128],
	[169, 169, 169],
	[255, 255, 255],
	[0, 0, 0],
];

/** Accessible names for BACKGROUND_COLORS, index-aligned. Swatch buttons read
 * these out instead of a hex string, which a screen reader spells character by
 * character. */
export const BACKGROUND_COLOR_NAMES = [
	"Red",
	"Orange red",
	"Dark orange",
	"Gold",
	"Yellow",
	"Green yellow",
	"Lime green",
	"Green",
	"Dark turquoise",
	"Cornflower blue",
	"Blue",
	"Indigo",
	"Purple",
	"Grey",
	"White",
	"Black",
];

/** Cap's gradient presets, verbatim. */
export const BACKGROUND_GRADIENTS: Array<{
	from: [number, number, number];
	to: [number, number, number];
}> = [
	{ from: [15, 52, 67], to: [52, 232, 158] },
	{ from: [34, 193, 195], to: [253, 187, 45] },
	{ from: [29, 253, 251], to: [195, 29, 253] },
	{ from: [69, 104, 220], to: [176, 106, 179] },
	{ from: [106, 130, 251], to: [252, 92, 125] },
	{ from: [131, 58, 180], to: [253, 29, 29] },
	{ from: [249, 212, 35], to: [255, 78, 80] },
	{ from: [255, 94, 0], to: [255, 42, 104] },
	{ from: [255, 0, 150], to: [0, 204, 255] },
	{ from: [0, 242, 96], to: [5, 117, 230] },
	{ from: [238, 205, 163], to: [239, 98, 159] },
	{ from: [44, 62, 80], to: [52, 152, 219] },
	{ from: [168, 239, 255], to: [238, 205, 163] },
	{ from: [74, 0, 224], to: [143, 0, 255] },
	{ from: [252, 74, 26], to: [247, 183, 51] },
	{ from: [0, 255, 255], to: [255, 20, 147] },
	{ from: [255, 127, 0], to: [255, 255, 0] },
	{ from: [255, 0, 255], to: [0, 255, 0] },
	// "Aozora" (blue sky): misted-sky blue down to river indigo. Reduced from a
	// 4-stop OKLCH mesh gradient with a noise-texture overlay — this renderer
	// only supports a 2-stop linear gradient, so the source's outer two stops
	// (#E6F2FF, #6699E6) stand in for the full ramp.
	{ from: [230, 242, 255], to: [102, 153, 230] },
];

/** Bundled wallpapers, listed the way Cap lists theirs — a static array
 * resolved through `resolveResource` at point of use rather than a backend
 * call. Mirrors `src-tauri/assets/backgrounds`, which `tauri.conf.json`
 * bundles as a resource. */
export const WALLPAPER_FILENAMES = [
	"tahoe-light.jpg",
	"tahoe-dark.jpg",
	"sequoia-blue.jpg",
	"sequoia-blue-orange.jpg",
	"sonoma-light.jpg",
	"sonoma-dark.jpg",
	"sonoma-clouds.jpg",
	"sonoma-evening.jpg",
	"sonoma-horizon.jpg",
	"ventura.jpg",
	"ventura-dark.jpg",
	"ipad-17-light.jpg",
	"ipad-17-dark.jpg",
	"midnight-8.jpg",
	"iridescent-9.jpg",
	"glassmorphism-3.jpg",
	"glassmorphism-4.jpg",
	"energy-17.jpg",
	"energy-19.jpg",
	"levels.jpg",
	"bluerays.jpeg",
	"cherrypop.jpg",
	"lemonade.jpeg",
	"cityscape.jpg",
	"farmvalley.jpg",
	"mountaintrees.jpg",
	"luisdelrio.jpg",
	"wallpaper1.jpg",
	"wallpaper2.jpg",
	"wallpaper3.jpg",
	"wallpaper4.jpg",
	"wallpaper7.jpg",
	"wallpaper9.jpg",
	"wallpaper10.jpg",
	"wallpaper11.jpg",
	"wallpaper12.jpg",
	"wallpaper13.jpg",
	"wallpaper15.jpg",
];

export type BackgroundSourceType = BackgroundConfiguration["source"]["type"];

/** Cap's `ASPECT_RATIOS`, plus their "Auto" (null) entry. Shared by both
 * editors — the same `aspectRatio` field drives the same renderer in each. */
export const ASPECT_RATIO_OPTIONS: Array<{
	label: string;
	value: AspectRatio | null;
}> = [
	{ label: "Auto", value: null },
	{ label: "Wide 16:9", value: "wide" },
	{ label: "Vertical 9:16", value: "vertical" },
	{ label: "Square 1:1", value: "square" },
	{ label: "Classic 4:3", value: "classic" },
	{ label: "Tall 3:4", value: "tall" },
];

export const BACKGROUND_SOURCE_TABS: Array<{
	type: BackgroundSourceType;
	label: string;
}> = [
	{ type: "wallpaper", label: "Wallpaper" },
	{ type: "image", label: "Image" },
	{ type: "color", label: "Color" },
	{ type: "gradient", label: "Gradient" },
];

export function defaultSourceFor(
	type: BackgroundSourceType,
): BackgroundConfiguration["source"] {
	switch (type) {
		case "color":
			return { type: "color", value: DRAFT_COLOR };
		case "gradient":
			return {
				type: "gradient",
				from: DRAFT_GRADIENT.from,
				to: DRAFT_GRADIENT.to,
			};
		case "image":
			return { type: "image", path: null };
		case "wallpaper":
			return { type: "wallpaper", path: null };
	}
}

/** Placeholder values the Color / Gradient pickers show when their tab is
 * open but nothing of that type has been applied yet. Switching to a tab
 * must never write to the project — only picking a concrete value does — so
 * the pickers need something to render in the meantime. */
export const DRAFT_COLOR: [number, number, number] = [71, 133, 255];

export const DRAFT_GRADIENT: {
	from: [number, number, number];
	to: [number, number, number];
	angle: number;
	noise_intensity: number;
} = {
	from: BACKGROUND_GRADIENTS[3].from,
	to: BACKGROUND_GRADIENTS[3].to,
	angle: 90,
	noise_intensity: 0,
};

const DEFAULT_BACKGROUND_SHADOW = 40;

/**
 * Cap's `ensurePaddingForBackground`, and it matters more than it looks:
 * picking a wallpaper while padding is 0 shows you *nothing*, because the
 * screenshot covers the whole canvas. Choosing a visible background nudges
 * padding/rounding/shadow off zero so the choice actually shows — but only
 * when they are still at zero, so it can never stomp deliberate values.
 */
export function ensureVisibleFraming(
	background: BackgroundConfiguration,
): Partial<BackgroundConfiguration> {
	const patch: Partial<BackgroundConfiguration> = {};
	const paddingIsZero = background.padding === 0;

	if (paddingIsZero) patch.padding = 10;
	if (paddingIsZero && background.rounding === 0) patch.rounding = 8;
	if (background.shadow === 0) patch.shadow = DEFAULT_BACKGROUND_SHADOW;

	return patch;
}

/** Inverse guard, also Cap's `hasNoVisibleBackground`: raising padding while
 * the background is invisible would just reveal more nothing, so switch to a
 * visible colour. */
export function ensureVisibleBackground(
	background: BackgroundConfiguration,
): Partial<BackgroundConfiguration> {
	const { source } = background;
	const invisible =
		(source.type === "color" && (source.alpha ?? 255) === 0) ||
		((source.type === "image" || source.type === "wallpaper") && !source.path);

	return invisible
		? { source: { type: "color", value: [255, 255, 255], alpha: 255 } }
		: {};
}
