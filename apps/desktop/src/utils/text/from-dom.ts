import type {
	Paragraph,
	RunStyle,
	TextAlign,
	TextContent,
	TextDecoration,
	TextRun,
	TextTransform,
} from "@/utils/tauri";

// DOM → `TextContent`, read once at commit (not per keystroke — the whole
// point of `plans/text-engine/004` is that typing costs nothing but a DOM
// mutation). Must be total: any element it doesn't recognise collapses to a
// run in the enclosing paragraph, any empty paragraph is dropped, and if
// nothing recognisable survives at all, `previous` is returned unchanged
// rather than writing a malformed or empty tree over real content.

const ALIGN_VALUES = new Set<TextAlign>(["left", "center", "right", "justify"]);
// Keyed by the CSS `text-decoration` substring; `line-through` is Rust's
// `lineThrough`, not a CSS keyword, so the two spellings have to be mapped
// explicitly rather than assumed equal.
const DECORATION_FROM_CSS: Record<string, TextDecoration> = {
	underline: "underline",
	"line-through": "lineThrough",
};
const TRANSFORM_FROM_CSS: Record<string, TextTransform> = {
	uppercase: "uppercase",
	lowercase: "lowercase",
	capitalize: "capitalize",
};

function alignFromCss(value: string): TextAlign | null {
	const normalized = value.trim().toLowerCase();
	return ALIGN_VALUES.has(normalized as TextAlign)
		? (normalized as TextAlign)
		: null;
}

/** Reads the inline style (or, failing that, the semantic tag — `<b>`,
 * `<i>`, `<u>`, `<s>` — a browser's own formatting command, or a plain-text
 * paste run through `execCommand`, can produce either) that this element
 * overrides, layering it onto `inherited` the way CSS cascades: only
 * properties this element actually sets are changed. */
function styleFromElement(el: HTMLElement, inherited: RunStyle): RunStyle {
	const style = { ...inherited };
	const css = el.style;
	const tag = el.tagName;

	if (css.fontFamily)
		style.fontFamily = css.fontFamily.replace(/^["']|["']$/g, "");
	if (css.fontSize) {
		const px = Number.parseFloat(css.fontSize);
		if (Number.isFinite(px) && px > 0) style.fontSize = px;
	}
	if (css.fontWeight) {
		const weight = Number.parseFloat(css.fontWeight);
		if (Number.isFinite(weight)) style.fontWeight = weight;
	} else if (tag === "B" || tag === "STRONG") {
		style.fontWeight = 700;
	}
	if (css.fontStyle === "italic" || tag === "I" || tag === "EM")
		style.italic = true;
	else if (css.fontStyle === "normal") style.italic = false;
	if (css.color) style.color = css.color;
	if (css.letterSpacing && css.letterSpacing !== "normal") {
		const px = Number.parseFloat(css.letterSpacing);
		if (Number.isFinite(px)) style.letterSpacing = px;
	}
	if (css.textDecoration) {
		const found = Object.keys(DECORATION_FROM_CSS).find((key) =>
			css.textDecoration.includes(key),
		);
		if (found) style.decoration = DECORATION_FROM_CSS[found];
	} else if (tag === "U") style.decoration = "underline";
	else if (tag === "S" || tag === "STRIKE" || tag === "DEL")
		style.decoration = "lineThrough";
	if (css.textTransform && TRANSFORM_FROM_CSS[css.textTransform]) {
		style.transform = TRANSFORM_FROM_CSS[css.textTransform];
	}

	return style;
}

/** Undoes the anchor scale `to-dom.ts` applied — `scale` is the same
 * `anchorHeight / 1080` both directions use. */
function unscaleStyle(style: RunStyle, scale: number): RunStyle {
	if (scale === 1) return style;
	return {
		...style,
		fontSize: style.fontSize / scale,
		letterSpacing: style.letterSpacing / scale,
	};
}

class ParagraphBuilder {
	private runs: TextRun[] = [];
	private align: TextAlign = "left";
	private lineHeight = 1.2;

	setBlockStyle(el: HTMLElement) {
		const align = alignFromCss(el.style.textAlign);
		if (align) this.align = align;
		const lineHeight = Number.parseFloat(el.style.lineHeight);
		if (Number.isFinite(lineHeight) && lineHeight > 0)
			this.lineHeight = lineHeight;
	}

	pushText(text: string, style: RunStyle) {
		if (!text) return;
		const last = this.runs[this.runs.length - 1];
		// Two adjacent runs with identical style (a browser splitting one span
		// into several for no visible reason is common) merge into one, so a
		// run boundary always means a real style change.
		if (last && stylesEqual(last.style, style)) {
			last.text += text;
			return;
		}
		this.runs.push({ text, style });
	}

	build(scale: number): Paragraph | null {
		if (this.runs.length === 0) return null;
		return {
			align: this.align,
			lineHeight: this.lineHeight,
			children: this.runs.map((run) => ({
				...run,
				style: unscaleStyle(run.style, scale),
			})),
		};
	}

	/** The accumulated runs on their own, still in DOM (real px) units —
	 * `flattenInlineRuns` uses this directly rather than `build`, which
	 * wraps them in a `Paragraph` and unscales, neither of which applies to
	 * a bare selection. */
	getRuns(): TextRun[] {
		return this.runs;
	}
}

/** Reads a DOM subtree's inline content back into a flat run list — the same
 * walk `domToTextContent` does per paragraph, exposed standalone for
 * `apply-selection-style.ts`, which needs to read back exactly the content a
 * `Range.extractContents()` pulled out (never a whole paragraph, and never
 * unscaled — the caller is already working in the DOM's own real-px units). */
export function flattenInlineRuns(
	container: Element,
	fallbackStyle: RunStyle,
): TextRun[] {
	const builder = new ParagraphBuilder();
	for (const child of Array.from(container.childNodes)) {
		walkInline(child, fallbackStyle, builder);
	}
	return builder.getRuns();
}

function stylesEqual(a: RunStyle, b: RunStyle): boolean {
	return (
		a.fontFamily === b.fontFamily &&
		a.fontSize === b.fontSize &&
		a.fontWeight === b.fontWeight &&
		a.italic === b.italic &&
		a.color === b.color &&
		a.letterSpacing === b.letterSpacing &&
		a.decoration === b.decoration &&
		a.transform === b.transform
	);
}

const BLOCK_TAGS = new Set(["P", "DIV"]);

function walkInline(
	node: Node,
	inherited: RunStyle,
	builder: ParagraphBuilder,
) {
	if (node.nodeType === Node.TEXT_NODE) {
		builder.pushText(node.textContent ?? "", inherited);
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return;
	const el = node as HTMLElement;
	if (el.tagName === "BR") return; // handled by the caller as a paragraph break

	const style = styleFromElement(el, inherited);
	for (const child of Array.from(el.childNodes))
		walkInline(child, style, builder);
}

/** Reads `root`'s children (a `contentEditable`'s DOM after typing) back
 * into a `TextContent`, reusing `previous` for the object-level fields the
 * DOM never encodes (`growType`, `verticalAlign`, `halo`) and as the
 * fallback when nothing recognisable survived. `scale` must be the same
 * value `textContentToNodes` was called with. */
export function domToTextContent(
	root: Element,
	previous: TextContent,
	scale: number,
): TextContent {
	const fallbackStyle: RunStyle =
		previous.root.children[0]?.children[0]?.children[0]?.style ??
		unscaleStyle(
			{
				fontFamily: "sans-serif",
				fontSize: 24,
				fontWeight: 400,
				italic: false,
				color: "#000000",
				letterSpacing: 0,
				decoration: "none",
				transform: "none",
			},
			1,
		);

	const paragraphs: Paragraph[] = [];
	let builder = new ParagraphBuilder();

	const flush = () => {
		const paragraph = builder.build(scale);
		if (paragraph) paragraphs.push(paragraph);
		builder = new ParagraphBuilder();
	};

	for (const node of Array.from(root.childNodes)) {
		if (
			node.nodeType === Node.ELEMENT_NODE &&
			BLOCK_TAGS.has((node as HTMLElement).tagName)
		) {
			flush(); // whatever came before this block is its own paragraph
			const el = node as HTMLElement;
			builder.setBlockStyle(el);
			for (const child of Array.from(el.childNodes))
				walkInline(child, fallbackStyle, builder);
			flush();
			continue;
		}
		if (
			node.nodeType === Node.ELEMENT_NODE &&
			(node as HTMLElement).tagName === "BR"
		) {
			flush();
			continue;
		}
		// Unrecognised element or stray top-level text — collapses into
		// whichever paragraph is currently open, per `from_dom` being total.
		walkInline(node, fallbackStyle, builder);
	}
	flush();

	if (paragraphs.length === 0) return previous;

	return {
		...previous,
		root: { children: [{ children: paragraphs }] },
	};
}
