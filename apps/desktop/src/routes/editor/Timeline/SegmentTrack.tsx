import type { ReactNode } from "react";
import IconLucideArrowLeftToLine from "~icons/lucide/arrow-left-to-line";
import IconLucideArrowRightToLine from "~icons/lucide/arrow-right-to-line";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import { canMergeSpanWithNext, canMergeSpanWithPrevious } from "../clip-merge";
import type { TimelineSelection } from "../context";
import { useEditorContext } from "../context";
import { snapTime, startTimeDrag, useTimeline } from "./context";
import { TimelineContextMenu } from "./TimelineContextMenu";
import { SegmentContent, SegmentHandle, SegmentRoot } from "./Track";

// Scene, mask, text, keyboard and audio tracks are all the same interaction —
// a list of {start, end} segments that can be moved, trimmed and selected —
// so they share one implementation and differ only in colour and label.

export type TimeSpan = { start: number; end: number };

const MIN_DURATION = 0.2;

export function SegmentTrack<T extends TimeSpan>({
	segments,
	color,
	selectionType,
	label,
	onChange,
	onMerge,
	onDelete,
	renderContent,
	readOnly,
}: {
	segments: T[];
	color: string;
	selectionType: NonNullable<TimelineSelection>["type"];
	label: (segment: T, index: number) => string;
	onChange: (index: number, next: T) => void;
	/** Joins the segment at `index` with the one after it. */
	onMerge: (index: number) => void;
	onDelete: (index: number) => void;
	renderContent?: (segment: T, index: number, width: number) => ReactNode;
	/** Generated tracks (keyboard) are laid out by the backend, so their
	 * segments are shown but not draggable. */
	readOnly?: boolean;
}) {
	const { selection, setSelection } = useEditorContext();
	const timeline = useTimeline();

	return (
		<>
			{segments.map((segment, index) => {
				const width = Math.max(
					(segment.end - segment.start) * timeline.pixelsPerSecond,
					8,
				);
				const selected =
					selection?.type === selectionType && selection.index === index;

				const name = label(segment, index);

				return (
					<TimelineContextMenu
						key={`${segment.start}-${segment.end}`}
						items={[
							{
								icon: <IconLucideArrowLeftToLine className="size-4" />,
								label: "Merge with previous",
								disabled: !canMergeSpanWithPrevious(segments, index),
								onClick: () => onMerge(index - 1),
							},
							{
								icon: <IconLucideArrowRightToLine className="size-4" />,
								label: "Merge with next",
								disabled: !canMergeSpanWithNext(segments, index),
								onClick: () => onMerge(index),
							},
							{ separator: true },
							{
								icon: <IconLucideTrash2 className="size-4" />,
								label: `Delete ${name}`,
								destructive: true,
								onClick: () => onDelete(index),
							},
						]}
					>
						<SegmentRoot
							color={color}
							selected={selected}
							left={timeline.xOf(segment.start)}
							width={width}
							title={label(segment, index)}
							handles={
								!readOnly && (
									<>
										<SegmentHandle
											position="start"
											width={width}
											// Indexed: several segments share a label (every
											// default scene reads "default"), and identical
											// accessible names are indistinguishable in a
											// screen reader's list of controls.
											label={`Trim ${label(segment, index)} ${index + 1} start`}
											value={segment.start}
											min={0}
											max={segment.end - MIN_DURATION}
											onAdjust={(delta) => {
												const initial = segment.start;
												onChange(index, {
													...segment,
													start: Math.min(
														Math.max(0, snapTime(initial + delta, timeline)),
														segment.end - MIN_DURATION,
													),
												});
											}}
										/>
										<SegmentHandle
											position="end"
											width={width}
											label={`Trim ${label(segment, index)} ${index + 1} end`}
											value={segment.end}
											min={segment.start + MIN_DURATION}
											max={timeline.duration}
											onAdjust={(delta) => {
												const initial = segment.end;
												onChange(index, {
													...segment,
													end: Math.max(
														segment.start + MIN_DURATION,
														snapTime(initial + delta, timeline),
													),
												});
											}}
										/>
									</>
								)
							}
							onPointerDown={(event) => {
								event.stopPropagation();
								setSelection({ type: selectionType, index });
								if (readOnly) return;

								const { start, end } = segment;
								startTimeDrag(event, timeline, (delta) => {
									const shift = Math.max(delta, -start);
									onChange(index, {
										...segment,
										start: snapTime(start + shift, timeline),
										end: end + shift,
									});
								});
							}}
						>
							<SegmentContent width={width} className="justify-center">
								{renderContent?.(segment, index, width) ?? (
									<span className="pointer-events-none truncate text-[0.625rem] font-semibold text-[var(--track-label)]">
										{label(segment, index)}
									</span>
								)}
							</SegmentContent>
						</SegmentRoot>
					</TimelineContextMenu>
				);
			})}
		</>
	);
}
