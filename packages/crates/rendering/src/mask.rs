use quiro_project::{
    MaskMode, MaskScalarKeyframe, MaskSegment, MaskShape, MaskVectorKeyframe, XY,
    mask_effect_contract,
};

use crate::{MaskRenderMode, PreparedMask};

const MASK_EFFECT_BASE_HEIGHT: f32 = 1080.0;

fn interpolate_vector(base: XY<f64>, keys: &[MaskVectorKeyframe], time: f64) -> XY<f64> {
    if keys.is_empty() {
        return base;
    }

    let mut sorted = keys.to_vec();
    sorted.sort_by(|a, b| {
        a.time
            .partial_cmp(&b.time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if time <= sorted[0].time {
        return XY::new(sorted[0].x, sorted[0].y);
    }

    for window in sorted.windows(2) {
        let prev = &window[0];
        let next = &window[1];
        if time <= next.time {
            let span = (next.time - prev.time).max(1e-6);
            let t = ((time - prev.time) / span).clamp(0.0, 1.0);
            let x = prev.x + (next.x - prev.x) * t;
            let y = prev.y + (next.y - prev.y) * t;
            return XY::new(x, y);
        }
    }

    let last = sorted.last().unwrap();
    XY::new(last.x, last.y)
}

fn interpolate_scalar(base: f64, keys: &[MaskScalarKeyframe], time: f64) -> f64 {
    if keys.is_empty() {
        return base;
    }

    let mut sorted = keys.to_vec();
    sorted.sort_by(|a, b| {
        a.time
            .partial_cmp(&b.time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if time <= sorted[0].time {
        return sorted[0].value;
    }

    for window in sorted.windows(2) {
        let prev = &window[0];
        let next = &window[1];
        if time <= next.time {
            let span = (next.time - prev.time).max(1e-6);
            let t = ((time - prev.time) / span).clamp(0.0, 1.0);
            return prev.value + (next.value - prev.value) * t;
        }
    }

    sorted.last().map(|k| k.value).unwrap_or(base)
}

pub fn interpolate_masks(
    output_size: XY<u32>,
    frame_time: f64,
    segments: &[MaskSegment],
) -> Vec<PreparedMask> {
    let mut prepared = Vec::new();

    for segment in segments.iter().filter(|s| s.enabled) {
        if frame_time < segment.start || frame_time > segment.end {
            continue;
        }

        let relative_time = (frame_time - segment.start).max(0.0);

        let position =
            interpolate_vector(segment.center, &segment.keyframes.position, relative_time);
        let size = interpolate_vector(segment.size, &segment.keyframes.size, relative_time);
        let (mode, opacity, effect_amount) = match segment.mode {
            // Obscuring modes never blend with the source: a half-transparent
            // blur would leave the original legible underneath it.
            MaskMode::Blur => (
                MaskRenderMode::Blur,
                1.0,
                normalize_effect_amount(segment.amount),
            ),
            MaskMode::Pixelate => (
                MaskRenderMode::Pixelate,
                1.0,
                normalize_effect_amount(segment.amount),
            ),
            // Redaction has no strength to speak of — it is opaque or it is
            // not a redaction.
            MaskMode::Redact => (MaskRenderMode::Redact, 1.0, 0.0),
            MaskMode::Spotlight => {
                let mut intensity = interpolate_scalar(
                    segment.opacity,
                    &segment.keyframes.intensity,
                    relative_time,
                );
                let fade_duration = segment.fade_duration.max(0.0);
                if fade_duration > 0.0 {
                    let time_since_start = (frame_time - segment.start).max(0.0);
                    let time_until_end = (segment.end - frame_time).max(0.0);
                    let fade_in = (time_since_start / fade_duration).min(1.0);
                    let fade_out = (time_until_end / fade_duration).min(1.0);
                    intensity *= fade_in * fade_out;
                }
                (MaskRenderMode::Highlight, intensity.clamp(0.0, 1.0), 0.0)
            }
        };

        let clamped_size = XY::new(size.x.clamp(0.01, 2.0), size.y.clamp(0.01, 2.0));

        // Spotlight darkens the outside, so a feather would smear the boundary
        // rather than soften an obscured patch. Redact forces it to zero for a
        // stronger reason: a soft edge leaves partially-original pixels, which
        // would make the one mode that promises irreversibility leak.
        //
        // Passed through as a plain 0..1 fraction. It used to be multiplied by
        // the normalized region size here, which turned it into a UV-space
        // length — and UV space is stretched on any non-square frame, so the
        // edge came out ~1.78x wider horizontally than vertically at 16:9. The
        // shader now resolves it against the region's shorter *pixel* axis.
        let feather = match segment.mode {
            MaskMode::Spotlight | MaskMode::Redact => 0.0,
            MaskMode::Blur | MaskMode::Pixelate => segment.feather.max(0.0) as f32,
        };

        prepared.push(PreparedMask {
            center: XY::new(
                position.x.clamp(0.0, 1.0) as f32,
                position.y.clamp(0.0, 1.0) as f32,
            ),
            size: XY::new(
                clamped_size.x.clamp(0.0, 2.0) as f32,
                clamped_size.y.clamp(0.0, 2.0) as f32,
            ),
            feather,
            opacity: opacity as f32,
            effect_size: scaled_effect_size(output_size, effect_amount),
            darkness: segment.darkness.clamp(0.0, 1.0) as f32,
            mode,
            // Redaction is only guaranteed on a shape the SDF fills exactly.
            // It does, for all three — but keep the coupling explicit so a
            // future shape cannot silently inherit the promise.
            shape: segment.shape,
            corner_radius: match segment.shape {
                MaskShape::RoundedRect => 0.25,
                MaskShape::Rect | MaskShape::Ellipse => 0.0,
            },
            output_size,
        });
    }

    prepared
}

/// A mask annotation as a [`PreparedMask`], so it obscures through the same
/// shader as a timeline mask segment rather than a second implementation.
///
/// `None` for any other annotation type. Where a `MaskSegment` interpolates
/// keyframes over its own span, an annotation's geometry has already been
/// resolved by `crate::annotation` — so this only has to map the mode.
pub fn mask_from_annotation(
    prepared: &crate::annotation::PreparedAnnotation,
    output_size: XY<u32>,
) -> Option<PreparedMask> {
    let annotation = &prepared.annotation;
    if annotation.annotation_type != quiro_project::AnnotationType::Mask {
        return None;
    }

    let mode = annotation.mask_mode.unwrap_or(MaskMode::Blur);
    let (render_mode, opacity, effect_amount) = match mode {
        // Obscuring modes never blend with the source: a half-transparent blur
        // would leave the original legible underneath it. That holds for an
        // animating annotation too, so the envelope drives geometry only.
        MaskMode::Blur => (
            MaskRenderMode::Blur,
            1.0,
            normalize_effect_amount(annotation.mask_amount.unwrap_or(0.0)),
        ),
        MaskMode::Pixelate => (
            MaskRenderMode::Pixelate,
            1.0,
            normalize_effect_amount(annotation.mask_amount.unwrap_or(0.0)),
        ),
        MaskMode::Redact => (MaskRenderMode::Redact, 1.0, 0.0),
        // Spotlight darkens rather than obscures, so it is the one mode whose
        // strength the entrance/exit envelope may safely scale.
        MaskMode::Spotlight => (MaskRenderMode::Highlight, prepared.alpha, 0.0),
    };

    // `PreparedMask` is centre and size normalized against the *output*, while
    // the annotation has already been resolved to output pixels.
    let [x, y, width, height] = prepared.bounds;
    let (out_w, out_h) = (output_size.x as f32, output_size.y as f32);
    if out_w <= 0.0 || out_h <= 0.0 || width <= 0.0 || height <= 0.0 {
        return None;
    }

    let shape = annotation.mask_shape.unwrap_or(MaskShape::Rect);
    Some(PreparedMask {
        center: XY::new(
            ((x + width / 2.0) / out_w).clamp(0.0, 1.0),
            ((y + height / 2.0) / out_h).clamp(0.0, 1.0),
        ),
        size: XY::new((width / out_w).clamp(0.0, 2.0), (height / out_h).clamp(0.0, 2.0)),
        // Feather is suppressed for the same two reasons as a mask segment:
        // it would smear a spotlight's boundary, and it would leave partially
        // original pixels inside a redaction, breaking the one mode that
        // promises irreversibility.
        feather: match mode {
            MaskMode::Spotlight | MaskMode::Redact => 0.0,
            MaskMode::Blur | MaskMode::Pixelate => {
                annotation.mask_feather.unwrap_or(0.0).max(0.0) as f32
            }
        },
        opacity: opacity as f32,
        effect_size: scaled_effect_size(output_size, effect_amount),
        darkness: annotation.mask_darkness.unwrap_or(0.0).clamp(0.0, 1.0) as f32,
        mode: render_mode,
        shape,
        corner_radius: match shape {
            MaskShape::RoundedRect => 0.25,
            MaskShape::Rect | MaskShape::Ellipse => 0.0,
        },
        output_size,
    })
}

fn normalize_effect_amount(amount: f64) -> f64 {
    let contract = mask_effect_contract();
    if amount <= 0.0 {
        contract.default_amount
    } else {
        amount.clamp(contract.min_amount, contract.max_amount)
    }
}

fn scaled_effect_size(output_size: XY<u32>, amount: f64) -> f32 {
    let resolution_scale = output_size.y as f32 / MASK_EFFECT_BASE_HEIGHT;
    amount as f32 * resolution_scale
}

#[cfg(test)]
mod annotation_conversion_tests {
    use super::*;
    use crate::annotation::{AnchorRects, prepare_annotation};
    use quiro_project::{Annotation, AnnotationAnchor, AnnotationType};

    const OUT: XY<u32> = XY { x: 1000, y: 500 };

    fn anchors() -> AnchorRects {
        AnchorRects {
            capture: [0.0, 0.0, 1000.0, 500.0],
            canvas: [0.0, 0.0, 1000.0, 500.0],
        }
    }

    fn mask_annotation(mode: MaskMode) -> Annotation {
        Annotation {
            id: "m".into(),
            annotation_type: AnnotationType::Mask,
            x: 0.25,
            y: 0.25,
            width: 0.5,
            height: 0.5,
            stroke_color: "transparent".into(),
            stroke_width: 0.0,
            fill_color: "transparent".into(),
            opacity: 1.0,
            rotation: 0.0,
            text: None,
            mask_mode: Some(mode),
            mask_amount: Some(18.0),
            mask_shape: Some(MaskShape::Rect),
            mask_feather: Some(0.1),
            mask_darkness: Some(0.5),
            mask_corner_radius: None,
            focus: None,
            arrow_curve: None,
            arrow_bend: None,
            arrow_start_head: None,
            arrow_end_head: None,
            arrow_head_size: None,
            line_style: None,
            arrow_taper: None,
            text_content: None,
            timing: None,
            anchor: AnnotationAnchor::Capture,
        }
    }

    fn convert(annotation: &Annotation) -> Option<PreparedMask> {
        let prepared = prepare_annotation(annotation, anchors(), 0.0)?;
        mask_from_annotation(&prepared, OUT)
    }

    #[test]
    fn only_mask_annotations_convert() {
        let mut other = mask_annotation(MaskMode::Blur);
        other.annotation_type = AnnotationType::Rectangle;

        assert!(convert(&other).is_none());
        assert!(convert(&mask_annotation(MaskMode::Blur)).is_some());
    }

    /// The annotation is resolved to output pixels; `PreparedMask` wants centre
    /// and size normalized against the output. A slip here would put the mask
    /// somewhere other than where the editor drew it.
    #[test]
    fn geometry_converts_to_output_normalized_centre_and_size() {
        let mask = convert(&mask_annotation(MaskMode::Blur)).unwrap();

        assert_eq!(mask.center, XY::new(0.5, 0.5));
        assert_eq!(mask.size, XY::new(0.5, 0.5));
        assert_eq!(mask.output_size, OUT);
    }

    /// **The security property, inherited.** A redaction promises the original
    /// is unrecoverable, and a feathered edge leaves partially-original pixels.
    /// Annotations must not be a way around that.
    #[test]
    fn redact_and_spotlight_suppress_feather() {
        for mode in [MaskMode::Redact, MaskMode::Spotlight] {
            let mask = convert(&mask_annotation(mode)).unwrap();
            assert_eq!(mask.feather, 0.0, "{mode:?} must not feather");
        }

        for mode in [MaskMode::Blur, MaskMode::Pixelate] {
            let mask = convert(&mask_annotation(mode)).unwrap();
            assert!(mask.feather > 0.0, "{mode:?} should keep its feather");
        }
    }

    /// Obscuring modes stay fully opaque even mid-animation — a half-faded
    /// blur would leave the thing it is hiding legible underneath.
    #[test]
    fn only_spotlight_takes_the_animation_envelope() {
        for mode in [MaskMode::Blur, MaskMode::Pixelate, MaskMode::Redact] {
            let mut annotation = mask_annotation(mode);
            annotation.opacity = 0.3;
            let mask = convert(&annotation).unwrap();
            assert_eq!(mask.opacity, 1.0, "{mode:?} must stay opaque");
        }

        let mut spotlight = mask_annotation(MaskMode::Spotlight);
        spotlight.opacity = 0.3;
        let mask = convert(&spotlight).unwrap();
        assert!((mask.opacity - 0.3).abs() < 1e-6);
    }

    #[test]
    fn shape_selects_its_corner_radius() {
        let mut rounded = mask_annotation(MaskMode::Blur);
        rounded.mask_shape = Some(MaskShape::RoundedRect);

        assert_eq!(convert(&rounded).unwrap().corner_radius, 0.25);
        assert_eq!(
            convert(&mask_annotation(MaskMode::Blur)).unwrap().corner_radius,
            0.0
        );
    }

    /// A mask annotation outside its timing window must not obscure anything.
    #[test]
    fn a_mask_outside_its_span_does_not_convert() {
        let mut annotation = mask_annotation(MaskMode::Redact);
        annotation.timing = Some(quiro_project::AnnotationTiming {
            start: 5.0,
            end: 6.0,
            track: 0,
            enter: quiro_project::AnnotationAnimation::None,
            exit: quiro_project::AnnotationAnimation::None,
            enter_duration: 0.0,
            exit_duration: 0.0,
        });

        assert!(convert(&annotation).is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_segment() -> MaskSegment {
        MaskSegment {
            start: 0.0,
            end: 10.0,
            track: 0,
            enabled: true,
            mode: MaskMode::Pixelate,
            amount: 18.0,
            shape: Default::default(),
            center: XY::new(0.5, 0.5),
            size: XY::new(0.25, 0.25),
            feather: 0.1,
            opacity: 1.0,
            darkness: 0.5,
            fade_duration: 0.0,
            keyframes: Default::default(),
        }
    }

    #[test]
    fn obscuring_mask_effect_scales_with_output_height() {
        let segment = sample_segment();
        let smaller = interpolate_masks(XY::new(872, 720), 1.0, std::slice::from_ref(&segment));
        let low = interpolate_masks(XY::new(1308, 1080), 1.0, std::slice::from_ref(&segment));
        let high = interpolate_masks(XY::new(2616, 2160), 1.0, &[segment]);

        assert_eq!(smaller.len(), 1);
        assert_eq!(low.len(), 1);
        assert_eq!(high.len(), 1);
        assert_eq!(smaller[0].effect_size, 12.0);
        assert_eq!(low[0].effect_size, 18.0);
        assert_eq!(high[0].effect_size, 36.0);
    }

    #[test]
    fn obscuring_mask_never_blends_with_source_content() {
        let mut segment = sample_segment();
        segment.opacity = 0.01;
        segment.keyframes.intensity.push(MaskScalarKeyframe {
            time: 1.0,
            value: 0.01,
        });

        let masks = interpolate_masks(XY::new(1920, 1080), 1.0, &[segment]);

        assert_eq!(masks[0].opacity, 1.0);
        assert_eq!(masks[0].mode, MaskRenderMode::Pixelate);
    }

    #[test]
    fn mode_is_read_from_the_enum_not_from_the_amount() {
        // The amount no longer carries a discriminant, so a large value is
        // just a large value — it clamps, it does not become a blur.
        for (mode, amount, expected_mode, expected_size) in [
            (MaskMode::Pixelate, 18.0, MaskRenderMode::Pixelate, 18.0),
            (MaskMode::Blur, 4.0, MaskRenderMode::Blur, 4.0),
            (MaskMode::Blur, 24.0, MaskRenderMode::Blur, 24.0),
            (MaskMode::Pixelate, 1024.0, MaskRenderMode::Pixelate, 80.0),
        ] {
            let mut segment = sample_segment();
            segment.mode = mode;
            segment.amount = amount;

            let masks = interpolate_masks(XY::new(1920, 1080), 1.0, &[segment]);

            assert_eq!(masks[0].mode, expected_mode);
            assert_eq!(masks[0].effect_size, expected_size);
            assert_eq!(masks[0].opacity, 1.0);
        }
    }

    /// Redaction promises that no source pixel survives. A feathered edge
    /// would blend originals back in at the boundary, so the mode must force
    /// the feather to zero however the segment was configured.
    #[test]
    fn redact_is_opaque_and_never_feathered() {
        let mut segment = sample_segment();
        segment.mode = MaskMode::Redact;
        segment.feather = 0.9;

        let masks = interpolate_masks(XY::new(1920, 1080), 1.0, &[segment]);

        assert_eq!(masks[0].mode, MaskRenderMode::Redact);
        assert_eq!(masks[0].opacity, 1.0);
        assert_eq!(masks[0].feather, 0.0, "redact must not feather");
    }

    /// Feather is now a plain 0..1 fraction, passed through untouched. It used
    /// to be pre-multiplied by the normalized region size, which made it a
    /// length in UV space — and UV space is stretched by the frame's aspect,
    /// so one value meant ~1.78x more pixels across than down at 16:9. The
    /// shader resolves it against the region's shorter pixel axis instead.
    #[test]
    fn feather_is_passed_through_as_a_fraction() {
        let mut segment = sample_segment();
        segment.mode = MaskMode::Blur;
        segment.feather = 0.35;

        let masks = interpolate_masks(XY::new(1920, 1080), 1.0, &[segment]);

        assert_eq!(masks[0].feather, 0.35);
    }

    /// The same feather on the same region must survive a change of frame
    /// aspect ratio, since it is a fraction of the region rather than of the
    /// frame. This is the property the old UV-space maths broke.
    #[test]
    fn feather_does_not_depend_on_frame_aspect() {
        let mut segment = sample_segment();
        segment.mode = MaskMode::Blur;
        segment.feather = 0.2;

        let wide = interpolate_masks(XY::new(1920, 1080), 1.0, std::slice::from_ref(&segment));
        let tall = interpolate_masks(XY::new(1080, 1920), 1.0, std::slice::from_ref(&segment));
        let square = interpolate_masks(XY::new(1080, 1080), 1.0, &[segment]);

        assert_eq!(wide[0].feather, tall[0].feather);
        assert_eq!(wide[0].feather, square[0].feather);
    }

    #[test]
    fn shape_reaches_the_renderer_with_a_radius_only_for_rounded_rects() {
        for (shape, expects_radius) in [
            (MaskShape::Rect, false),
            (MaskShape::Ellipse, false),
            (MaskShape::RoundedRect, true),
        ] {
            let mut segment = sample_segment();
            segment.shape = shape;

            let masks = interpolate_masks(XY::new(1920, 1080), 1.0, &[segment]);

            assert_eq!(masks[0].shape, shape);
            assert_eq!(masks[0].corner_radius > 0.0, expects_radius, "{shape:?}");
        }
    }

    #[test]
    fn a_zero_amount_uses_a_visible_safe_default() {
        let mut segment = sample_segment();
        segment.amount = 0.0;

        let masks = interpolate_masks(XY::new(1920, 1080), 1.0, &[segment]);

        assert_eq!(masks[0].mode, MaskRenderMode::Pixelate);
        assert_eq!(masks[0].effect_size, 16.0);
    }
}

#[cfg(test)]
mod shader_validation_tests {
    //! WGSL is compiled by the driver at pipeline creation, so a syntax or
    //! type error in a shader is invisible to `cargo test` and only surfaces
    //! when that pipeline is first built — at runtime, on a user's machine.
    //!
    //! naga is what wgpu itself uses to parse and validate WGSL, and it needs
    //! no GPU. Running it here turns "the shader is broken" from a runtime
    //! panic into a failing test.
    //!
    //! This checks that the shaders parse and type-check. It cannot check that
    //! they *look* right — the aspect-correct SDF still wants eyes on it.

    use naga::valid::{Capabilities, ValidationFlags, Validator};

    fn validate(name: &str, source: &str) {
        let module = naga::front::wgsl::parse_str(source).unwrap_or_else(|error| {
            panic!("{name} failed to parse:\n{}", error.emit_to_string(source))
        });

        Validator::new(ValidationFlags::all(), Capabilities::all())
            .validate(&module)
            .unwrap_or_else(|error| panic!("{name} failed validation: {error:?}"));
    }

    #[test]
    fn mask_shader_parses_and_validates() {
        validate("mask.wgsl", include_str!("shaders/mask.wgsl"));
    }

    #[test]
    fn every_shader_parses_and_validates() {
        // A directory sweep rather than a list, so a new shader is covered the
        // moment it is added rather than when someone remembers to add it.
        for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/src/shaders"))
            .expect("shaders directory")
        {
            let path = entry.expect("readable entry").path();
            if path.extension().and_then(|e| e.to_str()) != Some("wgsl") {
                continue;
            }
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let source = std::fs::read_to_string(&path).expect("readable shader");
            validate(&name, &source);
        }
    }
}

#[cfg(test)]
mod gpu_pixel_tests {
    //! Rendered-pixel assertions, run headlessly through the real pipeline.
    //!
    //! These exist because two of this module's guarantees cannot be checked
    //! any other way. `Redact` promises no source pixel survives — a security
    //! claim, so it is tested as one, on the decoded output rather than by
    //! reading the shader. And the feather is supposed to be isotropic now
    //! that the SDF works in pixels; the only honest way to show that is to
    //! measure the falloff along both axes of a non-square frame.

    use super::*;
    use crate::frame_pipeline::RenderSession;
    use crate::gpu_test_harness::GpuHarness;
    use crate::layers::MaskLayer;

    const W: u32 = 320;
    const H: u32 = 180; // 16:9 — the aspect the old UV-space SDF skewed.

    /// The source every test starts from. Opaque white, so anything the mask
    /// does to it is unambiguous.
    const SOURCE: wgpu::Color = wgpu::Color {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };

    fn render(harness: &GpuHarness, mask: PreparedMask) -> Vec<[u8; 4]> {
        let mut session = RenderSession::new(&harness.device, W, H);
        harness.fill(&session, SOURCE);

        let layer = MaskLayer::new(&harness.device);
        let mut encoder = harness
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("mask pixel test"),
            });
        layer.render(
            &harness.device,
            &harness.queue,
            &mut session,
            &mut encoder,
            &mask,
        );
        harness.queue.submit(Some(encoder.finish()));

        harness.read_pixels(&session, W, H)
    }

    fn base_mask(mode: MaskRenderMode) -> PreparedMask {
        PreparedMask {
            center: XY::new(0.5, 0.5),
            size: XY::new(0.4, 0.4),
            feather: 0.0,
            opacity: 1.0,
            effect_size: 16.0,
            darkness: 0.0,
            mode,
            shape: MaskShape::Rect,
            corner_radius: 0.0,
            output_size: XY::new(W, H),
        }
    }

    fn at(pixels: &[[u8; 4]], x: u32, y: u32) -> [u8; 4] {
        pixels[(y * W + x) as usize]
    }

    /// **The security property.** Inside a redacted region every pixel must be
    /// the fill colour and nothing else. Not "mostly", not "close to" — the
    /// whole point of the mode is that the original is unrecoverable, and a
    /// single surviving pixel would falsify that.
    #[test]
    fn redact_leaves_no_source_pixel_inside_the_region() {
        let Some(harness) = GpuHarness::new() else {
            eprintln!("no wgpu adapter available; skipping");
            return;
        };

        let pixels = render(&harness, base_mask(MaskRenderMode::Redact));

        // The region is 40% of each axis, centred. Sample strictly inside it
        // so the boundary texel is not in question.
        let x0 = (W as f32 * 0.31) as u32;
        let x1 = (W as f32 * 0.69) as u32;
        let y0 = (H as f32 * 0.31) as u32;
        let y1 = (H as f32 * 0.69) as u32;

        let mut distinct = std::collections::BTreeSet::new();
        for y in y0..=y1 {
            for x in x0..=x1 {
                let [r, g, b, _] = at(&pixels, x, y);
                distinct.insert([r, g, b]);
            }
        }

        assert_eq!(
            distinct.len(),
            1,
            "redacted region must hold exactly one colour, found {} — the source is leaking through",
            distinct.len()
        );
        assert_eq!(
            *distinct.iter().next().unwrap(),
            [0, 0, 0],
            "redaction must be opaque black"
        );
    }

    /// Outside the region the frame must be untouched — a redaction that
    /// darkened the whole image would pass the test above for the wrong reason.
    #[test]
    fn redact_leaves_the_rest_of_the_frame_alone() {
        let Some(harness) = GpuHarness::new() else {
            eprintln!("no wgpu adapter available; skipping");
            return;
        };

        let pixels = render(&harness, base_mask(MaskRenderMode::Redact));

        for (x, y) in [(2, 2), (W - 3, 2), (2, H - 3), (W - 3, H - 3)] {
            let actual = at(&pixels, x, y);
            assert_eq!(
                [actual[0], actual[1], actual[2]],
                [255, 255, 255],
                "corner ({x}, {y}) should still be untouched source"
            );
        }
    }

    /// **The aspect-correctness property.** The feather is a fraction of the
    /// region's shorter axis, so on a 16:9 frame with a region that is square
    /// in pixels the falloff must be the same width horizontally and
    /// vertically. The old UV-space SDF made it ~1.78x wider across than down.
    #[test]
    fn feather_falloff_is_isotropic_on_a_non_square_frame() {
        let Some(harness) = GpuHarness::new() else {
            eprintln!("no wgpu adapter available; skipping");
            return;
        };

        // A region that is square in *pixels*: 0.25 of 320 = 80 across,
        // and the same 80 down. Spotlight darkens everything outside it, so
        // the feather shows up as a gradient measurable against a flat source.
        let mut mask = base_mask(MaskRenderMode::Highlight);
        mask.size = XY::new(0.25, 80.0 / H as f32);
        mask.feather = 0.5;
        mask.darkness = 1.0;

        let pixels = render(&harness, mask);

        // Measure the GRADIENT WIDTH, not the boundary position.
        //
        // The boundary is the same either way: converting the SDF to pixels
        // scales `delta` and `half_size` identically, so the region lands in
        // the same place. What the UV-space maths distorted was how far the
        // falloff *spans* — which is the thing to measure. An earlier version
        // of this test checked the boundary, passed with the bug deliberately
        // reintroduced, and was therefore worthless.
        let cx = W / 2;
        let cy = H / 2;
        let untouched = |p: [u8; 4]| p[0] > 247;
        let fully_dark = |p: [u8; 4]| p[0] < 8;

        let span = |samples: Vec<[u8; 4]>| -> Option<u32> {
            let start = samples.iter().position(|&p| !untouched(p))?;
            let end = samples.iter().position(|&p| fully_dark(p))?;
            (end > start).then(|| (end - start) as u32)
        };

        let horizontal = span((cx..W).map(|x| at(&pixels, x, cy)).collect());
        let vertical = span((cy..H).map(|y| at(&pixels, cx, y)).collect());

        let (horizontal, vertical) = match (horizontal, vertical) {
            (Some(h), Some(v)) => (h, v),
            other => panic!("could not measure the falloff on both axes: {other:?}"),
        };

        let difference = horizontal.abs_diff(vertical);
        assert!(
            difference <= 3,
            "feather width should match on both axes, got {horizontal}px across and              {vertical}px down (difference {difference}px). The UV-space SDF this replaced              stretched the horizontal one by roughly the frame's 16:9 aspect."
        );
    }
}
