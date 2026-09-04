import type {
	Paragraph,
	RunStyle,
	TextContent,
	TextDecoration,
	TextRun,
	TextTransform,
} from "@/utils/tauri";

// `TextContent` → DOM, for seeding a `contentEditable` when a text session
// starts. The DOM here is an input device, not a measuring device — cosmic-
// text (`measure_text`) is what actually lays the text out once the session
// commits, so this only has to look approximately right, not measure
// correctly. See `plans/text-engine/004`.
//
// One `ParagraphSet` is assumed — `root.children[0]` — matching every other
// consumer of this model (`quiro-text`'s own `compute`, the migrations that
// produce it). It is never itself represented as a DOM node, so collapsing
// it later (`plans/text-engine/000`'s own flagged risk) needs no format
// change here.

const DECORATION_CSS: Record<TextDecoration, string> = {
	none: "",
	underline: "underline",
	lineThrough: "line-through",
};

const TRANSFORM_CSS: Record<TextTransform, string> = {
	none: "",
	uppercase: "uppercase",
	lowercase: "lowercase",
	capitalize: "capitalize",
};

/** `RunStyle.fontSize`/`letterSpacing` are px@1080 (see that field's Rust doc
 * comment); `scale` is `anchorHeight / 1080`, the same conversion
 * `quiro-text` applies server-side and `space.ts`'s `fontSizeToFramePx`
 * already applies for the single-run editor. Exported for
 * `apply-selection-style.ts`, which rebuilds spans the same way this file
 * does when a run-level panel control applies to a live DOM `Selection`
 * rather than the whole object. */
export function applyRunStyle(el: HTMLElement, style: RunStyle, scale: number) {
	el.style.fontFamily = style.fontFamily || "sans-serif";
	el.style.fontSize = `${style.fontSize * scale}px`;
	el.style.fontWeight = String(style.fontWeight);
	el.style.fontStyle = style.italic ? "italic" : "normal";
	el.style.color = style.color;
	el.style.letterSpacing = style.letterSpacing
		? `${style.letterSpacing * scale}px`
		: "normal";
	el.style.textDecoration = DECORATION_CSS[style.decoration];
	el.style.textTransform = TRANSFORM_CSS[style.transform];
}

/** Exported for `apply-selection-style.ts`'s rebuild step. */
export function runToSpan(run: TextRun, scale: number): HTMLSpanElement {
	const span = document.createElement("span");
	span.textContent = run.text;
	applyRunStyle(span, run.style, scale);
	return span;
}

function paragraphToElement(
	paragraph: Paragraph,
	scale: number,
): HTMLParagraphElement {
	const p = document.createElement("p");
	p.style.textAlign = paragraph.align;
	p.style.lineHeight = String(paragraph.lineHeight);
	// A paragraph with nothing *in* it needs a `<br>` or the caret has nowhere
	// to land and the element collapses to zero height. That covers a
	// paragraph with no runs at all (select-all then Enter) and one whose runs
	// are all empty — which is what a newly created text object is, and which
	// used to emit a lone empty `<span>`: no line box, no visible caret, and a
	// selection outline drawn around nothing.
	if (paragraph.children.every((run) => run.text === "")) {
		p.appendChild(document.createElement("br"));
		return p;
	}
	for (const run of paragraph.children) p.appendChild(runToSpan(run, scale));
	return p;
}

/** One `<p>` per `Paragraph`, ready to become a `contentEditable`'s
 * children (`element.replaceChildren(...textContentToNodes(content, scale))`).
 * `scale` is `anchorHeight / 1080` — see `applyRunStyle`. */
export function textContentToNodes(
	content: TextContent,
	scale: number,
): HTMLParagraphElement[] {
	const paragraphs = content.root.children[0]?.children ?? [];
	if (paragraphs.length === 0) {
		// An empty tree still needs one paragraph to type into.
		return [
			paragraphToElement(
				{ align: "left", lineHeight: 1.2, children: [] },
				scale,
			),
		];
	}
	return paragraphs.map((paragraph) => paragraphToElement(paragraph, scale));
}
