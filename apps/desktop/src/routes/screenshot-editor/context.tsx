import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
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
import {
	type Annotation,
	type AnnotationType,
	commands,
	type ProjectConfiguration,
	type SerializedScreenshotEditorInstance,
} from "@/utils/tauri";
import { connectFrameSocket, type SocketFrame } from "./frameSocket";

// React port of Cap's screenshot-editor `context.tsx`. Same responsibilities:
// own the ProjectConfiguration, own the annotation list and its history, push
// every edit at the Rust renderer, and hand the newest rendered frame to the
// preview. Solid's fine-grained stores become plain React state here, so the
// effects are keyed on whole objects rather than tracked field-by-field.

export type ScreenshotEditorTool = AnnotationType | "select";

export type ActivePopover = "perspective" | null;

/** Two update rates, as in Cap: the renderer gets edits immediately so the
 * canvas keeps up with a drag, while the disk write is debounced far longer.
 * Without the split, dragging a slider is hundreds of file writes. */
const RENDER_THROTTLE_MS = 1000 / 60;
const SAVE_DEBOUNCE_MS = 1000;

export type ScreenshotEditorContextValue = {
	instance: SerializedScreenshotEditorInstance | null;
	loadError: string | null;
	/** Rewrites the display name in the screenshot's `.json` sidecar — the field
	 * the header and the library list read — not the file on disk. No-ops on a
	 * blank or unchanged name. */
	renameInstance: (name: string) => Promise<void>;

	project: ProjectConfiguration | null;
	setProject: (next: ProjectConfiguration) => void;
	updateBackground: (
		patch: Partial<ProjectConfiguration["background"]>,
	) => void;

	annotations: Annotation[];
	setAnnotations: (next: Annotation[]) => void;
	addAnnotation: (annotation: Annotation) => void;
	updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
	removeAnnotation: (id: string) => void;

	selectedAnnotationId: string | null;
	setSelectedAnnotationId: (id: string | null) => void;
	activeTool: ScreenshotEditorTool;
	setActiveTool: (tool: ScreenshotEditorTool) => void;
	layersPanelOpen: boolean;
	setLayersPanelOpen: (open: boolean) => void;
	/** Persistent right-hand inspector (Background / Border / Shadow), the
	 * counterpart to the layers panel on the left. Mutually exclusive with
	 * AnnotationConfig, which takes the same slot while a shape is selected. */
	stylePanelOpen: boolean;
	setStylePanelOpen: (open: boolean) => void;
	activePopover: ActivePopover;
	setActivePopover: (popover: ActivePopover) => void;

	/** Newest frame from the renderer, already decoded. */
	latestFrame: SocketFrame | null;
	originalImageSize: { width: number; height: number } | null;

	/** Revision of the config last pushed at the renderer. `screenshot_editor.rs`
	 * echoes it back as the frame number, so a frame whose `frameNumber` matches
	 * this has caught up with the newest edit — export waits for that rather than
	 * encoding whatever stale frame happens to be on screen. */
	configRevision: number;
	/** The two live preview canvases. Export reuses them verbatim when they are
	 * already at full resolution, which skips a second GPU render. */
	previewCanvas: HTMLCanvasElement | null;
	setPreviewCanvas: (canvas: HTMLCanvasElement | null) => void;
	previewMaskCanvas: HTMLCanvasElement | null;
	setPreviewMaskCanvas: (canvas: HTMLCanvasElement | null) => void;

	history: {
		undo: () => void;
		redo: () => void;
		canUndo: boolean;
		canRedo: boolean;
		/** Pauses history capture until the returned function is called, so a
		 * drag lands as one undo entry rather than one per pointer move. */
		pause: () => () => void;
	};
};

const ScreenshotEditorContext =
	createContext<ScreenshotEditorContextValue | null>(null);

export function useScreenshotEditorContext() {
	const ctx = useContext(ScreenshotEditorContext);
	if (!ctx) {
		throw new Error(
			"useScreenshotEditorContext must be used inside ScreenshotEditorProvider",
		);
	}
	return ctx;
}

type Snapshot = {
	project: ProjectConfiguration;
	annotations: Annotation[];
};

export function ScreenshotEditorProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [instance, setInstance] =
		useState<SerializedScreenshotEditorInstance | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [project, setProjectState] = useState<ProjectConfiguration | null>(
		null,
	);
	const [annotations, setAnnotationsState] = useState<Annotation[]>([]);
	const [latestFrame, setLatestFrame] = useState<SocketFrame | null>(null);
	const [originalImageSize, setOriginalImageSize] = useState<{
		width: number;
		height: number;
	} | null>(null);

	const [selectedAnnotationId, setSelectedAnnotationId] = useState<
		string | null
	>(null);
	const [activeTool, setActiveTool] = useState<ScreenshotEditorTool>("select");
	const [layersPanelOpen, setLayersPanelOpen] = useState(false);
	const [stylePanelOpen, setStylePanelOpen] = useState(true);
	const [activePopover, setActivePopover] = useState<ActivePopover>(null);

	// --- load ---------------------------------------------------------------

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			const result = await commands.createScreenshotEditorInstance();
			if (cancelled) return;
			if (result.status === "error") {
				setLoadError(result.error);
				return;
			}
			const data = result.data;
			setInstance(data);
			setOriginalImageSize({
				width: data.imageWidth,
				height: data.imageHeight,
			});
			if (data.config) {
				setProjectState(data.config);
				setAnnotationsState(data.config.annotations ?? []);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	const renameInstance = useCallback(
		async (rawName: string) => {
			const name = rawName.trim();
			if (!instance || !name || name === instance.prettyName) return;

			const sidecarPath = instance.path.replace(/\.png$/i, ".json");
			let sortTimeMillis = Date.now();
			try {
				const parsed = JSON.parse(await readTextFile(sidecarPath)) as {
					sortTimeMillis?: number;
				};
				if (typeof parsed.sortTimeMillis === "number")
					sortTimeMillis = parsed.sortTimeMillis;
			} catch {
				// No sidecar yet (a captured screenshot always has one) — write
				// a fresh one below.
			}

			await writeTextFile(
				sidecarPath,
				JSON.stringify({ prettyName: name, sortTimeMillis }),
			);
			setInstance((current) =>
				current ? { ...current, prettyName: name } : current,
			);
		},
		[instance],
	);

	// --- frames -------------------------------------------------------------

	useEffect(() => {
		if (!instance?.framesSocketUrl) return;
		return connectFrameSocket(instance.framesSocketUrl, (frame) => {
			// ImageBitmaps hold GPU memory until closed, and one arrives per
			// edit — the previous one has to be released explicitly.
			setLatestFrame((previous) => {
				previous?.bitmap.close();
				return frame;
			});
		});
	}, [instance?.framesSocketUrl]);

	useEffect(
		() => () => {
			setLatestFrame((previous) => {
				previous?.bitmap.close();
				return null;
			});
		},
		[],
	);

	// --- history ------------------------------------------------------------

	const [past, setPast] = useState<Snapshot[]>([]);
	const [future, setFuture] = useState<Snapshot[]>([]);
	const pauseDepth = useRef(0);
	const pausedSnapshot = useRef<Snapshot | null>(null);
	const pausedDirty = useRef(false);
	// Read by the commit path without making it depend on render order.
	const live = useRef<Snapshot | null>(null);
	live.current = project ? { project, annotations } : null;

	const pushHistory = useCallback((snapshot: Snapshot) => {
		setPast((p) => [...p, snapshot]);
		setFuture([]);
	}, []);

	const pause = useCallback(() => {
		if (pauseDepth.current === 0) {
			pausedSnapshot.current = live.current
				? structuredClone(live.current)
				: null;
			pausedDirty.current = false;
		}
		pauseDepth.current += 1;

		let resumed = false;
		return () => {
			if (resumed) return;
			resumed = true;
			pauseDepth.current = Math.max(0, pauseDepth.current - 1);
			if (pauseDepth.current === 0) {
				if (pausedSnapshot.current && pausedDirty.current) {
					pushHistory(pausedSnapshot.current);
				}
				pausedSnapshot.current = null;
				pausedDirty.current = false;
			}
		};
	}, [pushHistory]);

	/** Every mutation routes through here so history capture has exactly one
	 * place to hook, whether it is paused mid-drag or committing immediately. */
	const commit = useCallback(
		(next: Partial<Snapshot>) => {
			const current = live.current;
			if (!current) return;

			if (pauseDepth.current > 0) {
				pausedDirty.current = true;
			} else {
				pushHistory(structuredClone(current));
			}

			if (next.project) setProjectState(next.project);
			if (next.annotations) setAnnotationsState(next.annotations);
		},
		[pushHistory],
	);

	const undo = useCallback(() => {
		setPast((p) => {
			if (p.length === 0) return p;
			const previous = p[p.length - 1];
			const current = live.current;
			if (current) setFuture((f) => [structuredClone(current), ...f]);
			setProjectState(previous.project);
			setAnnotationsState(previous.annotations);
			return p.slice(0, -1);
		});
	}, []);

	const redo = useCallback(() => {
		setFuture((f) => {
			if (f.length === 0) return f;
			const next = f[0];
			const current = live.current;
			if (current) setPast((p) => [...p, structuredClone(current)]);
			setProjectState(next.project);
			setAnnotationsState(next.annotations);
			return f.slice(1);
		});
	}, []);

	// --- push edits at the renderer -----------------------------------------

	const revisionRef = useRef(0);
	const [configRevision, setConfigRevision] = useState(0);
	const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(
		null,
	);
	const [previewMaskCanvas, setPreviewMaskCanvas] =
		useState<HTMLCanvasElement | null>(null);
	const renderTimer = useRef<number | undefined>(undefined);
	const saveTimer = useRef<number | undefined>(undefined);
	const lastRenderAt = useRef(0);

	useEffect(() => {
		if (!instance || !project) return;

		const config: ProjectConfiguration = { ...project, annotations };
		const revision = ++revisionRef.current;
		setConfigRevision(revision);

		const render = () => {
			lastRenderAt.current = Date.now();
			void commands.updateScreenshotConfig(config, false, revision);
		};

		// Leading-edge throttle plus a trailing call, so a drag renders
		// continuously and the final position is never dropped.
		const sinceLast = Date.now() - lastRenderAt.current;
		if (sinceLast >= RENDER_THROTTLE_MS) {
			render();
		} else {
			window.clearTimeout(renderTimer.current);
			renderTimer.current = window.setTimeout(
				render,
				RENDER_THROTTLE_MS - sinceLast,
			);
		}

		window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(() => {
			void commands.updateScreenshotConfig(config, true, revisionRef.current);
		}, SAVE_DEBOUNCE_MS);

		return () => {
			window.clearTimeout(renderTimer.current);
		};
	}, [project, annotations, instance]);

	useEffect(
		() => () => {
			window.clearTimeout(renderTimer.current);
			window.clearTimeout(saveTimer.current);
		},
		[],
	);

	// --- mutators -----------------------------------------------------------

	const setProject = useCallback(
		(next: ProjectConfiguration) => commit({ project: next }),
		[commit],
	);

	const updateBackground = useCallback(
		(patch: Partial<ProjectConfiguration["background"]>) => {
			const current = live.current;
			if (!current) return;
			commit({
				project: {
					...current.project,
					background: { ...current.project.background, ...patch },
				},
			});
		},
		[commit],
	);

	const setAnnotations = useCallback(
		(next: Annotation[]) => commit({ annotations: next }),
		[commit],
	);

	const addAnnotation = useCallback(
		(annotation: Annotation) => {
			const current = live.current;
			if (!current) return;
			commit({ annotations: [...current.annotations, annotation] });
		},
		[commit],
	);

	const updateAnnotation = useCallback(
		(id: string, patch: Partial<Annotation>) => {
			const current = live.current;
			if (!current) return;
			commit({
				annotations: current.annotations.map((a) =>
					a.id === id ? { ...a, ...patch } : a,
				),
			});
		},
		[commit],
	);

	const removeAnnotation = useCallback(
		(id: string) => {
			const current = live.current;
			if (!current) return;
			commit({ annotations: current.annotations.filter((a) => a.id !== id) });
			setSelectedAnnotationId((selected) =>
				selected === id ? null : selected,
			);
		},
		[commit],
	);

	const value = useMemo<ScreenshotEditorContextValue>(
		() => ({
			instance,
			loadError,
			renameInstance,
			project,
			setProject,
			updateBackground,
			annotations,
			setAnnotations,
			addAnnotation,
			updateAnnotation,
			removeAnnotation,
			selectedAnnotationId,
			setSelectedAnnotationId,
			activeTool,
			setActiveTool,
			layersPanelOpen,
			setLayersPanelOpen,
			stylePanelOpen,
			setStylePanelOpen,
			activePopover,
			setActivePopover,
			latestFrame,
			originalImageSize,
			configRevision,
			previewCanvas,
			setPreviewCanvas,
			previewMaskCanvas,
			setPreviewMaskCanvas,
			history: {
				undo,
				redo,
				canUndo: past.length > 0,
				canRedo: future.length > 0,
				pause,
			},
		}),
		[
			instance,
			loadError,
			renameInstance,
			project,
			setProject,
			updateBackground,
			annotations,
			setAnnotations,
			addAnnotation,
			updateAnnotation,
			removeAnnotation,
			selectedAnnotationId,
			activeTool,
			layersPanelOpen,
			stylePanelOpen,
			activePopover,
			latestFrame,
			originalImageSize,
			configRevision,
			previewCanvas,
			previewMaskCanvas,
			undo,
			redo,
			past.length,
			future.length,
			pause,
		],
	);

	return (
		<ScreenshotEditorContext.Provider value={value}>
			{children}
		</ScreenshotEditorContext.Provider>
	);
}
