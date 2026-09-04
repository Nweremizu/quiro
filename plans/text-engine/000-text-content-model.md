# 000 — One `TextContent` model for annotations and text segments

**Severity:** HIGH · **Status:** DONE (see Outcome) · **Blocks:** 001, 002, 003, 004

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

## Outcome

Done, with one real correction to the migration design and a few smaller
deviations. All in `packages/crates/project/src/configuration.rs`; no other
file touched. `cargo check`, `cargo test -p quiro-project` (76/76, 8 new),
`cargo fmt` and `cargo clippy -p quiro-project --all-targets -- -D warnings`
are all clean.

### The annotation migration is not pure after all

The plan's sketch assumed a single `text_model_version`, migrated inside
`load()` for both hosts, with `font_size = old_normalized_height * 1080.0`.
That assumed `annotation.height` already meant "fraction of the capture's
content height" at that point. It does not: `annotation_space_version`
normalizes `height` from raw frame pixels, and that migration is deliberately
**not** part of `load()` — it needs `capture_size`, which `load()` never has
(`migrate_annotation_space`'s own doc comment: *"Not part of `Self::load`,
which has no way to know the capture dimensions"*). A version-0 file's
`height` is still raw pixels at the exact point a load()-time text migration
would have read it, so `font_size = height * 1080.0` would have produced
garbage for any file not yet through the screenshot editor at least once
since annotation-space migration shipped.

Fixed by **not** giving annotations their own `text_model_version`. Instead:

- `TextSegment` keeps the plan's shape exactly: a new `text_content_version`
  field (not `text_model_version` — named to stay clear of the unrelated,
  already-existing `text_size_version`), migrated purely inside `load()`,
  since `TextSegment::font_size` has no such dependency.
- `Annotation` gets its conversion as a **third step inside
  `migrate_annotation_space`**, gated by bumping `ANNOTATION_SPACE_VERSION`
  from 2 to 3 — the same pattern that function already uses for the mask-unit
  conversion (`from_version < 2`, added when *that* turned out to need the
  frame height too). The new `from_version < 3` step runs after the
  `from_version < 1` geometry step in the same loop iteration, so
  `annotation.height` is already normalized by the time it reads it,
  regardless of which version the file started at.

This is the second time this exact function has grown a step for a
"the units aren't what they look like until geometry migration has run"
reason. Worth remembering if a third one shows up: `migrate_annotation_space`
may be the right home more often than not.

### `validate()` had to be more tolerant than the plan sketch

The plan said `text_content` must be `Some` for a `Text` annotation. A hard
version of that check breaks `load()` for every file that has not yet been
through `migrate_annotation_space` — since `load()` calls `validate()`
*before* the caller gets a chance to run that migration, every existing
project with a text annotation would fail to load entirely. Relaxed to: a
`Text` annotation is valid with `text_content.is_some() || text.is_some()` —
the same tolerance `migrate_mask_model` already extends to a mask amount
that's still in pre-migration units. `text_content` present on a non-`Text`
annotation is still a hard error; that check has no such ordering problem.

### Smaller deviations from the sketch

- **`RunStyle::font_weight` is `f32`, not `u16`.** `TextSegment::font_weight`
  is already `f32`; keeping the model's type identical makes the segment
  migration a lossless move instead of a lossy round-and-clamp. The clamp to
  cosmic-text's `Weight(u16)` belongs to `quiro-text` (001), which is the
  thing that actually needs that type.
- **A second 1080.0 constant, not a shared one.** Added `TEXT_REFERENCE_HEIGHT`
  next to the existing `MASK_AMOUNT_BASE_HEIGHT` rather than reusing it — same
  value, same convention, but reusing a mask-named constant for a font-size
  conversion would have needed a comment to justify the name every time it was
  read.
- **Two pre-existing `clippy::neg_cmp_op_on_partial_ord` findings**, in the
  `migrate_annotation_space` size guard, surfaced by running clippy on this
  file for the first time in this session. Fixed in place with an exact,
  NaN-preserving rewrite (`!(x > 0.0)` → `x.is_nan() || x <= 0.0`) rather than
  left for later, since CI runs `cargo clippy --workspace --all-targets -- -D
  warnings` and the fix was two lines in a function already being edited.

### Not done

- **`apps/desktop/src/utils/tauri.ts` is not regenerated.** Specta bindings
  regenerate on a debug desktop run, which this session could not start
  (`pnpm dev:desktop` is off-limits here). `Annotation` and `TextSegment`'s TS
  types are stale by one field each until the next `pnpm dev:desktop`; nothing
  currently reads either field, so no runtime behavior depends on this.
- **The `AnnotationAnchor` reference in `annotation_space_version`'s existing
  doc comment is dangling** — no such type exists in this crate; it appears to
  describe `plans/screenshot-editor/002` (per-annotation anchor selection),
  which is still TODO. Not touched: pre-existing, unrelated to this plan, and
  today every annotation has exactly one implicit anchor (the capture's
  content rect), which is what the new font-size conversion assumes.
