# Canvas unification — making Static and Motion one document

Design + migration plan for restructuring Quiro's canvas module so a single
project supports both a static composition and a motion composition, the way
Shotbase does. Companion to
[`research/shotbase-editor-architecture.md`](research/shotbase-editor-architecture.md).

Written against `main` @ `6c4370f`.

---

## 0. Verdict first

**The canvas module is not the problem. The annotation model is.**

The instinct that "our canvas module isn't structured enough" is half right — but
the fracture is one layer down from where it feels like it is. Quiro already has
a genuinely shared canvas:

| Shared today | Where |
| --- | --- |
| `ProjectConfiguration` — the whole document type | `configuration.rs:1834` |
| `BackgroundConfiguration` — background, padding, radius, shadow, border | `configuration.rs:295` |
| `PerspectiveConfiguration` — 3D transforms | `configuration.rs:367` |
| `RendererLayers` — the wgpu layer stack | `rendering/src/lib.rs:5319` |
| `ProjectUniforms` / `get_base_size` — the canvas sizing law | same |

The screenshot editor does **not** have its own renderer. It builds the same
`RendererLayers` and the same `ProjectUniforms` as the video editor and renders a
one-frame video (`screenshot_editor.rs:390`, `:889`, `:1683`). Backgrounds,
padding, rounding, shadow, crop and perspective already behave identically in
both editors because they *are* the same code.

That is Shotbase's "Standardized canvas size limits across capture workflows" —
already true here, before we started.

So the work is not to build a shared canvas. It is to fix the three things
sitting on top of it.

---

## 1. The three real fractures

### Fracture 1 — annotations are second-class citizens (the big one)

`ProjectConfiguration.annotations` is a `Vec<Annotation>`
(`configuration.rs:1845`) with **no time dimension at all**. And the renderer
cannot draw them. From the export module's own header comment
(`screenshotExport.ts:12`):

> the Rust renderer draws the frame … but knows nothing about annotations

Annotations are drawn twice, both times in TypeScript:

- **on screen** as SVG, in `AnnotationLayer.tsx`
- **at export** as Canvas2D, in `screenshotExport.ts` (`drawAnnotations`, `paintMasks`)

Consequences, in order of severity:

1. **Annotations can never appear in a video export.** The video export path runs
   entirely in Rust. There is no JS compositing pass to hook. The `annotations`
   array is dead data in the motion path — grepping `routes/editor/` returns zero
   reads of it.
2. **We already ship two annotation systems that duplicate each other.** The
   timeline has `TextSegment` (`configuration.rs:909`) and `MaskSegment`
   (`configuration.rs:865`) — timed, normalized, wgpu-drawn — sitting beside
   `AnnotationType::Text` and `AnnotationType::Mask` — untimed, pixel-space,
   JS-drawn. Same user-facing concepts, two incompatible implementations, two
   inspectors, two renderers.
3. **Two coordinate spaces.** Annotations are stored in *preview frame pixels* and
   rescaled at export (`scaleAnnotations`). Timeline segments are normalized
   `XY<f64>` in 0..1. These cannot merge without picking one.

This fracture alone is why Static→Motion is impossible today. Shotbase's core
trick — a text callout that is simultaneously a canvas object and a trimmable
5-second timeline clip — requires annotations to be one timed, renderer-native
model.

### Fracture 2 — no mode concept in the document

Nothing in `ProjectConfiguration` says whether a project is static or motion.
`timeline: Option<TimelineConfiguration>` is the closest thing, and it is
incidental rather than intentional.

### Fracture 3 — two editor shells

Two routes (`routes/editor/`, `routes/screenshot-editor/`), two React contexts,
two headers, two crop dialogs, two export dialogs, two Tauri window variants
(`windows/variants/editor.rs`, `windows/variants/screenshot_editor.rs`), two Rust
instance managers. Roughly 3k lines of near-duplicate shell.

This is the most *visible* fracture and the least *important* one. Fix it last.

---

## 2. Target model

> A project is a **canvas**, some **sources**, a set of **objects**, and an
> optional **time axis**. Static and Motion are two projections of one document,
> not two documents.

```
Project
├── Canvas          aspect · background · padding · radius · shadow · border
│                   · perspective · watermark          [EXISTS, shared]
├── Sources         screenshot image | recording clips | camera | audio
├── Objects         annotations: geometry + style + anchor + OPTIONAL timing
└── Time            Option<TimelineConfiguration>       [EXISTS, motion only]
```

**The one rule that makes this work:**

```
visible_at(t)  =  annotation.timing.map_or(true, |r| r.start <= t && t < r.end)
```

An annotation with no timing is **always visible**. Which means:

- A screenshot project is just a project whose duration is one frame. Every
  annotation is untimed, so everything renders. Nothing special about it.
- Switch that project to Motion, give it a 5s duration, and every existing
  annotation still renders across the whole 5s — because untimed means always.
  Nothing breaks, nothing is lost, nothing needs converting.
- Drag a trim handle on one, and it gains `timing`. Now it is a timeline clip.

That is Shotbase's "animated screenshots" feature falling out of the data model
for free, rather than being built as a feature.

**Mode is a view preference, not a document property.** Store it so the window
can restore, but never let the renderer or exporter branch on it. Static export =
render at `t = poster_time`, frame count 1. Motion export = render across
`[0, duration]`. One pipeline, one code path, different bounds. This is already
how `screenshot_editor.rs` works — we are generalising it, not replacing it.

### 2.1 The anchor decision

A design point Shotbase's marketing never addresses but which you must settle:
**when the camera zooms, do annotations move with the content or stay put?**

Both are needed:

- A callout arrow pointing at a button must **track the capture** through a zoom,
  or it drifts off its target.
- A title card or lower-third must **stay on the canvas**, unaffected by zoom.

So annotations need an anchor:

```rust
pub enum AnnotationAnchor {
    /// 0..1 of the capture. Rides zoom, pan, crop and padding. Default.
    Capture,
    /// 0..1 of the output canvas. Immune to camera movement.
    Canvas,
}
```

`Capture` is the right default — it matches how the screenshot editor behaves
today (annotations are in frame pixels, which move with the frame) and matches
what callouts are for. The precedent is already in the codebase: `FocusConfig`'s
doc comment argues exactly this case for normalizing to the screenshot so the
effect *"survives padding, crop and aspect-ratio changes"* (`configuration.rs:1620`).

---

## 3. Type changes

All in `packages/crates/project/src/configuration.rs`.

### 3.1 Add timing to `Annotation`

```rust
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AnnotationAnimation {
    #[default]
    None,
    Fade,
    Typewriter,
    SlideLeft,
    SlideRight,
    SlideTop,
    SlideBottom,
    Scale,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationTiming {
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub track: u32,
    #[serde(default)]
    pub enter: AnnotationAnimation,
    #[serde(default)]
    pub exit: AnnotationAnimation,
    #[serde(default = "AnnotationTiming::default_transition")]
    pub enter_duration: f64,
    #[serde(default = "AnnotationTiming::default_transition")]
    pub exit_duration: f64,
}

pub struct Annotation {
    // ... every existing field unchanged ...

    /// Absent = always visible (static semantics). Present = a timeline clip.
    #[serde(default)]
    pub timing: Option<AnnotationTiming>,

    #[serde(default)]
    pub anchor: AnnotationAnchor,
}
```

Both fields are `#[serde(default)]`, so **every existing project file on disk
loads unchanged and behaves identically**. Purely additive.

`track` matches the lane convention already used by `TextSegment`/`MaskSegment`
and consumed by `timelineTracks.ts` — `getSegmentTrack`, `normalizeTrackSegments`
and `placeSegmentAtTime` are generic over `{start, end, track?}`, so annotation
lanes inherit lane packing, gap-fitting and row layout the moment
`AnnotationTiming` exists. No new timeline machinery.

### 3.2 Normalize annotation coordinates

Change `x/y/width/height` from preview-frame pixels to 0..1 of the anchor space.
This is the one genuinely breaking change, and it needs a migration in
`ProjectConfiguration::load` alongside the existing `text_size_version` and
camera migrations — the file already has that pattern.

```rust
pub const ANNOTATION_SPACE_VERSION: u32 = 1;
// 0 = preview-frame pixels (legacy), 1 = normalized to anchor space
```

Migration divides stored pixel coords by the recorded capture size. That size
must be available at load time; if it is not on the project, read it from the
screenshot sidecar during migration and bake it in.

**Do not skip this.** Pixel coordinates break the moment the same document
renders at a different output resolution — which is exactly what happens when a
static project becomes a 1080p video.

### 3.3 Collapse the duplicate segment types

Once annotations are timed, `TextSegment` and `MaskSegment` are redundant with
`AnnotationType::Text` and `AnnotationType::Mask`.

Do **not** delete them in the same change. Sequence:

1. Land timed annotations; teach the renderer to draw them.
2. Add a load-time migration converting `timeline.text_segments` →
   `Annotation { type: Text, timing: Some(..), anchor: Canvas }` and
   `timeline.mask_segments` → `Annotation { type: Mask, timing: Some(..), anchor: Capture }`.
3. Keep the old fields deserializable (`#[serde(default)]`, never written) for one
   release so a downgrade does not hard-fail.
4. Remove them.

**One snag:** `MaskSegment` carries `keyframes: MaskKeyframes` (scalar + vector
keyframe tracks, `configuration.rs:854`) which `Annotation` has no equivalent for.
Either lift keyframes onto `AnnotationTiming` as a general per-property track, or
accept that masks keep a richer payload. **Recommendation: lift it** — see §7.1.

---

## 4. Renderer — the annotation layer

The substantial engineering. `RendererLayers` (`rendering/src/lib.rs:5319`) gains
an `annotations: AnnotationLayer`, rendered in `render()` (`:5778`) **after**
cursor and camera, **before** keyboard and captions — annotations sit above the
content but below chrome:

```
background → blur → frame → display → cursor → camera → mask
    → annotations   ← NEW
    → text → keyboard → captions
```

(`text` stays only until §3.3 retires it.)

### 4.1 Two implementation routes

**Route A — CPU raster (`tiny-skia`) → texture upload.** Rasterize all
annotations to an RGBA buffer, upload, composite as one quad.

- *For:* fast to parity. `arrow.ts` already emits explicit polygon/polyline path
  data, so the port is mechanical. Full stroke/dash/join fidelity for free.
- *Against:* per-frame CPU cost and PCIe upload in motion mode. Mitigate by
  hashing annotation state + time and re-rasterizing only on change, and by
  uploading only the dirty bounding box. Static rasterizes once.

**Route B — GPU tessellation (`lyon`) → wgpu triangles; text via existing
`glyphon`.**

- *For:* no per-frame CPU raster; animation becomes uniform-buffer updates; scales
  to 4K/60 without thought. `glyphon` and a shared `FontSystem` are already wired
  up in `layers/mod.rs`.
- *Against:* more work. Dashed strokes and round joins need care in tessellation.

**Recommendation: B, with A acceptable as an interim if you want Static→Motion
demoable sooner.** Route A's cost lands precisely in the case you are building
for — a 5-second 60fps export with animating annotations is 300 rasters — and you
end up at B regardless. Going straight to B avoids writing the layer twice.

### 4.2 The geometry-divergence trap

`arrow.ts` (frontend) and the new Rust layer must produce **pixel-identical**
paths, or the SVG editing overlay will not line up with the rendered frame. The
repo already has `arrow.check.ts` and `geometry.check.ts`, so property-checking
is an established habit here.

Mitigation: extract a shared fixture file (JSON: inputs → expected path points)
consumed by both the TS checks and a Rust test. Divergence then fails CI instead
of shipping as a 2px offset users report as "the arrow moves when I export".

The alternative — porting geometry to Rust and calling it from TS over IPC for the
live overlay — adds a round-trip to every drag frame. Reject it.

### 4.3 Animation evaluation

Entrance/exit animations evaluate in the layer's `prepare`, mapping
`(t, timing, enter, exit)` to a transform + alpha + (for Typewriter) a glyph
count. Reuse the existing easing/spring infrastructure rather than inventing:
`spring_mass_damper.rs`, `zoom_spring.rs` and `transition.rs` are already there.

---

## 5. Editor shell

Only after §3 and §4 land. Cosmetic relative to the model work, but it is what
makes the product read as Shotbase-equivalent.

- **One route.** Fold `routes/screenshot-editor/` into `routes/editor/`. The
  screenshot editor's better parts (`LayersPanel`, `StylePanel`,
  `AnnotationTools`, `AnnotationConfig`) become shared panels — the video editor
  has no layers panel today and needs one.
- **One context.** Merge `screenshot-editor/context.tsx` into
  `editor/context.tsx`. The screenshot one already owns a `ProjectConfiguration`,
  so the shapes agree.
- **`Static | Motion` segmented control** in the header, centre, matching
  Shotbase. Switching a still to Motion gives the project a default duration
  (Shotbase shows an adjustable `5s`) and reveals the timeline. Existing
  annotations stay untimed and therefore visible throughout.
- **Timeline lanes** matching the observed three: annotation clips on top,
  `Effects` (zoom/mask) in the middle, source clip with waveform at the bottom.
  Lane machinery already exists in `timelineTracks.ts`.
- **One window variant.** Retire `windows/variants/screenshot_editor.rs` and the
  separate instance manager, but **keep its prewarm path** — that is a real UX
  asset the video editor should inherit, not lose.
- **Delete the Canvas2D pass in `screenshotExport.ts`** (~460 lines) once §4
  renders annotations. Static export becomes "render one frame, encode PNG",
  sharing the motion pipeline exactly.

---

## 6. Phasing

Each phase is independently shippable and leaves the app working.

| # | Phase | Blast radius | Unlocks |
| --- | --- | --- | --- |
| 1 | Normalize annotation coordinates + migration | project crate, screenshot editor | resolution independence |
| 2 | Add `timing` + `anchor` to `Annotation` (unused) | project crate only, additive | the data model |
| 3 | `AnnotationLayer` in wgpu; delete the Canvas2D export pass | rendering crate, export | **annotations in video** |
| 4 | Migrate `TextSegment`/`MaskSegment` → annotations | project crate, editor UI | one annotation system |
| 5 | Unify editor shell, add the `Static`/`Motion` toggle | frontend, window variants | the Shotbase interaction |
| 6 | Entrance/exit animation presets + inspector | rendering, UI | animated screenshots |

**Phase 3 is the keystone.** Everything before it is preparation; everything after
it is product. If effort has to stop somewhere, stopping after 3 still leaves a
strictly better product than today.

Phases 1 and 2 are safe to land immediately, in either order.

---

## 7. Where to deliberately beat Shotbase

Parity is the goal, but three places are worth diverging.

### 7.1 General keyframes over fixed presets

Their inspector shows six entrance animations. If §3.3 lifts `MaskKeyframes` into
a general per-property track on `AnnotationTiming`, *any* annotation property
animates over time. That is a category above what they ship, and the machinery
already exists in the repo — it is currently locked to masks for no structural
reason.

### 7.2 Explicit `anchor`

Their model appears to anchor annotations to the capture implicitly. Exposing
Capture/Canvas makes lower-thirds and zoom-tracking callouts both first-class.

### 7.3 Do not copy their web-capture architecture

Shotbase's URL capture is a hosted call to ScreenshotOne (documented in their own
privacy policy), meaning network dependency and per-capture marginal cost. Quiro
is Tauri — a local webview capture has no marginal cost and works offline.

---

## 8. What this plan explicitly does not do

- Does not touch the recording pipeline, capture targets, or encoders.
- Does not change `BackgroundConfiguration` or the canvas sizing law. They are
  already correct and already shared; the temptation to "restructure the canvas
  module" should be resisted, because the canvas module is the part that works.
- Does not add multi-clip assembly, captions, or transitions. Those exist already
  or are independently scoped.
