import { cn } from "@quiro/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnotationLayer } from "./AnnotationLayer";
import { useScreenshotEditorContext } from "./context";
import { getImageRect } from "./layout";
import { OcrSelectionOverlay } from "./OcrSelectionOverlay";
import { applyFocus, paintMasks } from "./screenshotExport";

// Cap's Preview does not composite anything: the Rust side renders the framed
// screenshot on the GPU (quiro-rendering, the same crate that renders video)
// and streams finished frames over a websocket; this blits the newest one onto
// a 2D canvas and puts the SVG annotation layer over it. Everything visual —
// background, padding, rounding, shadow, border, aspect ratio, masks — is
// decided by the renderer, so there is one implementation of the framing math
// and the preview cannot drift from the exported PNG.

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
		project,
		originalImageSize,
		activeTool,
		annotations,
		setPreviewCanvas,
		setPreviewMaskCanvas,
	} = useScreenshotEditorContext();

	const canvasRef = useRef<HTMLCanvasElement>(null);
	const maskCanvasRef = useRef<HTMLCanvasElement>(null);
	const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
	const hasFrame = frameSize.width > 0;

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

	// Export reads both canvases straight out of the context rather than being
	// handed one down through props.
	useEffect(() => {
		setPreviewCanvas(hasFrame ? canvasRef.current : null);
		setPreviewMaskCanvas(hasFrame ? maskCanvasRef.current : null);
	}, [hasFrame, setPreviewCanvas, setPreviewMaskCanvas]);

	const viewportRef = useRef<HTMLDivElement>(null);
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			setViewportSize({ width: rect.width, height: rect.height });
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
			),
		[frameSize, originalImageSize, project],
	);

	// Masks are painted onto a second canvas stacked over the first, reading
	// pixels back out of it. They cannot be SVG like the other annotations —
	// blurring and pixelating need the rendered pixels underneath — and they
	// cannot be drawn onto the main canvas either, because each mask must sample
	// the *unmasked* frame or overlapping masks would compound.
	//
	// Declared after the blit effect above so that, in a commit where both run,
	// the frame is already on the source canvas before this samples it.
	useEffect(() => {
		const maskCanvas = maskCanvasRef.current;
		const source = canvasRef.current;
		if (!maskCanvas) return;

		const ctx = maskCanvas.getContext("2d");
		if (!ctx) return;

		if (!latestFrame || !source) {
			maskCanvas.width = 0;
			maskCanvas.height = 0;
			return;
		}

		if (
			maskCanvas.width !== latestFrame.width ||
			maskCanvas.height !== latestFrame.height
		) {
			maskCanvas.width = latestFrame.width;
			maskCanvas.height = latestFrame.height;
		}

		ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

		// The depth-of-field pass runs at interactive quality here — the same
		// shader the export uses, just with fewer bokeh samples — and only ever
		// over the screenshot region, so the background stays untouched. The
		// texture upload is keyed on the frame, so dragging the focus re-runs
		// the shader without re-uploading.
		if (project)
			applyFocus(
				ctx,
				{ canvas: source, revision: latestFrame },
				annotations,
				imageRect,
				project,
				"preview",
			);

		// After focus: masks re-read the pristine frame, so a redaction inside
		// the focus region stays hard rather than picking up the defocus.
		if (annotations.some((a) => a.type === "mask"))
			paintMasks(ctx, source, annotations, imageRect);
	}, [latestFrame, annotations, imageRect, project]);

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

	const beginPan = (clientX: number, clientY: number) => {
		panRef.current = { x: clientX, y: clientY, pan: viewport.pan };
		setIsPanning(true);
	};

	return (
		<div
			ref={viewportRef}
			onPointerDown={(event) => {
				// Middle-drag pans from anywhere; a left-drag on empty canvas is
				// handled by the annotation layer, which forwards it here.
				if (event.button !== 1) return;
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
		>
			<div
				className="absolute origin-top-left rounded-lg"
				style={{ left, top, width: scaledWidth, height: scaledHeight }}
			>
				<canvas
					ref={canvasRef}
					className={cn(
						"h-full w-full shadow-lg rounded-lg",
						!hasFrame && "invisible",
					)}
				/>
				<canvas
					ref={maskCanvasRef}
					aria-hidden
					className={cn(
						"pointer-events-none absolute inset-0 h-full w-full",
						!hasFrame && "invisible",
					)}
				/>
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
						isPanning={isPanning}
						onBackgroundMouseDown={(event) => {
							if (activeTool !== "select" || event.button !== 0) return;
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
