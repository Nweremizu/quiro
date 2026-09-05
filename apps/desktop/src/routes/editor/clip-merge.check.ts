// Self-check for clip merging. Run via `pnpm check`, or alone:
//
//   npx esbuild src/routes/editor/clip-merge.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/cm.cjs && node /tmp/cm.cjs
//
// The property that matters: merge must be the exact inverse of split, and must
// refuse every pair that is not a split pair. Getting the refusal wrong is the
// dangerous direction — it silently restores footage the user trimmed away, or
// retimes half a clip, with no visible cue that it happened.

import {
	canMergeSpanWithNext,
	canMergeSpanWithPrevious,
	canMergeWithNext,
	canMergeWithPrevious,
	clipsAreContiguous,
	type MergeableClip,
	mergeClips,
	mergeSpans,
	spansAreMergeable,
} from "./clip-merge";
import {
	type ClipTransition,
	transitionsAfterClipMerge,
} from "./clip-transitions";

function assert(condition: boolean, message: string) {
	if (!condition) throw new Error(message);
}

let assertions = 0;
function check(condition: boolean, message: string) {
	assert(condition, message);
	assertions++;
}

const clip = (
	start: number,
	end: number,
	extra: Partial<MergeableClip> = {},
): MergeableClip => ({
	start,
	end,
	timescale: 1,
	recordingSegment: 0,
	...extra,
});

// --- split/merge round-trip -------------------------------------------------
// Exactly what `splitAt` produces: one segment replaced by two sharing the cut.
const split = [clip(0, 4), clip(4, 10)];
check(clipsAreContiguous(split[0], split[1]), "split halves are contiguous");

const rejoined = mergeClips(split, 0);
check(rejoined.length === 1, "merging a split pair yields one clip");
check(
	rejoined[0].start === 0 && rejoined[0].end === 10,
	"the rejoined clip spans both halves",
);

// Duration is preserved, which is why no other track has to ripple.
const before = split.reduce((t, c) => t + (c.end - c.start) / c.timescale, 0);
const after = rejoined.reduce((t, c) => t + (c.end - c.start) / c.timescale, 0);
check(before === after, "merging preserves total duration");

// --- refusals ---------------------------------------------------------------
check(
	!clipsAreContiguous(clip(0, 4), clip(5, 10)),
	"a trimmed gap is not contiguous — merging would restore cut footage",
);
check(
	!clipsAreContiguous(clip(0, 4), clip(4, 10, { recordingSegment: 1 })),
	"clips from different recordings never merge",
);
check(
	!clipsAreContiguous(clip(0, 4), clip(4, 10, { timescale: 2 })),
	"differing speeds never merge — one half would be silently retimed",
);
check(
	!clipsAreContiguous(undefined, clip(0, 4)),
	"a missing left clip is safe",
);
check(
	!clipsAreContiguous(clip(0, 4), undefined),
	"a missing right clip is safe",
);

const refused = mergeClips([clip(0, 4), clip(5, 10)], 0);
check(refused.length === 2, "a refused merge leaves the list untouched");

// --- context-awareness (what enables each menu item) ------------------------
const three = [clip(0, 4), clip(4, 8), clip(9, 12)];
check(!canMergeWithPrevious(three, 0), "the first clip has no previous");
check(canMergeWithNext(three, 0), "clip 0 continues into clip 1");
check(canMergeWithPrevious(three, 1), "clip 1 follows clip 0");
check(
	!canMergeWithNext(three, 1),
	"clip 1 does not reach clip 2 across the gap",
);
check(!canMergeWithPrevious(three, 2), "clip 2 is separated by a gap");
check(!canMergeWithNext(three, 2), "the last clip has no next");
check(!canMergeWithNext([clip(0, 4)], 0), "a lone clip cannot merge");

// --- transition bookkeeping -------------------------------------------------
// Merging 1 and 2: the boundary at 2 disappears, 1 survives, 3 shifts down.
const transitions: ClipTransition[] = [
	{ segmentIndex: 1, type: "cross-fade", duration: 0.5 },
	{ segmentIndex: 2, type: "cross-fade", duration: 0.5 },
	{ segmentIndex: 3, type: "cross-fade", duration: 0.5 },
];
const merged = transitionsAfterClipMerge(transitions, 1);
check(merged.length === 2, "the boundary transition is removed");
check(
	merged.some((t) => t.segmentIndex === 1),
	"the merged clip's leading transition survives",
);
check(
	merged.some((t) => t.segmentIndex === 2),
	"later transitions shift down by one",
);
check(
	!merged.some((t) => t.segmentIndex === 3),
	"no transition is left pointing past the shortened list",
);

// --- overlay spans (zoom, scene, mask, text) --------------------------------
const span = (start: number, end: number, track?: number) => ({
	start,
	end,
	...(track === undefined ? {} : { track }),
});

check(spansAreMergeable(span(0, 2), span(2, 4)), "touching spans merge");
check(
	!spansAreMergeable(span(0, 2), span(2.5, 4)),
	"a gap the user left is not closed silently",
);
check(
	!spansAreMergeable(span(0, 2, 0), span(2, 4, 1)),
	"spans in different lanes never merge — one would jump lanes",
);
check(
	spansAreMergeable(span(0, 2, 2), span(2, 4, 2)),
	"same-lane touching spans merge",
);

const spans = [span(0, 2), span(2, 4), span(5, 7)];
check(canMergeSpanWithNext(spans, 0), "span 0 touches span 1");
check(canMergeSpanWithPrevious(spans, 1), "span 1 follows span 0");
check(!canMergeSpanWithNext(spans, 1), "span 1 does not reach span 2");
check(!canMergeSpanWithPrevious(spans, 0), "the first span has no previous");
check(!canMergeSpanWithNext(spans, 2), "the last span has no next");

const mergedSpans = mergeSpans(spans, 0);
check(mergedSpans.length === 2, "merging spans shortens the list");
check(
	mergedSpans[0].start === 0 && mergedSpans[0].end === 4,
	"the merged span covers both",
);
check(
	mergeSpans(spans, 1).length === 3,
	"a refused span merge leaves the list untouched",
);

console.log(`clip-merge: ALL PASS (${assertions} assertions)`);
