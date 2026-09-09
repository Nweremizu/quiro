import type { ZoomSegment } from "@/utils/tauri";

export const MIN_ZOOM_DURATION = 0.3;

export type ZoomDuplicatePlan =
	| { status: "exact"; segment: ZoomSegment }
	| { status: "trim"; segment: ZoomSegment; availableDuration: number }
	| { status: "blocked" };

const TIME_EPSILON = 0.000_001;

export function planZoomDuplicate(
	segments: ZoomSegment[],
	index: number,
	timelineDuration: number,
): ZoomDuplicatePlan {
	const source = segments[index];
	if (!source) return { status: "blocked" };

	const start = source.end;
	const duration = source.end - source.start;
	let availableEnd = timelineDuration;

	for (const [otherIndex, other] of segments.entries()) {
		if (otherIndex === index || other.end <= start + TIME_EPSILON) continue;
		if (other.start <= start + TIME_EPSILON) return { status: "blocked" };
		availableEnd = Math.min(availableEnd, other.start);
	}

	const availableDuration = Math.max(0, availableEnd - start);
	if (duration <= availableDuration + TIME_EPSILON) {
		return {
			status: "exact",
			segment: {
				...source,
				start,
				end: Math.min(start + duration, availableEnd),
			},
		};
	}

	if (availableDuration + TIME_EPSILON < MIN_ZOOM_DURATION) {
		return { status: "blocked" };
	}

	return {
		status: "trim",
		segment: { ...source, start, end: availableEnd },
		availableDuration,
	};
}
