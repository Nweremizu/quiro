# 004 — Fix the mask shader: aspect-correct SDF, honour opacity

**Severity:** HIGH · **Status:** DONE (see Outcome) · **Depends on:** 003

> This plan file did not exist. The set's README indexed 004–007 but only
> 001–003 were ever written. This one was reconstructed from the README's
> finding #3 and from reading the shader, then executed. 005–007 are still
> index entries with no plan behind them.

## Problem

### The SDF ran in UV space on a non-square frame

`rect_mask` measured everything in UV (0..1 on both axes):

```wgsl
let delta = abs(uv - uniforms.rect_center) - half_size;
let outside_dist = length(outside);
let edge = max(uniforms.feather, 1e-4);
return clamp(smoothstep(0.0, edge, -sdf), 0.0, 1.0);
```

One UV unit across is 1920px on a 16:9 frame and one down is 1080px, so
`length()` mixed two different units. A feather that should be uniform came out
**~1.78x wider horizontally than vertically**, and the falloff was elliptical
in the wrong direction. `horizontal_blur_support` had the same defect.

The Rust side compounded it: `feather` was pre-multiplied by the normalized
region size (`min_axis * 0.5 * segment_feather`), which made it a *length* in
that same anisotropic space.

### Opacity was read by one branch out of four

`uniforms.opacity` appeared only in `MODE_HIGHLIGHT`. **Correction to the
README's framing:** this was not producing wrong output, because
`interpolate_masks` hard-codes `opacity = 1.0` for every obscuring mode and a
test asserts it. It was a latent inconsistency — a uniform that silently did
nothing for three of four modes — not a live bug.

### Nothing drew the shapes 003 added

`MaskShape` landed in the data model in 003 with rendering deferred to here.

## Outcome

### The SDF works in pixels

`region_sdf_px` converts to pixels before measuring anything, so every distance
is isotropic. `feather` is now a plain 0..1 fraction all the way through the
Rust side, resolved against the region's **shorter pixel axis** in the shader
where the frame size is actually known. Two tests pin it: that it passes
through unmodified, and that the same feather on the same region is identical
at 16:9, 9:16 and 1:1 — the property the old maths broke.

`horizontal_blur_support` was converted with it.

### Shapes render

One rounded-box SDF covers rect and rounded-rect (radius 0 degenerates to the
plain box); ellipse uses the standard cheap approximation, which is accurate
near the boundary — the only place the feather samples it. `shape` and
`corner_radius` took over the two existing padding slots in the uniform, so the
buffer layout is unchanged.

Both inspectors gained a shape picker, and `paintMasks` in the screenshot
editor honours shape too: `maskRegionPath` mirrors `region_sdf_px`, clipping
blur and pixelate and tracing the fill for redact and the punch-out for
spotlight. Without that the picker would have been a control that did nothing —
the same class of bug 003 found in the video editor's pixelation slider.

### Opacity is honoured uniformly

Pixelate and blur now multiply it into the mask. Behaviour is unchanged today
(the Rust side still forces 1.0 for those modes) but the uniform no longer
lies. **Redact deliberately ignores it** — a translucent redaction is not a
redaction — and that exception is commented at the branch.

### Shaders are now statically validated

WGSL is compiled by the driver at pipeline creation, so a broken shader was
invisible to `cargo test` and surfaced only at runtime on a user's machine.
`naga` — already in the tree via wgpu, now a direct dev-dependency — parses and
type-checks every `.wgsl` in the shaders directory as a test. It sweeps the
directory rather than listing files, so a new shader is covered on arrival.

I mutation-tested it: introducing a deliberate type error makes both tests
fail, so it is not passing vacuously.

## Headless GPU pixel tests

The two properties this plan and 003 could not verify are now verified, on real
rendered pixels, with no app and no GPU-having human.

`create_wgpu_instance` already requested adapters with
`compatible_surface: None`, and had a `force_fallback_adapter` software path
behind it — the pipeline never needed a window. `gpu_test_harness.rs` acquires
a device, and `mask.rs`'s `gpu_pixel_tests` render through the real `MaskLayer`
and read the bytes back. Tests skip rather than fail when no adapter exists at
all.

Seeding the source is a render pass that only clears: `RenderSession`'s
textures lack `COPY_DST`, and widening a production texture's usage flags to
suit a test would have been the wrong trade.

**Both assertions were mutation-tested**, which is the only reason they are
worth anything:

- Reintroducing the UV-space SDF makes the isotropy test fail with **16px of
  falloff across and 9px down** — a 1.78 ratio, exactly the frame's 16:9. That
  is direct measurement of the bug this plan fixed, not an inference from
  reading the shader.
- Leaking 1% of the source through the redaction makes the Redact test fail
  with `[2, 2, 2]` instead of `[0, 0, 0]`.

The isotropy test needed a second attempt. The first version measured where the
mask reached full strength, passed with the bug deliberately reintroduced, and
was worthless: converting the SDF to pixels scales `delta` and `half_size`
identically, so the region *boundary* is unchanged either way. What the old
maths distorted was the gradient's *width*. Measuring that is what makes the
test bite.

## Still not done

- **`corner_radius` is hard-coded to 0.25** of the shorter axis for
  `roundedRect` rather than being a user control. The field is plumbed end to
  end; only the UI is missing.
- **Ellipse SDF is an approximation.** Exact ellipse distance is iterative;
  this is accurate at the boundary and wrong in the interior, which does not
  matter for a mask but would if the value were ever used for anything else.
- **No end-to-end check of the app itself.** The pixel tests cover the mask
  pipeline; they say nothing about whether the editor's inspector wires up to
  it correctly. That needs the app driven for real — see the CDP notes in the
  README.
