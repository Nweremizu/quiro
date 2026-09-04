// Self-check for `to-dom.ts` / `from-dom.ts` together. Run via `pnpm check`,
// or alone:
//
//   npx esbuild src/utils/text/dom-roundtrip.check.ts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/dr.cjs && node /tmp/dr.cjs
//
// Neither file is browser-only in what it actually touches — element
// creation, `style.*` properties, `childNodes`, text nodes — so a ~40-line
// fake DOM covers it without a real dependency (jsdom/happy-dom) for two
// files. `globalThis.document`/`Node` are set before either module is
// imported, since both read them at call time, not at import time.
//
// The property that matters: `TextContent → DOM → TextContent` must be
// lossless for exactly the shapes `plans/text-engine/004`'s acceptance
// criteria name — multiple runs, mixed styles, an empty paragraph, malformed
// input recovering rather than losing data.

// A real `CSSStyleDeclaration` returns `""` for any unset property, never
// `undefined` — `from-dom.ts` is written against that contract, so the fake
// has to honour it too, or it tests a shim that doesn't behave like the
// thing it stands in for.
function makeFakeStyle(): Record<string, string> {
	return new Proxy(
		{},
		{
			get: (target, prop) => (prop in target ? (target as never)[prop] : ""),
		},
	) as Record<string, string>;
}

class FakeNode {
	nodeType: number;
	parentNode: FakeElement | null = null;
	constructor(nodeType: number) {
		this.nodeType = nodeType;
	}
}

class FakeTextNode extends FakeNode {
	constructor(public data: string) {
		super(3); // Node.TEXT_NODE
	}
	get textContent() {
		return this.data;
	}
}

class FakeElement extends FakeNode {
	tagName: string;
	style = makeFakeStyle();
	childNodes: FakeNode[] = [];
	constructor(tagName: string) {
		super(1); // Node.ELEMENT_NODE
		this.tagName = tagName.toUpperCase();
	}
	appendChild(node: FakeNode) {
		node.parentNode = this;
		this.childNodes.push(node);
		return node;
	}
	replaceChildren(...nodes: FakeNode[]) {
		this.childNodes = [];
		for (const node of nodes) this.appendChild(node);
	}
	set textContent(value: string) {
		this.childNodes = [new FakeTextNode(value)];
	}
	get textContent(): string {
		return this.childNodes.map((n) => (n as FakeTextNode).data ?? "").join("");
	}
}

// Neither module under test touches `document`/`Node` at its own import
// time (only inside the functions the assertions below call), so a static
// import is safe even though it is hoisted above this assignment.
(globalThis as Record<string, unknown>).document = {
	createElement: (tag: string) => new FakeElement(tag),
};
(globalThis as Record<string, unknown>).Node = {
	TEXT_NODE: 3,
	ELEMENT_NODE: 1,
};

import type { RunStyle, TextContent } from "@/utils/tauri";
import { domToTextContent } from "./from-dom";
import { textContentToNodes } from "./to-dom";

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

function styleOf(overrides: Partial<RunStyle> = {}): RunStyle {
	return {
		fontFamily: "sans-serif",
		fontSize: 24,
		fontWeight: 400,
		italic: false,
		color: "#000000",
		letterSpacing: 0,
		decoration: "none",
		transform: "none",
		...overrides,
	};
}

function root(
	paragraphs: TextContent["root"]["children"][0]["children"],
): TextContent {
	return {
		root: { children: [{ children: paragraphs }] },
		growType: "autoWidth",
		verticalAlign: "top",
		halo: null,
	};
}

function toContainer(nodes: FakeElement[]): FakeElement {
	const el = new FakeElement("div");
	for (const node of nodes) el.appendChild(node);
	return el;
}

// 1. Single run round-trips exactly (the case every existing consumer of
//    this model — 002, 003 — already relies on).
{
	const content = root([
		{
			align: "center",
			lineHeight: 1.2,
			children: [{ text: "Hello", style: styleOf() }],
		},
	]);
	const nodes = textContentToNodes(content, 1) as unknown as FakeElement[];
	const back = domToTextContent(toContainer(nodes) as never, content, 1);
	ok(
		"single run text round-trips",
		back.root.children[0].children[0].children[0].text === "Hello",
	);
	ok(
		"single run align round-trips",
		back.root.children[0].children[0].align === "center",
	);
}

// 2. Multiple runs with different styles round-trip as distinct runs —
//    the plan's own acceptance criterion: "selecting three words and
//    setting weight 700 produces three runs... a re-open shows the same
//    three runs."
{
	const content = root([
		{
			align: "left",
			lineHeight: 1.2,
			children: [
				{ text: "Click ", style: styleOf({ fontWeight: 400 }) },
				{ text: "Save", style: styleOf({ fontWeight: 700 }) },
				{ text: " to continue", style: styleOf({ fontWeight: 400 }) },
			],
		},
	]);
	const nodes = textContentToNodes(content, 1) as unknown as FakeElement[];
	const back = domToTextContent(toContainer(nodes) as never, content, 1);
	const runs = back.root.children[0].children[0].children;
	ok("three runs survive", runs.length === 3, `got ${runs.length}`);
	ok(
		"run text survives in order",
		runs.map((r) => r.text).join("") === "Click Save to continue",
	);
	ok(
		"the bold run is exactly 'Save'",
		runs[1]?.text === "Save" && runs[1]?.style.fontWeight === 700,
	);
}

// 3. Font size and letter spacing round-trip through a non-1 anchor scale —
//    the same conversion `space.ts`'s `fontSizeToFramePx` applies live.
{
	const content = root([
		{
			align: "left",
			lineHeight: 1.2,
			children: [
				{ text: "Big", style: styleOf({ fontSize: 48, letterSpacing: 2 }) },
			],
		},
	]);
	const scale = 1.5;
	const nodes = textContentToNodes(content, scale) as unknown as FakeElement[];
	const span = nodes[0].childNodes[0] as FakeElement;
	ok(
		"font size is scaled in the DOM",
		span.style.fontSize === `${48 * scale}px`,
		span.style.fontSize,
	);
	const back = domToTextContent(toContainer(nodes) as never, content, scale);
	const style = back.root.children[0].children[0].children[0].style;
	ok(
		"font size unscales back to the original",
		Math.abs(style.fontSize - 48) < 0.01,
	);
	ok(
		"letter spacing unscales back to the original",
		Math.abs(style.letterSpacing - 2) < 0.01,
	);
}

// 4. An empty paragraph is dropped, not written back as a zero-run paragraph.
{
	const content = root([
		{
			align: "left",
			lineHeight: 1.2,
			children: [{ text: "Real", style: styleOf() }],
		},
	]);
	const container = toContainer(
		textContentToNodes(content, 1) as unknown as FakeElement[],
	);
	// Simulate the user selecting all of a second, now-empty paragraph and
	// deleting it down to just its `<br>` placeholder.
	const emptyP = new FakeElement("p");
	emptyP.appendChild(new FakeElement("br"));
	container.appendChild(emptyP);

	const back = domToTextContent(container as never, content, 1);
	ok("empty paragraph is dropped", back.root.children[0].children.length === 1);
}

// 5. Malformed DOM — a stray, unrecognised element — collapses to a run
//    rather than being rejected or crashing `from_dom`.
{
	const content = root([
		{
			align: "left",
			lineHeight: 1.2,
			children: [{ text: "Base", style: styleOf() }],
		},
	]);
	const container = new FakeElement("div");
	const weird = new FakeElement("marquee"); // an element from_dom has never seen
	weird.textContent = "surprise";
	container.appendChild(weird);

	const back = domToTextContent(container as never, content, 1);
	ok(
		"unrecognised element collapses to a run rather than being dropped",
		back.root.children[0].children.some((p) =>
			p.children.some((r) => r.text.includes("surprise")),
		),
	);
}

// 6. Nothing recognisable at all → `previous` is returned unchanged, not an
//    empty tree overwriting real content.
{
	const content = root([
		{
			align: "left",
			lineHeight: 1.2,
			children: [{ text: "Keep me", style: styleOf() }],
		},
	]);
	const empty = new FakeElement("div");
	const back = domToTextContent(empty as never, content, 1);
	ok("a wiped-out DOM keeps the previous content", back === content);
}

// 7. Adjacent runs with identical style merge into one — a browser
//    frequently splits one logical run into several `<span>`s for no
//    visible reason; the model should not carry that noise forward.
{
	const container = new FakeElement("div");
	const p = new FakeElement("p");
	const a = new FakeElement("span");
	a.textContent = "Hel";
	applyBaseline(a);
	const b = new FakeElement("span");
	b.textContent = "lo";
	applyBaseline(b);
	p.appendChild(a);
	p.appendChild(b);
	container.appendChild(p);

	function applyBaseline(el: FakeElement) {
		el.style.fontFamily = "sans-serif";
		el.style.fontSize = "24px";
		el.style.fontWeight = "400";
		el.style.fontStyle = "normal";
		el.style.color = "#000000";
	}

	const content = root([
		{
			align: "left",
			lineHeight: 1.2,
			children: [{ text: "placeholder", style: styleOf() }],
		},
	]);
	const back = domToTextContent(container as never, content, 1);
	const runs = back.root.children[0].children[0].children;
	ok(
		"identically-styled adjacent spans merge",
		runs.length === 1,
		`got ${runs.length}`,
	);
	ok("merged text is correct", runs[0]?.text === "Hello");
}

// A newly created text object: one run, empty text. This shipped broken —
// the empty run became a lone empty `<span>`, which generates no line box, so
// the object was a zero-height sliver with the caret outside the span and the
// first keystroke landing unstyled. The `<br>` is what gives the caret a line
// to sit on, and it is the same treatment a paragraph with no runs at all
// gets.
{
	const content = root([
		{
			align: "left",
			lineHeight: 1.2,
			children: [{ text: "", style: styleOf() }],
		},
	]);
	const nodes = textContentToNodes(content, 1);
	ok("an empty object still produces one paragraph", nodes.length === 1);

	const paragraph = nodes[0] as unknown as {
		childNodes: Array<{ tagName?: string }>;
	};
	const tags = paragraph.childNodes.map((node) => node.tagName);
	ok(
		"an all-empty paragraph carries a <br>, not a bare empty <span>",
		tags.includes("BR"),
		`got [${tags.join(", ")}]`,
	);
	ok(
		"and nothing else, so there is no empty span to strand the caret in",
		tags.length === 1,
		`got [${tags.join(", ")}]`,
	);
}

if (failures > 0) throw new Error(`${failures} dom-roundtrip check(s) failed`);
console.log(`ALL PASS (${passes} assertions)`);
