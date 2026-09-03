# 002 — Move video text onto the engine and delete the `1.05` hack

**Severity:** HIGH · **Status:** TODO · **Depends on:** 000, 001

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
