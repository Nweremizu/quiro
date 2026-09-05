mod blur_pipeline;
mod segmentation;

use anyhow::Context;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, OnceLock, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use blur_pipeline::{BlurPassInputs, BlurPipeline, CompositePipeline};
use segmentation::SegmentationModel;

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
pub fn onnx_runtime_library_path() -> Option<std::path::PathBuf> {
    segmentation::onnx_runtime_library_path()
}

static BLUR_DISABLED: AtomicBool = AtomicBool::new(false);
static BLUR_SESSION_OBSERVER: OnceLock<fn(bool)> = OnceLock::new();

/// Globally disables camera background blur: `BlurProcessor::new` fails fast and
/// every call site degrades to its unblurred fallback. Set by the desktop app's
/// crash recovery when a previous session died with the blur pipeline active
/// (native DirectML/driver crashes never reach a panic handler).
pub fn set_blur_disabled(disabled: bool) {
    BLUR_DISABLED.store(disabled, Ordering::Release);
}

pub fn blur_disabled() -> bool {
    BLUR_DISABLED.load(Ordering::Acquire)
}

/// Registers a callback invoked with `true` while any `BlurProcessor` exists
/// (from just before the ONNX/GPU session is created until drop), so a host can
/// attribute a hard process death to the blur pipeline. Processes that never
/// register (cap-exporter, the CLI) get a no-op and unchanged behavior.
pub fn set_blur_session_observer(observer: fn(bool)) {
    let _ = BLUR_SESSION_OBSERVER.set(observer);
}

fn notify_blur_session(active: bool) {
    if let Some(observer) = BLUR_SESSION_OBSERVER.get() {
        observer(active);
    }
}

/// Pairs the observer's `true` notification with exactly one `false`, whether
/// init fails, init panics, or the processor is eventually dropped. Declared as
/// the LAST field of `BlurProcessor` so the disarm runs only after the ONNX
/// session and GPU resources have finished their own (native, crashable)
/// teardown.
struct BlurSessionHandle;

impl Drop for BlurSessionHandle {
    fn drop(&mut self) {
        notify_blur_session(false);
    }
}

const READBACK_PENDING: u8 = 0;
const READBACK_READY_OK: u8 = 1;
const READBACK_READY_ERR: u8 = 2;

enum ReadbackState {
    Idle,
    InFlight(Arc<AtomicU8>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlurMode {
    Light,
    Heavy,
}

const SEGMENTATION_SIZE: u32 = 256;
const DEFAULT_INFERENCE_INTERVAL: Duration = Duration::from_millis(66);
/// Bounds the single blocking inference (the first mask, see
/// [`BlurProcessor::start_segmentation`]) so a wedged native call cannot hang
/// the editor the way an unbounded wait would.
const FIRST_INFERENCE_TIMEOUT: Duration = Duration::from_secs(5);
const MASK_GROWTH_ALPHA: f32 = 0.25;
const MASK_SHRINK_ALPHA: f32 = 0.12;
const MASK_STABILITY_EPSILON: f32 = 0.025;
const MASK_EDGE_CONTRAST: f32 = 4.0;
const INITIAL_MASK_VALUE: f32 = 1.0;

/// Runs segmentation inference on its own thread, one request at a time.
///
/// `Session::run` is a synchronous native call whose execution provider
/// (DirectML on Windows, CoreML on macOS) competes with the render pipeline for
/// the same GPU, so running it inline stretched whichever frame triggered it.
/// That fed straight back into the wall-clock throttle in
/// [`BlurProcessor::process_into_encoder`]: a longer frame means more elapsed
/// time, which makes the *next* frame eligible for inference too, which makes
/// that frame longer again. The loop ratcheted camera blur from ~7ms to ~20ms
/// per frame across a playback and never recovered, because the throttle stops
/// throttling once the work it is meant to space out is what dictates frame
/// time. Off-thread the render loop pays a channel send instead, and
/// `in_flight` caps outstanding work at one regardless of how slow inference
/// gets.
struct InferenceWorker {
    /// Taken in `drop` to close the channel before joining the worker.
    input_tx: Option<mpsc::SyncSender<Vec<u8>>>,
    output_rx: mpsc::Receiver<Vec<f32>>,
    handle: Option<thread::JoinHandle<()>>,
    in_flight: bool,
}

impl InferenceWorker {
    fn spawn(mut model: SegmentationModel) -> anyhow::Result<Self> {
        Self::spawn_with(move |frame| model.run_inference(frame))
    }

    fn spawn_with(
        mut infer: impl FnMut(&[u8]) -> anyhow::Result<Vec<f32>> + Send + 'static,
    ) -> anyhow::Result<Self> {
        let (input_tx, input_rx) = mpsc::sync_channel::<Vec<u8>>(1);
        let (output_tx, output_rx) = mpsc::channel::<Vec<f32>>();

        let handle = thread::Builder::new()
            .name("camera-blur-segmentation".into())
            .spawn(move || {
                while let Ok(frame) = input_rx.recv() {
                    // A short mask is the failure sentinel: `apply_mask`
                    // already rejects anything smaller than the mask itself,
                    // and the reply keeps `in_flight` from latching on.
                    let mask = match infer(&frame) {
                        Ok(mask) => mask,
                        Err(e) => {
                            tracing::warn!("Segmentation inference failed: {e:#}");
                            Vec::new()
                        }
                    };
                    if output_tx.send(mask).is_err() {
                        break;
                    }
                }
            })
            .context("Failed to spawn segmentation inference thread")?;

        Ok(Self {
            input_tx: Some(input_tx),
            output_rx,
            handle: Some(handle),
            in_flight: false,
        })
    }

    fn is_busy(&self) -> bool {
        self.in_flight
    }

    /// Never blocks: the channel's one slot is exactly the request `in_flight`
    /// already guards against overlapping.
    fn submit(&mut self, frame: Vec<u8>) -> bool {
        let Some(tx) = &self.input_tx else {
            return false;
        };

        if tx.try_send(frame).is_err() {
            return false;
        }

        self.in_flight = true;
        true
    }

    fn try_take_result(&mut self) -> Option<Vec<f32>> {
        match self.output_rx.try_recv() {
            Ok(mask) => {
                self.in_flight = false;
                Some(mask)
            }
            Err(mpsc::TryRecvError::Empty) => None,
            Err(mpsc::TryRecvError::Disconnected) => {
                self.in_flight = false;
                None
            }
        }
    }

    /// Waits for a request already handed to `submit`. On timeout the request
    /// stays in flight and a later `try_take_result` collects it.
    fn wait_for_result(&mut self, timeout: Duration) -> Option<Vec<f32>> {
        match self.output_rx.recv_timeout(timeout) {
            Ok(mask) => {
                self.in_flight = false;
                Some(mask)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.in_flight = false;
                None
            }
        }
    }
}

impl Drop for InferenceWorker {
    fn drop(&mut self) {
        // Closing the channel ends the worker loop; joining it means the ONNX
        // session has finished its native teardown before `BlurSessionHandle`
        // reports the blur session inactive, keeping crash attribution honest.
        self.input_tx = None;
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

pub struct BlurProcessor {
    // Declared before `_blur_session`: dropping this joins the worker that owns
    // the ONNX session, which must happen before the session is disarmed.
    inference: InferenceWorker,
    blur_pipeline: BlurPipeline,
    composite_pipeline: CompositePipeline,
    downsample_pipeline: DownsamplePipeline,
    textures: Option<ProcessorTextures>,
    mask_data: Vec<f32>,
    smoothed_mask: Vec<f32>,
    mask_scratch: Vec<f32>,
    mask_upload: Vec<f32>,
    last_inference: Instant,
    downsample_texture: wgpu::Texture,
    downsample_view: wgpu::TextureView,
    readback_buffer: wgpu::Buffer,
    readback_bytes_per_row: u32,
    readback_state: ReadbackState,
    inference_interval: Duration,
    mask_initialized: bool,
    mask_dirty: bool,
    output_generation: u64,
    // Keep last: must drop after every other field (see BlurSessionHandle).
    _blur_session: BlurSessionHandle,
}

struct DownsamplePipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}

impl DownsamplePipeline {
    fn new(device: &wgpu::Device) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Downsample Shader"),
            source: wgpu::ShaderSource::Wgsl(BLIT_SHADER.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Downsample BGL"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Downsample Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Downsample Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        Self {
            pipeline,
            bind_group_layout,
            sampler,
        }
    }
}

struct ProcessorTextures {
    width: u32,
    height: u32,
    _blurred_texture: wgpu::Texture,
    blurred_view: wgpu::TextureView,
    _blur_intermediate: wgpu::Texture,
    blur_intermediate_view: wgpu::TextureView,
    mask_texture: wgpu::Texture,
    mask_view: wgpu::TextureView,
    output_texture: wgpu::Texture,
    output_view: wgpu::TextureView,
}

impl BlurProcessor {
    pub fn new(device: &wgpu::Device, output_format: wgpu::TextureFormat) -> anyhow::Result<Self> {
        if blur_disabled() {
            anyhow::bail!("camera background blur disabled by crash recovery");
        }

        // Armed before the ONNX session is created: model load and the first
        // GPU work are both native-crash sites we need attributed to blur.
        notify_blur_session(true);
        Self::new_inner(device, output_format, BlurSessionHandle)
    }

    fn new_inner(
        device: &wgpu::Device,
        output_format: wgpu::TextureFormat,
        blur_session: BlurSessionHandle,
    ) -> anyhow::Result<Self> {
        let inference = InferenceWorker::spawn(SegmentationModel::new()?)?;
        let blur_pipeline = BlurPipeline::new(device);
        let composite_pipeline = CompositePipeline::new(device, output_format);
        let downsample_pipeline = DownsamplePipeline::new(device);
        let pixel_count = (SEGMENTATION_SIZE * SEGMENTATION_SIZE) as usize;

        let downsample_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Downsample 256"),
            size: wgpu::Extent3d {
                width: SEGMENTATION_SIZE,
                height: SEGMENTATION_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let downsample_view = downsample_texture.create_view(&Default::default());

        let readback_bytes_per_row = (SEGMENTATION_SIZE * 4).div_ceil(256) * 256;
        let readback_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Segmentation Readback"),
            size: (readback_bytes_per_row * SEGMENTATION_SIZE) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        Ok(Self {
            inference,
            blur_pipeline,
            composite_pipeline,
            downsample_pipeline,
            textures: None,
            mask_data: vec![INITIAL_MASK_VALUE; pixel_count],
            smoothed_mask: vec![INITIAL_MASK_VALUE; pixel_count],
            mask_scratch: vec![INITIAL_MASK_VALUE; pixel_count],
            mask_upload: vec![INITIAL_MASK_VALUE; pixel_count],
            last_inference: Instant::now()
                .checked_sub(std::time::Duration::from_secs(1))
                .unwrap_or_else(Instant::now),
            downsample_texture,
            downsample_view,
            readback_buffer,
            readback_bytes_per_row,
            readback_state: ReadbackState::Idle,
            inference_interval: DEFAULT_INFERENCE_INTERVAL,
            mask_initialized: false,
            mask_dirty: true,
            output_generation: 0,
            _blur_session: blur_session,
        })
    }

    pub fn set_inference_interval(&mut self, interval: Duration) {
        self.inference_interval = interval;
    }

    pub fn output_generation(&self) -> u64 {
        self.output_generation
    }

    pub fn output_view(&self) -> Option<&wgpu::TextureView> {
        self.textures.as_ref().map(|t| &t.output_view)
    }

    pub fn process(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        input_texture: &wgpu::Texture,
        mode: BlurMode,
    ) -> &wgpu::Texture {
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Background Blur Encoder"),
        });

        self.process_into_encoder(device, queue, input_texture, &mut encoder, mode);

        queue.submit(std::iter::once(encoder.finish()));

        &self
            .textures
            .as_ref()
            .expect("textures initialized above")
            .output_texture
    }

    pub fn process_into_encoder(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        input_texture: &wgpu::Texture,
        encoder: &mut wgpu::CommandEncoder,
        mode: BlurMode,
    ) {
        let width = input_texture.width();
        let height = input_texture.height();

        self.ensure_textures(device, width, height);
        let input_view = input_texture.create_view(&Default::default());

        // Results land on the worker's schedule rather than the render loop's,
        // so collect them every frame instead of only when the throttle fires.
        if self.collect_inference_result() {
            self.mask_dirty = true;
        }

        let inference_due =
            !self.inference.is_busy() && self.last_inference.elapsed() >= self.inference_interval;
        if inference_due && self.start_segmentation(device, queue, input_texture) {
            self.last_inference = Instant::now();
        }

        if self.mask_dirty {
            self.upload_mask(queue);
            self.mask_dirty = false;
        }

        let textures = self.textures.as_ref().expect("textures initialized above");

        let (blur_intensity, blur_passes) = match mode {
            BlurMode::Light => (1.5, 1),
            BlurMode::Heavy => (2.0, 3),
        };

        for pass_index in 0..blur_passes {
            let source = if pass_index == 0 {
                &input_view
            } else {
                &textures.blurred_view
            };

            self.blur_pipeline.blur_two_pass(
                device,
                encoder,
                BlurPassInputs {
                    source,
                    intermediate: &textures.blur_intermediate_view,
                    output: &textures.blurred_view,
                    width,
                    height,
                    intensity: blur_intensity,
                },
            );
        }

        self.composite_pipeline.composite(
            device,
            encoder,
            &input_view,
            &textures.blurred_view,
            &textures.mask_view,
            &textures.output_view,
        );
    }

    pub fn process_returning_output(&mut self) -> Option<&wgpu::Texture> {
        self.textures.as_ref().map(|t| &t.output_texture)
    }

    fn ensure_textures(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        if let Some(t) = &self.textures
            && t.width == width
            && t.height == height
        {
            return;
        }

        let create_rgba_texture = |label: &str, w: u32, h: u32, usage: wgpu::TextureUsages| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: w,
                    height: h,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage,
                view_formats: &[],
            })
        };

        let tex_usage = wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC;

        let blurred = create_rgba_texture("Blurred Camera", width, height, tex_usage);
        let blur_inter = create_rgba_texture("Blur Intermediate", width, height, tex_usage);
        let output_texture = create_rgba_texture("Blur Output", width, height, tex_usage);

        let mask_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Segmentation Mask"),
            size: wgpu::Extent3d {
                width: SEGMENTATION_SIZE,
                height: SEGMENTATION_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        self.textures = Some(ProcessorTextures {
            width,
            height,
            blurred_view: blurred.create_view(&Default::default()),
            _blurred_texture: blurred,
            blur_intermediate_view: blur_inter.create_view(&Default::default()),
            _blur_intermediate: blur_inter,
            mask_view: mask_texture.create_view(&Default::default()),
            mask_texture,
            output_view: output_texture.create_view(&Default::default()),
            output_texture,
        });
        self.output_generation = self.output_generation.wrapping_add(1);
        self.mask_dirty = true;
    }

    /// Downsamples the current camera frame and hands it to the worker.
    /// Returns whether a request was actually submitted.
    fn start_segmentation(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        input_texture: &wgpu::Texture,
    ) -> bool {
        let first_mask = !self.mask_initialized;

        let Some(rgba_256) = self.readback_downsampled(device, queue, input_texture, first_mask)
        else {
            return false;
        };

        if !self.inference.submit(rgba_256) {
            return false;
        }

        // Only the first mask is waited for. Compositing against the initial
        // all-foreground mask would otherwise show the camera unblurred until
        // the worker replies; every later inference is collected off the hot
        // path, which is the entire point of the worker.
        if first_mask
            && let Some(mask) = self.inference.wait_for_result(FIRST_INFERENCE_TIMEOUT)
            && self.apply_mask(&mask)
        {
            self.mask_dirty = true;
        }

        true
    }

    /// Applies a finished inference, if one has arrived. Returns whether the
    /// mask changed.
    fn collect_inference_result(&mut self) -> bool {
        let Some(mask) = self.inference.try_take_result() else {
            return false;
        };

        self.apply_mask(&mask)
    }

    fn apply_mask(&mut self, new_mask: &[f32]) -> bool {
        let pixel_count = (SEGMENTATION_SIZE * SEGMENTATION_SIZE) as usize;
        if new_mask.len() < pixel_count {
            return false;
        }

        for (i, &raw) in new_mask.iter().take(pixel_count).enumerate() {
            let v = refine_mask_value(raw);
            self.smoothed_mask[i] = if self.mask_initialized {
                smooth_mask_value(self.smoothed_mask[i], v)
            } else {
                v
            };
        }
        self.mask_data
            .copy_from_slice(&self.smoothed_mask[..pixel_count]);
        self.mask_initialized = true;
        true
    }

    fn readback_downsampled(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        input_texture: &wgpu::Texture,
        wait_for_result: bool,
    ) -> Option<Vec<u8>> {
        let mut completed = self.take_completed_readback(device, wgpu::PollType::Poll);

        if matches!(self.readback_state, ReadbackState::Idle) {
            let input_view = input_texture.create_view(&Default::default());

            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Downsample BG"),
                layout: &self.downsample_pipeline.bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&input_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&self.downsample_pipeline.sampler),
                    },
                ],
            });

            let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Downsample Encoder"),
            });

            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Downsample Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &self.downsample_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
                pass.set_pipeline(&self.downsample_pipeline.pipeline);
                pass.set_bind_group(0, &bind_group, &[]);
                pass.draw(0..3, 0..1);
            }

            let bytes_per_row = self.readback_bytes_per_row;
            encoder.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.downsample_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyBufferInfo {
                    buffer: &self.readback_buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(bytes_per_row),
                        rows_per_image: Some(SEGMENTATION_SIZE),
                    },
                },
                wgpu::Extent3d {
                    width: SEGMENTATION_SIZE,
                    height: SEGMENTATION_SIZE,
                    depth_or_array_layers: 1,
                },
            );

            queue.submit(std::iter::once(encoder.finish()));

            let status = Arc::new(AtomicU8::new(READBACK_PENDING));
            let status_cb = status.clone();
            self.readback_buffer
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |result| {
                    let code = if result.is_ok() {
                        READBACK_READY_OK
                    } else {
                        READBACK_READY_ERR
                    };
                    status_cb.store(code, Ordering::Release);
                });

            self.readback_state = ReadbackState::InFlight(status);

            if wait_for_result {
                completed = self
                    .take_completed_readback(device, wgpu::PollType::Wait)
                    .or(completed);
            }
        }

        completed
    }

    fn take_completed_readback(
        &mut self,
        device: &wgpu::Device,
        poll_type: wgpu::PollType,
    ) -> Option<Vec<u8>> {
        if let ReadbackState::InFlight(status) = &self.readback_state {
            let _ = device.poll(poll_type);
            match status.load(Ordering::Acquire) {
                READBACK_READY_OK => {
                    let slice = self.readback_buffer.slice(..);
                    let data = slice.get_mapped_range();
                    let expected_row = (SEGMENTATION_SIZE * 4) as usize;
                    let bytes_per_row = self.readback_bytes_per_row as usize;
                    let mut out = Vec::with_capacity(expected_row * SEGMENTATION_SIZE as usize);
                    for row in 0..SEGMENTATION_SIZE as usize {
                        let start = row * bytes_per_row;
                        out.extend_from_slice(&data[start..start + expected_row]);
                    }
                    drop(data);
                    self.readback_buffer.unmap();
                    self.readback_state = ReadbackState::Idle;
                    Some(out)
                }
                READBACK_READY_ERR => {
                    self.readback_state = ReadbackState::Idle;
                    None
                }
                _ => None,
            }
        } else {
            None
        }
    }

    fn upload_mask(&mut self, queue: &wgpu::Queue) {
        let Some(textures) = &self.textures else {
            return;
        };

        let w = SEGMENTATION_SIZE as usize;

        blur_mask_1d(&self.mask_data, &mut self.mask_scratch, w, true);
        blur_mask_1d(&self.mask_scratch, &mut self.mask_upload, w, false);
        blur_mask_1d(&self.mask_upload, &mut self.mask_scratch, w, true);
        blur_mask_1d(&self.mask_scratch, &mut self.mask_upload, w, false);

        let mask_u8: Vec<u8> = self
            .mask_upload
            .iter()
            .map(|&v| (v.clamp(0.0, 1.0) * 255.0) as u8)
            .collect();

        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &textures.mask_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &mask_u8,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(SEGMENTATION_SIZE),
                rows_per_image: Some(SEGMENTATION_SIZE),
            },
            wgpu::Extent3d {
                width: SEGMENTATION_SIZE,
                height: SEGMENTATION_SIZE,
                depth_or_array_layers: 1,
            },
        );
    }
}

fn blur_mask_1d(src: &[f32], dst: &mut [f32], width: usize, horizontal: bool) {
    let kernel = [0.06136, 0.24477, 0.38774, 0.24477, 0.06136];
    let height = src.len() / width;

    for y in 0..height {
        for x in 0..width {
            let mut sum = 0.0;
            for (ki, &weight) in kernel.iter().enumerate() {
                let offset = ki as isize - 2;
                let (sx, sy) = if horizontal {
                    (
                        (x as isize + offset).clamp(0, width as isize - 1) as usize,
                        y,
                    )
                } else {
                    (
                        x,
                        (y as isize + offset).clamp(0, height as isize - 1) as usize,
                    )
                };
                sum += src[sy * width + sx] * weight;
            }
            dst[y * width + x] = sum;
        }
    }
}

fn refine_mask_value(raw: f32) -> f32 {
    let clamped = raw.clamp(0.0, 1.0);
    let shifted = (clamped - 0.5) * MASK_EDGE_CONTRAST;
    1.0 / (1.0 + (-shifted).exp())
}

fn smooth_mask_value(previous: f32, next: f32) -> f32 {
    let delta = next - previous;
    if delta.abs() < MASK_STABILITY_EPSILON {
        previous
    } else {
        let alpha = if delta > 0.0 {
            MASK_GROWTH_ALPHA
        } else {
            MASK_SHRINK_ALPHA
        };
        (previous + delta * alpha).clamp(0.0, 1.0)
    }
}

const BLIT_SHADER: &str = r"
@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var src_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    var uvs = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0),
    );
    var out: VertexOutput;
    out.position = vec4<f32>(positions[vi], 0.0, 1.0);
    out.uv = uvs[vi];
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(src_tex, src_sampler, in.uv);
}
";

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole point of the worker is that a slow inference costs the render
    /// loop nothing and cannot pile up: `submit` must latch `in_flight` so the
    /// caller stops submitting, and taking the result must clear it so
    /// inference does not stay latched off forever (a silently frozen mask).
    #[test]
    fn in_flight_gates_one_request_and_clears_on_result() {
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let mut worker = InferenceWorker::spawn_with(move |_frame| {
            release_rx.recv().expect("test holds the sender");
            Ok(vec![0.5; 4])
        })
        .expect("spawn worker");

        assert!(!worker.is_busy());

        assert!(worker.submit(vec![0; 8]));
        assert!(worker.is_busy(), "a submitted request must latch in_flight");
        assert!(
            worker.try_take_result().is_none(),
            "nothing to collect while inference is still running"
        );

        release_tx.send(()).expect("worker is waiting");

        let mask = worker
            .wait_for_result(Duration::from_secs(5))
            .expect("worker replies once released");
        assert_eq!(mask, vec![0.5; 4]);
        assert!(
            !worker.is_busy(),
            "collecting a result must re-open the gate"
        );

        // A failing inference must also clear the gate, or blur silently stops
        // updating for the rest of the session.
        let mut failing = InferenceWorker::spawn_with(|_frame| anyhow::bail!("inference exploded"))
            .expect("spawn worker");
        assert!(failing.submit(vec![0; 8]));
        assert_eq!(
            failing.wait_for_result(Duration::from_secs(5)),
            Some(Vec::new())
        );
        assert!(!failing.is_busy());
    }
}
