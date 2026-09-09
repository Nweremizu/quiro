//! Draws annotations — the shapes the frontend previously composited in
//! Canvas2D at export time and therefore could never put in a video.
//!
//! One draw per annotation, each an SDF over a full-screen quad, the same
//! approach `caption_bg.wgsl` already uses. Buffers and bind groups are pooled
//! across frames because the count changes rarely and reallocating a handful of
//! 96-byte uniforms every frame of a 60fps export is pure waste.
//!
//! Geometry resolution — anchors, timing, animation — is not here. It lives in
//! `crate::annotation`, GPU-free and unit-tested, because that is the half that
//! has to agree with the frontend's SVG overlay.

use self::annotation_color::{parse_rgba, shape_code};
use crate::{annotation::PreparedAnnotation, create_shader_render_pipeline};
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
struct AnnotationUniforms {
    rect: [f32; 4],
    fill_color: [f32; 4],
    stroke_color: [f32; 4],
    /// shape, stroke width px, corner radius px, rotation radians
    params: [f32; 4],
    /// master alpha, then padding to keep the struct 16-byte aligned
    opacity: [f32; 4],
}

pub struct AnnotationLayer {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    /// Pooled per-draw uniforms; `active` says how many are live this frame.
    slots: Vec<(wgpu::Buffer, wgpu::BindGroup)>,
    active: usize,
}

impl AnnotationLayer {
    pub fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Annotation Bind Group Layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let pipeline = create_shader_render_pipeline(
            device,
            &bind_group_layout,
            wgpu::include_wgsl!("../shaders/annotation.wgsl"),
        );

        Self {
            pipeline,
            bind_group_layout,
            slots: Vec::new(),
            active: 0,
        }
    }

    pub fn has_content(&self) -> bool {
        self.active > 0
    }

    /// Takes the resolved annotations rather than the whole `ProjectUniforms`,
    /// matching `TextLayer::prepare` — it keeps the layer's dependency to what
    /// it actually draws, and lets the pixel tests below build an input without
    /// standing up a full uniform set.
    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        annotations: &[PreparedAnnotation],
    ) {
        self.active = 0;

        for prepared in annotations {
            let Some(data) = uniforms_for(prepared) else {
                continue;
            };

            let index = self.active;
            if index == self.slots.len() {
                let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("Annotation Uniforms"),
                    contents: bytemuck::cast_slice(&[data]),
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                });
                let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Annotation Bind Group"),
                    layout: &self.bind_group_layout,
                    entries: &[wgpu::BindGroupEntry {
                        binding: 0,
                        resource: buffer.as_entire_binding(),
                    }],
                });
                self.slots.push((buffer, bind_group));
            } else {
                queue.write_buffer(&self.slots[index].0, 0, bytemuck::cast_slice(&[data]));
            }

            self.active += 1;
        }
    }

    pub fn render(&self, pass: &mut wgpu::RenderPass<'_>) {
        if self.active == 0 {
            return;
        }

        pass.set_pipeline(&self.pipeline);
        // Document order is paint order, so a later annotation covers an
        // earlier one — the same thing `LayersPanel` shows in the editor.
        for (_, bind_group) in self.slots.iter().take(self.active) {
            pass.set_bind_group(0, bind_group, &[]);
            pass.draw(0..6, 0..1);
        }
    }
}

/// `None` for annotation types this layer does not draw yet, and for shapes
/// that would paint nothing.
fn uniforms_for(prepared: &PreparedAnnotation) -> Option<AnnotationUniforms> {
    let annotation = &prepared.annotation;
    let shape = shape_code(annotation.annotation_type)?;

    let fill = parse_rgba(&annotation.fill_color);
    let stroke = parse_rgba(&annotation.stroke_color);
    let stroke_width = prepared.stroke_width.max(0.0);
    if fill[3] <= 0.0 && (stroke[3] <= 0.0 || stroke_width <= 0.0) {
        return None;
    }

    let [x, y, width, height] = prepared.bounds;
    if width <= 0.0 || height <= 0.0 {
        return None;
    }

    Some(AnnotationUniforms {
        rect: [x, y, width, height],
        fill_color: fill,
        stroke_color: stroke,
        params: [
            shape,
            stroke_width,
            // Rect corners follow the mask corner radius when one is set; it is
            // the only radius an annotation carries today.
            annotation.mask_corner_radius.unwrap_or(0.0) as f32,
            annotation.rotation.to_radians() as f32,
        ],
        opacity: [prepared.alpha, 0.0, 0.0, 0.0],
    })
}

/// Colour parsing and the shape table, split out so they can be tested without
/// a GPU — `AnnotationLayer::new` needs a `wgpu::Device`, these do not.
pub(crate) mod annotation_color {
    use quiro_project::AnnotationType;

    /// Which shape the shader should draw, or `None` for a type this layer does
    /// not handle yet.
    ///
    /// Mask and Focus already have `MaskLayer`; Text needs glyph layout and
    /// belongs with `TextLayer`; Arrow needs `arrow.ts` path parity before it
    /// can be drawn without drifting from the editing overlay.
    pub fn shape_code(annotation_type: AnnotationType) -> Option<f32> {
        match annotation_type {
            AnnotationType::Rectangle => Some(0.0),
            AnnotationType::Circle => Some(1.0),
            // Text and Mask are drawn, but not here: they route to `TextLayer`
            // and `MaskLayer` via `prepare_annotation_text` and
            // `mask_from_annotation`, so this layer must not also paint a box
            // where they go. Arrow and Focus are genuinely not implemented yet.
            AnnotationType::Text
            | AnnotationType::Mask
            | AnnotationType::Arrow
            | AnnotationType::Focus => None,
        }
    }

    /// Parses the colour strings the frontend writes: `#rgb`, `#rrggbb`,
    /// `#rrggbbaa` and the literal `transparent`.
    ///
    /// Anything unrecognised is fully transparent rather than a default colour:
    /// painting an opaque black rectangle over someone's frame because a hex
    /// string had a typo is far worse than painting nothing.
    pub fn parse_rgba(color: &str) -> [f32; 4] {
        let trimmed = color.trim();
        if trimmed.eq_ignore_ascii_case("transparent") || trimmed.is_empty() {
            return [0.0; 4];
        }

        let hex = trimmed.trim_start_matches('#');
        let byte = |i: usize| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok();

        match hex.len() {
            3 => {
                let digit = |i: usize| {
                    u8::from_str_radix(&hex[i..i + 1], 16)
                        .ok()
                        .map(|v| (v * 17) as f32 / 255.0)
                };
                match (digit(0), digit(1), digit(2)) {
                    (Some(r), Some(g), Some(b)) => [r, g, b, 1.0],
                    _ => [0.0; 4],
                }
            }
            6 | 8 => {
                let alpha = if hex.len() == 8 {
                    match byte(3) {
                        Some(a) => a as f32 / 255.0,
                        None => return [0.0; 4],
                    }
                } else {
                    1.0
                };
                match (byte(0), byte(1), byte(2)) {
                    (Some(r), Some(g), Some(b)) => {
                        [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, alpha]
                    }
                    _ => [0.0; 4],
                }
            }
            _ => [0.0; 4],
        }
    }
}

#[cfg(test)]
mod pixel_tests {
    //! Proof the layer actually draws, on a real GPU.
    //!
    //! The unit tests below cover colour parsing and `crate::annotation` covers
    //! placement, but neither can tell you a shape reaches the frame — a shader
    //! that compiles and paints nothing passes both. These render through the
    //! real pipeline and read the bytes back.

    use super::AnnotationLayer;
    use crate::annotation::{AnchorRects, prepare_annotation};
    use crate::frame_pipeline::RenderSession;
    use crate::gpu_test_harness::GpuHarness;
    use quiro_project::{Annotation, AnnotationAnchor, AnnotationType};

    const W: u32 = 320;
    const H: u32 = 180;

    /// Opaque white, so anything the layer draws is unambiguous.
    const SOURCE: wgpu::Color = wgpu::Color {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };

    fn annotation(annotation_type: AnnotationType, fill: &str) -> Annotation {
        Annotation {
            id: "a".into(),
            annotation_type,
            // Centred, 40% of each axis — the framing the mask pixel tests use.
            x: 0.3,
            y: 0.3,
            width: 0.4,
            height: 0.4,
            stroke_color: "transparent".into(),
            stroke_width: 0.0,
            fill_color: fill.into(),
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
            anchor: AnnotationAnchor::Canvas,
        }
    }

    fn render(harness: &GpuHarness, annotations: &[Annotation]) -> Vec<[u8; 4]> {
        let anchors = AnchorRects {
            capture: [0.0, 0.0, W as f32, H as f32],
            canvas: [0.0, 0.0, W as f32, H as f32],
        };
        let prepared: Vec<_> = annotations
            .iter()
            .filter_map(|a| prepare_annotation(a, anchors, 0.0))
            .collect();

        let session = RenderSession::new(&harness.device, W, H);
        harness.fill(&session, SOURCE);

        let mut layer = AnnotationLayer::new(&harness.device);
        layer.prepare(&harness.device, &harness.queue, &prepared);

        let mut encoder = harness
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("annotation pixel test"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("annotation pixel test pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: session.current_texture_view(),
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            layer.render(&mut pass);
        }
        harness.queue.submit(Some(encoder.finish()));

        harness.read_pixels(&session, W, H)
    }

    fn at(pixels: &[[u8; 4]], x: u32, y: u32) -> [u8; 4] {
        pixels[(y * W + x) as usize]
    }

    /// The claim the whole phase rests on: an annotation reaches the rendered
    /// frame. Before this layer, the Rust renderer drew nothing for
    /// `annotations` at all, so a red centre here is the feature working.
    #[test]
    fn a_filled_rectangle_reaches_the_frame() {
        let Some(harness) = GpuHarness::new() else {
            eprintln!("no wgpu adapter available; skipping");
            return;
        };

        let pixels = render(
            &harness,
            &[annotation(AnnotationType::Rectangle, "#ff0000")],
        );

        assert_eq!(
            at(&pixels, W / 2, H / 2),
            [255, 0, 0, 255],
            "the centre of a red rectangle must be red"
        );
    }

    /// A shader that painted its whole quad would pass the test above for the
    /// wrong reason, so the corners have to survive untouched.
    #[test]
    fn drawing_leaves_the_rest_of_the_frame_alone() {
        let Some(harness) = GpuHarness::new() else {
            eprintln!("no wgpu adapter available; skipping");
            return;
        };

        let pixels = render(
            &harness,
            &[annotation(AnnotationType::Rectangle, "#ff0000")],
        );

        for (x, y) in [(2, 2), (W - 3, 2), (2, H - 3), (W - 3, H - 3)] {
            assert_eq!(
                at(&pixels, x, y),
                [255, 255, 255, 255],
                "corner ({x}, {y}) must be untouched"
            );
        }
    }

    /// An ellipse fills its centre but not its bounding box's corners — which
    /// is what separates two shape codes genuinely reaching the shader from
    /// both falling through to a rectangle.
    #[test]
    fn an_ellipse_is_round_rather_than_rectangular() {
        let Some(harness) = GpuHarness::new() else {
            eprintln!("no wgpu adapter available; skipping");
            return;
        };

        let pixels = render(&harness, &[annotation(AnnotationType::Circle, "#ff0000")]);

        assert_eq!(
            at(&pixels, W / 2, H / 2),
            [255, 0, 0, 255],
            "the centre of an ellipse must be filled"
        );
        // Just inside the bounding box's top-left corner, which the inscribed
        // ellipse does not reach.
        let corner_x = (W as f32 * 0.31) as u32;
        let corner_y = (H as f32 * 0.31) as u32;
        assert_eq!(
            at(&pixels, corner_x, corner_y),
            [255, 255, 255, 255],
            "an ellipse must not fill its bounding box's corner"
        );
    }

    /// Types this slice does not implement must draw nothing, rather than
    /// falling through to some default shape.
    #[test]
    fn unimplemented_types_draw_nothing() {
        let Some(harness) = GpuHarness::new() else {
            eprintln!("no wgpu adapter available; skipping");
            return;
        };

        for annotation_type in [AnnotationType::Arrow, AnnotationType::Text] {
            let pixels = render(&harness, &[annotation(annotation_type, "#ff0000")]);
            assert_eq!(
                at(&pixels, W / 2, H / 2),
                [255, 255, 255, 255],
                "{annotation_type:?} must not paint until it is implemented"
            );
        }
    }

    /// Document order is paint order — the later annotation wins.
    #[test]
    fn later_annotations_paint_over_earlier_ones() {
        let Some(harness) = GpuHarness::new() else {
            eprintln!("no wgpu adapter available; skipping");
            return;
        };

        let pixels = render(
            &harness,
            &[
                annotation(AnnotationType::Rectangle, "#ff0000"),
                annotation(AnnotationType::Rectangle, "#0000ff"),
            ],
        );

        assert_eq!(
            at(&pixels, W / 2, H / 2),
            [0, 0, 255, 255],
            "the second rectangle must cover the first"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::annotation_color::{parse_rgba, shape_code};
    use quiro_project::AnnotationType;

    #[test]
    fn parses_the_colour_forms_the_frontend_writes() {
        assert_eq!(parse_rgba("#ffffff"), [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(parse_rgba("#000000"), [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(parse_rgba("transparent"), [0.0, 0.0, 0.0, 0.0]);
        assert_eq!(parse_rgba("#fff"), [1.0, 1.0, 1.0, 1.0]);

        let half = parse_rgba("#ff000080");
        assert_eq!(half[0], 1.0);
        assert!((half[3] - 0.502).abs() < 0.01);
    }

    /// A typo must paint nothing, never a default colour over the frame.
    #[test]
    fn unparseable_colours_are_transparent() {
        for input in ["", "#", "not-a-colour", "#gg0000", "#12345"] {
            assert_eq!(parse_rgba(input), [0.0; 4], "{input} should be transparent");
        }
    }

    #[test]
    fn only_the_implemented_shapes_draw() {
        assert_eq!(shape_code(AnnotationType::Rectangle), Some(0.0));
        assert_eq!(shape_code(AnnotationType::Circle), Some(1.0));
        // Deliberately unhandled for now — each needs its own slice.
        assert_eq!(shape_code(AnnotationType::Arrow), None);
        assert_eq!(shape_code(AnnotationType::Text), None);
        assert_eq!(shape_code(AnnotationType::Mask), None);
        assert_eq!(shape_code(AnnotationType::Focus), None);
    }
}
