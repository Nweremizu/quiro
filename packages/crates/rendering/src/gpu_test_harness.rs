//! A headless GPU harness for asserting on actual rendered pixels.
//!
//! Shader behaviour was previously unverifiable in tests: WGSL is compiled by
//! the driver at pipeline creation, and the pipeline needs a device, and the
//! device was assumed to need a window. It does not — `create_wgpu_instance`
//! already requests adapters with `compatible_surface: None`, and there is a
//! `force_fallback_adapter` software path behind it. So a test can render a
//! real frame through the real pipeline and read the bytes back.
//!
//! That matters most for properties that are *security* claims rather than
//! visual preferences. `MaskMode::Redact` promises no source pixel survives
//! inside the region. Reviewing the shader is not evidence of that; reading
//! the output pixels is.
//!
//! Tests using this must call [`GpuHarness::new`] and skip when it returns
//! `None` — a machine with no usable adapter at all should not fail the suite.

#![cfg(test)]

use crate::frame_pipeline::RenderSession;

pub struct GpuHarness {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

impl GpuHarness {
    /// `None` when no adapter can be acquired — a headless CI box without even
    /// a software rasterizer. Callers skip rather than fail.
    pub fn new() -> Option<Self> {
        pollster::block_on(async {
            let instance = crate::create_wgpu_instance().await;

            // Prefer real hardware, fall back to the software rasterizer
            // (WARP on Windows) so this stays runnable in CI.
            let adapter = match instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    force_fallback_adapter: false,
                    compatible_surface: None,
                })
                .await
            {
                Ok(adapter) => adapter,
                Err(_) => instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::LowPower,
                        force_fallback_adapter: true,
                        compatible_surface: None,
                    })
                    .await
                    .ok()?,
            };

            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor {
                    label: Some("mask pixel test device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    memory_hints: wgpu::MemoryHints::default(),
                    trace: wgpu::Trace::Off,
                })
                .await
                .ok()?;

            Some(Self { device, queue })
        })
    }

    /// Fill the session's current texture with a flat colour.
    ///
    /// Seeding via `write_texture` is not possible: `RenderSession`'s textures
    /// are created without `COPY_DST`, and widening a production texture's
    /// usage flags to suit a test is the wrong trade. A render pass that only
    /// clears needs nothing but `RENDER_ATTACHMENT`, which they already have,
    /// and no shader or pipeline at all.
    ///
    /// A flat source is enough for the properties these tests assert. "Every
    /// pixel inside is exactly black" rules out a partial blend (which would
    /// leave a non-zero value) and "one distinct colour" rules out a gradient
    /// at the edge — neither needs a patterned source to detect.
    pub fn fill(&self, session: &RenderSession, color: wgpu::Color) {
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("harness fill"),
            });
        encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("harness fill pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: session.current_texture_view(),
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(color),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        self.queue.submit(Some(encoder.finish()));
    }

    /// Read the session's current texture back as RGBA8.
    ///
    /// `copy_texture_to_buffer` requires rows padded to 256 bytes, so the
    /// padding is stripped here rather than in every caller.
    pub fn read_pixels(&self, session: &RenderSession, width: u32, height: u32) -> Vec<[u8; 4]> {
        const ALIGN: u32 = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let unpadded = width * 4;
        let padded = unpadded.div_ceil(ALIGN) * ALIGN;

        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("mask readback"),
            size: (padded * height) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("mask readback encoder"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: session.current_texture(),
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit(Some(encoder.finish()));

        let slice = buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        self.device.poll(wgpu::PollType::Wait).expect("poll");
        rx.recv().expect("map result").expect("mapped");

        let view = slice.get_mapped_range();
        let mut pixels = Vec::with_capacity((width * height) as usize);
        for y in 0..height {
            let row = (y * padded) as usize;
            for x in 0..width {
                let i = row + (x * 4) as usize;
                pixels.push([view[i], view[i + 1], view[i + 2], view[i + 3]]);
            }
        }
        drop(view);
        buffer.unmap();
        pixels
    }
}
