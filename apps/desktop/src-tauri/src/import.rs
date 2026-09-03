//! Importing existing media into the library.
//!
//! Two very different jobs behind one word:
//!
//! * A **screenshot** is a file plus a `.json` sidecar (see `library.rs`), so
//!   importing one is a copy and a metadata write.
//!
//! * A **video** has to become something the editor will open, and the editor
//!   only accepts `RecordingMetaInner::Studio` — see the `let ... else` in
//!   `quiro_editor::editor_instance`. So an imported file is written as a
//!   `StudioRecordingMeta::SingleSegment`: a project directory, a video-only
//!   `display.mp4`, and the audio demuxed into its own file, because that format
//!   decides whether a segment has sound from `segment.audio` rather than by
//!   looking inside the video container. Importing without the demux would give
//!   you a video that plays silently in the editor.

use crate::library::{timestamped_pretty_name, write_sidecar_meta};
use quiro_enc_ffmpeg::remux;
use quiro_project::{
    RecordingMeta, RecordingMetaInner, SingleSegment, StudioRecordingMeta, VideoMeta,
};
use relative_path::RelativePathBuf;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tracing::{info, warn};

/// Containers we're willing to open. Anything FFmpeg can demux would probably
/// work, but an import that half-succeeds is worse than one that declines, so
/// this stays to formats that reliably carry a stream-copyable video track.
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "mkv", "webm", "avi", "m4v"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

fn has_extension(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| allowed.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn recordings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::general_settings::GeneralSettingsStore::get(app)
        .ok()
        .flatten()
        .and_then(|s| s.recordings_path)
        .map(PathBuf::from)
        .map_or_else(
            || {
                app.path()
                    .app_data_dir()
                    .map(|d| d.join("recordings"))
                    .map_err(|e| e.to_string())
            },
            Ok,
        )?;

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn screenshots_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map(|d| d.join("screenshots"))
        .map_err(|e| e.to_string())?;

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Copies `source` into the screenshots library and writes its sidecar.
/// Returns the path of the imported copy.
#[tauri::command(async)]
#[specta::specta]
pub fn import_screenshot(app: AppHandle, source: String) -> Result<String, String> {
    let source = PathBuf::from(source);

    if !source.exists() {
        return Err("That file no longer exists".to_string());
    }
    if !has_extension(&source, IMAGE_EXTENSIONS) {
        return Err(format!(
            "Unsupported image format. Supported: {}",
            IMAGE_EXTENSIONS.join(", ")
        ));
    }

    let dir = screenshots_dir(&app)?;
    let pretty_name = timestamped_pretty_name();
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let destination = dir.join(format!("{pretty_name}.{extension}"));

    std::fs::copy(&source, &destination).map_err(|e| format!("Failed to copy image: {e}"))?;

    let sort_time_millis = chrono::Local::now().timestamp_millis();
    if let Err(err) = write_sidecar_meta(&destination, &pretty_name, sort_time_millis) {
        // Without the sidecar the file is invisible to `list_screenshots`, so a
        // half-imported copy would just be litter.
        let _ = std::fs::remove_file(&destination);
        return Err(format!("Failed to write screenshot metadata: {err}"));
    }

    info!(?destination, "Imported screenshot");
    Ok(destination.to_string_lossy().to_string())
}

/// Copies `source` into a new studio project so the editor can open it.
/// Returns the project directory.
#[tauri::command(async)]
#[specta::specta]
pub fn import_video(app: AppHandle, source: String) -> Result<String, String> {
    let source = PathBuf::from(source);

    if !source.exists() {
        return Err("That file no longer exists".to_string());
    }
    if !has_extension(&source, VIDEO_EXTENSIONS) {
        return Err(format!(
            "Unsupported video format. Supported: {}",
            VIDEO_EXTENSIONS.join(", ")
        ));
    }
    if !remux::probe_media_valid(&source) {
        return Err("That file couldn't be opened as a video".to_string());
    }

    let pretty_name = timestamped_pretty_name();
    let project_dir = recordings_dir(&app)?.join(format!("{pretty_name}.quiro"));
    let content_dir = project_dir.join("content");
    std::fs::create_dir_all(&content_dir)
        .map_err(|e| format!("Failed to create project directory: {e}"))?;

    // Anything that fails from here leaves a half-written project directory,
    // which `list_recordings` would show as a broken entry — so every early
    // return past this point cleans up after itself.
    let cleanup = |err: String| -> String {
        let _ = std::fs::remove_dir_all(&project_dir);
        err
    };

    let display_path = content_dir.join("display.mp4");
    let audio_path = content_dir.join("audio-input.mka");

    let has_audio = remux::split_media_tracks(&source, &display_path, &audio_path)
        .map_err(|e| cleanup(format!("Failed to import video: {e}")))?;

    // fps is the only field of VideoMeta the format requires beyond the path,
    // and the editor uses it for timeline maths — a wrong guess makes playback
    // drift, so fall back only when the probe genuinely can't tell us.
    let fps = remux::get_video_fps(&display_path).unwrap_or_else(|| {
        warn!("Could not determine imported video's frame rate; assuming 30");
        30
    });

    let meta = RecordingMeta {
        platform: None,
        project_path: project_dir.clone(),
        pretty_name: pretty_name.clone(),
        sharing: None,
        upload: None,
        inner: RecordingMetaInner::Studio(Box::new(StudioRecordingMeta::SingleSegment {
            segment: SingleSegment {
                display: VideoMeta {
                    path: RelativePathBuf::from("content/display.mp4"),
                    fps,
                    start_time: None,
                    device_id: None,
                },
                camera: None,
                audio: has_audio.then(|| quiro_project::AudioMeta {
                    path: RelativePathBuf::from("content/audio-input.mka"),
                    start_time: None,
                    device_id: None,
                    gap_summary: None,
                }),
                cursor: None,
            },
        })),
    };

    meta.save_for_project()
        .map_err(|e| cleanup(format!("Failed to write project metadata: {e}")))?;

    info!(?project_dir, has_audio, fps, "Imported video");
    Ok(project_dir.to_string_lossy().to_string())
}
