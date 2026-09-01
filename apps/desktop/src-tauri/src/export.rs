//! Rendering a project out to a file.
//!
//! Cap runs exports in a separate `exporter` sidecar binary for crash
//! isolation, with an in-process fallback. This is the in-process path only —
//! same `quiro_export` crate doing the work, one process fewer to ship and
//! keep in sync.

use futures::FutureExt;
use quiro_export::{ExporterBase, make_cursor_only_project};
use quiro_project::{ProjectConfiguration, RecordingMeta, XY};
use quiro_rendering::ProjectRecordingsMeta;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::HashMap,
    future::Future,
    panic::AssertUnwindSafe,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
};
use tauri_plugin_dialog::DialogExt;
use tokio_util::sync::CancellationToken;
use tracing::{info, instrument, warn};

/// Stack for the thread an export runs on. Rendering a frame nests decoder,
/// compositor and encoder futures; that state machine is big, and Tauri's IPC
/// command entry is not where it should live. Debug builds need the headroom
/// most, since none of the intermediate futures get optimised away.
const EXPORT_THREAD_STACK_SIZE: usize = 16 * 1024 * 1024;

/// Runs an export off the IPC command stack, on a thread sized for it.
///
/// A panic mid-export is caught here too: the render path touches GPU drivers
/// and hardware encoders, and a panic crossing the FFI boundary would take the
/// whole app with it instead of failing one export.
async fn run_off_command_stack<T, F, Fut>(make_future: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = Result<T, String>> + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();

    std::thread::Builder::new()
        .name("quiro-export".to_string())
        .stack_size(EXPORT_THREAD_STACK_SIZE)
        .spawn(move || {
            let result = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime.block_on(async move {
                    match AssertUnwindSafe(make_future()).catch_unwind().await {
                        Ok(result) => result,
                        Err(panic) => Err(panic_message(panic)),
                    }
                }),
                Err(error) => Err(format!("Failed to build the export runtime: {error}")),
            };

            let _ = tx.send(result);
        })
        .map_err(|error| format!("Failed to spawn the export thread: {error}"))?;

    rx.await
        .map_err(|error| format!("The export thread stopped: {error}"))?
}

fn panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    let detail = panic
        .downcast_ref::<&str>()
        .map(|message| (*message).to_string())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_string());

    tracing::error!(panic = %detail, "Export panicked");
    format!("Export failed unexpectedly: {detail}")
}

/// Progress ticks are forwarded to the webview at most this often — a 60fps
/// export would otherwise post thousands of IPC messages a second for a
/// progress bar that can only move in whole pixels.
const PROGRESS_FORWARD_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

#[derive(Serialize, Type, Clone, Debug)]
pub struct FramesRendered {
    rendered_count: u32,
    total_frames: u32,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Type)]
#[serde(tag = "format")]
pub enum ExportSettings {
    Mp4(quiro_export::mp4::Mp4ExportSettings),
    Gif(quiro_export::gif::GifExportSettings),
    Mov(quiro_export::mov::MovExportSettings),
}

impl ExportSettings {
    fn fps(&self) -> u32 {
        match self {
            Self::Mp4(settings) => settings.fps,
            Self::Gif(settings) => settings.fps,
            Self::Mov(settings) => settings.fps,
        }
    }

    fn resolution_base(&self) -> XY<u32> {
        match self {
            Self::Mp4(settings) => settings.resolution_base,
            Self::Gif(settings) => settings.resolution_base,
            Self::Mov(settings) => settings.resolution_base,
        }
    }

    fn force_ffmpeg_decoder(&self) -> bool {
        match self {
            Self::Mp4(settings) => settings.force_ffmpeg_decoder,
            Self::Gif(_) | Self::Mov(_) => false,
        }
    }

    fn cursor_only(&self) -> bool {
        match self {
            Self::Mov(settings) => settings.cursor_only,
            _ => false,
        }
    }
}

#[derive(Clone)]
struct Progress {
    channel: tauri::ipc::Channel<FramesRendered>,
    last_emit_at: Arc<Mutex<Option<std::time::Instant>>>,
}

impl Progress {
    fn new(channel: tauri::ipc::Channel<FramesRendered>) -> Self {
        Self {
            channel,
            last_emit_at: Arc::new(Mutex::new(None)),
        }
    }

    /// Returns false once the webview has gone away, which the render loop
    /// reads as "stop".
    fn send(&self, rendered_count: u32, total_frames: u32) -> bool {
        let now = std::time::Instant::now();
        let due = {
            let mut last = match self.last_emit_at.lock() {
                Ok(last) => last,
                Err(poisoned) => poisoned.into_inner(),
            };
            let due = rendered_count == 0
                || rendered_count >= total_frames
                || last.is_none_or(|at| now.duration_since(at) >= PROGRESS_FORWARD_INTERVAL);
            if due {
                *last = Some(now);
            }
            due
        };

        if !due {
            return true;
        }

        self.channel
            .send(FramesRendered {
                rendered_count,
                total_frames,
            })
            .is_ok()
    }
}

static CANCELLATIONS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn cancellations() -> std::sync::MutexGuard<'static, HashMap<String, CancellationToken>> {
    CANCELLATIONS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Registers a cancellation token for the lifetime of one export, so
/// `cancel_export` can reach a run that is already in the render loop.
struct CancellationGuard {
    export_id: String,
    token: CancellationToken,
}

impl CancellationGuard {
    fn new(export_id: String) -> Self {
        let token = CancellationToken::new();
        cancellations().insert(export_id.clone(), token.clone());
        Self { export_id, token }
    }
}

impl Drop for CancellationGuard {
    fn drop(&mut self) {
        cancellations().remove(&self.export_id);
    }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_export(export_id: String) -> bool {
    let token = cancellations().get(&export_id).cloned();
    match token {
        Some(token) => {
            token.cancel();
            true
        }
        None => false,
    }
}

async fn do_export(
    project_path: &Path,
    settings: &ExportSettings,
    progress: &Progress,
    force_ffmpeg: bool,
    cancel_token: CancellationToken,
) -> Result<PathBuf, String> {
    if cancel_token.is_cancelled() {
        return Err("Export cancelled".to_string());
    }

    let mut builder =
        ExporterBase::builder(project_path.to_path_buf()).with_force_ffmpeg_decoder(force_ffmpeg);

    if settings.cursor_only() {
        let meta = RecordingMeta::load_for_project(project_path).map_err(|e| e.to_string())?;
        builder = builder.with_config(make_cursor_only_project(meta.project_config()));
    }

    let base = builder.build().await.map_err(|e| e.to_string())?;
    let total_frames = base.total_frames(settings.fps());

    if !progress.send(0, total_frames) {
        return Err("Export cancelled".to_string());
    }

    let on_frame = || {
        let progress = progress.clone();
        let cancel_token = cancel_token.clone();
        move |frame_index: u32| {
            !cancel_token.is_cancelled()
                && progress.send((frame_index + 1).min(total_frames), total_frames)
        }
    };

    match settings {
        ExportSettings::Mp4(settings) => settings.export(base, on_frame()).await,
        ExportSettings::Gif(settings) => settings.export(base, on_frame()).await,
        ExportSettings::Mov(settings) => settings.export(base, on_frame()).await,
    }
}

/// A hardware-decoded export that dies on frame decode is worth one retry on
/// the FFmpeg software decoder before the user sees an error.
fn is_frame_decode_error(error: &str) -> bool {
    error.contains("Failed to decode video frames")
        || error.contains("Too many consecutive frame failures")
        || error.contains("waiting for frame 0")
}

async fn export_inner(
    project_path: PathBuf,
    settings: ExportSettings,
    progress: Progress,
    cancel_token: CancellationToken,
) -> Result<PathBuf, String> {
    let force_ffmpeg = settings.force_ffmpeg_decoder();

    info!(
        project_path = %project_path.display(),
        force_ffmpeg,
        "Starting export"
    );

    let result = do_export(
        &project_path,
        &settings,
        &progress,
        force_ffmpeg,
        cancel_token.clone(),
    )
    .await;

    match result {
        Ok(path) => Ok(path),
        Err(e) if cancel_token.is_cancelled() || e == "Export cancelled" => {
            Err("Export cancelled".to_string())
        }
        Err(e) if !force_ffmpeg && is_frame_decode_error(&e) => {
            info!(error = %e, "Export hit a decode error, retrying with the FFmpeg decoder");
            do_export(
                &project_path,
                &settings,
                &progress,
                true,
                cancel_token.clone(),
            )
            .await
            .map_err(|retry_error| {
                if cancel_token.is_cancelled() || retry_error == "Export cancelled" {
                    "Export cancelled".to_string()
                } else {
                    retry_error
                }
            })
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(progress))]
pub async fn export_video(
    project_path: PathBuf,
    progress: tauri::ipc::Channel<FramesRendered>,
    settings: ExportSettings,
    export_id: String,
) -> Result<PathBuf, String> {
    let guard = CancellationGuard::new(export_id);
    let token = guard.token.clone();
    let progress = Progress::new(progress);

    run_off_command_stack(move || export_inner(project_path, settings, progress, token)).await
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app, progress))]
pub async fn export_video_to_file(
    app: tauri::AppHandle,
    project_path: PathBuf,
    progress: tauri::ipc::Channel<FramesRendered>,
    settings: ExportSettings,
    export_id: String,
    file_name: String,
    file_type: String,
) -> Result<PathBuf, String> {
    let Some(save_path) = show_save_dialog(&app, file_name, file_type).await? else {
        return Err("Save dialog cancelled".to_string());
    };

    let guard = CancellationGuard::new(export_id);
    let token = guard.token.clone();
    let progress = Progress::new(progress);

    let output_path =
        run_off_command_stack(move || export_inner(project_path, settings, progress, token))
            .await?;

    copy_export_to_path(&output_path, &save_path).await?;
    Ok(save_path)
}

async fn show_save_dialog(
    app: &tauri::AppHandle,
    file_name: String,
    file_type: String,
) -> Result<Option<PathBuf>, String> {
    let (name, extension) = match file_type.as_str() {
        "mp4" => ("MP4 Video", "mp4"),
        "gif" => ("GIF Image", "gif"),
        "mov" => ("MOV Video", "mov"),
        _ => {
            warn!(file_type, "Invalid export file type");
            return Err("Invalid file type".to_string());
        }
    };

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Save File")
        .set_file_name(file_name)
        .add_filter(name, &[extension])
        .save_file(move |path| {
            let _ = tx.send(path.and_then(|p| p.as_path().map(PathBuf::from)));
        });

    rx.await.map_err(|e| e.to_string())
}

async fn copy_export_to_path(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create export target directory: {e}"))?;
    }

    let bytes = tokio::fs::copy(src, dst)
        .await
        .map_err(|e| format!("Failed to copy exported file: {e}"))?;

    let source_size = tokio::fs::metadata(src)
        .await
        .map_err(|e| format!("Failed to read exported file metadata: {e}"))?
        .len();

    // A truncated copy is worse than no copy: it looks like a finished export.
    if bytes != source_size {
        let _ = tokio::fs::remove_file(dst).await;
        return Err(format!(
            "Export copy verification failed: copied {bytes} bytes but source is {source_size} bytes"
        ));
    }

    Ok(())
}

#[derive(Debug, Serialize, Type)]
pub struct ExportEstimates {
    pub duration_seconds: f64,
    pub estimated_time_seconds: f64,
    pub estimated_size_mb: f64,
}

fn project_duration(path: &Path, config: &ProjectConfiguration) -> Result<f64, String> {
    if let Some(timeline) = &config.timeline {
        return Ok(timeline.duration());
    }

    let meta = RecordingMeta::load_for_project(path).map_err(|e| e.to_string())?;
    let studio_meta = meta
        .studio_meta()
        .ok_or_else(|| "Not a studio recording".to_string())?;

    Ok(ProjectRecordingsMeta::new(&meta.project_path, studio_meta)?.duration())
}

#[tauri::command]
#[specta::specta]
#[instrument]
pub async fn get_export_estimates(
    path: PathBuf,
    settings: ExportSettings,
) -> Result<ExportEstimates, String> {
    let meta = RecordingMeta::load_for_project(&path).map_err(|e| e.to_string())?;
    let duration_seconds = project_duration(&path, &meta.project_config())?;

    let resolution = settings.resolution_base();
    let (width, height) = (resolution.x, resolution.y);
    let total_pixels = f64::from(width) * f64::from(height);
    let fps = f64::from(settings.fps());
    let total_frames = (duration_seconds * fps).ceil();

    // Cap's coefficients, measured against their own exports rather than
    // derived — they are a progress-bar hint, not a guarantee.
    let (estimated_size_mb, estimated_time_seconds) = match &settings {
        ExportSettings::Mp4(mp4) => {
            let effective_fps = ((fps - 30.0).max(0.0) * 0.6) + fps.min(30.0);
            let video_bitrate = total_pixels * f64::from(mp4.effective_bpp()) * effective_fps;
            let total_bitrate = video_bitrate + 192_000.0;
            let size_mb = (total_bitrate * 0.5 * duration_seconds) / (8.0 * 1024.0 * 1024.0);
            let render_fps = if width >= 3840 { 175.0 } else { 290.0 };

            (size_mb, total_frames / render_fps)
        }
        ExportSettings::Gif(_) => {
            let size_mb = (total_pixels * 0.5 * 0.07 * total_frames) / (1024.0 * 1024.0);
            let frames_per_sec = match (width, height) {
                (w, h) if w <= 1280 && h <= 720 => 10.0,
                (w, h) if w <= 1920 && h <= 1080 => 5.0,
                _ => 2.0,
            };

            (size_mb, total_frames / frames_per_sec)
        }
        ExportSettings::Mov(_) => {
            let size_mb = (total_pixels * 0.4 * total_frames) / (1024.0 * 1024.0);
            let render_fps = if width >= 3840 { 140.0 } else { 220.0 };

            (size_mb, total_frames / render_fps)
        }
    };

    Ok(ExportEstimates {
        duration_seconds,
        estimated_time_seconds,
        estimated_size_mb,
    })
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct ExportPreviewSettings {
    pub fps: u32,
    pub resolution_base: XY<u32>,
    pub compression_bpp: f32,
    #[serde(default)]
    pub cursor_only: bool,
}

#[derive(Debug, Serialize, Type)]
pub struct ExportPreviewResult {
    pub jpeg_base64: String,
    pub estimated_size_mb: f64,
    pub actual_width: u32,
    pub actual_height: u32,
    pub total_frames: u32,
}

/// Maps a bits-per-pixel target onto a JPEG quality, so the preview degrades
/// the way the encoded export will.
fn bpp_to_jpeg_quality(bpp: f32) -> u8 {
    ((bpp - 0.04) / (0.3 - 0.04) * (95.0 - 40.0) + 40.0).clamp(40.0, 95.0) as u8
}

/// One frame rendered at the chosen export settings, as a base64 JPEG — what
/// the export dialog shows so quality choices can be judged before committing
/// to a full render.
#[tauri::command]
#[specta::specta]
#[instrument(skip(editor_instance))]
pub async fn generate_export_preview(
    editor_instance: crate::editor::WindowEditorInstance,
    frame_time: f64,
    settings: ExportPreviewSettings,
) -> Result<ExportPreviewResult, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use image::codecs::jpeg::JpegEncoder;
    use quiro_rendering::{FrameRenderer, ProjectUniforms, RendererLayers, ZoomTransformTimeline};

    let project_config = {
        let config = editor_instance.project_config.1.borrow().clone();
        if settings.cursor_only {
            make_cursor_only_project(config)
        } else {
            config
        }
    };

    let (segment_time, segment) = project_config
        .get_segment_time(frame_time)
        .ok_or_else(|| "Frame time is outside video duration".to_string())?;

    let segment_media = editor_instance
        .segment_medias
        .get(segment.recording_clip as usize)
        .ok_or_else(|| "Segment media not found".to_string())?;

    let clip_offsets = project_config
        .clips
        .iter()
        .find(|clip| clip.index == segment.recording_clip)
        .map(|clip| clip.offsets)
        .unwrap_or_default();

    let segment_frames = segment_media
        .decoders
        .get_frames(
            segment_time as f32,
            !project_config.camera.hide,
            !settings.cursor_only,
            clip_offsets,
        )
        .await
        .ok_or_else(|| "Failed to decode frame".to_string())?;

    let frame_number = (frame_time * f64::from(settings.fps)).floor() as u32;
    let total_duration = project_config
        .timeline
        .as_ref()
        .map(|timeline| timeline.duration())
        .unwrap_or(0.0);

    let mut zoom_timeline = ZoomTransformTimeline::from_project_for_clip(
        &project_config,
        &segment_media.cursor,
        total_duration,
        editor_instance.render_constants.options.screen_size,
        segment.recording_clip,
    );
    zoom_timeline.ensure_precomputed_until((frame_number as f32 + 1.0) / settings.fps as f32);

    let uniforms = ProjectUniforms::new(
        &editor_instance.render_constants,
        &project_config,
        frame_number,
        settings.fps,
        settings.resolution_base,
        &segment_media.cursor,
        &segment_frames,
        total_duration,
        &zoom_timeline,
    );

    let mut frame_renderer = FrameRenderer::new(&editor_instance.render_constants);
    let mut layers = RendererLayers::new_with_options(
        &editor_instance.render_constants.device,
        &editor_instance.render_constants.queue,
        editor_instance.render_constants.is_software_adapter,
    );

    let frame = frame_renderer
        .render_immediate(
            segment_frames,
            uniforms,
            &segment_media.cursor,
            !settings.cursor_only,
            &mut layers,
        )
        .await
        .map_err(|e| format!("Failed to render frame: {e}"))?;

    let width = frame.width;
    let height = frame.height;

    // GPU readback rows are padded; drop the padding and the alpha channel.
    let rgb_data: Vec<u8> = frame
        .data
        .chunks(frame.padded_bytes_per_row as usize)
        .flat_map(|row| {
            row[0..(frame.width * 4) as usize]
                .chunks(4)
                .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
        })
        .collect();

    let mut jpeg_buffer = Vec::new();
    JpegEncoder::new_with_quality(
        &mut jpeg_buffer,
        bpp_to_jpeg_quality(settings.compression_bpp),
    )
    .encode(&rgb_data, width, height, image::ExtendedColorType::Rgb8)
    .map_err(|e| format!("Failed to encode JPEG: {e}"))?;

    let duration_seconds = editor_instance.recordings.duration();
    let fps = f64::from(settings.fps);
    let total_pixels =
        f64::from(settings.resolution_base.x) * f64::from(settings.resolution_base.y);
    let total_frames = (duration_seconds * fps).ceil();

    let estimated_size_mb = if settings.cursor_only {
        (total_pixels * 0.4 * total_frames) / (1024.0 * 1024.0)
    } else {
        let effective_fps = ((fps - 30.0).max(0.0) * 0.6) + fps.min(30.0);
        let video_bitrate = total_pixels * f64::from(settings.compression_bpp) * effective_fps;
        ((video_bitrate + 192_000.0) * 0.5 * duration_seconds) / (8.0 * 1024.0 * 1024.0)
    };

    Ok(ExportPreviewResult {
        jpeg_base64: STANDARD.encode(&jpeg_buffer),
        estimated_size_mb,
        actual_width: width,
        actual_height: height,
        total_frames: total_frames as u32,
    })
}
