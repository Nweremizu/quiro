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
    ClipConfiguration, ClipOffsets, MultipleSegment, MultipleSegments, ProjectConfiguration,
    RecordingMeta, RecordingMetaInner, SingleSegment, StudioRecordingMeta, StudioRecordingStatus,
    TimelineSegment, VideoMeta,
};
use relative_path::RelativePathBuf;
use std::{
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};
use tauri::{AppHandle, Manager, Window};
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

#[tauri::command]
#[specta::specta]
pub async fn import_video_clip(
    app: AppHandle,
    window: Window,
    editor_instance: crate::editor::WindowEditorInstance,
    source: String,
    config: ProjectConfiguration,
) -> Result<(), String> {
    if editor_instance.export_active.load(Ordering::Acquire)
        || editor_instance
            .export_preview_active
            .load(Ordering::Acquire)
    {
        return Err("Wait for the current export to finish before importing a clip".to_string());
    }
    let path = editor_instance.project_path.clone();

    tokio::task::spawn_blocking(move || import_video_clip_into_project(&path, &source, config))
        .await
        .map_err(|e| format!("Video import task failed: {e}"))??;

    crate::editor::EditorInstances::remove(&app, window.label()).await;
    Ok(())
}

fn import_video_clip_into_project(
    project_path: &Path,
    source: &str,
    mut config: ProjectConfiguration,
) -> Result<(), String> {
    let source = Path::new(source);
    if !source.is_file() {
        return Err("That file no longer exists".to_string());
    }
    if !has_extension(source, VIDEO_EXTENSIONS) {
        return Err(format!(
            "Unsupported video format. Supported: {}",
            VIDEO_EXTENSIONS.join(", ")
        ));
    }
    if !remux::probe_media_valid(source) {
        return Err("That file couldn't be opened as a video".to_string());
    }

    let mut meta = RecordingMeta::load_for_project(project_path)
        .map_err(|e| format!("Failed to load project metadata: {e}"))?;
    let RecordingMetaInner::Studio(studio) = &meta.inner else {
        return Err("Clips can only be imported into studio projects".to_string());
    };
    if !matches!(studio.status(), StudioRecordingStatus::Complete) {
        return Err("Finish recording before importing a clip".to_string());
    }
    let Some(timeline) = config.timeline.as_mut() else {
        return Err("This project has no clip timeline".to_string());
    };

    let old_meta = meta.clone();
    let import_id = uuid::Uuid::new_v4().to_string();
    let relative_dir = format!("content/imported/{import_id}");
    let import_dir = project_path.join(&relative_dir);
    std::fs::create_dir_all(&import_dir)
        .map_err(|e| format!("Failed to create clip directory: {e}"))?;
    let cleanup = |error: String| {
        let _ = std::fs::remove_dir_all(&import_dir);
        error
    };

    let display_path = import_dir.join("display.mp4");
    let audio_path = import_dir.join("audio-input.mka");
    let has_audio = remux::split_media_tracks(source, &display_path, &audio_path)
        .map_err(|e| cleanup(format!("Failed to import video: {e}")))?;
    let duration = remux::get_media_duration(&display_path)
        .map(|value| value.as_secs_f64())
        .filter(|value| *value > 0.0)
        .ok_or_else(|| cleanup("Could not determine the imported video's duration".to_string()))?;
    let fps = remux::get_video_fps(&display_path).unwrap_or(30);
    let display = VideoMeta {
        path: RelativePathBuf::from(format!("{relative_dir}/display.mp4")),
        fps,
        start_time: None,
        device_id: None,
    };
    let audio = has_audio.then(|| quiro_project::AudioMeta {
        path: RelativePathBuf::from(format!("{relative_dir}/audio-input.mka")),
        start_time: None,
        device_id: None,
        gap_summary: None,
    });
    let imported = MultipleSegment {
        display,
        camera: None,
        mic: audio,
        system_audio: None,
        cursor: None,
        keyboard: None,
    };

    let mut segments = match studio.as_ref() {
        StudioRecordingMeta::SingleSegment { segment } => vec![MultipleSegment {
            display: segment.display.clone(),
            camera: segment.camera.clone(),
            mic: segment.audio.clone(),
            system_audio: None,
            cursor: segment.cursor.clone(),
            keyboard: None,
        }],
        StudioRecordingMeta::MultipleSegments { inner } => inner.segments.clone(),
    };
    let index = segments.len() as u32;
    segments.push(imported);
    let cursors = match studio.as_ref() {
        StudioRecordingMeta::SingleSegment { .. } => Default::default(),
        StudioRecordingMeta::MultipleSegments { inner } => inner.cursors.clone(),
    };
    meta.inner = RecordingMetaInner::Studio(Box::new(StudioRecordingMeta::MultipleSegments {
        inner: MultipleSegments {
            segments,
            cursors,
            status: Some(StudioRecordingStatus::Complete),
        },
    }));

    timeline.segments.push(TimelineSegment {
        recording_clip: index,
        timescale: 1.0,
        start: 0.0,
        end: duration,
        name: source
            .file_stem()
            .map(|value| value.to_string_lossy().into_owned()),
        speed_audio_mode: None,
        transform: None,
        perspective: None,
    });
    config.clips.push(ClipConfiguration {
        index,
        offsets: ClipOffsets::default(),
        offsets_auto_calculated: false,
    });

    if let Err(error) = meta.save_for_project() {
        return Err(cleanup(format!(
            "Failed to save imported clip metadata: {error}"
        )));
    }
    if let Err(error) = config.write(project_path) {
        let _ = old_meta.save_for_project();
        return Err(cleanup(format!("Failed to save project timeline: {error}")));
    }

    info!(?project_path, index, duration, "Imported video clip");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imported_video_becomes_a_project_clip() {
        let project = tempfile::tempdir().unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/bg-videos/wispysky.mp4");
        let content = project.path().join("content");
        std::fs::create_dir_all(&content).unwrap();
        std::fs::copy(&source, content.join("display.mp4")).unwrap();

        let meta = RecordingMeta {
            platform: None,
            project_path: project.path().to_path_buf(),
            pretty_name: "Import test".to_string(),
            sharing: None,
            upload: None,
            inner: RecordingMetaInner::Studio(Box::new(StudioRecordingMeta::SingleSegment {
                segment: SingleSegment {
                    display: VideoMeta {
                        path: RelativePathBuf::from("content/display.mp4"),
                        fps: remux::get_video_fps(&source).unwrap_or(30),
                        start_time: None,
                        device_id: None,
                    },
                    camera: None,
                    audio: None,
                    cursor: None,
                },
            })),
        };
        meta.save_for_project().unwrap();

        let duration = remux::get_media_duration(&source).unwrap().as_secs_f64();
        let config = ProjectConfiguration {
            timeline: Some(quiro_project::TimelineConfiguration {
                segments: vec![TimelineSegment {
                    recording_clip: 0,
                    timescale: 1.0,
                    start: 0.0,
                    end: duration,
                    name: None,
                    speed_audio_mode: None,
                    transform: None,
                    perspective: None,
                }],
                transitions: Vec::new(),
                zoom_segments: Vec::new(),
                scene_segments: Vec::new(),
                mask_segments: Vec::new(),
                text_segments: Vec::new(),
                caption_segments: Vec::new(),
                keyboard_segments: Vec::new(),
                audio_segments: Vec::new(),
            }),
            ..Default::default()
        };

        import_video_clip_into_project(project.path(), source.to_str().unwrap(), config).unwrap();

        let loaded_meta = RecordingMeta::load_for_project(project.path()).unwrap();
        let RecordingMetaInner::Studio(studio) = loaded_meta.inner else {
            panic!("Expected a studio recording");
        };
        let StudioRecordingMeta::MultipleSegments { inner } = *studio else {
            panic!("Expected multiple recording segments");
        };
        assert_eq!(inner.segments.len(), 2);
        assert!(
            inner.segments[1]
                .display
                .path
                .to_path(project.path())
                .is_file()
        );

        let saved = ProjectConfiguration::load(project.path()).unwrap();
        let timeline = saved.timeline.unwrap();
        assert_eq!(timeline.segments.len(), 2);
        assert_eq!(timeline.segments[1].recording_clip, 1);
        assert!(timeline.segments[1].end > 0.0);
    }
}
