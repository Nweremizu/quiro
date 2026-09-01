import type { ReactNode } from "react";
import type { TimelineSelection } from "../context";
import { useEditorContext } from "../context";
import { snapTime, startTimeDrag, useTimeline } from "./context";
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
	renderContent,
	readOnly,
}: {
	segments: T[];
	color: string;
	selectionType: NonNullable<TimelineSelection>["type"];
	label: (segment: T, index: number) => string;
	onChange: (index: number, next: T) => void;
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

				return (
					<SegmentRoot
						key={`${segment.start}-${segment.end}`}
						color={color}
						selected={selected}
						left={timeline.xOf(segment.start)}
						width={width}
						title={label(segment, index)}
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
						{!readOnly && (
							<SegmentHandle
								position="start"
								width={width}
								label={`Trim ${label(segment, index)} start`}
								onPointerDown={(event) => {
									const initial = segment.start;
									startTimeDrag(event, timeline, (delta) => {
										onChange(index, {
											...segment,
											start: Math.min(
												Math.max(0, snapTime(initial + delta, timeline)),
												segment.end - MIN_DURATION,
											),
										});
									});
								}}
							/>
						)}

						<SegmentContent width={width} className="justify-center">
							{renderContent?.(segment, index, width) ?? (
								<span className="pointer-events-none truncate text-[0.625rem] font-medium text-white/90">
									{label(segment, index)}
								</span>
							)}
						</SegmentContent>

						{!readOnly && (
							<SegmentHandle
								position="end"
								width={width}
								label={`Trim ${label(segment, index)} end`}
								onPointerDown={(event) => {
									const initial = segment.end;
									startTimeDrag(event, timeline, (delta) => {
										onChange(index, {
											...segment,
											end: Math.max(
												segment.start + MIN_DURATION,
												snapTime(initial + delta, timeline),
											),
										});
									});
								}}
							/>
						)}
					</SegmentRoot>
				);
			})}
		</>
	);
}
