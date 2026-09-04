use glyphon::{
    Cache, Color, FontSystem, Resolution, SwashCache, TextArea, TextAtlas, TextBounds,
    TextRenderer, Viewport,
};
use log::warn;
use wgpu::{Device, Queue};

use crate::text::PreparedText;

pub struct TextLayer {
    font_system: FontSystem,
    /// The `quiro_text::font_generation()` `font_system` was built at. A font
    /// installed mid-session (the picker's Google Fonts path) has to reach
    /// this `FontSystem` too, or `quiro-text` shapes with the real face while
    /// glyphon paints it from a database that has never heard of it.
    font_generation: u64,
    swash_cache: SwashCache,
    text_atlas: TextAtlas,
    text_renderer: TextRenderer,
    viewport: Viewport,
    /// One `quiro_text::TextLayout` per `PreparedText`, each owning one
    /// `cosmic_text::Buffer` per paragraph — kept alive here because
    /// `TextArea` only borrows a buffer, and `text_renderer.prepare` reads
    /// those borrows.
    layouts: Vec<quiro_text::TextLayout>,
}

impl TextLayer {
    pub fn new(device: &Device, queue: &Queue) -> Self {
        let (font_system, font_generation) = super::new_font_system_at();
        let swash_cache = SwashCache::new();
        let cache = Cache::new(device);
        let viewport = Viewport::new(device, &cache);
        let mut text_atlas = TextAtlas::new(device, queue, &cache, wgpu::TextureFormat::Rgba8Unorm);
        let text_renderer = TextRenderer::new(
            &mut text_atlas,
            device,
            wgpu::MultisampleState::default(),
            None,
        );

        Self {
            font_system,
            font_generation,
            swash_cache,
            text_atlas,
            text_renderer,
            viewport,
            layouts: Vec::new(),
        }
    }

    pub fn prepare(
        &mut self,
        device: &Device,
        queue: &Queue,
        output_size: (u32, u32),
        texts: &[PreparedText],
    ) {
        // A font installed since the last frame changes what `layout_text`
        // below resolves; this database has to follow it. `fontdb::ID`s are
        // append-only across a rebuild (see `quiro_text::fonts`), so the
        // atlas and swash cache keyed on them stay valid and are kept.
        if self.font_generation != super::font_generation() {
            let (font_system, generation) = super::new_font_system_at();
            self.font_system = font_system;
            self.font_generation = generation;
        }

        self.layouts.clear();
        self.layouts.reserve(texts.len());

        // (layout index, buffer index within that layout, left, top, clip bounds)
        // — collected up front so the TextArea iterator below can borrow
        // self.layouts immutably without also holding it mutably here.
        let mut placements: Vec<(usize, usize, f32, f32, TextBounds)> = Vec::new();

        for text in texts {
            let width = (text.bounds[2] - text.bounds[0]).max(1.0);
            let height = (text.bounds[3] - text.bounds[1]).max(1.0);

            let layout = quiro_text::layout_text(
                &text.content,
                quiro_text::Constraint {
                    anchor_height: output_size.1 as f32,
                    width,
                    height,
                },
            );

            // Clip at the box's own width — no slack term. Extend the
            // bottom to the laid-out height so descenders and any extra
            // wrapped lines are never cut off when the box the editor
            // measured is a touch shorter than what actually shaped.
            let laid_out_height = layout.height.max(height);
            let bounds = TextBounds {
                left: text.bounds[0].floor() as i32,
                top: text.bounds[1].floor() as i32,
                right: (text.bounds[0] + width).ceil() as i32,
                bottom: (text.bounds[1] + laid_out_height).ceil() as i32,
            };

            let layout_index = self.layouts.len();
            for (buffer_index, y_offset) in layout.paragraph_y_offsets.iter().enumerate() {
                placements.push((
                    layout_index,
                    buffer_index,
                    text.bounds[0],
                    text.bounds[1] + y_offset,
                    bounds,
                ));
            }
            self.layouts.push(layout);
        }

        let text_areas = placements
            .iter()
            .map(
                |&(layout_index, buffer_index, left, top, bounds)| TextArea {
                    buffer: &self.layouts[layout_index].buffers[buffer_index],
                    left,
                    top,
                    scale: 1.0,
                    bounds,
                    // Never actually read: every glyph's Attrs already carries
                    // its own resolved colour (quiro_text::layout::build_attrs),
                    // so color_opt is always Some and default_color is purely
                    // the fallback glyphon's API requires a value for.
                    default_color: Color::rgba(255, 255, 255, 255),
                    custom_glyphs: &[],
                },
            )
            .collect::<Vec<_>>();

        self.viewport.update(
            queue,
            Resolution {
                width: output_size.0,
                height: output_size.1,
            },
        );

        // A second FontSystem instance from the one quiro_text shaped these
        // buffers with — safe only because both come from new_font_system's
        // shared OnceLock template. Cloning that template's fontdb::Database
        // preserves every face's fontdb::ID exactly, so a LayoutGlyph::font_id
        // baked in by one clone resolves correctly against any other.
        if let Err(error) = self.text_renderer.prepare(
            device,
            queue,
            &mut self.font_system,
            &mut self.text_atlas,
            &self.viewport,
            text_areas,
            &mut self.swash_cache,
        ) {
            warn!("Failed to prepare text: {error:?}");
        }
    }

    pub fn render<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>) {
        if let Err(error) = self
            .text_renderer
            .render(&self.text_atlas, &self.viewport, pass)
        {
            warn!("Failed to render text: {error:?}");
        }
    }
}
