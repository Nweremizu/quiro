// Geometry for the crop tool, ported from Cap's `components/Cropper.tsx`.
//
// Everything here is pure and framework-agnostic — it is the half of Cap's
// Cropper that carries no Solid in it, so it moves across unchanged. The React
// component that drives it lives in `Cropper.tsx`.
//
// All bounds are in *source image pixels*, never screen pixels. The component
// converts at the edges, so a crop stays correct no matter what size the dialog
// happens to be.

export interface CropBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const CROP_ZERO: CropBounds = { x: 0, y: 0, width: 0, height: 0 };

export type Direction = "n" | "e" | "s" | "w" | "nw" | "ne" | "se" | "sw";
export type Vec2 = { x: number; y: number };

type BoundsConstraints = {
	top: boolean;
	right: boolean;
	bottom: boolean;
	left: boolean;
};

export type HandleSide = {
	x: "l" | "r" | "c";
	y: "t" | "b" | "c";
	direction: Direction;
	cursor: string;
	movable: BoundsConstraints;
	/** The point that stays put while this handle drags: dragging the left edge
	 * pins the right one, so origin.x is 1. */
	origin: Vec2;
	isCorner: boolean;
};

export const HANDLES: readonly HandleSide[] = (
	[
		{ x: "l", y: "t", direction: "nw", cursor: "nwse-resize" },
		{ x: "r", y: "t", direction: "ne", cursor: "nesw-resize" },
		{ x: "l", y: "b", direction: "sw", cursor: "nesw-resize" },
		{ x: "r", y: "b", direction: "se", cursor: "nwse-resize" },
		{ x: "c", y: "t", direction: "n", cursor: "ns-resize" },
		{ x: "c", y: "b", direction: "s", cursor: "ns-resize" },
		{ x: "l", y: "c", direction: "w", cursor: "ew-resize" },
		{ x: "r", y: "c", direction: "e", cursor: "ew-resize" },
	] as const
).map(
	(handle) =>
		({
			...handle,
			movable: {
				top: handle.y === "t",
				bottom: handle.y === "b",
				left: handle.x === "l",
				right: handle.x === "r",
			},
			origin: {
				x: handle.x === "l" ? 1 : handle.x === "r" ? 0 : 0.5,
				y: handle.y === "t" ? 1 : handle.y === "b" ? 0 : 0.5,
			},
			isCorner: handle.x !== "c" && handle.y !== "c",
		}) as HandleSide,
);

export type Ratio = [number, number];

export const COMMON_RATIOS: readonly Ratio[] = [
	[1, 1],
	[2, 1],
	[3, 2],
	[4, 3],
	[9, 16],
	[16, 9],
	[16, 10],
	[21, 9],
];

export const ORIGIN_CENTER: Vec2 = { x: 0.5, y: 0.5 };

export const ratioToValue = (r: Ratio) => r[0] / r[1];
export const clamp = (n: number, min = 0, max = 1) =>
	Math.max(min, Math.min(max, n));

/** Nearest common ratio to the current shape, or null if none is close enough.
 * Checked in both orientations so a portrait drag snaps to 9:16 as readily as a
 * landscape one snaps to 16:9. */
export function findClosestRatio(
	width: number,
	height: number,
	threshold = 0.01,
): Ratio | null {
	const currentRatio = width / height;
	for (const ratio of COMMON_RATIOS) {
		if (Math.abs(currentRatio - ratio[0] / ratio[1]) < threshold)
			return [ratio[0], ratio[1]];
		if (Math.abs(currentRatio - ratio[1] / ratio[0]) < threshold)
			return [ratio[1], ratio[0]];
	}
	return null;
}

export function moveBounds(
	bounds: CropBounds,
	x: number | null,
	y: number | null,
): CropBounds {
	return {
		...bounds,
		x: x !== null ? Math.round(x) : bounds.x,
		y: y !== null ? Math.round(y) : bounds.y,
	};
}

/** Resizes around `origin` — the fraction of the box that stays fixed. */
export function resizeBounds(
	bounds: CropBounds,
	newWidth: number,
	newHeight: number,
	origin: Vec2,
): CropBounds {
	const fromX = bounds.x + bounds.width * origin.x;
	const fromY = bounds.y + bounds.height * origin.y;
	return {
		x: Math.round(fromX - newWidth * origin.x),
		y: Math.round(fromY - newHeight * origin.y),
		width: Math.round(newWidth),
		height: Math.round(newHeight),
	};
}

export function scaleBounds(bounds: CropBounds, factor: number, origin: Vec2) {
	return resizeBounds(
		bounds,
		bounds.width * factor,
		bounds.height * factor,
		origin,
	);
}

export function constrainBoundsToRatio(
	bounds: CropBounds,
	ratio: number,
	origin: Vec2,
) {
	const currentRatio = bounds.width / bounds.height;
	if (Math.abs(currentRatio - ratio) < 0.001) return bounds;
	return resizeBounds(bounds, bounds.width, bounds.width / ratio, origin);
}

export function constrainBoundsToSize(
	bounds: CropBounds,
	max: Vec2 | null,
	min: Vec2 | null,
	origin: Vec2,
	ratio: number | null = null,
) {
	let next = { ...bounds };
	let maxW = max?.x ?? null;
	let maxH = max?.y ?? null;
	let minW = min?.x ?? null;
	let minH = min?.y ?? null;

	// With a ratio locked, a width limit implies a height limit and vice versa;
	// the tighter of the two wins, or the ratio would break at the boundary.
	if (ratio) {
		if (minW && minH) {
			const effectiveMinW = Math.max(minW, minH * ratio);
			minW = effectiveMinW;
			minH = effectiveMinW / ratio;
		}
		if (maxW && maxH) {
			const effectiveMaxW = Math.min(maxW, maxH * ratio);
			maxW = effectiveMaxW;
			maxH = effectiveMaxW / ratio;
		}
	}

	if (maxW && next.width > maxW)
		next = resizeBounds(next, maxW, ratio ? maxW / ratio : next.height, origin);
	if (maxH && next.height > maxH)
		next = resizeBounds(next, ratio ? maxH * ratio : next.width, maxH, origin);
	if (minW && next.width < minW)
		next = resizeBounds(next, minW, ratio ? minW / ratio : next.height, origin);
	if (minH && next.height < minH)
		next = resizeBounds(next, ratio ? minH * ratio : next.width, minH, origin);

	return next;
}

export function slideBoundsIntoContainer(
	bounds: CropBounds,
	containerWidth: number,
	containerHeight: number,
): CropBounds {
	let { x, y } = bounds;
	const { width, height } = bounds;

	if (x < 0) x = 0;
	if (y < 0) y = 0;
	if (x + width > containerWidth) x = containerWidth - width;
	if (y + height > containerHeight) y = containerHeight - height;

	return { ...bounds, x, y };
}

export type ResizeOptions = {
	container: Vec2;
	min: Vec2 | null;
	max: Vec2 | null;
	/** Alt/Option: resize symmetrically about the centre. */
	isAltMode: boolean;
	/** Shift suppresses ratio snapping for one drag. */
	shiftKey: boolean;
	ratioValue: number | null;
	snapToRatioEnabled: boolean;
};

/** Resize with a locked aspect ratio. Returns null when the result would leave
 * the container, which the caller reads as "reject this move" — the box stops
 * at the edge rather than sliding along it and silently changing shape. */
export function computeAspectRatioResize(
	pointX: number,
	pointY: number,
	startBounds: CropBounds,
	handle: HandleSide,
	options: ResizeOptions,
): CropBounds | null {
	const { container, min, max, ratioValue } = options;
	if (ratioValue === null) return startBounds;

	const anchorX = startBounds.x + (handle.movable.left ? startBounds.width : 0);
	const anchorY = startBounds.y + (handle.movable.top ? startBounds.height : 0);

	const mX = clamp(pointX, 0, container.x);
	const mY = clamp(pointY, 0, container.y);
	const rawWidth = Math.abs(mX - anchorX);
	const rawHeight = Math.abs(mY - anchorY);

	let targetW: number;
	let targetH: number;

	if (handle.isCorner) {
		// The dominant axis of the drag drives the size, so a corner follows
		// whichever way the pointer actually went.
		if (rawWidth / ratioValue > rawHeight) {
			targetW = rawWidth;
			targetH = targetW / ratioValue;
		} else {
			targetH = rawHeight;
			targetW = targetH * ratioValue;
		}
	} else if (handle.x !== "c") {
		targetW = rawWidth;
		targetH = targetW / ratioValue;
	} else {
		targetH = rawHeight;
		targetW = targetH * ratioValue;
	}

	const newX = mX < anchorX ? anchorX - targetW : anchorX;
	const newY = mY < anchorY ? anchorY - targetH : anchorY;
	let finalBounds = { x: newX, y: newY, width: targetW, height: targetH };

	if (
		finalBounds.x < 0 ||
		finalBounds.y < 0 ||
		finalBounds.x + finalBounds.width > container.x ||
		finalBounds.y + finalBounds.height > container.y
	) {
		return null;
	}

	const resizeOrigin = { x: mX < anchorX ? 1 : 0, y: mY < anchorY ? 1 : 0 };
	finalBounds = constrainBoundsToSize(
		finalBounds,
		max,
		min,
		resizeOrigin,
		ratioValue,
	);

	if (finalBounds.width > container.x) {
		const scale = container.x / finalBounds.width;
		finalBounds.width = container.x;
		finalBounds.height *= scale;
	}
	if (finalBounds.height > container.y) {
		const scale = container.y / finalBounds.height;
		finalBounds.height = container.y;
		finalBounds.width *= scale;
	}

	finalBounds = slideBoundsIntoContainer(finalBounds, container.x, container.y);

	return {
		x: Math.round(finalBounds.x),
		y: Math.round(finalBounds.y),
		width: Math.round(Math.max(1, finalBounds.width)),
		height: Math.round(Math.max(1, finalBounds.height)),
	};
}

/** Free resize, with optional snap to the nearest common ratio. Reports which
 * ratio it snapped to so the caller can flash a badge and fire haptics. */
export function computeFreeResize(
	pointX: number,
	pointY: number,
	startBounds: CropBounds,
	handle: HandleSide,
	options: ResizeOptions,
): { bounds: CropBounds; snappedRatio: Ratio | null } {
	const { container, min, max, isAltMode, shiftKey, snapToRatioEnabled } =
		options;
	let snappedRatio: Ratio | null = null;
	let bounds: CropBounds;

	if (isAltMode) {
		const center = {
			x: startBounds.x + startBounds.width / 2,
			y: startBounds.y + startBounds.height / 2,
		};

		const distW = Math.abs(pointX - center.x);
		const distH = Math.abs(pointY - center.y);

		// Growing symmetrically stops as soon as *either* side hits the edge,
		// otherwise the box would stop being centred on its origin.
		const expLeft = Math.min(distW, center.x);
		const expRight = Math.min(distW, container.x - center.x);
		const expTop = Math.min(distH, center.y);
		const expBottom = Math.min(distH, container.y - center.y);

		let newW = expLeft + expRight;
		let newH = expTop + expBottom;

		if (min) {
			newW = Math.max(newW, min.x);
			newH = Math.max(newH, min.y);
		}
		if (max) {
			newW = Math.min(newW, max.x);
			newH = Math.min(newH, max.y);
		}

		if (!shiftKey && handle.isCorner && snapToRatioEnabled) {
			const closest = findClosestRatio(newW, newH);
			if (closest) {
				const r = ratioToValue(closest);
				if (handle.movable.top || handle.movable.bottom) newW = newH * r;
				else newH = newW / r;
				snappedRatio = closest;
			}
		}

		bounds = {
			x: Math.round(center.x - newW / 2),
			y: Math.round(center.y - newH / 2),
			width: Math.round(newW),
			height: Math.round(newH),
		};
	} else {
		const anchor = {
			x: startBounds.x + (handle.movable.left ? startBounds.width : 0),
			y: startBounds.y + (handle.movable.top ? startBounds.height : 0),
		};
		const clampedX = clamp(pointX, 0, container.x);
		const clampedY = clamp(pointY, 0, container.y);

		let x1 =
			handle.movable.left || handle.movable.right ? clampedX : startBounds.x;
		let y1 =
			handle.movable.top || handle.movable.bottom ? clampedY : startBounds.y;
		let x2 = anchor.x;
		let y2 = anchor.y;

		// An edge handle leaves the other axis exactly as it was.
		if (!handle.movable.left && !handle.movable.right) {
			x1 = startBounds.x;
			x2 = startBounds.x + startBounds.width;
		}
		if (!handle.movable.top && !handle.movable.bottom) {
			y1 = startBounds.y;
			y2 = startBounds.y + startBounds.height;
		}

		let newX = Math.min(x1, x2);
		let newY = Math.min(y1, y2);
		let newW = Math.abs(x1 - x2);
		let newH = Math.abs(y1 - y2);

		// Clamping has to move the origin too when dragging past the anchor,
		// or the box jumps to the other side of it.
		if (min) {
			if (newW < min.x) {
				const diff = min.x - newW;
				newW = min.x;
				if (clampedX < anchor.x) newX -= diff;
			}
			if (newH < min.y) {
				const diff = min.y - newH;
				newH = min.y;
				if (clampedY < anchor.y) newY -= diff;
			}
		}
		if (max) {
			if (newW > max.x) {
				const diff = newW - max.x;
				newW = max.x;
				if (clampedX < anchor.x) newX += diff;
			}
			if (newH > max.y) {
				const diff = newH - max.y;
				newH = max.y;
				if (clampedY < anchor.y) newY += diff;
			}
		}

		if (!shiftKey && handle.isCorner && snapToRatioEnabled) {
			const closest = findClosestRatio(newW, newH);
			if (closest) {
				const r = ratioToValue(closest);
				if (handle.movable.top || handle.movable.bottom) newW = newH * r;
				else newH = newW / r;
				if (clampedX < anchor.x) newX = anchor.x - newW;
				if (clampedY < anchor.y) newY = anchor.y - newH;
				snappedRatio = closest;
			}
		}

		bounds = {
			x: Math.round(newX),
			y: Math.round(newY),
			width: Math.round(newW),
			height: Math.round(newH),
		};
	}

	return { bounds, snappedRatio };
}
