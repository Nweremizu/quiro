import { cn } from "@quiro/ui";
import { useState } from "react";
import { VideoIcon } from "@/components/custom-quiro-cam";
import { GaugeIcon } from "@/components/custom-quiro-clock";
import type { TimelineSegment } from "@/utils/tauri";
import IconLucideArrowLeftToLine from "~icons/lucide/arrow-left-to-line";
import IconLucideArrowRightToLine from "~icons/lucide/arrow-right-to-line";
import IconLucideScissors from "~icons/lucide/scissors";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import { canMergeWithNext, canMergeWithPrevious } from "../clip-merge";
import { useEditorContext } from "../context";
import { useTimeline } from "./context";
import { MergeOverlay, SplitCursor } from "./TimelineActionOverlay";
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
	mergeTime,
	mergePreviewFrozen = false,
}: {
	onSplit: (time: number) => void;
	/** Joins the clip at `index` with the one after it. */
	onMerge: (index: number) => void;
	onDelete: (index: number) => void;
	mergeTime?: number | null;
	mergePreviewFrozen?: boolean;
}) {
	const { project, setProject, selection, setSelection, splitMode, playback } =
		useEditorContext();
	const timeline = useTimeline();

	const segments = project?.timeline?.segments ?? [];
	const offsets = segmentOffsets(segments);
	const [splitCursor, setSplitCursor] = useState<{
		x: number;
		y: number;
	} | null>(null);

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
			{splitMode && splitCursor ? <SplitCursor position={splitCursor} /> : null}
			{mergeTime != null ? (
				<MergeOverlay
					left={timeline.xOf(mergeTime)}
					frozen={mergePreviewFrozen}
				/>
			) : null}
			{segments.map((segment, index) => {
				const width = Math.max(
					segmentDuration(segment) * timeline.pixelsPerSecond,
					8,
				);
				const selected =
					selection?.type === "clip" && selection.index === index;
				const segmentStart = offsets[index];
				const segmentEnd = segmentStart + segmentDuration(segment);
				const mergeLeft =
					mergeTime != null && Math.abs(segmentEnd - mergeTime) < 0.001;
				const mergeRight =
					mergeTime != null && Math.abs(segmentStart - mergeTime) < 0.001;

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
							className={cn(
								splitMode && "timeline-scissors-cursor",
								mergeLeft &&
									(mergePreviewFrozen
										? "timeline-merge-preview-left"
										: "timeline-merge-nudge-left"),
								mergeRight &&
									(mergePreviewFrozen
										? "timeline-merge-preview-right"
										: "timeline-merge-nudge-right"),
							)}
							onPointerMove={(event) =>
								splitMode &&
								setSplitCursor({ x: event.clientX, y: event.clientY })
							}
							onPointerLeave={() => setSplitCursor(null)}
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
								<div className="flex gap-2.5 pointer-events-none truncate text-xs font-semibold tabular-nums text-gray-11 dark:text-gray-a11">
									<span className="flex items-center gap-1 font-sans text-gray-a12">
										<VideoIcon
											fillColor="var(--gray-a12)"
											strokeColor="var(--gray-a10)"
											strokeWidth={1.5}
											className="size-4 shrink-0"
										/>
										{segmentDuration(segment).toFixed(1)}s
									</span>
									<span className="flex items-center gap-1 font-sans text-gray-a12">
										<GaugeIcon
											className="size-3.5 shrink-0 text-[var(--track-clip)]"
											fill="var(--gray-a12)"
										/>
										{`${segment.timescale}x`}
									</span>
								</div>
							</SegmentContent>
						</SegmentRoot>
					</TimelineContextMenu>
				);
			})}
		</>
	);
}
