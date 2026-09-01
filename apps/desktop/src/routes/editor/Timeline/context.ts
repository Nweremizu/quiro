import { createContext, useContext } from "react";

export type TimelineViewport = {
	/** Horizontal pixels one second of timeline occupies. */
	pixelsPerSecond: number;
	duration: number;
	/** Seconds at the left edge of the visible window. */
	position: number;
	/** Timeline time under a clientX, clamped to the timeline's bounds. */
	timeAt: (clientX: number) => number;
	/** Pixels from the left edge of the track area for a timeline time. */
	xOf: (time: number) => number;
	/** Edges other segments can snap to, in seconds. */
	snapTargets: number[];
};

const TimelineContext = createContext<TimelineViewport | null>(null);

export const TimelineProvider = TimelineContext.Provider;

export function useTimeline() {
	const value = useContext(TimelineContext);
	if (!value) throw new Error("useTimeline used outside its provider");
	return value;
}

/** Magnetic radius for timeline edge snapping, in pixels. */
const SNAP_PX = 6;

/** Pulls a time onto the nearest segment edge or ruler tick within the
 * magnetic radius, so butting two segments together doesn't require pixel
 * accuracy. Returns the time unchanged when nothing is close. */
export function snapTime(time: number, timeline: TimelineViewport) {
	if (timeline.pixelsPerSecond <= 0) return time;

	const radius = SNAP_PX / timeline.pixelsPerSecond;
	let best = time;
	let bestDistance = radius;

	for (const target of timeline.snapTargets) {
		const distance = Math.abs(target - time);
		if (distance < bestDistance) {
			best = target;
			bestDistance = distance;
		}
	}

	return best;
}

/** Pointer drag helper shared by every track: reports the timeline delta in
 * seconds while dragging, and cleans up on release. Tracks only have to say
 * what to do with the delta. */
export function startTimeDrag(
	event: React.PointerEvent,
	timeline: TimelineViewport,
	onMove: (deltaSeconds: number, time: number) => void,
	onEnd?: () => void,
) {
	event.preventDefault();
	event.stopPropagation();

	const startX = event.clientX;
	const startTime = timeline.timeAt(startX);

	const move = (moveEvent: PointerEvent) => {
		const deltaSeconds =
			(moveEvent.clientX - startX) / timeline.pixelsPerSecond;
		onMove(deltaSeconds, startTime + deltaSeconds);
	};

	const up = () => {
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		onEnd?.();
	};

	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
}
