// Self-check for the annotation text-tree helpers. Run via `pnpm check`, or
// alone:
//
//   npx esbuild src/routes/screenshot-editor/text-content.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/tc.cjs && node /tmp/tc.cjs
//
// The property that matters: reading and writing through these helpers must
// never lose or corrupt the one paragraph / one run a text annotation
// carries — `AnnotationConfig.tsx`, `AnnotationLayer.tsx` and `LayersPanel.tsx`
// all trust them to round-trip exactly. `registerFace` (network/DOM-backed)
// is exercised by hand in the browser, not here.

import {
	decorationCss,
	defaultAnnotationTextContent,
	textContentParagraph,
	textContentString,
	textContentStyle,
	withTextContentParagraph,
	withTextContentString,
	withTextContentStyle,
} from "./text-content";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, extra = "") => {
	if (cond) {
		passes++;
		return;
	}
	failures++;
	console.log(`FAIL  ${name}${extra ? ` ${extra}` : ""}`);
};

// 1. A default tree carries the given text and matches the migration's own
//    values (`migrate_annotation_space`'s third step in `configuration.rs`)
//    — a freshly created annotation must render identically to a migrated
//    one.
{
	const content = defaultAnnotationTextContent("Hello");
	ok("default text round-trips", textContentString(content) === "Hello");
	const style = textContentStyle(content);
	ok(
		"default align is left",
		content.root.children[0].children[0].align === "left",
	);
	ok("default weight is 400", style.fontWeight === 400);
	ok("default grow type is autoWidth", content.growType === "autoWidth");
}

// 2. Missing content (`null`/`undefined`) reads back as sensible defaults,
//    not a crash — every consumer calls these before a project has loaded.
{
	ok("missing content reads as empty string", textContentString(null) === "");
	ok(
		"missing content reads as empty string",
		textContentString(undefined) === "",
	);
	const style = textContentStyle(null);
	ok("missing content's style has a font size", style.fontSize > 0);
}

// 3. `withTextContentString` replaces only the text, preserving style.
{
	const content = defaultAnnotationTextContent("Hello");
	const styled = withTextContentStyle(content, {
		fontSize: 64,
		color: "#00ff00",
	});
	const retexted = withTextContentString(styled, "Goodbye");
	ok("text replaced", textContentString(retexted) === "Goodbye");
	ok(
		"style survives a text-only edit",
		textContentStyle(retexted).fontSize === 64 &&
			textContentStyle(retexted).color === "#00ff00",
	);
}

// 4. `withTextContentStyle` patches only the given fields, preserving text
//    and every other style field.
{
	const content = defaultAnnotationTextContent("Label");
	const patched = withTextContentStyle(content, { fontSize: 18 });
	ok("text survives a style-only edit", textContentString(patched) === "Label");
	ok("patched field applied", textContentStyle(patched).fontSize === 18);
	ok(
		"untouched fields survive",
		textContentStyle(patched).color === textContentStyle(content).color &&
			textContentStyle(patched).fontFamily ===
				textContentStyle(content).fontFamily,
	);
}

// 5. Both helpers build a default tree from scratch when `content` is
//    missing, rather than throwing — the first edit to a freshly created
//    annotation (before any `textContent` exists) must not crash.
{
	const fromText = withTextContentString(null, "New");
	ok(
		"withTextContentString builds a tree from null",
		textContentString(fromText) === "New",
	);

	const fromStyle = withTextContentStyle(undefined, { fontSize: 12 });
	ok(
		"withTextContentStyle builds a tree from undefined",
		textContentStyle(fromStyle).fontSize === 12,
	);
}

// 6. `decorationCss` maps every Rust-side variant to a real CSS value —
//    `lineThrough` is the one name that isn't already a CSS keyword.
ok("none maps through", decorationCss("none") === "none");
ok("underline maps through", decorationCss("underline") === "underline");
ok(
	"lineThrough becomes line-through",
	decorationCss("lineThrough") === "line-through",
);

// 7. Paragraph-level: reads back the annotation migration's own default
//    (left, 1.2) and patches without disturbing the run underneath it.
{
	const content = defaultAnnotationTextContent("Hello");
	ok(
		"default paragraph align is left",
		textContentParagraph(content).align === "left",
	);
	ok(
		"default line height is 1.2",
		textContentParagraph(content).lineHeight === 1.2,
	);

	const patched = withTextContentParagraph(content, {
		align: "center",
		lineHeight: 1.5,
	});
	ok("align patched", textContentParagraph(patched).align === "center");
	ok("line height patched", textContentParagraph(patched).lineHeight === 1.5);
	ok(
		"text survives a paragraph-only edit",
		textContentString(patched) === "Hello",
	);

	const fromNothing = withTextContentParagraph(null, { align: "right" });
	ok(
		"withTextContentParagraph builds a tree from null",
		textContentParagraph(fromNothing).align === "right",
	);
}

if (failures > 0) throw new Error(`${failures} text-content check(s) failed`);
console.log(`ALL PASS (${passes} assertions)`);
