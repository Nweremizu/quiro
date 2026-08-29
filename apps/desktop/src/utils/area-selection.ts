import type { DisplayId } from "./tauri";

export type Ratio = readonly [number, number];
export type Bounds = { x: number; y: number; width: number; height: number };

/** Matches Cap's recording minimum — smaller areas encode poorly. */
export const MIN_AREA_SIZE = { width: 150, height: 150 };

export const QUICK_AREA_RATIOS: readonly Ratio[] = [
	[16, 9],
	[4, 3],
	[1, 1],
];

/** Shown in the "more ratios" menu, beyond the three inline presets. */
export const EXTRA_AREA_RATIOS: readonly Ratio[] = [
	[21, 9],
	[3, 2],
	[5, 4],
	[9, 16],
	[2, 3],
	[4, 5],
];

/** Ratios that free-form dragging snaps to when it lands close to one. */
const COMMON_RATIOS: readonly Ratio[] = [
	[1, 1],
	[3, 2],
	[4, 3],
	[16, 9],
	[16, 10],
	[21, 9],
];

/**
 * The common ratio the given size is *almost* at, if any. Both orientations are
 * checked, so a tall selection snaps to 9:16 as readily as a wide one to 16:9.
 */
export function findClosestRatio(
	width: number,
	height: number,
	threshold = 0.01,
): Ratio | null {
	if (height <= 0) return null;
	const current = width / height;

	for (const [a, b] of COMMON_RATIOS) {
		if (Math.abs(current - a / b) < threshold) return [a, b];
		if (Math.abs(current - b / a) < threshold) return [b, a];
	}
	return null;
}

export const AREA_SELECTION_STORAGE_KEY = "target-select-area-preferences-v1";

export type AreaSelectionPreferences = {
	locked: boolean;
	screenId: DisplayId | null;
	bounds: Bounds | null;
	aspectRatio: Ratio | null;
	snapToRatio: boolean;
};

export function createDefaultAreaSelectionPreferences(): AreaSelectionPreferences {
	return {
		locked: false,
		screenId: null,
		bounds: null,
		aspectRatio: null,
		snapToRatio: true,
	};
}

export function ratiosEqual(
	left: Ratio | null | undefined,
	right: Ratio | null | undefined,
): boolean {
	if (!left || !right) return !left && !right;
	return left[0] === right[0] && left[1] === right[1];
}

/**
 * Deliberately a plain boolean, not a `bounds is Bounds` type predicate: this
 * checks *size*, and a predicate would let TypeScript narrow a
 * known-non-null selection to `never` in the "too small" branch, where we
 * still need to render the actual dimensions.
 */
export function isValidAreaBounds(bounds: Bounds | null): boolean {
	return (
		bounds !== null &&
		bounds.width >= MIN_AREA_SIZE.width &&
		bounds.height >= MIN_AREA_SIZE.height
	);
}

export function readAreaSelectionPreferences(): AreaSelectionPreferences {
	try {
		const raw = localStorage.getItem(AREA_SELECTION_STORAGE_KEY);
		if (!raw) return createDefaultAreaSelectionPreferences();
		return {
			...createDefaultAreaSelectionPreferences(),
			...(JSON.parse(raw) as Partial<AreaSelectionPreferences>),
		};
	} catch {
		return createDefaultAreaSelectionPreferences();
	}
}

export function writeAreaSelectionPreferences(
	preferences: AreaSelectionPreferences,
) {
	try {
		localStorage.setItem(
			AREA_SELECTION_STORAGE_KEY,
			JSON.stringify(preferences),
		);
	} catch {
		// Storage can be unavailable (private mode, blocked site data). Losing the
		// remembered area is not worth breaking the picker over.
	}
}

/**
 * The saved area, but only when it's still applicable: same display, actually
 * locked, and large enough to record.
 */
export function getLockedAreaBounds(
	preferences: AreaSelectionPreferences,
	displayId: DisplayId,
): Bounds | null {
	const bounds = preferences.bounds;
	if (!preferences.locked || preferences.screenId !== displayId || !bounds) {
		return null;
	}

	const finite = [bounds.x, bounds.y, bounds.width, bounds.height].every(
		Number.isFinite,
	);
	if (!finite || !isValidAreaBounds(bounds)) return null;

	return { ...bounds };
}

/** The largest box of `ratio` that fits inside `view`, centred. */
export function fillBounds(
	view: { width: number; height: number },
	ratio: Ratio | null,
): Bounds {
	if (!ratio) return { x: 0, y: 0, width: view.width, height: view.height };

	const target = ratio[0] / ratio[1];
	let width = view.width;
	let height = width / target;

	if (height > view.height) {
		height = view.height;
		width = height * target;
	}

	return {
		x: (view.width - width) / 2,
		y: (view.height - height) / 2,
		width,
		height,
	};
}
