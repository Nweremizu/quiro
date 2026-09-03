# 000 — Typed coordinate spaces in the editor frontend

**Severity:** HIGH · **Status:** DONE · **Blocks:** 001

## Problem

The Rust renderer models coordinate spaces as *types*. From
`packages/crates/rendering/src/coord.rs`:

```rust
pub struct RawDisplaySpace;
pub struct CroppedDisplaySpace;
pub struct FrameSpace;
pub struct ZoomedFrameSpace;
pub struct Coord<TSpace> { /* … */ }
```

A `Coord<FrameSpace>` cannot be passed where a `Coord<CroppedDisplaySpace>` is
wanted, and the conversions are the only way across.

The TypeScript half of the same pipeline had none of that. Every position was a
bare `number`, and four spaces are live in the screenshot editor: viewport
pixels, frame pixels, capture-normalized and canvas-normalized. They were mixed
inside a single record — `Annotation.x/y/width/height` in frame pixels while
`Annotation.focus.{x,y}` on the same object is normalized — with the
distinction recorded only in a comment:

```ts
// The region lives in `focus` as normalized values; these frame-px
// fields are only kept in sync for hit-testing and are derived, not
// authoritative.
```

Plan 001 rewrites how several hundred lines across `AnnotationLayer.tsx`,
`screenshotExport.ts`, `snapping.ts` and `arrow.ts` handle position. Against
bare `number`s, that means re-deriving which space each expression is in by
reading it. This plan makes the compiler produce that list instead, and it is
the reason 001's stated sharp edge — *"convert once at the event boundary and
keep the drag math in screen space"* — is enforceable rather than a convention
someone has to remember.

## What landed

`apps/desktop/src/routes/screenshot-editor/space.ts`:

```ts
export type ClientPx    = Branded<number, "client">;
export type FramePx     = Branded<number, "frame">;
export type CaptureNorm = Branded<number, "capture-norm">;   // AnnotationAnchor::Capture
export type CanvasNorm  = Branded<number, "canvas-norm">;    // AnnotationAnchor::Canvas
```

Brands are erased at compile time, so this costs nothing in the bundle and
nothing at runtime. The names deliberately match the `AnnotationAnchor` variants
plan 002 introduces, so there is one vocabulary rather than two.

- **Constructors** (`framePx`, `frameRect`, `captureNorm`, …) are the only
  sanctioned way from `number` into a space, which makes every entry point
  greppable. They assert intent and do not validate; `clampNorm` is separate,
  because masks clamp and free shapes do not.
- **Total conversions** both directions, for points and rects, against either
  anchor: `frameToCaptureNorm` / `captureNormToFrame`,
  `frameRectToCaptureNorm` / `captureNormRectToFrame`, and the `Canvas`
  equivalents. `clientToFrame` is the single entry point for pointer input.
- **Divisors are guarded** the way `layout.ts` already guards its own
  (`Math.max(1, …)`), because the capture rect is legitimately zero-sized
  during first layout, before the renderer has reported a frame. An unguarded
  divide there would write `Infinity` into the annotation list and persist it.
- Extents are converted as differences rather than positions, so a
  right-to-left drag keeps its **negative width** until the gesture commits —
  which `AnnotationLayer` relies on.

### Wiring

- `getImageRect` (`layout.ts`) returns `Rect<FramePx>`. It is the anchor rect
  every capture-normalized value is defined against; the name predates this
  vocabulary and was left alone rather than churning its callers.
- `toSvgPoint` (`AnnotationLayer.tsx`) returns `Pt<FramePx>` via
  `clientToFrame`.

Branded types are assignable *to* `number`, so existing arithmetic on these
values kept compiling untouched. Only code constructing a spaced value from raw
numbers has to go through a constructor — which is the discipline wanted, at
near-zero migration cost.

### Check

`space.check.ts`, 74 assertions, registered in `scripts/run-checks.mjs`
alongside `arrow.check.ts` and `geometry.check.ts`. Beyond round-trip identity
across seven anchor rects (including degenerate and sub-pixel ones), it asserts:

- negative extents survive normalization with their sign
- the anchor's own corners map to exactly 0 and 1
- no conversion emits a non-finite value, whatever it is handed
- **the property 001 exists to establish**: a normalized point tracks the
  capture through a padding change, *and* the frame-pixel equivalent would
  have drifted. The bug is encoded as a test before the fix lands, so 001 has
  a target that fails today.

## Note for 001

001's migration is in Rust (`ProjectConfiguration::load`) and is unaffected by
this. What this changes is the frontend half of 001 — the `viewBox` multiply-up
in `AnnotationLayer.tsx` and the deletion of `scaleAnnotations` — where the
conversions now exist, are tested, and are type-checked at the call site.

`stroke_width` is deliberately **not** handled here. 001 normalizes it against
height only, and that is a document-schema decision rather than a coordinate
conversion, so it belongs there.

## Behavioural delta

One, disclosed: `clientToFrame` guards its divisor where the previous inline
`toSvgPoint` divided by the raw bounding-box width. Identical for any real
viewport; differs only if the SVG's box were under 1px wide, where the old code
produced `Infinity`.
