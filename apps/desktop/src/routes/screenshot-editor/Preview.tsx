import { cn } from "@quiro/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnotationLayer } from "./AnnotationLayer";
import { useScreenshotEditorContext } from "./context";
import { getImageRect } from "./layout";
import { OcrSelectionOverlay } from "./OcrSelectionOverlay";
import { frameRect } from "./space";
import { TransformGizmo } from "./TransformGizmo";
import {
	cardIsTilted,
	cardLayerPlacement,
	IDENTITY_TRANSFORM,
	resolveTransform,
} from "./transform";

// The preview is a layer stack, not a single image.
//
// The Rust side (quiro-rendering, the same crate that renders video) draws the
// composition on the GPU and streams it over a websocket — but in two pieces:
// the canvas, and the capture's card alone on transparency. The canvas is a
// fixed viewport that clips; the card is stacked over it and placed by a CSS
// transform.
//
// That split is what makes placing the capture feel immediate. A drag, a scale
// or a spin is a compositor transform over two images the browser already has,
// so it costs nothing and runs at display refresh rate — where routing it
// through the renderer would mean a GPU pass plus a full RGBA frame over a
// socket for every pointer move.
//
// Everything visual is still decided by the renderer: background, padding,
// rounding, shadow, border, aspect ratio, tilt. The transform the browser
// applies here is the exact one `display_layout` would have applied, and the
// card image is rendered where layout alone would put it, so the two agree by
// construction — see `card_pass_config`. Export never takes this path at all:
// it renders the whole composition in one pass, on demand.

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;
export const clampZoom = (zoom: number) =>
	Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

export type Viewport = { zoom: number; pan: { x: number; y: number } };
export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, pan: { x: 0, y: 0 } };

/** Wheel deltas arrive in lines or pages on some devices; normalise to px so
 * one zoom step means the same thing everywhere (Cap's normalizeWheelDeltaY). */
function normalizeWheelDeltaY(event: WheelEvent) {
	if (event.deltaMode === 1) return event.deltaY * 16;
	if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
	return event.deltaY;
}

export function Preview({
	viewport,
	onViewportChange,
}: {
	viewport: Viewport;
	onViewportChange: (viewport: Viewport) => void;
}) {
	const {
		latestFrame,
		latestCardFrame,
		project,
		originalImageSize,
		activeTool,
		setAnchorRect,
		setCardCanvas,
		setCaptureSelected,
		setSelectedAnnotationId,
		lockedLayerIds,
	} = useScreenshotEditorContext();

	const canvasRef = useRef<HTMLCanvasElement>(null);
	const cardCanvasRef = useRef<HTMLCanvasElement>(null);
	const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
	const hasFrame = frameSize.width > 0;
	const hasCard = !!latestCardFrame;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !latestFrame) return;

		if (
			canvas.width !== latestFrame.width ||
			canvas.height !== latestFrame.height
		) {
			canvas.width = latestFrame.width;
			canvas.height = latestFrame.height;
			setFrameSize({ width: latestFrame.width, height: latestFrame.height });
		}

		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(latestFrame.bitmap, 0, 0);
	}, [latestFrame]);

	// The card layer arrives on its own socket at the same size as the canvas,
	// so it needs no placement of its own here — the wrapper it sits in carries
	// the transform.
	useEffect(() => {
		const canvas = cardCanvasRef.current;
		if (!canvas || !latestCardFrame) return;

		if (
			canvas.width !== latestCardFrame.width ||
			canvas.height !== latestCardFrame.height
		) {
			canvas.width = latestCardFrame.width;
			canvas.height = latestCardFrame.height;
		}

		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(latestCardFrame.bitmap, 0, 0);
	}, [latestCardFrame]);

	// Published because the capture's hit test is a question about its alpha,
	// and this is the only component that holds the canvas carrying it.
	useEffect(() => {
		setCardCanvas(hasCard ? cardCanvasRef.current : null);
	}, [hasCard, setCardCanvas]);

	const viewportRef = useRef<HTMLDivElement>(null);
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			setViewportSize((current) =>
				current.width === rect.width && current.height === rect.height
					? current
					: { width: rect.width, height: rect.height },
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	// Zoom 1 means "fits the viewport", not "100% of native pixels" — a 4K
	// screenshot at native size would be unusable as a starting view.
	const fitScale =
		frameSize.width > 0 && frameSize.height > 0 && viewportSize.width > 0
			? Math.min(
					(viewportSize.width - 64) / frameSize.width,
					(viewportSize.height - 64) / frameSize.height,
					1,
				)
			: 1;
	const scale = fitScale * viewport.zoom;
	const scaledWidth = frameSize.width * scale;
	const scaledHeight = frameSize.height * scale;
	const left = (viewportSize.width - scaledWidth) / 2 + viewport.pan.x;
	const top = (viewportSize.height - scaledHeight) / 2 + viewport.pan.y;

	// The capture's free placement inside the canvas — drag, uniform scale,
	// in-plane rotation. Resolved once here so `null` (the state of every
	// project that has never touched the gizmo) short-circuits every consumer
	// below onto the path it took before the transform existed.
	const layerTransform = useMemo(
		() => resolveTransform(project?.background.displayTransform),
		[project?.background.displayTransform],
	);
	const cardRotation = layerTransform?.rotation ?? 0;

	// Where the screenshot itself sits inside the rendered frame, so masks can
	// be clamped to it. Mirrors the renderer's own layout math (layout.ts).
	const imageRect = useMemo(
		() =>
			getImageRect(
				frameSize,
				originalImageSize,
				project?.background.padding ?? 0,
				project?.background.crop ?? null,
				project?.aspectRatio ?? null,
				project?.background.displayTransform ?? null,
			),
		[frameSize, originalImageSize, project],
	);

	// The same rect with no transform applied: where layout alone would put the
	// capture. The gizmo measures its offsets against this, and because layout
	// cannot change mid-gesture it is the fixed reference that keeps a drag
	// from feeding back into itself.
	const laidOutRect = useMemo(
		() =>
			getImageRect(
				frameSize,
				originalImageSize,
				project?.background.padding ?? 0,
				project?.background.crop ?? null,
				project?.aspectRatio ?? null,
			),
		[frameSize, originalImageSize, project],
	);

	// Read off the two layers rather than recomputed from config: the renderer
	// decides how much bleed the card needs, and the difference in width *is*
	// that decision. Nothing to keep in sync, nothing to drift.
	const cardBleed =
		latestCardFrame && frameSize.width > 0
			? Math.max(0, (latestCardFrame.width - frameSize.width) / 2)
			: 0;

	// How the capture's layer is placed over the canvas layer. Recomputed on
	// every commit and nowhere else — during a gesture this string is the only
	// thing that changes, and the browser's compositor does the rest.
	const cardPlacement = useMemo(
		() =>
			cardLayerPlacement(
				layerTransform,
				laidOutRect,
				frameSize,
				{ width: scaledWidth, height: scaledHeight },
				// Mirrors `card_pass_config`: a flat card is spun here, a tilted one
				// was already spun by the renderer.
				!cardIsTilted(project?.background.perspective),
				cardBleed,
			),
		[
			layerTransform,
			laidOutRect,
			frameSize,
			scaledWidth,
			scaledHeight,
			project?.background.perspective,
			cardBleed,
		],
	);

	// The anchor every stored annotation is normalized against. Only this
	// component knows the rendered frame size, so it is the one place that can
	// compute it — see `context.tsx`'s storage boundary.
	useEffect(() => {
		setAnchorRect(imageRect);
	}, [imageRect, setAnchorRect]);

	const zoomAtPoint = useCallback(
		(clientX: number, clientY: number, nextZoom: number) => {
			const element = viewportRef.current;
			if (!element || fitScale <= 0) return;
			const rect = element.getBoundingClientRect();
			const pointerX = clientX - rect.left;
			const pointerY = clientY - rect.top;

			const currentScale = fitScale * viewport.zoom;
			const nextScale = fitScale * nextZoom;
			if (currentScale <= 0 || nextScale <= 0) return;

			// Keeps the point under the cursor fixed, so the canvas grows towards
			// where you are pointing rather than the centre.
			const currentOffsetX =
				(rect.width - frameSize.width * currentScale) / 2 + viewport.pan.x;
			const currentOffsetY =
				(rect.height - frameSize.height * currentScale) / 2 + viewport.pan.y;
			const contentX = (pointerX - currentOffsetX) / currentScale;
			const contentY = (pointerY - currentOffsetY) / currentScale;

			onViewportChange({
				zoom: nextZoom,
				pan: {
					x:
						pointerX -
						contentX * nextScale -
						(rect.width - frameSize.width * nextScale) / 2,
					y:
						pointerY -
						contentY * nextScale -
						(rect.height - frameSize.height * nextScale) / 2,
				},
			});
		},
		[fitScale, viewport, frameSize, onViewportChange],
	);

	// Native listener, not onWheel: React registers wheel passively on the
	// root, so preventDefault from a prop is ignored and the whole window
	// scrolls instead of the canvas zooming.
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;

		const handleWheel = (event: WheelEvent) => {
			event.preventDefault();
			// ctrlKey is set by trackpad pinch as well as a real Ctrl+wheel.
			if (event.ctrlKey || event.metaKey) {
				const delta = normalizeWheelDeltaY(event);
				if (delta === 0) return;
				const step = -Math.sign(delta) * Math.max(Math.abs(delta), 8) * 0.005;
				zoomAtPoint(
					event.clientX,
					event.clientY,
					clampZoom(viewport.zoom + step),
				);
			} else {
				onViewportChange({
					...viewport,
					pan: {
						x: viewport.pan.x - event.deltaX,
						y: viewport.pan.y - event.deltaY,
					},
				});
			}
		};

		element.addEventListener("wheel", handleWheel, { passive: false });
		return () => element.removeEventListener("wheel", handleWheel);
	}, [zoomAtPoint, viewport, onViewportChange]);

	const panRef = useRef<{ x: number; y: number; pan: Viewport["pan"] } | null>(
		null,
	);
	const [isPanning, setIsPanning] = useState(false);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}
			if (!event.metaKey && !event.ctrlKey) return;
			if (event.key === "-") {
				event.preventDefault();
				onViewportChange({ ...viewport, zoom: clampZoom(viewport.zoom - 0.1) });
			} else if (event.key === "=" || event.key === "+") {
				event.preventDefault();
				onViewportChange({ ...viewport, zoom: clampZoom(viewport.zoom + 0.1) });
			} else if (event.key === "0") {
				event.preventDefault();
				onViewportChange(DEFAULT_VIEWPORT);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [viewport, onViewportChange]);

	useEffect(() => {
		const handleMove = (event: PointerEvent) => {
			const start = panRef.current;
			if (!start) return;
			onViewportChange({
				...viewport,
				pan: {
					x: start.pan.x + (event.clientX - start.x),
					y: start.pan.y + (event.clientY - start.y),
				},
			});
		};
		const handleUp = () => {
			panRef.current = null;
			setIsPanning(false);
		};
		window.addEventListener("pointermove", handleMove);
		window.addEventListener("pointerup", handleUp);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", handleUp);
		};
	}, [viewport, onViewportChange]);

	// Space arms a pan over anything, including the capture — the capture is
	// grabbable now, so the margin alone is not always enough room to pan from.
	// The margin still pans on a plain drag; this only adds a way to do it
	// without one.
	const [spaceHeld, setSpaceHeld] = useState(false);
	useEffect(() => {
		const editing = (target: EventTarget | null) => {
			const element = target as HTMLElement | null;
			return (
				element?.tagName === "INPUT" ||
				element?.tagName === "TEXTAREA" ||
				element?.isContentEditable === true
			);
		};
		const down = (event: KeyboardEvent) => {
			// Space types a space in a text annotation, and scrolls the page
			// everywhere else — neither should become a pan.
			if (event.code !== "Space" || event.repeat || editing(event.target))
				return;
			event.preventDefault();
			setSpaceHeld(true);
		};
		const up = (event: KeyboardEvent) => {
			if (event.code === "Space") setSpaceHeld(false);
		};
		// A blur mid-hold would otherwise leave the pan armed with nothing to
		// release it.
		const clear = () => setSpaceHeld(false);
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("blur", clear);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", clear);
		};
	}, []);

	const beginPan = (clientX: number, clientY: number) => {
		panRef.current = { x: clientX, y: clientY, pan: viewport.pan };
		setIsPanning(true);
	};

	return (
		<div
			ref={viewportRef}
			onPointerDown={(event) => {
				// Middle-drag pans from anywhere, and so does space+drag — which is
				// the only way to pan from over the capture, since a plain press
				// there moves it. A left-drag on the empty margin reaches the
				// gizmo's miss path instead.
				if (event.button !== 1 && !(spaceHeld && event.button === 0)) return;
				event.preventDefault();
				beginPan(event.clientX, event.clientY);
			}}
			// `isolate` matters: the annotation layer (z-20) and the OCR overlay
			// (z-15) sit inside here, and without a stacking context on this
			// element those values escape to the document root — where they
			// outrank the toolbar, which has none, and swallow its clicks.
			// Marks the tool's workspace: a pointerdown anywhere outside this and
			// the toolbar disarms the active tool (see AnnotationTools).
			data-editor-canvas
			className="relative isolate h-full w-full overflow-hidden bg-gray-2 "
			style={
				spaceHeld ? { cursor: isPanning ? "grabbing" : "grab" } : undefined
			}
		>
			<div
				className="absolute origin-top-left rounded-lg"
				style={{ left, top, width: scaledWidth, height: scaledHeight }}
			>
				{/* The canvas layer, and the clip. `overflow-hidden` here is the
				    whole of "the canvas is a viewport": whatever the capture's
				    transform puts outside this box is simply not drawn, which is
				    the same thing the renderer's output texture does on export. */}
				<div
					className={cn(
						"relative h-full w-full overflow-hidden rounded-lg shadow-lg",
						!hasFrame && "invisible",
					)}
				>
					<canvas ref={canvasRef} className="h-full w-full" />

					{/* The capture layer. Everything inside moves, scales and spins
					    together — the card, its shadow, and the mask and
					    depth-of-field passes painted in its own space — because they
					    are all measured against the same untransformed rect. */}
					<div
						className="absolute"
						style={{
							...cardPlacement.inset,
							transform: cardPlacement.transform,
							transformOrigin: cardPlacement.transformOrigin,
							willChange: cardPlacement.transform ? "transform" : undefined,
						}}
					>
						<canvas
							ref={cardCanvasRef}
							className={cn(
								"absolute inset-0 h-full w-full",
								!hasCard && "invisible",
							)}
						/>
					</div>
				</div>
				{hasFrame && (
					<OcrSelectionOverlay
						bounds={{
							x: 0,
							y: 0,
							width: frameSize.width,
							height: frameSize.height,
						}}
						cssWidth={scaledWidth}
						cssHeight={scaledHeight}
						imageRect={imageRect}
						originalImageSize={originalImageSize}
						crop={project?.background.crop ?? null}
					/>
				)}
				{hasFrame && (
					<AnnotationLayer
						bounds={{
							x: 0,
							y: 0,
							width: frameSize.width,
							height: frameSize.height,
						}}
						cssWidth={scaledWidth}
						cssHeight={scaledHeight}
						imageRect={imageRect}
						cardRotation={cardRotation}
						contentVisible={false}
						isPanning={isPanning}
						onBackgroundMouseDown={(event) => {
							if (activeTool !== "select" || event.button !== 0) return;
							beginPan(event.clientX, event.clientY);
						}}
					/>
				)}

				{/* Mounted for the whole of select mode, not armed by a tool: the
				    capture is moved by pressing it, so something has to be there to
				    notice the press. It decides for itself whether one was meant
				    for it and hands back the ones that were not. */}
				{hasFrame && activeTool === "select" && (
					<TransformGizmo
						bounds={frameRect(0, 0, frameSize.width, frameSize.height)}
						cssWidth={scaledWidth}
						cssHeight={scaledHeight}
						laidOutRect={laidOutRect}
						imageRect={imageRect}
						transform={layerTransform ?? IDENTITY_TRANSFORM}
						cssRotation={
							cardIsTilted(project?.background.perspective)
								? 0
								: (layerTransform?.rotation ?? 0)
						}
						disabled={spaceHeld || lockedLayerIds.has("capture")}
						onMiss={(event) => {
							if (event.button !== 0) return;
							setCaptureSelected(false);
							setSelectedAnnotationId(null);
							beginPan(event.clientX, event.clientY);
						}}
					/>
				)}
			</div>

			{!hasFrame && (
				<div
					role="status"
					className="absolute inset-0 flex items-center justify-center text-sm text-gray-10"
				>
					Rendering…
				</div>
			)}
		</div>
	);
}
