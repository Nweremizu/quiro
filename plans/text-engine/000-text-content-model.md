# 000 — One `TextContent` model for annotations and text segments

**Severity:** HIGH · **Status:** TODO · **Blocks:** 001, 002, 003, 004

## Problem

There are three text paths and no shared model between them.

| | Screenshot annotation | Video text segment | Captions |
| --- | --- | --- | --- |
| Model | `Annotation { text: Option<String> }` | `TextSegment { content, font_family, font_size, font_weight, italic, color }` | its own |
| Typography | none — `height` **is** the font size | family, size, weight, italic | its own |
| Wrapping | none | cosmic-text `Wrap::Word` | cosmic-text |
| Drawn by | the frontend, **three times** | the Rust renderer | the Rust renderer |

The annotation path has no typography at all. `AnnotationConfig.tsx:317` offers
exactly one text control — a "Size" slider that writes `annotation.height` —
and the renderer never sees the text:

```tsx
// AnnotationLayer.tsx:1108 — on screen
<text fontSize={`${annotation.height}px`} fontFamily="sans-serif" …>

// screenshotExport.ts:517 — at export, a second implementation
ctx.font = `${ann.height}px sans-serif`;
ctx.fillText(ann.text, ann.x, ann.y + ann.height);
```

### The defect this exists to remove

`TextSegment` is measured in the editor webview and laid out again by
cosmic-text, and the two disagree. The renderer compensates by shaping wider
than the box it was given (`rendering/src/layers/text.rs:75`):

```rust
// the webview and cosmic-text can disagree by a few pixels per
// line, and without slack a line that fit in the editor wraps in
// the render
let wrap_width = if width < output_width * 0.98 {
    (width * 1.05 + 4.0).min(output_width.max(width))
} else {
    width
};
```

Two engines measuring one string is the root cause. Everything else in this
plan set follows from making cosmic-text the only one.

### What is missing from both

No alignment (`layers/text.rs:120` hardcodes `Align::Center` for every line, and
no property exists), no line-height (`layers/text.rs:81` hardcodes
`font_size * 1.2`), no letter-spacing, no decoration, no text-transform, no
mixed styling within one text, and no outline — which is the most common reason
annotation text is unreadable over a screenshot.

## Change

One `TextContent` in `quiro-project`, embedded by both hosts. Four levels, matching
the Penpot model: root → paragraph set → paragraph → run.

```rust
#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextContent {
    pub root: TextRoot,
    pub grow_type: GrowType,
    pub vertical_align: VerticalAlign,
    #[serde(default)]
    pub halo: Option<TextHalo>,
}

pub struct TextRoot { pub children: Vec<ParagraphSet> }   // min 1
pub struct ParagraphSet { pub children: Vec<Paragraph> }  // min 1

pub struct Paragraph {
    pub align: TextAlign,        // Left | Center | Right | Justify
    pub line_height: f32,        // multiplier
    pub children: Vec<TextRun>,  // min 1
}

pub struct TextRun {
    pub text: String,
    pub style: RunStyle,
}

pub struct RunStyle {
    pub font_family: String,
    /// px as if the anchor were 1080 tall. See "Font size units".
    pub font_size: f32,
    pub font_weight: u16,
    pub italic: bool,
    pub color: String,
    pub letter_spacing: f32,
    pub decoration: TextDecoration,  // None | Underline | LineThrough
    pub transform: TextTransform,    // None | Upper | Lower | Title
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum GrowType {
    /// Width and height from content; no wrapping.
    AutoWidth,
    /// Width from the box, height from content.
    #[default]
    AutoHeight,
    /// Both from the box; content clips.
    Fixed,
}

pub struct TextHalo { pub width: f32, pub color: String }
```

`Paragraph::default().align` is `Left` and `line_height` is `1.2`, which
reproduces the hardcoded `Metrics::new(font_size, font_size * 1.2)`.

### Font size units

One rule, reusing the `AnnotationAnchor` concept already in this file:

```
px_out = font_size * (anchor_height_px / 1080)
```

The anchor is `Capture` for annotations, so their text scales with the
screenshot, and the frame for text segments, so theirs scales with the output.
This is exactly what `TextSegment` already does — `rendering/src/text.rs:8`
scales `font_size` by `output_size.y / REFERENCE_HEIGHT` — so segments need no
conversion at all.

### Attachment

Both hosts embed it and keep their own geometry, anchor and timing.

```rust
pub struct Annotation {
    …,
    #[serde(default)]
    pub text_content: Option<TextContent>,
}

pub struct TextSegment {
    …,
    #[serde(default)]
    pub text_content: Option<TextContent>,   // Some after migration
}
```

`Annotation::validate` gains one arm in the existing mutual-exclusion block:
`text_content` must be `Some` when `annotation_type == Text` and `None`
otherwise, the same shape as the `Mask` and `Focus` arms.

### Migration

A fourth version field beside `text_size_version`, `annotation_space_version`
and `mask_model_version`:

```rust
pub const TEXT_MODEL_VERSION: u32 = 1;

#[serde(default)]
pub text_model_version: u32,
```

**v0 → v1 is pure** — no measurement, no capture dimensions, no frame-layout
maths. That is why it can live in `configuration.rs` rather than in
`annotation_space::migrate` where the geometry migration had to go.

Annotations of type `Text`:

| From | To |
| --- | --- |
| `text: Some(s)` | one paragraph, one run, `text: s` |
| `height` (a fraction of anchor height) | `font_size = height * 1080.0` |
| `stroke_color` | `run.style.color` |
| — | `grow_type: AutoWidth` (reproduces `white-space: nowrap`) |
| — | `align: Left` (single-line text was never aligned) |

Text segments:

| From | To |
| --- | --- |
| `content` | one paragraph, one run |
| `font_family`, `font_size`, `font_weight`, `italic`, `color` | `run.style.*`, **unchanged** — already px@1080 |
| — | `grow_type: AutoHeight` (the box has always been a wrap constraint) |
| — | **`align: Center`** — see below |
| — | `line_height: 1.2` |

**The alignment trap.** Every existing video title is centred only because
`layers/text.rs:120` hardcodes it. The model default is `Left`, which is what a
text box should do; the migration therefore writes `Center` explicitly onto
every legacy segment so nothing moves when an existing project is opened.

### Legacy fields are retained, not deleted

`Annotation.text` and `TextSegment.content` stay on the struct through 003.
Nothing reads `text_content` until 002, so this plan is a pure addition and a
build carrying it can be downgraded. They are deleted in a cleanup after 004.

## Files

- `packages/crates/project/src/configuration.rs` — the types above, the
  `text_content` fields, the `validate` arm, `text_model_version` and
  `migrate_text_model`.
- `apps/desktop/src/utils/tauri.ts` — regenerated bindings, committed alongside.

## Acceptance

- A project at `textModelVersion: 0` loads, migrates, and a second load does not
  re-migrate. Same test shape as `migrate_mask_model`.
- A migrated `TextSegment` has `align: Center`; `Paragraph::default()` has
  `align: Left`.
- An annotation with `height: 0.042` migrates to `font_size: 45.36`.
- `grep -rn "text_content" packages/crates/rendering` returns nothing — no
  consumer exists yet.
- `Annotation::validate` rejects a `Text` annotation with `text_content: None`
  and a `Rectangle` with `text_content: Some(_)`.

## Risks

- **`ParagraphSet` carries nothing.** It is in the model for parity with
  Penpot, where it is equally inert — the schema forbids styles on it and a
  migration exists to strip fills off it. Every document will have exactly one.
  Worth revisiting before 004 hardens the DOM round-trip around it.
- **`Annotation` reaches sixteen optional type-specific fields.** The flat
  struct plus hand-written `validate()` is at its limit; a tagged
  `AnnotationKind` enum is the real fix and is deliberately out of scope here.
- **Box height drifts on first measure.** A migrated annotation keeps its old
  `height` (the font size as a fraction) until something measures it, at which
  point the box becomes the real text height, roughly 1.2× larger. Invisible,
  because the hit region is glyph-accurate and the box is never drawn.
