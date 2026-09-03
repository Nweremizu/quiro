# 002 — Store annotation geometry normalized against a declared anchor

- **Status**: TODO
- **Severity**: CRITICAL
- **Category**: Correctness
- **Estimated scope**: schema change + migration; ~5 files, ~400 lines touched
- **Depends on**: 001

## Problem

`Annotation` stores geometry in frame pixels:

```ts
export type Annotation = { id: string; type: AnnotationType;
  x: number; y: number; width: number; height: number; … }
```

Those are viewBox coordinates of the **rendered output frame** — a frame whose
size and content offset are recomputed from scratch every time padding, crop or
aspect ratio changes. `layout.ts` does that recompute:

```ts
const paddingFactor = (padding / 100.0) * SCREEN_MAX_PADDING;
const baseSize = getBaseSize(cropWidth, cropHeight, paddingFactor, aspectRatio);
```

Nothing rescales annotations to match. Grepping the style panel for
`annotation` returns nothing — there is no compensating pass anywhere.

**The user-visible bug:** place an arrow on a button, then drag the padding
slider. The screenshot shrinks inside the frame; the arrow does not. It slides
off its target. Same for changing aspect ratio, same for changing crop.

The codebase already diagnosed this and fixed exactly one case.
`AnnotationLayer.tsx:190-197`:

```ts
// Clicking with the focus tool aims the camera. The point is stored
// normalized to the screenshot so the plane of focus survives a change
// of padding, crop, aspect ratio or export scale.
const aim = {
  x: clamp((point.x - imageRect.x) / Math.max(1, imageRect.width), 0, 1),
  y: clamp((point.y - imageRect.y) / Math.max(1, imageRect.height), 0, 1),
};
```

That comment is the specification for this plan. It is correct, and it was
applied to `focus` only.

The video side of the same config already does it properly everywhere —
`TextSegment` and `MaskSegment` in `configuration.rs` store `center: XY<f64>`
and `size: XY<f64>` normalized, defaulting to `XY::new(0.5, 0.5)`.

## Target

Geometry becomes normalized **plus an explicit anchor**:

```ts
export type AnchorSpace = "image" | "canvas";

export type Geometry = {
  anchor: AnchorSpace;
  x: number; y: number; width: number; height: number;  // all 0..1
  rotation: number;                                      // degrees, unchanged
};
```

Two anchors, because two behaviours are both legitimately wanted:

- **`image`** — the default. Pins to the screenshot content. An arrow pointing
  at a button stays on that button through any padding, crop, aspect or scale
  change. Masks *must* be image-anchored (they redact pixels).
- **`canvas`** — pins to the padded output frame. A title in the margin, a
  watermark, a caption bar. These should stay put when the image resizes
  inside the frame, and would otherwise be dragged around by it.

`rotation` stays in degrees and stays absolute — it is not a length, so it does
not normalize. `strokeWidth` **does** need attention: a stroke stored in frame
px will visually change weight when the frame resizes. Store it as a fraction
of the anchor's smaller dimension and resolve at draw time.

### Conversion points

Only two, and 001's brands make them checkable:

- **On read (draw / hit-test):** `imageNormToFrame(geom, anchorRect)` where
  `anchorRect` is `getImageRect(...)` for `image` and `bounds` for `canvas`.
- **On write (draw / drag / resize):** `frameToImageNorm(result, anchorRect)`.

`geometry.ts` keeps working *unchanged* in frame px — resize/rotate maths runs
in the resolved frame-space rect, and the result is normalized on the way back
into state. That file is good and this plan does not touch it.

### Migration

Existing `.json` sidecars hold frame-px annotations. Follow the precedent
already set by `textSizeVersion` in `ProjectConfiguration`:

```rust
/// 0 (legacy): the renderer multiplied `font_size` by `size.y / 0.2` …
/// legacy configs are migrated on load by baking the box factor into `font_size`.
pub text_size_version: Option<u32>,
```

Add `annotationGeometryVersion`, defaulting to 0 for existing files. On load,
version 0 annotations are converted using the frame rect implied by *their
saved* padding/crop/aspect — which is recoverable, because the config that
produced those pixels is stored in the same file. Write back as version 1.

This migration is lossless in the only case that matters: a file that has not
been edited since it was saved renders identically.

## Risks

- **Degenerate anchors.** `imageRect` can be zero-width during first layout;
  `layout.ts` already guards with `Math.max(1, …)`. The conversions must too,
  and `space.check.ts` from 001 should cover it.
- **Arrows.** `arrow.ts` derives control points from the bounding box; confirm
  `arrowBend` and `arrowHeadSize` are box-relative rather than px, or they will
  need the same treatment as `strokeWidth`. `arrow.check.ts` exists and should
  be extended rather than replaced.
- **Round-trip drift.** Normalizing and re-resolving on every drag frame will
  accumulate float error. Resolve once at gesture start, run the whole gesture
  in frame px, normalize once on commit — which is also what the existing
  `history.pause()` gesture boundary already brackets.

## Done when

- Dragging padding from 0 to max leaves every annotation type visually locked
  to its target in the screenshot.
- Changing aspect ratio and changing crop do the same.
- Exporting at 1x and 2x produces the same composition at two resolutions.
- A pre-migration `.json` opens and renders unchanged.
