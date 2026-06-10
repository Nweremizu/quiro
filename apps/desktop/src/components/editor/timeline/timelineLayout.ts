export const TIMELINE_AXIS_HEIGHT_PX = 32;
export const TIMELINE_ROW_MIN_HEIGHT_PX = 28;
export const TIMELINE_VISIBLE_ROW_COUNT = 2;

export type TimelineDensityMode = "compact" | "comfortable" | "detailed";

export const DEFAULT_TIMELINE_DENSITY_MODE: TimelineDensityMode =
	"comfortable";

export const TIMELINE_DENSITY_OPTIONS: Array<{
	mode: TimelineDensityMode;
	label: string;
	description: string;
}> = [
	{
		mode: "compact",
		label: "Compact",
		description: "Shorter rows with less item detail.",
	},
	{
		mode: "comfortable",
		label: "Comfortable",
		description: "Balanced timeline spacing.",
	},
	{
		mode: "detailed",
		label: "Detailed",
		description: "Taller rows with richer item detail.",
	},
];

const TIMELINE_DENSITY_CONFIG: Record<
	TimelineDensityMode,
	{
		axisHeightPx: number;
		rowMinHeightPx: number;
		visibleRowCount: number;
		itemHeightPercent: number;
		itemMinHeightPx: number;
		iconClassName: string;
		primaryLabelClassName: string;
		secondaryLabelClassName: string;
		showSecondaryItemLabel: boolean;
		keyframeTopPx: number;
	}
> = {
	compact: {
		axisHeightPx: 26,
		rowMinHeightPx: 22,
		visibleRowCount: 3,
		itemHeightPercent: 78,
		itemMinHeightPx: 18,
		iconClassName: "w-3 h-3",
		primaryLabelClassName: "text-[10px]",
		secondaryLabelClassName: "text-[8px]",
		showSecondaryItemLabel: false,
		keyframeTopPx: 25,
	},
	comfortable: {
		axisHeightPx: TIMELINE_AXIS_HEIGHT_PX,
		rowMinHeightPx: TIMELINE_ROW_MIN_HEIGHT_PX,
		visibleRowCount: TIMELINE_VISIBLE_ROW_COUNT,
		itemHeightPercent: 85,
		itemMinHeightPx: 22,
		iconClassName: "w-3.5 h-3.5",
		primaryLabelClassName: "text-[11px]",
		secondaryLabelClassName: "text-[9px]",
		showSecondaryItemLabel: true,
		keyframeTopPx: TIMELINE_AXIS_HEIGHT_PX,
	},
	detailed: {
		axisHeightPx: 36,
		rowMinHeightPx: 38,
		visibleRowCount: 2,
		itemHeightPercent: 88,
		itemMinHeightPx: 28,
		iconClassName: "w-4 h-4",
		primaryLabelClassName: "text-[12px]",
		secondaryLabelClassName: "text-[10px]",
		showSecondaryItemLabel: true,
		keyframeTopPx: 36,
	},
};

export function normalizeTimelineDensityMode(
	value: unknown,
	fallback: TimelineDensityMode = DEFAULT_TIMELINE_DENSITY_MODE,
): TimelineDensityMode {
	return value === "compact" || value === "comfortable" || value === "detailed"
		? value
		: fallback;
}

export function getTimelineDensityConfig(mode: TimelineDensityMode) {
	return TIMELINE_DENSITY_CONFIG[normalizeTimelineDensityMode(mode)];
}

function normalizeRowCount(rowCount: number) {
	if (!Number.isFinite(rowCount)) {
		return 0;
	}

	return Math.max(0, Math.floor(rowCount));
}

export function getTimelineAxisHeightPx(
	densityMode: TimelineDensityMode = DEFAULT_TIMELINE_DENSITY_MODE,
) {
	return getTimelineDensityConfig(densityMode).axisHeightPx;
}

export function getTimelineRowMinHeightPx(
	densityMode: TimelineDensityMode = DEFAULT_TIMELINE_DENSITY_MODE,
) {
	return getTimelineDensityConfig(densityMode).rowMinHeightPx;
}

export function getTimelineRowsMinHeightPx(
	rowCount: number,
	densityMode: TimelineDensityMode = DEFAULT_TIMELINE_DENSITY_MODE,
) {
	return normalizeRowCount(rowCount) * getTimelineRowMinHeightPx(densityMode);
}

export function getTimelineContentMinHeightPx(
	rowCount: number,
	densityMode: TimelineDensityMode = DEFAULT_TIMELINE_DENSITY_MODE,
) {
	return (
		getTimelineAxisHeightPx(densityMode) +
		getTimelineRowsMinHeightPx(rowCount, densityMode)
	);
}

export function getTimelineViewportStretchFactor(
	rowCount: number,
	densityMode: TimelineDensityMode = DEFAULT_TIMELINE_DENSITY_MODE,
) {
	const normalizedRowCount = normalizeRowCount(rowCount);
	const visibleRowCount = getTimelineDensityConfig(densityMode).visibleRowCount;

	if (normalizedRowCount <= 0) {
		return 1;
	}

	return Math.max(1, normalizedRowCount / visibleRowCount);
}
