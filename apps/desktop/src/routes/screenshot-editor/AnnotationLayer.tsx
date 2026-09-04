import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Annotation,
	type AnnotationType,
	commands,
	type Fragment,
	type TextContent,
} from "@/utils/tauri";
import { domToTextContent } from "@/utils/text/from-dom";
import { textContentToNodes } from "@/utils/text/to-dom";
import {
	arrowSpec,
	bendFromHandle,
	bendHandle,
	buildArrow,
	type HeadShape,
	polygonPath,
	polylinePath,
} from "./arrow";
import { DEFAULT_FOCUS, DEFAULT_FOCUS_STRENGTH } from "./constants";
import { useScreenshotEditorContext } from "./context";
import { resizeByHandle } from "./geometry";
import {
	annotationAABB,
	collectSnapTargets,
	type SnapTargets,
	snap,
} from "./snapping";
import {
	anchorScale,
	clientToFrame,
	type FramePx,
	frameRect,
	type Pt,
	type Rect as SpaceRect,
} from "./space";
import {
	decorationCss,
	defaultAnnotationTextContent,
	textContentString,
	textContentStyle,
} from "./text-content";
import { cardRotationTransform, rectCentre } from "./transform";

/** Mask strength in the contract's 1080p-relative units — see
 * `mask-effects.json`. */
const MASK_AMOUNT_DEFAULT = 16;

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
	targets: SnapTargets;
};

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

// Black, matching the text default. Arrows and shapes are drawn over
// screenshots that are usually light, and a neutral mark reads as annotation
// rather than as alarm; the inspector changes it per object from here.
const DEFAULT_STROKE = "#000000";

/** Only these carry a rotation transform + rotate handle. Arrows rotate by
 * dragging an endpoint; focus has its own rotation; masks resample pixels. */
const ROTATABLE = new Set<AnnotationType>(["rectangle", "circle", "text"]);

const canRotate = (a: Annotation) => ROTATABLE.has(a.type);

/** `rotate(deg cx cy)` about the box centre, or undefined when upright. */
const rotationTransform = (a: Annotation): string | undefined =>
	a.rotation && canRotate(a)
		? `rotate(${a.rotation} ${a.x + a.width / 2} ${a.y + a.height / 2})`
		: undefined;

/** Circles are round by default and free-form with Shift; rectangles and masks
 * are the other way round. One rule, used both while drawing and while
 * resizing, so the two can't drift apart. */
const aspectLocked = (type: AnnotationType, shiftKey: boolean) =>
	type === "circle"
		? !shiftKey
		: (type === "rectangle" || type === "mask") && shiftKey;

export function AnnotationLayer({
	bounds,
	cssWidth,
	cssHeight,
	imageRect,
	cardRotation,
	isPanning,
	onBackgroundMouseDown,
}: {
	bounds: Rect;
	cssWidth: number;
	cssHeight: number;
	imageRect: Rect;
	/** The capture's in-plane rotation, degrees. Annotations are anchored to
	 * the capture, so they are drawn inside a group carrying the same spin and
	 * pointer input is brought back out of it before anything is measured —
	 * which keeps every geometry, snap and hit test below in the capture's own
	 * unrotated frame, exactly as it was before rotation existed. */
	cardRotation: number;
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
		anchorRect,
		textFragments,
		recordTextMeasurement,
	} = useScreenshotEditorContext();

	// "select" edits existing shapes and "transform" belongs to the capture's
	// gizmo; every other tool draws a new one. Three of the four behaviours
	// below key off that split rather than off the tool name.
	const isDrawingTool = activeTool !== "select";

	const [isDrawing, setIsDrawing] = useState(false);
	const [dragState, setDragState] = useState<DragState | null>(null);
	const [textEditingId, setTextEditingId] = useState<string | null>(null);
	const [tempAnnotation, setTempAnnotation] = useState<Annotation | null>(null);
	// The frame coordinate a snap has locked onto, per axis, for the guide lines.
	const [snapGuides, setSnapGuides] = useState<{
		x: number | null;
		y: number | null;
	}>({ x: null, y: null });

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

	/** Client coords → the SVG's viewBox space, which is frame pixels. The
	 * space is now carried in the type: see `space.ts`. */
	const toSvgPoint = useCallback(
		(event: React.MouseEvent, svg: SVGSVGElement): Pt<FramePx> =>
			clientToFrame(
				event,
				svg,
				frameRect(bounds.x, bounds.y, bounds.width, bounds.height),
				{ degrees: cardRotation, centre: rectCentre(imageRect) },
			),
		[bounds, cardRotation, imageRect],
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
			// Typing never patches state directly (`plans/text-engine/004`) — the
			// only place the DOM gets read back is `TextEditor`'s own `onBlur`.
			// Blurring it here (rather than clearing `textEditingId` directly)
			// runs that same commit, so a click outside the editor doesn't
			// silently discard whatever was just typed. This click ends the
			// edit only; whatever it would otherwise have done waits for the
			// next one, since the commit is asynchronous (`measure_text`) and
			// racing it here would be worse than asking for a second click.
			const active = document.activeElement as HTMLElement | null;
			if (active?.classList.contains("text-editor")) {
				active.blur();
			} else {
				setTextEditingId(null);
			}
			return;
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
			// Empty, not "Text". The editor opens with a caret rather than a
			// selection now, so a placeholder word would be appended to rather
			// than replaced — and an empty box that is discarded on commit is
			// how every text tool behaves when you click and change your mind.
			text: activeTool === "text" ? "" : null,
			textContent:
				activeTool === "text" ? defaultAnnotationTextContent("") : null,
			// Blur is the default a new mask gets: it reads as "covered" without
			// being destructive. Redact is opt-in, from the inspector.
			maskMode: activeTool === "mask" ? "blur" : null,
			maskAmount: activeTool === "mask" ? MASK_AMOUNT_DEFAULT : null,
			...(activeTool === "arrow"
				? {
						arrowCurve: "straight" as const,
						arrowBend: 0,
						arrowStartHead: "none" as const,
						arrowEndHead: "triangle" as const,
						arrowHeadSize: 1,
						lineStyle: "solid" as const,
						arrowTaper: false,
					}
				: {}),
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

			if (aspectLocked(temp.type, event.shiftKey)) {
				const size = Math.max(Math.abs(width), Math.abs(height));
				width = width < 0 ? -size : size;
				height = height < 0 ? -size : size;
			} else if (event.shiftKey && temp.type === "arrow") {
				// Arrows snap to 45° instead.
				const angle = Math.atan2(height, width);
				const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
				const distance = Math.hypot(width, height);
				width = Math.cos(snapped) * distance;
				height = Math.sin(snapped) * distance;
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
			let mdx = dx;
			let mdy = dy;
			if (!event.altKey) {
				// Snap the moved AABB's left/centre/right and top/centre/bottom.
				const b = annotationAABB(original);
				const s = snap(
					[b.x + dx, b.x + b.width / 2 + dx, b.x + b.width + dx],
					[b.y + dy, b.y + b.height / 2 + dy, b.y + b.height + dy],
					dragState.targets,
					snapThreshold,
				);
				mdx += s.dx;
				mdy += s.dy;
				setSnapGuides({ x: s.guideX, y: s.guideY });
			} else {
				setSnapGuides({ x: null, y: null });
			}
			const nextX = original.x + mdx;
			const nextY = original.y + mdy;
			patch(
				dragState.id,
				original.type === "mask"
					? {
							// Snap first, then clamp to the image — clamp wins on conflict.
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
			// The bend handle rides on the curve itself, so it follows the cursor
			// exactly. Dragging it only rewrites `arrowBend`, never the endpoints —
			// re-aiming and bending stay independent gestures.
			if (dragState.handle === "bend") {
				patch(dragState.id, {
					arrowBend: bendFromHandle(arrowSpec(original), point),
				});
				return;
			}
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

			// Snap the dragged endpoint to the target lines.
			if (!event.altKey) {
				const px = dragState.handle === "start" ? newX : newX + newW;
				const py = dragState.handle === "start" ? newY : newY + newH;
				const s = snap([px], [py], dragState.targets, snapThreshold);
				setSnapGuides({ x: s.guideX, y: s.guideY });
				if (dragState.handle === "start") {
					newX += s.dx;
					newY += s.dy;
					newW -= s.dx;
					newH -= s.dy;
				} else {
					newW += s.dx;
					newH += s.dy;
				}
			} else {
				setSnapGuides({ x: null, y: null });
			}
		} else if (dragState.handle === "rotate") {
			const cx = original.x + original.width / 2;
			const cy = original.y + original.height / 2;
			const a0 = Math.atan2(dragState.startY - cy, dragState.startX - cx);
			const a1 = Math.atan2(point.y - cy, point.x - cx);
			let deg = original.rotation + ((a1 - a0) * 180) / Math.PI;
			if (event.shiftKey) deg = Math.round(deg / 15) * 15;
			// Normalise into (-180, 180] so the config slider can always show it.
			deg = ((((deg + 180) % 360) + 360) % 360) - 180;
			patch(dragState.id, { rotation: deg });
			setSnapGuides({ x: null, y: null });
			return;
		} else {
			const r = resizeByHandle(
				original,
				dragState.handle,
				dx,
				dy,
				aspectLocked(original.type, event.shiftKey),
			);
			newX = r.x;
			newY = r.y;
			newW = r.width;
			newH = r.height;

			// Resize-snap only when upright: on a rotated box the AABB edge ↔
			// handle mapping is ambiguous, and it is a marginal interaction.
			// ponytail: upright-only resize snap, revisit if anyone asks.
			if (!event.altKey && !original.rotation) {
				const left = Math.min(newX, newX + newW);
				const right = Math.max(newX, newX + newW);
				const top = Math.min(newY, newY + newH);
				const bottom = Math.max(newY, newY + newH);
				const s = snap(
					[
						...(dragState.handle.includes("w") ? [left] : []),
						...(dragState.handle.includes("e") ? [right] : []),
					],
					[
						...(dragState.handle.includes("n") ? [top] : []),
						...(dragState.handle.includes("s") ? [bottom] : []),
					],
					dragState.targets,
					snapThreshold,
				);
				setSnapGuides({ x: s.guideX, y: s.guideY });
				if (dragState.handle.includes("w")) {
					newX += s.dx;
					newW -= s.dx;
				} else if (dragState.handle.includes("e")) {
					newW += s.dx;
				}
				if (dragState.handle.includes("n")) {
					newY += s.dy;
					newH -= s.dy;
				} else if (dragState.handle.includes("s")) {
					newH += s.dy;
				}
			} else {
				setSnapGuides({ x: null, y: null });
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

	// The size of the text as it is being typed, in frame px. Only the
	// selection bounds read this; the annotation itself is not written until
	// commit.
	const [editingSize, setEditingSize] = useState<{
		width: number;
		height: number;
	} | null>(null);

	const handleMouseUp = () => {
		// A freshly drawn text stays inside the gesture `handleMouseDown`
		// already began — the eventual `TextEditor` commit resumes it, so
		// creation, typing and the final content land as one undo entry
		// (`plans/text-engine/004`).
		let enteringTextEdit = false;

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
			if (annotation.type === "text") {
				setTextEditingId(annotation.id);
				enteringTextEdit = true;
			}
		}

		setDragState(null);
		setSnapGuides({ x: null, y: null });
		if (!enteringTextEdit) endGesture();
	};

	const startDrag = (event: React.MouseEvent, id: string, handle?: string) => {
		// A click inside the live editor belongs to the caret, not to a drag.
		// This runs before the SVG's own `.text-editor` guard can — the
		// annotation's `<g>` is deeper in the tree, so it sees the event first
		// and stops it propagating — and the two lines below are exactly what
		// makes a caret impossible: `preventDefault` suppresses the browser's
		// own focus and selection handling, and `removeAllRanges` throws away
		// whatever it managed to place. Bail before either, and let the
		// browser do what it does with a click on editable text: place the
		// caret, extend a selection on drag, select a word on double-click.
		if ((event.target as HTMLElement).closest?.(".text-editor")) return;

		// Grabbing a *different* annotation while one is being edited. The
		// SVG's own handler would normally end the edit, but it never sees
		// this event: `stopPropagation` below cuts it off. Left alone, the
		// `preventDefault` below also stops the editor blurring, so the old
		// annotation would stay in edit mode while a new one is dragged —
		// two objects live at once, and the typing committed by neither.
		//
		// Blur rather than clearing `textEditingId`, so the commit runs and
		// nothing typed is lost, and stop here: the commit is asynchronous
		// (`measure_text`), and racing a drag against it is worse than asking
		// for a second click. Same policy as `handleMouseDown`.
		if (textEditingId) {
			event.preventDefault();
			event.stopPropagation();
			const active = document.activeElement as HTMLElement | null;
			if (active?.classList.contains("text-editor")) active.blur();
			else setTextEditingId(null);
			return;
		}

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

		// Resizing a text box is a statement about its dimensions, so the grow
		// type has to admit them: a "Hug" text derives its width from the text
		// and would discard a dragged one at the next measure, and a "Wrap"
		// text does the same with height. Promote once, here, rather than on
		// every pointer move.
		if (annotation.type === "text" && handle && handle !== "rotate") {
			const grow = annotation.textContent?.growType ?? "autoWidth";
			const setsWidth = handle.includes("e") || handle.includes("w");
			const setsHeight = handle.includes("n") || handle.includes("s");
			const promoted = setsHeight
				? "fixed"
				: setsWidth && grow === "autoWidth"
					? "autoHeight"
					: grow;
			if (promoted !== grow && annotation.textContent) {
				patch(id, {
					textContent: { ...annotation.textContent, growType: promoted },
				});
			}
		}
		setDragState({
			id,
			action: handle ? "resize" : "move",
			handle,
			startX: point.x,
			startY: point.y,
			original: { ...annotation },
			// Other annotations don't move mid-drag, so gather snap targets once.
			targets: collectSnapTargets(annotations, bounds, id),
		});
	};

	// Handles are drawn in frame space but should stay a constant on-screen
	// size, so their size is converted back through the current scale.
	const handleSize = useMemo(
		() => (cssWidth === 0 ? 0 : (10 / cssWidth) * bounds.width),
		[cssWidth, bounds.width],
	);
	// 6 screen pixels of snap pull, and a 1px guide line — both in frame units.
	const snapThreshold = useMemo(
		() => (cssWidth === 0 ? 0 : (6 / cssWidth) * bounds.width),
		[cssWidth, bounds.width],
	);
	const guideStroke = useMemo(
		() => (cssWidth === 0 ? 0 : (1 / cssWidth) * bounds.width),
		[cssWidth, bounds.width],
	);

	return (
		<svg
			aria-label="Annotations"
			viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
			className={isDrawingTool ? "cursor-crosshair" : undefined}
			style={{
				width: `${cssWidth}px`,
				height: `${cssHeight}px`,
				position: "absolute",
				top: 0,
				left: 0,
				// While selecting, the layer is transparent to the pointer so what is
				// underneath — the capture's gizmo, and the canvas below that — can
				// be reached; individual shapes opt back in. Annotations sitting
				// above the capture in the stack is also what makes them win a
				// click where the two overlap.
				pointerEvents: activeTool === "select" && !dragState ? "none" : "all",
				zIndex: 20,
				// The margin pans, so it keeps the grab cursor. Over the capture the
				// gizmo sets `move` instead — it is under this layer, and this layer
				// is transparent to the pointer there.
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
			<g transform={cardRotationTransform(cardRotation, imageRect)}>
				{annotations.map((annotation) => (
					<g
						key={annotation.id}
						// Upright while its text is being edited (a rotated contentEditable
						// is unusable); re-rotates on blur.
						transform={
							textEditingId === annotation.id
								? undefined
								: rotationTransform(annotation)
						}
						onMouseDown={(event) => startDrag(event, annotation.id)}
						onDoubleClick={(event) => {
							event.stopPropagation();
							if (
								annotation.type === "text" &&
								textEditingId !== annotation.id
							) {
								// Paired with the `endGesture()` in `TextEditor`'s commit
								// below, so entering edit, typing and committing land as
								// one undo entry — the freshly-drawn path pairs the same
								// way in `handleMouseUp`.
								beginGesture();
								setTextEditingId(annotation.id);
							}
						}}
						style={{
							pointerEvents: "all",
							cursor: activeTool === "select" ? "move" : "inherit",
						}}
					>
						{textEditingId === annotation.id ? (
							<TextEditor
								annotation={annotation}
								anchorRect={anchorRect}
								onSizeChange={setEditingSize}
								onCancel={() => {
									// Nothing to revert: typing only ever touched the
									// DOM, so the annotation still holds whatever it
									// had. The one thing Escape must clean up is a box
									// that was created for this edit and never got any
									// committed text — leaving it would strand an
									// invisible, unselectable annotation.
									if (!textContentString(annotation.textContent).trim()) {
										setAnnotations(
											annotations.filter((a) => a.id !== annotation.id),
										);
									}
									setTextEditingId(null);
									endGesture();
								}}
								onCommit={async (content) => {
									const text = textContentString(content);
									let sizePatch: Partial<Annotation> = {};

									if (text.trim() && content.growType !== "fixed") {
										const measured = await commands.measureText(content, {
											anchorHeight: anchorRect?.height ?? 1080,
											width: annotation.width,
											height: annotation.height,
										});
										if (measured.status === "ok") {
											sizePatch =
												content.growType === "autoWidth"
													? {
															width: measured.data.width,
															height: measured.data.height,
														}
													: { height: measured.data.height };
											// Hands the fragments/faces this call already fetched
											// straight to `textFragments`, rather than letting
											// them be thrown away and re-fetched ~200ms later by
											// the context's own debounced effect.
											recordTextMeasurement(
												annotation.id,
												content,
												measured.data,
											);
										}
									}

									if (!text.trim()) {
										setAnnotations(
											annotations.filter((a) => a.id !== annotation.id),
										);
									} else {
										patch(annotation.id, {
											textContent: content,
											...sizePatch,
										});
									}
									setTextEditingId(null);
									endGesture();
								}}
							/>
						) : (
							<RenderAnnotation
								annotation={annotation}
								fragments={textFragments.get(annotation.id) ?? []}
								selected={selectedAnnotationId === annotation.id}
								haloScale={anchorScale(anchorRect)}
							/>
						)}

						{selectedAnnotationId === annotation.id &&
							annotation.type !== "focus" && (
								<SelectionHandles
									// While editing, the bounds follow the text rather
									// than the annotation's last committed size — a box
									// that stayed at its old extents while the text grew
									// past it is the thing that reads as broken.
									annotation={
										textEditingId === annotation.id && editingSize
											? {
													...annotation,
													width: editingSize.width,
													height: editingSize.height,
												}
											: annotation
									}
									handleSize={handleSize}
									onResizeStart={startDrag}
									// Handles are the "this object is ready to be moved
									// and resized" state. While the caret is in the text
									// they would say the wrong thing — and a grab on one
									// blurs the editor mid-keystroke — so editing shows
									// the outline alone. Enter, or clicking away, ends
									// the typing phase and brings them back.
									interactive={textEditingId !== annotation.id}
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

				{/* Alignment guides — a full-span line at each locked-on coordinate. */}
				{dragState && snapGuides.x != null && (
					<line
						x1={snapGuides.x}
						y1={bounds.y}
						x2={snapGuides.x}
						y2={bounds.y + bounds.height}
						stroke="#F03808"
						strokeWidth={guideStroke}
						style={{ pointerEvents: "none" }}
					/>
				)}
				{dragState && snapGuides.y != null && (
					<line
						x1={bounds.x}
						y1={snapGuides.y}
						x2={bounds.x + bounds.width}
						y2={snapGuides.y}
						stroke="#F03808"
						strokeWidth={guideStroke}
						style={{ pointerEvents: "none" }}
					/>
				)}
			</g>
		</svg>
	);
}

/**
 * `to_dom(content) → contentEditable → from_dom(root)`, per
 * `plans/text-engine/004`: the DOM is an input device here, not a measuring
 * device. Typing mutates the DOM directly — no `onInput` callback, no state
 * patch, no IPC, no reflow — and the tree is only read back once, at commit.
 * cosmic-text (`measure_text`, called by the caller's `onCommit`) is what
 * actually lays the text out; this only has to look approximately right.
 */
function TextEditor({
	annotation,
	anchorRect,
	onSizeChange,
	onCommit,
	onCancel,
}: {
	annotation: Annotation;
	anchorRect: SpaceRect<FramePx> | null;
	/** Live content size in frame px, reported as the text reflows. The
	 * selection bounds are drawn from this rather than from the annotation,
	 * which only learns its final size at commit. */
	onSizeChange: (size: { width: number; height: number } | null) => void;
	onCommit: (content: TextContent) => void;
	/** Escape: leave edit mode without reading the DOM back. Typing never
	 * patches state (`plans/text-engine/004`), so discarding the edit is
	 * simply declining to commit — the annotation still holds what it had. */
	onCancel: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const scale = anchorScale(anchorRect);
	const growType = annotation.textContent?.growType ?? "autoWidth";
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);

	// contentEditable is uncontrolled by nature: seed it once. Mount-only on
	// purpose — re-running on every keystroke would reset the caret, and
	// typing never touches React state to trigger a re-render anyway.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const content = annotation.textContent ?? defaultAnnotationTextContent("");
		element.replaceChildren(...textContentToNodes(content, scale));

		const frame = requestAnimationFrame(() => {
			element.focus();
			const selection = window.getSelection();
			if (!selection) return;

			const range = document.createRange();
			if (element.textContent === "") {
				// A newly created object seeds as `<p><br></p>`. Collapsing to the
				// *end* would put the caret after that `<br>`, so the first
				// keystroke would start on a second line — aim at the start of
				// the first block instead.
				range.setStart(element.firstElementChild ?? element, 0);
				range.collapse(true);
			} else {
				// Existing text is entered by double-clicking it, and a
				// double-click means "take all of this": the whole run is
				// highlighted so it can be replaced in one keystroke. Clicking
				// once inside afterwards moves the caret, which is the way to
				// amend rather than replace.
				range.selectNodeContents(element);
			}
			selection.removeAllRanges();
			selection.addRange(range);
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	// The box follows the text as it is typed. A ResizeObserver rather than an
	// `onInput` handler because wrapping also changes on paste, on IME commit
	// and on a style change from the panel — all of which resize the element
	// without necessarily being a keystroke.
	//
	// Deliberately local state, not a config patch: writing the annotation on
	// every reflow would push a render and an IPC round-trip per character,
	// which is exactly what `plans/text-engine/004` keeps the DOM out of. The
	// authoritative size still comes from `measure_text` at commit.
	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		const observer = new ResizeObserver(() => {
			const next = {
				width: element.offsetWidth,
				height: element.offsetHeight,
			};
			setSize(next);
			onSizeChange(next);
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
			onSizeChange(null);
		};
	}, [onSizeChange]);

	// Set by Escape, read by the `onBlur` it triggers — blur is the single
	// exit, so cancelling has to travel to it rather than around it.
	const cancelled = useRef(false);

	const commit = () => {
		const element = ref.current;
		if (!element) return;
		if (cancelled.current) {
			cancelled.current = false;
			onCancel();
			return;
		}
		const previous = annotation.textContent ?? defaultAnnotationTextContent("");
		onCommit(domToTextContent(element, previous, scale));
	};

	// What the editable box is allowed to do, per grow type. "Hug" tracks the
	// text on both axes; "Wrap" pins the width and lets height follow; "Fixed"
	// pins both and clips, so the box the panel defines is the box you get.
	// The run style goes on the container, not just on the spans inside it.
	// A newly created object has no span yet — it is a `<p><br></p>` — so the
	// first characters typed are inserted as bare text, and without this they
	// inherit the webview's default 16px black instead of the style the
	// object actually carries. `domToTextContent` reads them back against the
	// same style (its `fallbackStyle`), so what is typed is what is stored.
	const runStyle = textContentStyle(annotation.textContent);
	const inheritedStyle: React.CSSProperties = {
		fontFamily: runStyle.fontFamily || "sans-serif",
		fontSize: runStyle.fontSize * scale,
		fontWeight: runStyle.fontWeight,
		fontStyle: runStyle.italic ? "italic" : "normal",
		color: runStyle.color,
		lineHeight: 1.2,
	};

	const editorStyle: React.CSSProperties =
		growType === "autoWidth"
			? { width: "max-content", whiteSpace: "pre", minWidth: "1ch" }
			: growType === "autoHeight"
				? {
						width: Math.max(annotation.width, 16),
						whiteSpace: "pre-wrap",
						overflowWrap: "break-word",
					}
				: {
						width: Math.max(annotation.width, 16),
						height: Math.max(annotation.height, 16),
						whiteSpace: "pre-wrap",
						overflowWrap: "break-word",
						overflow: "hidden",
					};

	// `foreignObject` clips its children, so it has to be at least as large as
	// the text currently is — not the size the annotation was last committed
	// at, which is stale the moment a character is typed.
	const hostWidth = Math.max(size?.width ?? 0, annotation.width, 16) + 8;
	const hostHeight = Math.max(size?.height ?? 0, annotation.height, 16) + 8;

	return (
		<foreignObject
			x={annotation.x}
			y={annotation.y}
			width={hostWidth}
			height={hostHeight}
			className="overflow-visible"
		>
			<div
				ref={ref}
				contentEditable
				suppressContentEditableWarning
				className="text-editor m-0 bg-transparent p-0 outline-none"
				style={{ ...inheritedStyle, ...editorStyle }}
				onBlur={commit}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === "Escape") {
						event.preventDefault();
						cancelled.current = true;
						event.currentTarget.blur();
						return;
					}
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
				onPaste={(event) => {
					// Plain text only — `contentEditable` accepts arbitrary HTML,
					// and an unfiltered paste is how the tree acquires nodes
					// `from_dom` has never seen. `execCommand` is deprecated but
					// still the shortest correct way to insert at the caret with
					// the browser's own undo/IME state intact; this app already
					// only targets Chromium (WebView2 / Tauri), where it works.
					event.preventDefault();
					const text = event.clipboardData.getData("text/plain");
					document.execCommand("insertText", false, text);
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

	// The guide has to describe the shape the shader actually uses, so it is
	// drawn from the same config rather than always being an ellipse. The
	// rectangle is rounded because the falloff's corners are too — it is a
	// superellipse, not a hard-cornered box.
	const outline = (props: React.SVGProps<SVGElement>) =>
		focus.shape === "rectangle" ? (
			<rect
				x={cx - rx}
				y={cy - ry}
				width={rx * 2}
				height={ry * 2}
				rx={Math.min(rx, ry) * 0.22}
				{...(props as React.SVGProps<SVGRectElement>)}
			/>
		) : (
			<ellipse
				cx={cx}
				cy={cy}
				rx={rx}
				ry={ry}
				{...(props as React.SVGProps<SVGEllipseElement>)}
			/>
		);

	return (
		<g style={{ pointerEvents: "all" }}>
			{/* Two strokes: a dark one under a dashed light one, so the guide is
			    legible over whatever the screenshot happens to show. */}
			{outline({
				fill: "transparent",
				stroke: "rgba(0,0,0,0.55)",
				strokeWidth: handleSize * 0.28,
				style: { cursor: "move" },
				onMouseDown: (event) =>
					begin(event as React.MouseEvent<SVGElement>, "move"),
			})}
			{outline({
				fill: "none",
				stroke: "#fff",
				strokeWidth: handleSize * 0.14,
				strokeDasharray: `${handleSize * 0.7} ${handleSize * 0.5}`,
				pointerEvents: "none",
			})}

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

/** One resolved arrow head. Filled heads paint in `color`; the open chevron
 * ("arrow") is stroked so it reads as an outline, matching the essay. */
function HeadSvg({
	shape,
	color,
	strokeWidth,
	opacity,
}: {
	shape: HeadShape;
	color: string;
	strokeWidth: number;
	opacity: number;
}) {
	if (shape.kind === "none") return null;
	if (shape.kind === "circle") {
		return (
			<circle
				cx={shape.c.x}
				cy={shape.c.y}
				r={shape.r}
				fill={color}
				opacity={opacity}
			/>
		);
	}
	const points = shape.points.map((p) => `${p.x},${p.y}`).join(" ");
	if (shape.kind === "arrow") {
		return (
			<polyline
				points={points}
				fill="none"
				stroke={color}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
				opacity={opacity}
			/>
		);
	}
	return <polygon points={points} fill={color} opacity={opacity} />;
}

function RenderAnnotation({
	annotation,
	fragments = [],
	selected = false,
	haloScale = 1,
}: {
	annotation: Annotation;
	/** Empty until `measure_text` returns — `context.tsx`'s job, keyed by
	 * annotation id. */
	fragments?: Fragment[];
	/** A text annotation that is already selected hit-tests on its box, not
	 * its glyphs — otherwise a click landing between two letters (or in a
	 * word gap) falls through to whatever is underneath, and the first click
	 * of a double-click meant to enter edit mode reselects the capture
	 * instead. `plans/text-engine/003`'s own exemption, ported from Penpot. */
	selected?: boolean;
	/** `TextHalo.width` is px@1080 like every other text metric, but it never
	 * passes through `measure_text` (`Fragment` carries no halo field — this
	 * is a `plans/text-engine/004` addition Rust doesn't know about), so
	 * unlike `fragment.fontSize` it has to be scaled here, not server-side. */
	haloScale?: number;
}) {
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
			const spec = arrowSpec(annotation);
			const built = buildArrow(spec);
			const color = annotation.strokeColor;
			const sw = annotation.strokeWidth;
			return (
				<>
					{/* Fat invisible stroke so a thin arrow is still easy to grab —
					    the visible line keeps its real width. */}
					<path
						d={polylinePath(built.samples)}
						fill="none"
						stroke="transparent"
						strokeWidth={Math.max(sw + 16, 24)}
						strokeLinecap="round"
						style={{ pointerEvents: "stroke" }}
					/>
					{built.outline ? (
						<path
							d={polygonPath(built.outline)}
							fill={color}
							opacity={annotation.opacity}
						/>
					) : (
						<path
							d={polylinePath(built.shaft)}
							fill="none"
							stroke={color}
							strokeWidth={sw}
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeDasharray={built.dash?.join(" ")}
							opacity={annotation.opacity}
						/>
					)}
					<HeadSvg
						shape={built.startHead}
						color={color}
						strokeWidth={sw}
						opacity={annotation.opacity}
					/>
					<HeadSvg
						shape={built.endHead}
						color={color}
						strokeWidth={sw}
						opacity={annotation.opacity}
					/>
				</>
			);
		}

		case "text": {
			const halo = annotation.textContent?.halo;
			return (
				<>
					{selected && (
						<rect
							x={left}
							y={top}
							width={width}
							height={height}
							fill="transparent"
							style={{ pointerEvents: "all" }}
						/>
					)}
					{fragments.map((fragment, index) => (
						<text
							// biome-ignore lint/suspicious/noArrayIndexKey: fragments are recomputed wholesale on every measurement, never reordered in place — there is no stabler identity to key on.
							key={index}
							x={
								fragment.rtl
									? annotation.x + fragment.x + fragment.width
									: annotation.x + fragment.x
							}
							// Baseline, not top — matches `Fragment::y`'s own convention.
							y={annotation.y + fragment.y}
							textLength={fragment.width}
							lengthAdjust="spacingAndGlyphs"
							dominantBaseline="alphabetic"
							// `x` above is the fragment's *right* edge for RTL — this is
							// what actually anchors the glyphs growing leftward from it,
							// matching Canvas2D's `textAlign: "right"` for the same case
							// in `screenshotExport.ts`.
							textAnchor={fragment.rtl ? "end" : "start"}
							opacity={annotation.opacity}
							style={{
								fontFamily: `quiro-face-${fragment.fontFace}`,
								fontSize: `${fragment.fontSize}px`,
								fontWeight: fragment.fontWeight,
								fontStyle: fragment.italic ? "italic" : "normal",
								textDecoration: decorationCss(fragment.decoration),
								fill: fragment.color,
								userSelect: "none",
								whiteSpace: "pre",
								// Legibility over arbitrary screenshot content
								// (`plans/text-engine/004`). `paintOrder: "stroke fill"`
								// draws the outline first so the fill sits cleanly on
								// top, rather than the stroke half-covering the glyph.
								...(halo
									? {
											paintOrder: "stroke fill",
											stroke: halo.color,
											strokeWidth: halo.width * haloScale,
										}
									: {}),
							}}
						>
							{fragment.text}
						</text>
					))}
				</>
			);
		}

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

function SelectionHandles({
	annotation,
	handleSize,
	onResizeStart,
	interactive = true,
}: {
	annotation: Annotation;
	handleSize: number;
	onResizeStart: (event: React.MouseEvent, id: string, handle: string) => void;
	/** `false` draws the bounds without grabbable handles — what a text
	 * annotation being typed into wants, since the box should stay visible
	 * but a resize drag would fight the caret and the text selection. */
	interactive?: boolean;
}) {
	const half = handleSize / 2;

	// An arrow is a line, so it gets endpoint handles rather than a box.
	if (annotation.type === "arrow") {
		const spec = arrowSpec(annotation);
		const points = [
			{ id: "start", x: annotation.x, y: annotation.y },
			{
				id: "end",
				x: annotation.x + annotation.width,
				y: annotation.y + annotation.height,
			},
		];
		// A curved arrow also gets a bend handle, sitting on the curve itself.
		const bend = bendHandle(spec);
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
				{bend && (
					<circle
						cx={bend.x}
						cy={bend.y}
						r={half}
						fill="#3B82F6"
						stroke="#fff"
						strokeWidth={half * 0.35}
						style={{ cursor: "pointer", pointerEvents: "all" }}
						onMouseDown={(event) => onResizeStart(event, annotation.id, "bend")}
					/>
				)}
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
	// Every annotation gets the full set. Text used to get corners only, from
	// when a resize scaled its font size; it now sets the box, and the edge
	// handles are the only way to choose a wrap width by dragging.
	const handles = BOX_HANDLES;

	const cursorFor = (id: string) => {
		if (id === "n" || id === "s") return "ns-resize";
		if (id === "e" || id === "w") return "ew-resize";
		if (id === "nw" || id === "se") return "nwse-resize";
		return "nesw-resize";
	};

	// Drawn in local space — the parent <g> is already rotated, so the handle
	// and its stem orbit the shape for free.
	const rotateX = rect.x + rect.width / 2;
	const rotateY = rect.y - handleSize * 2;

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
			{interactive && canRotate(annotation) && (
				<>
					<line
						x1={rotateX}
						y1={rect.y}
						x2={rotateX}
						y2={rotateY}
						stroke="#3B82F6"
						strokeWidth={half * 0.25}
						style={{ pointerEvents: "none" }}
					/>
					<circle
						cx={rotateX}
						cy={rotateY}
						r={half}
						fill="#fff"
						stroke="#3B82F6"
						strokeWidth={half * 0.35}
						style={{ cursor: "grab", pointerEvents: "all" }}
						onMouseDown={(event) =>
							onResizeStart(event, annotation.id, "rotate")
						}
					/>
				</>
			)}
			{interactive &&
				handles.map((handle) => (
					<rect
						key={handle.id}
						x={rect.x + rect.width * handle.x - half}
						y={rect.y + rect.height * handle.y - half}
						width={handleSize}
						height={handleSize}
						fill="#fff"
						stroke={"#F03808"}
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
