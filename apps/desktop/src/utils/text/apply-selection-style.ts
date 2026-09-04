import type { RunStyle } from "@/utils/tauri";
import { flattenInlineRuns } from "./from-dom";
import { runToSpan } from "./to-dom";

// `plans/text-engine/004`: "Run-level controls apply to the DOM Selection
// when there is one and to the whole object when there is not." This is the
// Selection half — rebuilding exactly the selected range as new spans, each
// carrying the patch merged onto whatever style it already had, so a
// selection spanning a run boundary (bold word inside a plain sentence)
// keeps that boundary rather than being flattened to one style.

/**
 * Applies `patch` to the live `Selection` inside `container` (a
 * `.text-editor` contentEditable's root element), if one exists and falls
 * inside it. `patch` and `fallbackStyle` must already be in the DOM's own
 * units (real CSS px, not px@1080) — scale a panel value with `anchorScale`
 * before calling, the same way `to-dom.ts` does when seeding the editor.
 *
 * Returns `false` (nothing changed) when there is no non-collapsed selection
 * inside `container` — the caller's own fallback, per the plan's own words
 * above, is to patch the whole object's style instead.
 */
export function applyStyleToSelection(
	container: HTMLElement,
	patch: Partial<RunStyle>,
	fallbackStyle: RunStyle,
): boolean {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return false;
	}

	const range = selection.getRangeAt(0);
	if (!container.contains(range.commonAncestorContainer)) return false;

	const scratch = document.createElement("span");
	scratch.appendChild(range.extractContents());
	const runs = flattenInlineRuns(scratch, fallbackStyle);

	const spans = runs.map((run) =>
		runToSpan({ text: run.text, style: { ...run.style, ...patch } }, 1),
	);
	const rebuilt = document.createDocumentFragment();
	for (const span of spans) rebuilt.appendChild(span);
	range.insertNode(rebuilt);

	// Re-select what was just inserted — `insertNode` collapses `range` to
	// its own end, and a second control (weight, then colour) should still
	// apply to the same text without the user reselecting it.
	if (spans.length > 0) {
		const reselect = document.createRange();
		reselect.setStartBefore(spans[0]);
		reselect.setEndAfter(spans[spans.length - 1]);
		selection.removeAllRanges();
		selection.addRange(reselect);
	}

	return true;
}
