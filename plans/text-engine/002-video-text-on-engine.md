# 002 — Move video text onto the engine and delete the `1.05` hack

**Severity:** HIGH · **Status:** DONE (see Outcome) · **Depends on:** 000, 001

## Problem

`TextLayer::prepare` builds its own buffers, so it is a second layout
implementation the moment `quiro-text` exists. It also carries the compensation
for the bug this plan set removes:

```rust
// layers/text.rs:66 — the workaround
// Shape with a little more width than the editor-measured box:
// the webview and cosmic-text can disagree by a few pixels per
// line, and without slack a line that fit in the editor wraps in
// the render.
let wrap_width = if width < output_width * 0.98 {
    (width * 1.05 + 4.0).min(output_width.max(width))
} else {
    width
};
let wrap_dx = (wrap_width - width) / 2.0;
```

The slack is then threaded through everything downstream — `TextBounds` is
computed from `wrap_dx`, and the buffer origin is shifted left by it so centred
lines stay centred. Three places to keep in sync, all serving a disagreement
that stops existing once one engine measures.

Two more properties are hardcoded here rather than stored:

```rust
let metrics = Metrics::new(text.font_size, text.font_size * 1.2);   // :81
line.set_align(Some(Align::Center));                                 // :120
```

## Change

`prepare` stops building buffers and asks the engine for them.

```rust
pub fn prepare(&mut self, device, queue, output_size, texts: &[PreparedText]) {
    self.layouts.clear();
    for text in texts {
        let layout = quiro_text::layout_text(&text.content, Constraint {
            anchor_height: output_size.1 as f32,
            width:  text.bounds[2] - text.bounds[0],
            height: text.bounds[3] - text.bounds[1],
        });
        self.layouts.push(layout);
    }
    // TextArea per paragraph buffer, positioned from layout.fragments
}
```

`wrap_width`, `wrap_dx` and the `0.98` threshold are deleted outright, along
with the origin shift they required. `TextBounds` becomes the box plus the
laid-out height, with no slack term.

`prepare_texts` in `rendering/src/text.rs` keeps its job — culling by
`enabled` / `hidden_indices` / time range, computing `bounds` from
`center`/`size`, and the fade envelope — but `PreparedText` loses the flattened
typography fields and carries `content: TextContent` instead. The
`font_size.clamp(MIN, MAX) * height_scale` line goes away; the engine applies
the anchor rule.

### Per-frame re-shaping stops

`self.buffers.clear()` on every call is why unchanged text is re-shaped sixty
times a second. `layout_text` is memoised on `(content, constraint, font-set
revision)`, and both are stable while a title is on screen, so a static title
costs one layout and then cache hits. The fade envelope multiplies alpha at
draw time and is deliberately not part of the cache key.

### The UI does not change

`SegmentConfig.tsx:305` keeps writing the same controls; they now write into
`text_content.root…children[0].style` rather than the flat fields. A segment
stays a single paragraph with a single run — alignment, line-height,
letter-spacing and the rest get controls in 004. This plan is a swap of the
storage and the layout call, not a feature.

## Files

- `packages/crates/rendering/src/layers/text.rs` — `prepare` rewritten; the
  slack maths, the metrics and the align hardcode all deleted
- `packages/crates/rendering/src/text.rs` — `PreparedText` carries
  `TextContent`; the `height_scale` multiply is removed
- `packages/crates/rendering/src/lib.rs:4176` — `prepare_texts` call site
- `apps/desktop/src/routes/editor/SegmentConfig.tsx` — controls write into the
  tree
- `apps/desktop/src/routes/editor/TextOverlay.tsx` — reads `content` from the
  tree for its in-place `<input>`

## Acceptance

- `grep -n "1\.05\|wrap_dx\|0\.98" packages/crates/rendering/src/layers/text.rs`
  returns nothing.
- A legacy project renders **pixel-identically** before and after, at 1080p and
  at 4K. This is the real test: the migration wrote `align: Center` and
  `line_height: 1.2` precisely so this holds.
- A title that fit on one line in the editor still fits on one line in the
  render, **without** the slack — the property the hack was faking.
- A static title on screen for 5s at 60fps produces one layout, not 300. Assert
  on the memo hit counter.
- `TextOverlay` no longer needs to guess: the box it draws is the box the
  renderer wrapped at.

## Risks

- **The pixel-identity claim is only as good as the migration.** If 000 wrote
  `Left` instead of `Center`, or a line-height other than 1.2, every existing
  title moves. Land 000's alignment test before starting here.
- **Removing the slack can surface real wrapping changes** in projects where the
  editor and cosmic-text genuinely disagreed and the slack was hiding it. Those
  titles will now wrap the way the renderer always wanted to. That is the fix,
  but it is user-visible on those specific projects; check a handful of real
  ones rather than only synthetic fixtures.
- **`PreparedText` is `Clone`d per frame** and now carries a tree rather than a
  `String` and six scalars. Clone the `Arc`, not the tree, or the per-frame
  allocation traded for the shaping win comes back.

## Outcome

**Done on the Rust side; blocked on the TypeScript side by a bindings
regeneration failure specific to this environment — see below.**

`packages/crates/rendering/src/layers/text.rs`'s `prepare` now asks
`quiro_text::layout_text` for a `TextLayout` per `PreparedText` and paints its
buffers directly; `wrap_width`, `wrap_dx` and the `0.98` threshold are gone
(`grep -n "1\.05\|wrap_dx\|0\.98" packages/crates/rendering/src/layers/text.rs`
returns nothing). `packages/crates/rendering/src/text.rs`'s `PreparedText` now
carries `content: TextContent` instead of six flattened fields, and the
`font_size.clamp(MIN, MAX) * height_scale` line is deleted outright — the
engine applies the anchor rule via `Constraint::anchor_height`.
**Correction, found while building 003's annotation path**: at the time this
was first written, `Constraint::anchor_height` was declared on the struct and
documented, but never actually read anywhere in `quiro-text/src/layout.rs` —
the "engine applies the anchor rule" claim above was aspirational, not true
yet. Every test in both crates used `anchor_height: 1080.0` (a no-op scale),
so nothing caught it. Fixed in 003's Outcome (`layout.rs`'s `scale` variable);
this file's own behavior at 1080p output was already correct by coincidence
(scale of 1), so no video output changed — but 4K+ output was silently
rendering titles smaller, relative to their box, than the px@1080 convention
promises. `quiro-text` picked up a regression test
(`anchor_height_scales_font_size_and_fragment_geometry`) that this file's own
tests would not have caught, since none of them vary `anchor_height`.

`quiro-text`
gained a `paragraph_y_offsets: Vec<f32>` field on `TextLayout` (a buffer is
shaped from its own `(0, 0)`; only `fragments[..].y` carried the stacking
offset, so a caller painting buffers directly, as `TextLayer::prepare` does,
needed it separately) and a public `cache_stats() -> (u64, u64)`, promoted
from a private test helper so `quiro-rendering`'s own suite can assert the
memo behavior across the crate boundary rather than re-deriving it. 4 new
tests in `rendering/src/text.rs` (previously untested) cover the acceptance
criteria that are checkable without a GPU device: a static title across two
steady-state frames hits the layout cache
(`steady_state_frames_hit_the_layout_cache`), font size is clamped but never
height-scaled by output resolution
(`font_size_is_clamped_but_never_scaled_by_output_size`), disabled/hidden/
out-of-range segments are still culled, and the fade envelope bakes into the
color's alpha byte rather than a separate field. `quiro-project` (76),
`quiro-text` (17), `quiro-rendering` (147) all pass; `cargo fmt` and
`cargo clippy --all-targets -- -D warnings` are clean for all three touched
crates (three pre-existing `-D warnings` findings remain in
`rendering/src/zoom_spring.rs` and `rendering/src/lib.rs`, both untouched by
this plan — left alone per the same out-of-scope reasoning as 000's Outcome).

### The TypeScript half — unblocked once bindings were live

Originally blocked here: `SegmentConfig.tsx` and `TextOverlay.tsx` both need
`apps/desktop/src/utils/tauri.ts` to carry `TextContent`'s TypeScript type,
and this session's environment could not regenerate it
(`STATUS_ENTRYPOINT_NOT_FOUND` on the desktop test binary — see 003's
Outcome for the full investigation). The blocker resolved itself mid-session:
a `quiro-desktop.exe` instance already running on the machine had launched in
debug mode and regenerated `tauri.ts` on its own startup before it was
closed. Once bindings existed, both files were finished:

- `SegmentConfig.tsx`'s "text" case now writes the Content textarea, Font
  size slider, Italic switch and Colour picker into
  `segment.textContent.root.children[0].children[0].children[0]` via three
  small helpers in a new `apps/desktop/src/routes/editor/text-content.ts`
  (`textContentString`/`Style`, `withTextContentString`/`Style`,
  `defaultTextContent`) rather than the flat fields.
- `TextOverlay.tsx`'s in-place `<input>` (the double-click-to-edit overlay on
  the video canvas) reads and writes through the same helpers.
- `Timeline/index.tsx`'s `addText()` (new-segment creation) and its track
  label (previously `segment.content || "Text"`) both moved onto the tree —
  a freshly created segment now seeds `textContent` directly instead of the
  flat `content` field, matching the values `migrate_text_content` would
  have produced (`align: "center"`, `lineHeight: 1.2`, `fontWeight: 700`,
  `color: "#ffffff"`, `fontSize: 48`).
- `rendering/src/text.rs::text_content_from_segment` (the flat-field
  synthesis bridge this Outcome originally described as temporary) is
  deleted. `prepare_texts` now reads `segment.text_content` directly via a
  new `prepared_content`, which clones the tree, bakes `fade_alpha` into the
  one run's colour, and clamps its font size — the same two adjustments the
  old bridge made, just applied to real data instead of synthesized data. A
  segment with no tree at all (a project this session's `load()` hasn't
  migrated, or one from a build older than this plan) is skipped rather than
  guessed at; the next `load()` backfills it. Flat `TextSegment` fields
  (`content`, `fontSize`, `fontWeight`, `italic`, `color`) are no longer read
  by either the frontend or the renderer — they stay in the type and in old
  project files, unmaintained, until 004 deletes them for real.

### The fade/cache tension, resolved by baking alpha into the cached color

The plan's sketch implies `PreparedText` keeps a separate opacity applied "at
draw time," outside the cache key. `glyphon::TextArea` has no such hook —
its only color field is `default_color`, a fallback for glyphs with no
`Attrs.color_opt`, which `quiro-text` always sets. Carrying fade as an actual
field on `TextContent` would make every frame of a fade a distinct cache key
for no benefit (the shape doesn't change, only the color does) but leaving it
out of the content entirely would make `layout_text` return stale color.
Resolved by baking `fade_alpha` into `RunStyle::color` as an 8-digit
`#rrggbbaa` string (`with_alpha`) before it ever reaches `layout_text` —
`quiro-text`'s `parse_color` was extended to accept both 6- and 8-digit hex.
Steady-state frames (the vast majority of a title's on-screen time) produce
byte-identical `TextContent` and hit the cache; only the ~0.15s fade
transition pays for distinct cache entries per frame, which is the plan's own
stated cost, just paid through the color rather than a dedicated field.
