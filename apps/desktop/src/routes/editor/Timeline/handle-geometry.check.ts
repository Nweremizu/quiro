// Self-check for the trim-handle geometry. Run via `pnpm check`, or alone:
//
//   npx esbuild src/routes/editor/Timeline/handle-geometry.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/hg.cjs && node /tmp/hg.cjs
//
// The property that matters: a segment's start and end handles must never
// overlap. They are anchored to opposite edges and each shifted out by half
// its width, so their spans are [-w/2, w/2] and [seg - w/2, seg + w/2]. Those
// are disjoint exactly while w <= seg. Timeline segments clamp to a floor of
// 8px, so this has to hold at widths far below one handle's target size —
// where two 24px grips would otherwise land entirely on top of each other and
// make the start edge unpickable.

import { handleWidthFor } from "./context";

function assert(condition: boolean, message: string) {
	if (!condition) throw new Error(message);
}

/** The floor `ClipTrack`, `ZoomTrack` and `SegmentTrack` clamp segments to. */
const MIN_SEGMENT_WIDTH = 8;

const widths = [
	MIN_SEGMENT_WIDTH,
	9,
	12,
	23,
	24,
	40,
	47,
	48,
	49,
	100,
	1000,
	10_000,
];

for (const segmentWidth of widths) {
	const width = handleWidthFor(segmentWidth);

	assert(width > 0, `handle vanished at segment width ${segmentWidth}`);
	assert(
		width <= segmentWidth,
		`handles overlap at segment width ${segmentWidth}: two ${width}px grips on ${segmentWidth}px`,
	);

	// Spelled out rather than inferred, so the check fails if the anchoring in
	// `SegmentHandle` ever stops matching what `handleWidthFor` documents.
	const startSpanEnd = width / 2;
	const endSpanStart = segmentWidth - width / 2;
	assert(
		startSpanEnd <= endSpanStart,
		`spans intersect at segment width ${segmentWidth}: start ends at ${startSpanEnd}, end begins at ${endSpanStart}`,
	);
}

// Above the point where two full-size handles fit, the handle stops shrinking.
assert(
	handleWidthFor(48) === 24 && handleWidthFor(10_000) === 24,
	"handle should cap at its 24px target once the segment is wide enough",
);

console.log(`handle-geometry: ${widths.length} widths OK`);
