import { describe, expect, it } from "vitest";
import {
	getTimelineContentMinHeightPx,
	getTimelineDensityConfig,
	getTimelineRowsMinHeightPx,
	getTimelineViewportStretchFactor,
	TIMELINE_AXIS_HEIGHT_PX,
	TIMELINE_ROW_MIN_HEIGHT_PX,
	TIMELINE_VISIBLE_ROW_COUNT,
} from "./timelineLayout";

describe("timelineLayout", () => {
	it("reserves vertical space for every rendered timeline row", () => {
		expect(getTimelineRowsMinHeightPx(5)).toBe(5 * TIMELINE_ROW_MIN_HEIGHT_PX);
		expect(getTimelineContentMinHeightPx(5)).toBe(
			TIMELINE_AXIS_HEIGHT_PX + 5 * TIMELINE_ROW_MIN_HEIGHT_PX,
		);
	});

	it("ignores invalid row counts", () => {
		expect(getTimelineRowsMinHeightPx(-1)).toBe(0);
		expect(getTimelineRowsMinHeightPx(Number.NaN)).toBe(0);
		expect(getTimelineContentMinHeightPx(Number.POSITIVE_INFINITY)).toBe(
			TIMELINE_AXIS_HEIGHT_PX,
		);
	});

	it("floors fractional row counts", () => {
		expect(getTimelineRowsMinHeightPx(2.9)).toBe(2 * TIMELINE_ROW_MIN_HEIGHT_PX);
		expect(getTimelineContentMinHeightPx(2.9)).toBe(
			TIMELINE_AXIS_HEIGHT_PX + 2 * TIMELINE_ROW_MIN_HEIGHT_PX,
		);
	});

	it("stretches content height to keep a two-row viewport", () => {
		expect(TIMELINE_VISIBLE_ROW_COUNT).toBe(2);
		expect(getTimelineViewportStretchFactor(2)).toBe(1);
		expect(getTimelineViewportStretchFactor(4)).toBe(2);
		expect(getTimelineViewportStretchFactor(5)).toBe(2.5);
		expect(getTimelineViewportStretchFactor(0)).toBe(1);
	});

	it("applies compact and detailed density dimensions", () => {
		expect(getTimelineDensityConfig("compact").rowMinHeightPx).toBeLessThan(
			TIMELINE_ROW_MIN_HEIGHT_PX,
		);
		expect(getTimelineRowsMinHeightPx(3, "compact")).toBe(
			3 * getTimelineDensityConfig("compact").rowMinHeightPx,
		);
		expect(getTimelineContentMinHeightPx(3, "detailed")).toBe(
			getTimelineDensityConfig("detailed").axisHeightPx +
				3 * getTimelineDensityConfig("detailed").rowMinHeightPx,
		);
		expect(getTimelineViewportStretchFactor(3, "compact")).toBe(1);
		expect(getTimelineViewportStretchFactor(3, "detailed")).toBe(1.5);
	});
});
