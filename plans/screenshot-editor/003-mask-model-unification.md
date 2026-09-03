# 003 — Unify the mask model and kill the `+1000` encoding

**Severity:** HIGH · **Status:** DONE (see Outcome) · **Blocks:** 004, 006

## Problem

The mask system carries three overlapping taxonomies and one genuinely bad
encoding.

### The `+1000` discriminant

`MaskSegment` has no field saying whether it blurs or pixelates. Instead, the
mode is smuggled inside the `pixelation` float by adding a magic offset
(`rendering/src/mask.rs:148`):

```rust
if stored_effect >= contract.blur_encoding_offset {
    (MaskRenderMode::Blur, normalize_effect_amount(stored_effect - contract.blur_encoding_offset))
} else {
    (MaskRenderMode::Pixelate, normalize_effect_amount(stored_effect))
}
```

with `blurEncodingOffset: 1000` in `packages/crates/project/mask-effects.json`.
So `pixelation: 1016.0` means *blur at strength 16* and `pixelation: 16.0` means
*pixelate at 16*. The type system cannot help, the JSON is unreadable by a human,
and any UI that clamps `pixelation` to `maxAmount: 80` silently converts a blur
into a pixelate.

### Three taxonomies for one concept

| Where | Type | Variants |
| --- | --- | --- |
| `MaskSegment.mask_type` | `MaskKind` | `Sensitive`, `Highlight` |
| `Annotation.mask_type` | `MaskType` | `Blur`, `Pixelate` |
| `mask.wgsl` | `mode: u32` | `PIXELATE`, `HIGHLIGHT`, `BLUR_HORIZONTAL`, `BLUR_VERTICAL` |

`Sensitive` is not a mode, it is a *category* that then needs the `+1000` hack to
resolve into an actual mode. The screenshot editor's `MaskType` has the real
modes but is missing highlight entirely.

### What is missing

- **Shape.** `rect_mask` in `mask.wgsl` is a box SDF. No ellipse, no rounded
  rect, no freeform. A capture tool needs at least ellipse for faces/avatars.
- **Irreversible redaction.** Both current modes are recoverable in principle —
  gaussian blur is deconvolvable, and a downscale-upscale pixelate leaks the
  average of each block. A screenshot tool that redacts credentials needs a
  provably irreversible option: solid fill.
- The screenshot path has no `feather`, `opacity`, or `darkness` at all —
  `Annotation` only carries `mask_type` and `mask_level`.

## Change

One enum, one amount, one shape, used by both paths.

```rust
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MaskMode {
    /// Separable gaussian. Obscures, does not guarantee irreversibility.
    #[default]
    Blur,
    /// Nearest-neighbour block averaging.
    Pixelate,
    /// Opaque fill. The only mode safe for credentials — no source pixels survive.
    Redact,
    /// Darkens everything outside the region instead of obscuring inside it.
    Spotlight,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MaskShape {
    #[default]
    Rect,
    Ellipse,
    RoundedRect,
}
```

`Spotlight` replaces `MaskKind::Highlight` — the old name reads as "highlighter
pen" (draw *on* the region) when the shader actually darkens everything *outside*
it. Rename it to what it does.

### Migration

In `ProjectConfiguration::load`, gated on a `mask_model_version`:

- `MaskKind::Highlight` → `MaskMode::Spotlight`, `amount` unchanged.
- `MaskKind::Sensitive` with `pixelation >= 1000` → `MaskMode::Blur`,
  `amount = pixelation - 1000`.
- `MaskKind::Sensitive` with `pixelation < 1000` → `MaskMode::Pixelate`,
  `amount = pixelation`.
- `Annotation.mask_type: Blur|Pixelate` → the matching `MaskMode`;
  `mask_level` → `amount`.

Then **delete `blurEncodingOffset` from `mask-effects.json`** and the branch in
`mask.rs`. Keep `defaultAmount` / `minAmount` / `maxAmount` — that contract is
fine and is shared with the UI sliders.

Add `shape`, `feather`, `opacity` and `corner_radius` to the annotation mask
payload so the screenshot path reaches parity with the video path. All
`#[serde(default)]`.

### `Redact` is not optional

It is the only mode that is actually safe, and it is one shader branch (`return
vec4(fill_rgb, base.a)` inside the mask). Ship it in the same change or the
product keeps telling users it redacted something when it blurred it.

## Files

- `packages/crates/project/src/configuration.rs` — `MaskMode`, `MaskShape`, the
  new annotation mask fields, the migration.
- `packages/crates/project/mask-effects.json` — drop `blurEncodingOffset`.
- `packages/crates/rendering/src/mask.rs` — delete `sensitive_effect`; read the
  enum directly.
- `apps/desktop/src/routes/screenshot-editor/AnnotationConfig.tsx`,
  `apps/desktop/src/routes/editor/SegmentConfig.tsx` — mode pickers, shape
  picker, and the copy that tells the user which modes are reversible.

## Acceptance

- `grep -r 1000 packages/crates/rendering/src/mask.rs` returns nothing.
- A pre-migration project with `pixelation: 1016.0` loads as
  `{ mode: Blur, amount: 16.0 }` and renders identically to before.
- A `Redact` mask exported to PNG contains exactly one colour inside the region
  (assert on the decoded pixels in a test — this is a security property, not a
  visual one, so test it as such).
- Screenshot and video mask inspectors offer the same four modes.

## Risks

- **Ordering with 001.** Both add a version field and a migration branch to
  `load`. Land 001 first and follow its shape, or the two migrations will fight
  over the write-back.
- **The `Spotlight` rename is user-visible** if any preset or saved config names
  the variant. Check `presets.rs` before renaming.

## Outcome

Done, both halves. Two live bugs found and fixed along the way, and one unit
mismatch that neither this plan nor 001 had spotted.

### Two live bugs found while building it

Worse than the plan predicted, and both now fixed:

1. **No TypeScript anywhere wrote the `+1000` encoding.** `MaskRenderMode::Blur`
   was unreachable from the UI. The option labelled *"Blur sensitive area"*
   always pixelated.
2. **The pixelation slider was `min 0, max 1`** while the renderer read the
   contract's 4..80. `normalize_effect_amount(0.5)` clamped to `4`, so dragging
   that slider from 1% to 100% did nothing at all.

The second one shaped the migration. Because almost every real config holds
slider garbage rather than a meaningful amount, migrating the *stored number*
would have changed how existing projects look. The migration instead runs the
old reader's semantics — `normalize_effect_amount` reproduced exactly — so a
migrated project renders identically. There is a test named for this.

### Done

- `MaskMode { Blur, Pixelate, Redact, Spotlight }` and
  `MaskShape { Rect, Ellipse, RoundedRect }`, with
  `MaskMode::is_reversible()` driving the inspector's warning copy.
- `MaskSegment` carries `mode` / `amount` / `shape`; `mask_type` and
  `pixelation` are gone, and `MaskKind` is deleted outright — it was dead.
- `mask_model_version` + `migrate_mask_model`, which reads the legacy values
  out of the **raw JSON** (the fields no longer exist on the struct) the same
  way the camera migration does. Six tests, including a second-load check that
  the rewritten file does not re-migrate.
- `blurEncodingOffset` deleted from `mask-effects.json` and the contract
  struct. `grep 1000 packages/crates/rendering/src/mask.rs` returns nothing —
  the plan's acceptance criterion.
- `Redact` end to end: enum, layer dispatch, `MODE_REDACT` in `mask.wgsl`.
  It uses `select`, not `mix`, and `interpolate_masks` forces its feather to
  zero — a soft edge would leave partially-original pixels and break the only
  promise the mode makes.
- Inspector rewritten: four modes, an amount slider in the contract's real
  units, feather hidden for Redact, darkness shown only for Spotlight, and a
  line of copy telling the user blur and pixelate are recoverable.

### The annotation half

- `Annotation.mask_type`/`mask_level` are gone. In their place: `mask_mode`
  (the shared [`MaskMode`]), `mask_amount`, `mask_shape`, `mask_feather`,
  `mask_darkness`, `mask_corner_radius`.
- **Serde aliases did the migration**, not a raw-JSON walk. The legacy
  `maskType` values were *already* valid `MaskMode` variants (`blur`,
  `pixelate`), so `#[serde(alias = "maskType")]` on `mask_mode` and
  `alias = "maskLevel"` on `mask_amount` read old files directly. That removed
  the index-matched walk this plan's sketch implied, and with it the risk of
  mismatching a segment to the wrong annotation. A test asserts that writing
  uses the new keys, so the migration settles.
- `validate()` now exempts `Redact` and `Spotlight` from needing an amount —
  one is opaque or it is not a redaction, the other is driven by `darkness` —
  and the exclusivity check covers all six new fields, not just two.
- The stale error variants were renamed with the fields
  (`MaskTypeMissing` → `MaskModeMissing`, and so on); their messages named
  JSON keys that no longer exist.

### The unit mismatch nobody had noticed

`mask_level` was in **frame pixels**; `MaskSegment::amount` is
**1080p-relative** and scaled by output height at render time. At a 1080-tall
frame the two coincide exactly, which is why unifying the enum without
unifying the units would have quietly changed how masks look at every other
frame size.

The conversion needs the frame height, so it went into
`migrate_annotation_space` — which has it — as a second version step:
`ANNOTATION_SPACE_VERSION` is now 2, with v0→1 normalizing geometry and v1→2
converting mask strength. A project already migrated by 001 still picks up the
units conversion. This also closes the `maskLevel` follow-up that 001 left
open, and `scaleAnnotations` no longer touches the amount, because it is now
resolution-independent by construction.

### Frontend

Both inspectors offer the same four modes with the same reversibility warning —
the plan's last acceptance criterion. `paintMasks` resolves the 1080p-relative
amount against the canvas it is painting on, and gained two branches:
`redact` (opaque black, hard-edged, no blend) and `spotlight` (even-odd fill
over the capture with the region punched out). A new mask defaults to Blur;
Redact is opt-in.

### Still not done

- ~~**The Redact pixel test.**~~ **Done in 004.** The harness that was missing
  now exists (`gpu_test_harness.rs`), and
  `mask::gpu_pixel_tests::redact_leaves_no_source_pixel_inside_the_region`
  asserts the region holds exactly one colour and that it is black, on real
  rendered pixels. Mutation-tested: a 1% source leak fails it. The guarantee
  no longer rests on code review.
- **Shape rendering.** `MaskShape` and `mask_corner_radius` exist in the data
  model and nothing draws an ellipse or a rounded rect yet. That is 004's
  shader rewrite; the fields were added now so it is not a second migration.
- **Fill colour is hard-coded black** in both the shader and the Canvas2D path.
  The plan's sketch implies a configurable `fill_rgb`; not added.
- **Screenshot masks still paint in Canvas2D**, not through the GPU mask layer.
  That is plan 006, which this change was the prerequisite for.
