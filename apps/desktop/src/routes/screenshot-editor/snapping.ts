import type { Annotation } from "@/utils/tauri";
import { pointsAABB, shapePoints } from "./geometry";

// Alignment snapping for the annotation editor. Pure geometry, no React — the
// same split as `arrow.ts`. Snap edges/centres of the shape being dragged onto
// the frame edges, the frame centre, and every other annotation's bounding box.

export type Rect = { x: number; y: number; width: number; height: number };

/** Axis-aligned bounding box of an annotation, rotation folded in. */
export const annotationAABB = (a: Annotation): Rect =>
	pointsAABB(shapePoints(a));

export type SnapTargets = { xs: number[]; ys: number[] };

/** Frame edges + frame centre + every other annotation's AABB edges/centre.
 * Collected once per gesture — nothing but the dragged shape moves mid-drag. */
export function collectSnapTargets(
	annotations: Annotation[],
	bounds: Rect,
	excludeId: string,
): SnapTargets {
	const xs = [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width];
	const ys = [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height];
	for (const a of annotations) {
		if (a.id === excludeId || a.type === "focus") continue;
		const b = annotationAABB(a);
		xs.push(b.x, b.x + b.width / 2, b.x + b.width);
		ys.push(b.y, b.y + b.height / 2, b.y + b.height);
	}
	return { xs, ys };
}

export type SnapResult = {
	dx: number;
	dy: number;
	guideX: number | null;
	guideY: number | null;
};

/** Nudge candidate coordinates onto the nearest target within `threshold`.
 * `candXs` / `candYs` are the moving shape's own lines (e.g. left, centre,
 * right); the smallest correction on each axis wins, independently. */
export function snap(
	candXs: number[],
	candYs: number[],
	targets: SnapTargets,
	threshold: number,
): SnapResult {
	const result: SnapResult = { dx: 0, dy: 0, guideX: null, guideY: null };
	let bestX = threshold;
	let bestY = threshold;
	for (const c of candXs) {
		for (const t of targets.xs) {
			const d = t - c;
			if (Math.abs(d) <= bestX) {
				bestX = Math.abs(d);
				result.dx = d;
				result.guideX = t;
			}
		}
	}
	for (const c of candYs) {
		for (const t of targets.ys) {
			const d = t - c;
			if (Math.abs(d) <= bestY) {
				bestY = Math.abs(d);
				result.dy = d;
				result.guideY = t;
			}
		}
	}
	return result;
}
