use crate::frame_ws::{WSFrame, create_watch_frame_ws};
use crate::gpu_context;
use crate::windows::WindowId;
use image::{GenericImageView, ImageEncoder, codecs::png::PngEncoder};
use quiro_project::{
    ProjectConfiguration, RecordingMeta, RecordingMetaInner, SingleSegment, StudioRecordingMeta,
    TextContent, VideoMeta,
};
use quiro_rendering::{
    CompositionScope, DecodedFrame, DecodedSegmentFrames, FrameRenderer, ProjectUniforms,
    RenderVideoConstants, RendererLayers, ZoomTransformTimeline,
};
use quiro_text::{Constraint, FaceId, Fragment};
use relative_path::RelativePathBuf;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Cursor;
use std::str::FromStr;
use std::time::Instant;
use std::{collections::HashMap, ops::Deref, path::PathBuf, sync::Arc};
use tauri::{
    AppHandle, Manager, Runtime, Window,
    ipc::{CommandArg, InvokeError},
};
use tokio::sync::{RwLock, watch};
use tokio_util::sync::CancellationToken;

/// The display name `library.rs` wrote at capture time, read from the same
/// `<image>.json` sidecar the library list uses. Cap hardcodes "Screenshot"
/// here because their screenshots carry a full RecordingMeta instead.
fn pretty_name_for(image_path: &std::path::Path) -> String {
    #[derive(Deserialize)]
    struct Sidecar {
        #[serde(rename = "prettyName")]
        pretty_name: String,
    }

    std::fs::read_to_string(image_path.with_extension("json"))
        .ok()
        .and_then(|contents| serde_json::from_str::<Sidecar>(&contents).ok())
        .map(|sidecar| sidecar.pretty_name)
        .unwrap_or_else(|| {
            image_path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Screenshot".to_string())
        })
}

const MAX_DIMENSION: u32 = 16_384;

type PendingResult = Result<Arc<ScreenshotEditorInstance>, String>;
type PendingReceiver = watch::Receiver<Option<PendingResult>>;

#[derive(Clone)]
pub struct ScreenshotConfigUpdate {
    pub revision: u32,
    pub config: ProjectConfiguration,
}

pub struct ScreenshotEditorInstance {
    /// The canvas: background source, blur and noise, with nothing on it.
    pub ws_port: u16,
    /// The capture's card alone, on transparency, rendered at its laid-out
    /// size with the layer's offset and scale removed — the browser applies
    /// those as a transform, which is what makes dragging it cost nothing.
    pub card_ws_port: u16,
    pub ws_shutdown_token: CancellationToken,
    pub card_ws_shutdown_token: CancellationToken,
    pub config_tx: watch::Sender<ScreenshotConfigUpdate>,
    pub path: PathBuf,
    pub pretty_name: String,
    pub image_width: u32,
    pub image_height: u32,
    source_rgba: Arc<Vec<u8>>,
}

/// Re-sends an already-rendered layer under a new configuration revision.
///
/// The frontend treats `frame_number` as "which edit produced this", and
/// export blocks until the preview reports the newest one. A placement-only
/// change produces pixel-identical layers, so the honest answer is the frames
/// already in hand stamped with the new revision — the alternative, staying
/// silent, would hang the export waiting for a frame that is never coming.
fn reissue(frame: &Arc<WSFrame>, revision: u32) -> Arc<WSFrame> {
    Arc::new(WSFrame {
        data: frame.data.clone(),
        width: frame.width,
        height: frame.height,
        stride: frame.stride,
        frame_number: revision,
        target_time_ns: frame.target_time_ns,
        format: frame.format,
        created_at: Instant::now(),
    })
}

/// Renders one layer of the screenshot composition.
///
/// The still is re-uploaded per pass rather than kept as a GPU texture because
/// `DecodedSegmentFrames` owns its buffer; at screenshot sizes that is a memcpy
/// against two GPU passes, and it only happens when the configuration actually
/// changes — never during a gesture, which is the whole point of the split.
async fn render_layer(
    constants: &RenderVideoConstants,
    source: &DecodedFrame,
    config: &ProjectConfiguration,
    scope: CompositionScope,
    renderer: &mut FrameRenderer<'_>,
    layers: &mut RendererLayers,
) -> Result<quiro_rendering::RenderedFrame, quiro_rendering::RenderingError> {
    let segment_frames = DecodedSegmentFrames {
        screen_frame: Some(DecodedFrame::new(
            source.data().to_vec(),
            source.width(),
            source.height(),
        )),
        camera_frame: None,
        segment_time: 0.0,
        recording_time: 0.0,
        segment_has_camera: false,
    };

    let (base_w, base_h) = ProjectUniforms::get_base_size(&constants.options, config);
    let preview_scale = (1920.0 / f64::from(base_w.max(base_h).max(1))).min(1.0);
    let base_w = (f64::from(base_w) * preview_scale).round().max(1.0) as u32;
    let base_h = (f64::from(base_h) * preview_scale).round().max(1.0) as u32;

    let cursor_events = quiro_project::CursorEvents::default();
    let mut zoom_timeline = ZoomTransformTimeline::from_project(
        config,
        &cursor_events,
        0.0,
        constants.options.screen_size,
    );
    zoom_timeline.ensure_precomputed_until(1.0 / 30.0);

    let mut uniforms = ProjectUniforms::new(
        constants,
        config,
        0,
        30,
        quiro_project::XY::new(base_w, base_h),
        &cursor_events,
        &segment_frames,
        0.0,
        &zoom_timeline,
    );
    uniforms.composition_scope = scope;

    // The card pass renders into a texture grown by the shadow's reach, so the
    // whole object — card, shadow, border — is intact no matter where the
    // capture is moved. Without it the shadow is cut off at the texture edge,
    // and that cut becomes a hard line around the screenshot as soon as the
    // capture leaves its laid-out position. The background pass never needs
    // this: it has nothing that spills.
    if scope == CompositionScope::CardOnly {
        let card = quiro_project::frame_layout::content_rect(
            config,
            quiro_project::XY::new(source.width(), source.height()),
            quiro_project::XY::new(base_w, base_h),
        );
        let bleed = card
            .map(|(_, size)| {
                quiro_project::frame_layout::shadow_reach_px(config, size.x.min(size.y))
            })
            .unwrap_or(0.0);
        uniforms = uniforms.with_card_bleed(bleed.ceil().max(0.0) as u32);
    }

    renderer
        .render_immediate(
            segment_frames,
            uniforms,
            &quiro_project::CursorEvents::default(),
            true,
            layers,
        )
        .await
}

impl ScreenshotEditorInstance {
    pub async fn dispose(&self) {
        self.ws_shutdown_token.cancel();
        self.card_ws_shutdown_token.cancel();
    }
}

impl Drop for ScreenshotEditorInstance {
    fn drop(&mut self) {
        self.ws_shutdown_token.cancel();
        self.card_ws_shutdown_token.cancel();
    }
}

#[derive(Clone, Default)]
pub struct PendingScreenshotEditorInstances(Arc<RwLock<HashMap<String, PendingReceiver>>>);

#[derive(Clone)]
pub struct ScreenshotEditorInstances(Arc<RwLock<HashMap<String, Arc<ScreenshotEditorInstance>>>>);

pub struct WindowScreenshotEditorInstance(pub Arc<ScreenshotEditorInstance>);

impl specta::function::FunctionArg for WindowScreenshotEditorInstance {
    fn to_datatype(_: &mut specta::TypeMap) -> Option<specta::DataType> {
        None
    }
}

impl Deref for WindowScreenshotEditorInstance {
    type Target = Arc<ScreenshotEditorInstance>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<'de, R: Runtime> CommandArg<'de, R> for WindowScreenshotEditorInstance {
    fn from_command(command: tauri::ipc::CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let window = Window::from_command(command)?;

        let instances = window.state::<ScreenshotEditorInstances>();
        let instance = futures::executor::block_on(instances.0.read());

        if let Some(instance) = instance.get(window.label()).cloned() {
            Ok(Self(instance))
        } else {
            Err(InvokeError::from(format!(
                "no ScreenshotEditor instance for window '{}'",
                window.label(),
            )))
        }
    }
}

impl ScreenshotEditorInstances {
    async fn create_standalone_instance(
        path: PathBuf,
    ) -> Result<Arc<ScreenshotEditorInstance>, String> {
        let create_started = Instant::now();
        let (frame_tx, frame_rx) = watch::channel(None);
        let (ws_port, ws_shutdown_token) =
            create_watch_frame_ws(frame_rx, Default::default()).await;
        if ws_port == 0 {
            return Err("Failed to start screenshot editor frame websocket".to_string());
        }

        // A second socket rather than a layer tag on the wire: `pack_ws_frame`
        // is shared with the video path, and one channel per layer costs a port
        // instead of a format change every other client would have to learn.
        let (card_frame_tx, card_frame_rx) = watch::channel(None);
        let (card_ws_port, card_ws_shutdown_token) =
            create_watch_frame_ws(card_frame_rx, Default::default()).await;
        if card_ws_port == 0 {
            ws_shutdown_token.cancel();
            return Err("Failed to start screenshot editor card websocket".to_string());
        }

        let (data, width, height) = {
            let image_path = if path.is_dir() {
                let original = path.join("original.png");
                if original.exists() {
                    original
                } else {
                    std::fs::read_dir(&path)
                        .ok()
                        .and_then(|dir| {
                            dir.flatten()
                                .find(|e| {
                                    e.path().extension().and_then(|s| s.to_str()) == Some("png")
                                })
                                .map(|e| e.path())
                        })
                        .ok_or_else(|| format!("No PNG file found in directory: {path:?}"))?
                }
            } else {
                path.clone()
            };

            let img = image::open(&image_path).map_err(|e| format!("Failed to open image: {e}"))?;
            let (w, h) = img.dimensions();

            if w > MAX_DIMENSION || h > MAX_DIMENSION {
                return Err(format!("Image dimensions exceed maximum: {w}x{h}"));
            }

            w.checked_mul(h)
                .and_then(|p| p.checked_mul(4))
                .ok_or_else(|| format!("Image dimensions overflow: {w}x{h}"))?;

            (img.to_rgba8().into_raw(), w, h)
        };

        tracing::info!(
            elapsed_ms = create_started.elapsed().as_millis() as u64,
            width,
            height,
            "screenshot_editor timing: source image ready"
        );

        let cap_dir = if path.extension().and_then(|s| s.to_str()) == Some("cap") {
            Some(path.clone())
        } else if let Some(parent) = path.parent() {
            if parent.extension().and_then(|s| s.to_str()) == Some("cap") {
                Some(parent.to_path_buf())
            } else {
                None
            }
        } else {
            None
        };

        let (recording_meta, mut loaded_config) = if let Some(cap_dir) = &cap_dir {
            let meta = RecordingMeta::load_for_project(cap_dir).ok();
            let config = ProjectConfiguration::load(cap_dir).ok();
            (meta, config)
        } else {
            // Quiro's screenshots are flat files, so the config lives in a
            // sidecar rather than a project directory — see save_config_sidecar.
            (None, load_config_sidecar(&path))
        };

        // Legacy annotations are in rendered-frame pixels, which stop meaning
        // the same thing the moment padding, crop or aspect ratio changes.
        // Convert them to normalized geometry now, while the capture size is
        // in hand — `ProjectConfiguration::load` cannot, because it never
        // learns the dimensions. The migration defers rather than guessing if
        // the frame is unresolvable, so a failure here is safe to ignore and
        // retry on the next open.
        if let Some(config) = loaded_config.as_mut()
            && config.migrate_annotation_space(quiro_project::XY::new(width, height))
        {
            let written = match &cap_dir {
                Some(cap_dir) => config.write(cap_dir).map_err(|e| e.to_string()),
                None => save_config_sidecar(&path, config),
            };
            match written {
                Ok(()) => tracing::info!(
                    annotations = config.annotations.len(),
                    "screenshot_editor: migrated annotations to normalized space"
                ),
                // The in-memory config is already migrated, so the editor is
                // correct for this session either way; only persistence failed.
                Err(error) => tracing::warn!(
                    %error,
                    "screenshot_editor: annotation migration could not be saved"
                ),
            }
        }

        let recording_meta = if let Some(meta) = recording_meta {
            meta
        } else {
            let filename = path
                .file_name()
                .ok_or_else(|| "Invalid path".to_string())?
                .to_string_lossy();
            let relative_path = RelativePathBuf::from(filename.as_ref());
            let video_meta = VideoMeta {
                path: relative_path.clone(),
                fps: 30,
                start_time: Some(0.0),
                device_id: None,
            };
            let segment = SingleSegment {
                display: video_meta.clone(),
                camera: None,
                audio: None,
                cursor: None,
            };
            let studio_meta = StudioRecordingMeta::SingleSegment { segment };
            RecordingMeta {
                platform: None,
                project_path: path.parent().unwrap().to_path_buf(),
                pretty_name: pretty_name_for(&path),
                sharing: None,
                inner: RecordingMetaInner::Studio(Box::new(studio_meta.clone())),
                upload: None,
            }
        };

        let (shared, background_cache) = if let Some(gpu) = gpu_context::get_shared_gpu().await {
            (
                quiro_rendering::SharedWgpuDevice {
                    instance: (*gpu.instance).clone(),
                    adapter: (*gpu.adapter).clone(),
                    device: (*gpu.device).clone(),
                    queue: (*gpu.queue).clone(),
                    is_software_adapter: gpu.is_software_adapter,
                },
                gpu.background_cache.clone(),
            )
        } else {
            let instance = quiro_rendering::create_wgpu_instance().await;
            let force_software_adapter = quiro_rendering::force_software_wgpu_adapter();
            let hardware_adapter = if force_software_adapter {
                None
            } else {
                instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::HighPerformance,
                        force_fallback_adapter: false,
                        compatible_surface: None,
                    })
                    .await
                    .ok()
            };
            let adapter = match hardware_adapter {
                Some(adapter) => adapter,
                None => instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::LowPower,
                        force_fallback_adapter: true,
                        compatible_surface: None,
                    })
                    .await
                    .map_err(|_| "No GPU adapter found".to_string())?,
            };
            let adapter_info = adapter.get_info();
            let is_software_adapter = quiro_rendering::is_software_wgpu_adapter(&adapter_info);

            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor {
                    label: Some("cap-rendering-device"),
                    required_features: wgpu::Features::empty(),
                    ..Default::default()
                })
                .await
                .map_err(|e| e.to_string())?;
            (
                quiro_rendering::SharedWgpuDevice {
                    instance,
                    adapter,
                    device,
                    queue,
                    is_software_adapter,
                },
                Arc::new(quiro_rendering::BackgroundTextureCache::default()),
            )
        };

        let options = quiro_rendering::RenderOptions {
            screen_size: quiro_project::XY::new(width, height),
            camera_size: None,
            preserve_screen_alpha: true,
        };

        let studio_meta = match &recording_meta.inner {
            RecordingMetaInner::Studio(meta) => meta.clone(),
            _ => return Err("Invalid recording meta for screenshot".to_string()),
        };

        let constants = RenderVideoConstants::from_shared_device(
            shared,
            options,
            *studio_meta,
            recording_meta.clone(),
            background_cache,
        );

        tracing::info!(
            elapsed_ms = create_started.elapsed().as_millis() as u64,
            "screenshot_editor timing: gpu + render constants ready"
        );

        let (config_tx, mut config_rx) = watch::channel(ScreenshotConfigUpdate {
            revision: 0,
            config: loaded_config.unwrap_or_default(),
        });

        let render_shutdown_token = ws_shutdown_token.clone();

        let source_rgba = Arc::new(data);

        let instance = Arc::new(ScreenshotEditorInstance {
            ws_port,
            card_ws_port,
            card_ws_shutdown_token,
            ws_shutdown_token,
            config_tx,
            path: path.clone(),
            pretty_name: recording_meta.pretty_name.clone(),
            image_width: width,
            image_height: height,
            source_rgba: source_rgba.clone(),
        });

        let decoded_frame = DecodedFrame::new(source_rgba.as_ref().clone(), width, height);

        tokio::spawn(async move {
            let layers_started = Instant::now();
            let mut frame_renderer = FrameRenderer::new(&constants);
            let mut layers = RendererLayers::new_with_options(
                &constants.device,
                &constants.queue,
                constants.is_software_adapter,
            );
            tracing::info!(
                layers_init_ms = layers_started.elapsed().as_millis() as u64,
                total_ms = create_started.elapsed().as_millis() as u64,
                "screenshot_editor timing: renderer layers initialized"
            );
            let shutdown_token = render_shutdown_token;
            let mut current_update = config_rx.borrow().clone();
            let mut current_config = current_update.config.clone();
            let mut current_revision = current_update.revision;
            let mut first_frame_logged = false;
            let mut last_frames: Option<(Arc<WSFrame>, Arc<WSFrame>)> = None;
            let mut last_fingerprint: Option<String> = None;
            let mut last_background_fingerprint: Option<String> = None;

            loop {
                if shutdown_token.is_cancelled() {
                    break;
                }

                // Dragging the capture around the canvas changes no pixel in
                // either layer: the card is rendered where layout alone puts it
                // and the browser applies the placement. So a change that
                // survives `card_pass_config` unchanged is a change neither
                // pass would draw differently, and re-rendering it would burn
                // two GPU passes and two full frames over a socket per pointer
                // move — the exact cost the split exists to avoid.
                //
                // Compared as serialized JSON because `ProjectConfiguration`
                // has no `PartialEq`, and deriving one across every nested
                // config type is a far larger change than one small
                // serialization per edit.
                // ponytail: JSON compare, derive PartialEq if this ever shows up in a profile
                let card_config = quiro_project::frame_layout::card_pass_config(&current_config);
                let fingerprint = serde_json::to_string(&card_config).ok();
                let mut background_config = card_config.clone();
                background_config.annotations.clear();
                let background_fingerprint = serde_json::to_string(&background_config).ok();
                let reuse_background = background_fingerprint.is_some()
                    && background_fingerprint == last_background_fingerprint
                    && last_frames.is_some();
                let reuse = fingerprint.is_some()
                    && fingerprint == last_fingerprint
                    && last_frames.is_some();

                if reuse {
                    let (background, card) = last_frames.as_ref().expect("checked above");
                    let _ = frame_tx.send(Some(reissue(background, current_revision)));
                    let _ = card_frame_tx.send(Some(reissue(card, current_revision)));

                    tokio::select! {
                        res = config_rx.changed() => {
                            if res.is_err() {
                                break;
                            }
                            current_update = config_rx.borrow().clone();
                            current_revision = current_update.revision;
                            current_config = current_update.config.clone();
                        }
                        _ = shutdown_token.cancelled() => {
                            break;
                        }
                    }
                    continue;
                }

                let render_started = Instant::now();

                // The preview is composited by the browser, not here. The
                // canvas and the capture are rendered separately so that
                // moving, scaling or spinning the capture costs a CSS
                // transform over two cached images rather than a GPU render
                // and a full frame over a socket per pointer move. Export is
                // untouched: it still renders the whole composition in one
                // pass, and is still the only thing that reaches a file.
                //
                // Both passes derive their output size from a config with the
                // same `base_size`, so the two images line up pixel for pixel
                // and the browser can stack them without measuring either.
                let background = if reuse_background {
                    None
                } else {
                    Some(
                        render_layer(
                            &constants,
                            &decoded_frame,
                            &current_config,
                            CompositionScope::BackgroundOnly,
                            &mut frame_renderer,
                            &mut layers,
                        )
                        .await,
                    )
                };

                // The card is rendered where layout alone would put it: its
                // offset and scale are stripped for the browser to apply, and
                // its rotation too whenever the card is flat enough for a CSS
                // rotation to land on the same pixels the renderer would have
                // drawn. `card_pass_config` owns that rule.
                let card = render_layer(
                    &constants,
                    &decoded_frame,
                    &card_config,
                    CompositionScope::CardOnly,
                    &mut frame_renderer,
                    &mut layers,
                )
                .await;

                let mut sent: Vec<Arc<WSFrame>> = Vec::with_capacity(2);
                for (rendered, tx, what) in [
                    (background, &frame_tx, "background"),
                    (Some(card), &card_frame_tx, "card"),
                ] {
                    match rendered {
                        Some(Ok(frame)) => {
                            if !first_frame_logged {
                                tracing::info!(
                                    render_ms = render_started.elapsed().as_millis() as u64,
                                    total_ms = create_started.elapsed().as_millis() as u64,
                                    layer = what,
                                    frame_width = frame.width,
                                    frame_height = frame.height,
                                    frame_bytes = frame.data.len(),
                                    "screenshot_editor timing: first frame rendered + sent"
                                );
                            }
                            let ws_frame = Arc::new(WSFrame {
                                data: frame.data,
                                width: frame.width,
                                height: frame.height,
                                stride: frame.padded_bytes_per_row,
                                frame_number: current_revision,
                                target_time_ns: frame.target_time_ns,
                                format: crate::frame_ws::WSFrameFormat::Rgba,
                                created_at: Instant::now(),
                            });
                            sent.push(ws_frame.clone());
                            let _ = tx.send(Some(ws_frame));
                        }
                        Some(Err(e)) => {
                            tracing::error!("Failed to render screenshot {what} layer: {e}");
                        }
                        None => {
                            let (background, _) = last_frames.as_ref().expect("cached background");
                            let frame = reissue(background, current_revision);
                            sent.push(frame.clone());
                            let _ = tx.send(Some(frame));
                        }
                    }
                }
                first_frame_logged = true;

                // Only cache a complete pair: half a composition would be
                // reissued against a stale partner on the next drag.
                if let [background, card] = sent.as_slice() {
                    last_frames = Some((background.clone(), card.clone()));
                    last_fingerprint = fingerprint;
                    last_background_fingerprint = background_fingerprint;
                } else {
                    last_frames = None;
                    last_fingerprint = None;
                    last_background_fingerprint = None;
                }

                tokio::select! {
                    res = config_rx.changed() => {
                        if res.is_err() {
                            break;
                        }
                        current_update = config_rx.borrow().clone();
                        current_revision = current_update.revision;
                        current_config = current_update.config.clone();
                    }
                    _ = shutdown_token.cancelled() => {
                        break;
                    }
                }
            }
            let _ = frame_tx.send(None);
            let _ = card_frame_tx.send(None);
        });

        Ok(instance)
    }

    pub async fn get_or_create(
        window: &Window,
        path: PathBuf,
    ) -> Result<Arc<ScreenshotEditorInstance>, String> {
        let instances = match window.try_state::<ScreenshotEditorInstances>() {
            Some(s) => (*s).clone(),
            None => {
                let instances = Self(Arc::new(RwLock::new(HashMap::new())));
                window.manage(instances.clone());
                instances
            }
        };

        let mut instances = instances.0.write().await;

        use std::collections::hash_map::Entry;

        match instances.entry(window.label().to_string()) {
            Entry::Vacant(entry) => {
                let pending = PendingScreenshotEditorInstances::get(window.app_handle());

                if let Some(mut prewarmed_rx) = pending.take_prewarmed(window.label()).await {
                    loop {
                        if let Some(result) = prewarmed_rx.borrow_and_update().clone() {
                            let instance = result?;
                            entry.insert(instance.clone());
                            return Ok(instance);
                        }
                        if prewarmed_rx.changed().await.is_err() {
                            break;
                        }
                    }
                }

                let instance = Self::create_standalone_instance(path).await?;
                entry.insert(instance.clone());
                Ok(instance)
            }
            Entry::Occupied(entry) => {
                let instance = entry.get().clone();
                let config = instance.config_tx.borrow().clone();
                let _ = instance.config_tx.send(config);
                Ok(instance)
            }
        }
    }

    pub async fn remove(window: Window) {
        let instances = match window.try_state::<ScreenshotEditorInstances>() {
            Some(s) => (*s).clone(),
            None => return,
        };

        let mut instances = instances.0.write().await;
        if let Some(instance) = instances.remove(window.label()) {
            instance.dispose().await;
        }
    }

    pub async fn dispose_all(app: &AppHandle) {
        let Some(instances) = app.try_state::<ScreenshotEditorInstances>() else {
            return;
        };

        let instances = {
            let mut instances = instances.0.write().await;
            std::mem::take(&mut *instances)
        };

        let count = instances.len();
        for (_, instance) in instances {
            instance.dispose().await;
        }

        if count > 0 {
            tracing::info!(
                count,
                "Disposed screenshot editor instances during app exit"
            );
        }
    }
}

impl PendingScreenshotEditorInstances {
    pub fn get(app: &AppHandle) -> Self {
        match app.try_state::<Self>() {
            Some(s) => (*s).clone(),
            None => {
                let pending = Self::default();
                app.manage(pending.clone());
                pending
            }
        }
    }

    pub async fn start_prewarm(app: &AppHandle, window_label: String, path: PathBuf) {
        let pending = Self::get(app);

        {
            let instances = pending.0.read().await;
            if instances.contains_key(&window_label) {
                return;
            }
        }

        let (tx, rx) = watch::channel(None);

        {
            let mut instances = pending.0.write().await;
            instances.insert(window_label.clone(), rx);
        }

        tokio::spawn(async move {
            let result = ScreenshotEditorInstances::create_standalone_instance(path).await;
            tx.send(Some(result)).ok();
        });
    }

    pub async fn take_prewarmed(&self, window_label: &str) -> Option<PendingReceiver> {
        let mut instances = self.0.write().await;
        instances.remove(window_label)
    }

    pub async fn cancel_prewarm(&self, window_label: &str) {
        let mut instances = self.0.write().await;
        if let Some(mut rx) = instances.remove(window_label) {
            tokio::spawn(async move {
                let timeout = tokio::time::timeout(std::time::Duration::from_secs(10), async {
                    loop {
                        let instance_to_dispose = {
                            let borrowed = rx.borrow_and_update().clone();
                            match borrowed {
                                Some(Ok(instance)) => Some(instance),
                                Some(Err(_)) => break,
                                None => None,
                            }
                        };

                        if let Some(instance) = instance_to_dispose {
                            instance.dispose().await;
                            break;
                        }

                        if rx.changed().await.is_err() {
                            break;
                        }
                    }
                });
                if timeout.await.is_err() {
                    tracing::warn!(
                        "Timed out waiting for prewarmed screenshot editor instance to complete for cleanup"
                    );
                }
            });
        }
    }

    pub async fn dispose_all(app: &AppHandle) {
        let Some(pending) = app.try_state::<Self>() else {
            return;
        };

        let pending = {
            let mut instances = pending.0.write().await;
            std::mem::take(&mut *instances)
        };

        let count = pending.len();
        for (_, mut rx) in pending {
            let result = tokio::time::timeout(std::time::Duration::from_millis(500), async {
                loop {
                    let instance_to_dispose = {
                        let borrowed = rx.borrow_and_update().clone();
                        match borrowed {
                            Some(Ok(instance)) => Some(instance),
                            Some(Err(_)) => break,
                            None => None,
                        }
                    };

                    if let Some(instance) = instance_to_dispose {
                        instance.dispose().await;
                        break;
                    }

                    if rx.changed().await.is_err() {
                        break;
                    }
                }
            })
            .await;

            if result.is_err() {
                tracing::warn!(
                    "Timed out disposing pending screenshot editor instance during app exit"
                );
            }
        }

        if count > 0 {
            tracing::info!(
                count,
                "Disposed pending screenshot editor instances during app exit"
            );
        }
    }
}

#[derive(Serialize, Type, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SerializedScreenshotEditorInstance {
    pub frames_socket_url: String,
    /// The capture's own layer. The preview stacks it over `frames_socket_url`
    /// and places it with a CSS transform, so a drag never reaches the renderer.
    pub card_socket_url: String,
    pub path: PathBuf,
    pub config: Option<ProjectConfiguration>,
    pub pretty_name: String,
    pub image_width: u32,
    pub image_height: u32,
}

#[derive(Serialize, Type, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotProjectExport {
    pub image_bytes: Vec<u8>,
    pub config: ProjectConfiguration,
    pub image_width: u32,
    pub image_height: u32,
}

#[derive(Clone, Copy, Deserialize, Serialize, Type, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotOcrRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Serialize, Type, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotOcrLine {
    pub text: String,
    pub confidence: Option<f32>,
    pub bounds: ScreenshotOcrRegion,
}

#[derive(Clone, Serialize, Type, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotOcrResult {
    pub text: String,
    pub lines: Vec<ScreenshotOcrLine>,
    pub engine: String,
}

struct ScreenshotOcrImage {
    bgra: Vec<u8>,
    width: u32,
    height: u32,
}

/// `quiro_text::TextLayout` minus its `buffers` — those are cosmic-text's own
/// shaped glyph runs and never leave the process (`plans/text-engine/003`);
/// `fragments` is everything a frontend painter needs to draw the same
/// glyphs itself, in SVG on screen and Canvas2D at export.
#[derive(Serialize, Type, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TextLayoutResult {
    pub fragments: Vec<Fragment>,
    pub width: f32,
    pub height: f32,
    /// Every distinct face `fragments` references, in first-seen order — so
    /// a caller can register each one exactly once (via `font_face_bytes`)
    /// without first walking `fragments` itself to dedupe them.
    pub faces: Vec<FaceId>,
}

/// Rust is the only thing that ever measures a `TextContent` — an annotation
/// editor calls this on commit (not per keystroke; that policy is
/// `plans/text-engine/004`'s) and paints the returned `fragments` verbatim,
/// never re-measuring the text itself. `constraint.anchor_height` is the
/// capture's own content-rect height for an annotation, matching the
/// px@1080 convention `RunStyle::font_size` already uses.
#[tauri::command]
#[specta::specta]
pub async fn measure_text(
    content: TextContent,
    constraint: Constraint,
) -> Result<TextLayoutResult, String> {
    let layout = quiro_text::layout_text(&content, constraint);

    let mut faces = Vec::new();
    for fragment in &layout.fragments {
        if !faces.contains(&fragment.font_face) {
            faces.push(fragment.font_face);
        }
    }

    Ok(TextLayoutResult {
        fragments: layout.fragments,
        width: layout.width,
        height: layout.height,
        faces,
    })
}

/// The exact bytes of the face named by `id` (one of `measure_text`'s
/// returned `faces`), for the webview to register as a `FontFace` and paint
/// with directly — rather than resolving `font_family` itself, which is only
/// pinned correctly for the three CSS generics (`layers/mod.rs`'s
/// `new_font_system`), not for an arbitrary installed family name.
#[tauri::command]
#[specta::specta]
pub async fn font_face_bytes(id: FaceId) -> Result<Vec<u8>, String> {
    quiro_text::face_bytes(id).ok_or_else(|| "Unknown font face".to_string())
}

#[cfg(test)]
mod text_ipc_tests {
    use super::*;

    fn probe_content(text: &str) -> TextContent {
        quiro_project::TextContent {
            root: quiro_project::TextRoot {
                children: vec![quiro_project::ParagraphSet {
                    children: vec![quiro_project::Paragraph {
                        align: quiro_project::TextAlign::Left,
                        line_height: 1.2,
                        children: vec![quiro_project::TextRun {
                            text: text.to_string(),
                            style: quiro_project::RunStyle::default(),
                        }],
                    }],
                }],
            },
            grow_type: quiro_project::GrowType::AutoWidth,
            vertical_align: quiro_project::VerticalAlign::Top,
            halo: None,
        }
    }

    fn probe_constraint() -> Constraint {
        Constraint {
            anchor_height: 1080.0,
            width: 1000.0,
            height: 1000.0,
        }
    }

    #[tokio::test]
    async fn measure_text_returns_one_fragment_and_lists_its_face() {
        let result = measure_text(probe_content("Hello"), probe_constraint())
            .await
            .expect("measure_text failed");

        assert_eq!(result.fragments.len(), 1);
        assert_eq!(result.faces, vec![result.fragments[0].font_face]);
    }

    #[tokio::test]
    async fn font_face_bytes_resolves_a_face_measure_text_returned() {
        let result = measure_text(probe_content("Hello"), probe_constraint())
            .await
            .unwrap();

        let bytes = font_face_bytes(result.faces[0])
            .await
            .expect("font_face_bytes failed");
        assert!(!bytes.is_empty());
    }

    /// `FaceId`'s wire representation is a bare integer (see
    /// `quiro_text::FaceId`'s doc comment), constructed here the way a
    /// tampered or stale IPC payload would — never through the crate's own
    /// (unreachable from here) `pub(crate)` constructor.
    #[tokio::test]
    async fn font_face_bytes_rejects_an_id_this_process_never_minted() {
        let bogus: FaceId = serde_json::from_str("18446744073709551615").unwrap();
        assert!(font_face_bytes(bogus).await.is_err());
    }
}

/// Which screenshot each editor window is showing. Cap keys the same registry
/// by a numeric id baked into the window label; Quiro's labels are already a
/// hash of the path (see `screenshot_editor_label_for_path`), so the label
/// itself is the key and no counter is needed.
#[derive(Default, Clone)]
pub struct ScreenshotEditorPaths(pub Arc<std::sync::Mutex<HashMap<String, PathBuf>>>);

impl ScreenshotEditorPaths {
    pub fn set(app: &AppHandle, label: String, path: PathBuf) {
        if let Some(state) = app.try_state::<Self>()
            && let Ok(mut paths) = state.0.lock()
        {
            paths.insert(label, path);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn create_screenshot_editor_instance(
    window: Window,
) -> Result<SerializedScreenshotEditorInstance, String> {
    if !matches!(
        WindowId::from_str(window.label()),
        Ok(WindowId::ScreenshotEditor)
    ) {
        return Err("Invalid window".to_string());
    }

    let path = {
        let paths = window.state::<ScreenshotEditorPaths>();
        let paths = paths.0.lock().map_err(|e| e.to_string())?;
        paths
            .get(window.label())
            .cloned()
            .ok_or_else(|| "Screenshot editor instance not found".to_string())?
    };

    let instance = ScreenshotEditorInstances::get_or_create(&window, path).await?;
    let config = instance.config_tx.borrow().config.clone();

    Ok(SerializedScreenshotEditorInstance {
        frames_socket_url: format!("ws://localhost:{}", instance.ws_port),
        card_socket_url: format!("ws://localhost:{}", instance.card_ws_port),
        path: instance.path.clone(),
        config: Some(config),
        pretty_name: instance.pretty_name.clone(),
        image_width: instance.image_width,
        image_height: instance.image_height,
    })
}

/// Renders one tiny throwaway frame on the shared GPU at startup so the Metal
/// render pipelines are compiled before the user opens the editor. On Apple GPUs
/// pipeline *creation* is cheap but the driver defers shader compilation to the
/// first draw, which was costing ~3.5s on the first real frame. Doing it here moves
/// that cost into background startup time; the compiled pipelines are cached on the
/// shared device, so the first editor open renders immediately.
pub async fn prewarm_screenshot_renderer() {
    use std::sync::atomic::{AtomicBool, Ordering};

    static PREWARMED: AtomicBool = AtomicBool::new(false);
    if PREWARMED.swap(true, Ordering::SeqCst) {
        return;
    }

    let Some(gpu) = gpu_context::get_shared_gpu().await else {
        return;
    };

    let _ = tokio::task::spawn_blocking(quiro_rendering::prewarm_fonts).await;

    let started = Instant::now();

    let shared = quiro_rendering::SharedWgpuDevice {
        instance: (*gpu.instance).clone(),
        adapter: (*gpu.adapter).clone(),
        device: (*gpu.device).clone(),
        queue: (*gpu.queue).clone(),
        is_software_adapter: gpu.is_software_adapter,
    };

    let width = 64u32;
    let height = 64u32;

    let video_meta = VideoMeta {
        path: RelativePathBuf::from("prewarm.png"),
        fps: 30,
        start_time: Some(0.0),
        device_id: None,
    };
    let studio_meta = StudioRecordingMeta::SingleSegment {
        segment: SingleSegment {
            display: video_meta,
            camera: None,
            audio: None,
            cursor: None,
        },
    };
    let recording_meta = RecordingMeta {
        platform: None,
        project_path: std::env::temp_dir(),
        pretty_name: "Prewarm".to_string(),
        sharing: None,
        inner: RecordingMetaInner::Studio(Box::new(studio_meta.clone())),
        upload: None,
    };

    let options = quiro_rendering::RenderOptions {
        screen_size: quiro_project::XY::new(width, height),
        camera_size: None,
        preserve_screen_alpha: true,
    };

    let constants = RenderVideoConstants::from_shared_device(
        shared,
        options,
        studio_meta,
        recording_meta,
        Arc::new(quiro_rendering::BackgroundTextureCache::default()),
    );

    let config = ProjectConfiguration::default();
    let mut frame_renderer = FrameRenderer::new(&constants);
    let mut layers = RendererLayers::new_with_options(
        &constants.device,
        &constants.queue,
        constants.is_software_adapter,
    );

    let segment_frames = DecodedSegmentFrames {
        screen_frame: Some(DecodedFrame::new(
            vec![255u8; (width * height * 4) as usize],
            width,
            height,
        )),
        camera_frame: None,
        segment_time: 0.0,
        recording_time: 0.0,
        segment_has_camera: false,
    };

    let (base_w, base_h) = ProjectUniforms::get_base_size(&constants.options, &config);
    let cursor_events = quiro_project::CursorEvents::default();
    let mut zoom_timeline = ZoomTransformTimeline::new(
        &[],
        None,
        &cursor_events,
        config.screen_movement_spring,
        0.0,
        None,
    );
    zoom_timeline.ensure_precomputed_until(1.0 / 30.0);
    let uniforms = ProjectUniforms::new(
        &constants,
        &config,
        0,
        30,
        quiro_project::XY::new(base_w, base_h),
        &cursor_events,
        &segment_frames,
        0.0,
        &zoom_timeline,
    );

    match frame_renderer
        .render_immediate(
            segment_frames,
            uniforms,
            &quiro_project::CursorEvents::default(),
            true,
            &mut layers,
        )
        .await
    {
        Ok(_) => {
            tracing::info!(
                elapsed_ms = started.elapsed().as_millis() as u64,
                "screenshot_editor timing: render pipeline prewarm complete"
            );
        }
        Err(e) => {
            tracing::warn!("screenshot_editor render pipeline prewarm failed: {e}");
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn prewarm_screenshot_background(path: String) -> Result<(), String> {
    let Some(gpu) = gpu_context::get_shared_gpu().await else {
        return Ok(());
    };

    let Some(clean_path) = quiro_rendering::clean_background_path(&path) else {
        return Ok(());
    };

    let _ = gpu
        .background_cache
        .ensure(&gpu.device, &gpu.queue, &clean_path)
        .await;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn update_screenshot_config(
    instance: WindowScreenshotEditorInstance,
    config: ProjectConfiguration,
    save: bool,
    revision: u32,
) -> Result<(), String> {
    config.validate().map_err(|error| error.to_string())?;

    let _ = instance.config_tx.send(ScreenshotConfigUpdate {
        revision,
        config: config.clone(),
    });

    if !save {
        return Ok(());
    }

    let Some(parent) = instance.path.parent() else {
        return Ok(());
    };

    if parent.extension().and_then(|s| s.to_str()) == Some("cap") {
        let path = parent.to_path_buf();
        if let Err(e) = config.write(&path) {
            tracing::error!("Failed to save screenshot config: {e}");
        }
    } else {
        // Quiro's screenshots are a flat PNG plus sidecars (see library.rs),
        // not `.cap` project directories, so Cap's directory-based write has
        // nothing to write into. Persist next to the image instead, matching
        // the existing `<image>.json` metadata sidecar convention.
        if let Err(e) = save_config_sidecar(&instance.path, &config) {
            tracing::error!("Failed to save screenshot config sidecar: {e}");
        }
    }
    Ok(())
}

/// `<image>.project.json`, alongside the `.json` metadata sidecar.
pub(crate) fn config_sidecar_path(image_path: &std::path::Path) -> PathBuf {
    image_path.with_extension("project.json")
}

fn save_config_sidecar(
    image_path: &std::path::Path,
    config: &ProjectConfiguration,
) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(config_sidecar_path(image_path), contents).map_err(|e| e.to_string())
}

pub(crate) fn load_config_sidecar(image_path: &std::path::Path) -> Option<ProjectConfiguration> {
    let contents = std::fs::read_to_string(config_sidecar_path(image_path)).ok()?;
    serde_json::from_str(&contents).ok()
}

#[tauri::command]
#[specta::specta]
pub async fn recognize_screenshot_text(
    instance: WindowScreenshotEditorInstance,
    region: ScreenshotOcrRegion,
) -> Result<ScreenshotOcrResult, String> {
    let region = clamp_screenshot_ocr_region(region, instance.image_width, instance.image_height)?;
    let image = create_screenshot_ocr_image(
        instance.source_rgba.as_ref(),
        instance.image_width,
        instance.image_height,
        region,
    )?;
    let mut result = recognize_screenshot_ocr_image(image).await?;

    for line in &mut result.lines {
        line.bounds.x = line.bounds.x.saturating_add(region.x);
        line.bounds.y = line.bounds.y.saturating_add(region.y);
    }

    Ok(result)
}

fn clamp_screenshot_ocr_region(
    region: ScreenshotOcrRegion,
    image_width: u32,
    image_height: u32,
) -> Result<ScreenshotOcrRegion, String> {
    if image_width == 0 || image_height == 0 {
        return Err("Screenshot image is empty".to_string());
    }

    let x = region.x.min(image_width.saturating_sub(1));
    let y = region.y.min(image_height.saturating_sub(1));
    let width = region.width.min(image_width.saturating_sub(x));
    let height = region.height.min(image_height.saturating_sub(y));

    if width < 4 || height < 4 {
        return Err("Select a larger text area".to_string());
    }

    Ok(ScreenshotOcrRegion {
        x,
        y,
        width,
        height,
    })
}

fn create_screenshot_ocr_image(
    source_rgba: &[u8],
    image_width: u32,
    image_height: u32,
    region: ScreenshotOcrRegion,
) -> Result<ScreenshotOcrImage, String> {
    let image_width = usize::try_from(image_width)
        .map_err(|_| "Screenshot width is too large for OCR".to_string())?;
    let image_height = usize::try_from(image_height)
        .map_err(|_| "Screenshot height is too large for OCR".to_string())?;
    let region_x =
        usize::try_from(region.x).map_err(|_| "OCR region x is too large".to_string())?;
    let region_y =
        usize::try_from(region.y).map_err(|_| "OCR region y is too large".to_string())?;
    let region_width =
        usize::try_from(region.width).map_err(|_| "OCR region width is too large".to_string())?;
    let region_height =
        usize::try_from(region.height).map_err(|_| "OCR region height is too large".to_string())?;

    let expected_len = image_width
        .checked_mul(image_height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Screenshot image is too large for OCR".to_string())?;

    if source_rgba.len() != expected_len {
        return Err("Screenshot image data is invalid for OCR".to_string());
    }

    let output_len = region_width
        .checked_mul(region_height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "OCR region is too large".to_string())?;
    let mut bgra = vec![0; output_len];
    let source_row_bytes = image_width
        .checked_mul(4)
        .ok_or_else(|| "Screenshot row is too large for OCR".to_string())?;
    let region_row_bytes = region_width
        .checked_mul(4)
        .ok_or_else(|| "OCR row is too large".to_string())?;
    let region_x_bytes = region_x
        .checked_mul(4)
        .ok_or_else(|| "OCR region x is too large".to_string())?;

    for row in 0..region_height {
        let source_start = region_y
            .checked_add(row)
            .and_then(|source_row| source_row.checked_mul(source_row_bytes))
            .and_then(|source_offset| source_offset.checked_add(region_x_bytes))
            .ok_or_else(|| "OCR source region is invalid".to_string())?;
        let source_end = source_start
            .checked_add(region_row_bytes)
            .ok_or_else(|| "OCR source region is invalid".to_string())?;
        let output_start = row
            .checked_mul(region_row_bytes)
            .ok_or_else(|| "OCR output region is invalid".to_string())?;
        let output_end = output_start
            .checked_add(region_row_bytes)
            .ok_or_else(|| "OCR output region is invalid".to_string())?;
        let source_row = source_rgba
            .get(source_start..source_end)
            .ok_or_else(|| "OCR source region is outside the screenshot".to_string())?;
        let output_row = bgra
            .get_mut(output_start..output_end)
            .ok_or_else(|| "OCR output region is invalid".to_string())?;

        for (source_pixel, output_pixel) in source_row
            .chunks_exact(4)
            .zip(output_row.chunks_exact_mut(4))
        {
            output_pixel[0] = source_pixel[2];
            output_pixel[1] = source_pixel[1];
            output_pixel[2] = source_pixel[0];
            output_pixel[3] = source_pixel[3];
        }
    }

    Ok(ScreenshotOcrImage {
        bgra,
        width: region.width,
        height: region.height,
    })
}

#[cfg(target_os = "macos")]
async fn recognize_screenshot_ocr_image(
    image: ScreenshotOcrImage,
) -> Result<ScreenshotOcrResult, String> {
    tokio::task::spawn_blocking(move || recognize_screenshot_ocr_image_macos(image))
        .await
        .map_err(|e| format!("OCR task failed: {e}"))?
}

#[cfg(target_os = "windows")]
async fn recognize_screenshot_ocr_image(
    image: ScreenshotOcrImage,
) -> Result<ScreenshotOcrResult, String> {
    tokio::task::spawn_blocking(move || recognize_screenshot_ocr_image_windows(image))
        .await
        .map_err(|e| format!("OCR task failed: {e}"))?
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn recognize_screenshot_ocr_image(
    _image: ScreenshotOcrImage,
) -> Result<ScreenshotOcrResult, String> {
    Err("OCR is only available on macOS and Windows".to_string())
}

#[cfg(target_os = "macos")]
fn recognize_screenshot_ocr_image_macos(
    image: ScreenshotOcrImage,
) -> Result<ScreenshotOcrResult, String> {
    cidre::objc::ar_pool(|| {
        use cidre::{cv, ns, vn};
        use std::ffi::c_void;

        extern "C" fn release_pixel_buffer_data(
            release_ref_con: *mut c_void,
            _base_address: *const *const c_void,
        ) {
            if !release_ref_con.is_null() {
                unsafe {
                    drop(Box::from_raw(release_ref_con.cast::<Vec<u8>>()));
                }
            }
        }

        let width =
            usize::try_from(image.width).map_err(|_| "OCR image width is too large".to_string())?;
        let height = usize::try_from(image.height)
            .map_err(|_| "OCR image height is too large".to_string())?;
        let bytes_per_row = width
            .checked_mul(4)
            .ok_or_else(|| "OCR image row is too large".to_string())?;
        let mut data = Box::new(image.bgra);
        let base_address = data.as_mut_ptr().cast::<c_void>();
        let release_ref_con = Box::into_raw(data).cast::<c_void>();

        let pixel_buffer = match cv::PixelBuf::with_bytes(
            width,
            height,
            base_address,
            bytes_per_row,
            release_pixel_buffer_data,
            release_ref_con,
            cv::PixelFormat::_32_BGRA,
            None,
        ) {
            Ok(pixel_buffer) => pixel_buffer,
            Err(e) => {
                unsafe {
                    drop(Box::from_raw(release_ref_con.cast::<Vec<u8>>()));
                }
                return Err(format!("Failed to create OCR image: {e}"));
            }
        };

        let mut request = vn::RecognizeTextRequest::new();
        request.set_recognition_level(vn::RequestTextRecognitionLevel::Accurate);
        request.set_uses_lang_correction(true);

        if cidre::version!(macos = 13.0) {
            request.set_revision(vn::RecognizeTextRequest::REVISION_3);
            unsafe {
                request.set_automatically_detects_lang(true);
            }
        } else {
            request.set_revision(vn::RecognizeTextRequest::REVISION_2);
        }

        let handler = vn::ImageRequestHandler::with_cv_pixel_buf(&pixel_buffer, None)
            .ok_or_else(|| "Failed to initialize OCR image handler".to_string())?;
        let requests = ns::Array::<vn::Request>::from_slice(&[&request]);
        handler
            .perform(&requests)
            .map_err(|e| format!("macOS OCR failed: {e}"))?;

        let observations = request.results().unwrap_or_else(ns::Array::new);
        let mut lines = Vec::new();

        for observation in observations.iter() {
            let candidates = observation.top_candidates(1);
            let Some(candidate) = candidates.first() else {
                continue;
            };
            let text = candidate.string().to_string();
            if text.trim().is_empty() {
                continue;
            }
            lines.push(ScreenshotOcrLine {
                text,
                confidence: Some(candidate.confidence()),
                bounds: normalized_macos_ocr_rect_to_region(
                    observation.bounding_box(),
                    image.width,
                    image.height,
                ),
            });
        }

        let text = lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        Ok(ScreenshotOcrResult {
            text,
            lines,
            engine: "macos-vision".to_string(),
        })
    })
}

#[cfg(target_os = "macos")]
fn normalized_macos_ocr_rect_to_region(
    rect: cidre::cg::Rect,
    width: u32,
    height: u32,
) -> ScreenshotOcrRegion {
    let width_f = f64::from(width);
    let height_f = f64::from(height);
    let left = clamp_f64(rect.origin.x * width_f, 0.0, width_f);
    let right = clamp_f64((rect.origin.x + rect.size.width) * width_f, 0.0, width_f);
    let top = clamp_f64(
        (1.0 - rect.origin.y - rect.size.height) * height_f,
        0.0,
        height_f,
    );
    let bottom = clamp_f64((1.0 - rect.origin.y) * height_f, 0.0, height_f);
    let x = left.round() as u32;
    let y = top.round() as u32;
    let right = right.round() as u32;
    let bottom = bottom.round() as u32;

    ScreenshotOcrRegion {
        x,
        y,
        width: right.saturating_sub(x),
        height: bottom.saturating_sub(y),
    }
}

#[cfg(target_os = "macos")]
fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        min
    }
}

#[cfg(target_os = "windows")]
struct WindowsRuntimeGuard;

#[cfg(target_os = "windows")]
impl Drop for WindowsRuntimeGuard {
    fn drop(&mut self) {
        unsafe {
            windows::Win32::System::WinRT::RoUninitialize();
        }
    }
}

#[cfg(target_os = "windows")]
fn initialize_windows_runtime() -> Result<WindowsRuntimeGuard, String> {
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};

    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
        .map_err(|e| format!("Windows OCR runtime failed: {e}"))?;

    Ok(WindowsRuntimeGuard)
}

#[cfg(target_os = "windows")]
fn recognize_screenshot_ocr_image_windows(
    image: ScreenshotOcrImage,
) -> Result<ScreenshotOcrResult, String> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let _runtime = initialize_windows_runtime()?;

    let max_dimension =
        OcrEngine::MaxImageDimension().map_err(|e| format!("Windows OCR failed: {e}"))?;

    if image.width > max_dimension || image.height > max_dimension {
        return Err(format!(
            "Select a smaller text area. Windows OCR supports up to {max_dimension}px per side"
        ));
    }

    let width = i32::try_from(image.width).map_err(|_| "OCR image width is too large")?;
    let height = i32::try_from(image.height).map_err(|_| "OCR image height is too large")?;
    let writer = DataWriter::new().map_err(|e| format!("Windows OCR failed: {e}"))?;
    writer
        .WriteBytes(&image.bgra)
        .map_err(|e| format!("Windows OCR failed: {e}"))?;
    let buffer = writer
        .DetachBuffer()
        .map_err(|e| format!("Windows OCR failed: {e}"))?;
    let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        width,
        height,
        BitmapAlphaMode::Premultiplied,
    )
    .map_err(|e| format!("Windows OCR failed: {e}"))?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("Windows OCR is not available: {e}"))?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("Windows OCR failed: {e}"))?
        .get()
        .map_err(|e| format!("Windows OCR failed: {e}"))?;
    let text = result
        .Text()
        .map_err(|e| format!("Windows OCR failed: {e}"))?
        .to_string_lossy();
    let ocr_lines = result
        .Lines()
        .map_err(|e| format!("Windows OCR failed: {e}"))?;
    let mut lines = Vec::new();

    for index in 0..ocr_lines
        .Size()
        .map_err(|e| format!("Windows OCR failed: {e}"))?
    {
        let line = ocr_lines
            .GetAt(index)
            .map_err(|e| format!("Windows OCR failed: {e}"))?;
        let line_text = line
            .Text()
            .map_err(|e| format!("Windows OCR failed: {e}"))?
            .to_string_lossy();
        if line_text.trim().is_empty() {
            continue;
        }
        let words = line
            .Words()
            .map_err(|e| format!("Windows OCR failed: {e}"))?;
        let mut bounds: Option<(f32, f32, f32, f32)> = None;

        for word_index in 0..words
            .Size()
            .map_err(|e| format!("Windows OCR failed: {e}"))?
        {
            let rect = words
                .GetAt(word_index)
                .and_then(|word| word.BoundingRect())
                .map_err(|e| format!("Windows OCR failed: {e}"))?;
            bounds = Some(match bounds {
                Some((left, top, right, bottom)) => (
                    left.min(rect.X),
                    top.min(rect.Y),
                    right.max(rect.X + rect.Width),
                    bottom.max(rect.Y + rect.Height),
                ),
                None => (rect.X, rect.Y, rect.X + rect.Width, rect.Y + rect.Height),
            });
        }

        lines.push(ScreenshotOcrLine {
            text: line_text,
            confidence: None,
            bounds: bounds
                .map(windows_ocr_bounds_to_region)
                .unwrap_or(ScreenshotOcrRegion {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                }),
        });
    }

    Ok(ScreenshotOcrResult {
        text,
        lines,
        engine: "windows-media-ocr".to_string(),
    })
}

#[cfg(target_os = "windows")]
fn windows_ocr_bounds_to_region(
    (left, top, right, bottom): (f32, f32, f32, f32),
) -> ScreenshotOcrRegion {
    let x = clamp_f32_to_u32(left);
    let y = clamp_f32_to_u32(top);
    let right = clamp_f32_to_u32(right);
    let bottom = clamp_f32_to_u32(bottom);

    ScreenshotOcrRegion {
        x,
        y,
        width: right.saturating_sub(x),
        height: bottom.saturating_sub(y),
    }
}

#[cfg(target_os = "windows")]
fn clamp_f32_to_u32(value: f32) -> u32 {
    if value.is_finite() && value > 0.0 {
        value.round().min(u32::MAX as f32) as u32
    } else {
        0
    }
}

#[tauri::command]
#[specta::specta]
pub async fn render_screenshot_for_export(
    instance: WindowScreenshotEditorInstance,
) -> Result<Vec<u8>, String> {
    render_screenshot_png(&instance).await
}

#[tauri::command]
#[specta::specta]
pub async fn render_screenshot_project_for_export(
    path: PathBuf,
) -> Result<ScreenshotProjectExport, String> {
    let instance = ScreenshotEditorInstances::create_standalone_instance(path).await?;
    let config = instance.config_tx.borrow().config.clone();
    let image_width = instance.image_width;
    let image_height = instance.image_height;

    let result =
        render_screenshot_png(&instance)
            .await
            .map(|image_bytes| ScreenshotProjectExport {
                image_bytes,
                config,
                image_width,
                image_height,
            });
    instance.dispose().await;
    result
}

pub async fn render_screenshot_png(instance: &ScreenshotEditorInstance) -> Result<Vec<u8>, String> {
    let path = instance.path.clone();
    let config = instance.config_tx.borrow().config.clone();
    let width = instance.image_width;
    let height = instance.image_height;

    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(format!("Image dimensions exceed maximum: {width}x{height}"));
    }

    let data = instance.source_rgba.as_ref().clone();

    let cap_dir = if path.extension().and_then(|s| s.to_str()) == Some("cap") {
        Some(path.clone())
    } else if let Some(parent) = path.parent() {
        if parent.extension().and_then(|s| s.to_str()) == Some("cap") {
            Some(parent.to_path_buf())
        } else {
            None
        }
    } else {
        None
    };

    let recording_meta = if let Some(cap_dir) = &cap_dir {
        RecordingMeta::load_for_project(cap_dir).map_err(|e| e.to_string())?
    } else {
        let filename = path
            .file_name()
            .ok_or_else(|| "Invalid path".to_string())?
            .to_string_lossy();
        let relative_path = RelativePathBuf::from(filename.as_ref());
        let video_meta = VideoMeta {
            path: relative_path.clone(),
            fps: 30,
            start_time: Some(0.0),
            device_id: None,
        };
        let segment = SingleSegment {
            display: video_meta.clone(),
            camera: None,
            audio: None,
            cursor: None,
        };
        let studio_meta = StudioRecordingMeta::SingleSegment { segment };
        RecordingMeta {
            platform: None,
            project_path: path.parent().unwrap_or(&path).to_path_buf(),
            pretty_name: "Screenshot".to_string(),
            sharing: None,
            inner: RecordingMetaInner::Studio(Box::new(studio_meta)),
            upload: None,
        }
    };

    let (shared, background_cache) = if let Some(gpu) = gpu_context::get_shared_gpu().await {
        (
            quiro_rendering::SharedWgpuDevice {
                instance: (*gpu.instance).clone(),
                adapter: (*gpu.adapter).clone(),
                device: (*gpu.device).clone(),
                queue: (*gpu.queue).clone(),
                is_software_adapter: gpu.is_software_adapter,
            },
            gpu.background_cache.clone(),
        )
    } else {
        let instance = quiro_rendering::create_wgpu_instance().await;
        let force_software_adapter = quiro_rendering::force_software_wgpu_adapter();
        let hardware_adapter = if force_software_adapter {
            None
        } else {
            instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    force_fallback_adapter: false,
                    compatible_surface: None,
                })
                .await
                .ok()
        };
        let adapter = match hardware_adapter {
            Some(adapter) => adapter,
            None => instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::LowPower,
                    force_fallback_adapter: true,
                    compatible_surface: None,
                })
                .await
                .map_err(|_| "No GPU adapter found".to_string())?,
        };
        let adapter_info = adapter.get_info();
        let is_software_adapter = quiro_rendering::is_software_wgpu_adapter(&adapter_info);
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("cap-rendering-device"),
                required_features: wgpu::Features::empty(),
                ..Default::default()
            })
            .await
            .map_err(|e| e.to_string())?;
        (
            quiro_rendering::SharedWgpuDevice {
                instance,
                adapter,
                device,
                queue,
                is_software_adapter,
            },
            Arc::new(quiro_rendering::BackgroundTextureCache::default()),
        )
    };

    let options = quiro_rendering::RenderOptions {
        screen_size: quiro_project::XY::new(width, height),
        camera_size: None,
        preserve_screen_alpha: true,
    };

    let studio_meta = match &recording_meta.inner {
        RecordingMetaInner::Studio(meta) => meta.clone(),
        _ => return Err("Invalid recording meta for screenshot".to_string()),
    };

    let constants = RenderVideoConstants::from_shared_device(
        shared,
        options,
        *studio_meta,
        recording_meta.clone(),
        background_cache,
    );

    let (base_width, base_height) = ProjectUniforms::get_base_size(&constants.options, &config);
    let display_size = ProjectUniforms::display_size(
        &constants.options,
        &config,
        quiro_project::XY::new(base_width, base_height),
    )
    .coord;
    let crop = ProjectUniforms::get_crop(&constants.options, &config);
    let export_scale = f64::max(
        f64::max(
            crop.size.x as f64 / f64::max(display_size.x, 1.0),
            crop.size.y as f64 / f64::max(display_size.y, 1.0),
        ),
        1.0,
    );

    let resolution_base = quiro_project::XY::new(
        (((base_width as f64 * export_scale).ceil() as u32) + 3) & !3,
        (((base_height as f64 * export_scale).ceil() as u32) + 1) & !1,
    );

    if resolution_base.x > MAX_DIMENSION || resolution_base.y > MAX_DIMENSION {
        return Err(format!(
            "Export dimensions exceed maximum: {}x{}",
            resolution_base.x, resolution_base.y
        ));
    }

    let mut frame_renderer = FrameRenderer::new(&constants);
    let mut layers = RendererLayers::new_with_options(
        &constants.device,
        &constants.queue,
        constants.is_software_adapter,
    );
    let decoded_frame = DecodedFrame::new(data, width, height);
    let segment_frames = DecodedSegmentFrames {
        screen_frame: Some(DecodedFrame::new(
            decoded_frame.data().to_vec(),
            decoded_frame.width(),
            decoded_frame.height(),
        )),
        camera_frame: None,
        segment_time: 0.0,
        recording_time: 0.0,
        segment_has_camera: false,
    };
    let cursor_events = quiro_project::CursorEvents::default();
    let mut zoom_timeline = ZoomTransformTimeline::from_project(
        &config,
        &cursor_events,
        0.0,
        constants.options.screen_size,
    );
    zoom_timeline.ensure_precomputed_until(1.0 / 30.0);
    let uniforms = ProjectUniforms::new(
        &constants,
        &config,
        0,
        30,
        resolution_base,
        &cursor_events,
        &segment_frames,
        0.0,
        &zoom_timeline,
    );
    let rendered_frame = frame_renderer
        .render_immediate(
            segment_frames,
            uniforms,
            &quiro_project::CursorEvents::default(),
            true,
            &mut layers,
        )
        .await
        .map_err(|e| format!("Failed to render screenshot export: {e}"))?;

    let width_usize =
        usize::try_from(rendered_frame.width).map_err(|_| "Invalid export width".to_string())?;
    let height_usize =
        usize::try_from(rendered_frame.height).map_err(|_| "Invalid export height".to_string())?;
    let unpadded_bytes_per_row = width_usize
        .checked_mul(4)
        .ok_or_else(|| "Export row size overflow".to_string())?;
    let padded_bytes_per_row = usize::try_from(rendered_frame.padded_bytes_per_row)
        .map_err(|_| "Invalid export stride".to_string())?;

    if padded_bytes_per_row < unpadded_bytes_per_row {
        return Err(format!(
            "Invalid export stride: {} for {}x{} image",
            rendered_frame.padded_bytes_per_row, rendered_frame.width, rendered_frame.height
        ));
    }

    let expected_padded_len = padded_bytes_per_row
        .checked_mul(height_usize)
        .ok_or_else(|| "Export buffer size overflow".to_string())?;
    if rendered_frame.data.len() < expected_padded_len {
        return Err(format!(
            "Invalid export buffer length: expected at least {} got {} for {}x{} image",
            expected_padded_len,
            rendered_frame.data.len(),
            rendered_frame.width,
            rendered_frame.height
        ));
    }

    let rgba_data: Vec<u8> = rendered_frame
        .data
        .chunks(padded_bytes_per_row)
        .take(height_usize)
        .flat_map(|row| row[..unpadded_bytes_per_row].iter().copied())
        .collect();

    let mut png_data = Cursor::new(Vec::new());
    let encoder = PngEncoder::new(&mut png_data);
    encoder
        .write_image(
            &rgba_data,
            rendered_frame.width,
            rendered_frame.height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("Failed to encode screenshot export: {e}"))?;

    Ok(png_data.into_inner())
}
