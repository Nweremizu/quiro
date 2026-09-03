import { cn } from "@quiro/ui";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { commands, type TimelineSegment } from "@/utils/tauri";
import IconLucideArrowLeft from "~icons/lucide/arrow-left";
import IconLucideClapperboard from "~icons/lucide/clapperboard";
import IconLucidePencil from "~icons/lucide/pencil";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import {
	transitionsAfterClipDelete,
	transitionsAfterClipMove,
} from "./clip-transitions";
import { useEditorContext } from "./context";
import { segmentDuration, segmentOffsets } from "./Timeline/ClipTrack";
import { rippleDeleteAllTracks } from "./timeline-utils";

// Cap's clips panel: the timeline's clip track as an ordered list — thumbnail,
// name, duration — that can be renamed, reordered by dragging, and deleted.
// Cap's "Record a new clip" and "Import" buttons are not here: both need
// recording-into-an-open-project and import pipelines Quiro doesn't have.

function formatClipDuration(seconds: number) {
	const total = Math.max(0, seconds);
	const minutes = Math.floor(total / 60);
	const rest = total - minutes * 60;
	return minutes > 0
		? `${minutes}m ${Math.round(rest)}s`
		: `${rest.toFixed(1)}s`;
}

/** Thumbnails are decoded on demand by the Rust side and cached on disk, so
 * this only has to remember the resolved path per clip. */
function ClipThumbnail({
	recordingSegment,
	start,
}: {
	recordingSegment: number;
	start: number;
}) {
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			const result = await commands.getClipThumbnail(recordingSegment, start);
			if (cancelled || result.status === "error") return;
			setUrl(convertFileSrc(result.data));
		})();

		return () => {
			cancelled = true;
		};
	}, [recordingSegment, start]);

	if (!url) return null;

	return (
		<img
			src={url}
			alt=""
			draggable={false}
			className="size-full object-cover"
		/>
	);
}

export function ClipsSidebar({ onClose }: { onClose: () => void }) {
	const { project, setProject, setSelection } = useEditorContext();

	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [draft, setDraft] = useState("");
	const listRef = useRef<HTMLDivElement | null>(null);

	const segments = project?.timeline?.segments ?? [];

	const renameClip = (index: number, name: string) => {
		const trimmed = name.trim();
		setProject((current) => {
			if (!current.timeline) return current;
			const next = current.timeline.segments.map((segment, i) =>
				i === index ? { ...segment, name: trimmed || null } : segment,
			);
			return { ...current, timeline: { ...current.timeline, segments: next } };
		});
		setEditingIndex(null);
	};

	const deleteClip = (index: number) => {
		setSelection(null);
		setProject((current) => {
			if (!current.timeline) return current;

			// Same ripple as deleting from the timeline: every other track shifts
			// back so zooms and captions stay attached to their footage.
			const offsets = segmentOffsets(current.timeline.segments);
			const segment = current.timeline.segments[index];
			if (!segment) return current;

			const draftTimeline = structuredClone(current.timeline);
			rippleDeleteAllTracks(
				draftTimeline,
				offsets[index],
				offsets[index] + segmentDuration(segment),
				index,
			);
			draftTimeline.transitions = transitionsAfterClipDelete(
				draftTimeline.transitions ?? [],
				index,
			);

			return { ...current, timeline: draftTimeline };
		});
	};

	const moveClip = (from: number, to: number) => {
		if (from === to || to < 0) return;

		setProject((current) => {
			if (!current.timeline) return current;

			const next = [...current.timeline.segments];
			const [moved] = next.splice(from, 1);
			next.splice(to > from ? to - 1 : to, 0, moved);

			// A transition only survives a reorder if the two clips it joins are
			// still adjacent in the same order.
			const { kept } = transitionsAfterClipMove(
				current.timeline.segments.length,
				current.timeline.transitions ?? [],
				from,
				to > from ? to - 1 : to,
			);

			return {
				...current,
				timeline: { ...current.timeline, segments: next, transitions: kept },
			};
		});
	};

	const startDrag = (index: number, event: React.PointerEvent) => {
		if ((event.target as HTMLElement).closest("[data-no-drag]")) return;

		event.preventDefault();
		setDraggingIndex(index);
		setDropIndex(index);

		const move = (moveEvent: PointerEvent) => {
			const cards = listRef.current?.querySelectorAll("[data-clip-card]");
			if (!cards) return;

			// The drop line sits before the first card whose midpoint is below the
			// pointer, or after the last one.
			let next = cards.length;
			for (const [cardIndex, card] of cards.entries()) {
				const bounds = card.getBoundingClientRect();
				if (moveEvent.clientY < bounds.top + bounds.height / 2) {
					next = cardIndex;
					break;
				}
			}
			setDropIndex(next);
		};

		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);

			setDropIndex((target) => {
				setDraggingIndex((source) => {
					if (source !== null && target !== null) moveClip(source, target);
					return null;
				});
				return null;
			});
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const clipName = (segment: TimelineSegment, index: number) =>
		segment.name?.trim() || `Clip ${index + 1}`;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2">
			<button
				type="button"
				onClick={onClose}
				className="flex h-16 w-full flex-none items-center gap-2 border-b border-gray-3 px-4 text-sm font-medium text-gray-12 transition-colors hover:bg-gray-3"
			>
				<IconLucideArrowLeft className="size-4 text-gray-11" />
				Back to editor
			</button>

			<div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
				<div className="flex flex-none items-center gap-2">
					<span className="text-sm font-medium text-gray-12">Clips</span>
					{segments.length > 0 && (
						<span className="rounded-md bg-gray-3 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-gray-11">
							{segments.length}
						</span>
					)}
				</div>

				<div className="custom-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
					{segments.length === 0 ? (
						<div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
							<div className="flex size-10 items-center justify-center rounded-full bg-gray-3 text-gray-9">
								<IconLucideClapperboard className="size-5" />
							</div>
							<p className="text-sm font-medium text-gray-12">No clips yet</p>
							<p className="max-w-50 text-xs text-gray-10">
								Trim or split the timeline and the pieces show up here.
							</p>
						</div>
					) : (
						<div ref={listRef} className="flex flex-col gap-2">
							{segments.map((segment, index) => {
								const dragging = draggingIndex === index;
								const showTopBar =
									draggingIndex !== null && dropIndex === index;
								const showBottomBar =
									draggingIndex !== null &&
									index === segments.length - 1 &&
									dropIndex === segments.length;

								return (
									<div
										key={`${segment.recordingSegment ?? 0}-${segment.start}-${segment.end}`}
										className="relative"
									>
										{showTopBar && (
											<div className="absolute -top-1 right-0 left-0 z-10 h-0.5 rounded-full bg-accent-border-selected" />
										)}
										{showBottomBar && (
											<div className="absolute right-0 -bottom-1 left-0 z-10 h-0.5 rounded-full bg-accent-border-selected" />
										)}

										<div
											data-clip-card
											onPointerDown={(event) => startDrag(index, event)}
											className={cn(
												"group flex cursor-grab items-center gap-3 rounded-lg border border-gray-4 bg-gray-2 p-2 transition-all hover:border-gray-7 active:cursor-grabbing dark:bg-gray-3",
												dragging && "opacity-40",
											)}
										>
											<div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-gray-4">
												<ClipThumbnail
													recordingSegment={segment.recordingSegment ?? 0}
													start={segment.start}
												/>
											</div>

											<div className="flex min-w-0 flex-1 flex-col gap-0.5">
												{editingIndex === index ? (
													<input
														data-no-drag
														autoFocus
														value={draft}
														placeholder={clipName(segment, index)}
														onChange={(event) => setDraft(event.target.value)}
														onPointerDown={(event) => event.stopPropagation()}
														onKeyDown={(event) => {
															event.stopPropagation();
															if (event.key === "Enter")
																renameClip(index, draft);
															else if (event.key === "Escape")
																setEditingIndex(null);
														}}
														onBlur={() => renameClip(index, draft)}
														className="w-full rounded border border-gray-6 bg-gray-1 px-1.5 py-0.5 text-sm text-gray-12 outline-none focus:border-accent-focus-ring dark:bg-gray-4"
													/>
												) : (
													<span
														className="truncate text-sm font-medium text-gray-12"
														onDoubleClick={() => {
															setDraft(segment.name ?? "");
															setEditingIndex(index);
														}}
													>
														{clipName(segment, index)}
													</span>
												)}
												<span className="text-xs tabular-nums text-gray-10">
													{formatClipDuration(segmentDuration(segment))}
												</span>
											</div>

											<div className="flex flex-none items-center gap-0.5">
												<button
													data-no-drag
													type="button"
													aria-label="Rename clip"
													onClick={() => {
														setDraft(segment.name ?? "");
														setEditingIndex(index);
													}}
													className="flex size-7 flex-none items-center justify-center rounded-md text-gray-10 opacity-0 transition-colors hover:bg-gray-5 hover:text-gray-12 group-hover:opacity-100"
												>
													<IconLucidePencil className="size-3.5" />
												</button>

												{segments.length > 1 && (
													<button
														data-no-drag
														type="button"
														aria-label="Remove clip"
														onClick={() => deleteClip(index)}
														className="flex size-7 flex-none items-center justify-center rounded-md text-gray-10 opacity-0 transition-colors hover:bg-red-3 hover:text-red-11 group-hover:opacity-100"
													>
														<IconLucideTrash2 className="size-3.5" />
													</button>
												)}
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
