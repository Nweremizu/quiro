//! One layout engine for text, shared by the screenshot annotation editor and
//! the video timeline. cosmic-text is the only thing that ever measures a
//! `quiro_project::TextContent` — no other host re-measures it, which is the
//! defect `plans/text-engine/` exists to remove (see
//! `packages/crates/rendering/src/layers/text.rs`'s wrap-width slack, which
//! `plans/text-engine/002` deletes once this crate has a caller).
//!
//! `layout_text` is the one entry point. Everything else here is either its
//! input/output types or private machinery.

mod fonts;
mod fragment;
mod layout;

pub use fonts::{FontFamily, font_generation, new_font_system, new_font_system_at};
pub use fragment::{FaceId, Fragment};
pub use layout::{Constraint, TextLayout};

use fragment::FaceRegistry;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Hard cap rather than real LRU eviction: this crate has no caller yet to
/// prove an eviction policy against (`plans/text-engine/001`'s own risk
/// list). A full clear on overflow is a correct, if blunt, bound on memory —
/// revisit if a real workload shows it thrashing.
const CACHE_CAPACITY: usize = 256;

struct Engine {
    font_system: cosmic_text::FontSystem,
    /// The `fonts::font_generation()` this `font_system` was built at.
    generation: u64,
    cache: HashMap<String, TextLayout>,
    hits: u64,
    misses: u64,
    faces: FaceRegistry,
}

impl Engine {
    /// Picks up fonts installed since this `FontSystem` was built. The
    /// layout cache goes with it: a family that previously fell back to
    /// something else may now resolve to the real thing, and every cached
    /// layout for it would otherwise still be the fallback's.
    ///
    /// `faces` deliberately survives: `fonts::EXTRA_FONTS` is append-only
    /// and applied in a fixed order, so every `fontdb::ID` handed out
    /// before still names the same face afterwards — which is the whole
    /// reason a `FaceId` a caller is holding stays valid across an install.
    fn sync_fonts(&mut self) {
        if self.generation == font_generation() {
            return;
        }
        let (font_system, generation) = new_font_system_at();
        self.font_system = font_system;
        self.generation = generation;
        self.cache.clear();
    }
}

fn engine() -> &'static Mutex<Engine> {
    static ENGINE: OnceLock<Mutex<Engine>> = OnceLock::new();
    ENGINE.get_or_init(|| {
        let (font_system, generation) = new_font_system_at();
        Mutex::new(Engine {
            font_system,
            generation,
            cache: HashMap::new(),
            hits: 0,
            misses: 0,
            faces: FaceRegistry::default(),
        })
    })
}

/// Every family the shaping engine can resolve — the system scan plus
/// anything [`install_font`] has added. This is the authoritative list for a
/// font picker: a family absent from it is one cosmic-text cannot shape
/// with, however well the webview might preview it.
pub fn list_font_families() -> Vec<FontFamily> {
    let mut engine = engine()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    engine.sync_fonts();
    fonts::families_in(engine.font_system.db())
}

/// Loads a font file so every later layout — and every `FontSystem` built
/// after this — can shape with it. Returns the family names the file
/// contained, empty if it held no usable face.
pub fn install_font(data: Vec<u8>) -> Vec<String> {
    fonts::register_font_data(data)
}

/// `TextContent`'s nested types derive `PartialEq` but not `Hash` — `f32`
/// has no total order, so a correct `Hash` impl would need to hash bit
/// patterns by hand. Serializing to JSON and using the string as the key
/// sidesteps that entirely, using a capability the type already has
/// (`Serialize`, needed for the project file anyway) rather than writing a
/// second, easy-to-get-wrong implementation of equality.
fn cache_key(content: &quiro_project::TextContent, constraint: &Constraint) -> String {
    format!(
        "{}|{:.4}|{:.4}|{:.4}",
        serde_json::to_string(content).unwrap_or_default(),
        constraint.anchor_height,
        constraint.width,
        constraint.height,
    )
}

/// Lays out `content` against `constraint` and returns its fragments plus the
/// cosmic-text buffers they were shaped from. Pure from a caller's
/// perspective — same inputs always produce the same output — backed by a
/// process-wide cache, so a renderer calling this once per frame for
/// unchanged text (`plans/text-engine/002`) does not re-shape it every time.
pub fn layout_text(content: &quiro_project::TextContent, constraint: Constraint) -> TextLayout {
    let key = cache_key(content, &constraint);
    let mut engine = engine()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // Before the cache lookup, not after: an install since the last call
    // invalidates the cache, and serving a stale hit here would render the
    // fallback font the family used to resolve to.
    engine.sync_fonts();

    if let Some(cached) = engine.cache.get(&key).cloned() {
        engine.hits += 1;
        return cached;
    }

    engine.misses += 1;
    // `MutexGuard`'s custom `DerefMut` hides field disjointness from the
    // borrow checker, so `&mut engine.font_system` and `&mut engine.faces`
    // in the same call would look like two overlapping borrows of `engine`
    // itself; going through one `&mut Engine` first exposes the real,
    // disjoint fields underneath.
    let engine = &mut *engine;
    let result = layout::compute(
        &mut engine.font_system,
        content,
        &constraint,
        &mut engine.faces,
    );
    if engine.cache.len() >= CACHE_CAPACITY {
        engine.cache.clear();
    }
    engine.cache.insert(key, result.clone());
    result
}

/// `(hits, misses)` since process start. Exists for callers to prove they
/// are not re-shaping unchanged text every frame — `quiro-rendering`'s own
/// test suite checks this across the crate boundary, not just here.
pub fn cache_stats() -> (u64, u64) {
    let engine = engine()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    (engine.hits, engine.misses)
}

/// The raw bytes of the face named by `id`, as returned by a prior
/// `layout_text` call's `Fragment::font_face` — `None` if `id` was never
/// minted by this process's `FaceRegistry` (e.g. it came from a different
/// process) or the face's backing file failed to load. `plans/text-engine/003`:
/// the webview registers these bytes as a `FontFace` under `quiro-face-{id}`
/// rather than resolving `font_family` itself, so it paints with provably the
/// same face cosmic-text shaped with.
pub fn face_bytes(id: FaceId) -> Option<Vec<u8>> {
    let mut engine = engine()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    engine.sync_fonts();
    let real_id = engine.faces.resolve(id)?;
    engine
        .font_system
        .db()
        .with_face_data(real_id, |data, _face_index| data.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use quiro_project::{
        GrowType, Paragraph, ParagraphSet, RunStyle, TextAlign, TextContent, TextRoot, TextRun,
        VerticalAlign,
    };

    fn one_run(text: &str, style: RunStyle) -> TextContent {
        TextContent {
            root: TextRoot {
                children: vec![ParagraphSet {
                    children: vec![Paragraph {
                        align: TextAlign::Left,
                        line_height: 1.2,
                        children: vec![TextRun {
                            text: text.to_string(),
                            style,
                        }],
                    }],
                }],
            },
            grow_type: GrowType::AutoWidth,
            vertical_align: VerticalAlign::Top,
            halo: None,
        }
    }

    /// A migrated `TextSegment` — centred, 48px, weight 700 — as
    /// `ProjectConfiguration::migrate_text_content` (`plans/text-engine/000`)
    /// actually produces one. Not an invented case: this is the plan's own
    /// acceptance criterion, "a migrated TextSegment (centred, 48px, weight
    /// 700)".
    fn migrated_text_segment() -> TextContent {
        TextContent {
            root: TextRoot {
                children: vec![ParagraphSet {
                    children: vec![Paragraph {
                        align: TextAlign::Center,
                        line_height: 1.2,
                        children: vec![TextRun {
                            text: "Text".to_string(),
                            style: RunStyle {
                                font_family: "sans-serif".to_string(),
                                font_size: 48.0,
                                font_weight: 700.0,
                                italic: false,
                                color: "#ffffff".to_string(),
                                letter_spacing: 0.0,
                                decoration: quiro_project::TextDecoration::None,
                                transform: quiro_project::TextTransform::None,
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

    /// A migrated `Text` annotation — auto-width, single run — as
    /// `ProjectConfiguration::migrate_annotation_space`'s third step
    /// actually produces one.
    fn migrated_annotation() -> TextContent {
        one_run(
            "Save",
            RunStyle {
                font_family: "sans-serif".to_string(),
                font_size: 45.0,
                font_weight: 400.0,
                italic: false,
                color: "#ff0000".to_string(),
                letter_spacing: 0.0,
                decoration: quiro_project::TextDecoration::None,
                transform: quiro_project::TextTransform::None,
            },
        )
    }

    fn wide_constraint() -> Constraint {
        Constraint {
            anchor_height: 1080.0,
            width: 1000.0,
            height: 1000.0,
        }
    }

    #[test]
    fn migrated_text_segment_lays_out_one_centred_fragment() {
        let content = migrated_text_segment();
        let layout = layout_text(&content, wide_constraint());

        assert_eq!(layout.fragments.len(), 1);
        let fragment = &layout.fragments[0];
        assert_eq!(fragment.text, "Text");
        assert_eq!(fragment.font_size, 48.0);
        assert_eq!(fragment.font_weight, 700);
        assert_eq!(fragment.color, "#ffffff");
        assert_eq!(layout.buffers.len(), 1);
    }

    #[test]
    fn migrated_annotation_lays_out_one_fragment() {
        let content = migrated_annotation();
        let layout = layout_text(&content, wide_constraint());

        assert_eq!(layout.fragments.len(), 1);
        let fragment = &layout.fragments[0];
        assert_eq!(fragment.text, "Save");
        assert_eq!(fragment.font_size, 45.0);
        assert_eq!(fragment.color, "#ff0000");
    }

    /// `plans/text-engine/003`'s whole reason to exist: a `Fragment`'s
    /// `font_face` has to be stable enough for a second call, elsewhere in
    /// the process, to ask for that exact face's bytes back.
    #[test]
    fn a_fragments_font_face_resolves_to_bytes() {
        let content = one_run("probe", RunStyle::default());
        let layout = layout_text(&content, wide_constraint());

        let face_id = layout.fragments[0].font_face;
        let bytes = face_bytes(face_id);
        assert!(
            bytes.is_some_and(|b| !b.is_empty()),
            "a face named by a real fragment must resolve to non-empty bytes"
        );
    }

    /// The same face, referenced from two different layouts, must be the
    /// same `FaceId` — a webview caching registered `FontFace`s by id would
    /// otherwise re-register (and re-transfer) the same bytes every time.
    #[test]
    fn the_same_face_interns_to_the_same_id() {
        let a = layout_text(&one_run("aaa", RunStyle::default()), wide_constraint());
        let b = layout_text(&one_run("bbb", RunStyle::default()), wide_constraint());

        assert_eq!(a.fragments[0].font_face, b.fragments[0].font_face);
    }

    /// An id this process never minted (here, one built from a wildly
    /// different registry index than anything `layout_text` would assign in
    /// a fresh test run) must not resolve to another face's bytes.
    #[test]
    fn an_unknown_face_id_resolves_to_nothing() {
        // Force at least one real interning first so the registry is
        // non-empty, then probe far past it.
        let _ = layout_text(&one_run("seed", RunStyle::default()), wide_constraint());
        let bogus = FaceId(u64::MAX);
        assert!(face_bytes(bogus).is_none());
    }

    /// The property Penpot needs two layout passes for: at `AutoWidth`, the
    /// content is not laid out against some huge intermediate width, so
    /// centring lands on the block's own (narrow) width, not on whatever the
    /// constraint's box width happened to be.
    #[test]
    fn auto_width_centers_against_the_blocks_own_width() {
        let mut content = one_run(
            "Hi",
            RunStyle {
                font_size: 20.0,
                ..RunStyle::default()
            },
        );
        content.root.children[0].children[0].align = TextAlign::Center;

        let layout = layout_text(&content, wide_constraint());

        assert_eq!(layout.fragments.len(), 1);
        // The block is only as wide as "Hi" itself, not the 1000px box — a
        // fragment centred against the *box* would sit far to the right of
        // where this one has to land.
        assert!(
            layout.width < 100.0,
            "expected a narrow auto-width block, got {}",
            layout.width
        );
        assert!((layout.fragments[0].x - 0.0).abs() < 1.0);
    }

    #[test]
    fn a_string_that_fits_produces_one_fragment() {
        let content = one_run("Hello", RunStyle::default());
        let layout = layout_text(
            &content,
            Constraint {
                anchor_height: 1080.0,
                width: 500.0,
                height: 500.0,
            },
        );
        assert_eq!(layout.fragments.len(), 1);
    }

    /// `constraint.anchor_height` is what makes `RunStyle::font_size`'s "as
    /// if the anchor were 1080 tall" promise true. A capture or frame that
    /// isn't 1080 tall must scale every measured quantity by the same
    /// factor, `Fragment::font_size` included — a painter drawing at that
    /// field must draw glyphs the same size the `x`/`y`/`width` it was also
    /// given were positioned for.
    #[test]
    fn anchor_height_scales_font_size_and_fragment_geometry() {
        let content = one_run("Hi", RunStyle::default());
        let at_1080 = layout_text(
            &content,
            Constraint {
                anchor_height: 1080.0,
                width: 1000.0,
                height: 1000.0,
            },
        );
        let at_2160 = layout_text(
            &content,
            Constraint {
                anchor_height: 2160.0,
                width: 1000.0,
                height: 1000.0,
            },
        );

        let a = &at_1080.fragments[0];
        let b = &at_2160.fragments[0];
        assert!(
            (b.font_size - a.font_size * 2.0).abs() < 0.01,
            "expected font_size to double: {} vs {}",
            a.font_size,
            b.font_size
        );
        assert!(
            (b.width - a.width * 2.0).abs() < a.width * 0.02,
            "expected fragment width to double: {} vs {}",
            a.width,
            b.width
        );
        assert!(
            (b.height - a.height * 2.0).abs() < 0.01,
            "expected fragment height to double: {} vs {}",
            a.height,
            b.height
        );
    }

    #[test]
    fn a_narrow_box_wraps_to_two_lines() {
        let mut content = one_run("a wide sentence that must wrap", RunStyle::default());
        content.grow_type = GrowType::AutoHeight;
        let layout = layout_text(
            &content,
            Constraint {
                anchor_height: 1080.0,
                width: 60.0,
                height: 1000.0,
            },
        );
        // Two visual lines from one run means two fragments sharing run 0,
        // at different y positions.
        assert!(
            layout.fragments.len() >= 2,
            "expected wrapping, got {} fragment(s)",
            layout.fragments.len()
        );
        assert_ne!(layout.fragments[0].y, layout.fragments[1].y);
    }

    #[test]
    fn an_explicit_newline_is_two_paragraphs_not_one_wrapped_line() {
        let content = TextContent {
            root: TextRoot {
                children: vec![ParagraphSet {
                    children: vec![
                        Paragraph {
                            align: TextAlign::Left,
                            line_height: 1.2,
                            children: vec![TextRun {
                                text: "First".to_string(),
                                style: RunStyle::default(),
                            }],
                        },
                        Paragraph {
                            align: TextAlign::Left,
                            line_height: 1.2,
                            children: vec![TextRun {
                                text: "Second".to_string(),
                                style: RunStyle::default(),
                            }],
                        },
                    ],
                }],
            },
            grow_type: GrowType::AutoWidth,
            vertical_align: VerticalAlign::Top,
            halo: None,
        };
        let layout = layout_text(&content, wide_constraint());

        assert_eq!(layout.fragments.len(), 2);
        assert_eq!(layout.fragments[0].paragraph, 0);
        assert_eq!(layout.fragments[1].paragraph, 1);
        assert!(layout.fragments[1].y > layout.fragments[0].y);

        // A buffer is shaped from its own (0, 0); a renderer painting
        // buffers[1] directly, rather than from fragments, needs its own
        // offset to land in the same place fragments[1] did.
        assert_eq!(layout.buffers.len(), 2);
        assert_eq!(layout.paragraph_y_offsets.len(), 2);
        assert_eq!(layout.paragraph_y_offsets[0], 0.0);
        assert!(layout.paragraph_y_offsets[1] > 0.0);
    }

    #[test]
    fn a_break_opportunity_past_the_box_still_wraps() {
        let mut content = one_run("supercalifragilisticexpialidocious", RunStyle::default());
        content.grow_type = GrowType::AutoHeight;
        let layout = layout_text(
            &content,
            Constraint {
                anchor_height: 1080.0,
                width: 30.0,
                height: 1000.0,
            },
        );
        // No word-break opportunity at all in one unbroken word; cosmic-text
        // must still produce *something* rather than overflow silently —
        // one line, wider than the box, is the honest result.
        assert_eq!(layout.fragments.len(), 1);
    }

    #[test]
    fn measuring_the_same_content_twice_hits_the_cache() {
        // A key unique to this test, not shared with any other — tests run
        // in parallel threads within this binary, and `cache_stats()` is a
        // process-global counter, so two tests racing on the same cache
        // entry (e.g. both using `migrated_text_segment()`) would make this
        // exact-count assertion flaky.
        let content = one_run("cache-probe-only-this-test", RunStyle::default());
        let constraint = wide_constraint();

        layout_text(&content, constraint);
        let (hits_before, _) = cache_stats();
        layout_text(&content, constraint);
        let (hits_after, _) = cache_stats();

        assert_eq!(hits_after, hits_before + 1);
    }

    /// The full `vertical_align` × `grow_type` matrix: nine cases, all
    /// pinned, because there is no renderer to eyeball this against yet.
    mod vertical_align_matrix {
        use super::*;

        fn content_with(grow_type: GrowType, vertical_align: VerticalAlign) -> TextContent {
            let mut content = one_run("Hi", RunStyle::default());
            content.grow_type = grow_type;
            content.vertical_align = vertical_align;
            content
        }

        fn fixed_constraint() -> Constraint {
            Constraint {
                anchor_height: 1080.0,
                width: 200.0,
                height: 200.0,
            }
        }

        #[test]
        fn auto_width_ignores_vertical_align() {
            let mut ys = Vec::new();
            for valign in [
                VerticalAlign::Top,
                VerticalAlign::Center,
                VerticalAlign::Bottom,
            ] {
                let content = content_with(GrowType::AutoWidth, valign);
                let layout = layout_text(&content, fixed_constraint());
                ys.push(layout.fragments[0].y);
            }
            // The object's own height follows its content in this grow
            // type, so there is no container to align within — every
            // choice of vertical_align must land the single line at the
            // same baseline.
            assert!(
                (ys[0] - ys[1]).abs() < 0.01 && (ys[1] - ys[2]).abs() < 0.01,
                "expected identical y across valigns, got {ys:?}"
            );
        }

        #[test]
        fn auto_height_ignores_vertical_align() {
            let mut ys = Vec::new();
            for valign in [
                VerticalAlign::Top,
                VerticalAlign::Center,
                VerticalAlign::Bottom,
            ] {
                let content = content_with(GrowType::AutoHeight, valign);
                let layout = layout_text(&content, fixed_constraint());
                ys.push(layout.fragments[0].y);
            }
            assert!(
                (ys[0] - ys[1]).abs() < 0.01 && (ys[1] - ys[2]).abs() < 0.01,
                "expected identical y across valigns, got {ys:?}"
            );
        }

        #[test]
        fn fixed_top_puts_the_baseline_near_the_top() {
            let content = content_with(GrowType::Fixed, VerticalAlign::Top);
            let layout = layout_text(&content, fixed_constraint());
            assert!(
                layout.fragments[0].y < 60.0,
                "got {}",
                layout.fragments[0].y
            );
        }

        #[test]
        fn fixed_center_puts_the_baseline_near_the_middle() {
            let content = content_with(GrowType::Fixed, VerticalAlign::Center);
            let layout = layout_text(&content, fixed_constraint());
            let y = layout.fragments[0].y;
            assert!((60.0..140.0).contains(&y), "got {y}");
        }

        #[test]
        fn fixed_bottom_puts_the_baseline_near_the_bottom() {
            let content = content_with(GrowType::Fixed, VerticalAlign::Bottom);
            let layout = layout_text(&content, fixed_constraint());
            assert!(
                layout.fragments[0].y > 140.0,
                "got {}",
                layout.fragments[0].y
            );
        }
    }
}
