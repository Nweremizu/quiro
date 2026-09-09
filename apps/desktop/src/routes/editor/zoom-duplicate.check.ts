import type { ZoomSegment } from "@/utils/tauri";
import { planZoomDuplicate } from "./zoom-duplicate";

const zoom = (start: number, end: number): ZoomSegment => ({
	start,
	end,
	amount: 2,
	mode: { manual: { x: 0.25, y: 0.75 } },
	motion: {},
});

const exact = planZoomDuplicate([zoom(1, 3)], 0, 10);
if (
	exact.status !== "exact" ||
	exact.segment.start !== 3 ||
	exact.segment.end !== 5
) {
	throw new Error("An unobstructed zoom must duplicate at its right edge");
}

const trimmed = planZoomDuplicate([zoom(1, 3), zoom(4, 6)], 0, 10);
if (
	trimmed.status !== "trim" ||
	trimmed.segment.start !== 3 ||
	trimmed.segment.end !== 4
) {
	throw new Error("A blocked duplicate must trim exactly to the next zoom");
}

const blocked = planZoomDuplicate([zoom(1, 3), zoom(3.2, 6)], 0, 10);
if (blocked.status !== "blocked") {
	throw new Error("A gap below the minimum duration must reject duplication");
}

const unsorted = planZoomDuplicate([zoom(7, 8), zoom(1, 3), zoom(5, 6)], 1, 10);
if (unsorted.status !== "exact" || unsorted.segment.end !== 5) {
	throw new Error("Collision detection must not depend on segment order");
}

const occupied = planZoomDuplicate([zoom(1, 3), zoom(2.5, 4)], 0, 10);
if (occupied.status !== "blocked") {
	throw new Error("Duplication must reject an occupied insertion point");
}

console.log("zoom-duplicate: ALL PASS");
