import type { Paragraph, RunStyle, TextContent } from "@/utils/tauri";

// A `TextSegment` stays a single paragraph with a single run — alignment,
// line-height, letter-spacing and per-span styling get controls in
// `plans/text-engine/004`. These helpers read and write that one run, the
// same shape `ProjectConfiguration::migrate_text_content` (Rust) produces,
// so a freshly created segment renders identically to a migrated one.

const DEFAULT_RUN_STYLE: RunStyle = {
	fontFamily: "sans-serif",
	fontSize: 48,
	fontWeight: 700,
	italic: false,
	color: "#ffffff",
	letterSpacing: 0,
	decoration: "none",
	transform: "none",
};

export function defaultTextContent(text: string): TextContent {
	return {
		root: {
			children: [
				{
					children: [
						{
							align: "center",
							lineHeight: 1.2,
							children: [{ text, style: { ...DEFAULT_RUN_STYLE } }],
						},
					],
				},
			],
		},
		growType: "autoHeight",
		verticalAlign: "top",
		halo: null,
	};
}

function firstRun(content: TextContent | null | undefined) {
	return content?.root.children[0]?.children[0]?.children[0] ?? null;
}

export function textContentString(
	content: TextContent | null | undefined,
): string {
	return firstRun(content)?.text ?? "";
}

export function textContentStyle(
	content: TextContent | null | undefined,
): RunStyle {
	return firstRun(content)?.style ?? DEFAULT_RUN_STYLE;
}

/** Returns `content` with its one run's text replaced, building a default
 * tree first if `content` is missing (a segment created before this session,
 * or one the tree migration hasn't reached yet). */
export function withTextContentString(
	content: TextContent | null | undefined,
	text: string,
): TextContent {
	const base = content ?? defaultTextContent(text);
	const run = firstRun(base);
	if (!run) return defaultTextContent(text);

	return {
		...base,
		root: {
			children: [
				{
					children: [
						{
							...base.root.children[0].children[0],
							children: [{ ...run, text }],
						},
					],
				},
			],
		},
	};
}

/** Returns `content` with its one run's style patched, building a default
 * tree (seeded with `fallbackText`) first if `content` is missing. */
export function withTextContentStyle(
	content: TextContent | null | undefined,
	patch: Partial<RunStyle>,
	fallbackText = "Text",
): TextContent {
	const base = content ?? defaultTextContent(fallbackText);
	const run = firstRun(base);
	if (!run) return defaultTextContent(fallbackText);

	return {
		...base,
		root: {
			children: [
				{
					children: [
						{
							...base.root.children[0].children[0],
							children: [{ ...run, style: { ...run.style, ...patch } }],
						},
					],
				},
			],
		},
	};
}

function firstParagraph(content: TextContent): Paragraph | null {
	return content.root.children[0]?.children[0] ?? null;
}

/** Reads the segment's one paragraph's `align`/`lineHeight` — used by
 * `SegmentConfig.tsx`'s Paragraph-level controls (`plans/text-engine/004`). */
export function textContentParagraph(
	content: TextContent | null | undefined,
): Pick<Paragraph, "align" | "lineHeight"> {
	const paragraph = content && firstParagraph(content);
	return paragraph
		? { align: paragraph.align, lineHeight: paragraph.lineHeight }
		: { align: "center", lineHeight: 1.2 };
}

/** Returns `content` with its one paragraph's `align`/`lineHeight` patched,
 * building a default tree first if `content` is missing. */
export function withTextContentParagraph(
	content: TextContent | null | undefined,
	patch: Partial<Pick<Paragraph, "align" | "lineHeight">>,
	fallbackText = "Text",
): TextContent {
	const base = content ?? defaultTextContent(fallbackText);
	if (!firstParagraph(base)) return defaultTextContent(fallbackText);

	return {
		...base,
		root: {
			children: [
				{
					children: base.root.children[0].children.map((paragraph) => ({
						...paragraph,
						...patch,
					})),
				},
			],
		},
	};
}
