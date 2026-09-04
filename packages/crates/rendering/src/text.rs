use quiro_project::{TextContent, TextSegment, XY};

#[cfg(test)]
use quiro_project::{
    GrowType, Paragraph, ParagraphSet, RunStyle, TextAlign, TextDecoration, TextRoot, TextRun,
    TextTransform, VerticalAlign,
};

/// Text font sizes are authored against a 1080p-tall reference frame; a
/// `quiro_text::Constraint::anchor_height` of the real output height is what
/// actually scales them (`RunStyle::font_size` is px@1080 by convention —
/// see `plans/text-engine/000-text-content-model.md`), so this crate no
/// longer does that multiply itself. `size` only positions and wraps the
/// text — it never affects glyph size.
pub const MIN_FONT_SIZE: f32 = 8.0;
pub const MAX_FONT_SIZE: f32 = 480.0;

#[derive(Debug, Clone)]
pub struct PreparedText {
    pub content: TextContent,
    pub bounds: [f32; 4],
}

/// Rewrites a `#rrggbb` (or already-`#rrggbbaa`) colour with a new alpha
/// byte. Used to bake the fade envelope into `RunStyle::color` rather than
/// carrying opacity as a field `quiro_text::layout_text`'s cache would have
/// to ignore — see `text_content_from_segment`.
fn with_alpha(hex: &str, alpha: f32) -> String {
    let rgb = hex.trim_start_matches('#');
    let alpha_byte = (alpha.clamp(0.0, 1.0) * 255.0).round() as u8;
    if rgb.len() >= 6 {
        format!("#{}{alpha_byte:02x}", &rgb[0..6])
    } else {
        format!("#ffffff{alpha_byte:02x}")
    }
}

/// Bakes `fade_alpha` into the one run's colour and clamps its font size,
/// mutating a clone of `segment.text_content` rather than the stored tree.
///
/// `fade_alpha` is baked into the colour, not carried as a separate opacity
/// field, because `quiro_text::layout_text` caches on `content` — a field
/// the cache did not know to ignore would defeat the cache on every frame a
/// fade is in progress, not just the ~0.15s a fade actually lasts. The font
/// size clamp is a safety net against a corrupted or hand-edited project
/// file, not something the editor's own slider can produce — `SegmentConfig
/// .tsx`'s slider is already bounded to [8, 200].
fn prepared_content(segment: &TextSegment, fade_alpha: f32) -> Option<TextContent> {
    let mut content = segment.text_content.clone()?;
    let run = content
        .root
        .children
        .first_mut()?
        .children
        .first_mut()?
        .children
        .first_mut()?;
    run.style.color = with_alpha(&run.style.color, fade_alpha);
    run.style.font_size = run.style.font_size.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
    Some(content)
}

pub fn prepare_texts(
    output_size: XY<u32>,
    frame_time: f64,
    segments: &[TextSegment],
    hidden_indices: &[usize],
) -> Vec<PreparedText> {
    let mut prepared = Vec::new();

    for (i, segment) in segments.iter().enumerate() {
        if !segment.enabled || hidden_indices.contains(&i) {
            continue;
        }

        if frame_time < segment.start || frame_time > segment.end {
            continue;
        }

        let center = XY::new(
            segment.center.x.clamp(0.0, 1.0),
            segment.center.y.clamp(0.0, 1.0),
        );
        let size = XY::new(
            segment.size.x.clamp(0.01, 2.0),
            segment.size.y.clamp(0.01, 2.0),
        );

        let width = (size.x * output_size.x as f64).max(1.0) as f32;
        let height = (size.y * output_size.y as f64).max(1.0) as f32;

        // The box may overhang frame edges (the editor allows dragging up to
        // half the box outside); glyphon culls anything past the viewport.
        let left = center.x as f32 * output_size.x as f32 - width / 2.0;
        let top = center.y as f32 * output_size.y as f32 - height / 2.0;
        let right = left + width;
        let bottom = top + height;

        let fade_duration = segment.fade_duration.max(0.0);
        let fade_alpha = if fade_duration > 0.0 {
            let time_since_start = (frame_time - segment.start).max(0.0);
            let time_until_end = (segment.end - frame_time).max(0.0);

            let fade_in = (time_since_start / fade_duration).min(1.0);
            let fade_out = (time_until_end / fade_duration).min(1.0);

            (fade_in * fade_out) as f32
        } else {
            1.0
        };

        // No tree: only possible for a project the current session's
        // `load()` hasn't run `migrate_text_content` on yet, or one it
        // wrote before `plans/text-engine/000` existed and hasn't been
        // reloaded since. Skip rather than fall back to the (now
        // unmaintained) flat fields — the next `load()` backfills the tree.
        let Some(content) = prepared_content(segment, fade_alpha) else {
            continue;
        };

        prepared.push(PreparedText {
            content,
            bounds: [left, top, right, bottom],
        });
    }

    prepared
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_content_with(text: &str) -> TextContent {
        TextContent {
            root: TextRoot {
                children: vec![ParagraphSet {
                    children: vec![Paragraph {
                        align: TextAlign::Center,
                        line_height: 1.2,
                        children: vec![TextRun {
                            text: text.to_string(),
                            style: RunStyle {
                                font_family: "sans-serif".to_string(),
                                font_size: 48.0,
                                font_weight: 700.0,
                                italic: false,
                                color: "#ffffff".to_string(),
                                letter_spacing: 0.0,
                                decoration: TextDecoration::None,
                                transform: TextTransform::None,
                            },
                        }],
                    }],
                }],
            },
            grow_type: GrowType::AutoHeight,
            vertical_align: VerticalAlign::Top,
            halo: None,
        }
    }

    fn segment(content: &str) -> TextSegment {
        TextSegment {
            start: 0.0,
            end: 5.0,
            track: 0,
            enabled: true,
            content: content.to_string(),
            center: XY::new(0.5, 0.5),
            size: XY::new(0.35, 0.2),
            font_family: "sans-serif".to_string(),
            font_size: 48.0,
            font_weight: 700.0,
            italic: false,
            color: "#ffffff".to_string(),
            fade_duration: 0.15,
            text_content: Some(text_content_with(content)),
        }
    }

    fn set_tree_font_size(segment: &mut TextSegment, font_size: f32) {
        segment.text_content.as_mut().unwrap().root.children[0].children[0].children[0]
            .style
            .font_size = font_size;
    }

    fn run_style(prepared: &PreparedText) -> &RunStyle {
        &prepared.content.root.children[0].children[0].children[0].style
    }

    fn run_text(prepared: &PreparedText) -> &str {
        &prepared.content.root.children[0].children[0].children[0].text
    }

    /// The plan's acceptance criterion, verbatim: "A static title on screen
    /// for 5s at 60fps produces one layout, not 300." Two frames deep inside
    /// the segment (well past the fade-in window) produce byte-identical
    /// `TextContent`, so the second `quiro_text::layout_text` call must hit
    /// the cache rather than re-shape. A unique marker in the text keeps this
    /// assertion valid even though `cache_stats()` is a process-global
    /// counter shared with tests running concurrently in this binary.
    #[test]
    fn steady_state_frames_hit_the_layout_cache() {
        let seg = segment("cache-probe-9f3a1c2d");
        let output_size = XY::new(1920u32, 1080u32);

        let frame_a = prepare_texts(output_size, 2.5, std::slice::from_ref(&seg), &[]);
        let frame_b = prepare_texts(
            output_size,
            2.5 + 1.0 / 60.0,
            std::slice::from_ref(&seg),
            &[],
        );
        assert_eq!(frame_a[0].content, frame_b[0].content);

        let constraint = quiro_text::Constraint {
            anchor_height: output_size.y as f32,
            width: frame_a[0].bounds[2] - frame_a[0].bounds[0],
            height: frame_a[0].bounds[3] - frame_a[0].bounds[1],
        };
        quiro_text::layout_text(&frame_a[0].content, constraint);
        let (hits_before, _) = quiro_text::cache_stats();
        quiro_text::layout_text(&frame_b[0].content, constraint);
        let (hits_after, _) = quiro_text::cache_stats();

        assert!(
            hits_after > hits_before,
            "identical steady-state content should hit the layout cache"
        );
    }

    /// The `font_size.clamp(MIN, MAX) * height_scale` multiply is gone — the
    /// engine applies the anchor rule instead — so a 4K output must not
    /// change the px value carried into `RunStyle`.
    #[test]
    fn font_size_is_clamped_but_never_scaled_by_output_size() {
        let mut seg = segment("font size probe");
        set_tree_font_size(&mut seg, 96.0);

        let hd = prepare_texts(XY::new(1920, 1080), 2.5, std::slice::from_ref(&seg), &[]);
        let uhd = prepare_texts(XY::new(3840, 2160), 2.5, std::slice::from_ref(&seg), &[]);
        assert_eq!(run_style(&hd[0]).font_size, 96.0);
        assert_eq!(run_style(&uhd[0]).font_size, 96.0);

        set_tree_font_size(&mut seg, 10_000.0);
        let clamped = prepare_texts(XY::new(1920, 1080), 2.5, std::slice::from_ref(&seg), &[]);
        assert_eq!(run_style(&clamped[0]).font_size, MAX_FONT_SIZE);
    }

    /// A project this session's `load()` hasn't migrated yet (or one written
    /// before `plans/text-engine/000` existed) has no tree at all — skip it
    /// rather than guess at the now-unmaintained flat fields.
    #[test]
    fn a_segment_without_a_tree_is_skipped() {
        let mut seg = segment("no tree");
        seg.text_content = None;

        let prepared = prepare_texts(XY::new(1920, 1080), 2.5, std::slice::from_ref(&seg), &[]);
        assert!(prepared.is_empty());
    }

    #[test]
    fn disabled_hidden_and_out_of_range_segments_are_skipped() {
        let mut disabled = segment("disabled");
        disabled.enabled = false;
        let hidden = segment("hidden");
        let mut out_of_range = segment("out of range");
        out_of_range.start = 10.0;
        out_of_range.end = 20.0;
        let visible = segment("visible");

        let segments = vec![disabled, hidden, out_of_range, visible];
        let prepared = prepare_texts(XY::new(1920, 1080), 2.5, &segments, &[1]);

        assert_eq!(prepared.len(), 1);
        assert_eq!(run_text(&prepared[0]), "visible");
    }

    /// `fade_alpha` is baked into `RunStyle::color`'s alpha byte rather than
    /// carried as a separate field — see `prepared_content`.
    #[test]
    fn fade_envelope_is_baked_into_color_alpha() {
        let seg = segment("fade probe");

        let at_start = prepare_texts(XY::new(1920, 1080), 0.0, std::slice::from_ref(&seg), &[]);
        assert!(run_style(&at_start[0]).color.ends_with("00"));

        let mid_segment = prepare_texts(XY::new(1920, 1080), 2.5, std::slice::from_ref(&seg), &[]);
        assert!(run_style(&mid_segment[0]).color.ends_with("ff"));
    }
}
