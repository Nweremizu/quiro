//! Frame layout: where the capture sits inside the rendered output frame.
//!
//! This maths used to live only in `quiro-rendering`, which meant the two
//! things that need it could not both reach it. `rendering` depends on this
//! crate, not the other way round, so the annotation-space migration in
//! `configuration.rs` — which must reconstruct the frame an annotation's
//! pixels were authored against — had no way to call up the dependency graph.
//!
//! It is pure: a `ProjectConfiguration` plus the capture dimensions determine
//! the frame completely. `rendering` now delegates to these functions so there
//! is one authority rather than two copies drifting apart, and the TypeScript
//! mirror in `apps/desktop/src/routes/screenshot-editor/layout.ts` is checked
//! against them.
//!
//! The one thing that stays in `rendering` is the decorative-frame branch:
//! chrome insets need `frame_chrome`, 700 lines of style tables that have no
//! business in this crate. [`content_rect`] reports that case rather than
//! guessing — see its docs.

use crate::ProjectConfiguration;
use crate::configuration::{AspectRatio, Crop, FrameConfiguration, FrameStyle, LayerTransform, XY};

/// Padding slider at 100% insets the capture by this fraction of its longer
/// edge. Mirrors `SCREEN_MAX_PADDING` in `layout.ts`.
pub const SCREEN_MAX_PADDING: f64 = 0.4;

/// The crop rect, defaulting to the whole capture when none is set.
pub fn crop(config: &ProjectConfiguration, capture_size: XY<u32>) -> Crop {
    config.background.crop.as_ref().cloned().unwrap_or(Crop {
        position: XY { x: 0, y: 0 },
        size: capture_size,
    })
}

pub fn auto_padding_factor(config: &ProjectConfiguration) -> f64 {
    config.background.padding / 100.0 * SCREEN_MAX_PADDING
}

fn round_base_dimension(value: f64) -> u32 {
    (((value.ceil() as u32) + 1) & !1).max(2)
}

fn aspect_ratio_value(aspect: &AspectRatio) -> f64 {
    match aspect {
        AspectRatio::Square => 1.0,
        AspectRatio::Wide => 16.0 / 9.0,
        AspectRatio::Vertical => 9.0 / 16.0,
        AspectRatio::Classic => 4.0 / 3.0,
        AspectRatio::Tall => 3.0 / 4.0,
    }
}

fn fixed_aspect_base_size(crop: &Crop, target_aspect: f64, padding_factor: f64) -> (u32, u32) {
    let crop_aspect = crop.aspect_ratio() as f64;
    let padding = f64::from(u32::max(crop.size.x, crop.size.y)) * padding_factor * 2.0;

    if crop_aspect > target_aspect {
        let width = crop.size.x as f64 + padding;
        let height = width / target_aspect;
        (round_base_dimension(width), round_base_dimension(height))
    } else {
        let height = crop.size.y as f64 + padding;
        let width = height * target_aspect;
        (round_base_dimension(width), round_base_dimension(height))
    }
}

/// The frame's intrinsic size, before any output-resolution scaling. The
/// screenshot editor's preview renders at exactly this size, which is what
/// makes an annotation's authoring frame recoverable from the config alone.
pub fn base_size(config: &ProjectConfiguration, capture_size: XY<u32>) -> (u32, u32) {
    let crop = crop(config, capture_size);
    let padding_factor = auto_padding_factor(config);

    match &config.aspect_ratio {
        None => {
            let scale = 1.0 + padding_factor * 2.0;
            let width = ((crop.size.x as f64 * scale) as u32 + 1) & !1;
            let height = ((crop.size.y as f64 * scale) as u32 + 1) & !1;
            (width, height)
        }
        Some(aspect) => fixed_aspect_base_size(&crop, aspect_ratio_value(aspect), padding_factor),
    }
}

/// The frame scaled to fit `resolution_base`, rounded the way the encoder
/// wants it.
pub fn output_size(
    config: &ProjectConfiguration,
    capture_size: XY<u32>,
    resolution_base: XY<u32>,
) -> (u32, u32) {
    let (base_width, base_height) = base_size(config, capture_size);

    let width_scale = resolution_base.x as f32 / base_width as f32;
    let height_scale = resolution_base.y as f32 / base_height as f32;
    let scale = width_scale.min(height_scale);

    let scaled_width = ((base_width as f32 * scale) as u32 + 3) & !3;
    let scaled_height = ((base_height as f32 * scale) as u32 + 1) & !1;
    (scaled_width, scaled_height)
}

/// Padding inset in output-frame pixels, before any decorative frame.
pub fn base_offset(
    config: &ProjectConfiguration,
    capture_size: XY<u32>,
    resolution_base: XY<u32>,
) -> XY<f64> {
    let out = output_size(config, capture_size, resolution_base);
    let out = XY::new(out.0 as f64, out.1 as f64);
    let crop = crop(config, capture_size);

    if config.aspect_ratio.is_none() {
        let (base_w, base_h) = base_size(config, capture_size);
        let output_scale = f64::min(
            out.x / f64::max(base_w as f64, 1.0),
            out.y / f64::max(base_h as f64, 1.0),
        );
        let padding_factor = auto_padding_factor(config);

        return XY::new(
            crop.size.x as f64 * padding_factor * output_scale,
            crop.size.y as f64 * padding_factor * output_scale,
        );
    }

    let output_aspect = out.x / out.y;

    let cropped_size = XY::new(crop.size.x as f64, crop.size.y as f64);
    let cropped_aspect = cropped_size.x / cropped_size.y;

    let padding = {
        let padding_factor = auto_padding_factor(config);
        let crop_basis = f64::max(cropped_size.x, cropped_size.y);
        let base_padding = crop_basis * padding_factor;

        let (base_w, base_h) = base_size(config, capture_size);
        let output_scale = f64::min(
            out.x / f64::max(base_w as f64, 1.0),
            out.y / f64::max(base_h as f64, 1.0),
        );
        let max_padding = f64::max(f64::min((out.x - 1.0) / 2.0, (out.y - 1.0) / 2.0), 0.0);
        (base_padding * output_scale).min(max_padding)
    };

    let is_height_constrained = cropped_aspect <= output_aspect;

    let available_size = XY::new(
        (out.x - 2.0 * padding).max(1.0),
        (out.y - 2.0 * padding).max(1.0),
    );

    let target_size = if is_height_constrained {
        XY::new(available_size.y * cropped_aspect, available_size.y)
    } else {
        XY::new(available_size.x, available_size.x / cropped_aspect)
    };

    let target_offset = (out - target_size) / 2.0;

    if is_height_constrained {
        XY::new(target_offset.x, padding)
    } else {
        XY::new(padding, target_offset.y)
    }
}

/// The layer transform to apply to the capture, already clamped. `None` when
/// the project has never moved the capture, which is the signal to take the
/// untransformed path rather than multiply by an identity.
pub fn display_transform(config: &ProjectConfiguration) -> Option<LayerTransform> {
    config
        .background
        .display_transform
        .map(|transform| transform.clamped())
        .filter(|transform| !transform.is_identity())
}

/// How far the card's shadow reaches past its own edge, in output pixels.
///
/// Mirrors the falloff in `composite-video-frame.wgsl`: the shadow fades to
/// nothing at `shadow_size + shadow_blur`, both of which are fractions of the
/// card's shorter side scaled by the overall shadow strength.
///
/// The split preview renders the card into its own texture, and that texture
/// has to be big enough to hold the whole object — card, shadow, border. If it
/// is not, the shadow is cut off at the texture's edge, and moving the capture
/// drags that cut into the middle of the canvas as a hard line around the
/// screenshot. Only the canvas is allowed to clip anything.
///
/// Travel needs no allowance: past the shadow there is nothing left to draw,
/// so a complete object can be moved anywhere without exposing an edge.
pub fn shadow_reach_px(config: &ProjectConfiguration, card_min_axis: f64) -> f64 {
    let strength = config.background.shadow as f64 / 100.0;
    if strength <= 0.0 {
        return 0.0;
    }

    let (size, blur) = match config.background.advanced_shadow.as_ref() {
        Some(shadow) => (shadow.size as f64 / 100.0, shadow.blur as f64 / 100.0),
        // The shader's fallback when no advanced shadow is configured.
        None => (1.0, 0.5),
    };

    // ponytail: capped at half the card, which covers every in-range shadow
    // without letting the texture grow without bound. Raise it only alongside
    // a measurement of what the bigger frames cost over the socket.
    ((size + blur) * strength).min(0.5) * card_min_axis
}

/// Whether the card is tilted out of the screen plane.
///
/// In-plane spin is excluded on purpose: a plain rotation is a similarity, so
/// the browser can apply it to an already-rendered card and land on exactly
/// what this renderer would have drawn. A tilt cannot be — the renderer folds
/// spin *into* the tilt (`Rx * Ry * Rz`, so the card turns in its own plane and
/// that plane is then tilted), and rotating a rendered tilted image instead
/// spins it in screen space, which is a different picture. So this is the
/// predicate that decides which side owns the rotation, and
/// `Preview.tsx`'s `cssRotation` mirrors it exactly.
pub fn card_is_tilted(config: &ProjectConfiguration) -> bool {
    config
        .background
        .perspective
        .as_ref()
        .is_some_and(|p| p.tilt_x != 0.0 || p.tilt_y != 0.0)
}

/// The configuration the split preview's card pass renders.
///
/// Offset and scale always come out — those are what the browser's compositor
/// applies, and applying them twice would place the card at the square of the
/// intended transform. Rotation comes out only when the card is flat, per
/// [`card_is_tilted`].
///
/// The stripped transform stays `Some` whenever the original was, even when
/// every field is now neutral, because that `Option` is what tells the renderer
/// the user has placed this card by hand — and so that the fit-to-frame shrink
/// stays switched off in the card pass exactly as it is in the export.
pub fn card_pass_config(config: &ProjectConfiguration) -> ProjectConfiguration {
    let Some(transform) = config.background.display_transform else {
        return config.clone();
    };

    let mut stripped = config.clone();
    stripped.background.display_transform = Some(LayerTransform {
        offset: XY::new(0.0, 0.0),
        scale: 1.0,
        rotation: if card_is_tilted(config) {
            transform.clamped().rotation
        } else {
            0.0
        },
    });
    stripped
}

/// Moves and scales a laid-out rect by a layer transform.
///
/// Scale is about the rect's own centre so a layer grows in place rather than
/// walking toward the origin, and the offset is a fraction of the canvas so it
/// means the same thing at any output resolution. Rotation is not applied:
/// it belongs to the card homography, and folding it in here would leave every
/// caller holding a rotated rect it has no way to represent.
pub fn transform_rect(
    offset: XY<f64>,
    size: XY<f64>,
    transform: &LayerTransform,
    canvas: XY<f64>,
) -> (XY<f64>, XY<f64>) {
    let scaled = size * transform.scale;
    let centre = offset + size / 2.0;
    let delta = XY::new(transform.offset.x * canvas.x, transform.offset.y * canvas.y);
    (centre + delta - scaled / 2.0, scaled)
}

/// Where the capture sits inside the frame, in output-frame pixels.
///
/// Returns `None` when a decorative frame is active: the content rect is then
/// inset by chrome whose measurements live in `rendering::frame_chrome`, and
/// this crate deliberately does not carry them. Callers that only need the
/// unframed case — the annotation-space migration — treat `None` as "cannot
/// resolve, do not guess", which is the correct outcome: a wrong rect here
/// silently moves every annotation in the project.
pub fn content_rect(
    config: &ProjectConfiguration,
    capture_size: XY<u32>,
    resolution_base: XY<u32>,
) -> Option<(XY<f64>, XY<f64>)> {
    if FrameConfiguration::active_style(config.background.frame.as_ref()) != FrameStyle::None {
        return None;
    }

    let base = base_offset(config, capture_size, resolution_base);
    let out = output_size(config, capture_size, resolution_base);
    let out = XY::new(out.0 as f64, out.1 as f64);
    // Same op order as the renderer's `display_layout` (end - offset - offset)
    // so the unframed path stays bit-exact with it.
    let size = (out - base) - base;

    Some(match display_transform(config) {
        Some(transform) => transform_rect(base, size, &transform, out),
        None => (base, size),
    })
}

#[cfg(test)]
mod split_preview_tests {
    use super::*;
    use crate::configuration::PerspectiveConfiguration;

    fn placed(rotation: f64) -> ProjectConfiguration {
        let mut config = ProjectConfiguration::default();
        config.background.display_transform = Some(LayerTransform {
            offset: XY::new(0.3, -0.2),
            scale: 1.75,
            rotation,
        });
        config
    }

    #[test]
    fn an_unplaced_capture_needs_no_card_pass_config() {
        // Nothing to strip, so the card pass renders the very same config the
        // export does and the two cannot drift.
        let config = ProjectConfiguration::default();
        let card = card_pass_config(&config);
        assert!(card.background.display_transform.is_none());
    }

    #[test]
    fn offset_and_scale_always_come_out() {
        // The browser applies these. Leaving them in would place the card at
        // the square of the intended transform.
        let card = card_pass_config(&placed(0.0));
        let transform = card
            .background
            .display_transform
            .expect("the option survives so the fit-to-frame shrink stays off");
        assert_eq!(transform.offset, XY::new(0.0, 0.0));
        assert_eq!(transform.scale, 1.0);
    }

    #[test]
    fn a_flat_card_leaves_its_rotation_to_the_browser() {
        // A plain spin is a similarity, so rotating the rendered card lands on
        // exactly the pixels this renderer would have drawn — and a rotation
        // gesture then costs nothing.
        let card = card_pass_config(&placed(30.0));
        assert_eq!(card.background.display_transform.unwrap().rotation, 0.0);
    }

    #[test]
    fn a_tilted_card_keeps_its_rotation() {
        // Spin is folded into the tilt (Rx * Ry * Rz), so spinning an
        // already-tilted image in screen space is a different picture. The
        // renderer keeps this one and the gesture pays for a re-render.
        let mut config = placed(30.0);
        config.background.perspective = Some(PerspectiveConfiguration {
            tilt_x: 15.0,
            ..Default::default()
        });
        let card = card_pass_config(&config);
        assert_eq!(card.background.display_transform.unwrap().rotation, 30.0);
    }

    #[test]
    fn in_plane_spin_alone_is_not_a_tilt() {
        // The Perspective popover's own `rotate` is in-plane, so a card using
        // only that is still flat and its layer rotation still belongs to CSS.
        let mut config = placed(30.0);
        config.background.perspective = Some(PerspectiveConfiguration {
            rotate: 45.0,
            ..Default::default()
        });
        assert!(!card_is_tilted(&config));
        assert_eq!(
            card_pass_config(&config)
                .background
                .display_transform
                .unwrap()
                .rotation,
            0.0
        );
    }

    #[test]
    fn the_card_pass_renders_where_layout_alone_would_put_it() {
        // The contract the browser relies on: the card image it is handed sits
        // at the untransformed rect, so the transform it applies is the whole
        // transform and not a second helping of part of one.
        let config = placed(0.0);
        let capture = XY::new(1200, 800);
        let base = XY::new(1200, 800);

        let card = card_pass_config(&config);
        let placed_rect = content_rect(&config, capture, base).expect("no decorative frame");
        let card_rect = content_rect(&card, capture, base).expect("no decorative frame");
        let plain_rect =
            content_rect(&ProjectConfiguration::default(), capture, base).expect("no frame");

        assert_eq!(card_rect, plain_rect, "the card pass must be untransformed");
        assert_ne!(card_rect, placed_rect, "the export pass must not be");
    }
}
