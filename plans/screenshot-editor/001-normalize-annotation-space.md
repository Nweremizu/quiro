# 001 — Normalize annotation coordinate space

**Severity:** HIGH · **Status:** DONE (see Outcome) · **Blocks:** 005 · **Depends on:** [000](000-typed-coordinate-spaces.md) (done)

## Problem

`Annotation.x/y/width/height` (`configuration.rs:1739`) are stored in **preview
frame pixels**. Export compensates by rescaling every annotation immediately
before drawing:

```ts
// screenshotExport.ts
const scaledAnnotations = scaleAnnotations(annotations, scaleX, scaleY);
```

That works only because export knows both the preview size and the output size
at the same moment. It fails the instant the same document is rendered at a size
the preview never saw — which is exactly what a 1080p video export of a static
composition is.

Three concrete consequences today:

1. Annotations are coupled to whatever the preview happened to be sized at when
   they were drawn. Resize the editor window between sessions and the stored
   numbers mean something different.
2. `Annotation` cannot merge with `TextSegment`/`MaskSegment`, which use
   normalized `XY<f64>` — plan 003 and the eventual segment collapse are blocked
   on this.
3. A 2× retina export and a 1× export take different code paths through
   `scaleAnnotations`, so rounding differs between them.

The repo already argues for the fix in its own comments. `FocusConfig`
(`configuration.rs:1620`) is normalized precisely so the effect *"is
resolution-independent and survives padding, crop and aspect-ratio changes that
move the screenshot within the frame"*. Annotations need the same treatment for
the same reason.

## Change

Store annotation geometry as **0..1 of the capture**, not pixels.

```rust
pub const ANNOTATION_SPACE_VERSION: u32 = 1;
// 0 = preview-frame pixels (legacy)
// 1 = normalized to the capture's 0..1 space
```

Add `annotation_space_version: u32` to `ProjectConfiguration` with a field-level
default of `0`, so files written before this change are detected, while
`Default::default()` produces `1` for new projects. This mirrors exactly how
`text_size_version` is already handled in the same file — follow that pattern
rather than inventing a second one.

### Migration

In `ProjectConfiguration::load`, alongside the existing camera / motion-blur /
text-size migrations:

- If `annotation_space_version == 0`, divide every annotation's `x` and `width`
  by the capture width and `y`/`height` by the capture height, then set the
  version to `1` and write the file back (the `load` function already has the
  write-back-on-migration branch).
- The capture size must be resolvable at load. If it is not already on the
  project, read it from the screenshot's `.json` sidecar during migration. **If
  it cannot be resolved, leave the config at version 0 and skip the migration**
  rather than guessing a size — a wrong divisor silently moves every annotation,
  which is worse than deferring.

`stroke_width` is also in pixels and must be normalized, but against a single
axis, not both — normalizing a stroke against two axes makes it change thickness
when the aspect ratio changes. Normalize against **height** and document it, the
same convention `TextSegment::font_size` already uses (1080p-relative).

## Files

- `packages/crates/project/src/configuration.rs` — the version const, the field,
  the migration in `load`.
- `apps/desktop/src/routes/screenshot-editor/AnnotationLayer.tsx` — the SVG
  overlay already uses a `viewBox` in frame coordinates, so it needs the
  normalized values multiplied back up by the viewBox extent at render time.
  This is a small change and it is where most of the risk lives. Use
  `captureNormRectToFrame` / `frameRectToCaptureNorm` from `space.ts` (plan 000)
  rather than writing the multiply inline — they are already tested against
  degenerate anchor rects, preserve the sign of a backwards drag, and make the
  space of every value visible in the type.
- `apps/desktop/src/routes/screenshot-editor/screenshotExport.ts` — delete
  `scaleAnnotations` entirely; multiply by output size instead.
- `apps/desktop/src/routes/screenshot-editor/geometry.ts`, `snapping.ts`,
  `arrow.ts` — audit for pixel assumptions. Snapping thresholds in particular are
  almost certainly in pixels and must stay in pixels (a 6px snap radius is a
  screen-space affordance, not a document property), so convert at the boundary.

## Acceptance

- An existing project written before this change opens with every annotation in
  visually the same place, and its file is rewritten at version `1`.
- Exporting the same project at 1×, 2× and at an arbitrary output size places
  annotations identically relative to the capture.
- Resizing the editor window does not change stored annotation values.
- `cargo test -p quiro-project` covers: migration from a known pixel config with
  a known capture size; the skip path when capture size is unresolvable.

## Risks

- **The snapping and drag code is the sharp edge.** Dragging happens in screen
  pixels; the document is now normalized. Convert once at the event boundary and
  keep the drag math in screen space, rather than sprinkling conversions through
  `resizeByHandle` and `snap`. Plan 000 makes this enforceable rather than a
  convention: `clientToFrame` is the single input boundary, and `resizeByHandle`
  keeps operating on frame-space values, so the normalize step happens once on
  commit — which is also where `history.pause()` already brackets the gesture.
- **Arrow control points** (`arrow_bend`, and the handle geometry in `arrow.ts`)
  are derived from the same coordinates and must be normalized in the same pass,
  or curved arrows will re-shape on load.

## Outcome

Landed, with three corrections to the plan as written.

**1. The divisor was wrong.** Annotations are in *rendered output frame*
pixels, which include the padding inset — not capture pixels. Dividing by the
capture size alone would have offset every annotation by the padding, silently.
The migration subtracts the content offset first:
`(x - offset.x) / size.x`.

**2. The migration could not live in `load`.** `ProjectConfiguration::load`
takes only a path and never learns the capture dimensions. It is now
`ProjectConfiguration::migrate_annotation_space(&mut self, capture_size)`,
called from `screenshot_editor.rs` — the one site holding both a config and a
capture size — which writes back to the `.cap` dir or the `.project.json`
sidecar depending on where the config came from.

**3. The layout maths had to move first.** `get_base_size` / `display_offset`
lived in `quiro-rendering`, which *depends on* `quiro-project`, so the
migration could not call up the dependency graph. They are now
`quiro_project::frame_layout`, and `rendering` delegates to them — one
authority rather than two copies. The renderer's 126 tests pass unchanged,
which is what validates the port.

The decorative-frame case is deferred rather than guessed: chrome insets live
in `rendering::frame_chrome` (710 lines of style tables) and do not belong in
`project`, so `frame_layout::content_rect` returns `None` when a frame is
active and the migration leaves such a config at version 0 for a later run.

### Frontend

The storage boundary is a single seam in `context.tsx`: stored geometry is
normalized, the context exposes it resolved into frame pixels against an
`anchorRect` published by `Preview`, and the mutators normalize on the way
back. The entire interaction layer — drag, resize, snapping, arrow geometry —
was untouched and still works in pixels, which is what plan 000 was for.

### Not done

- **`scaleAnnotations` still exists.** Now that storage is normalized it is
  merely redundant rather than wrong: annotations reach export already resolved
  to the preview frame, and scaling proportionally to the export frame gives
  the same answer as resolving against the export rect. Deleting it means
  plumbing stored annotations plus an export-side anchor through
  `useScreenshotExport`; correctness does not depend on it.
- **`maskLevel` is still in preview-frame pixels.** It is a blur radius, so it
  has the same drift bug in miniature, and `scaleAnnotations` compensates for
  it at export today. Normalizing it against height alongside `strokeWidth` is
  a small follow-up in both the Rust migration and `space.ts`; it was left out
  rather than changed silently, because `dof.ts` and `paintMasks` read it.
