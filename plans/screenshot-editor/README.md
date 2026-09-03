# Screenshot editor — canvas, annotations and masks

Plans for rebuilding the screenshot editor's foundations so annotations become
first-class renderer objects, the mask system becomes correct, and the canvas
gains the controls a capture tool needs.

Scope is deliberately **static mode only**. Every plan here is chosen so that it
either fixes a defect the screenshot editor has today, or lays a foundation the
video editor inherits for free later. Nothing here changes the recording
pipeline, encoders, or the video timeline.

Context: [`docs/canvas-unification.md`](../../docs/canvas-unification.md) (the
architecture) and
[`docs/research/shotbase-editor-architecture.md`](../../docs/research/shotbase-editor-architecture.md)
(the competitor model we are matching).

Audited against `main` @ `6c4370f`.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 000 | [Typed coordinate spaces in the editor frontend](000-typed-coordinate-spaces.md) | HIGH | DONE |
| 001 | [Normalize annotation coordinate space](001-normalize-annotation-space.md) | HIGH | DONE |
| 002 | [Add `timing` and `anchor` to `Annotation`](002-annotation-timing-anchor.md) | MEDIUM | TODO |
| 003 | [Unify the mask model and kill the `+1000` encoding](003-mask-model-unification.md) | HIGH | DONE |
| 004 | [Fix the mask shader: aspect-correct SDF, honour opacity](004-mask-shader-correctness.md) | HIGH | DONE |
| 005 | [Render annotations in wgpu](005-annotation-layer-wgpu.md) | HIGH | TODO |
| 006 | [Route screenshot masks through the mask layer](006-screenshot-masks-on-gpu.md) | HIGH | TODO |
| 007 | [Complete the canvas model](007-canvas-model.md) | MEDIUM | TODO |

> **Note:** plans 005, 006 and 007 are index entries only — the files were
> never written. 004 was reconstructed from finding #3 below before being
> executed; the remaining three would need the same treatment.

## Execution order

**000 → 001 → 003 → 004 → 005 → 006** is the spine. Each one leaves the app
shippable.

- **000 is done.** Pure scaffolding, no behaviour change: it gives the
  frontend the coordinate-space types the Rust renderer already has, so 001's
  conversions are compiler-checked at every call site rather than re-derived by
  reading. It also lands a check that already asserts 001's target property.
- **001 next.** It is the only breaking data change, and 005 depends on
  annotations being resolution-independent. Landing it early means one migration,
  not two.
- **002 any time.** Purely additive, zero behaviour change in static mode. It
  exists so the motion work later is a UI change rather than a data change.
- **003 before 004.** 004 rewrites the shader against the taxonomy 003 defines;
  doing them in the other order means writing the shader twice.
- **004 before 006.** No point routing screenshot masks onto a shader that still
  has an anisotropic feather and ignores opacity — that would ship the bug to a
  surface that does not have it yet.
- **005 is the keystone.** It deletes the Canvas2D export pass and is what makes
  the eventual motion mode possible at all. Everything before it is preparation.
- **006 after 005**, so that the export path is torn out once rather than twice.
- **007 independent.** Touches no annotation or mask code; can land in parallel
  with any of the above by a second pair of hands.

## The three findings that drove this set

1. **Annotations are invisible to the renderer.** From
   `screenshotExport.ts:12` — *"the Rust renderer draws the frame … but knows
   nothing about annotations"*. They are drawn twice in TypeScript: SVG on
   screen, Canvas2D at export. Plans 001, 002, 005.

2. **Blur vs pixelate is encoded by adding 1000 to a float.**
   `mask.rs:148` reads `stored_effect >= contract.blur_encoding_offset` where the
   offset is `1000` from `mask-effects.json`. A `pixelation` of `1016.0` means
   "blur at 16"; `16.0` means "pixelate at 16". Plan 003.

3. **The mask shader has two live defects.** The SDF and feather are computed in
   UV space on a non-square canvas, so feather is ~1.8× wider horizontally than
   vertically at 16:9; and `opacity` is read only by the highlight branch, so it
   is a silent no-op for every blur and pixelate mask. Plan 004.

## Deliberately not planned

- **Restructuring the canvas/background module.** Investigated and rejected. The
  screenshot editor already builds the same `RendererLayers` and
  `ProjectUniforms` as the video editor (`screenshot_editor.rs:390`, `:889`) —
  background, padding, rounding, shadow, crop and perspective are genuinely
  shared code today. 007 *extends* that model; it does not restructure it.

- **The editor shell merge** (one route, one context, `Static | Motion` toggle).
  Correct to want, wrong to do now: it is ~3k lines of UI churn that proves
  nothing until 005 exists. Scheduled after this set.

- **Depth of field (`dof.ts`).** It is a separate GPU pass with its own optics
  model and it works. Folding it into the annotation layer is a refactor with no
  user-visible payoff; leave it until 005 has settled.

- **Multi-stop and mesh gradients.** `BackgroundSource::Gradient` is `from`/`to`
  only, which is a real limit, but it is a feature request rather than a defect
  and it does not block anything else. Worth doing after 007.
