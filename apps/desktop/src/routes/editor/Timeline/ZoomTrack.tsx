import type { ZoomSegment } from "@/utils/tauri";
import IconLucideArrowLeftToLine from "~icons/lucide/arrow-left-to-line";
import IconLucideArrowRightToLine from "~icons/lucide/arrow-right-to-line";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import {
	canMergeSpanWithNext,
	canMergeSpanWithPrevious,
	mergeSpans,
} from "../clip-merge";
import { useEditorContext } from "../context";
import { startTimeDrag, useTimeline } from "./context";
import { TimelineContextMenu } from "./TimelineContextMenu";
import { SegmentContent, SegmentHandle, SegmentRoot } from "./Track";

const MIN_ZOOM_DURATION = 0.3;

export function ZoomTrack() {
	const { project, setProject, selection, setSelection } = useEditorContext();
	const timeline = useTimeline();

	const segments = project?.timeline?.zoomSegments ?? [];

	const patchSegments = (next: typeof segments) =>
		setProject((current) =>
			current.timeline
				? {
						...current,
						timeline: { ...current.timeline, zoomSegments: next },
					}
				: current,
		);

	const updateSegment = (
		index: number,
		update: (segment: ZoomSegment) => ZoomSegment,
	) => {
		setProject((current) => {
			if (!current.timeline) return current;
			const zoomSegments = (current.timeline.zoomSegments ?? []).map(
				(segment, i) => (i === index ? update(segment) : segment),
			);
			return { ...current, timeline: { ...current.timeline, zoomSegments } };
		});
	};

	return (
		<>
			{segments.map((segment, index) => {
				const width = Math.max(
					(segment.end - segment.start) * timeline.pixelsPerSecond,
					8,
				);
				const selected =
					selection?.type === "zoom" && selection.index === index;

				return (
					<TimelineContextMenu
						key={`${segment.start}-${segment.end}`}
						items={[
							{
								icon: <IconLucideArrowLeftToLine className="size-4" />,
								label: "Merge with previous",
								disabled: !canMergeSpanWithPrevious(segments, index),
								onClick: () => patchSegments(mergeSpans(segments, index - 1)),
							},
							{
								icon: <IconLucideArrowRightToLine className="size-4" />,
								label: "Merge with next",
								disabled: !canMergeSpanWithNext(segments, index),
								onClick: () => patchSegments(mergeSpans(segments, index)),
							},
							{ separator: true },
							{
								icon: <IconLucideTrash2 className="size-4" />,
								label: "Delete zoom",
								destructive: true,
								onClick: () => {
									patchSegments(segments.filter((_, i) => i !== index));
									setSelection(null);
								},
							},
						]}
					>
						<SegmentRoot
							color="var(--track-zoom)"
							selected={selected}
							left={timeline.xOf(segment.start)}
							width={width}
							handles={
								<>
									<SegmentHandle
										position="start"
										width={width}
										label={`Trim zoom ${index + 1} start`}
										value={segment.start}
										min={0}
										max={segment.end - MIN_ZOOM_DURATION}
										onAdjust={(delta) => {
											const initial = segment.start;
											updateSegment(index, (current) => ({
												...current,
												start: Math.min(
													Math.max(0, initial + delta),
													current.end - MIN_ZOOM_DURATION,
												),
											}));
										}}
									/>
									<SegmentHandle
										position="end"
										width={width}
										label={`Trim zoom ${index + 1} end`}
										value={segment.end}
										min={segment.start + MIN_ZOOM_DURATION}
										max={timeline.duration}
										onAdjust={(delta) => {
											const initial = segment.end;
											updateSegment(index, (current) => ({
												...current,
												end: Math.max(
													current.start + MIN_ZOOM_DURATION,
													initial + delta,
												),
											}));
										}}
									/>
								</>
							}
							onPointerDown={(event) => {
								event.stopPropagation();
								setSelection({ type: "zoom", index });

								// Dragging the body moves the whole segment; the handles
								// stop propagation so they resize instead.
								const { start, end } = segment;
								startTimeDrag(event, timeline, (delta) => {
									const shift = Math.max(delta, -start);
									updateSegment(index, (current) => ({
										...current,
										start: start + shift,
										end: end + shift,
									}));
								});
							}}
						>
							<SegmentContent width={width} className="justify-center">
								<span className="pointer-events-none truncate text-[0.625rem] font-semibold tabular-nums text-[var(--track-label)]">
									{segment.amount.toFixed(1)}x
								</span>
							</SegmentContent>
						</SegmentRoot>
					</TimelineContextMenu>
				);
			})}
		</>
	);
}
