import { toast } from "@quiro/ui";
import type { ZoomSegment } from "@/utils/tauri";
import IconLucideArrowLeftToLine from "~icons/lucide/arrow-left-to-line";
import IconLucideArrowRightToLine from "~icons/lucide/arrow-right-to-line";
import IconLucideCopyPlus from "~icons/lucide/copy-plus";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconPhArrowDownFill from "~icons/ph/arrow-down-fill";
import IconPhArrowLeftFill from "~icons/ph/arrow-left-fill";
import IconPhArrowRightFill from "~icons/ph/arrow-right-fill";
import IconPhArrowUpFill from "~icons/ph/arrow-up-fill";
import IconPhArrowsOutCardinalFill from "~icons/ph/arrows-out-cardinal-fill";
import IconPhCrosshairFill from "~icons/ph/crosshair-fill";
import IconPhCursorFill from "~icons/ph/cursor-fill";
import IconPhLightningFill from "~icons/ph/lightning-fill";
import IconPhMagnifyingGlassPlusFill from "~icons/ph/magnifying-glass-plus-fill";
import IconPhPerspectiveFill from "~icons/ph/perspective-fill";
import {
	canMergeSpanWithNext,
	canMergeSpanWithPrevious,
	mergeSpans,
} from "../clip-merge";
import { useEditorContext } from "../context";
import { MIN_ZOOM_DURATION, planZoomDuplicate } from "../zoom-duplicate";
import { startTimeDrag, useTimeline } from "./context";
import { TimelineContextMenu } from "./TimelineContextMenu";
import { SegmentContent, SegmentHandle, SegmentRoot } from "./Track";

function ZoomDetails({
	segment,
	width,
}: {
	segment: ZoomSegment;
	width: number;
}) {
	const followsCursor = segment.mode === "auto";
	const motion = segment.motion ?? {};
	const rotates = [
		motion.rotation,
		motion.tiltX,
		motion.tiltY,
		motion.spin,
	].some((value) => Math.abs(value ?? 0) > 0.001);
	const moves =
		Math.abs(motion.offsetX ?? 0) > 0.001 ||
		Math.abs(motion.offsetY ?? 0) > 0.001;
	const motionLabel = rotates
		? "Rotation movement"
		: moves
			? "Position movement"
			: "Push-in movement";

	return (
		<div className="flex min-w-0 items-center justify-center gap-2 overflow-hidden text-gray-a12">
			<span className="shrink-0" title={`${segment.amount.toFixed(1)}× zoom`}>
				<IconPhMagnifyingGlassPlusFill
					aria-hidden="true"
					className="size-4 shrink-0"
				/>
			</span>
			{width >= 48 && (
				<span
					className="shrink-0"
					title={followsCursor ? "Follows cursor" : "Fixed focus"}
				>
					{followsCursor ? (
						<IconPhCursorFill aria-hidden="true" className="size-4 shrink-0" />
					) : (
						<IconPhCrosshairFill
							aria-hidden="true"
							className="size-4 shrink-0"
						/>
					)}
				</span>
			)}
			{width >= 68 && (
				<span className="shrink-0" title={motionLabel}>
					{rotates ? (
						<IconPhPerspectiveFill
							aria-hidden="true"
							className="size-4 shrink-0"
						/>
					) : (
						<IconPhArrowsOutCardinalFill
							aria-hidden="true"
							className="size-4 shrink-0"
						/>
					)}
				</span>
			)}
			{width >= 88 && segment.instantAnimation && (
				<span className="shrink-0" title="Instant zoom transition">
					<IconPhLightningFill aria-hidden="true" className="size-4 shrink-0" />
				</span>
			)}
			{width >= 108 &&
				segment.glideDirection &&
				segment.glideDirection !== "none" && (
					<span className="shrink-0" title={`Glides ${segment.glideDirection}`}>
						{segment.glideDirection === "left" && (
							<IconPhArrowLeftFill
								aria-hidden="true"
								className="size-4 shrink-0"
							/>
						)}
						{segment.glideDirection === "right" && (
							<IconPhArrowRightFill
								aria-hidden="true"
								className="size-4 shrink-0"
							/>
						)}
						{segment.glideDirection === "up" && (
							<IconPhArrowUpFill
								aria-hidden="true"
								className="size-4 shrink-0"
							/>
						)}
						{segment.glideDirection === "down" && (
							<IconPhArrowDownFill
								aria-hidden="true"
								className="size-4 shrink-0"
							/>
						)}
					</span>
				)}
		</div>
	);
}

export function ZoomTrack() {
	const { project, setProject, selection, setSelection, playing, seek } =
		useEditorContext();
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

	const commitDuplicate = (duplicate: ZoomSegment) => {
		const next = [...segments, duplicate].sort((a, b) => a.start - b.start);
		const duplicateIndex = next.indexOf(duplicate);
		patchSegments(next);
		setSelection({ type: "zoom", index: duplicateIndex });
		if (!playing) seek((duplicate.start + duplicate.end) / 2);
	};

	const duplicateSegment = (index: number) => {
		const plan = planZoomDuplicate(segments, index, timeline.duration);
		if (plan.status === "exact") {
			commitDuplicate(plan.segment);
			return;
		}

		if (plan.status === "blocked") {
			toast.error("No room to duplicate this zoom", {
				description:
					"Move the next zoom or shorten this one to create at least 0.3 seconds of space.",
			});
			return;
		}

		toast.error("The duplicate would overlap another zoom", {
			description: `${plan.availableDuration.toFixed(1)} seconds is available after this zoom. Trim the duplicate to fit?`,
			duration: 10_000,
			action: {
				label: "Trim to fit",
				onClick: () => commitDuplicate(plan.segment),
			},
			cancel: {
				label: "Cancel",
				onClick: () => undefined,
			},
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
				const focusLabel =
					segment.mode === "auto" ? "follows cursor" : "fixed focus";

				return (
					<TimelineContextMenu
						key={`${segment.start}-${segment.end}`}
						items={[
							{
								icon: <IconLucideCopyPlus className="size-4" />,
								label: "Duplicate zoom",
								onClick: () => duplicateSegment(index),
							},
							{ separator: true },
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

							role="group"
							aria-label={`Zoom ${index + 1}: ${segment.amount.toFixed(1)} times, ${focusLabel}`}
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
								if (!playing) seek((segment.start + segment.end) / 2);

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
								<ZoomDetails segment={segment} width={width} />
							</SegmentContent>
						</SegmentRoot>
					</TimelineContextMenu>
				);
			})}
		</>
	);
}
