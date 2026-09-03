# 001 — Give TypeScript the coordinate spaces Rust already has

- **Status**: TODO
- **Severity**: HIGH
- **Category**: Correctness foundation
- **Estimated scope**: 1 new file (~120 lines), 1 check file, no behaviour change

## Problem

The Rust renderer models coordinate spaces as *types*. From
`packages/crates/rendering/src/coord.rs`:

```rust
pub struct RawDisplaySpace;
pub struct RawDisplayUVSpace;
pub struct CroppedDisplaySpace;
pub struct FrameSpace;
pub struct ZoomedFrameSpace;
pub struct Coord<TSpace> { /* ... */ }
```

A `Coord<FrameSpace>` cannot be passed where a `Coord<CroppedDisplaySpace>` is
wanted. The conversions are the only way across, and they are total.

The TypeScript half of the same pipeline has none of this. Every position is a
bare `number`, and at least four distinct spaces are in play in the screenshot
editor alone:

- **client px** — `event.clientX/Y`, relative to the viewport
- **frame px** — the SVG viewBox, i.e. the rendered output frame
- **image-normalized** — `0..1` across the screenshot itself
- **canvas-normalized** — `0..1` across the padded output frame

They are mixed inside a single struct today. `AnnotationLayer.tsx:195` writes
image-normalized values into `focus`, while `x/y/width/height` on the very same
`Annotation` are frame px — and the code says so:

```ts
// The region lives in `focus` as normalized values; these frame-px
// fields are only kept in sync for hit-testing and are derived, not
// authoritative.
```

A struct where some fields are authoritative and others are decorative, with
the distinction living only in a comment, is the condition that lets 002's bug
exist unnoticed.

## Target

A new `apps/desktop/src/routes/screenshot-editor/space.ts` holding branded
scalar and rect types plus the total conversions between them:

```ts
declare const brand: unique symbol;
type Branded<T, B> = T & { readonly [brand]: B };

export type ClientPx = Branded<number, "client">;
export type FramePx  = Branded<number, "frame">;
/** 0..1 across the screenshot content. Survives padding/crop/aspect. */
export type ImageNorm  = Branded<number, "image-norm">;
/** 0..1 across the padded output frame. Survives export scale only. */
export type CanvasNorm = Branded<number, "canvas-norm">;

export type Rect<U> = { x: U; y: U; width: U; height: U };

export const frameToImageNorm = (p: Pt<FramePx>, imageRect: Rect<FramePx>) => …
export const imageNormToFrame = (p: Pt<ImageNorm>, imageRect: Rect<FramePx>) => …
export const clientToFrame    = (e: {clientX:number;clientY:number}, svg: SVGSVGElement, bounds: Rect<FramePx>) => …
```

Brands are erased at runtime, so this costs nothing in the bundle and nothing
at execution. The constructors (`framePx(n)`, `imageNorm(n)`) are the only
places a raw `number` becomes a spaced value, which makes every entry point
greppable.

Mirror the existing `*.check.ts` convention (`arrow.check.ts`,
`geometry.check.ts`) with a `space.check.ts` asserting round-trip identity:
`imageNormToFrame(frameToImageNorm(p, r), r) ≈ p` for a spread of rects
including degenerate ones.

## Why this is separate from 002

002 rewrites how ~500 lines of `AnnotationLayer.tsx` and `screenshotExport.ts`
handle position. Doing that against bare `number`s means re-deriving, by
reading, which space each expression is in. With brands in place the compiler
lists the sites. This plan is deliberately behaviour-free so it can land and be
reviewed on its own.

## Done when

- `space.ts` and `space.check.ts` exist and the check passes.
- `toSvgPoint` in `AnnotationLayer.tsx` returns `Pt<FramePx>`.
- `getImageRect` in `layout.ts` returns `Rect<FramePx>`.
- No other behaviour has changed; the editor is byte-identical in output.
