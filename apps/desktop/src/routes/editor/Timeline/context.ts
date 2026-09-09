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

export function startPlayheadDrag(
	event: React.PointerEvent,
	timeline: TimelineViewport,
	onSeek: (time: number) => void,
	onActiveChange?: (active: boolean) => void,
) {
	event.preventDefault();
	event.stopPropagation();

	let pendingClientX = event.clientX;
	let frame: number | null = null;
	let active = true;

	const flush = () => {
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
		onSeek(timeline.timeAt(pendingClientX));
	};

	const move = (moveEvent: PointerEvent) => {
		pendingClientX = moveEvent.clientX;
		if (frame !== null) return;
		frame = requestAnimationFrame(() => {
			frame = null;
			onSeek(timeline.timeAt(pendingClientX));
		});
	};

	const end = () => {
		if (!active) return;
		active = false;
		flush();
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", end);
		window.removeEventListener("pointercancel", end);
		window.removeEventListener("blur", end);
		onActiveChange?.(false);
	};

	onActiveChange?.(true);
	flush();
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", end);
	window.addEventListener("pointercancel", end);
	window.addEventListener("blur", end);
}

/** Trim handles are this wide where the segment has room for two of them. */
const HANDLE_WIDTH = 24;

/** Width one trim handle gets on a segment `segmentWidth` pixels wide.
 *
 * The start handle is anchored `left-0` and shifted back half its width, the
 * end handle `right-0` and shifted forward half its width, so they occupy
 * `[-w/2, w/2]` and `[segmentWidth - w/2, segmentWidth + w/2]`. Those stay
 * disjoint for as long as `w <= segmentWidth` — the property
 * `handle-geometry.check.ts` asserts, and the reason narrow segments shrink
 * their grips instead of stacking two full-size ones on top of each other. */
export function handleWidthFor(segmentWidth: number) {
	return Math.min(HANDLE_WIDTH, segmentWidth / 2);
}
