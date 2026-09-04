import {
	commands,
	type Paragraph,
	type RunStyle,
	type TextContent,
	type TextDecoration,
} from "@/utils/tauri";

// A text annotation stays a single paragraph with a single run — matches
// `ProjectConfiguration::migrate_annotation_space`'s third step exactly
// (`configuration.rs`), so a freshly created annotation renders identically
// to a migrated one. `strokeColor` used to double as the text's own paint
// colour before `plans/text-engine/003`; a fresh annotation's run starts
// from the same default rather than reading a stroke colour meant for
// shapes.

const DEFAULT_RUN_STYLE: RunStyle = {
	fontFamily: "sans-serif",
	fontSize: 32,
	fontWeight: 400,
	italic: false,
	// Black, not the shared annotation red: text is read, not pointed with,
	// and a new label should start neutral. Arrows and shapes keep
	// `DEFAULT_STROKE` — this is only the colour a new text object begins at,
	// and the panel changes it from here.
	color: "#000000",
	letterSpacing: 0,
	decoration: "none",
	transform: "none",
};

export function defaultAnnotationTextContent(text: string): TextContent {
	return {
		root: {
			children: [
				{
					children: [
						{
							align: "left",
							lineHeight: 1.2,
							children: [{ text, style: { ...DEFAULT_RUN_STYLE } }],
						},
					],
				},
			],
		},
		// Reproduces the old renderer's `white-space: nowrap`: the box grows
		// to fit the text rather than wrapping it.
		growType: "autoWidth",
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

/** `TextDecoration`'s Rust-side variant names aren't CSS keywords verbatim
 * (`lineThrough` vs. `line-through`) — `none` and `underline` already are. */
export function decorationCss(decoration: TextDecoration): string | undefined {
	return decoration === "lineThrough" ? "line-through" : decoration;
}

export function textContentStyle(
	content: TextContent | null | undefined,
): RunStyle {
	return firstRun(content)?.style ?? DEFAULT_RUN_STYLE;
}

// --- font faces ------------------------------------------------------------
//
// A face is fetched once per session, keyed by the `FaceId` `measure_text`
// minted it as (`quiro_text::FaceId`) — process-local to the Rust side that
// minted it, never persisted or reused across a restart. Module-level rather
// than per-component state: `document.fonts` is itself a single, global
// registry, and both the live editor (`context.tsx`) and export
// (`screenshotExport.ts`) register faces from the same measurements, so one
// cache shared by both is what keeps a face from being fetched twice.
const registeredFaces = new Set<number>();

/** Registers `quiro-face-{id}` as a `FontFace` the webview can paint text
 * with — the exact face cosmic-text shaped `measure_text`'s fragments with,
 * for any family name, not only the three CSS generics `layers/mod.rs`'s
 * `new_font_system` pins. No-ops if `id` is already registered. */
export async function registerFace(faceId: number): Promise<void> {
	if (registeredFaces.has(faceId)) return;
	registeredFaces.add(faceId);

	const bytes = await commands.fontFaceBytes(faceId);
	if (bytes.status !== "ok") {
		console.warn(`Failed to fetch bytes for font face ${faceId}`, bytes.error);
		return;
	}
	try {
		const face = new FontFace(
			`quiro-face-${faceId}`,
			new Uint8Array(bytes.data),
		);
		await face.load();
		document.fonts.add(face);
	} catch (error) {
		// `textLength` bounds the damage: a fragment painted with the fallback
		// family still occupies the same measured box, so this degrades to
		// visibly loose or tight tracking rather than a broken layout.
		console.warn(`Failed to register font face ${faceId}`, error);
	}
}

/** Returns `content` with its one run's text replaced, building a default
 * tree first if `content` is missing. */
export function withTextContentString(
	content: TextContent | null | undefined,
	text: string,
): TextContent {
	const base = content ?? defaultAnnotationTextContent(text);
	const run = firstRun(base);
	if (!run) return defaultAnnotationTextContent(text);

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
	const base = content ?? defaultAnnotationTextContent(fallbackText);
	const run = firstRun(base);
	if (!run) return defaultAnnotationTextContent(fallbackText);

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

/** Reads the object's one paragraph's `align`/`lineHeight` — used by the
 * panel's Paragraph-level controls (`plans/text-engine/004`). */
export function textContentParagraph(
	content: TextContent | null | undefined,
): Pick<Paragraph, "align" | "lineHeight"> {
	const paragraph = content && firstParagraph(content);
	return paragraph
		? { align: paragraph.align, lineHeight: paragraph.lineHeight }
		: { align: "left", lineHeight: 1.2 };
}

/** Returns `content` with every paragraph's `align`/`lineHeight` patched —
 * every paragraph, not just the first, so a multi-paragraph edit (typed
 * across more than one line) doesn't leave later paragraphs on the old
 * value the next time the panel changes it. Builds a default tree first if
 * `content` is missing. */
export function withTextContentParagraph(
	content: TextContent | null | undefined,
	patch: Partial<Pick<Paragraph, "align" | "lineHeight">>,
	fallbackText = "Text",
): TextContent {
	const base = content ?? defaultAnnotationTextContent(fallbackText);
	if (!firstParagraph(base)) return defaultAnnotationTextContent(fallbackText);

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
