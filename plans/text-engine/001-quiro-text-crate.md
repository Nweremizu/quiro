# 001 — `quiro-text`: one layout engine, no consumers

**Severity:** HIGH · **Status:** TODO · **Depends on:** 000 · **Blocks:** 002, 003, 004

## Problem

`TextContent` exists after 000 but nothing interprets it. Layout today is
inline in the render pass, which is why it cannot be reused and why the frontend
had to grow a second implementation.

```rust
// layers/text.rs:44 — TextLayer::prepare, called every frame
self.buffers.clear();
for text in texts {
    let metrics = Metrics::new(text.font_size, text.font_size * 1.2);
    let mut buffer = Buffer::new(&mut self.font_system, metrics);
    buffer.set_size(&mut self.font_system, Some(wrap_width), None);
    …
}
```

Two problems in one place. Layout is entangled with painting, so a third caller
(a measurement command, headless export) cannot reach it without a GPU. And
every `Buffer` is rebuilt **on every frame**, so unchanged text is re-shaped
sixty times a second.

## Change

A new crate holding layout and nothing else.

```
packages/crates/text/            → quiro-text
  deps: quiro-project, cosmic-text, fontdb        (no wgpu, no glyphon)
```

`packages/crates/*` is already a workspace glob, so the directory is enough.

### The one entry point

```rust
pub struct Constraint {
    /// Anchor height in output px; font sizes are px@1080 of this.
    pub anchor_height: f32,
    /// Box width in output px. Ignored for AutoWidth.
    pub width: f32,
    /// Box height in output px. Ignored unless Fixed.
    pub height: f32,
}

pub struct TextLayout {
    pub fragments: Vec<Fragment>,
    pub buffers: Vec<Buffer>,   // one per paragraph, in order
    pub width: f32,
    pub height: f32,
}

pub fn layout_text(content: &TextContent, c: Constraint) -> TextLayout;
```

It returns **both** fragments and the cosmic-text buffers. Returning only
fragments would force `TextLayer` to re-shape in order to hand glyphon something
to draw, which is the two-authorities bug in a new costume.

### One buffer per paragraph

`Metrics` is set on the `Buffer`, not the line — `BufferLine` has `align()` but
no metrics override — so per-paragraph `line_height` requires per-paragraph
buffers. Vertical stacking and vertical alignment therefore belong to this crate.

```rust
let mut y = vertical_align_offset(c.height, total_height, content.vertical_align);
for paragraph in paragraphs {
    let metrics = Metrics::new(px(run.font_size), px(run.font_size) * paragraph.line_height);
    let mut buffer = Buffer::new(&mut font_system, metrics);

    match content.grow_type {
        GrowType::AutoWidth  => buffer.set_size(&mut fs, None,            None),
        GrowType::AutoHeight => buffer.set_size(&mut fs, Some(c.width),   None),
        GrowType::Fixed      => buffer.set_size(&mut fs, Some(c.width),   Some(c.height)),
    }

    buffer.set_rich_text(&mut fs, spans_from(paragraph), &default_attrs, Shaping::Advanced, None);
    buffer.lines[0].set_align(Some(paragraph.align.into()));
    buffer.shape_until_scroll(&mut fs, false);
    y += buffer_height(&buffer);
}
```

**`AutoWidth` is one pass here, not two.** cosmic-text treats a `None` width as
shrink-to-fit rather than infinite: `shape.rs:1456` sets
`line_width = max(visual_line.w)` when no width is given, so alignment is
computed against the natural block width and comes out correct on the first
attempt. Penpot needs two passes only because Skia aligns against `f32::MAX`.

### Fragments

One per contiguous same-style piece of a visual line — the intersection of a
laid-out line with a style run. This is what SVG `<text>` and `ctx.fillText`
both consume, and 003 is built on it.

```rust
pub struct Fragment {
    pub paragraph: u32,
    pub run: u32,
    pub x: f32,
    /// BASELINE, not top. Matches LayoutRun::line_y and SVG's
    /// dominant-baseline, which is what svg_text.tsx already assumes.
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub rtl: bool,
    pub text: String,
    pub font_face: FaceId,        // resolved; 003 ships the bytes for it
    pub font_size: f32,           // output px
    pub font_weight: u16,
    pub italic: bool,
    pub color: String,
    pub decoration: TextDecoration,
}
```

`LayoutRun` already carries `line_i`, `text`, `rtl`, `glyphs`, `line_y`,
`line_top`, `line_height` and `line_w`, and `LayoutRun::highlight(start, end)`
returns `(x_left, x_width)` for any cursor range — so a run's box inside a line
is a direct call, not a glyph walk.

**RTL is free and must not be dropped.** cosmic-text runs bidi regardless of
whether a direction control exists in the UI, and `rtl` is per fragment.
Carrying it costs a bool and lets 003's painter anchor RTL fragments at
`x + width`.

### Caching

`layout_text` is pure. The crate holds a small memo keyed by a hash of
`(content, constraint, font-set revision)`, which is what stops 002
re-shaping every frame. The font-set revision is bumped whenever the `fontdb`
contents change, so a newly available family invalidates cleanly.

No `content_version` / `layout_version` fields on the model. Penpot carries that
machinery because it re-lays out large documents during paint; these texts are
labels and titles measured on commit.

### Font resolution

`new_font_system()` in `rendering/src/layers/mod.rs:24` moves here unchanged,
generic-family pinning and all. 003 replaces the pinning with something stronger;
until then it is still the mechanism that keeps the webview and cosmic-text
agreeing, and the test asserting generic families resolve to real faces moves
with it.

## Files

- `packages/crates/text/Cargo.toml`, `src/lib.rs`, `src/layout.rs`,
  `src/fragment.rs`, `src/fonts.rs`
- `packages/crates/rendering/src/layers/mod.rs` — `new_font_system` moves out;
  re-export from `quiro-text` so 002 is a small diff
- `Cargo.toml` — `cosmic-text = "0.14"` in `[workspace.dependencies]`, pinned to
  the version glyphon 0.9 links

## Acceptance

- `cargo test -p quiro-text` passes with **no GPU and no wgpu in the graph**:
  `cargo tree -p quiro-text | grep -c wgpu` is 0.
- `cargo tree -d | grep cosmic-text` returns one line. Add it to CI — two
  versions compile fine and then fail to hand a `Buffer` across a crate
  boundary.
- Snapshot tests built from **real migrated cases from both hosts**, not
  invented ones: a migrated `TextSegment` (centred, 48px, weight 700) and a
  migrated annotation (auto-width, single run). The API has no callers in this
  plan, so the tests are the only thing pushing back on its shape.
- Wrapping snapshots: a string that fits, one that wraps to two lines, one with
  an explicit `\n`, and one whose only break opportunity is past the box.
- `AutoWidth` with `align: Center` produces fragments centred on the block's own
  width, not on some larger box — the property Penpot needs two passes for.
- Measuring the same content twice returns the cached layout: assert on a hit
  counter, not on wall time.

## Risks

- **cosmic-text version drift.** glyphon 0.9 pins 0.14.2. If glyphon updates and
  this crate does not, `Buffer` becomes two incompatible types with one name and
  the error message will not say so. The `cargo tree -d` check is the guard.
- **Vertical stacking is now this crate's job** and there is no renderer to
  eyeball it against until 002. The `vertical_align` × `grow_type` matrix is
  nine cases; snapshot all nine.
- **Designing an API with no caller.** Mitigated by sourcing every test case from
  a real migrated project, but 002 and 003 should be allowed to change the
  signature rather than work around it.
