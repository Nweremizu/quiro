import type { TimelineSegment } from "@/utils/tauri";
import IconLucideArrowLeftToLine from "~icons/lucide/arrow-left-to-line";
import IconLucideArrowRightToLine from "~icons/lucide/arrow-right-to-line";
import IconLucideScissors from "~icons/lucide/scissors";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import { canMergeWithNext, canMergeWithPrevious } from "../clip-merge";
import { useEditorContext } from "../context";
import { useTimeline } from "./context";
import { TimelineContextMenu } from "./TimelineContextMenu";
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

export function ClipTrack({
	onSplit,
	onMerge,
	onDelete,
}: {
	onSplit: (time: number) => void;
	/** Joins the clip at `index` with the one after it. */
	onMerge: (index: number) => void;
	onDelete: (index: number) => void;
}) {
	const { project, setProject, selection, setSelection, splitMode, playback } =
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
					<TimelineContextMenu
						key={`${segment.recordingSegment ?? 0}-${segment.start}-${segment.end}`}
						items={[
							{
								icon: <IconLucideArrowLeftToLine className="size-4" />,
								label: "Merge with previous",
								disabled: !canMergeWithPrevious(segments, index),
								onClick: () => onMerge(index - 1),
							},
							{
								icon: <IconLucideArrowRightToLine className="size-4" />,
								label: "Merge with next",
								disabled: !canMergeWithNext(segments, index),
								onClick: () => onMerge(index),
							},
							{ separator: true },
							{
								icon: <IconLucideScissors className="size-4" />,
								label: "Split at playhead",
								onClick: () => onSplit(playback.getTime()),
							},
							{ separator: true },
							{
								icon: <IconLucideTrash2 className="size-4" />,
								label: "Delete clip",
								destructive: true,
								onClick: () => onDelete(index),
							},
						]}
					>
						<SegmentRoot
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
					</TimelineContextMenu>
				);
			})}
		</>
	);
}
