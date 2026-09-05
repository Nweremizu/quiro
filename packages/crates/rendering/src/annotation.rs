//! Resolving `Annotation`s into something the GPU layer can draw.
//!
//! This is the half of the annotation pipeline that has no GPU in it: taking
//! the stored document — normalized 0..1 geometry, optional timing, an anchor —
//! and producing pixel rects, alphas and transforms for one frame at one time.
//! Keeping it separate is what makes it testable, and the geometry here is
//! exactly the part that has to agree with the frontend's SVG overlay, so it
//! wants tests far more than the shader does.
//!
//! The counterpart on the TypeScript side is `screenshot-editor/space.ts`:
//! `resolveAnnotation` does the same anchor multiply there, against the same
//! two rects. Divergence between the two shows up as an annotation that shifts
//! when you export it, so the two must stay in step — see
//! `docs/canvas-unification.md` §4.2.

use quiro_project::{Annotation, AnnotationAnchor, AnnotationAnimation, AnnotationTiming};

/// One annotation, resolved to output pixels for a single frame.
#[derive(Debug, Clone)]
pub struct PreparedAnnotation {
    pub annotation: Annotation,
    /// `[x, y, width, height]` in output pixels, after anchor resolution and
    /// after any entrance/exit transform.
    pub bounds: [f32; 4],
    /// Stroke width in output pixels. Normalized against the anchor's *height*
    /// only, matching `space.ts`'s `resolveAxial` — scaling it by both axes
    /// would change how thick a line looks whenever the aspect ratio changed.
    pub stroke_width: f32,
    /// The annotation's own opacity multiplied by its animation envelope.
    pub alpha: f32,
    /// 0..1 through a Typewriter entrance; `1.0` for every other animation, so
    /// a caller can always multiply a glyph count by it.
    pub reveal: f32,
}

/// The rect an annotation's normalized coordinates are measured against.
///
/// `capture` is the displayed capture's placement in output pixels, which
/// already has zoom and pan folded into it — that is what makes a
/// [`AnnotationAnchor::Capture`] callout track the thing it points at through
/// a zoom, with no per-annotation zoom maths anywhere.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnchorRects {
    pub capture: [f32; 4],
    pub canvas: [f32; 4],
}

impl AnchorRects {
    pub fn rect_for(&self, anchor: AnnotationAnchor) -> [f32; 4] {
        match anchor {
            AnnotationAnchor::Capture => self.capture,
            AnnotationAnchor::Canvas => self.canvas,
        }
    }
}

/// How far into an entrance (or out of an exit) `time` sits, as 0..1.
///
/// Zero-length and inverted transitions collapse to "fully in" rather than
/// dividing by zero, so a duration a user has dragged to 0 means "no
/// animation" instead of a NaN that silently blanks the frame.
fn envelope_progress(elapsed: f64, duration: f64) -> f32 {
    if !(duration > 0.0) {
        return 1.0;
    }
    (elapsed / duration).clamp(0.0, 1.0) as f32
}

/// Smoothstep. The entrance curves want *some* easing or they read as a jump
/// at both ends; this is the cheapest one that is C¹ continuous.
fn ease(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

/// Alpha, offset and scale contributed by one end of a transition.
///
/// `progress` runs 0→1 as the annotation becomes fully present, whichever end
/// it is: an exit passes `1 - progress` so both ends share one table.
fn animation_transform(animation: AnnotationAnimation, progress: f32) -> (f32, [f32; 2], f32) {
    let eased = ease(progress);
    // Slides travel a fraction of the annotation's own size, so a small badge
    // and a full-width lower-third both look like they came from the same
    // distance rather than the badge barely moving.
    let travel = 1.0 - eased;
    match animation {
        AnnotationAnimation::None => (1.0, [0.0, 0.0], 1.0),
        AnnotationAnimation::Fade => (eased, [0.0, 0.0], 1.0),
        // Typewriter is a reveal, not a transform: alpha stays at full so the
        // glyphs that *have* arrived are solid.
        AnnotationAnimation::Typewriter => (1.0, [0.0, 0.0], 1.0),
        AnnotationAnimation::SlideLeft => (eased, [-travel, 0.0], 1.0),
        AnnotationAnimation::SlideRight => (eased, [travel, 0.0], 1.0),
        AnnotationAnimation::SlideTop => (eased, [0.0, -travel], 1.0),
        AnnotationAnimation::SlideBottom => (eased, [0.0, travel], 1.0),
        AnnotationAnimation::Scale => (eased, [0.0, 0.0], 0.6 + 0.4 * eased),
    }
}

/// Which end of the clip `time` is in, and how far through it.
///
/// An entrance and an exit that overlap — a clip shorter than its own
/// transitions — resolve in the entrance's favour, because an annotation that
/// never becomes fully visible is less confusing than one that flickers.
fn envelope(timing: &AnnotationTiming, time: f64) -> (f32, [f32; 2], f32, f32) {
    let entering = envelope_progress(time - timing.start, timing.enter_duration);
    if entering < 1.0 {
        let (alpha, offset, scale) = animation_transform(timing.enter, entering);
        let reveal = match timing.enter {
            AnnotationAnimation::Typewriter => ease(entering),
            _ => 1.0,
        };
        return (alpha, offset, scale, reveal);
    }

    let leaving = envelope_progress(timing.end - time, timing.exit_duration);
    if leaving < 1.0 {
        let (alpha, offset, scale) = animation_transform(timing.exit, leaving);
        return (alpha, offset, scale, 1.0);
    }

    (1.0, [0.0, 0.0], 1.0, 1.0)
}

/// Resolves one annotation against its anchor, or `None` when it is not on
/// screen at `time` or has been animated to nothing.
pub fn prepare_annotation(
    annotation: &Annotation,
    anchors: AnchorRects,
    time: f64,
) -> Option<PreparedAnnotation> {
    if !annotation.visible_at(time) {
        return None;
    }

    let (alpha_scale, offset, scale, reveal) = annotation
        .timing
        .as_ref()
        .map_or((1.0, [0.0, 0.0], 1.0, 1.0), |timing| envelope(timing, time));

    let alpha = annotation.opacity as f32 * alpha_scale;
    if alpha <= 0.0 {
        return None;
    }

    let [ax, ay, aw, ah] = anchors.rect_for(annotation.anchor);
    let width = annotation.width as f32 * aw * scale;
    let height = annotation.height as f32 * ah * scale;
    // Scaling happens about the annotation's centre: growing a badge from its
    // top-left would slide it across the frame as it appeared.
    let centre_x = ax + (annotation.x as f32 + annotation.width as f32 / 2.0) * aw;
    let centre_y = ay + (annotation.y as f32 + annotation.height as f32 / 2.0) * ah;

    Some(PreparedAnnotation {
        annotation: annotation.clone(),
        bounds: [
            centre_x - width / 2.0 + offset[0] * width,
            centre_y - height / 2.0 + offset[1] * height,
            width,
            height,
        ],
        stroke_width: annotation.stroke_width as f32 * ah,
        alpha,
        reveal,
    })
}

/// Every annotation on screen at `time`, in document order — which is paint
/// order, so a later annotation draws over an earlier one.
pub fn prepare_annotations(
    annotations: &[Annotation],
    anchors: AnchorRects,
    time: f64,
) -> Vec<PreparedAnnotation> {
    annotations
        .iter()
        .filter_map(|annotation| prepare_annotation(annotation, anchors, time))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use quiro_project::AnnotationType;

    fn anchors() -> AnchorRects {
        AnchorRects {
            // Inset and half-size, so a bug that swaps the two rects cannot
            // pass by coincidence.
            capture: [100.0, 50.0, 800.0, 400.0],
            canvas: [0.0, 0.0, 1000.0, 500.0],
        }
    }

    fn annotation() -> Annotation {
        Annotation {
            id: "a".into(),
            annotation_type: AnnotationType::Rectangle,
            x: 0.25,
            y: 0.5,
            width: 0.5,
            height: 0.25,
            stroke_color: "#000".into(),
            stroke_width: 0.01,
            fill_color: "transparent".into(),
            opacity: 1.0,
            rotation: 0.0,
            text: None,
            mask_mode: None,
            mask_amount: None,
            mask_shape: None,
            mask_feather: None,
            mask_darkness: None,
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
            anchor: AnnotationAnchor::default(),
        }
    }

    fn timing(start: f64, end: f64) -> AnnotationTiming {
        AnnotationTiming {
            start,
            end,
            track: 0,
            enter: AnnotationAnimation::None,
            exit: AnnotationAnimation::None,
            enter_duration: 0.0,
            exit_duration: 0.0,
        }
    }

    #[test]
    fn capture_anchor_resolves_against_the_capture_rect() {
        let prepared = prepare_annotation(&annotation(), anchors(), 0.0).unwrap();

        // x: 100 + 0.25*800 = 300, y: 50 + 0.5*400 = 250
        assert_eq!(prepared.bounds, [300.0, 250.0, 400.0, 100.0]);
        // Height only, per `space.ts`'s resolveAxial.
        assert_eq!(prepared.stroke_width, 4.0);
    }

    #[test]
    fn canvas_anchor_resolves_against_the_output_frame() {
        let mut a = annotation();
        a.anchor = AnnotationAnchor::Canvas;

        let prepared = prepare_annotation(&a, anchors(), 0.0).unwrap();

        assert_eq!(prepared.bounds, [250.0, 250.0, 500.0, 125.0]);
    }

    /// The whole point of the anchor: a capture-anchored annotation moves with
    /// the capture when the camera zooms, a canvas-anchored one does not.
    #[test]
    fn zooming_the_capture_moves_only_capture_anchored_annotations() {
        let zoomed = AnchorRects {
            capture: [-100.0, -50.0, 1600.0, 800.0],
            canvas: [0.0, 0.0, 1000.0, 500.0],
        };

        let mut pinned = annotation();
        pinned.anchor = AnnotationAnchor::Canvas;

        let tracking_before = prepare_annotation(&annotation(), anchors(), 0.0).unwrap();
        let tracking_after = prepare_annotation(&annotation(), zoomed, 0.0).unwrap();
        let pinned_before = prepare_annotation(&pinned, anchors(), 0.0).unwrap();
        let pinned_after = prepare_annotation(&pinned, zoomed, 0.0).unwrap();

        assert_ne!(tracking_before.bounds, tracking_after.bounds);
        assert_eq!(pinned_before.bounds, pinned_after.bounds);
    }

    #[test]
    fn untimed_annotations_prepare_at_every_time() {
        for time in [0.0, 5.0, 1e6] {
            assert!(prepare_annotation(&annotation(), anchors(), time).is_some());
        }
    }

    #[test]
    fn timed_annotations_prepare_only_inside_their_span() {
        let mut a = annotation();
        a.timing = Some(timing(1.0, 2.0));

        assert!(prepare_annotation(&a, anchors(), 0.5).is_none());
        assert!(prepare_annotation(&a, anchors(), 1.5).is_some());
        assert!(prepare_annotation(&a, anchors(), 2.0).is_none());
    }

    #[test]
    fn fade_entrance_ramps_alpha_and_leaves_geometry_alone() {
        let mut a = annotation();
        let mut t = timing(0.0, 4.0);
        t.enter = AnnotationAnimation::Fade;
        t.enter_duration = 1.0;
        a.timing = Some(t);

        let start = prepare_annotation(&a, anchors(), 0.0);
        let mid = prepare_annotation(&a, anchors(), 0.5).unwrap();
        let settled = prepare_annotation(&a, anchors(), 2.0).unwrap();

        // Alpha is exactly 0 at t=start, which is "nothing to draw".
        assert!(start.is_none());
        assert!(mid.alpha > 0.0 && mid.alpha < 1.0);
        assert_eq!(settled.alpha, 1.0);
        assert_eq!(settled.bounds, [300.0, 250.0, 400.0, 100.0]);
    }

    #[test]
    fn scale_entrance_grows_about_the_centre() {
        let mut a = annotation();
        let mut t = timing(0.0, 4.0);
        t.enter = AnnotationAnimation::Scale;
        t.enter_duration = 1.0;
        a.timing = Some(t);

        let mid = prepare_annotation(&a, anchors(), 0.5).unwrap();
        let settled = prepare_annotation(&a, anchors(), 2.0).unwrap();

        let centre = |b: [f32; 4]| [b[0] + b[2] / 2.0, b[1] + b[3] / 2.0];
        assert!(mid.bounds[2] < settled.bounds[2]);
        // Growing about the centre means the centre does not move.
        let (a_centre, b_centre) = (centre(mid.bounds), centre(settled.bounds));
        assert!((a_centre[0] - b_centre[0]).abs() < 0.01);
        assert!((a_centre[1] - b_centre[1]).abs() < 0.01);
    }

    #[test]
    fn typewriter_reveals_without_fading() {
        let mut a = annotation();
        let mut t = timing(0.0, 4.0);
        t.enter = AnnotationAnimation::Typewriter;
        t.enter_duration = 1.0;
        a.timing = Some(t);

        let mid = prepare_annotation(&a, anchors(), 0.5).unwrap();

        assert_eq!(mid.alpha, 1.0);
        assert!(mid.reveal > 0.0 && mid.reveal < 1.0);
    }

    /// A duration dragged to zero must mean "no animation", not a division
    /// that blanks the annotation for the whole clip.
    #[test]
    fn zero_duration_transitions_are_inert() {
        let mut a = annotation();
        let mut t = timing(0.0, 4.0);
        t.enter = AnnotationAnimation::Fade;
        t.enter_duration = 0.0;
        a.timing = Some(t);

        let at_start = prepare_annotation(&a, anchors(), 0.0).unwrap();

        assert_eq!(at_start.alpha, 1.0);
        assert!(at_start.bounds.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn fully_transparent_annotations_are_dropped() {
        let mut a = annotation();
        a.opacity = 0.0;

        assert!(prepare_annotation(&a, anchors(), 0.0).is_none());
    }

    #[test]
    fn prepare_annotations_keeps_document_order_for_painting() {
        let mut first = annotation();
        first.id = "first".into();
        let mut second = annotation();
        second.id = "second".into();
        let mut hidden = annotation();
        hidden.id = "hidden".into();
        hidden.timing = Some(timing(10.0, 11.0));

        let prepared = prepare_annotations(&[first, hidden, second], anchors(), 0.0);

        let ids: Vec<_> = prepared.iter().map(|p| p.annotation.id.as_str()).collect();
        assert_eq!(ids, ["first", "second"]);
    }
}
