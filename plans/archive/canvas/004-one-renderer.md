# 004 — Draw annotations in the compositor, not in the webview

- **Status**: TODO
- **Severity**: CRITICAL
- **Category**: Architecture / correctness
- **Estimated scope**: new `layers/annotation.rs` + shader work; deletes ~300
  lines of TS drawing code
- **Depends on**: 003

## Problem

`packages/crates/project/src/configuration.rs:1582`, on the arrow fields:

> the renderer never draws annotations

Confirmed by search: `grep -rn "annotation" packages/crates/rendering/src/`
returns **nothing**. So a single screenshot composition is currently drawn by
three separate renderers:

1. **wgpu** (`rendering` crate) — background, image, padding, rounding,
   shadow, blur, DOF. The "canvas".
2. **SVG** (`AnnotationLayer.tsx`) — annotations, in the live preview.
3. **Canvas2D** (`screenshotExport.ts`) — annotations again, independently
   reimplemented, for export:

```ts
ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
```

Three consequences, in ascending severity:

**Divergence is already happening.** `layers/mod.rs` carries a comment written
by someone who has been bitten by exactly this:

> fontdb's stock defaults (e.g. "Arial") often don't match any installed face,
> in which case cosmic-text silently shapes with an arbitrary fallback font —
> and canvas overlays measured in the webview no longer match what the renderer
> draws.

The fix there was to pin the renderer's generic families to what each platform's
webview resolves. That is a workaround for having two text engines, maintained
per-platform, forever.

**Every annotation feature costs two implementations.** SVG and Canvas2D share
no code. Arrow heads, dash patterns, taper, blur masks — each exists twice.

**Motion mode is unreachable.** Video export runs entirely through the wgpu
pipeline in Rust. An annotation that only exists as webview drawing code cannot
appear in an exported video *at all*. No amount of timeline UI changes this.
This plan is the precondition for the whole motion-mode ambition.

## Target

A `packages/crates/rendering/src/layers/annotation.rs`, taking its place beside
the layers that already exist (`text.rs`, `mask.rs`, `cursor.rs`,
`captions.rs`), consuming `SceneObject[]` from 003 and drawing on the GPU.

The precedent is `layers/text.rs` — it already does the hard part (glyphon
text shaping into the wgpu pass) for `TextSegment`. `SceneObject` of kind
`text` routes into that same machinery rather than a new one.

Shapes need one new shader. The existing `shaders/` directory has the pattern:
`gradient-or-color.wgsl`, `mask.wgsl`, `cursor.wgsl` are all small and
single-purpose. An `annotation.wgsl` doing stroked/filled rounded rects,
ellipses and arrow polygons with antialiased SDF coverage is the bulk of the
new work.

`mask` and `focus` kinds partly exist already — `layers/mask.rs`,
`layers/blur.rs` and `shaders/background-blur.wgsl` are in place. Route the
screenshot editor's mask/focus objects through those rather than the Canvas2D
box-blur in `screenshotExport.ts:37-72`.

### What the webview keeps

`AnnotationLayer.tsx` stops drawing content and becomes **interaction chrome
only**: selection outlines, resize handles, rotation handle, snap guides, the
text-editing caret. Those are UI, they are correct to draw in the DOM, and they
must never appear in an export.

This is the clean line the current design lacks: the webview owns *input*, the
compositor owns *pixels*.

### What gets deleted

- The annotation drawing half of `screenshotExport.ts` — export becomes "ask
  the renderer for a frame at scale N", which the export path already does for
  the canvas layers, and which `configRevision` in `context.tsx` already
  sequences correctly.
- The SVG shape rendering in `AnnotationLayer.tsx`.
- The webview-font-pinning workaround in `layers/mod.rs` becomes vestigial for
  annotations (it stays for any remaining overlay measurement).

## Risks

- **This is the largest plan in the set.** It is also the one that cannot be
  skipped without abandoning motion mode. If it needs to be split, split by
  kind: `text` first (reuses `text.rs`), then `box`/`ellipse`, then `arrow`,
  then `mask`/`focus`.
- **Preview latency.** Every annotation edit now round-trips to Rust for a new
  frame. `context.tsx` already throttles at `RENDER_THROTTLE_MS = 1000/60` and
  already renders continuously through drags, so the mechanism exists — but a
  drag that previously updated an SVG attribute now waits on a GPU frame.
  Measure before and after; if it regresses, keep a lightweight DOM ghost of
  the dragged object during the gesture only, and drop it on commit.
- **Antialiasing parity.** SDF shapes will not be pixel-identical to SVG. That
  is acceptable and generally an improvement, but it will make any
  screenshot-diff test fail once, legitimately.

## Done when

- `grep -rn "annotation" packages/crates/rendering/src/` returns matches.
- Export produces annotations without any Canvas2D drawing code running.
- Preview and export are the same image at the same scale.
- `AnnotationLayer.tsx` contains no shape rendering, only handles and guides.
