import type { Annotation } from "@/utils/tauri";

// The four-corner view of a shape, ported from Penpot's `app.common.geom`.
//
// Penpot represents every shape as 4 corner points and derives width, height,
// centre and edge directions from vectors between them, so rotation needs no
// special case anywhere. It *stores* those points next to x/y/width/height and
// spends real effort keeping the two coherent — because it supports skew and
// inherited non-uniform scale, which an upright box plus an angle cannot
// express.
//
// We only ever rotate. Our corners are fully derivable from
// (x, y, width, height, rotation), so they are computed on demand here rather
// than stored: same benefit, none of the desync risk.
//
// Order is clockwise from the shape's own top-left: [nw, ne, se, sw].

export type Pt = { x: number; y: number };
export type Corners = [Pt, Pt, Pt, Pt];

/** Below this the shape is too thin to read an angle off, and atan2 on a
 * near-zero vector returns noise. */
const DEGENERATE = 1e-6;

/** Rotations within this of zero snap to exactly zero. Penpot does the same
 * with `gmt/unit?`, so a shape nudged to 1e-14 rad doesn't take the "rotated"
 * slow path forever after. */
const ANGLE_EPSILON = 1e-4;

export function rotatePoint(p: Pt, cx: number, cy: number, rad: number): Pt {
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const dx = p.x - cx;
	const dy = p.y - cy;
	return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** The shape's four real corners, rotation included. */
export function shapePoints(a: Annotation): Corners {
	const { x, y, width: w, height: h } = a;
	const corners: Corners = [
		{ x, y },
		{ x: x + w, y },
		{ x: x + w, y: y + h },
		{ x, y: y + h },
	];
	if (!a.rotation) return corners;
	const cx = x + w / 2;
	const cy = y + h / 2;
	const rad = (a.rotation * Math.PI) / 180;
	return corners.map((p) => rotatePoint(p, cx, cy, rad)) as Corners;
}

/** Centre of the box — the midpoint of either diagonal. */
export function pointsCenter(pts: Corners): Pt {
	return { x: (pts[0].x + pts[2].x) / 2, y: (pts[0].y + pts[2].y) / 2 };
}

/** Unit vectors along the shape's own axes, from the edges themselves — no
 * trigonometry, and correct under any rotation. Falls back to the world axes
 * when an edge has collapsed. */
export function localAxes(pts: Corners): { ux: Pt; uy: Pt } {
	const hx = pts[1].x - pts[0].x;
	const hy = pts[1].y - pts[0].y;
	const vx = pts[3].x - pts[0].x;
	const vy = pts[3].y - pts[0].y;
	const hl = Math.hypot(hx, hy);
	const vl = Math.hypot(vx, vy);
	return {
		ux: hl < DEGENERATE ? { x: 1, y: 0 } : { x: hx / hl, y: hy / hl },
		uy: vl < DEGENERATE ? { x: 0, y: 1 } : { x: vx / vl, y: vy / vl },
	};
}

export function pointsAABB(pts: readonly Pt[]): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const p of pts) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type Geometry = {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
};

/**
 * Decompose four corners back into the stored upright box plus an angle —
 * Penpot's `calculate-geometry`, minus the skew term we cannot produce.
 *
 * `fallbackRotation` is used when an edge has collapsed and the angle can't be
 * read; Penpot does the same, keeping the shape's previous transform rather
 * than letting a degenerate one through.
 */
export function pointsToGeometry(pts: Corners, fallbackRotation = 0): Geometry {
	const hx = pts[1].x - pts[0].x;
	const hy = pts[1].y - pts[0].y;
	const vx = pts[3].x - pts[0].x;
	const vy = pts[3].y - pts[0].y;

	const width = Math.hypot(hx, hy);
	const height = Math.hypot(vx, vy);

	let rotation =
		width < DEGENERATE
			? fallbackRotation
			: (Math.atan2(hy, hx) * 180) / Math.PI;
	if (Math.abs(rotation) < ANGLE_EPSILON) rotation = 0;

	const c = pointsCenter(pts);
	return {
		x: c.x - width / 2,
		y: c.y - height / 2,
		width,
		height,
		rotation,
	};
}

/**
 * Move the edges under `handle` and hand back the resulting geometry.
 *
 * This is the whole reason to work in points. The corner opposite the handle
 * has to stay pinned in world space; reading it off `shapePoints` is exact and
 * free, so the trigonometric back-solve for the new centre disappears. The
 * pointer delta is projected onto the shape's own axes, which come from the
 * edges themselves rather than from sin/cos of the angle.
 *
 * Rotation is untouched — resizing never rotates.
 */
export function resizeByHandle(
	a: Annotation,
	handle: string,
	worldDx: number,
	worldDy: number,
	keepAspect: boolean,
): Geometry {
	const pts = shapePoints(a);
	const { ux, uy } = localAxes(pts);

	const west = handle.includes("w");
	const north = handle.includes("n");

	// The corner opposite the handle. [0]=nw [1]=ne [2]=se [3]=sw
	const anchor = pts[west ? (north ? 2 : 1) : north ? 3 : 0];

	// Pointer delta in the shape's own frame.
	const ldx = worldDx * ux.x + worldDy * ux.y;
	const ldy = worldDx * uy.x + worldDy * uy.y;

	let width = a.width + (handle.includes("e") ? ldx : west ? -ldx : 0);
	let height = a.height + (handle.includes("s") ? ldy : north ? -ldy : 0);

	if (keepAspect) {
		// Equalise the resulting extents, keeping each one's direction.
		const size = Math.max(Math.abs(width), Math.abs(height));
		width = (width < 0 ? -1 : 1) * size;
		height = (height < 0 ? -1 : 1) * size;
	}

	// The box grows away from the anchor, so its top-left corner sits a full
	// extent back along any axis the anchor is on the far side of.
	const ox = anchor.x - (west ? ux.x * width : 0) - (north ? uy.x * height : 0);
	const oy = anchor.y - (west ? ux.y * width : 0) - (north ? uy.y * height : 0);

	// Centre, then back out the stored upright box.
	const cx = ox + (ux.x * width) / 2 + (uy.x * height) / 2;
	const cy = oy + (ux.y * width) / 2 + (uy.y * height) / 2;

	return {
		x: cx - width / 2,
		y: cy - height / 2,
		width,
		height,
		rotation: a.rotation,
	};
}
