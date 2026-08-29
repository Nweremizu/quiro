import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Annotation, AnnotationType } from "@/utils/tauri";
import { getArrowHeadPoints } from "./arrow";
import { DEFAULT_FOCUS, DEFAULT_FOCUS_STRENGTH } from "./constants";
import { useScreenshotEditorContext } from "./context";

// React port of Cap's `AnnotationLayer.tsx`. Annotations are SVG, not canvas —
// that is Cap's choice and it is the right one: hit-testing, hover and drag all
// come free from DOM events instead of needing point-in-shape math against a
// bitmap. The <svg> sits over the rendered frame in the frame's own coordinate
// space (via viewBox), so annotation coordinates are frame pixels and survive
// zooming without rescaling.

type Rect = { x: number; y: number; width: number; height: number };

type DragState = {
	id: string;
	action: "move" | "resize";
	handle?: string;
	startX: number;
	startY: number;
	original: Annotation;
};

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

const DEFAULT_STROKE = "#F05656";

export function AnnotationLayer({
	bounds,
	cssWidth,
	cssHeight,
	imageRect,
	isPanning,
	onBackgroundMouseDown,
}: {
	bounds: Rect;
	cssWidth: number;
	cssHeight: number;
	imageRect: Rect;
	isPanning?: boolean;
	onBackgroundMouseDown?: (event: React.MouseEvent) => void;
}) {
	const {
		annotations,
		setAnnotations,
		activeTool,
		setActiveTool,
		selectedAnnotationId,
		setSelectedAnnotationId,
		history,
	} = useScreenshotEditorContext();

	const [isDrawing, setIsDrawing] = useState(false);
	const [dragState, setDragState] = useState<DragState | null>(null);
	const [textEditingId, setTextEditingId] = useState<string | null>(null);
	const [tempAnnotation, setTempAnnotation] = useState<Annotation | null>(null);

	// A whole gesture is one undo entry: history is paused on pointer-down and
	// resumed on pointer-up, rather than snapshotting per pointer-move.
	const resumeHistory = useRef<(() => void) | null>(null);
	const beginGesture = useCallback(() => {
		resumeHistory.current?.();
		resumeHistory.current = history.pause();
	}, [history]);
	const endGesture = useCallback(() => {
		resumeHistory.current?.();
		resumeHistory.current = null;
	}, []);
	useEffect(() => () => resumeHistory.current?.(), []);

	const patch = useCallback(
		(id: string, changes: Partial<Annotation>) =>
			setAnnotations(
				annotations.map((a) => (a.id === id ? { ...a, ...changes } : a)),
			),
		[annotations, setAnnotations],
	);

	// Delete / Backspace removes the selection, except while typing.
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (textEditingId) return;
			if (event.key !== "Backspace" && event.key !== "Delete") return;
			if (!selectedAnnotationId) return;
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}
			event.preventDefault();
			setAnnotations(annotations.filter((a) => a.id !== selectedAnnotationId));
			setSelectedAnnotationId(null);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		textEditingId,
		selectedAnnotationId,
		annotations,
		setAnnotations,
		setSelectedAnnotationId,
	]);

	/** Client coords → the SVG's viewBox space, which is frame pixels. */
	const toSvgPoint = useCallback(
		(event: React.MouseEvent, svg: SVGSVGElement) => {
			const rect = svg.getBoundingClientRect();
			return {
				x: bounds.x + ((event.clientX - rect.left) / rect.width) * bounds.width,
				y:
					bounds.y + ((event.clientY - rect.top) / rect.height) * bounds.height,
			};
		},
		[bounds],
	);

	// Masks redact part of the screenshot, so they are meaningless outside it
	// and are clamped to the image rather than the whole canvas.
	const clampToImage = useCallback(
		(x: number, y: number) => ({
			x: clamp(x, imageRect.x, imageRect.x + imageRect.width),
			y: clamp(y, imageRect.y, imageRect.y + imageRect.height),
		}),
		[imageRect],
	);

	const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
		if (textEditingId) {
			if ((event.target as HTMLElement).closest(".text-editor")) return;
			setTextEditingId(null);
		}

		if (activeTool === "select") {
			if (event.target === event.currentTarget) {
				setSelectedAnnotationId(null);
				onBackgroundMouseDown?.(event);
			}
			return;
		}

		const point = toSvgPoint(event, event.currentTarget);

		// Clicking with the focus tool aims the camera. The point is stored
		// normalized to the screenshot so the plane of focus survives a change
		// of padding, crop, aspect ratio or export scale.
		if (activeTool === "focus") {
			const aim = {
				x: clamp((point.x - imageRect.x) / Math.max(1, imageRect.width), 0, 1),
				y: clamp((point.y - imageRect.y) / Math.max(1, imageRect.height), 0, 1),
			};

			const existing = annotations.find((a) => a.type === "focus");
			if (existing?.focus) {
				beginGesture();
				patch(existing.id, { focus: { ...existing.focus, ...aim } });
				endGesture();
				setActiveTool("select");
				setSelectedAnnotationId(existing.id);
				return;
			}

			const annotation: Annotation = {
				id: crypto.randomUUID(),
				type: "focus",
				// The region lives in `focus` as normalized values; these frame-px
				// fields are only kept in sync for hit-testing and are derived, not
				// authoritative.
				x: 0,
				y: 0,
				width: 0,
				height: 0,
				strokeColor: "transparent",
				strokeWidth: 0,
				fillColor: "transparent",
				opacity: DEFAULT_FOCUS_STRENGTH,
				rotation: 0,
				text: null,
				focus: { ...DEFAULT_FOCUS, ...aim },
			};

			beginGesture();
			// Head of the list: focus renders before everything else, and the
			// layers panel reads that position as "not a reorderable layer".
			setAnnotations([annotation, ...annotations]);
			endGesture();
			setActiveTool("select");
			setSelectedAnnotationId(annotation.id);
			return;
		}

		const start =
			activeTool === "mask" ? clampToImage(point.x, point.y) : point;

		const annotation: Annotation = {
			id: crypto.randomUUID(),
			type: activeTool as AnnotationType,
			x: start.x,
			y: start.y,
			width: activeTool === "text" ? 150 : 0,
			height: activeTool === "text" ? 40 : 0,
			strokeColor: activeTool === "mask" ? "transparent" : DEFAULT_STROKE,
			strokeWidth: activeTool === "mask" ? 0 : 4,
			fillColor: "transparent",
			opacity: 1,
			rotation: 0,
			text: activeTool === "text" ? "Text" : null,
			maskType: activeTool === "mask" ? "pixelate" : null,
			maskLevel: activeTool === "mask" ? 7 : null,
		};

		beginGesture();
		setIsDrawing(true);
		setTempAnnotation(annotation);
		// A mask goes into the list immediately so the renderer blurs live as
		// it is dragged out; other shapes only need the SVG preview.
		if (activeTool === "mask") setAnnotations([...annotations, annotation]);
	};

	const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
		const point = toSvgPoint(event, event.currentTarget);

		if (isDrawing && tempAnnotation) {
			const temp = tempAnnotation;
			if (temp.type === "text") return;

			const current =
				temp.type === "mask" ? clampToImage(point.x, point.y) : point;
			let width = current.x - temp.x;
			let height = current.y - temp.y;

			// Circles are round by default and free-form with Shift; rectangles
			// and masks are the other way round. Arrows snap to 45°.
			const square = () => {
				const size = Math.max(Math.abs(width), Math.abs(height));
				width = width < 0 ? -size : size;
				height = height < 0 ? -size : size;
			};
			if (temp.type === "circle" && !event.shiftKey) square();
			else if (event.shiftKey) {
				if (temp.type === "rectangle" || temp.type === "mask") square();
				else if (temp.type === "arrow") {
					const angle = Math.atan2(height, width);
					const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
					const distance = Math.hypot(width, height);
					width = Math.cos(snapped) * distance;
					height = Math.sin(snapped) * distance;
				}
			}

			const next = { ...temp, width, height };
			setTempAnnotation(next);
			if (temp.type === "mask") patch(temp.id, next);
			return;
		}

		if (!dragState) return;
		const dx = point.x - dragState.startX;
		const dy = point.y - dragState.startY;
		const original = dragState.original;

		if (dragState.action === "move") {
			const nextX = original.x + dx;
			const nextY = original.y + dy;
			patch(
				dragState.id,
				original.type === "mask"
					? {
							x: clamp(
								nextX,
								imageRect.x,
								imageRect.x + imageRect.width - Math.abs(original.width),
							),
							y: clamp(
								nextY,
								imageRect.y,
								imageRect.y + imageRect.height - Math.abs(original.height),
							),
						}
					: { x: nextX, y: nextY },
			);
			return;
		}

		if (!dragState.handle) return;
		let { x: newX, y: newY, width: newW, height: newH } = original;

		if (original.type === "arrow") {
			// An arrow has two endpoints rather than a box, so its handles move
			// the tail or the head instead of an edge.
			if (dragState.handle === "start") {
				newX = original.x + dx;
				newY = original.y + dy;
				newW = original.width - dx;
				newH = original.height - dy;
			} else if (dragState.handle === "end") {
				newW = original.width + dx;
				newH = original.height + dy;
			}
		} else {
			if (dragState.handle.includes("e")) newW = original.width + dx;
			if (dragState.handle.includes("s")) newH = original.height + dy;
			if (dragState.handle.includes("w")) {
				newX = original.x + dx;
				newW = original.width - dx;
			}
			if (dragState.handle.includes("n")) {
				newY = original.y + dy;
				newH = original.height - dy;
			}

			const constrain =
				(original.type === "circle" && !event.shiftKey) ||
				(original.type === "rectangle" && event.shiftKey);
			if (constrain) {
				const size = Math.max(Math.abs(newW), Math.abs(newH));
				const signW = newW < 0 ? -1 : 1;
				const signH = newH < 0 ? -1 : 1;
				if (dragState.handle.includes("w"))
					newX = original.x + original.width - signW * size;
				if (dragState.handle.includes("n"))
					newY = original.y + original.height - signH * size;
				newW = signW * size;
				newH = signH * size;
			}
		}

		if (original.type === "mask") {
			const left = clamp(
				Math.min(newX, newX + newW),
				imageRect.x,
				imageRect.x + imageRect.width,
			);
			const right = clamp(
				Math.max(newX, newX + newW),
				imageRect.x,
				imageRect.x + imageRect.width,
			);
			const top = clamp(
				Math.min(newY, newY + newH),
				imageRect.y,
				imageRect.y + imageRect.height,
			);
			const bottom = clamp(
				Math.max(newY, newY + newH),
				imageRect.y,
				imageRect.y + imageRect.height,
			);
			newX = left;
			newY = top;
			newW = Math.max(0, right - left);
			newH = Math.max(0, bottom - top);
		}

		patch(dragState.id, { x: newX, y: newY, width: newW, height: newH });
	};

	const handleMouseUp = () => {
		if (isDrawing && tempAnnotation) {
			const annotation = { ...tempAnnotation };

			if (
				annotation.type === "rectangle" ||
				annotation.type === "circle" ||
				annotation.type === "mask"
			) {
				// Dragging up/left produces negative extents; normalise so every
				// stored annotation has a positive width/height.
				if (annotation.width < 0) {
					annotation.x += annotation.width;
					annotation.width = Math.abs(annotation.width);
				}
				if (annotation.height < 0) {
					annotation.y += annotation.height;
					annotation.height = Math.abs(annotation.height);
				}

				// A click rather than a drag: discard instead of leaving a
				// zero-sized annotation that cannot be grabbed again.
				if (annotation.width < 5 && annotation.height < 5) {
					if (annotation.type === "mask") {
						setAnnotations(annotations.filter((a) => a.id !== annotation.id));
					}
					setTempAnnotation(null);
					setIsDrawing(false);
					endGesture();
					return;
				}
			}

			if (annotation.type === "mask") {
				patch(annotation.id, annotation);
			} else {
				setAnnotations([...annotations, annotation]);
			}

			setTempAnnotation(null);
			setIsDrawing(false);
			setActiveTool("select");
			setSelectedAnnotationId(annotation.id);
			if (annotation.type === "text") setTextEditingId(annotation.id);
		}

		setDragState(null);
		endGesture();
	};

	const startDrag = (event: React.MouseEvent, id: string, handle?: string) => {
		event.preventDefault();
		event.stopPropagation();
		if (activeTool !== "select") return;
		window.getSelection()?.removeAllRanges();

		const svg = (event.currentTarget as Element).closest("svg");
		if (!svg) return;
		const annotation = annotations.find((a) => a.id === id);
		if (!annotation) return;

		const point = toSvgPoint(event, svg as SVGSVGElement);
		beginGesture();
		setSelectedAnnotationId(id);
		setDragState({
			id,
			action: handle ? "resize" : "move",
			handle,
			startX: point.x,
			startY: point.y,
			original: { ...annotation },
		});
	};

	// Handles are drawn in frame space but should stay a constant on-screen
	// size, so their size is converted back through the current scale.
	const handleSize = useMemo(
		() => (cssWidth === 0 ? 0 : (10 / cssWidth) * bounds.width),
		[cssWidth, bounds.width],
	);

	return (
		<svg
			aria-label="Annotations"
			viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
			className={activeTool !== "select" ? "cursor-crosshair" : undefined}
			style={{
				width: `${cssWidth}px`,
				height: `${cssHeight}px`,
				position: "absolute",
				top: 0,
				left: 0,
				// While selecting, the layer is transparent to the pointer so the
				// canvas underneath can be panned; individual shapes opt back in.
				pointerEvents: activeTool === "select" && !dragState ? "none" : "all",
				zIndex: 20,
				cursor:
					activeTool === "select"
						? isPanning
							? "grabbing"
							: "grab"
						: undefined,
			}}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
		>
			<title>Annotations</title>
			{annotations.map((annotation) => (
				<g
					key={annotation.id}
					onMouseDown={(event) => startDrag(event, annotation.id)}
					onDoubleClick={(event) => {
						event.stopPropagation();
						if (annotation.type === "text") setTextEditingId(annotation.id);
					}}
					style={{
						pointerEvents: "all",
						cursor: activeTool === "select" ? "move" : "inherit",
					}}
				>
					{textEditingId === annotation.id ? (
						<TextEditor
							annotation={annotation}
							onInput={(text) => patch(annotation.id, { text })}
							onCommit={(text) => {
								if (!text.trim()) {
									setAnnotations(
										annotations.filter((a) => a.id !== annotation.id),
									);
								}
								setTextEditingId(null);
							}}
						/>
					) : (
						<RenderAnnotation annotation={annotation} />
					)}

					{selectedAnnotationId === annotation.id &&
						textEditingId !== annotation.id &&
						annotation.type !== "focus" && (
							<SelectionHandles
								annotation={annotation}
								handleSize={handleSize}
								onResizeStart={startDrag}
							/>
						)}
				</g>
			))}

			{/* The plane of focus. Guides only while selected — the rest of the
			    time the defocus is the only thing that should be on screen. */}
			{annotations.map((annotation) =>
				annotation.type === "focus" &&
				annotation.focus &&
				selectedAnnotationId === annotation.id ? (
					<FocusOverlay
						key={`focus-${annotation.id}`}
						focus={annotation.focus}
						imageRect={imageRect}
						bounds={bounds}
						handleSize={handleSize}
						onChange={(next) => patch(annotation.id, { focus: next })}
						onGestureStart={beginGesture}
						onGestureEnd={endGesture}
					/>
				) : null,
			)}

			{tempAnnotation && tempAnnotation.type !== "mask" && (
				<RenderAnnotation annotation={tempAnnotation} />
			)}
		</svg>
	);
}

function TextEditor({
	annotation,
	onInput,
	onCommit,
}: {
	annotation: Annotation;
	onInput: (text: string) => void;
	onCommit: (text: string) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);

	// contentEditable is uncontrolled by nature: seed it once and select all,
	// so a freshly placed text annotation can be typed over immediately.
	// Mount-only on purpose — re-running on every keystroke would reset the caret.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.textContent = annotation.text ?? "";
		const frame = requestAnimationFrame(() => {
			element.focus();
			const range = document.createRange();
			range.selectNodeContents(element);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	return (
		<foreignObject
			x={annotation.x}
			y={annotation.y}
			width={Math.max(annotation.width, 100)}
			height={Math.max(annotation.height, 50)}
			className="overflow-visible"
		>
			<div
				ref={ref}
				contentEditable
				suppressContentEditableWarning
				className="text-editor m-0 bg-transparent p-0 outline-none"
				style={{
					fontSize: `${annotation.height}px`,
					color: annotation.strokeColor,
					minWidth: "10px",
					whiteSpace: "nowrap",
					lineHeight: 1,
				}}
				onInput={(event) => onInput(event.currentTarget.textContent ?? "")}
				onBlur={(event) => onCommit(event.currentTarget.textContent ?? "")}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
			/>
		</foreignObject>
	);
}

/**
 * Guides for the plane of focus: an ellipse you can drag to re-aim the camera
 * and four handles that widen or narrow the region held in focus.
 *
 * Everything is written back normalized to the screenshot, so the plane keeps
 * pointing at the same content when padding, crop or export scale change it.
 */
function FocusOverlay({
	focus,
	imageRect,
	bounds,
	handleSize,
	onChange,
	onGestureStart,
	onGestureEnd,
}: {
	focus: NonNullable<Annotation["focus"]>;
	imageRect: Rect;
	bounds: Rect;
	handleSize: number;
	onChange: (focus: NonNullable<Annotation["focus"]>) => void;
	onGestureStart: () => void;
	onGestureEnd: () => void;
}) {
	const width = Math.max(1, imageRect.width);
	const height = Math.max(1, imageRect.height);
	const cx = imageRect.x + focus.x * width;
	const cy = imageRect.y + focus.y * height;
	const rx = Math.max(1, focus.radiusX * width);
	const ry = Math.max(1, focus.radiusY * height);

	const begin = (
		event: React.MouseEvent<SVGElement>,
		mode: "move" | "x" | "y",
		// Which way this handle faces. The left and top handles sit on the
		// negative side of the centre, so dragging them outward moves the pointer
		// in the *opposite* direction to the growth they should produce.
		sign = 1,
	) => {
		event.stopPropagation();
		event.preventDefault();
		const svg = event.currentTarget.ownerSVGElement;
		if (!svg) return;

		const rect = svg.getBoundingClientRect();
		const toFrame = (clientX: number, clientY: number) => ({
			x: bounds.x + ((clientX - rect.left) / rect.width) * bounds.width,
			y: bounds.y + ((clientY - rect.top) / rect.height) * bounds.height,
		});

		const start = toFrame(event.clientX, event.clientY);
		const origin = { ...focus };
		onGestureStart();

		const move = (moveEvent: MouseEvent) => {
			const point = toFrame(moveEvent.clientX, moveEvent.clientY);
			const dx = (point.x - start.x) / width;
			const dy = (point.y - start.y) / height;

			if (mode === "move") {
				onChange({
					...origin,
					x: clamp(origin.x + dx, 0, 1),
					y: clamp(origin.y + dy, 0, 1),
				});
				return;
			}

			// A radius handle grows the region from its centre, so re-aiming and
			// resizing stay independent gestures. `sign` is what makes dragging
			// any handle *away* from the centre grow the region, rather than the
			// left and top ones shrinking it.
			onChange({
				...origin,
				radiusX:
					mode === "x"
						? clamp(origin.radiusX + dx * sign, 0.02, 1.5)
						: origin.radiusX,
				radiusY:
					mode === "y"
						? clamp(origin.radiusY + dy * sign, 0.02, 1.5)
						: origin.radiusY,
			});
		};

		const up = () => {
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", up);
			onGestureEnd();
		};

		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", up);
	};

	const handles: Array<{
		id: string;
		x: number;
		y: number;
		mode: "x" | "y";
		sign: number;
	}> = [
		{ id: "e", x: cx + rx, y: cy, mode: "x", sign: 1 },
		{ id: "w", x: cx - rx, y: cy, mode: "x", sign: -1 },
		{ id: "s", x: cx, y: cy + ry, mode: "y", sign: 1 },
		{ id: "n", x: cx, y: cy - ry, mode: "y", sign: -1 },
	];

	return (
		<g style={{ pointerEvents: "all" }}>
			{/* Two strokes: a dark one under a dashed light one, so the guide is
			    legible over whatever the screenshot happens to show. */}
			<ellipse
				cx={cx}
				cy={cy}
				rx={rx}
				ry={ry}
				fill="transparent"
				stroke="rgba(0,0,0,0.55)"
				strokeWidth={handleSize * 0.28}
				style={{ cursor: "move" }}
				onMouseDown={(event) => begin(event, "move")}
			/>
			<ellipse
				cx={cx}
				cy={cy}
				rx={rx}
				ry={ry}
				fill="none"
				stroke="#fff"
				strokeWidth={handleSize * 0.14}
				strokeDasharray={`${handleSize * 0.7} ${handleSize * 0.5}`}
				pointerEvents="none"
			/>

			<circle
				cx={cx}
				cy={cy}
				r={handleSize * 0.22}
				fill="#fff"
				stroke="rgba(0,0,0,0.5)"
				strokeWidth={handleSize * 0.08}
				pointerEvents="none"
			/>

			{handles.map((handle) => (
				<circle
					key={handle.id}
					cx={handle.x}
					cy={handle.y}
					r={handleSize * 0.42}
					fill="#fff"
					stroke="rgba(0,0,0,0.5)"
					strokeWidth={handleSize * 0.08}
					style={{ cursor: handle.mode === "x" ? "ew-resize" : "ns-resize" }}
					onMouseDown={(event) => begin(event, handle.mode, handle.sign)}
				/>
			))}
		</g>
	);
}

function RenderAnnotation({ annotation }: { annotation: Annotation }) {
	const left = Math.min(annotation.x, annotation.x + annotation.width);
	const top = Math.min(annotation.y, annotation.y + annotation.height);
	const width = Math.abs(annotation.width);
	const height = Math.abs(annotation.height);

	switch (annotation.type) {
		case "rectangle":
			return (
				<rect
					x={left}
					y={top}
					width={width}
					height={height}
					stroke={annotation.strokeColor}
					strokeWidth={annotation.strokeWidth}
					fill={annotation.fillColor}
					opacity={annotation.opacity}
				/>
			);

		case "circle":
			return (
				<ellipse
					cx={annotation.x + annotation.width / 2}
					cy={annotation.y + annotation.height / 2}
					rx={width / 2}
					ry={height / 2}
					stroke={annotation.strokeColor}
					strokeWidth={annotation.strokeWidth}
					fill={annotation.fillColor}
					opacity={annotation.opacity}
				/>
			);

		case "arrow": {
			const x2 = annotation.x + annotation.width;
			const y2 = annotation.y + annotation.height;
			const angle = Math.atan2(annotation.height, annotation.width);
			const head = getArrowHeadPoints(x2, y2, angle, annotation.strokeWidth);
			return (
				<>
					{/* The shaft stops at the head's base so the stroke does not
					    show through the arrowhead's point. */}
					<line
						x1={annotation.x}
						y1={annotation.y}
						x2={head.base.x}
						y2={head.base.y}
						stroke={annotation.strokeColor}
						strokeWidth={annotation.strokeWidth}
						strokeLinecap="round"
						opacity={annotation.opacity}
					/>
					<polygon
						points={head.points.map((p) => `${p.x},${p.y}`).join(" ")}
						fill={annotation.strokeColor}
						opacity={annotation.opacity}
					/>
				</>
			);
		}

		case "text":
			return (
				<text
					x={annotation.x}
					// SVG text is positioned on its baseline, not its top edge.
					y={annotation.y + annotation.height}
					fill={annotation.strokeColor}
					fontSize={`${annotation.height}px`}
					fontFamily="sans-serif"
					opacity={annotation.opacity}
					style={{ userSelect: "none", whiteSpace: "pre" }}
				>
					{annotation.text}
				</text>
			);

		case "focus":
			// Nothing at all: the defocus itself is the only thing that should be
			// visible. Its guides live in `FocusOverlay`, and only while selected.
			return null;

		case "mask":
			// Invisible here: the redaction itself is drawn by the renderer. This
			// only exists to give the mask a grabbable hit area.
			return (
				<rect
					x={left}
					y={top}
					width={width}
					height={height}
					fill="none"
					stroke="none"
					style={{ pointerEvents: "all" }}
				/>
			);

		default:
			return null;
	}
}

const BOX_HANDLES = [
	{ id: "nw", x: 0, y: 0 },
	{ id: "n", x: 0.5, y: 0 },
	{ id: "ne", x: 1, y: 0 },
	{ id: "w", x: 0, y: 0.5 },
	{ id: "e", x: 1, y: 0.5 },
	{ id: "sw", x: 0, y: 1 },
	{ id: "s", x: 0.5, y: 1 },
	{ id: "se", x: 1, y: 1 },
];

const CORNER_HANDLES = BOX_HANDLES.filter(
	(handle) => handle.x !== 0.5 && handle.y !== 0.5,
);

function SelectionHandles({
	annotation,
	handleSize,
	onResizeStart,
}: {
	annotation: Annotation;
	handleSize: number;
	onResizeStart: (event: React.MouseEvent, id: string, handle: string) => void;
}) {
	const half = handleSize / 2;

	// An arrow is a line, so it gets endpoint handles rather than a box.
	if (annotation.type === "arrow") {
		const points = [
			{ id: "start", x: annotation.x, y: annotation.y },
			{
				id: "end",
				x: annotation.x + annotation.width,
				y: annotation.y + annotation.height,
			},
		];
		return (
			<>
				{points.map((point) => (
					<circle
						key={point.id}
						cx={point.x}
						cy={point.y}
						r={half}
						fill="#fff"
						stroke="#3B82F6"
						strokeWidth={half * 0.35}
						style={{ cursor: "pointer", pointerEvents: "all" }}
						onMouseDown={(event) =>
							onResizeStart(event, annotation.id, point.id)
						}
					/>
				))}
			</>
		);
	}

	const padding = annotation.type === "text" ? handleSize * 0.3 : 0;
	const rect = {
		x: Math.min(annotation.x, annotation.x + annotation.width) - padding,
		y: Math.min(annotation.y, annotation.y + annotation.height) - padding,
		width: Math.abs(annotation.width) + padding * 2,
		height: Math.abs(annotation.height) + padding * 2,
	};
	// Text resizes by font size, so only the corners make sense.
	const handles = annotation.type === "text" ? CORNER_HANDLES : BOX_HANDLES;

	const cursorFor = (id: string) => {
		if (id === "n" || id === "s") return "ns-resize";
		if (id === "e" || id === "w") return "ew-resize";
		if (id === "nw" || id === "se") return "nwse-resize";
		return "nesw-resize";
	};

	return (
		<>
			<rect
				x={rect.x}
				y={rect.y}
				width={rect.width}
				height={rect.height}
				fill="none"
				stroke="#3B82F6"
				strokeWidth={half * 0.25}
				style={{ pointerEvents: "none" }}
			/>
			{handles.map((handle) => (
				<rect
					key={handle.id}
					x={rect.x + rect.width * handle.x - half}
					y={rect.y + rect.height * handle.y - half}
					width={handleSize}
					height={handleSize}
					fill="#fff"
					stroke="#3B82F6"
					strokeWidth={half * 0.25}
					rx={half * 0.4}
					style={{ cursor: cursorFor(handle.id), pointerEvents: "all" }}
					onMouseDown={(event) =>
						onResizeStart(event, annotation.id, handle.id)
					}
				/>
			))}
		</>
	);
}
