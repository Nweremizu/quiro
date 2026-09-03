> **ARCHIVED — superseded by [`plans/screenshot-editor/`](../../screenshot-editor/README.md).**
>
> This set was written in parallel with that one, against the same commit and
> the same research, without either knowing about the other. The
> `screenshot-editor` set is the one being executed: it is a superset (seven
> plans to five), it is correctly scoped to static mode, and it found two
> defects this set missed entirely — the `+1000` blur/pixelate encoding in the
> mask config, and the mask shader's anisotropic feather and ignored opacity.
>
> One idea was folded forward rather than discarded: the typed coordinate
> spaces, which landed as `space.ts` and are recorded as
> [`plans/screenshot-editor/000-typed-coordinate-spaces.md`](../../screenshot-editor/000-typed-coordinate-spaces.md).
>
> Kept for its reasoning, not as a work plan. One claim here is **wrong** and is
> corrected in the newer set: this set said annotations drift on export scale,
> but `screenshotExport.ts` already compensates via `scaleAnnotations`. The
> drift on padding, crop and aspect-ratio changes is real.

# Canvas / scene-model plans

Findings from an audit of the screenshot editor's canvas, annotation and
geometry code, run against commit `6c4370f`, prompted by the ShotBase research
in [`docs/research/shotbase-editor-architecture.md`](../../docs/research/shotbase-editor-architecture.md).

The goal is a canvas module that can carry a **static** and a **motion**
composition through one object model and one renderer — ShotBase's arrangement,
where an annotation is the same object in both modes and simply gains timing in
the second.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Give TypeScript the coordinate spaces Rust already has](001-typed-coord-spaces.md) | HIGH | TODO |
| 002 | [Store annotation geometry normalized against a declared anchor](002-anchored-geometry.md) | CRITICAL | TODO |
| 003 | [Collapse `Annotation` and `*Segment` into one `SceneObject`](003-scene-object.md) | HIGH | TODO |
| 004 | [Draw annotations in the compositor, not in the webview](004-one-renderer.md) | CRITICAL | TODO |
| 005 | [Make timing optional and open the static/motion seam](005-static-motion-seam.md) | MEDIUM | TODO |

## The finding in one paragraph

Annotations are stored in **frame pixels** — `Annotation.x/y/width/height` are
viewBox coordinates of the rendered output frame. Nothing rescales them when
padding, crop, aspect ratio or export scale changes, so every arrow, box and
label drifts off its target the moment the user touches the padding slider. The
codebase already knows this: `AnnotationLayer.tsx:190-197` normalizes the *focus*
point specifically so it "survives a change of padding, crop, aspect ratio or
export scale", and leaves every other annotation type on the broken convention.
Separately, `configuration.rs:1582` states plainly that **"the renderer never
draws annotations"** — so one composition is drawn by three different renderers
(wgpu for the canvas, SVG for the preview, Canvas2D for export), which is both
why annotations cannot appear in a video export and why the font code in
`layers/mod.rs` already carries a comment about webview measurements no longer
matching what the renderer draws.

## Execution order

**001 → 002 → 003 → 004 → 005, strictly in sequence.** Each one is the
precondition for the next; this is a single refactor cut into reviewable pieces,
not five independent fixes.

- **001** is pure scaffolding — brands and conversions, no behaviour change. It
  exists so 002 is mechanical instead of archaeological.
- **002** is the one that stops the bleeding. If work stops after 002, the
  screenshot editor is *correct*, just still webview-rendered.
- **003** and **004** are what make motion mode reachable at all.
- **005** is the seam itself, and the point where the video editor becomes the
  next target rather than a separate product.

## Why this order and not "fix the canvas module"

There is no single canvas module to fix. The canvas is currently spread across
`layout.ts` (padding/aspect maths), `geometry.ts` (shape transforms),
`context.tsx` (state + renderer push), `AnnotationLayer.tsx` (interaction *and*
drawing), `screenshotExport.ts` (a second, independent drawing implementation)
and the `rendering` crate (a third). The plans below converge those onto one
model rather than tidying each in place.

## Deliberately not planned

- **Rewriting `geometry.ts`.** It is the strongest file in the directory —
  Penpot-derived four-corner maths, correct under rotation, honestly documented
  about what it deliberately omits (skew, non-uniform inherited scale). It
  needs its *inputs* re-spaced by 002, not a rewrite.
- **Rewriting `layout.ts`'s padding maths.** The aspect/padding solve is sound.
  What is missing is that its output rect is never fed back to annotations as
  an anchor — that is 002's job.
- **Touching the video editor's timeline.** Out of scope by the user's own
  sequencing: screenshot editor first, video editor only once this lands.
- **A ShotBase-style `Effects` timeline lane.** Belongs to the video work; 005
  only establishes that a `SceneObject` can carry timing, not the UI to edit it.
- **Web capture / hosted screenshot APIs.** ShotBase uses a third-party service
  for this; it is a product decision, not a canvas one.
