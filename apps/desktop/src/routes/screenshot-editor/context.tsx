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
	type Fragment,
	type ProjectConfiguration,
	type SerializedScreenshotEditorInstance,
	type TextContent,
} from "@/utils/tauri";
import { connectFrameSocket, type SocketFrame } from "./frameSocket";
import {
	type FramePx,
	normalizeAnnotation,
	type Rect,
	resolveAnnotation,
} from "./space";
import { registerFace } from "./text-content";

// React port of Cap's screenshot-editor `context.tsx`. Same responsibilities:
// own the ProjectConfiguration, own the annotation list and its history, push
// every edit at the Rust renderer, and hand the newest rendered frame to the
// preview. Solid's fine-grained stores become plain React state here, so the
// effects are keyed on whole objects rather than tracked field-by-field.

export type ScreenshotEditorTool = AnnotationType | "select";

/** Which contextual panel the right-hand container is showing. One value
 * rather than a boolean per panel: the container holds exactly one panel at a
 * time, so two independent flags could describe a state it cannot render. */
export type RightPanel = "style" | "transform";

/** Two update rates, as in Cap: the renderer gets edits immediately so the
 * canvas keeps up with a drag, while the disk write is debounced far longer.
 * Without the split, dragging a slider is hundreds of file writes. */
const RENDER_THROTTLE_MS = 1000 / 60;
const SAVE_DEBOUNCE_MS = 1000;
/** `measure_text` is an IPC round-trip, not a per-frame call — "called on
 * commit, not per keystroke" (`plans/text-engine/003`). Typing patches
 * `textContent` on every keystroke today (004 owns the finer-grained
 * policy), so this debounce is what keeps a fast typist from firing one
 * Tauri command per character; the stale fragments in between are never
 * visible; the annotation being typed into renders as a contentEditable,
 * not as fragments, until it commits. */
const MEASURE_DEBOUNCE_MS = 200;

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

	/** `measure_text`'s fragments for every text annotation, by id — Rust is
	 * the only thing that measures `textContent`; the painter (`AnnotationLayer`,
	 * `screenshotExport.ts`) never re-measures. Empty for an annotation whose
	 * measurement hasn't landed yet (or that has no `textContent`). */
	textFragments: Map<string, Fragment[]>;
	/** Lets a caller that already ran its own `measure_text` (the commit path
	 * in `AnnotationLayer.tsx`, which needs the result synchronously to
	 * auto-resize before ending its undo gesture) hand the result straight
	 * to `textFragments` instead of it being silently overwritten a moment
	 * later by the debounced effect re-measuring the same content. */
	recordTextMeasurement: (
		id: string,
		content: TextContent,
		result: { fragments: Fragment[]; faces: number[] },
	) => void;

	selectedAnnotationId: string | null;
	setSelectedAnnotationId: (id: string | null) => void;
	activeTool: ScreenshotEditorTool;
	setActiveTool: (tool: ScreenshotEditorTool) => void;
	layersPanelOpen: boolean;
	setLayersPanelOpen: (open: boolean) => void;
	/** Which panel the right-hand container shows, or `null` for closed.
	 * `AnnotationConfig` is not in here: it is contextual on the selection
	 * rather than toggled, so it overrides this while a shape is selected and
	 * hands the slot back untouched afterwards. */
	rightPanel: RightPanel | null;
	setRightPanel: (panel: RightPanel | null) => void;
	/** Opens `panel`, or closes the container if it is already showing. */
	toggleRightPanel: (panel: RightPanel) => void;

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
	lockedLayerIds: ReadonlySet<string>;
	setLayerLocked: (id: string, locked: boolean) => void;

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
	const [rightPanel, setRightPanel] = useState<RightPanel | null>("style");
	const toggleRightPanel = useCallback((panel: RightPanel) => {
		setRightPanel((current) => (current === panel ? null : panel));
		// The container holds one panel, and a selected shape outranks the
		// toggled one — so asking for Style while a shape is selected would
		// otherwise set state that nothing displays, leaving the toolbar
		// button lit next to a panel it did not open. Clearing the selection
		// is what makes the button mean what it says.
		setSelectedAnnotationIdState(null);
	}, []);

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
			live.current = { ...current, ...next };
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
	const [cardCanvas, setCardCanvas] = useState<HTMLCanvasElement | null>(null);
	const [captureSelected, setCaptureSelectedState] = useState(false);
	const [lockedLayerIds, setLockedLayerIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [lockStorageLoadedFor, setLockStorageLoadedFor] = useState<
		string | null
	>(null);
	const lockStorageKey = instance
		? `quiro:screenshot-editor:locked-layers:${instance.path}`
		: null;

	useEffect(() => {
		if (!lockStorageKey) {
			setLockedLayerIds(new Set());
			setLockStorageLoadedFor(null);
			return;
		}

		let loaded = new Set<string>();
		try {
			const stored = localStorage.getItem(lockStorageKey);
			const parsed: unknown = stored ? JSON.parse(stored) : [];
			if (Array.isArray(parsed)) {
				loaded = new Set(
					parsed.filter((id): id is string => typeof id === "string"),
				);
			}
		} catch {
			loaded = new Set();
		}
		setLockedLayerIds(loaded);
		setLockStorageLoadedFor(lockStorageKey);
	}, [lockStorageKey]);

	useEffect(() => {
		if (!lockStorageKey || lockStorageLoadedFor !== lockStorageKey) return;
		try {
			localStorage.setItem(lockStorageKey, JSON.stringify([...lockedLayerIds]));
		} catch {
			return;
		}
	}, [lockStorageKey, lockStorageLoadedFor, lockedLayerIds]);

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
	const setLayerLocked = useCallback((id: string, locked: boolean) => {
		setLockedLayerIds((previous) => {
			const next = new Set(previous);
			if (locked) next.add(id);
			else next.delete(id);
			return next;
		});
		if (locked) {
			if (id === "capture") setCaptureSelectedState(false);
			else
				setSelectedAnnotationIdState((selected) =>
					selected === id ? null : selected,
				);
		}
	}, []);
	const renderTimer = useRef<number | undefined>(undefined);
	const saveTimer = useRef<number | undefined>(undefined);
	const lastRenderAt = useRef(0);

	useEffect(() => {
		if (!instance || !project) return;

		const config: ProjectConfiguration = {
			...project,
			annotations,
		};
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

		return () => {
			window.clearTimeout(renderTimer.current);
		};
	}, [project, annotations, instance]);

	// Persistence is debounced far longer than rendering, so a drag is one
	// write rather than hundreds.
	useEffect(() => {
		if (!instance || !project) return;

		const config: ProjectConfiguration = { ...project, annotations };
		window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(() => {
			void commands.updateScreenshotConfig(config, true, revisionRef.current);
		}, SAVE_DEBOUNCE_MS);

		return () => {
			window.clearTimeout(saveTimer.current);
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

	// --- text fragments and font faces ---------------------------------------
	//
	// Fragments are derived state, never stored in the project file: recomputed
	// here whenever a text annotation's content actually changes, and dropped
	// once the annotation is gone. `measuredKeys` remembers what was last sent
	// to `measure_text` per annotation id, so a pure position/rotation drag —
	// which changes `resolvedAnnotations`' identity every pointer move without
	// touching `textContent` — never re-measures.
	const [textFragments, setTextFragments] = useState<Map<string, Fragment[]>>(
		new Map(),
	);
	const measuredKeys = useRef<Map<string, string>>(new Map());
	/** Ids with a `measure_text` call outstanding. `measuredKeys` used to be
	 * written before the await to stop the effect re-firing for the same
	 * annotation; that conflated "in flight" with "done", which is what made a
	 * failure permanent. These are separate concerns and now separate sets. */
	const measuring = useRef<Set<string>>(new Set());

	/** Records a `measure_text` result a caller already has in hand — the
	 * commit path in `AnnotationLayer.tsx` calls `measure_text` itself
	 * (synchronously, inside the same paused undo gesture, to auto-resize
	 * before `endGesture()`), and without this its `fragments`/`faces`
	 * would otherwise be thrown away and re-fetched ~200ms later by the
	 * debounced effect below — a stale-fragment flash plus a wasted IPC
	 * round trip for a measurement this process already has. */
	const recordTextMeasurement = useCallback(
		(
			id: string,
			content: TextContent,
			result: { fragments: Fragment[]; faces: number[] },
		) => {
			measuredKeys.current.set(id, JSON.stringify(content));
			for (const faceId of result.faces) void registerFace(faceId);
			setTextFragments((current) => {
				const next = new Map(current);
				next.set(id, result.fragments);
				return next;
			});
		},
		[],
	);

	useEffect(() => {
		// Height feeds `anchorHeight`, which is what scales every font size. A
		// zero or negative one measures glyphs at zero and paints nothing, so
		// wait for a real rect rather than caching that result.
		if (!anchorRect || anchorRect.height <= 0) return;

		const textAnnotations = resolvedAnnotations.filter(
			(a) => a.type === "text" && a.textContent != null,
		);

		const liveIds = new Set(textAnnotations.map((a) => a.id));
		for (const id of measuredKeys.current.keys()) {
			if (!liveIds.has(id)) measuredKeys.current.delete(id);
		}
		setTextFragments((current) => {
			let changed = false;
			const next = new Map(current);
			for (const id of next.keys()) {
				if (!liveIds.has(id)) {
					next.delete(id);
					changed = true;
				}
			}
			return changed ? next : current;
		});

		const pending = textAnnotations.filter(
			(a) =>
				!measuring.current.has(a.id) &&
				measuredKeys.current.get(a.id) !== JSON.stringify(a.textContent),
		);
		if (pending.length === 0) return;

		// The debounce is there to stop a fast typist firing one IPC per
		// character. An annotation that has never been measured is not that:
		// it is a project being opened, and every millisecond of debounce is a
		// millisecond of blank canvas where text should be. Measure those at
		// once and keep the wait for edits to already-measured text.
		const firstMeasurement = pending.every(
			(a) => !measuredKeys.current.has(a.id),
		);

		const timer = window.setTimeout(
			() => {
				void (async () => {
					for (const a of pending) {
						if (!a.textContent) continue;
						measuring.current.add(a.id);

						const result = await commands.measureText(a.textContent, {
							anchorHeight: anchorRect.height,
							width: a.width,
							height: a.height,
						});
						measuring.current.delete(a.id);

						// Only a *successful* measurement is remembered. Marking the
						// key before the call meant one failure hid that text for the
						// rest of the session: nothing repaints text without
						// fragments, and the annotation could never re-enter
						// `pending` because its key already matched. Reopening a
						// project was the common way to see it — the text was
						// selectable in the layers panel and invisible on canvas
						// until a style edit changed the key and forced a retry.
						if (result.status === "error") continue;
						measuredKeys.current.set(a.id, JSON.stringify(a.textContent));

						for (const faceId of result.data.faces) void registerFace(faceId);

						setTextFragments((current) => {
							const next = new Map(current);
							next.set(a.id, result.data.fragments);
							return next;
						});
					}
				})();
			},
			firstMeasurement ? 0 : MEASURE_DEBOUNCE_MS,
		);

		return () => window.clearTimeout(timer);
	}, [resolvedAnnotations, anchorRect]);

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
			textFragments,
			recordTextMeasurement,
			selectedAnnotationId,
			setSelectedAnnotationId,
			cardCanvas,
			setCardCanvas,
			captureSelected,
			setCaptureSelected,
			lockedLayerIds,
			setLayerLocked,
			activeTool,
			setActiveTool,
			layersPanelOpen,
			setLayersPanelOpen,
			rightPanel,
			setRightPanel,
			toggleRightPanel,
			latestFrame,
			latestCardFrame,
			originalImageSize,
			configRevision,
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
			textFragments,
			recordTextMeasurement,
			selectedAnnotationId,
			activeTool,
			layersPanelOpen,
			rightPanel,
			toggleRightPanel,
			latestFrame,
			latestCardFrame,
			originalImageSize,
			configRevision,
			cardCanvas,
			captureSelected,
			setCaptureSelected,
			lockedLayerIds,
			setLayerLocked,
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
