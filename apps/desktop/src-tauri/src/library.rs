//! Recordings/screenshots library: listing what `recording.rs`/`capture.rs`
//! have already written to disk.
//!
//! Screenshots are a single file plus a `.json` sidecar written alongside it
//! (same stem, same directory) — there's no Cap equivalent for that (Cap's
//! screenshots are just a studio recording variant), so this stays Quiro's
//! own simple convention.
//!
//! Recordings are Cap's real project-directory format: `quiro_project::
//! RecordingMeta` (`recording-meta.json`) inside a directory per recording,
//! written by `recording.rs`'s `stop_recording`. `RecordingMetaWithMetadata`
//! is not that type — it's the flattened `(display name, sort key)` shape
//! the frontend actually wants, same as it always was; only where that data
//! now comes from changed.

use chrono::TimeZone;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMetaWithMetadata {
    pub pretty_name: String,
    pub sort_time_millis: i64,
    /// The project directory. The row's other path points at a media file
    /// inside it, which is what a preview or the editor wants — but revealing
    /// or deleting a recording means the whole project, not one video.
    pub project_path: String,
}

#[derive(Serialize, Deserialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotMetaWithMetadata {
    pub pretty_name: String,
    pub sort_time_millis: i64,
}

/// Screenshots only now — recordings write `quiro_project::RecordingMeta`
/// via `RecordingMeta::save_for_project()` instead (see `recording.rs`'s
/// `stop_recording`).
pub(crate) fn write_sidecar_meta(
    media_path: &std::path::Path,
    pretty_name: &str,
    sort_time_millis: i64,
) -> Result<(), String> {
    let json_path = media_path.with_extension("json");
    let contents = serde_json::to_string(&ScreenshotMetaWithMetadata {
        pretty_name: pretty_name.to_string(),
        sort_time_millis,
    })
    .map_err(|e| e.to_string())?;
    std::fs::write(json_path, contents).map_err(|e| e.to_string())
}

/// Timestamp-based id shared by a media file and its sidecar — also used
/// directly as `pretty_name`, matching Cap's "Cap 2024-11-15 at 16.35.36"
/// convention closely enough to be readable without a display-name field.
pub(crate) fn timestamped_pretty_name() -> String {
    chrono::Local::now()
        .format("%Y-%m-%d at %H.%M.%S")
        .to_string()
}

fn list_meta_files<T>(dir: &std::path::Path, extension: &str) -> Vec<(String, T)>
where
    T: for<'de> Deserialize<'de>,
{
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let json_path = entry.path();
            if json_path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let media_path = json_path.with_extension(extension);
            if !media_path.exists() {
                return None;
            }
            let contents = std::fs::read_to_string(&json_path).ok()?;
            let meta: T = serde_json::from_str(&contents).ok()?;
            Some((media_path.to_string_lossy().to_string(), meta))
        })
        .collect()
}

/// `pretty_name` is `timestamped_pretty_name()`'s own `"%Y-%m-%d at
/// %H.%M.%S"` format — parsed back rather than trusting directory
/// timestamps, which Windows can leave stale after a move or a slow write.
fn sort_time_millis_from_pretty_name(pretty_name: &str) -> i64 {
    chrono::NaiveDateTime::parse_from_str(pretty_name, "%Y-%m-%d at %H.%M.%S")
        .ok()
        .and_then(|naive| chrono::Local.from_local_datetime(&naive).single())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

// Off the main thread: these walk the recordings/screenshots directories and
// read a metadata file per entry, which grows with the user's library.
#[tauri::command(async)]
#[specta::specta]
pub fn list_recordings(app: AppHandle) -> Vec<(String, RecordingMetaWithMetadata)> {
    let dir = crate::general_settings::GeneralSettingsStore::recordings_dir(&app);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut items: Vec<(String, RecordingMetaWithMetadata)> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let project_path = entry.path();
            let meta = quiro_project::RecordingMeta::load_for_project(&project_path).ok()?;

            // `output_path` is the *exported* render, which only exists once
            // someone has actually exported the project — requiring it hid
            // every recording and every import until its first export. Fall
            // back to the captured display video, which is there from the
            // moment the project is written.
            let output_path = meta.output_path();
            let media_path = if output_path.exists() {
                output_path
            } else {
                meta.studio_meta()
                    .and_then(|studio| studio.display_path())
                    .map(|relative| meta.path(&relative))
                    .filter(|path| path.exists())?
            };

            Some((
                media_path.to_string_lossy().to_string(),
                RecordingMetaWithMetadata {
                    sort_time_millis: sort_time_millis_from_pretty_name(&meta.pretty_name),
                    pretty_name: meta.pretty_name,
                    project_path: project_path.to_string_lossy().to_string(),
                },
            ))
        })
        .collect();

    items.sort_by_key(|(_, meta)| std::cmp::Reverse(meta.sort_time_millis));
    items
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_screenshots(app: AppHandle) -> Vec<(String, ScreenshotMetaWithMetadata)> {
    let Ok(dir) = app.path().app_data_dir().map(|p| p.join("screenshots")) else {
        return Vec::new();
    };
    let mut items = list_meta_files::<ScreenshotMetaWithMetadata>(&dir, "png");
    items.sort_by_key(|(_, meta)| std::cmp::Reverse(meta.sort_time_millis));
    items
}
