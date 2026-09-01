import { Popover, PopoverContent, PopoverTrigger } from "@quiro/ui";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	commands,
	type MaskSegment,
	type SceneSegment,
	type TextSegment,
	type TimelineConfiguration,
	type TimelineSegment,
} from "@/utils/tauri";
import IconLucideBoxSelect from "~icons/lucide/box-select";
import IconLucideCaptions from "~icons/lucide/captions";
import IconLucideClapperboard from "~icons/lucide/clapperboard";
import IconLucideKeyboard from "~icons/lucide/keyboard";
import IconLucideMusic from "~icons/lucide/music";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideSearch from "~icons/lucide/search";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideType from "~icons/lucide/type";
import IconLucideVideo from "~icons/lucide/video";
import IconLucideWand from "~icons/lucide/wand";
import IconLucideZoomIn from "~icons/lucide/zoom-in";
import IconLucideZoomOut from "~icons/lucide/zoom-out";
import {
	transitionsAfterClipDelete,
	transitionsAfterClipSplit,
} from "../clip-transitions";
import { useEditorContext } from "../context";
import { rippleDeleteAllTracks } from "../timeline-utils";
import { EditorButton, Slider } from "../ui";
import { AudioTrack } from "./AudioTrack";
import { CaptionsTrack } from "./CaptionsTrack";
import { ClipTrack, segmentDuration, segmentOffsets } from "./ClipTrack";
import { TimelineProvider, type TimelineViewport } from "./context";
import { KeyboardTrack } from "./KeyboardTrack";
import { Playhead } from "./Playhead";
import { SegmentTrack } from "./SegmentTrack";
import { TrackRoot } from "./Track";
import { TransitionMarkers } from "./TransitionMarkers";
import { ZoomTrack } from "./ZoomTrack";

const MIN_VISIBLE_SECONDS = 1;

function formatTime(seconds: number) {
	const total = Math.max(0, seconds);
	const minutes = Math.floor(total / 60);
	return `${minutes}:${String(Math.floor(total % 60)).padStart(2, "0")}`;
}

/** Which clip segment contains a timeline time, and where inside it. */
function locateSegment(segments: TimelineSegment[], time: number) {
	const offsets = segmentOffsets(segments);

	for (let index = segments.length - 1; index >= 0; index--) {
		if (time >= offsets[index]) return { index, offset: offsets[index] };
	}

	return null;
}

/** Optional tracks stay hidden until they hold something or are switched on,
 * so an untouched recording shows just clips and zoom. */
type OptionalTrack = "scene" | "mask" | "text" | "keyboard" | "audio";

export function Timeline() {
	const {
		project,
		setProject,
		duration,
		playback,
		seek,
		selection,
		setSelection,
		splitMode,
	} = useEditorContext();

	const trackAreaRef = useRef<HTMLDivElement | null>(null);
	const [trackWidth, setTrackWidth] = useState(0);
	// Cap's timeline transform: how much time is visible, and where it starts.
	const [visibleSeconds, setVisibleSeconds] = useState(0);
	const [position, setPosition] = useState(0);
	const [shownTracks, setShownTracks] = useState<OptionalTrack[]>([]);

	useEffect(() => {
		const element = trackAreaRef.current;
		if (!element) return;

		const observer = new ResizeObserver(([entry]) =>
			setTrackWidth(entry.contentRect.width),
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	// Zero means "not set yet" — fit the whole recording once its length is known.
	const visible = visibleSeconds > 0 ? visibleSeconds : Math.max(duration, 1);
	const pixelsPerSecond = trackWidth > 0 ? trackWidth / visible : 0;
	const maxPosition = Math.max(0, duration - visible);
	const clampedPosition = Math.min(position, maxPosition);

	const zoomAround = useCallback(
		(nextVisible: number, anchor: number) => {
			const clamped = Math.min(
				Math.max(nextVisible, MIN_VISIBLE_SECONDS),
				Math.max(duration, MIN_VISIBLE_SECONDS),
			);
			setVisibleSeconds(clamped);
			// Keep the anchor time under the same pixel while zooming.
			setPosition((current) => {
				const ratio = visible > 0 ? (anchor - current) / visible : 0.5;
				return Math.max(
					0,
					Math.min(anchor - ratio * clamped, Math.max(0, duration - clamped)),
				);
			});
		},
		[duration, visible],
	);

	const timeAt = useCallback(
		(clientX: number) => {
			const element = trackAreaRef.current;
			if (!element || pixelsPerSecond <= 0) return 0;

			const bounds = element.getBoundingClientRect();
			return Math.min(
				Math.max(
					clampedPosition + (clientX - bounds.left) / pixelsPerSecond,
					0,
				),
				duration,
			);
		},
		[pixelsPerSecond, duration, clampedPosition],
	);

	const xOf = useCallback(
		(time: number) => (time - clampedPosition) * pixelsPerSecond,
		[clampedPosition, pixelsPerSecond],
	);

	// Every other segment edge is a snap target, plus the recording's ends. The
	// playhead is deliberately not one: it moves every frame, and rebuilding
	// this list that often would re-render every track.
	const snapTargets = useMemo(() => {
		const timeline = project?.timeline;
		const targets = [0, duration];
		if (!timeline) return targets;

		for (const start of segmentOffsets(timeline.segments)) targets.push(start);
		for (const list of [
			timeline.zoomSegments ?? [],
			timeline.sceneSegments ?? [],
			timeline.maskSegments ?? [],
			timeline.textSegments ?? [],
			timeline.audioSegments ?? [],
		]) {
			for (const segment of list) targets.push(segment.start, segment.end);
		}

		return targets;
	}, [project, duration]);

	const viewport = useMemo<TimelineViewport>(
		() => ({
			pixelsPerSecond,
			duration,
			position: clampedPosition,
			timeAt,
			xOf,
			snapTargets,
		}),
		[pixelsPerSecond, duration, clampedPosition, timeAt, xOf, snapTargets],
	);

	const updateTimeline = useCallback(
		(update: (timeline: TimelineConfiguration) => TimelineConfiguration) =>
			setProject((current) =>
				current.timeline
					? { ...current, timeline: update(current.timeline) }
					: current,
			),
		[setProject],
	);

	const splitAt = (time: number) => {
		setProject((current) => {
			if (!current.timeline) return current;

			const located = locateSegment(current.timeline.segments, time);
			if (!located) return current;

			const segment = current.timeline.segments[located.index];
			const timescale = segment.timescale || 1;
			// Timeline seconds into this clip, converted back to source seconds.
			const sourceCut = segment.start + (time - located.offset) * timescale;

			if (sourceCut <= segment.start + 0.05 || sourceCut >= segment.end - 0.05)
				return current;

			const nextSegments = [...current.timeline.segments];
			nextSegments.splice(
				located.index,
				1,
				{ ...segment, end: sourceCut },
				{ ...segment, start: sourceCut },
			);

			return {
				...current,
				timeline: {
					...current.timeline,
					segments: nextSegments,
					transitions: transitionsAfterClipSplit(
						current.timeline.transitions ?? [],
						located.index,
					),
				},
			};
		});
	};

	const deleteSelection = () => {
		if (!selection) return;

		setProject((current) => {
			if (!current.timeline) return current;
			const timeline = current.timeline;
			const without = <T,>(list: T[] | undefined) =>
				(list ?? []).filter((_, index) => index !== selection.index);

			switch (selection.type) {
				case "zoom":
					return {
						...current,
						timeline: {
							...timeline,
							zoomSegments: without(timeline.zoomSegments),
						},
					};
				case "scene":
					return {
						...current,
						timeline: {
							...timeline,
							sceneSegments: without(timeline.sceneSegments),
						},
					};
				case "mask":
					return {
						...current,
						timeline: {
							...timeline,
							maskSegments: without(timeline.maskSegments),
						},
					};
				case "text":
					return {
						...current,
						timeline: {
							...timeline,
							textSegments: without(timeline.textSegments),
						},
					};
				case "keyboard":
					return {
						...current,
						timeline: {
							...timeline,
							keyboardSegments: without(timeline.keyboardSegments),
						},
					};
				case "audio":
					return {
						...current,
						timeline: {
							...timeline,
							audioSegments: without(timeline.audioSegments),
						},
					};
				case "caption": {
					if (!current.captions) return current;
					return {
						...current,
						captions: {
							...current.captions,
							segments: without(current.captions.segments),
						},
					};
				}
				default: {
					// Deleting a clip ripples every other track back by its length,
					// so annotations stay attached to the footage they describe.
					const offsets = segmentOffsets(timeline.segments);
					const segment = timeline.segments[selection.index];
					if (!segment) return current;

					const draft = structuredClone(timeline);
					rippleDeleteAllTracks(
						draft,
						offsets[selection.index],
						offsets[selection.index] + segmentDuration(segment),
						selection.index,
					);
					draft.transitions = transitionsAfterClipDelete(
						draft.transitions ?? [],
						selection.index,
					);

					return { ...current, timeline: draft };
				}
			}
		});

		setSelection(null);
	};

	/** New segments land at the playhead, two seconds long, clipped to the end. */
	const spanAtPlayhead = () => {
		const start = playback.getTime();
		const end = Math.min(start + 2, duration);
		return end - start < 0.3 ? null : { start, end };
	};

	const show = (track: OptionalTrack) =>
		setShownTracks((tracks) =>
			tracks.includes(track) ? tracks : [...tracks, track],
		);

	const addZoom = () => {
		const span = spanAtPlayhead();
		if (!span) return;

		updateTimeline((timeline) => ({
			...timeline,
			zoomSegments: [
				...(timeline.zoomSegments ?? []),
				{ ...span, amount: 1.5, mode: { manual: { x: 0.5, y: 0.5 } } as const },
			].sort((a, b) => a.start - b.start),
		}));
	};

	const addScene = () => {
		const span = spanAtPlayhead();
		if (!span) return;

		show("scene");
		updateTimeline((timeline) => ({
			...timeline,
			sceneSegments: [
				...(timeline.sceneSegments ?? []),
				{ ...span, mode: "default" as const },
			].sort((a, b) => a.start - b.start),
		}));
	};

	const addMask = () => {
		const span = spanAtPlayhead();
		if (!span) return;

		show("mask");
		updateTimeline((timeline) => ({
			...timeline,
			maskSegments: [
				...(timeline.maskSegments ?? []),
				{
					...span,
					maskType: "sensitive" as const,
					center: { x: 0.5, y: 0.5 },
					size: { x: 0.25, y: 0.15 },
				},
			].sort((a, b) => a.start - b.start),
		}));
	};

	const addText = () => {
		const span = spanAtPlayhead();
		if (!span) return;

		show("text");
		updateTimeline((timeline) => ({
			...timeline,
			textSegments: [
				...(timeline.textSegments ?? []),
				{
					...span,
					content: "Text",
					center: { x: 0.5, y: 0.5 },
					size: { x: 0.4, y: 0.12 },
				},
			].sort((a, b) => a.start - b.start),
		}));
	};

	/** Length of an audio file, read by the webview rather than the backend —
	 * the renderer only needs the path, and this saves a decode just to size
	 * the segment. Falls back to 30s if the metadata never arrives. */
	const audioDuration = (path: string) =>
		new Promise<number>((resolve) => {
			const audio = new Audio(convertFileSrc(path));
			const done = (value: number) => resolve(value > 0 ? value : 30);

			audio.addEventListener("loadedmetadata", () => done(audio.duration), {
				once: true,
			});
			audio.addEventListener("error", () => done(30), { once: true });
		});

	const importAudio = async () => {
		const picked = await open({
			multiple: false,
			directory: false,
			filters: [
				{
					name: "Audio",
					extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
				},
			],
		});
		if (typeof picked !== "string") return;

		const length = await audioDuration(picked);
		const name = picked.split(/[\\/]/).pop() ?? "Audio";

		show("audio");
		updateTimeline((timeline) => ({
			...timeline,
			audioSegments: [
				...(timeline.audioSegments ?? []),
				{
					start: playback.getTime(),
					end: playback.getTime() + length,
					path: picked,
					name,
					enabled: true,
				},
			].sort((a, b) => a.start - b.start),
		}));
	};

	const autoZoomFromClicks = async () => {
		const result = await commands.generateZoomSegmentsFromClicks();
		if (result.status === "error") return;

		updateTimeline((timeline) => ({ ...timeline, zoomSegments: result.data }));
	};

	const generateKeyboard = async () => {
		const result = await commands.generateKeyboardSegments(
			400,
			1200,
			true,
			true,
		);
		if (result.status === "error") return;

		show("keyboard");
		updateTimeline((timeline) => ({
			...timeline,
			keyboardSegments: result.data,
		}));
	};

	// Ruler ticks land on whole seconds, thinned out as the timeline zooms out
	// so labels never overlap.
	const tickStep = useMemo(() => {
		const step = pixelsPerSecond > 0 ? 80 / pixelsPerSecond : 1;
		return (
			[0.5, 1, 2, 5, 10, 15, 30, 60].find((candidate) => candidate >= step) ??
			60
		);
	}, [pixelsPerSecond]);

	const ticks = useMemo(() => {
		if (pixelsPerSecond <= 0) return [];

		const result: number[] = [];
		const first = Math.max(
			0,
			Math.floor(clampedPosition / tickStep) * tickStep,
		);
		const last = Math.min(clampedPosition + visible, duration);
		for (let time = first; time <= last; time += tickStep) result.push(time);
		return result;
	}, [clampedPosition, visible, duration, tickStep, pixelsPerSecond]);

	const timeline = project?.timeline;
	const trackVisible = (track: OptionalTrack, count: number) =>
		count > 0 || shownTracks.includes(track);
	return (
		<TimelineProvider value={viewport}>
			<div className="relative flex h-full flex-col gap-2 overflow-hidden pt-2">
				<div className="flex items-center gap-2 px-1">
					<EditorButton
						tooltip="Delete selected segment"
						disabled={!selection}
						onClick={deleteSelection}
						leftIcon={<IconLucideTrash2 className="size-4" />}
					/>

					<AddSegmentMenu
						onAddZoom={addZoom}
						onAddScene={addScene}
						onAddMask={addMask}
						onAddText={addText}
						onGenerateKeyboard={() => void generateKeyboard()}
						onImportAudio={() => void importAudio()}
					/>

					<EditorButton
						tooltip="Replace the zoom track with one segment per cursor click"
						onClick={() => void autoZoomFromClicks()}
						leftIcon={<IconLucideWand className="size-4" />}
					>
						Auto zoom
					</EditorButton>

					<div className="ml-auto flex items-center gap-2">
						<EditorButton
							tooltip="Zoom timeline out"
							kbd={["meta", "-"]}
							onClick={() => zoomAround(visible * 1.4, playback.getTime())}
							leftIcon={<IconLucideZoomOut className="size-4" />}
						/>
						<Slider
							className="w-24"
							ariaLabel="Timeline zoom"
							format={(v) => `${Math.round(v * 100)}%`}
							min={0}
							max={1}
							step={0.001}
							value={
								duration > 0
									? Math.min(Math.max(1 - visible / duration, 0), 1)
									: 0
							}
							onChange={(value) =>
								zoomAround(
									Math.max(duration * (1 - value), MIN_VISIBLE_SECONDS),
									playback.getTime(),
								)
							}
						/>
						<EditorButton
							tooltip="Zoom timeline in"
							kbd={["meta", "+"]}
							onClick={() => zoomAround(visible / 1.4, playback.getTime())}
							leftIcon={<IconLucideZoomIn className="size-4" />}
						/>
					</div>
				</div>

				<div
					ref={trackAreaRef}
					className="custom-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1 "
					onPointerDown={(event) => {
						// Clicking empty timeline scrubs; segments stop propagation so
						// they select or split instead.
						if (!splitMode) seek(timeAt(event.clientX));
					}}
					onWheel={(event) => {
						// Trackpad: pinch (ctrl/cmd + wheel) zooms, plain scroll pans.
						if (event.ctrlKey || event.metaKey) {
							zoomAround(
								visible * (event.deltaY > 0 ? 1.1 : 0.9),
								timeAt(event.clientX),
							);
							return;
						}

						const delta = event.deltaX || event.deltaY;
						if (delta === 0 || pixelsPerSecond <= 0) return;
						setPosition((current) =>
							Math.min(
								Math.max(current + delta / pixelsPerSecond, 0),
								maxPosition,
							),
						);
					}}
				>
					<div className="relative flex min-h-full flex-col gap-2">
						<div className="relative h-4 text-xs text-gray-9 ml-10">
							{ticks.map((time) => (
								<span
									key={time}
									className="absolute top-0 border-l border-gray-4 pl-1 tabular-nums"
									style={{ left: `${xOf(time)}px` }}
								>
									{formatTime(time)}
								</span>
							))}
						</div>

						<TrackRoot
							label="Clips"
							icon={<IconLucideClapperboard className="size-4" />}
						>
							<ClipTrack onSplit={splitAt} />
							<TransitionMarkers />
						</TrackRoot>

						<TrackRoot
							label="Zoom"
							icon={<IconLucideSearch className="size-4" />}
							height="2.5rem"
						>
							<ZoomTrack />
						</TrackRoot>

						{trackVisible("scene", timeline?.sceneSegments?.length ?? 0) && (
							<TrackRoot
								label="Scene"
								icon={<IconLucideVideo className="size-4" />}
								height="2.5rem"
							>
								<SegmentTrack<SceneSegment>
									segments={timeline?.sceneSegments ?? []}
									color="var(--track-scene)"
									selectionType="scene"
									label={(segment) => segment.mode ?? "default"}
									onChange={(index, next) =>
										updateTimeline((current) => ({
											...current,
											sceneSegments: (current.sceneSegments ?? []).map(
												(segment, i) => (i === index ? next : segment),
											),
										}))
									}
								/>
							</TrackRoot>
						)}

						{trackVisible("mask", timeline?.maskSegments?.length ?? 0) && (
							<TrackRoot
								label="Mask"
								icon={<IconLucideBoxSelect className="size-4" />}
								height="2.5rem"
							>
								<SegmentTrack<MaskSegment>
									segments={timeline?.maskSegments ?? []}
									color="var(--track-mask)"
									selectionType="mask"
									label={(segment) => segment.maskType}
									onChange={(index, next) =>
										updateTimeline((current) => ({
											...current,
											maskSegments: (current.maskSegments ?? []).map(
												(segment, i) => (i === index ? next : segment),
											),
										}))
									}
								/>
							</TrackRoot>
						)}

						{trackVisible("text", timeline?.textSegments?.length ?? 0) && (
							<TrackRoot
								label="Text"
								icon={<IconLucideType className="size-4" />}
								height="2.5rem"
							>
								<SegmentTrack<TextSegment>
									segments={timeline?.textSegments ?? []}
									color="var(--track-text)"
									selectionType="text"
									label={(segment) => segment.content || "Text"}
									onChange={(index, next) =>
										updateTimeline((current) => ({
											...current,
											textSegments: (current.textSegments ?? []).map(
												(segment, i) => (i === index ? next : segment),
											),
										}))
									}
								/>
							</TrackRoot>
						)}

						{trackVisible(
							"keyboard",
							timeline?.keyboardSegments?.length ?? 0,
						) && (
							<TrackRoot
								label="Keyboard"
								icon={<IconLucideKeyboard className="size-4" />}
								height="2rem"
							>
								<KeyboardTrack />
							</TrackRoot>
						)}

						{trackVisible("audio", timeline?.audioSegments?.length ?? 0) && (
							<TrackRoot
								label="Audio"
								icon={<IconLucideMusic className="size-4" />}
								height="3rem"
							>
								<AudioTrack />
							</TrackRoot>
						)}

						{(project?.captions?.segments.length ?? 0) > 0 && (
							<TrackRoot
								label="Captions"
								icon={<IconLucideCaptions className="size-4" />}
								height="2rem"
							>
								<CaptionsTrack />
							</TrackRoot>
						)}

						{pixelsPerSecond > 0 && <Playhead />}
					</div>
				</div>
			</div>
		</TimelineProvider>
	);
}

function AddSegmentMenu({
	onAddZoom,
	onAddScene,
	onAddMask,
	onAddText,
	onGenerateKeyboard,
	onImportAudio,
}: {
	onAddZoom: () => void;
	onAddScene: () => void;
	onAddMask: () => void;
	onAddText: () => void;
	onGenerateKeyboard: () => void;
	onImportAudio: () => void;
}) {
	const [open, setOpen] = useState(false);

	const items = [
		{ label: "Zoom", icon: IconLucideSearch, action: onAddZoom },
		{ label: "Scene", icon: IconLucideVideo, action: onAddScene },
		{ label: "Mask", icon: IconLucideBoxSelect, action: onAddMask },
		{ label: "Text", icon: IconLucideType, action: onAddText },
		{
			label: "Keyboard from keystrokes",
			icon: IconLucideKeyboard,
			action: onGenerateKeyboard,
		},
		{ label: "Audio track…", icon: IconLucideMusic, action: onImportAudio },
	];

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<EditorButton leftIcon={<IconLucidePlus className="size-4" />}>
						Add
					</EditorButton>
				}
			/>
			<PopoverContent className="w-56 p-1" align="start">
				{items.map(({ label, icon: Icon, action }) => (
					<button
						key={label}
						type="button"
						onClick={() => {
							setOpen(false);
							action();
						}}
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-12 hover:bg-gray-3"
					>
						<Icon className="size-4 text-gray-11" />
						{label}
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}
