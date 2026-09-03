import type {
	Annotation,
	MaskShape,
	ProjectConfiguration,
} from "@/utils/tauri";
import {
	arrowBounds,
	arrowSpec,
	buildArrow,
	type Pt,
	paintHead,
} from "./arrow";
import { type DofQuality, sharedDofRenderer } from "./dof";
import { shapePoints } from "./geometry";
import { resolveTransform } from "./transform";

// React port of Cap's `screenshotExport.ts`. The Rust renderer draws the frame
// (background, padding, rounding, shadow, crop) but knows nothing about
// annotations — neither Cap's renderer nor Quiro's has an annotation concept —
// so arrows, shapes, text and redactions are composited here, on top of the
// rendered bitmap, at export resolution.
//
// Cap's file also contains the share-link half (upload, fingerprint, plan
// checks). That is dropped: those call cloud commands Quiro has no backend for.

export type ScreenshotExportStatus = "idle" | "rendering" | "encoding";

export type Rect = { x: number; y: number; width: number; height: number };

/** A fully transparent colour, or an image slot with nothing picked, means the
 * frame has no background of its own — so the export keeps its alpha instead of
 * being flattened onto white. */
const hasNoVisibleBackground = (
	source: ProjectConfiguration["background"]["source"],
) => {
	if (source.type === "color") return (source.alpha ?? 255) === 0;
	if (source.type === "wallpaper" || source.type === "image")
		return !source.path;
	return false;
};

/** Downscale then upscale a region, which is a cheap box blur. `level` is the
 * strength slider, not a pixel radius. */
export const blurRegion = (
	ctx: CanvasRenderingContext2D,
	source: CanvasImageSource,
	startX: number,
	startY: number,
	regionWidth: number,
	regionHeight: number,
	level: number,
) => {
	const scale = Math.max(2, Math.round(level / 4));
	const temp = document.createElement("canvas");
	temp.width = Math.max(1, Math.floor(regionWidth / scale));
	temp.height = Math.max(1, Math.floor(regionHeight / scale));
	const tempCtx = temp.getContext("2d");
	if (!tempCtx) return;

	tempCtx.imageSmoothingEnabled = true;
	tempCtx.drawImage(
		source,
		startX,
		startY,
		regionWidth,
		regionHeight,
		0,
		0,
		temp.width,
		temp.height,
	);
	ctx.drawImage(
		temp,
		0,
		0,
		temp.width,
		temp.height,
		startX,
		startY,
		regionWidth,
		regionHeight,
	);
};

/** Draws every mask annotation by re-reading `source` and painting the blurred
 * or pixelated region back into `ctx`.
 *
 * Cap has this loop twice — once in Preview for the live overlay, once in
 * screenshotExport for the file — which is two chances for the redaction on
 * screen to disagree with the redaction that ships. Quiro keeps one copy and
 * both callers use it.
 */
/** Mask amounts are expressed relative to this height, matching
 * `MASK_EFFECT_BASE_HEIGHT` in the renderer. */
const MASK_AMOUNT_BASE_HEIGHT = 1080;

/** Fraction of the region's shorter axis used as the corner radius, matching
 * the renderer's `corner_radius` for `roundedRect`. */
const MASK_CORNER_RADIUS_FRACTION = 0.25;

/**
 * Trace a mask region's outline. Mirrors `region_sdf_px` in `mask.wgsl` — the
 * two must agree, or the same mask would have a different outline in the
 * screenshot editor than in a video export.
 */
const maskRegionPath = (
	ctx: CanvasRenderingContext2D,
	shape: MaskShape,
	x: number,
	y: number,
	width: number,
	height: number,
) => {
	ctx.beginPath();
	if (shape === "ellipse") {
		ctx.ellipse(
			x + width / 2,
			y + height / 2,
			width / 2,
			height / 2,
			0,
			0,
			Math.PI * 2,
		);
		return;
	}
	if (shape === "roundedRect") {
		const radius = Math.min(width, height) * MASK_CORNER_RADIUS_FRACTION;
		roundRectPath(ctx, x, y, width, height, radius);
		return;
	}
	ctx.rect(x, y, width, height);
};

/** Scratch pair for [`withCardRotation`], kept across calls: a rotated capture
 * re-runs this on every frame of a drag, and allocating two full-frame canvases
 * per frame is the kind of churn that shows up as a stutter rather than as a
 * slow function. */
let rotationScratch: {
	source: HTMLCanvasElement;
	target: HTMLCanvasElement;
} | null = null;

const scratchPair = (width: number, height: number) => {
	if (!rotationScratch) {
		rotationScratch = {
			source: document.createElement("canvas"),
			target: document.createElement("canvas"),
		};
	}
	for (const canvas of [rotationScratch.source, rotationScratch.target]) {
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
	}
	return rotationScratch;
};

/**
 * Runs a canvas pass in the capture's own unrotated frame.
 *
 * `paintMasks` and `applyFocus` both assume an axis-aligned capture, and both
 * *read* the rendered frame at the same coordinates they write to. Neither
 * survives the capture being spun in place: rotating the destination alone
 * would leave them sampling the wrong pixels. So the frame is counter-rotated
 * into a scratch copy where the capture is upright again, the pass runs against
 * that unchanged, and its output is rotated back onto the real destination.
 *
 * A flat capture — every project until someone drags the rotation handle —
 * takes the direct path and pays nothing at all.
 */
export const withCardRotation = (
	ctx: CanvasRenderingContext2D,
	source: HTMLCanvasElement,
	rotationDegrees: number,
	centre: { x: number; y: number },
	draw: (target: CanvasRenderingContext2D, frame: HTMLCanvasElement) => void,
) => {
	if (rotationDegrees === 0) {
		draw(ctx, source);
		return;
	}

	const { width, height } = ctx.canvas;
	if (width <= 0 || height <= 0) return;

	const scratch = scratchPair(width, height);
	const sourceCtx = scratch.source.getContext("2d");
	const targetCtx = scratch.target.getContext("2d");
	if (!sourceCtx || !targetCtx) {
		draw(ctx, source);
		return;
	}

	const radians = (rotationDegrees * Math.PI) / 180;

	sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
	sourceCtx.clearRect(0, 0, width, height);
	sourceCtx.translate(centre.x, centre.y);
	sourceCtx.rotate(-radians);
	sourceCtx.translate(-centre.x, -centre.y);
	sourceCtx.drawImage(source, 0, 0);
	sourceCtx.setTransform(1, 0, 0, 1, 0, 0);

	targetCtx.setTransform(1, 0, 0, 1, 0, 0);
	targetCtx.clearRect(0, 0, width, height);
	draw(targetCtx, scratch.source);

	ctx.save();
	ctx.translate(centre.x, centre.y);
	ctx.rotate(radians);
	ctx.translate(-centre.x, -centre.y);
	ctx.drawImage(scratch.target, 0, 0);
	ctx.restore();
};

export const paintMasks = (
	ctx: CanvasRenderingContext2D,
	source: CanvasImageSource,
	annotations: Annotation[],
	imageRect: Rect,
) => {
	const rectRight = imageRect.x + imageRect.width;
	const rectBottom = imageRect.y + imageRect.height;

	for (const ann of annotations) {
		if (ann.type !== "mask") continue;

		// A mask dragged past the edge of the screenshot must not blur the
		// background around it, so the region is clamped to the image.
		const startX = Math.max(imageRect.x, Math.min(ann.x, ann.x + ann.width));
		const startY = Math.max(imageRect.y, Math.min(ann.y, ann.y + ann.height));
		const endX = Math.min(rectRight, Math.max(ann.x, ann.x + ann.width));
		const endY = Math.min(rectBottom, Math.max(ann.y, ann.y + ann.height));

		const regionWidth = endX - startX;
		const regionHeight = endY - startY;
		if (regionWidth <= 0 || regionHeight <= 0) continue;

		// The stored amount is 1080p-relative, matching `MaskSegment::amount`
		// and the renderer's `scaled_effect_size`. Resolve it against the frame
		// actually being painted so a 1x and a 2x export obscure identically.
		const resolutionScale = ctx.canvas.height / MASK_AMOUNT_BASE_HEIGHT;
		const level = Math.max(1, (ann.maskAmount ?? 16) * resolutionScale);
		const mode = ann.maskMode ?? "blur";
		const shape: MaskShape = ann.maskShape ?? "rect";

		if (mode === "spotlight") {
			// Spotlight darkens everything *outside* the region rather than
			// obscuring what is inside it, so the fill covers the screenshot
			// with the region punched out. even-odd on two nested rects is
			// exactly that hole, with no second canvas.
			const darkness = Math.max(0, Math.min(1, ann.maskDarkness ?? 0.5));
			if (darkness <= 0) continue;
			ctx.save();
			ctx.filter = "none";
			ctx.globalAlpha = 1;
			ctx.fillStyle = `rgba(0, 0, 0, ${darkness})`;
			ctx.beginPath();
			ctx.rect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
			// `maskRegionPath` starts its own subpath, which even-odd then
			// treats as the hole.
			maskRegionPath(ctx, shape, startX, startY, regionWidth, regionHeight);
			ctx.fill("evenodd");
			ctx.restore();
			continue;
		}

		if (mode === "redact") {
			// Opaque fill, hard-edged. No source pixel may survive inside the
			// region — that is the whole point of this mode, and a blend or a
			// soft edge would leak the original.
			ctx.save();
			ctx.filter = "none";
			ctx.globalAlpha = 1;
			ctx.fillStyle = "#000";
			maskRegionPath(ctx, shape, startX, startY, regionWidth, regionHeight);
			ctx.fill();
			ctx.restore();
			continue;
		}

		if (mode === "pixelate") {
			const blockSize = Math.max(2, Math.round(level));
			const temp = document.createElement("canvas");
			temp.width = Math.max(1, Math.floor(regionWidth / blockSize));
			temp.height = Math.max(1, Math.floor(regionHeight / blockSize));
			const tempCtx = temp.getContext("2d");
			if (!tempCtx) continue;
			// Nearest-neighbour both ways: smoothing the blocks back up would make
			// the redaction partially reversible.
			tempCtx.imageSmoothingEnabled = false;
			tempCtx.drawImage(
				source,
				startX,
				startY,
				regionWidth,
				regionHeight,
				0,
				0,
				temp.width,
				temp.height,
			);
			const previousSmoothing = ctx.imageSmoothingEnabled;
			ctx.imageSmoothingEnabled = false;
			ctx.save();
			maskRegionPath(ctx, shape, startX, startY, regionWidth, regionHeight);
			ctx.clip();
			ctx.drawImage(
				temp,
				0,
				0,
				temp.width,
				temp.height,
				startX,
				startY,
				regionWidth,
				regionHeight,
			);
			ctx.restore();
			ctx.imageSmoothingEnabled = previousSmoothing;
			continue;
		}

		ctx.save();
		maskRegionPath(ctx, shape, startX, startY, regionWidth, regionHeight);
		ctx.clip();
		blurRegion(ctx, source, startX, startY, regionWidth, regionHeight, level);
		ctx.restore();
	}

	ctx.filter = "none";
};

// --- cinematic depth of field --------------------------------------------
//
// The focus annotation is a camera focusing on the screenshot, not a blur mask.
// The GPU pass in `dof.ts` owns the optics; this is the seam that hands it the
// screenshot region and paints the defocused result back over the frame.
//
// It runs on the screenshot region alone, so the composition's background stays
// exactly as the style panel rendered it.

export const findFocusAnnotation = (annotations: Annotation[]) =>
	annotations.find((a) => a.type === "focus" && a.focus) ?? null;

/** `roundRect` is missing from older WebKit, and this runs inside WKWebView. */
const roundRectPath = (
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
) => {
	const r = Math.max(0, Math.min(radius, width / 2, height / 2));
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + width, y, x + width, y + height, r);
	ctx.arcTo(x + width, y + height, x, y + height, r);
	ctx.arcTo(x, y + height, x, y, r);
	ctx.arcTo(x, y, x + width, y, r);
	ctx.closePath();
};

/**
 * The corner radius the Rust renderer gave the screenshot, mirrored from
 * `ProjectUniforms`' `display_rounding_px`.
 *
 * The defocused screenshot comes back as a rectangle, so without this it would
 * be stamped square over a card the renderer drew rounded, and the corners
 * would show blurred background as four hard right angles.
 *
 * A squircle fills more of its corner than a circular arc of the same radius,
 * so that case is over-rounded slightly: erring this way leaves at most a
 * hairline of the original sharp corner, which reads as nothing, where erring
 * the other way leaves visible blur outside the card.
 */
const screenshotCornerRadius = (
	project: ProjectConfiguration,
	imageRect: Rect,
) => {
	const base =
		(project.background.rounding / 100) *
		0.5 *
		Math.min(imageRect.width, imageRect.height);
	return project.background.roundingType === "squircle" ? base * 1.2 : base;
};

/**
 * Replaces the screenshot region of `ctx` with its defocused self.
 *
 * `source` must be an untouched copy of the frame — the same one the masks
 * read — so the pass never re-blurs its own output.
 */
export const applyFocus = (
	ctx: CanvasRenderingContext2D,
	source: { canvas: HTMLCanvasElement; revision: unknown },
	annotations: Annotation[],
	imageRect: Rect,
	project: ProjectConfiguration,
	quality: DofQuality,
) => {
	const annotation = findFocusAnnotation(annotations);
	if (!annotation?.focus) return;
	if (imageRect.width <= 0 || imageRect.height <= 0) return;

	const rendered = sharedDofRenderer().render(
		source,
		imageRect,
		annotation.focus,
		quality,
	);
	if (!rendered) return;

	const strength = Math.max(0, Math.min(1, annotation.opacity));
	if (strength <= 0) return;

	ctx.save();
	// Clipped to the card's own silhouette, so the defocus stops exactly where
	// the screenshot does and never spills square corners over the background.
	roundRectPath(
		ctx,
		imageRect.x,
		imageRect.y,
		imageRect.width,
		imageRect.height,
		screenshotCornerRadius(project, imageRect),
	);
	ctx.clip();
	ctx.globalAlpha = strength;
	// Drawn at the region's own size: the GPU already rendered at this exact
	// resolution, so there is no upscale of a cheap preview here.
	ctx.drawImage(
		rendered,
		imageRect.x,
		imageRect.y,
		imageRect.width,
		imageRect.height,
	);
	ctx.restore();
};

const tracePolyline = (ctx: CanvasRenderingContext2D, pts: Pt[]) => {
	if (!pts.length) return;
	ctx.moveTo(pts[0].x, pts[0].y);
	for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
};

const ROTATABLE_TYPES = new Set(["rectangle", "circle", "text"]);

/** Vector annotations, painted in list order so the layers panel ordering
 * holds. Masks are skipped — `paintMasks` has already burned those in. */
const drawAnnotations = (
	ctx: CanvasRenderingContext2D,
	annotations: Annotation[],
) => {
	for (const ann of annotations) {
		// Masks and focus are image treatments, already burned in above.
		if (ann.type === "mask" || ann.type === "focus") continue;
		ctx.save();
		ctx.globalAlpha = ann.opacity;
		ctx.strokeStyle = ann.strokeColor;
		ctx.lineWidth = ann.strokeWidth;
		ctx.fillStyle = ann.fillColor;

		if (ann.rotation && ROTATABLE_TYPES.has(ann.type)) {
			const cx = ann.x + ann.width / 2;
			const cy = ann.y + ann.height / 2;
			ctx.translate(cx, cy);
			ctx.rotate((ann.rotation * Math.PI) / 180);
			ctx.translate(-cx, -cy);
		}

		if (ann.type === "rectangle") {
			if (ann.fillColor !== "transparent") {
				ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
			}
			ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
		} else if (ann.type === "circle") {
			ctx.beginPath();
			ctx.ellipse(
				ann.x + ann.width / 2,
				ann.y + ann.height / 2,
				Math.abs(ann.width / 2),
				Math.abs(ann.height / 2),
				0,
				0,
				2 * Math.PI,
			);
			if (ann.fillColor !== "transparent") ctx.fill();
			ctx.stroke();
		} else if (ann.type === "arrow") {
			// Same geometry engine as the SVG editor, so the export matches the
			// canvas pixel for pixel — curve, dashes, heads and taper included.
			const built = buildArrow(arrowSpec(ann));
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.strokeStyle = ann.strokeColor;
			ctx.fillStyle = ann.strokeColor;

			if (built.outline) {
				ctx.beginPath();
				tracePolyline(ctx, built.outline);
				ctx.closePath();
				ctx.fill();
			} else {
				ctx.beginPath();
				ctx.setLineDash(built.dash ?? []);
				tracePolyline(ctx, built.shaft);
				ctx.stroke();
				ctx.setLineDash([]);
			}
			paintHead(ctx, built.startHead, ann.strokeColor);
			paintHead(ctx, built.endHead, ann.strokeColor);
		} else if (ann.type === "text" && ann.text) {
			ctx.fillStyle = ann.strokeColor;
			ctx.font = `${ann.height}px sans-serif`;
			ctx.fillText(ann.text, ann.x, ann.y + ann.height);
		}

		ctx.restore();
	}
};

/** Annotations are stored in preview-frame coordinates. When export renders at
 * a higher resolution they have to be scaled to match — including stroke width
 * and mask strength, which are lengths, not positions. */
const scaleAnnotations = (
	annotations: Annotation[],
	scaleX: number,
	scaleY: number,
): Annotation[] => {
	const scalar = (scaleX + scaleY) / 2;
	return annotations.map((ann) => ({
		...ann,
		x: ann.x * scaleX,
		y: ann.y * scaleY,
		width: ann.width * scaleX,
		height: ann.height * scaleY,
		strokeWidth: ann.strokeWidth * scalar,
		// `maskAmount` is deliberately untouched, as is `focus`: both are
		// resolution-independent — the amount is 1080p-relative and resolved
		// against the frame height at paint time — which is what makes a 1x and
		// a 2x export look the same.
	}));
};

export function renderScreenshotExportCanvas({
	renderedBitmap,
	project,
	annotations,
	frame,
	imageRect,
}: {
	renderedBitmap: ImageBitmap;
	project: ProjectConfiguration;
	annotations: Annotation[];
	frame?: { width: number; height: number } | null;
	/** Where the screenshot sits inside the *preview* frame. Scaled to the
	 * export resolution below, and only needed when the focus pass has to run
	 * here rather than being inherited from the preview overlay. */
	imageRect?: Rect | null;
}) {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not get canvas context");

	canvas.width = renderedBitmap.width;
	canvas.height = renderedBitmap.height;
	const scaleX = frame ? canvas.width / frame.width : 1;
	const scaleY = frame ? canvas.height / frame.height : 1;
	const scaledAnnotations = scaleAnnotations(annotations, scaleX, scaleY);

	// The preview used to be copied straight across here when it was already at
	// full resolution. It cannot be any more: the preview is a layer stack the
	// browser composites, and its mask overlay is painted in the capture's own
	// space rather than the frame's, so neither canvas is the finished image.
	// Export therefore always composes from a freshly rendered frame — which
	// also means the defocus is always at final quality rather than the
	// preview's cheaper interactive one.
	{
		ctx.drawImage(renderedBitmap, 0, 0);

		// Masks read from an unmasked copy, so overlapping masks each blur the
		// original rather than compounding on one another.
		const sourceCanvas = document.createElement("canvas");
		sourceCanvas.width = canvas.width;
		sourceCanvas.height = canvas.height;
		const sourceCtx = sourceCanvas.getContext("2d");
		if (!sourceCtx) throw new Error("Could not get source canvas context");
		sourceCtx.drawImage(canvas, 0, 0);

		const fullFrame = {
			x: 0,
			y: 0,
			width: canvas.width,
			height: canvas.height,
		};

		const exportRect = imageRect
			? {
					x: imageRect.x * scaleX,
					y: imageRect.y * scaleY,
					width: imageRect.width * scaleX,
					height: imageRect.height * scaleY,
				}
			: null;

		// Same de-rotation the preview applies, against the export's own rect.
		// Without it a rotated capture would look right on screen and export with
		// its masks and defocus landing beside the content they belong to.
		withCardRotation(
			ctx,
			sourceCanvas,
			resolveTransform(project.background.displayTransform)?.rotation ?? 0,
			exportRect
				? {
						x: exportRect.x + exportRect.width / 2,
						y: exportRect.y + exportRect.height / 2,
					}
				: { x: canvas.width / 2, y: canvas.height / 2 },
			(target, frame) => {
				// Focus first: it re-renders the whole screenshot, so a redaction
				// painted before it would be defocused back out again.
				if (exportRect) {
					// Re-rendered at the export's own resolution rather than upscaling
					// the preview — §18: the GPU gets the real output dimensions.
					applyFocus(
						target,
						{ canvas: frame, revision: frame },
						scaledAnnotations,
						exportRect,
						project,
						"final",
					);
				}

				// Masks re-read the pristine copy, so a mask inside the focus region
				// stays a hard redaction rather than picking up the defocus.
				paintMasks(target, frame, scaledAnnotations, fullFrame);
			},
		);
	}

	drawAnnotations(ctx, scaledAnnotations);

	// An annotation dragged outside the frame would otherwise be cropped off the
	// export, so the output grows to contain everything that was drawn.
	let minX = 0;
	let minY = 0;
	let maxX = canvas.width;
	let maxY = canvas.height;

	for (const ann of scaledAnnotations) {
		// Neither draws outside the image, so neither should grow the export.
		if (ann.type === "mask" || ann.type === "focus") continue;
		if (ann.type === "arrow") {
			// Exact: the curve's derivative roots plus the head shapes, rather
			// than sampled points plus a guessed pad.
			const b = arrowBounds(arrowSpec(ann));
			minX = Math.min(minX, b.minX);
			maxX = Math.max(maxX, b.maxX);
			minY = Math.min(minY, b.minY);
			maxY = Math.max(maxY, b.maxY);
			continue;
		}
		for (const c of shapePoints(ann)) {
			minX = Math.min(minX, c.x);
			maxX = Math.max(maxX, c.x);
			minY = Math.min(minY, c.y);
			maxY = Math.max(maxY, c.y);
		}
	}

	const outputCanvas = document.createElement("canvas");
	outputCanvas.width = Math.max(1, Math.round(maxX - minX));
	outputCanvas.height = Math.max(1, Math.round(maxY - minY));
	const outputCtx = outputCanvas.getContext("2d");
	if (!outputCtx) throw new Error("Could not get output canvas context");

	if (!hasNoVisibleBackground(project.background.source)) {
		outputCtx.fillStyle = "white";
		outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
	}
	outputCtx.drawImage(canvas, -minX, -minY);

	return outputCanvas;
}

export const canvasToBlob = (
	canvas: HTMLCanvasElement,
	type: string,
	quality?: number,
) =>
	new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("Failed to create blob")),
			type,
			quality,
		),
	);

/** Whether the export actually has transparent pixels worth keeping. A config
 * with no background does not guarantee any: zero padding with square corners
 * leaves the frame fully opaque, and JPEG is much smaller. */
export const canvasNeedsTransparency = (
	canvas: HTMLCanvasElement,
	project: ProjectConfiguration,
) => {
	if (!hasNoVisibleBackground(project.background.source)) return false;

	const ctx = canvas.getContext("2d");
	if (!ctx) return true;

	const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] !== 255) return true;
	}
	return false;
};
