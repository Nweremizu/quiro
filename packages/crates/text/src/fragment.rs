use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::ops::Range;

/// A face identity that can cross a process boundary. `cosmic_text::fontdb::ID`
/// can't: it has no `Serialize`/`specta::Type` impl, and its internal
/// slotmap key is private with no public constructor from a raw integer
/// (only `ID::dummy()`) — a value the frontend sent back could never be
/// turned back into a real `fontdb::ID`. This wraps a `FaceRegistry`-assigned
/// integer instead; two `FaceId`s are equal iff they name the same face in
/// this crate's one shared `FontSystem`. `plans/text-engine/003` ships the
/// bytes this id names, via `crate::face_bytes`.
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FaceId(pub(crate) u64);

/// Maps `fontdb::ID` (real, process-local, not serializable) to `FaceId`
/// (wire-safe) and back. Lives on `Engine` alongside the `FontSystem` it
/// names faces from, so a `FaceId` a caller holds always resolves against
/// the same database that minted it.
#[derive(Default)]
pub(crate) struct FaceRegistry {
    to_wire: HashMap<cosmic_text::fontdb::ID, FaceId>,
    to_real: HashMap<FaceId, cosmic_text::fontdb::ID>,
    next: u64,
}

impl FaceRegistry {
    fn intern(&mut self, real: cosmic_text::fontdb::ID) -> FaceId {
        if let Some(&wire) = self.to_wire.get(&real) {
            return wire;
        }
        let wire = FaceId(self.next);
        self.next += 1;
        self.to_wire.insert(real, wire);
        self.to_real.insert(wire, real);
        wire
    }

    pub(crate) fn resolve(&self, wire: FaceId) -> Option<cosmic_text::fontdb::ID> {
        self.to_real.get(&wire).copied()
    }
}

/// One contiguous, same-style piece of a visual (wrapped) line: the
/// intersection of a cosmic-text `LayoutRun` with one of `TextContent`'s
/// style runs. Fully resolved — a painter needs nothing else, and never
/// re-measures.
#[derive(Type, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fragment {
    /// Index into `TextRoot`'s flattened paragraph list.
    pub paragraph: u32,
    /// Index into that paragraph's `children` (its style runs).
    pub run: u32,
    pub x: f32,
    /// Baseline, not top — matches `cosmic_text::LayoutRun::line_y` and the
    /// SVG `dominant-baseline` convention the frontend painter already
    /// assumes for `position-data`-shaped output.
    pub y: f32,
    pub width: f32,
    pub height: f32,
    /// The paragraph's bidi direction. cosmic-text runs bidi regardless of
    /// whether a direction control exists in the UI, so this is correct even
    /// though nothing yet lets a user choose it. A painter anchors an RTL
    /// fragment at `x + width`, not `x`.
    pub rtl: bool,
    pub text: String,
    /// The face this fragment's glyphs actually shaped with — which may
    /// differ from the run's requested `font_family` after fallback
    /// substitution. Taken from the fragment's first glyph; a fallback
    /// substitution mid-fragment (e.g. an emoji inside a Latin run) is not
    /// split into its own fragment.
    pub font_face: FaceId,
    pub font_size: f32,
    pub font_weight: u16,
    pub italic: bool,
    pub color: String,
    pub decoration: quiro_project::TextDecoration,
}

/// Applies `transform` before shaping, not after: a transform can change the
/// text's length (`ß` → `SS`) or its wrapping, so it has to be in effect
/// before cosmic-text ever sees the string, not patched onto the result.
pub(crate) fn apply_transform(text: &str, transform: quiro_project::TextTransform) -> String {
    match transform {
        quiro_project::TextTransform::None => text.to_string(),
        quiro_project::TextTransform::Uppercase => text.to_uppercase(),
        quiro_project::TextTransform::Lowercase => text.to_lowercase(),
        quiro_project::TextTransform::Capitalize => capitalize_words(text),
    }
}

/// Capitalizes the first letter of each word, preserving all other
/// characters (including whitespace) exactly. A "word" starts after any
/// non-letter character — matches CSS `text-transform: capitalize`.
fn capitalize_words(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut capitalize_next = true;
    for c in text.chars() {
        if c.is_alphabetic() {
            if capitalize_next {
                result.extend(c.to_uppercase());
            } else {
                result.push(c);
            }
            capitalize_next = false;
        } else {
            result.push(c);
            capitalize_next = true;
        }
    }
    result
}

/// One glyph run's accumulated extent within a visual line: which style run
/// it belongs to, its horizontal bounds, the byte range of the source text
/// it covers, and the face it shaped with.
struct RunExtent {
    run_index: usize,
    min_x: f32,
    max_x: f32,
    min_start: usize,
    max_end: usize,
    font_id: cosmic_text::fontdb::ID,
}

/// Extracts fragments from one already-shaped paragraph buffer.
///
/// `run_ranges` are the byte ranges each of `paragraph.children`'s runs
/// occupies in the buffer's concatenated line text — computed the same way
/// `Buffer::set_rich_text` computes its own internal span map, so a glyph's
/// `start` byte unambiguously identifies which run produced it. `y_offset` is
/// this paragraph's accumulated vertical position within the whole
/// `TextContent`.
/// The pieces `flush` needs that stay constant across every glyph run in one
/// `extract_fragments` call — bundled so that function takes a reasonable
/// number of parameters.
struct FlushContext<'a> {
    paragraph: &'a quiro_project::Paragraph,
    paragraph_idx: u32,
    faces: &'a mut FaceRegistry,
    scale: f32,
}

pub(crate) fn extract_fragments(
    paragraph_idx: u32,
    paragraph: &quiro_project::Paragraph,
    run_ranges: &[Range<usize>],
    buffer: &cosmic_text::Buffer,
    y_offset: f32,
    faces: &mut FaceRegistry,
    scale: f32,
) -> Vec<Fragment> {
    let mut ctx = FlushContext {
        paragraph,
        paragraph_idx,
        faces,
        scale,
    };
    let mut fragments = Vec::new();

    for layout_run in buffer.layout_runs() {
        let mut current: Option<RunExtent> = None;

        for glyph in layout_run.glyphs.iter() {
            // A glyph whose cluster start does not land inside any known run
            // range (a shaping edge case — e.g. a ligature reshuffling
            // cluster boundaries) is dropped rather than mis-attributed; the
            // fragment it would have widened is very slightly too narrow
            // instead of wrong.
            let Some(run_index) = run_ranges
                .iter()
                .position(|range| range.contains(&glyph.start))
            else {
                continue;
            };

            let x_min = glyph.x;
            let x_max = glyph.x + glyph.w;

            match &mut current {
                Some(extent) if extent.run_index == run_index => {
                    extent.min_x = extent.min_x.min(x_min);
                    extent.max_x = extent.max_x.max(x_max);
                    extent.min_start = extent.min_start.min(glyph.start);
                    extent.max_end = extent.max_end.max(glyph.end);
                }
                _ => {
                    if let Some(extent) = current.take() {
                        flush(&mut ctx, &layout_run, y_offset, extent, &mut fragments);
                    }
                    current = Some(RunExtent {
                        run_index,
                        min_x: x_min,
                        max_x: x_max,
                        min_start: glyph.start,
                        max_end: glyph.end,
                        font_id: glyph.font_id,
                    });
                }
            }
        }

        if let Some(extent) = current.take() {
            flush(&mut ctx, &layout_run, y_offset, extent, &mut fragments);
        }
    }

    fragments
}

fn flush(
    ctx: &mut FlushContext,
    layout_run: &cosmic_text::LayoutRun,
    y_offset: f32,
    extent: RunExtent,
    fragments: &mut Vec<Fragment>,
) {
    let Some(run) = ctx.paragraph.children.get(extent.run_index) else {
        return;
    };
    let Some(text) = layout_run.text.get(extent.min_start..extent.max_end) else {
        return;
    };
    if text.is_empty() {
        return;
    }

    fragments.push(Fragment {
        paragraph: ctx.paragraph_idx,
        run: extent.run_index as u32,
        x: extent.min_x,
        y: y_offset + layout_run.line_y,
        width: (extent.max_x - extent.min_x).max(0.0),
        height: layout_run.line_height,
        rtl: layout_run.rtl,
        text: text.to_string(),
        font_face: ctx.faces.intern(extent.font_id),
        // The actually-shaped size, not the authored px@1080 value — must
        // match what `x`/`y`/`width` above were measured at, or a painter
        // setting `font-size` from this field draws glyphs a different size
        // than the box they were positioned for.
        font_size: (run.style.font_size * ctx.scale).max(1.0),
        font_weight: run.style.font_weight.round().clamp(100.0, 900.0) as u16,
        italic: run.style.italic,
        color: run.style.color.clone(),
        decoration: run.style.decoration,
    });
}
