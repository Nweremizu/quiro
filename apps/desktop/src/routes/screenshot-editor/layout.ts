import type { AspectRatio, LayerTransform, XY } from "@/utils/tauri";
import { type FramePx, frameRect, type Rect } from "./space";
import { resolveTransform, transformRect } from "./transform";

export const SCREEN_MAX_PADDING = 0.4;

const roundBaseDimension = (value: number) =>
	Math.max((Math.ceil(value) + 1) & ~1, 2);

const roundAutoBaseDimension = (value: number) => (Math.floor(value) + 1) & ~1;

function getAspectRatioValue(aspectRatio: AspectRatio) {
	switch (aspectRatio) {
		case "wide":
			return 16 / 9;
		case "vertical":
			return 9 / 16;
		case "square":
			return 1;
		case "classic":
			return 4 / 3;
		case "tall":
			return 3 / 4;
	}
}

function getBaseSize(
	cropWidth: number,
	cropHeight: number,
	paddingFactor: number,
	aspectRatio: AspectRatio | null,
) {
	if (aspectRatio === null) {
		const scale = 1 + paddingFactor * 2;
		return {
			width: roundAutoBaseDimension(cropWidth * scale),
			height: roundAutoBaseDimension(cropHeight * scale),
		};
	}

	const cropAspect = cropWidth / cropHeight;
	const targetAspect = getAspectRatioValue(aspectRatio);
	const padding = Math.max(cropWidth, cropHeight) * paddingFactor * 2;

	if (cropAspect > targetAspect) {
		const width = cropWidth + padding;
		const height = width / targetAspect;
		return {
			width: roundBaseDimension(width),
			height: roundBaseDimension(height),
		};
	}

	const height = cropHeight + padding;
	const width = height * targetAspect;
	return {
		width: roundBaseDimension(width),
		height: roundBaseDimension(height),
	};
}

export function calculateImageTransform(
	frameSize: { width: number; height: number },
	imageSize: { width: number; height: number },
	padding: number,
	crop: { position: XY<number>; size: XY<number> } | null,
	aspectRatio: AspectRatio | null,
) {
	const cropWidth = crop?.size.x ?? imageSize.width;
	const cropHeight = crop?.size.y ?? imageSize.height;

	if (
		frameSize.width <= 0 ||
		frameSize.height <= 0 ||
		cropWidth <= 0 ||
		cropHeight <= 0
	) {
		return {
			offset: { x: 0, y: 0 },
			size: {
				width: Math.max(frameSize.width, 0),
				height: Math.max(frameSize.height, 0),
			},
		};
	}

	const croppedAspect = cropWidth / cropHeight;
	const outputAspect = frameSize.width / frameSize.height;

	const paddingFactor = (padding / 100.0) * SCREEN_MAX_PADDING;
	const baseSize = getBaseSize(
		cropWidth,
		cropHeight,
		paddingFactor,
		aspectRatio,
	);
	const outputScale = Math.min(
		frameSize.width / Math.max(baseSize.width, 1),
		frameSize.height / Math.max(baseSize.height, 1),
	);

	if (aspectRatio === null) {
		const offsetX = cropWidth * paddingFactor * outputScale;
		const offsetY = cropHeight * paddingFactor * outputScale;

		return {
			offset: { x: offsetX, y: offsetY },
			size: {
				width: Math.max(frameSize.width - offsetX * 2, 1),
				height: Math.max(frameSize.height - offsetY * 2, 1),
			},
		};
	}

	const cropBasis = Math.max(cropWidth, cropHeight);
	const maxPadding = Math.max(
		Math.min((frameSize.width - 1) / 2, (frameSize.height - 1) / 2),
		0,
	);
	const paddingPixels = Math.min(
		cropBasis * paddingFactor * outputScale,
		maxPadding,
	);

	const availableWidth = Math.max(frameSize.width - 2 * paddingPixels, 1);
	const availableHeight = Math.max(frameSize.height - 2 * paddingPixels, 1);

	const isHeightConstrained = croppedAspect <= outputAspect;

	let targetWidth: number;
	let targetHeight: number;
	if (isHeightConstrained) {
		targetHeight = availableHeight;
		targetWidth = availableHeight * croppedAspect;
	} else {
		targetWidth = availableWidth;
		targetHeight = availableWidth / croppedAspect;
	}

	const targetOffsetX = (frameSize.width - targetWidth) / 2;
	const targetOffsetY = (frameSize.height - targetHeight) / 2;

	const offsetX = isHeightConstrained ? targetOffsetX : paddingPixels;
	const offsetY = isHeightConstrained ? paddingPixels : targetOffsetY;

	return {
		offset: { x: offsetX, y: offsetY },
		size: { width: targetWidth, height: targetHeight },
	};
}

/**
 * Where the screenshot content sits inside the rendered frame.
 *
 * This rect is the anchor every image-normalized coordinate is defined
 * against, so it is returned in an explicit space rather than as bare
 * numbers — see `space.ts`. It moves and resizes whenever padding, crop or
 * aspect ratio changes, which is exactly why nothing durable may be stored
 * in the frame pixels it is expressed in.
 */
export function getImageRect(
	frameSize: { width: number; height: number },
	imageSize: { width: number; height: number } | null,
	padding: number,
	crop: { position: XY<number>; size: XY<number> } | null,
	aspectRatio: AspectRatio | null,
	displayTransform: LayerTransform | null = null,
): Rect<FramePx> {
	if (!imageSize) {
		return frameRect(0, 0, frameSize.width, frameSize.height);
	}

	const transform = calculateImageTransform(
		frameSize,
		imageSize,
		padding,
		crop,
		aspectRatio,
	);

	const laidOut = frameRect(
		transform.offset.x,
		transform.offset.y,
		transform.size.width,
		transform.size.height,
	);

	// The layer transform is applied last, on top of the layout, exactly as
	// `frame_layout::content_rect` does it. Rotation is not folded in: this
	// rect stays the capture's unrotated bounds, which is what the renderer's
	// `target_bounds` and every annotation anchored to the capture are
	// measured in.
	const layer = resolveTransform(displayTransform);
	return layer ? transformRect(laidOut, layer, frameSize) : laidOut;
}
