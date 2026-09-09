//! Video (studio recording) editor: one `quiro_editor::EditorInstance` per
//! open editor window, plus the commands the frontend drives it with.
//!
//! Structured like `screenshot_editor.rs` — a label -> path map filled in by
//! the window variant before the webview loads, a per-window instance
//! registry, and a preview frame websocket — because both editors share the
//! same renderer and the same frontend frame-socket client.

use crate::frame_ws::{WSFrame, WSFrameFormat, create_watch_frame_ws};
use crate::gpu_context;
use crate::windows::WindowId;
use quiro_editor::{EditorFrameOutput, EditorState, FrameLayout};
use quiro_project::{
    CursorEvents, GlideDirection, ProjectConfiguration, RecordingMeta, RecordingMetaInner,
    SHORT_CURSOR_SHAPE_DEBOUNCE_MS, StudioRecordingMeta, XY, ZoomMode, ZoomSegment,
};
use quiro_rendering::{GpuOutputFormat, ProjectRecordingsMeta, SharedWgpuDevice};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::str::FromStr;
use std::{collections::HashMap, ops::Deref, path::PathBuf, sync::Arc, time::Instant};
use tauri::{AppHandle, Listener, Manager, Runtime, Window, ipc::CommandArg};
use tauri_specta::Event;
use tokio::sync::{RwLock, watch};
use tokio_util::sync::CancellationToken;

pub const EDITOR_PREVIEW_FPS: u32 = 60;
const EDITOR_OUTPUT_SIZE: XY<u32> = XY::new(1920, 1080);
const DEFAULT_EDITOR_PREVIEW_SCALE_NUMERATOR: u32 = 65;
const DEFAULT_EDITOR_PREVIEW_SCALE_DENOMINATOR: u32 = 100;

fn default_editor_preview_resolution() -> XY<u32> {
    XY::new(
        scaled_preview_dimension(
            EDITOR_OUTPUT_SIZE.x,
            DEFAULT_EDITOR_PREVIEW_SCALE_NUMERATOR,
            DEFAULT_EDITOR_PREVIEW_SCALE_DENOMINATOR,
            4,
        ),
        scaled_preview_dimension(
            EDITOR_OUTPUT_SIZE.y,
            DEFAULT_EDITOR_PREVIEW_SCALE_NUMERATOR,
            DEFAULT_EDITOR_PREVIEW_SCALE_DENOMINATOR,
            2,
        ),
    )
}

fn scaled_preview_dimension(value: u32, numerator: u32, denominator: u32, alignment: u32) -> u32 {
    let denominator = u64::from(denominator.max(1));
    let alignment = u64::from(alignment.max(1));
    let scaled = ((u64::from(value) * u64::from(numerator)) + (denominator / 2)) / denominator;
    let aligned = scaled.max(alignment).div_ceil(alignment) * alignment;

    u32::try_from(aligned).unwrap_or(u32::MAX)
}

/// Frontend -> backend: which frame the preview should show while paused.
/// An event rather than a command because it fires on every scrub tick.
#[derive(Deserialize, Type, tauri_specta::Event, Debug, Clone)]
pub struct RenderFrameEvent {
    frame_number: u32,
    fps: u32,
    resolution_base: XY<u32>,
}

#[derive(Serialize, Type, tauri_specta::Event, Debug, Clone)]
pub struct EditorStateChanged {
    playhead_position: u32,
}

/// Rendered display/camera placement of the latest preview frame, in
/// output-frame pixels — lets on-canvas overlays line up with what was
/// actually rendered.
#[derive(Serialize, Type, tauri_specta::Event, Debug, Clone, PartialEq)]
pub struct FrameLayoutEvent {
    display: [f32; 4],
    camera: Option<[f32; 4]>,
    output_width: u32,
    output_height: u32,
}

impl From<FrameLayout> for FrameLayoutEvent {
    fn from(layout: FrameLayout) -> Self {
        Self {
            display: layout.display,
            camera: layout.camera,
            output_width: layout.output_size[0],
            output_height: layout.output_size[1],
        }
    }
}

/// The library hands out a recording's `output/result.mp4`, but an editor
/// instance is opened on the project *directory* that owns it, so any path
/// inside a project resolves by walking up to the `recording-meta.json`.
pub fn project_dir_for(path: &std::path::Path) -> PathBuf {
    let mut candidate = if path.is_dir() {
        Some(path)
    } else {
        path.parent()
    };

    while let Some(dir) = candidate {
        if dir.join("recording-meta.json").exists() {
            return dir.to_path_buf();
        }
        candidate = dir.parent();
    }

    path.to_path_buf()
}

#[derive(Clone, Default)]
pub struct EditorPaths(pub Arc<std::sync::Mutex<HashMap<String, PathBuf>>>);

impl EditorPaths {
    pub fn set(app: &AppHandle, label: String, path: PathBuf) {
        if let Some(state) = app.try_state::<Self>()
            && let Ok(mut paths) = state.0.lock()
        {
            paths.insert(label, path);
        }
    }
}

/// Encodes preview frames on a thread of their own and republishes them.
///
/// Encoding is blocking CPU work, so it must not run on the render callback
/// (which would throttle rendering) or on a tokio worker (which is what
/// starved the runtime before — see `frame_pipeline::YIELD_UNTIL`).
///
/// The queue holds one frame and drops rather than blocking, matching the
/// `watch` channel downstream: a live preview wants the newest frame, not a
/// backlog. All-intra encoding makes those drops harmless.
fn spawn_preview_encoder(
    frame_tx: watch::Sender<Option<Arc<WSFrame>>>,
) -> (
    flume::Sender<Arc<WSFrame>>,
    flume::Receiver<Arc<WSFrame>>,
    Arc<std::sync::atomic::AtomicU64>,
    Arc<std::sync::atomic::AtomicU64>,
) {
    use std::sync::atomic::{AtomicU64, Ordering};

    let (raw_tx, raw_rx) = flume::bounded::<Arc<WSFrame>>(1);
    let encoder_rx = raw_rx.clone();
    // Offered vs dropped at the queue, against encoded-per-second below: says
    // whether the encoder is slow or simply not being handed frames.
    let offered = Arc::new(AtomicU64::new(0));
    let dropped = Arc::new(AtomicU64::new(0));
    let (offered_thread, dropped_thread) = (offered.clone(), dropped.clone());

    std::thread::Builder::new()
        .name("preview-encoder".into())
        .spawn(move || {
            let mut encoder = crate::preview_encoder::PreviewEncoder::new(60);
            let mut failed = false;
            let mut logged_first = false;
            let mut encoded_count = 0u64;
            let mut empty_count = 0u64;
            let mut encode_nanos = 0u64;
            let mut window = std::time::Instant::now();

            while let Ok(frame) = encoder_rx.recv() {
                // One failure is usually a missing encoder rather than a bad
                // frame, so stop trying and fall back to raw for the session
                // instead of logging once per frame forever.
                if failed {
                    let _ = frame_tx.send(Some(frame));
                    continue;
                }

                let encode_start = std::time::Instant::now();
                let mut encode_once = || match frame.format {
                    // The common render path; `stride` is the Y-plane stride.
                    WSFrameFormat::Nv12 { .. } => encoder.encode_nv12(
                        &frame.data,
                        frame.stride,
                        frame.width,
                        frame.height,
                        frame.frame_number,
                    ),
                    // Transitions still render RGBA.
                    WSFrameFormat::Rgba => encoder.encode(
                        &frame.data,
                        frame.stride,
                        frame.width,
                        frame.height,
                        frame.frame_number,
                    ),
                    // Already compressed.
                    WSFrameFormat::H264 { .. } => Ok(None),
                };

                let mut encoded = encode_once();

                // A hardware encoder can hold a frame or two internally
                // before emitting a packet. Continuous playback flushes that
                // for free — the next real frame prompts it — but a paused
                // single-shot request (a scrub, a quality change) has no
                // follow-up, so the preview would sit black forever. Every
                // frame here is a keyframe, so resubmitting the identical
                // picture is harmless and forces the buffered packet out;
                // capped so a genuinely stuck encoder still falls through to
                // the raw fallback below instead of hanging this thread.
                let resubmit_deadline =
                    std::time::Instant::now() + std::time::Duration::from_millis(200);
                while matches!(encoded, Ok(None)) && std::time::Instant::now() < resubmit_deadline
                {
                    encoded = encode_once();
                }

                encode_nanos += encode_start.elapsed().as_nanos() as u64;

                if window.elapsed() >= std::time::Duration::from_secs(2) {
                    let secs = window.elapsed().as_secs_f64();
                    tracing::info!(
                        offered_per_sec =
                            format!("{:.1}", offered_thread.swap(0, Ordering::Relaxed) as f64 / secs),
                        dropped_per_sec =
                            format!("{:.1}", dropped_thread.swap(0, Ordering::Relaxed) as f64 / secs),
                        encoded_per_sec = format!("{:.1}", encoded_count as f64 / secs),
                        empty_per_sec = format!("{:.1}", empty_count as f64 / secs),
                        encode_avg_ms = format!(
                            "{:.2}",
                            encode_nanos as f64 / encoded_count.max(1) as f64 / 1_000_000.0
                        ),
                        "PREVIEW_ENCODER stats"
                    );
                    encoded_count = 0;
                    empty_count = 0;
                    encode_nanos = 0;
                    window = std::time::Instant::now();
                }

                match encoded {
                    Ok(Some(encoded)) => {
                        encoded_count += 1;
                        let config_len = encoded.config.as_ref().map_or(0, |c| c.len()) as u32;
                        if !logged_first {
                            logged_first = true;
                            tracing::info!(
                                bytes = encoded.data.len(),
                                config_bytes = config_len,
                                width = encoded.width,
                                height = encoded.height,
                                "Preview encoder produced its first frame"
                            );
                        }
                        let mut data =
                            Vec::with_capacity(config_len as usize + encoded.data.len());
                        if let Some(config) = encoded.config {
                            data.extend_from_slice(&config);
                        }
                        data.extend_from_slice(&encoded.data);

                        let _ = frame_tx.send(Some(Arc::new(WSFrame {
                            data: Arc::new(data),
                            width: encoded.width,
                            height: encoded.height,
                            stride: config_len,
                            frame_number: frame.frame_number,
                            target_time_ns: frame.target_time_ns,
                            format: WSFrameFormat::H264 { config_len },
                            created_at: frame.created_at,
                        })));
                    }
                    Ok(None) => {
                        // The encoder buffered this frame rather than emitting
                        // one. Publishing the raw frame instead would put an
                        // 8MB payload on a wire that is otherwise carrying
                        // ~60KB — the next encoded frame is along shortly, so
                        // skipping is cheaper than falling back.
                        empty_count += 1;
                    }
                    Err(error) => {
                        tracing::warn!(%error, "Preview encoding unavailable; streaming raw frames");
                        failed = true;
                        let _ = frame_tx.send(Some(frame));
                    }
                }
            }
        })
        .expect("spawning the preview encoder thread");

    (raw_tx, raw_rx, offered, dropped)
}

fn offer_latest_preview_frame<T>(
    sender: &flume::Sender<T>,
    receiver: &flume::Receiver<T>,
    frame: T,
) -> u64 {
    match sender.try_send(frame) {
        Ok(()) | Err(flume::TrySendError::Disconnected(_)) => 0,
        Err(flume::TrySendError::Full(frame)) => {
            let dropped = u64::from(receiver.try_recv().is_ok());
            dropped + u64::from(sender.try_send(frame).is_err())
        }
    }
}

fn make_frame_callback(
    app: AppHandle,
    frame_tx: watch::Sender<Option<Arc<WSFrame>>>,
) -> quiro_editor::EditorFrameCallback {
    let (raw_tx, raw_rx, offered, dropped) = spawn_preview_encoder(frame_tx.clone());
    Box::new(move |output, layout| {
        let ws_frame = match output {
            EditorFrameOutput::Nv12(frame) => WSFrame {
                // Copy rather than `into_vec`, which detaches the buffer from
                // the NV12 pool permanently. Once the pool is empty every
                // readback allocates a fresh staging buffer, which measured
                // 32ms/frame against the pooled path's 3.5ms.
                data: Arc::new(frame.data.to_vec()),
                width: frame.width,
                height: frame.height,
                stride: frame.y_stride,
                frame_number: frame.frame_number,
                target_time_ns: frame.target_time_ns,
                format: match frame.format {
                    GpuOutputFormat::Nv12 => WSFrameFormat::Nv12 { full_range: false },
                    GpuOutputFormat::Rgba => WSFrameFormat::Rgba,
                },
                created_at: Instant::now(),
            },
            EditorFrameOutput::Rgba(frame) => WSFrame {
                data: frame.data,
                width: frame.width,
                height: frame.height,
                stride: frame.padded_bytes_per_row,
                frame_number: frame.frame_number,
                target_time_ns: frame.target_time_ns,
                format: WSFrameFormat::Rgba,
                created_at: Instant::now(),
            },
        };

        offered.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dropped_count = offer_latest_preview_frame(&raw_tx, &raw_rx, Arc::new(ws_frame));
        if dropped_count > 0 {
            dropped.fetch_add(dropped_count, std::sync::atomic::Ordering::Relaxed);
        }
        let _ = FrameLayoutEvent::from(layout).emit(&app);
    })
}

pub struct EditorInstance {
    inner: Arc<quiro_editor::EditorInstance>,
    pub ws_port: u16,
    ws_shutdown_token: CancellationToken,
    app_handle: AppHandle,
    render_frame_event_id: tauri::EventId,
}

impl EditorInstance {
    pub async fn dispose(&self) {
        self.inner.dispose().await;
        self.ws_shutdown_token.cancel();
        self.app_handle.unlisten(self.render_frame_event_id);
    }
}

impl Drop for EditorInstance {
    fn drop(&mut self) {
        self.ws_shutdown_token.cancel();
        self.app_handle.unlisten(self.render_frame_event_id);
    }
}

impl Deref for EditorInstance {
    type Target = Arc<quiro_editor::EditorInstance>;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

#[derive(Clone)]
pub struct EditorInstances(Arc<RwLock<HashMap<String, Arc<EditorInstance>>>>);

pub struct WindowEditorInstance(pub Arc<EditorInstance>);

impl specta::function::FunctionArg for WindowEditorInstance {
    fn to_datatype(_: &mut specta::TypeMap) -> Option<specta::DataType> {
        None
    }
}

impl Deref for WindowEditorInstance {
    type Target = Arc<EditorInstance>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<'de, R: Runtime> CommandArg<'de, R> for WindowEditorInstance {
    fn from_command(
        command: tauri::ipc::CommandItem<'de, R>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
        let window = Window::from_command(command)?;

        let Some(instances) = window.try_state::<EditorInstances>() else {
            return Err("editor instance registry unavailable".into());
        };

        // `futures::executor::block_on` on a tokio RwLock can deadlock when the
        // IPC handler already runs on the runtime; `try_read` never blocks, and
        // a contended lock surfaces as a retryable error instead.
        let Ok(instances) = instances.0.try_read() else {
            return Err("editor instance registry busy".into());
        };

        instances
            .get(window.label())
            .cloned()
            .map(Self)
            .ok_or_else(|| "editor instance unavailable".into())
    }
}

/// Recordings finalized before the editor existed had their one display
/// segment *moved* to `output/result.mp4` rather than copied, so the path
/// `recording-meta.json` points at no longer exists and the editor can't open
/// them ("Failed to open video: No such file or directory"). The finalized
/// output is a byte copy of that segment, so putting it back restores the
/// project. New recordings copy instead and never reach this.
fn heal_moved_segment_media(project_path: &std::path::Path) -> Result<(), String> {
    let meta = RecordingMeta::load_for_project(project_path).map_err(|e| e.to_string())?;

    let RecordingMetaInner::Studio(studio_meta) = &meta.inner else {
        return Ok(());
    };

    let StudioRecordingMeta::MultipleSegments { inner } = studio_meta.as_ref() else {
        return Ok(());
    };

    let Some(segment) = inner.segments.first() else {
        return Ok(());
    };

    let display_path = segment.display.path.to_path(project_path);
    if display_path.exists() {
        return Ok(());
    }

    // Only the first segment was ever moved, and quiro only ever records one.
    let output_path = meta.output_path();
    if !output_path.exists() {
        return Err(format!(
            "Recording is missing its video: {}",
            display_path.display()
        ));
    }

    if let Some(parent) = display_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to restore recording directory: {e}"))?;
    }

    std::fs::copy(&output_path, &display_path)
        .map_err(|e| format!("Failed to restore recording video: {e}"))?;

    tracing::info!(
        path = %display_path.display(),
        "Restored a recording segment that an older build moved to output/",
    );

    Ok(())
}

async fn create_instance(app: &AppHandle, path: PathBuf) -> Result<Arc<EditorInstance>, String> {
    // Large file copy in the worst case, so off the async workers.
    {
        let path = path.clone();
        tokio::task::spawn_blocking(move || heal_moved_segment_media(&path))
            .await
            .map_err(|e| format!("Recording repair task failed: {e}"))??;
    }

    let (frame_tx, frame_rx) = watch::channel(None);
    let (ws_port, ws_shutdown_token) = create_watch_frame_ws(frame_rx, Default::default()).await;
    if ws_port == 0 {
        return Err("Failed to start editor frame websocket".to_string());
    }

    let shared_device = gpu_context::get_shared_gpu()
        .await
        .map(|shared| SharedWgpuDevice {
            instance: (*shared.instance).clone(),
            adapter: (*shared.adapter).clone(),
            device: (*shared.device).clone(),
            queue: (*shared.queue).clone(),
            is_software_adapter: shared.is_software_adapter,
        });

    let inner = quiro_editor::EditorInstance::new(
        path,
        {
            let app = app.clone();
            move |state: &EditorState| {
                let _ = EditorStateChanged {
                    playhead_position: state.playhead_position,
                }
                .emit(&app);
            }
        },
        make_frame_callback(app.clone(), frame_tx),
        shared_device,
    )
    .await?;

    let render_frame_event_id = RenderFrameEvent::listen_any(app, {
        let preview_tx = inner.preview_tx.clone();
        move |e| {
            preview_tx.send_modify(|v| {
                *v = Some((
                    e.payload.frame_number,
                    e.payload.fps,
                    e.payload.resolution_base,
                ));
            });
        }
    });

    inner
        .preview_tx
        .send_modify(|v| *v = Some((0, EDITOR_PREVIEW_FPS, default_editor_preview_resolution())));

    Ok(Arc::new(EditorInstance {
        inner,
        ws_port,
        ws_shutdown_token,
        app_handle: app.clone(),
        render_frame_event_id,
    }))
}

type PendingResult = Result<Arc<EditorInstance>, String>;
type PendingReceiver = watch::Receiver<Option<PendingResult>>;

/// Instances built ahead of the window that will claim them. Constructing one
/// spins up decoders and a renderer, so starting it in parallel with the
/// webview boot is most of the difference between an editor that opens and
/// one that hangs on grey for a second.
#[derive(Clone, Default)]
pub struct PendingEditorInstances(Arc<RwLock<HashMap<String, PendingReceiver>>>);

impl PendingEditorInstances {
    pub fn get(app: &AppHandle) -> Self {
        match app.try_state::<Self>() {
            Some(state) => (*state).clone(),
            None => {
                let pending = Self::default();
                app.manage(pending.clone());
                pending
            }
        }
    }

    pub async fn start_prewarm(app: &AppHandle, window_label: String, path: PathBuf) {
        let pending = Self::get(app);

        if pending.0.read().await.contains_key(&window_label) {
            return;
        }

        let (tx, rx) = watch::channel(None);
        pending.0.write().await.insert(window_label, rx);

        let app = app.clone();
        tokio::spawn(async move {
            let result = create_instance(&app, path).await;
            tx.send(Some(result)).ok();
        });
    }

    async fn take(&self, window_label: &str) -> Option<PendingReceiver> {
        self.0.write().await.remove(window_label)
    }

    /// The window never appeared, so nothing will ever claim the instance —
    /// dispose it rather than leaking its decoders and websocket.
    pub async fn cancel_prewarm(&self, window_label: &str) {
        let Some(mut rx) = self.0.write().await.remove(window_label) else {
            return;
        };

        tokio::spawn(async move {
            loop {
                // Scoped so the watch guard is dropped before any await —
                // holding it across one makes this future non-Send.
                let pending = { rx.borrow_and_update().clone() };

                match pending {
                    Some(Ok(instance)) => {
                        instance.dispose().await;
                        return;
                    }
                    Some(Err(_)) => return,
                    None => {}
                }

                if rx.changed().await.is_err() {
                    return;
                }
            }
        });
    }
}

impl EditorInstances {
    pub async fn get_or_create(
        window: &Window,
        path: PathBuf,
    ) -> Result<Arc<EditorInstance>, String> {
        let instances = match window.try_state::<EditorInstances>() {
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
                let pending = PendingEditorInstances::get(window.app_handle());

                if let Some(mut prewarmed) = pending.take(window.label()).await {
                    loop {
                        if let Some(result) = prewarmed.borrow_and_update().clone() {
                            let instance = result?;
                            entry.insert(instance.clone());
                            return Ok(instance);
                        }
                        if prewarmed.changed().await.is_err() {
                            break;
                        }
                    }

                    tracing::warn!("Prewarm channel closed without a result, building on demand");
                }

                let instance = create_instance(window.app_handle(), path).await?;
                entry.insert(instance.clone());
                Ok(instance)
            }
            Entry::Occupied(entry) => Ok(entry.get().clone()),
        }
    }

    /// Called when an editor window is destroyed: an instance holds decoders,
    /// a wgpu renderer and an audio output, none of which the webview going
    /// away releases on its own.
    pub async fn remove(app: &AppHandle, label: &str) {
        let Some(instances) = app.try_state::<EditorInstances>() else {
            return;
        };

        let instance = {
            let mut instances = instances.0.write().await;
            instances.remove(label)
        };

        if let Some(instance) = instance {
            instance.dispose().await;
        }
    }
}

#[derive(Serialize, Type, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SerializedEditorInstance {
    frames_socket_url: String,
    recording_duration: f64,
    saved_project_config: ProjectConfiguration,
    recordings: Arc<ProjectRecordingsMeta>,
    path: PathBuf,
    pretty_name: String,
}

#[tauri::command]
#[specta::specta]
pub async fn create_editor_instance(window: Window) -> Result<SerializedEditorInstance, String> {
    if !matches!(WindowId::from_str(window.label()), Ok(WindowId::Editor)) {
        return Err("Invalid window".to_string());
    }

    let path = {
        let paths = window.state::<EditorPaths>();
        let paths = paths.0.lock().map_err(|e| e.to_string())?;
        paths
            .get(window.label())
            .cloned()
            .ok_or_else(|| "Editor instance not found".to_string())?
    };

    let instance = EditorInstances::get_or_create(&window, path).await?;

    Ok(SerializedEditorInstance {
        frames_socket_url: format!("ws://localhost:{}", instance.ws_port),
        recording_duration: instance.recordings.duration(),
        saved_project_config: instance.project_config.1.borrow().clone(),
        recordings: instance.recordings.clone(),
        path: instance.project_path.clone(),
        pretty_name: instance.meta().pretty_name.clone(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn start_playback(
    editor_instance: WindowEditorInstance,
    fps: u32,
    resolution_base: XY<u32>,
) -> Result<(), String> {
    editor_instance.start_playback(fps, resolution_base).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn stop_playback(editor_instance: WindowEditorInstance) -> Result<(), String> {
    let mut state = editor_instance.state.lock().await;

    if let Some(handle) = state.playback_task.take() {
        handle.stop();
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_playhead_position(
    editor_instance: WindowEditorInstance,
    frame_number: u32,
) -> Result<(), String> {
    editor_instance
        .modify_and_emit_state(|state| {
            state.playhead_position = frame_number;
        })
        .await;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_project_config(
    editor_instance: WindowEditorInstance,
    config: ProjectConfiguration,
) -> Result<(), String> {
    config
        .write(&editor_instance.project_path)
        .map_err(|error| format!("Failed to write project config: {error}"))
}

#[tauri::command]
#[specta::specta]
pub async fn update_project_config_in_memory(
    editor_instance: WindowEditorInstance,
    config: ProjectConfiguration,
    frame_number: Option<u32>,
    fps: Option<u32>,
    resolution_base: Option<XY<u32>>,
) -> Result<(), String> {
    editor_instance.project_config.0.send(config).ok();

    if let (Some(frame_number), Some(fps), Some(resolution_base)) =
        (frame_number, fps, resolution_base)
    {
        editor_instance.preview_tx.send_modify(|v| {
            *v = Some((frame_number, fps, resolution_base));
        });
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_editor_meta(
    editor_instance: WindowEditorInstance,
) -> Result<RecordingMeta, String> {
    Ok(editor_instance.meta().clone())
}

#[tauri::command]
#[specta::specta]
pub async fn get_editor_project_path(
    editor_instance: WindowEditorInstance,
) -> Result<PathBuf, String> {
    Ok(editor_instance.project_path.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn set_pretty_name(
    editor_instance: WindowEditorInstance,
    pretty_name: String,
) -> Result<(), String> {
    let mut meta = editor_instance.meta().clone();
    meta.pretty_name = pretty_name;
    meta.save_for_project().map_err(|e| e.to_string())
}

/// Cap's auto-zoom: every cursor click becomes a padded window, overlapping
/// windows merge, and each surviving window becomes one zoom segment.
fn zoom_segments_from_clicks(
    mut clicks: Vec<quiro_project::CursorClickEvent>,
    max_duration: f64,
) -> Vec<ZoomSegment> {
    const MS_PER_SECOND: f64 = 1000.0;
    const START_MIN_MS: f64 = 1.0;
    const CLICK_PRE_PADDING_MS: f64 = 300.0;
    const CLICK_POST_PADDING_MS: f64 = 2500.0;
    const CLICK_END_CLAMP_PADDING_MS: f64 = 800.0;
    const TRAILING_CLICK_IGNORE_MS: f64 = 1000.0;
    const MERGE_GAP_MS: f64 = 2500.0;
    const AUTO_ZOOM_AMOUNT: f64 = 2.0;

    if max_duration <= 0.0 {
        return Vec::new();
    }

    let duration_ms = max_duration * MS_PER_SECOND;
    let click_cutoff_ms = duration_ms - TRAILING_CLICK_IGNORE_MS;
    let end_limit_ms = duration_ms - CLICK_END_CLAMP_PADDING_MS;
    if click_cutoff_ms <= 0.0 || end_limit_ms <= START_MIN_MS {
        return Vec::new();
    }

    clicks.sort_by(|a, b| {
        a.time_ms
            .partial_cmp(&b.time_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut intervals: Vec<(f64, f64)> = Vec::new();
    for click in clicks {
        let time_ms = click.time_ms.floor();
        if time_ms >= click_cutoff_ms {
            continue;
        }

        let start = (time_ms - CLICK_PRE_PADDING_MS).max(START_MIN_MS);
        let end = (time_ms + CLICK_POST_PADDING_MS).min(end_limit_ms);

        if end > start {
            intervals.push((start, end));
        }
    }

    intervals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut merged: Vec<(f64, f64)> = Vec::new();
    for interval in intervals {
        if let Some(last) = merged.last_mut()
            && interval.0 <= last.1 + MERGE_GAP_MS
        {
            last.1 = last.1.max(interval.1);
            continue;
        }
        merged.push(interval);
    }

    merged
        .into_iter()
        .map(|(start, end)| ZoomSegment {
            // Auto-generated zooms move the framing only; a motion state is
            // something the user opts into in the panel.
            motion: Default::default(),
            start: start.round() / MS_PER_SECOND,
            end: end.round() / MS_PER_SECOND,
            amount: AUTO_ZOOM_AMOUNT,
            mode: ZoomMode::Auto,
            glide_direction: GlideDirection::None,
            glide_speed: 0.5,
            instant_animation: false,
            edge_snap_ratio: 0.25,
        })
        .collect()
}

#[tauri::command]
#[specta::specta]
pub async fn generate_zoom_segments_from_clicks(
    editor_instance: WindowEditorInstance,
) -> Result<Vec<ZoomSegment>, String> {
    let meta = editor_instance.meta();
    let RecordingMetaInner::Studio(studio_meta) = &meta.inner else {
        return Ok(Vec::new());
    };

    let mut clicks = Vec::new();

    match studio_meta.as_ref() {
        StudioRecordingMeta::SingleSegment { segment } => {
            if let Some(cursor_path) = &segment.cursor {
                let mut events =
                    CursorEvents::load_from_file(&meta.path(cursor_path)).unwrap_or_default();
                let pointer_ids = studio_meta.pointer_cursor_ids();
                events.stabilize_short_lived_cursor_shapes(
                    (!pointer_ids.is_empty()).then_some(&pointer_ids),
                    SHORT_CURSOR_SHAPE_DEBOUNCE_MS,
                );
                clicks = events.clicks;
            }
        }
        StudioRecordingMeta::MultipleSegments { inner } => {
            for segment in &inner.segments {
                clicks.extend(segment.cursor_events(meta).clicks);
            }
        }
    }

    Ok(zoom_segments_from_clicks(
        clicks,
        editor_instance.recordings.duration(),
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn generate_keyboard_segments(
    editor_instance: WindowEditorInstance,
    grouping_threshold_ms: f64,
    linger_duration_ms: f64,
    show_modifiers: bool,
    show_special_keys: bool,
) -> Result<Vec<quiro_project::KeyboardTrackSegment>, String> {
    let meta = editor_instance.meta();

    let RecordingMetaInner::Studio(studio_meta) = &meta.inner else {
        return Ok(Vec::new());
    };

    let mut all_events = quiro_project::KeyboardEvents { presses: vec![] };

    match studio_meta.as_ref() {
        StudioRecordingMeta::SingleSegment { segment } => {
            all_events
                .presses
                .extend(segment.keyboard_events(meta).presses);
        }
        StudioRecordingMeta::MultipleSegments { inner } => {
            for segment in &inner.segments {
                all_events
                    .presses
                    .extend(segment.keyboard_events(meta).presses);
            }
        }
    }

    all_events.presses.sort_by(|a, b| {
        a.time_ms
            .partial_cmp(&b.time_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(quiro_project::group_key_events(
        &all_events,
        grouping_threshold_ms,
        linger_duration_ms,
        show_modifiers,
        show_special_keys,
    ))
}

/// Deletes the whole project directory and closes its editor window.
#[tauri::command]
#[specta::specta]
pub async fn delete_editor_project(window: Window) -> Result<(), String> {
    let path = {
        let paths = window.state::<EditorPaths>();
        let paths = paths.0.lock().map_err(|e| e.to_string())?;
        paths
            .get(window.label())
            .cloned()
            .ok_or_else(|| "Editor instance not found".to_string())?
    };

    EditorInstances::remove(window.app_handle(), window.label()).await;

    std::fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete recording: {e}"))?;

    window.close().map_err(|e| e.to_string())
}

/// Per-100ms dBFS levels for one audio track, used to draw the timeline's
/// audio waveform. Silence is reported as -60 dBFS rather than -inf so the
/// frontend can scale it linearly.
fn waveform_for(audio: &quiro_audio::AudioData) -> Vec<f32> {
    const CHUNK_SIZE: usize = (quiro_audio::AudioData::SAMPLE_RATE as usize) / 10;

    let channels = audio.channels() as usize;
    let samples = audio.samples();
    let mut waveform = Vec::new();

    let mut i = 0;
    while i < samples.len() {
        let end = (i + CHUNK_SIZE * channels).min(samples.len());
        let sum: f32 = samples[i..end].iter().map(|sample| sample.abs()).sum();
        let average = if end > i { sum / (end - i) as f32 } else { 0.0 };
        waveform.push(if average > 0.0 {
            20.0 * average.log10()
        } else {
            -60.0
        });
        i += CHUNK_SIZE * channels;
    }

    waveform
}

#[tauri::command]
#[specta::specta]
pub async fn get_mic_waveforms(
    editor_instance: WindowEditorInstance,
) -> Result<Vec<Vec<f32>>, String> {
    let mut out = Vec::new();

    for segment in editor_instance.segment_medias.iter() {
        // A track that failed to decode renders as an empty waveform rather
        // than failing the whole timeline; playback surfaces the real error.
        match segment.audio.get().await {
            Ok(Some(audio)) => out.push(waveform_for(&audio)),
            Ok(None) => out.push(Vec::new()),
            Err(error) => {
                tracing::warn!(%error, "Mic audio failed to load; returning empty waveform");
                out.push(Vec::new());
            }
        }
    }

    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn get_system_audio_waveforms(
    editor_instance: WindowEditorInstance,
) -> Result<Vec<Vec<f32>>, String> {
    let mut out = Vec::new();

    for segment in editor_instance.segment_medias.iter() {
        match segment.system_audio.get().await {
            Ok(Some(audio)) => out.push(waveform_for(&audio)),
            Ok(None) => out.push(Vec::new()),
            Err(error) => {
                tracing::warn!(%error, "System audio failed to load; returning empty waveform");
                out.push(Vec::new());
            }
        }
    }

    Ok(out)
}

/// A JPEG of the display track at the playhead, for the crop dialog to draw
/// on. Downscaled: the cropper maps interactions back to full display
/// dimensions, so the reference only has to be sharp enough to aim with.
#[tauri::command]
#[specta::specta]
pub async fn get_display_frame_for_cropping(
    editor_instance: WindowEditorInstance,
    fps: u32,
) -> Result<Vec<u8>, String> {
    use image::{ImageEncoder, codecs::jpeg::JpegEncoder};
    use quiro_rendering::{PixelFormat, cpu_yuv};
    use std::io::Cursor;

    const MAX_PREVIEW_DIM: u32 = 1440;

    let frame_number = editor_instance.state.lock().await.playhead_position;
    let time_secs = f64::from(frame_number) / f64::from(fps.max(1));

    let project = editor_instance.project_config.1.borrow().clone();

    let (segment_time, segment) = project
        .get_segment_time(time_secs)
        .ok_or_else(|| "No segment found for current time".to_string())?;

    let segment_medias = editor_instance
        .segment_medias
        .get(segment.recording_clip as usize)
        .ok_or_else(|| "Segment media not found".to_string())?;

    let clip_offsets = project
        .clips
        .iter()
        .find(|clip| clip.index == segment.recording_clip)
        .map(|clip| clip.offsets)
        .unwrap_or_default();

    let segment_frames = segment_medias
        .decoders
        .get_frames(segment_time as f32, false, true, clip_offsets)
        .await
        .ok_or_else(|| "Failed to get frame".to_string())?;

    let screen_frame = segment_frames
        .screen_frame
        .ok_or_else(|| "Failed to get screen frame".to_string())?;
    let width = screen_frame.width();
    let height = screen_frame.height();

    let rgba_data = match screen_frame.format() {
        PixelFormat::Rgba => screen_frame.data().to_vec(),
        PixelFormat::Nv12 => {
            let y_plane = screen_frame.y_plane().ok_or("Missing Y plane")?;
            let uv_plane = screen_frame.uv_plane().ok_or("Missing UV plane")?;
            let mut rgba = vec![0u8; (width * height * 4) as usize];
            cpu_yuv::nv12_to_rgba(
                y_plane,
                uv_plane,
                width,
                height,
                screen_frame.y_stride(),
                screen_frame.uv_stride(),
                &mut rgba,
            );
            rgba
        }
        PixelFormat::Yuv420p => {
            let y_plane = screen_frame.y_plane().ok_or("Missing Y plane")?;
            let u_plane = screen_frame.u_plane().ok_or("Missing U plane")?;
            let v_plane = screen_frame.v_plane().ok_or("Missing V plane")?;
            let mut rgba = vec![0u8; (width * height * 4) as usize];
            cpu_yuv::yuv420p_to_rgba(
                y_plane,
                u_plane,
                v_plane,
                width,
                height,
                screen_frame.y_stride(),
                screen_frame.uv_stride(),
                &mut rgba,
            );
            rgba
        }
    };

    let rgba_image = image::RgbaImage::from_raw(width, height, rgba_data)
        .ok_or_else(|| "Failed to build image buffer from frame".to_string())?;

    let longest_side = width.max(height);
    let resized = if longest_side > MAX_PREVIEW_DIM {
        let scale = MAX_PREVIEW_DIM as f32 / longest_side as f32;
        image::imageops::resize(
            &rgba_image,
            ((width as f32 * scale).round() as u32).max(1),
            ((height as f32 * scale).round() as u32).max(1),
            image::imageops::FilterType::Triangle,
        )
    } else {
        rgba_image
    };

    let rgb_image = image::DynamicImage::ImageRgba8(resized).into_rgb8();
    let (out_width, out_height) = (rgb_image.width(), rgb_image.height());

    let mut jpeg_data = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut jpeg_data, 82)
        .write_image(
            rgb_image.as_raw(),
            out_width,
            out_height,
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("Failed to encode JPEG: {e}"))?;

    Ok(jpeg_data.into_inner())
}

/// Renders every frame of the project in order into a socket the frontend
/// composites from.
///
/// This is the counterpart to `RenderFrameEvent`, which is a *scrub* API built
/// on a watch channel: last value wins, so asking for frames back-to-back
/// coalesces and a frontend compositor ends up serialised — request, wait,
/// composite, request. Here the renderer runs ahead into a small bounded queue
/// so compositing frame N overlaps rendering N+1, and backpressure runs the
/// whole way back from the socket, so a slow consumer paces the renderer
/// instead of building a backlog.
///
/// There is no stop command: closing the socket fails the renderer's `send`,
/// which ends the render.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(editor_instance))]
pub async fn start_frame_stream(
    editor_instance: WindowEditorInstance,
    fps: u32,
    resolution_base: XY<u32>,
    nv12: bool,
    max_frames: Option<u32>,
) -> Result<String, String> {
    let (rgba_tx, mut rgba_rx) =
        tokio::sync::mpsc::channel::<(quiro_rendering::RenderedFrame, u32)>(4);
    let (nv12_tx, mut nv12_rx) =
        tokio::sync::mpsc::channel::<(quiro_rendering::Nv12RenderedFrame, u32)>(4);
    let (ws_tx, ws_rx) = tokio::sync::mpsc::channel::<WSFrame>(4);
    let (port, token) = crate::frame_ws::create_stream_frame_ws(ws_rx).await;

    tauri::async_runtime::spawn(async move {
        // Rust's own production rate, measured before anything leaves the
        // process. Compared against the frontend's stall it says whether a slow
        // stream is the renderer or the transport.
        let started_at = Instant::now();
        let mut produced = 0u32;

        loop {
            // Only one of these ever produces: the unused renderer's sender is
            // dropped below, so its receiver closes immediately.
            let ws_frame = tokio::select! {
                Some((frame, frame_number)) = rgba_rx.recv() => WSFrame {
                    data: frame.data,
                    width: frame.width,
                    height: frame.height,
                    stride: frame.padded_bytes_per_row,
                    frame_number,
                    target_time_ns: frame.target_time_ns,
                    format: WSFrameFormat::Rgba,
                    created_at: Instant::now(),
                },
                Some((frame, frame_number)) = nv12_rx.recv() => WSFrame {
                    // Copy rather than `into_vec`, which detaches the buffer from
                // the NV12 pool permanently. Once the pool is empty every
                // readback allocates a fresh staging buffer, which measured
                // 32ms/frame against the pooled path's 3.5ms.
                data: Arc::new(frame.data.to_vec()),
                    width: frame.width,
                    height: frame.height,
                    stride: frame.y_stride,
                    frame_number,
                    target_time_ns: frame.target_time_ns,
                    format: WSFrameFormat::Nv12 { full_range: false },
                    created_at: Instant::now(),
                },
                else => break,
            };

            produced += 1;
            if max_frames.is_some_and(|max| produced > max) {
                break;
            }

            // The export logs the size it renders; this one never did, which
            // left its readback cost impossible to compare against.
            if produced == 1 {
                tracing::info!(
                    width = ws_frame.width,
                    height = ws_frame.height,
                    stride = ws_frame.stride,
                    bytes = ws_frame.data.len(),
                    "frame stream output size"
                );
            }

            // Awaited, so a slow client stalls the renderer rather than the heap.
            if ws_tx.send(ws_frame).await.is_err() {
                break;
            }
        }

        let seconds = started_at.elapsed().as_secs_f64();
        tracing::info!(
            frames = produced,
            fps = format!("{:.1}", f64::from(produced) / seconds.max(f64::EPSILON)),
            per_frame_ms = format!("{:.1}", seconds * 1000.0 / f64::from(produced.max(1))),
            "frame stream produced"
        );
        quiro_rendering::RGBA_RENDER_STAGES.log_and_reset("frame stream");

        // ponytail: dropping `ws_tx` above makes the handler send its close
        // frame, and axum's graceful shutdown waits for the connection, so
        // cancelling straight away is enough to reclaim the port.
        drop(ws_tx);
        token.cancel();
    });

    let instance = editor_instance.0.clone();
    tauri::async_runtime::spawn(async move {
        let project = instance.project_config.1.borrow().clone();
        let meta = instance.meta().clone();
        let Some(studio_meta) = meta.studio_meta().cloned() else {
            return;
        };

        let segments = instance
            .segment_medias
            .iter()
            .map(|s| quiro_rendering::RenderSegment {
                cursor: s.cursor.clone(),
                keyboard: s.keyboard.clone(),
                decoders: s.decoders.clone(),
                render_display: true,
            })
            .collect();

        let result = if nv12 {
            drop(rgba_tx);
            quiro_rendering::render_video_to_channel_nv12(
                &instance.render_constants,
                &project,
                nv12_tx,
                &meta,
                &studio_meta,
                segments,
                fps,
                resolution_base,
                &instance.recordings,
                max_frames,
                None,
            )
            .await
        } else {
            drop(nv12_tx);
            quiro_rendering::render_video_to_channel(
                &instance.render_constants,
                &project,
                rgba_tx,
                &meta,
                &studio_meta,
                segments,
                fps,
                resolution_base,
                &instance.recordings,
            )
            .await
        };

        if let Err(error) = result {
            tracing::error!(%error, "Frame stream ended");
        }
    });

    Ok(format!("ws://localhost:{port}/frames"))
}

#[cfg(test)]
mod tests {
    use super::offer_latest_preview_frame;

    #[test]
    fn preview_encoder_queue_replaces_stale_frame() {
        let (sender, receiver) = flume::bounded(1);
        sender.send(1).unwrap();

        assert_eq!(offer_latest_preview_frame(&sender, &receiver, 2), 1);
        assert_eq!(receiver.recv().unwrap(), 2);
    }
}
