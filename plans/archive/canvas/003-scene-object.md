# 003 — Collapse `Annotation` and `*Segment` into one `SceneObject`

- **Status**: TODO
- **Severity**: HIGH
- **Category**: Architecture
- **Estimated scope**: schema unification across Rust + TS; ~8 files
- **Depends on**: 002

## Problem

The codebase has **two overlay systems for the same concept**, one per editor,
and they disagree on every axis.

Screenshot side — `ProjectConfiguration.annotations: Annotation[]`:

```ts
{ id, type, x, y, width, height, strokeColor, strokeWidth,
  fillColor, opacity, rotation, text, maskType, maskLevel, focus, arrow* }
```

Frame-px (until 002), untimed, no track, no enabled flag, drawn in the webview.

Video side — `TimelineConfiguration.text_segments: Vec<TextSegment>` and the
mask segments beside them:

```rust
pub struct TextSegment {
    pub start: f64, pub end: f64, pub track: u32, pub enabled: bool,
    pub content: String, pub center: XY<f64>, pub size: XY<f64>,
    pub font_family: String, pub font_size: f32, pub color: String,
    pub fade_duration: f64,
}
```

Normalized, timed, tracked, toggleable, drawn on the GPU.

A text label is a text label. Today, drawing one on a screenshot and drawing
one on a video produce two unrelated records, edited by two unrelated panels,
drawn by two unrelated renderers. Every future feature — a new annotation type,
a new style control, z-ordering, grouping — has to be built twice or it exists
in one editor only. That is the structural reason the two editors cannot share
a canvas, and the reason ShotBase's `Static | Motion` toggle has no analogue
here.

## Target

One record, with **timing optional**:

```ts
export type SceneObject = {
  id: string;
  kind: "arrow" | "box" | "ellipse" | "text" | "mask" | "focus";
  geometry: Geometry;        // from 002: normalized + anchor
  style: SceneStyle;         // stroke, fill, opacity, font, arrow shape…
  z: number;                 // explicit paint order
  enabled: boolean;
  timing: Timing | null;     // null ⇒ always visible (static)
};

export type Timing = {
  start: number; end: number;
  track: number;
  enter: Transition;         // none | fade | typewriter | slide-{l,r,t,b}
  exit: Transition;
};
```

`timing: null` is the entire static/motion distinction at the data layer. A
screenshot's objects have `null`; a recording's objects have a `Timing`. The
renderer's visibility test becomes `timing === null || t within [start, end]`,
and everything else about the object — geometry, style, paint order, hit
testing, the inspector UI — is shared verbatim.

This is the ShotBase model as observed: the research found one annotation
appearing simultaneously as a canvas object and as a trimmable timeline clip
with entrance-animation presets, which is what a single record carrying
optional timing looks like from the outside.

### Migration

- `Annotation[]` → `SceneObject[]` with `timing: null`, `z` from array index.
- `TextSegment` / `MaskSegment` → `SceneObject` with `timing` populated from
  `start`/`end`/`track` and `enter/exit` derived from `fade_duration`.
- `focus` stays a `kind`, not a separate optional sub-struct — its normalized
  `x/y/radiusX/radiusY` fold into `geometry` cleanly now that geometry is
  normalized, which retires the "these frame-px fields are derived, not
  authoritative" wart called out in 001.
- Version the config as in 002; keep reading both shapes for one release.

### Ordering

`z` becomes explicit rather than implied by array position. Array position is
fine until two objects need to swap without a list reorder (which the layers
panel will want), and until motion mode lets objects appear and disappear —
at which point "later in the array" stops meaning "painted on top" in any way
the user can reason about.

## Risks

- **`ProjectConfiguration` is shared by both editors already.** It carries
  `annotations`, `timeline`, `clips`, `camera` in one struct, so this change
  lands in one place — but it also means a schema mistake breaks both editors.
  Land it behind the version field and keep the old reader until 004 proves the
  new path renders correctly.
- **specta bindings.** `utils/tauri.ts` is generated; the TS side updates only
  when the Rust types do. Sequence the change Rust-first, regenerate, then fix
  the TS fallout — not the other way round.

## Done when

- One `SceneObject` type exists in `configuration.rs` and flows through to
  `utils/tauri.ts`.
- The screenshot editor reads and writes `SceneObject[]` with `timing: null`.
- Existing screenshot and video projects both load unchanged.
- Nothing yet uses `timing` in the screenshot editor — 005 opens that.
