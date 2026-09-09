import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTauriEventListener } from "@/utils/createEventListner";
import {
	commands,
	events,
	type ProjectConfiguration,
	type SerializedEditorInstance,
	type TimelineConfiguration,
	type XY,
} from "@/utils/tauri";
import { connectFrameSocket } from "../screenshot-editor/frameSocket";
import { cancelActiveCaptionGenerations } from "./caption-generation";
import { normalizeCaptionProject } from "./captions";
import { clipTimelineDuration } from "./clip-transitions";
import { PlaybackStore, useThrottledPlaybackTime } from "./playback-store";

// Cap's editor renders and seeks in whole frames at a fixed 60fps timebase,
// independent of any source recording's own frame rate — playhead positions
// crossing the IPC boundary are all `time * FPS`.
export const FPS = 60;

export const OUTPUT_SIZE = { x: 1920, y: 1080 };

const PREVIEW_QUALITY_SCALE = { full: 1, half: 0.5, quarter: 0.25 } as const;
const PROJECT_SAVE_DEBOUNCE_MS = 250;
const INTERACTIVE_PREVIEW_INTERVAL_MS = 1000 / 30;

export type PreviewQuality = keyof typeof PREVIEW_QUALITY_SCALE;

/** Preview render size. Half resolution is Cap's default: the preview is
 * fitted into a window pane, and rendering it at output size costs frame rate
 * for detail nobody can see. Alignment is what the GPU readback path
 * requires. */
export function getPreviewResolution(quality: PreviewQuality): XY<number> {
	const scale = PREVIEW_QUALITY_SCALE[quality];
	return {
		x: (Math.max(4, Math.round(OUTPUT_SIZE.x * scale)) + 3) & ~3,
		y: (Math.max(2, Math.round(OUTPUT_SIZE.y * scale)) + 1) & ~1,
	};
}

export type TimelineSelection =
	| { type: "clip"; index: number }
	| { type: "zoom"; index: number }
	| { type: "caption"; index: number; id?: string }
	| { type: "scene"; index: number }
	| { type: "mask"; index: number }
	| { type: "text"; index: number }
	| { type: "keyboard"; index: number }
	| { type: "audio"; index: number }
	| null;

type EditorContextValue = {
	instance: SerializedEditorInstance | null;
	loadError: string | null;
	project: ProjectConfiguration | null;
	/** Applies an edit, pushes it onto the undo stack, and pushes it to the
	 * renderer + disk. */
	setProject: (
		update: (project: ProjectConfiguration) => ProjectConfiguration,
	) => void;
	/** Applies the final interaction value without creating another undo entry. */
	setProjectTransient: (
		update: (project: ProjectConfiguration) => ProjectConfiguration,
	) => void;
	/** Sends an interaction sample to the renderer without re-rendering or saving. */
	previewProject: (
		update: (project: ProjectConfiguration) => ProjectConfiguration,
	) => void;
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
	/** Preview frames, playhead time and frame layout, none of which are React
	 * state: they change up to 60 times a second, and re-rendering the editor
	 * that often is what made the playhead stutter. Paint from a subscription;
	 * read `playback.getTime()` in handlers. */
	playback: PlaybackStore;
	duration: number;
	playbackTime: number;
	playing: boolean;
	seek: (time: number) => void;
	togglePlay: () => void;
	previewQuality: PreviewQuality;
	setPreviewQuality: (quality: PreviewQuality) => void;
	selection: TimelineSelection;
	setSelection: (selection: TimelineSelection) => void;
	/** Cap's timeline interact mode: in split mode a click on a clip cuts it
	 * there instead of selecting it. */
	splitMode: boolean;
	setSplitMode: (split: boolean) => void;
	/** Whether the clips list replaces the config sidebar. */
	clipsOpen: boolean;
	setClipsOpen: (open: boolean) => void;
	prettyName: string;
	rename: (name: string) => Promise<void>;
};

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext() {
	const value = useContext(EditorContext);
	if (!value) throw new Error("useEditorContext used outside its provider");
	return value;
}

/** Every track array the editor edits, defaulted.
 *
 * Two things make a loaded timeline untrustworthy: a never-edited recording
 * has no timeline at all (only the editor writes one), and Rust omits any
 * track array that is empty (`skip_serializing_if`), so a saved project comes
 * back missing keys. Normalizing once here means no track handler has to
 * defend itself against a missing array. */
function normalizeTimeline(
	project: ProjectConfiguration,
	segmentDurations: number[],
): ProjectConfiguration {
	const existing = project.timeline;

	if (existing) {
		return {
			...project,
			timeline: {
				...existing,
				transitions: existing.transitions ?? [],
				zoomSegments: existing.zoomSegments ?? [],
				sceneSegments: existing.sceneSegments ?? [],
				maskSegments: existing.maskSegments ?? [],
				textSegments: existing.textSegments ?? [],
				captionSegments: existing.captionSegments ?? [],
				keyboardSegments: existing.keyboardSegments ?? [],
				audioSegments: existing.audioSegments ?? [],
			},
		};
	}

	const segments = segmentDurations
		.map((duration, index) => ({ duration, index }))
		.filter(({ duration }) => duration > 0)
		.map(({ duration, index }) => ({
			recordingSegment: index,
			start: 0,
			end: duration,
			timescale: 1,
		}));

	if (segments.length === 0) return project;

	const timeline: TimelineConfiguration = {
		segments,
		transitions: [],
		zoomSegments: [],
		sceneSegments: [],
		maskSegments: [],
		textSegments: [],
		captionSegments: [],
		keyboardSegments: [],
		audioSegments: [],
	};

	return { ...project, timeline };
}

export function EditorProvider({ children }: { children: ReactNode }) {
	const [instance, setInstance] = useState<SerializedEditorInstance | null>(
		null,
	);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [project, setProjectState] = useState<ProjectConfiguration | null>(
		null,
	);
	const projectRef = useRef<ProjectConfiguration | null>(null);
	projectRef.current = project;
	const [history, setHistory] = useState<ProjectConfiguration[]>([]);
	const [future, setFuture] = useState<ProjectConfiguration[]>([]);
	const [playing, setPlaying] = useState(false);
	const [playback] = useState(() => new PlaybackStore());

	// A coarse copy for the parts of the UI that must re-render as the playhead
	// moves (overlays for segments under the playhead, the export preview).
	const playbackTime = useThrottledPlaybackTime(playback);

	useEffect(
		() => () => {
			playback.dispose();
			void cancelActiveCaptionGenerations();
		},
		[playback],
	);
	const [previewQuality, setPreviewQuality] = useState<PreviewQuality>("full");
	const [selection, setSelection] = useState<TimelineSelection>(null);
	const [splitMode, setSplitMode] = useState(false);
	const [clipsOpen, setClipsOpen] = useState(false);
	const [prettyName, setPrettyName] = useState("");

	const playingRef = useRef(false);
	playingRef.current = playing;
	const previewQualityRef = useRef(previewQuality);
	previewQualityRef.current = previewQuality;
	const pendingLiveProjectRef = useRef<ProjectConfiguration | null>(null);
	const liveProjectSyncPromiseRef = useRef<Promise<void> | null>(null);
	const pendingInteractivePreviewRef = useRef<ProjectConfiguration | null>(
		null,
	);
	const interactivePreviewTimerRef = useRef<number | undefined>(undefined);
	const lastInteractivePreviewAtRef = useRef(0);
	const pendingProjectSaveRef = useRef<ProjectConfiguration | null>(null);
	const projectSaveActiveRef = useRef(false);
	const projectSaveTimerRef = useRef<number | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			const result = await commands.createEditorInstance();
			if (cancelled) return;
			if (result.status === "error") {
				setLoadError(result.error);
				return;
			}

			const data = result.data;
			setInstance(data);
			setPrettyName(data.prettyName);
			const normalized = normalizeTimeline(
				data.savedProjectConfig,
				data.recordings.segments.map((segment) => segment.display.duration),
			);
			setProjectState(
				normalizeCaptionProject(normalized, data.recordings.segments),
			);
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!instance) return;

		const disconnect = connectFrameSocket(
			instance.framesSocketUrl,
			(frame) => playback.setFrame(frame),
			undefined,
			{ flushAfterDecode: () => !playback.isPlaying() },
		);

		// The renderer only produces a frame when asked to; without this the
		// window sits empty until the first scrub.
		void events.renderFrameEvent.emit({
			frame_number: 0,
			fps: FPS,
			resolution_base: getPreviewResolution(previewQualityRef.current),
		});

		return disconnect;
	}, [instance, playback]);

	useTauriEventListener(events.frameLayoutEvent, (layout) =>
		playback.setLayout(layout),
	);

	// While playing, the backend owns the playhead and reports where it got to.
	useTauriEventListener(events.editorStateChanged, (payload) =>
		playback.setTime(payload.playhead_position / FPS),
	);

	const requestFrame = useCallback((time: number) => {
		void events.renderFrameEvent.emit({
			frame_number: Math.max(Math.floor(time * FPS), 0),
			fps: FPS,
			resolution_base: getPreviewResolution(previewQualityRef.current),
		});
	}, []);

	const seek = useCallback(
		(time: number) => {
			const clamped = Math.max(0, time);
			playback.setTime(clamped);
			void commands.setPlayheadPosition(Math.floor(clamped * FPS));
			// Playback drives its own frames; a manual request would fight it.
			if (!playingRef.current) requestFrame(clamped);
		},
		[requestFrame, playback],
	);

	// Must match `TimelineConfiguration::duration()` — playback ends where the
	// backend says it does, and transitions overlap their clips, so a plain sum
	// of segment lengths reads longer than the video actually is.
	const duration = useMemo(() => {
		const timeline = project?.timeline;
		if (timeline && timeline.segments.length > 0) {
			return clipTimelineDuration(
				timeline.segments,
				timeline.transitions ?? [],
			);
		}
		return instance?.recordingDuration ?? 0;
	}, [project, instance]);

	useEffect(() => {
		if (!playing || duration <= 0) return;
		if (duration - playbackTime > 0.1) return;

		void commands.stopPlayback();
		setPlaying(false);
		playback.setPlaying(false);
		// The stop check runs off a throttled sample, so the last reported
		// position is wherever it happened to land; settle on the real end.
		playback.setTime(duration);
	}, [playing, playbackTime, duration, playback]);

	const flushLiveProject = useCallback(() => {
		if (liveProjectSyncPromiseRef.current) {
			return liveProjectSyncPromiseRef.current;
		}
		const promise = (async () => {
			while (pendingLiveProjectRef.current) {
				const next = pendingLiveProjectRef.current;
				pendingLiveProjectRef.current = null;
				try {
					const result = await commands.updateProjectConfigInMemory(
						next,
						Math.max(Math.floor(playback.getTime() * FPS), 0),
						FPS,
						getPreviewResolution(previewQualityRef.current),
					);
					if (result.status === "error") {
						console.error(
							"Failed to update the live editor preview:",
							result.error,
						);
					}
				} catch (error) {
					console.error("Failed to update the live editor preview:", error);
				}
			}
			liveProjectSyncPromiseRef.current = null;
		})();
		liveProjectSyncPromiseRef.current = promise;
		return promise;
	}, [playback]);

	const syncLatestProject = useCallback(async () => {
		const latest = projectRef.current;
		if (!latest) return;

		pendingLiveProjectRef.current = latest;
		await flushLiveProject();
	}, [flushLiveProject]);

	const togglePlay = useCallback(() => {
		void (async () => {
			try {
				if (playingRef.current) {
					await commands.stopPlayback();
					setPlaying(false);
					playback.setPlaying(false);
					return;
				}

				const atEnd = duration > 0 && duration - playback.getTime() <= 0.1;
				const from = atEnd ? 0 : playback.getTime();
				if (atEnd) playback.setTime(0);

				await syncLatestProject();
				await commands.setPlayheadPosition(Math.floor(from * FPS));
				await commands.startPlayback(
					FPS,
					getPreviewResolution(previewQualityRef.current),
				);
				setPlaying(true);
				playback.setPlaying(true);
			} catch (error) {
				console.error("Failed to toggle playback:", error);
				setPlaying(false);
				playback.setPlaying(false);
			}
		})();
	}, [duration, playback, syncLatestProject]);

	const flushProjectSave = useCallback(() => {
		if (projectSaveActiveRef.current) return;
		projectSaveActiveRef.current = true;

		void (async () => {
			while (pendingProjectSaveRef.current) {
				const next = pendingProjectSaveRef.current;
				pendingProjectSaveRef.current = null;
				try {
					const result = await commands.setProjectConfig(next);
					if (result.status === "error") {
						console.error("Failed to save the editor project:", result.error);
					}
				} catch (error) {
					console.error("Failed to save the editor project:", error);
				}
			}
			projectSaveActiveRef.current = false;
		})();
	}, []);

	const flushInteractivePreview = useCallback(() => {
		interactivePreviewTimerRef.current = undefined;
		const next = pendingInteractivePreviewRef.current;
		pendingInteractivePreviewRef.current = null;
		if (!next) return;

		lastInteractivePreviewAtRef.current = performance.now();
		pendingLiveProjectRef.current = next;
		flushLiveProject();
	}, [flushLiveProject]);

	const queueProjectUpdate = useCallback(
		(next: ProjectConfiguration) => {
			pendingInteractivePreviewRef.current = null;
			window.clearTimeout(interactivePreviewTimerRef.current);
			interactivePreviewTimerRef.current = undefined;
			lastInteractivePreviewAtRef.current = performance.now();
			pendingLiveProjectRef.current = next;
			flushLiveProject();

			pendingProjectSaveRef.current = next;
			window.clearTimeout(projectSaveTimerRef.current);
			projectSaveTimerRef.current = window.setTimeout(
				flushProjectSave,
				PROJECT_SAVE_DEBOUNCE_MS,
			);
		},
		[flushLiveProject, flushProjectSave],
	);

	const previewProject = useCallback(
		(update: (project: ProjectConfiguration) => ProjectConfiguration) => {
			const current = projectRef.current;
			if (!current) return;
			const updated = update(current);
			const next = instance
				? normalizeCaptionProject(updated, instance.recordings.segments)
				: updated;
			if (next === current) return;

			pendingInteractivePreviewRef.current = next;
			const elapsed = performance.now() - lastInteractivePreviewAtRef.current;
			if (elapsed >= INTERACTIVE_PREVIEW_INTERVAL_MS) {
				window.clearTimeout(interactivePreviewTimerRef.current);
				flushInteractivePreview();
				return;
			}

			if (interactivePreviewTimerRef.current !== undefined) return;
			interactivePreviewTimerRef.current = window.setTimeout(
				flushInteractivePreview,
				INTERACTIVE_PREVIEW_INTERVAL_MS - elapsed,
			);
		},
		[flushInteractivePreview, instance],
	);

	useEffect(
		() => () => {
			pendingInteractivePreviewRef.current = null;
			window.clearTimeout(interactivePreviewTimerRef.current);
			window.clearTimeout(projectSaveTimerRef.current);
			flushProjectSave();
		},
		[flushProjectSave],
	);

	const pushProject = useCallback(
		(next: ProjectConfiguration) => {
			if (instance) {
				next = normalizeCaptionProject(next, instance.recordings.segments);
			}
			setProjectState(next);
			queueProjectUpdate(next);
		},
		[instance, queueProjectUpdate],
	);

	const setProject = useCallback(
		(update: (project: ProjectConfiguration) => ProjectConfiguration) => {
			setProjectState((current) => {
				if (!current) return current;
				const updated = update(current);
				const next = instance
					? normalizeCaptionProject(updated, instance.recordings.segments)
					: updated;
				if (next === current) return current;

				setHistory((entries) => [...entries.slice(-49), current]);
				setFuture([]);

				queueProjectUpdate(next);

				return next;
			});
		},
		[instance, queueProjectUpdate],
	);

	const setProjectTransient = useCallback(
		(update: (project: ProjectConfiguration) => ProjectConfiguration) => {
			setProjectState((current) => {
				if (!current) return current;
				const updated = update(current);
				const next = instance
					? normalizeCaptionProject(updated, instance.recordings.segments)
					: updated;
				if (next === current) return current;

				queueProjectUpdate(next);
				return next;
			});
		},
		[instance, queueProjectUpdate],
	);

	const undo = useCallback(() => {
		setHistory((entries) => {
			const previous = entries[entries.length - 1];
			if (!previous) return entries;

			setProjectState((current) => {
				if (current) setFuture((entries) => [...entries, current]);
				return previous;
			});
			pushProject(previous);

			return entries.slice(0, -1);
		});
	}, [pushProject]);

	const redo = useCallback(() => {
		setFuture((entries) => {
			const next = entries[entries.length - 1];
			if (!next) return entries;

			setProjectState((current) => {
				if (current) setHistory((entries) => [...entries, current]);
				return next;
			});
			pushProject(next);

			return entries.slice(0, -1);
		});
	}, [pushProject]);

	// Changing preview quality re-renders at the new size; while playing, the
	// running playback has to be restarted to pick it up.
	const changePreviewQuality = useCallback(
		(quality: PreviewQuality) => {
			if (quality === previewQualityRef.current) return;
			previewQualityRef.current = quality;
			setPreviewQuality(quality);

			void (async () => {
				if (!playingRef.current) {
					requestFrame(playback.getTime());
					return;
				}

				await commands.stopPlayback();
				await syncLatestProject();
				await commands.setPlayheadPosition(
					Math.floor(playback.getTime() * FPS),
				);
				await commands.startPlayback(FPS, getPreviewResolution(quality));
			})();
		},
		[requestFrame, playback, syncLatestProject],
	);

	const rename = useCallback(async (name: string) => {
		const trimmed = name.trim();
		if (!trimmed) return;

		const result = await commands.setPrettyName(trimmed);
		if (result.status === "error") throw new Error(result.error);
		setPrettyName(trimmed);
	}, []);

	const value = useMemo<EditorContextValue>(
		() => ({
			instance,
			loadError,
			project,
			setProject,
			setProjectTransient,
			previewProject,
			undo,
			redo,
			canUndo: history.length > 0,
			canRedo: future.length > 0,
			playback,
			duration,
			playbackTime,
			playing,
			seek,
			togglePlay,
			previewQuality,
			setPreviewQuality: changePreviewQuality,
			selection,
			setSelection,
			splitMode,
			setSplitMode,
			clipsOpen,
			setClipsOpen,
			prettyName,
			rename,
		}),
		[
			instance,
			loadError,
			project,
			setProject,
			setProjectTransient,
			previewProject,
			undo,
			redo,
			history.length,
			future.length,
			playback,
			duration,
			playbackTime,
			playing,
			seek,
			togglePlay,
			previewQuality,
			changePreviewQuality,
			selection,
			splitMode,
			clipsOpen,
			prettyName,
			rename,
		],
	);

	return (
		<EditorContext.Provider value={value}>{children}</EditorContext.Provider>
	);
}
