import type { TimelineSegment } from "@/utils/tauri";

// Rejoining clips that a split separated — the exact inverse of `splitAt` in
// `Timeline/index.tsx`, which replaces one segment with `{...segment, end: cut}`
// and `{...segment, start: cut}`.
//
// Merging is duration-preserving: the joined clip spans the same timeline time
// the two halves did, so no other track has to ripple. The one exception is a
// transition sitting on the boundary, which overlaps its neighbours and so
// subtracts from the total — `transitionsAfterClipMerge` drops it, and the
// timeline lengthens by that much.

/** Two halves of a split share a source instant *exactly*: `splitAt` writes the
 * same number to one clip's `end` and the next clip's `start`. So the tolerance
 * here is for float rounding only, never for closing a gap. Anything wider is a
 * trim the user made deliberately, and rejoining across it would silently
 * restore footage they cut. */
const CONTIGUOUS_EPSILON = 1e-6;

/** The fields merging actually reads. Narrower than `TimelineSegment` so the
 * check file can exercise this without the generated bindings. */
export type MergeableClip = Pick<
	TimelineSegment,
	"start" | "end" | "timescale" | "recordingSegment"
>;

/** Whether `right` continues `left` with no cut between them. */
export function clipsAreContiguous(
	left: MergeableClip | undefined,
	right: MergeableClip | undefined,
): boolean {
	if (!left || !right) return false;
	// Different source recordings never join: the result would jump.
	if ((left.recordingSegment ?? 0) !== (right.recordingSegment ?? 0))
		return false;
	// Differing speeds would have to pick one, silently retiming half the
	// footage. Leave it to the user to match them first.
	if (left.timescale !== right.timescale) return false;
	return Math.abs(left.end - right.start) <= CONTIGUOUS_EPSILON;
}

export function canMergeWithPrevious(
	segments: MergeableClip[],
	index: number,
): boolean {
	return index > 0 && clipsAreContiguous(segments[index - 1], segments[index]);
}

export function canMergeWithNext(
	segments: MergeableClip[],
	index: number,
): boolean {
	return (
		index >= 0 &&
		index < segments.length - 1 &&
		clipsAreContiguous(segments[index], segments[index + 1])
	);
}

/** Joins the clip at `index` with the one after it.
 *
 * The left clip wins every per-clip setting — name, speed mode, transform,
 * perspective, motion — because the merged clip has to have exactly one of
 * each. Straight after a split both halves carry identical values, so this only
 * discards something once the user has changed one half on its own. Returns the
 * list unchanged when the pair cannot merge. */
export function mergeClips<T extends MergeableClip>(
	segments: T[],
	index: number,
): T[] {
	const left = segments[index];
	const right = segments[index + 1];
	if (!clipsAreContiguous(left, right)) return segments;

	return [
		...segments.slice(0, index),
		{ ...left, end: right.end },
		...segments.slice(index + 2),
	];
}

// --- overlay segments (zoom, scene, mask, text) -----------------------------
//
// These sit in *timeline* time rather than source time, and carry no recording
// or speed of their own, so adjacency is the only question. They also live in
// lanes: two segments that overlap visually may be stacked rather than
// sequential, and merging across lanes would silently move one of them.

export type MergeableSpan = {
	start: number;
	end: number;
	/** Lane, for tracks that stack. Absent means a single-lane track. */
	track?: number | null;
};

/** Whether `right` begins exactly where `left` ends, in the same lane.
 *
 * Strict for the same reason clips are: a gap between two segments is a gap the
 * user left, and closing it would extend the effect over footage they chose to
 * leave alone. */
export function spansAreMergeable(
	left: MergeableSpan | undefined,
	right: MergeableSpan | undefined,
): boolean {
	if (!left || !right) return false;
	if ((left.track ?? 0) !== (right.track ?? 0)) return false;
	return Math.abs(left.end - right.start) <= CONTIGUOUS_EPSILON;
}

export function canMergeSpanWithPrevious(
	spans: MergeableSpan[],
	index: number,
): boolean {
	return index > 0 && spansAreMergeable(spans[index - 1], spans[index]);
}

export function canMergeSpanWithNext(
	spans: MergeableSpan[],
	index: number,
): boolean {
	return (
		index >= 0 &&
		index < spans.length - 1 &&
		spansAreMergeable(spans[index], spans[index + 1])
	);
}

/** Joins the span at `index` with the one after it, keeping the left one's
 * settings — its zoom amount, mask mode, text and so on. Returns the list
 * unchanged when the pair cannot merge. */
export function mergeSpans<T extends MergeableSpan>(
	spans: T[],
	index: number,
): T[] {
	const left = spans[index];
	const right = spans[index + 1];
	if (!spansAreMergeable(left, right)) return spans;

	return [
		...spans.slice(0, index),
		{ ...left, end: right.end },
		...spans.slice(index + 2),
	];
}
