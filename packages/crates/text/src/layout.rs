use serde::{Deserialize, Serialize};
use specta::Type;
use std::ops::Range;

use crate::fragment::{FaceRegistry, Fragment, apply_transform, extract_fragments};

/// What a layout is measured against. Font sizes are always px@1080 of
/// `anchor_height` — see `RunStyle::font_size` in `quiro-project`.
#[derive(Type, Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Constraint {
    pub anchor_height: f32,
    /// Box width in output px. Ignored for `GrowType::AutoWidth`.
    pub width: f32,
    /// Box height in output px. Ignored unless `GrowType::Fixed`.
    pub height: f32,
}

/// The result of laying out one `TextContent`. Carries both the fragments a
/// painter draws from and the cosmic-text buffers a renderer that already
/// holds a `FontSystem` (glyphon, in `quiro-rendering`) can hand straight to
/// its own paint call — so nothing that already has shaped glyphs ever
/// re-shapes them.
#[derive(Debug, Clone)]
pub struct TextLayout {
    pub fragments: Vec<Fragment>,
    /// One per (flattened) paragraph, in document order.
    pub buffers: Vec<cosmic_text::Buffer>,
    /// `buffers[i]`'s vertical offset from the content's own top — where a
    /// renderer painting `buffers[i]` directly (rather than from
    /// `fragments`) must place its origin. A buffer is shaped from its own
    /// `(0, 0)`; only `fragments[..].y` carries the stacking offset baked
    /// in, so a caller painting buffers instead needs this separately.
    /// Horizontal alignment is entirely internal to each buffer (cosmic-text
    /// handles it via `Align`), so there is no matching x offset.
    pub paragraph_y_offsets: Vec<f32>,
    pub width: f32,
    pub height: f32,
}

struct ShapedParagraph {
    buffer: cosmic_text::Buffer,
    run_ranges: Vec<Range<usize>>,
    width: f32,
    height: f32,
}

/// Lays out `content` against `constraint`, shaping with `font_system`.
///
/// One `cosmic_text::Buffer` per paragraph: `Metrics` (which carries line
/// height) is set on the buffer, not the line, so a per-paragraph
/// `line_height` needs a buffer of its own — vertical stacking and
/// vertical alignment are therefore this function's job, not cosmic-text's.
pub(crate) fn compute(
    font_system: &mut cosmic_text::FontSystem,
    content: &quiro_project::TextContent,
    constraint: &Constraint,
    faces: &mut FaceRegistry,
) -> TextLayout {
    let paragraphs: Vec<&quiro_project::Paragraph> = content
        .root
        .children
        .iter()
        .flat_map(|set| set.children.iter())
        .collect();

    // `RunStyle::font_size` is defined as "output px as if the anchor were
    // 1080 tall" (see that field's doc comment) — the multiply that makes
    // that promise true. `constraint.width`/`height` need no equivalent
    // scaling: callers already compute those in real output pixels (e.g.
    // `layers/text.rs` from `segment.size` × the real frame size), not
    // px@1080.
    let scale = constraint.anchor_height.max(1.0) / quiro_project::TEXT_REFERENCE_HEIGHT as f32;

    let shaped: Vec<ShapedParagraph> = paragraphs
        .iter()
        .map(|paragraph| {
            shape_paragraph(font_system, paragraph, content.grow_type, constraint, scale)
        })
        .collect();

    let total_height: f32 = shaped.iter().map(|p| p.height).sum();

    // Vertical alignment only has a container to align *within* when the box
    // height is user-set (`Fixed`); for the other grow types the object's own
    // height follows its content, so the "container" is the content itself
    // and every offset formula below resolves to zero.
    let container_height = match content.grow_type {
        quiro_project::GrowType::Fixed => constraint.height,
        _ => total_height,
    };
    let mut y = vertical_align_offset(container_height, total_height, content.vertical_align);

    let mut fragments = Vec::new();
    let mut paragraph_y_offsets = Vec::with_capacity(shaped.len());
    for (index, (paragraph, entry)) in paragraphs.iter().zip(shaped.iter()).enumerate() {
        fragments.extend(extract_fragments(
            index as u32,
            paragraph,
            &entry.run_ranges,
            &entry.buffer,
            y,
            faces,
            scale,
        ));
        paragraph_y_offsets.push(y);
        y += entry.height;
    }

    let width = match content.grow_type {
        quiro_project::GrowType::AutoWidth => {
            shaped.iter().map(|p| p.width).fold(0.0_f32, f32::max)
        }
        _ => constraint.width,
    };
    let height = match content.grow_type {
        quiro_project::GrowType::Fixed => constraint.height,
        _ => total_height,
    };

    TextLayout {
        fragments,
        buffers: shaped.into_iter().map(|p| p.buffer).collect(),
        paragraph_y_offsets,
        width,
        height,
    }
}

fn shape_paragraph(
    font_system: &mut cosmic_text::FontSystem,
    paragraph: &quiro_project::Paragraph,
    grow_type: quiro_project::GrowType,
    constraint: &Constraint,
    scale: f32,
) -> ShapedParagraph {
    // Text-transform is applied before shaping, not after: it can change a
    // run's byte length (`ß` → `SS`), so wrapping has to see the transformed
    // text, not patch it in afterward. The transformed strings are collected
    // up front because `set_rich_text` needs `&str`s that outlive the call,
    // and `apply_transform` allocates a new `String` whenever it changes
    // anything.
    let transformed: Vec<String> = paragraph
        .children
        .iter()
        .map(|run| apply_transform(&run.text, run.style.transform))
        .collect();

    // The exact byte-range bookkeeping `Buffer::set_rich_text` does
    // internally, computed a second time here because `extract_fragments`
    // needs it to map a shaped glyph's cluster back to the run that produced
    // it — cosmic-text has no API that hands this mapping back out.
    let mut end = 0usize;
    let run_ranges: Vec<Range<usize>> = transformed
        .iter()
        .map(|text| {
            let start = end;
            end += text.len();
            start..end
        })
        .collect();

    let default_style = paragraph
        .children
        .first()
        .map(|run| run.style.clone())
        .unwrap_or_default();
    let default_font_size = (default_style.font_size * scale).max(1.0);
    let metrics = cosmic_text::Metrics::new(
        default_font_size,
        (default_font_size * paragraph.line_height).max(1.0),
    );
    let mut buffer = cosmic_text::Buffer::new(font_system, metrics);

    match grow_type {
        // `None` is shrink-to-fit in cosmic-text, not infinite — alignment
        // comes out correct on this one pass. Skia (Penpot's engine) aligns
        // a `None` width against `f32::MAX` instead, which is why it needs
        // a second pass at the content's real width; this engine does not.
        quiro_project::GrowType::AutoWidth => buffer.set_size(font_system, None, None),
        quiro_project::GrowType::AutoHeight => {
            buffer.set_size(font_system, Some(constraint.width.max(0.0)), None)
        }
        quiro_project::GrowType::Fixed => buffer.set_size(
            font_system,
            Some(constraint.width.max(0.0)),
            Some(constraint.height.max(0.0)),
        ),
    }

    // Matches `rendering/src/layers/text.rs`'s existing choice exactly
    // (rather than cosmic-text's own `Buffer::new` default, `WordOrGlyph`):
    // a word with no break opportunity overflows the box instead of being
    // force-broken mid-word. Diverging here would be a visible behavior
    // change for every existing video title once `plans/text-engine/002`
    // wires this crate into that renderer.
    buffer.set_wrap(font_system, cosmic_text::Wrap::Word);

    let default_attrs = build_attrs(&default_style, paragraph.line_height, scale);
    let spans = paragraph
        .children
        .iter()
        .zip(transformed.iter())
        .map(|(run, text)| {
            (
                text.as_str(),
                build_attrs(&run.style, paragraph.line_height, scale),
            )
        });

    buffer.set_rich_text(
        font_system,
        spans,
        &default_attrs,
        cosmic_text::Shaping::Advanced,
        Some(align_to_cosmic(paragraph.align)),
    );

    buffer.shape_until_scroll(font_system, false);

    let width = buffer
        .layout_runs()
        .map(|run| run.line_w)
        .fold(0.0_f32, f32::max);
    let height = buffer.layout_runs().map(|run| run.line_height).sum();

    ShapedParagraph {
        buffer,
        run_ranges,
        width,
        height,
    }
}

/// A run's `Attrs`, borrowed from `style` for the duration of the shaping
/// call that consumes it — never outlives it, so `'static` is not needed.
/// `scale` converts `style.font_size` from px@1080 to real output px — see
/// `compute`'s own comment.
fn build_attrs(
    style: &quiro_project::RunStyle,
    line_height_multiplier: f32,
    scale: f32,
) -> cosmic_text::Attrs<'_> {
    let font_size = (style.font_size * scale).max(1.0);
    // `scale` cancels out of this ratio (both the numerator and `font_size`
    // above carry it), so using the *unscaled* style values here gives the
    // same em value as scaling both and dividing — done this way because
    // it needs no extra multiply.
    let letter_spacing_em = style.letter_spacing / style.font_size.max(1.0);

    cosmic_text::Attrs::new()
        .family(family_for(&style.font_family))
        .color(parse_color(&style.color))
        .weight(cosmic_text::Weight(
            style.font_weight.round().clamp(100.0, 900.0) as u16,
        ))
        .style(if style.italic {
            cosmic_text::Style::Italic
        } else {
            cosmic_text::Style::Normal
        })
        .metrics(cosmic_text::Metrics::new(
            font_size,
            (font_size * line_height_multiplier).max(1.0),
        ))
        .letter_spacing(letter_spacing_em)
}

/// Matches `rendering/src/layers/text.rs`'s family resolution exactly, so a
/// family name resolves the same way whether it arrives through the old flat
/// `TextSegment` fields or through `RunStyle::font_family`.
fn family_for(font_family: &str) -> cosmic_text::Family<'_> {
    match font_family.trim() {
        "" => cosmic_text::Family::SansSerif,
        name => match name.to_ascii_lowercase().as_str() {
            "sans" | "sans-serif" | "system sans" | "system sans-serif" => {
                cosmic_text::Family::SansSerif
            }
            "serif" | "system serif" => cosmic_text::Family::Serif,
            "mono" | "monospace" | "system mono" | "system monospace" => {
                cosmic_text::Family::Monospace
            }
            _ => cosmic_text::Family::Name(name),
        },
    }
}

/// Accepts `#rrggbb` (opaque) or `#rrggbbaa` — the latter is how a caller
/// bakes a per-frame fade into an otherwise-cacheable run colour (see
/// `rendering/src/text.rs::with_alpha`) without adding an opacity field this
/// crate's cache key would have to know to ignore.
fn parse_color(hex: &str) -> cosmic_text::Color {
    let hex = hex.trim_start_matches('#');
    let channel =
        |range: std::ops::Range<usize>| hex.get(range).and_then(|s| u8::from_str_radix(s, 16).ok());

    match hex.len() {
        8 => {
            if let (Some(r), Some(g), Some(b), Some(a)) =
                (channel(0..2), channel(2..4), channel(4..6), channel(6..8))
            {
                return cosmic_text::Color::rgba(r, g, b, a);
            }
        }
        6 => {
            if let (Some(r), Some(g), Some(b)) = (channel(0..2), channel(2..4), channel(4..6)) {
                return cosmic_text::Color::rgba(r, g, b, 255);
            }
        }
        _ => {}
    }
    cosmic_text::Color::rgba(255, 255, 255, 255)
}

fn align_to_cosmic(align: quiro_project::TextAlign) -> cosmic_text::Align {
    match align {
        quiro_project::TextAlign::Left => cosmic_text::Align::Left,
        quiro_project::TextAlign::Center => cosmic_text::Align::Center,
        quiro_project::TextAlign::Right => cosmic_text::Align::Right,
        quiro_project::TextAlign::Justify => cosmic_text::Align::Justified,
    }
}

fn vertical_align_offset(
    container_height: f32,
    content_height: f32,
    valign: quiro_project::VerticalAlign,
) -> f32 {
    match valign {
        quiro_project::VerticalAlign::Top => 0.0,
        quiro_project::VerticalAlign::Center => (container_height - content_height) / 2.0,
        quiro_project::VerticalAlign::Bottom => container_height - content_height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn six_digit_hex_is_opaque() {
        assert_eq!(
            parse_color("#ff8800"),
            cosmic_text::Color::rgba(0xff, 0x88, 0x00, 255)
        );
    }

    #[test]
    fn eight_digit_hex_carries_its_own_alpha() {
        assert_eq!(
            parse_color("#ff880080"),
            cosmic_text::Color::rgba(0xff, 0x88, 0x00, 0x80)
        );
    }

    #[test]
    fn malformed_hex_falls_back_to_opaque_white() {
        assert_eq!(
            parse_color("not-a-color"),
            cosmic_text::Color::rgba(255, 255, 255, 255)
        );
    }
}
