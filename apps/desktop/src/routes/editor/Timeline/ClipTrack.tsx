import type { TimelineSegment } from "@/utils/tauri";
import { useEditorContext } from "../context";
import { useTimeline } from "./context";
import { SegmentContent, SegmentHandle, SegmentRoot } from "./Track";

/** Source seconds a segment occupies on the timeline, after its speed. */
export function segmentDuration(segment: TimelineSegment) {
	return (segment.end - segment.start) / (segment.timescale || 1);
}

/** Timeline start of each segment, in order. */
export function segmentOffsets(segments: TimelineSegment[]) {
	let offset = 0;
	return segments.map((segment) => {
		const start = offset;
		offset += segmentDuration(segment);
		return start;
	});
}

const MIN_SEGMENT_DURATION = 0.1;

export function ClipTrack({ onSplit }: { onSplit: (time: number) => void }) {
	const { project, setProject, selection, setSelection, splitMode } =
		useEditorContext();
	const timeline = useTimeline();

	const segments = project?.timeline?.segments ?? [];
	const offsets = segmentOffsets(segments);

	const updateSegment = (
		index: number,
		update: (segment: TimelineSegment) => TimelineSegment,
	) => {
		setProject((current) => {
			if (!current.timeline) return current;
			const next = current.timeline.segments.map((segment, i) =>
				i === index ? update(segment) : segment,
			);
			return { ...current, timeline: { ...current.timeline, segments: next } };
		});
	};

	return (
		<>
			{segments.map((segment, index) => {
				const width = Math.max(
					segmentDuration(segment) * timeline.pixelsPerSecond,
					8,
				);
				const selected =
					selection?.type === "clip" && selection.index === index;

				return (
					<SegmentRoot
						key={`${segment.recordingSegment ?? 0}-${segment.start}-${segment.end}`}
						color="var(--track-clip)"
						selected={selected}
						left={timeline.xOf(offsets[index])}
						width={width}
						handles={
							<>
								<SegmentHandle
									position="start"
									width={width}
									label={`Trim clip ${index + 1} start`}
									value={segment.start}
									min={0}
									max={segment.end - MIN_SEGMENT_DURATION}
									onAdjust={(delta) => {
										const initial = segment.start;
										const timescale = segment.timescale || 1;
										updateSegment(index, (current) => ({
											...current,
											start: Math.min(
												Math.max(0, initial + delta * timescale),
												current.end - MIN_SEGMENT_DURATION,
											),
										}));
									}}
								/>
								<SegmentHandle
									position="end"
									width={width}
									label={`Trim clip ${index + 1} end`}
									value={segment.end}
									min={segment.start + MIN_SEGMENT_DURATION}
									max={Number.POSITIVE_INFINITY}
									onAdjust={(delta) => {
										const initial = segment.end;
										const timescale = segment.timescale || 1;
										updateSegment(index, (current) => ({
											...current,
											end: Math.max(
												current.start + MIN_SEGMENT_DURATION,
												initial + delta * timescale,
											),
										}));
									}}
								/>
							</>
						}
						className={splitMode ? "timeline-scissors-cursor" : undefined}
						onPointerDown={(event) => {
							// Selecting or splitting a clip must not also scrub the
							// playhead, which is what the timeline background does.
							event.stopPropagation();
							if (splitMode) {
								onSplit(timeline.timeAt(event.clientX));
								return;
							}
							setSelection({ type: "clip", index });
						}}
					>
						<SegmentContent width={width} className="justify-center">
							<span className="pointer-events-none truncate text-[0.625rem] font-semibold tabular-nums text-[var(--track-label)]">
								{segmentDuration(segment).toFixed(1)}s
								{segment.timescale !== 1 ? ` · ${segment.timescale}x` : ""}
							</span>
						</SegmentContent>

					</SegmentRoot>
				);
			})}
		</>
	);
}
