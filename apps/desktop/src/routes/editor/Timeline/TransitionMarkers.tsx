import { Popover, PopoverContent, PopoverTrigger } from "@quiro/ui";
import { useState } from "react";
import type { ClipTransitionType } from "@/utils/tauri";
import {
	clampTransitionDuration,
	DEFAULT_CLIP_TRANSITION_DURATION,
	getClipTransition,
	maxTransitionDuration,
} from "../clip-transitions";
import { useEditorContext } from "../context";
import { Field, Slider } from "../ui";
import { segmentOffsets } from "./ClipTrack";
import { useTimeline } from "./context";

const TRANSITION_LABELS: Record<ClipTransitionType, string> = {
	"cross-fade": "Cross fade",
	"fade-through-black": "Fade through black",
};

/** A control sitting on each join between two clips: empty until a transition
 * is added there, then showing its kind and length. Cap's timeline puts the
 * same affordance on the clip track. */
export function TransitionMarkers() {
	const { project, setProject } = useEditorContext();
	const timeline = useTimeline();
	const [openAt, setOpenAt] = useState<number | null>(null);

	const segments = project?.timeline?.segments ?? [];
	const transitions = project?.timeline?.transitions ?? [];
	const offsets = segmentOffsets(segments);

	const setTransition = (
		segmentIndex: number,
		next: { type: ClipTransitionType; duration: number } | null,
	) => {
		setProject((current) => {
			if (!current.timeline) return current;

			const others = (current.timeline.transitions ?? []).filter(
				(transition) => transition.segmentIndex !== segmentIndex,
			);
			const list = next
				? [...others, { segmentIndex, ...next }].sort(
						(a, b) => a.segmentIndex - b.segmentIndex,
					)
				: others;

			return {
				...current,
				timeline: { ...current.timeline, transitions: list },
			};
		});
	};

	// A transition belongs to the join *before* its segment, so joins start at 1.
	return (
		<>
			{segments.map((_, index) => {
				if (index === 0) return null;

				const transition = getClipTransition(segments, transitions, index);
				const maxDuration = maxTransitionDuration(
					segments[index - 1],
					segments[index],
				);

				return (
					<Popover
						key={`join-${offsets[index]}`}
						open={openAt === index}
						onOpenChange={(open) => setOpenAt(open ? index : null)}
					>
						<PopoverTrigger
							render={
								<button
									type="button"
									aria-label={`Transition before clip ${index + 1}`}
									style={{ left: `${timeline.xOf(offsets[index])}px` }}
									onPointerDown={(event) => event.stopPropagation()}
									className={
										transition
											? "absolute top-1/2 z-20 -mt-2.5 -ml-2.5 flex size-5 items-center justify-center rounded-full border border-blue-9 bg-blue-9 text-[9px] font-semibold text-white"
											: "absolute top-1/2 z-20 -mt-2.5 -ml-2.5 flex size-5 items-center justify-center rounded-full border border-gray-6 bg-gray-2 text-[9px] font-semibold text-gray-11 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"
									}
								>
									{transition ? transition.duration.toFixed(1) : "+"}
								</button>
							}
						/>
						<PopoverContent className="w-60 p-3" align="center">
							<div className="flex flex-col gap-3">
								<Field name="Transition">
									<div className="flex flex-col gap-1">
										{(
											Object.keys(TRANSITION_LABELS) as ClipTransitionType[]
										).map((type) => (
											<button
												key={type}
												type="button"
												onClick={() =>
													setTransition(index, {
														type,
														duration: clampTransitionDuration(
															transition?.duration ??
																DEFAULT_CLIP_TRANSITION_DURATION,
															segments[index - 1],
															segments[index],
														),
													})
												}
												className={
													transition?.type === type
														? "rounded-lg bg-gray-3 px-2.5 py-2 text-left text-sm text-gray-12"
														: "rounded-lg px-2.5 py-2 text-left text-sm text-gray-11 hover:bg-gray-3"
												}
											>
												{TRANSITION_LABELS[type]}
											</button>
										))}
									</div>
								</Field>

								{transition && (
									<>
										<Slider
											size="sm"
											label="Duration"
											format={(v) => `${v.toFixed(2)}s`}
											min={0.05}
											max={Math.max(maxDuration, 0.1)}
											step={0.05}
											value={transition.duration}
											onChange={(duration) =>
												setTransition(index, {
													type: transition.type,
													duration,
												})
											}
										/>
										<button
											type="button"
											onClick={() => {
												setTransition(index, null);
												setOpenAt(null);
											}}
											className="rounded-lg px-2.5 py-2 text-left text-sm text-red-9 hover:bg-red-3"
										>
											Remove transition
										</button>
									</>
								)}
							</div>
						</PopoverContent>
					</Popover>
				);
			})}
		</>
	);
}
