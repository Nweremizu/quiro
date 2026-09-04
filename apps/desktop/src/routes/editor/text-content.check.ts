// Self-check for the video-segment text-tree helpers. Run via `pnpm check`,
// or alone:
//
//   npx esbuild src/routes/editor/text-content.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/tc.cjs && node /tmp/tc.cjs
//
// The property that matters: reading and writing through these helpers must
// never lose or corrupt the one paragraph / one run a `TextSegment` carries —
// `SegmentConfig.tsx`, `TextOverlay.tsx` and `Timeline/index.tsx` all trust
// them to round-trip exactly.

import {
	defaultTextContent,
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
//    values (`migrate_text_content` in `configuration.rs`) — a freshly
//    created segment must render identically to a migrated one.
{
	const content = defaultTextContent("Hello");
	ok("default text round-trips", textContentString(content) === "Hello");
	const style = textContentStyle(content);
	ok(
		"default align is center",
		content.root.children[0].children[0].align === "center",
	);
	ok("default font size is 48", style.fontSize === 48);
	ok("default weight is 700", style.fontWeight === 700);
	ok("default color is white", style.color === "#ffffff");
	ok("default grow type is autoHeight", content.growType === "autoHeight");
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
	const content = defaultTextContent("Hello");
	const styled = withTextContentStyle(content, {
		fontSize: 96,
		color: "#ff0000",
	});
	const retexted = withTextContentString(styled, "Goodbye");
	ok("text replaced", textContentString(retexted) === "Goodbye");
	ok(
		"style survives a text-only edit",
		textContentStyle(retexted).fontSize === 96 &&
			textContentStyle(retexted).color === "#ff0000",
	);
}

// 4. `withTextContentStyle` patches only the given fields, preserving text
//    and every other style field.
{
	const content = defaultTextContent("Title");
	const patched = withTextContentStyle(content, { italic: true });
	ok("text survives a style-only edit", textContentString(patched) === "Title");
	ok("patched field applied", textContentStyle(patched).italic === true);
	ok(
		"untouched fields survive",
		textContentStyle(patched).fontFamily ===
			textContentStyle(content).fontFamily &&
			textContentStyle(patched).fontSize === textContentStyle(content).fontSize,
	);
}

// 5. Both helpers build a default tree from scratch when `content` is
//    missing, rather than throwing — the first edit to a freshly created
//    segment (before any `textContent` exists) must not crash.
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

// 6. Paragraph-level: reads back the migration's own default (center, 1.2)
//    and patches without disturbing the run underneath it.
{
	const content = defaultTextContent("Hello");
	ok(
		"default paragraph align is center",
		textContentParagraph(content).align === "center",
	);
	ok(
		"default line height is 1.2",
		textContentParagraph(content).lineHeight === 1.2,
	);

	const patched = withTextContentParagraph(content, {
		align: "left",
		lineHeight: 1.5,
	});
	ok("align patched", textContentParagraph(patched).align === "left");
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
