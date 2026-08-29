import type { Annotation, ProjectConfiguration } from "@/utils/tauri";
import { getArrowHeadPoints } from "./arrow";
import { type DofQuality, sharedDofRenderer } from "./dof";

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

		const level = Math.max(1, ann.maskLevel ?? 16);

		if ((ann.maskType ?? "blur") === "pixelate") {
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
			ctx.imageSmoothingEnabled = previousSmoothing;
			continue;
		}

		blurRegion(ctx, source, startX, startY, regionWidth, regionHeight, level);
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
			ctx.beginPath();
			ctx.lineCap = "round";
			const x2 = ann.x + ann.width;
			const y2 = ann.y + ann.height;
			const angle = Math.atan2(y2 - ann.y, x2 - ann.x);
			const head = getArrowHeadPoints(x2, y2, angle, ann.strokeWidth);

			// The shaft stops at the head's base, so a thick stroke does not poke
			// through the tip of the triangle.
			ctx.moveTo(ann.x, ann.y);
			ctx.lineTo(head.base.x, head.base.y);
			ctx.stroke();

			ctx.beginPath();
			ctx.moveTo(head.points[0].x, head.points[0].y);
			ctx.lineTo(head.points[1].x, head.points[1].y);
			ctx.lineTo(head.points[2].x, head.points[2].y);
			ctx.closePath();
			ctx.fillStyle = ann.strokeColor;
			ctx.fill();
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
		maskLevel: ann.maskLevel == null ? ann.maskLevel : ann.maskLevel * scalar,
		// `focus` is deliberately untouched: it is normalized to the screenshot
		// and its dials resolve against the render resolution, which is what
		// makes a 1x and a 2x export look the same.
	}));
};

export function renderScreenshotExportCanvas({
	renderedBitmap,
	project,
	annotations,
	frame,
	previewCanvas,
	previewMaskCanvas,
	canReusePreviewCanvases,
	imageRect,
}: {
	renderedBitmap: ImageBitmap;
	project: ProjectConfiguration;
	annotations: Annotation[];
	frame?: { width: number; height: number } | null;
	previewCanvas?: HTMLCanvasElement | null;
	previewMaskCanvas?: HTMLCanvasElement | null;
	canReusePreviewCanvases?: boolean;
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

	// The preview's defocus was rendered at interactive quality — fewer bokeh
	// samples — so a composition using focus always re-renders here instead of
	// shipping the cheap version.
	const reusePreview =
		canReusePreviewCanvases && !findFocusAnnotation(scaledAnnotations);

	if (reusePreview && previewCanvas && previewMaskCanvas) {
		// The preview is already the right size and its overlay already has the
		// masks burned in, so both can be copied straight across instead of
		// re-blurring.
		ctx.drawImage(previewCanvas, 0, 0);
		ctx.drawImage(previewMaskCanvas, 0, 0);
	} else {
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

		// Focus first: it re-renders the whole screenshot, so a redaction painted
		// before it would be defocused back out again.
		if (imageRect) {
			// Re-rendered at the export's own resolution rather than upscaling the
			// preview — §18: the GPU gets the real output dimensions.
			applyFocus(
				ctx,
				{ canvas: sourceCanvas, revision: sourceCanvas },
				scaledAnnotations,
				{
					x: imageRect.x * scaleX,
					y: imageRect.y * scaleY,
					width: imageRect.width * scaleX,
					height: imageRect.height * scaleY,
				},
				project,
				"final",
			);
		}

		// Masks re-read the pristine copy, so a mask inside the focus region
		// stays a hard redaction rather than picking up the defocus.
		paintMasks(ctx, sourceCanvas, scaledAnnotations, fullFrame);
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
		minX = Math.min(minX, ann.x, ann.x + ann.width);
		maxX = Math.max(maxX, ann.x, ann.x + ann.width);
		minY = Math.min(minY, ann.y, ann.y + ann.height);
		maxY = Math.max(maxY, ann.y, ann.y + ann.height);
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
