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
import {
	type FramePx,
	normalizeAnnotation,
	type Rect,
	resolveAnnotation,
} from "./space";

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

	/** Resolved into frame pixels against [`anchorRect`]. Stored geometry is
	 * normalized (`annotationSpaceVersion` 1); the whole interaction layer
	 * works in pixels, so the conversion happens here, once, rather than at
	 * every consumer. */
	annotations: Annotation[];
	setAnnotations: (next: Annotation[]) => void;
	/** The capture's rect inside the rendered frame — `getImageRect`'s result.
	 * Published by the preview, which is the only place that knows the frame
	 * size. Until it arrives there is nothing on screen to place annotations
	 * against, and they pass through unresolved. */
	anchorRect: Rect<FramePx> | null;
	setAnchorRect: (rect: Rect<FramePx> | null) => void;
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

	/** Newest canvas layer from the renderer — background source, blur and
	 * noise, with nothing on it. Already decoded.
	 *
	 * The preview is composited in the browser rather than by the renderer: the
	 * canvas and the capture arrive as two images on two sockets, stacked with
	 * the capture placed by a CSS transform. That is what lets a drag cost a
	 * compositor transform instead of a GPU render and a full frame over a
	 * socket. Export is unaffected — it renders the whole composition in one
	 * pass, on demand. */
	latestFrame: SocketFrame | null;
	/** Newest capture layer: the card alone on transparency, drawn where layout
	 * alone would put it, with the placement left for the preview to apply. */
	latestCardFrame: SocketFrame | null;
	originalImageSize: { width: number; height: number } | null;

	/** Revision of the config last pushed at the renderer. `screenshot_editor.rs`
	 * echoes it back as the frame number, so a frame whose `frameNumber` matches
	 * this has caught up with the newest edit — export waits for that rather than
	 * encoding whatever stale frame happens to be on screen. */
	configRevision: number;
	/** The capture layer's mask and depth-of-field overlay, painted in the
	 * capture's own space and carried along by that layer's transform. */
	previewMaskCanvas: HTMLCanvasElement | null;
	setPreviewMaskCanvas: (canvas: HTMLCanvasElement | null) => void;
	/** The rendered capture, on transparency, in its own untransformed space.
	 * Published because it is also the hit test: whether a click landed on the
	 * capture is a question about its alpha, not about its bounding box. */
	cardCanvas: HTMLCanvasElement | null;
	setCardCanvas: (canvas: HTMLCanvasElement | null) => void;
	/** The capture is selectable like any annotation, and the two are mutually
	 * exclusive — `setSelectedAnnotationId` and `setCaptureSelected` each clear
	 * the other, so there is never a moment with two things selected. */
	captureSelected: boolean;
	setCaptureSelected: (selected: boolean) => void;

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
	// Canonical, normalized form. Everything the UI sees is resolved below.
	const [annotations, setAnnotationsState] = useState<Annotation[]>([]);
	const [anchorRect, setAnchorRect] = useState<Rect<FramePx> | null>(null);
	const [latestFrame, setLatestFrame] = useState<SocketFrame | null>(null);
	const [latestCardFrame, setLatestCardFrame] = useState<SocketFrame | null>(
		null,
	);
	const [originalImageSize, setOriginalImageSize] = useState<{
		width: number;
		height: number;
	} | null>(null);

	const [selectedAnnotationId, setSelectedAnnotationIdState] = useState<
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

	useEffect(() => {
		if (!instance?.cardSocketUrl) return;
		return connectFrameSocket(
			instance.cardSocketUrl,
			(frame) => {
				setLatestCardFrame((previous) => {
					previous?.bitmap.close();
					return frame;
				});
			},
			undefined,
			// The card is drawn onto transparency, so it comes back premultiplied
			// and its shadow and antialiased edge would darken if handed to
			// `ImageData` as-is. The canvas layer is opaque and needs none of it.
			{ unpremultiply: true },
		);
	}, [instance?.cardSocketUrl]);

	useEffect(
		() => () => {
			setLatestFrame((previous) => {
				previous?.bitmap.close();
				return null;
			});
			setLatestCardFrame((previous) => {
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
	const [previewMaskCanvas, setPreviewMaskCanvas] =
		useState<HTMLCanvasElement | null>(null);
	const [cardCanvas, setCardCanvas] = useState<HTMLCanvasElement | null>(null);
	const [captureSelected, setCaptureSelectedState] = useState(false);

	const setSelectedAnnotationId = useCallback(
		(id: string | null | ((previous: string | null) => string | null)) => {
			setSelectedAnnotationIdState(id);
			if (id !== null) setCaptureSelectedState(false);
		},
		[],
	);

	const setCaptureSelected = useCallback((selected: boolean) => {
		setCaptureSelectedState(selected);
		if (selected) setSelectedAnnotationIdState(null);
	}, []);
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

	// The storage boundary. Stored geometry is normalized to `anchorRect`;
	// callers hand us — and receive — frame pixels. With no anchor yet there is
	// no frame on screen either, so values pass through untouched rather than
	// being divided by a rect that does not exist.
	const toStored = useCallback(
		(a: Annotation): Annotation =>
			anchorRect ? normalizeAnnotation(a, anchorRect) : a,
		[anchorRect],
	);

	const resolvedAnnotations = useMemo(
		() =>
			anchorRect
				? annotations.map((a) => resolveAnnotation(a, anchorRect))
				: annotations,
		[annotations, anchorRect],
	);

	const setAnnotations = useCallback(
		(next: Annotation[]) => commit({ annotations: next.map(toStored) }),
		[commit, toStored],
	);

	const addAnnotation = useCallback(
		(annotation: Annotation) => {
			const current = live.current;
			if (!current) return;
			commit({ annotations: [...current.annotations, toStored(annotation)] });
		},
		[commit, toStored],
	);

	const updateAnnotation = useCallback(
		(id: string, patch: Partial<Annotation>) => {
			const current = live.current;
			if (!current) return;
			commit({
				annotations: current.annotations.map((a) => {
					if (a.id !== id) return a;
					// The patch is in frame pixels, so it has to be applied to the
					// resolved shape and the result re-normalized — patching the
					// stored one directly would mix the two spaces in one record.
					const resolved = anchorRect ? resolveAnnotation(a, anchorRect) : a;
					return toStored({ ...resolved, ...patch });
				}),
			});
		},
		[commit, toStored, anchorRect],
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
		[commit, setSelectedAnnotationId],
	);

	const value = useMemo<ScreenshotEditorContextValue>(
		() => ({
			instance,
			loadError,
			renameInstance,
			project,
			setProject,
			updateBackground,
			annotations: resolvedAnnotations,
			setAnnotations,
			addAnnotation,
			anchorRect,
			setAnchorRect,
			updateAnnotation,
			removeAnnotation,
			selectedAnnotationId,
			setSelectedAnnotationId,
			cardCanvas,
			setCardCanvas,
			captureSelected,
			setCaptureSelected,
			activeTool,
			setActiveTool,
			layersPanelOpen,
			setLayersPanelOpen,
			stylePanelOpen,
			setStylePanelOpen,
			activePopover,
			setActivePopover,
			latestFrame,
			latestCardFrame,
			originalImageSize,
			configRevision,
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
			resolvedAnnotations,
			anchorRect,
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
			latestCardFrame,
			originalImageSize,
			configRevision,
			previewMaskCanvas,
			cardCanvas,
			captureSelected,
			setCaptureSelected,
			setSelectedAnnotationId,
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
