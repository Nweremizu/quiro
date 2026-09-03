//! Studio recording pipeline: orchestrates `quiro_recording::studio_recording`
//! (a full port of Cap's own recording actor — mic/camera feeds, system
//! audio, cursor + keyboard capture, quality, out-of-process muxing) instead
//! of hand-rolling capture here. This file used to build a raw
//! `scap_direct3d::Capturer` directly and mux it itself; that was a
//! placeholder written before this crate's real engine existed to call, and
//! it recorded video only — no mic, no system audio, no camera overlay, no
//! Area targets, no quality setting. Replaced outright, matching Cap's own
//! `start_recording`/`stop_recording`/`pause_recording`/`resume_recording`
//! command shape and lifecycle (see Cap's `apps/desktop/src-tauri/src/
//! recording.rs`), trimmed of what doesn't apply here: no `.cap`-editor
//! project config/presets/background/zoom-segment writing (no editor exists
//! to read them), no Instant mode (Cap's is cloud-upload/auth-gated at the
//! app layer — out of scope), no telemetry/posthog.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use quiro_project::{Platform, RecordingMeta, RecordingMetaInner, StudioRecordingMeta};
use quiro_recording::feeds::camera::{self, CameraFeedLock};
use quiro_recording::feeds::microphone::{self, MicrophoneFeedLock};
use quiro_recording::sources::screen_capture::ScreenCaptureTarget;
use quiro_recording::{studio_recording, RecordingMode};
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tracing::{error, warn};

use crate::general_settings::GeneralSettingsStore;
use crate::recording_settings::RecordingSettingsStore;
use crate::windows::{apply_content_protection, ShowQuiroWindow, WindowId};
use crate::{App, ArcLock};

/// Which of the optional recording inputs a lifecycle event refers to. The
/// screen itself is never "lost" — only the devices attached alongside it can
/// disappear mid-recording.
#[derive(
    serde::Deserialize, specta::Type, serde::Serialize, Clone, Copy, Debug, PartialEq, Eq, Hash,
)]
#[serde(rename_all = "camelCase")]
pub enum RecordingInputKind {
    Microphone,
    Camera,
}

#[derive(tauri_specta::Event, specta::Type, Clone, Debug, serde::Serialize)]
#[serde(tag = "variant")]
pub enum RecordingEvent {
    Countdown { value: u32 },
    Started,
    Stopped,
    Paused,
    Resumed,
    Failed { error: String },
    // Emitted when start_recording aborts before any recording exists. Distinct from
    // `Failed` because the in-progress window treats `Failed` as "the active recording
    // died", which would misreport a healthy recording when a second start is refused.
    StartFailed { error: String },
    InputLost { input: RecordingInputKind },
    InputRestored { input: RecordingInputKind },
}

/// Owns the actor handle for the in-progress recording. The window layer
/// reads `App::recording_state` for everything else — this is only for the
/// handle itself (start/stop/pause/resume need somewhere to hold it that
/// isn't the async-locked `App`, mirroring the old capturer-holding version).
#[derive(Default)]
pub struct RecordingSession(Mutex<Option<ActiveRecording>>);

struct ActiveRecording {
    handle: studio_recording::ActorHandle,
    project_dir: PathBuf,
    pretty_name: String,
    /// Whether the recording is currently paused. Lives here rather than in a
    /// standalone state so it resets with each new recording automatically —
    /// a stale "paused" flag surviving into the next recording would make the
    /// pause/resume hotkey do the opposite of what its name says.
    paused: AtomicBool,
    /// Held only so the toolbar can mute/unmute mid-recording. The mute is
    /// scoped to the lock, so it resets on its own for the next recording.
    mic_lock: Option<Arc<MicrophoneFeedLock>>,
}

async fn lock_mic_feed(
    app_state: &ArcLock<App>,
) -> Result<Option<Arc<MicrophoneFeedLock>>, String> {
    let mic_feed = app_state.read().await.mic_feed.clone();
    match mic_feed.ask(microphone::Lock).await {
        Ok(lock) => Ok(Some(Arc::new(lock))),
        Err(kameo::error::SendError::HandlerError(microphone::LockFeedError::NoInput)) => Ok(None),
        Err(e) => Err(format!("Failed to lock microphone: {e}")),
    }
}

async fn lock_camera_feed(app_state: &ArcLock<App>) -> Result<Option<Arc<CameraFeedLock>>, String> {
    let camera_feed = app_state.read().await.camera_feed.clone();
    match camera_feed.ask(camera::Lock).await {
        Ok(lock) => Ok(Some(Arc::new(lock))),
        Err(kameo::error::SendError::HandlerError(camera::LockFeedError::NoInput)) => Ok(None),
        Err(e) => Err(format!("Failed to lock camera: {e}")),
    }
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, state))]
pub async fn start_recording(
    app: AppHandle,
    state: tauri::State<'_, RecordingSession>,
    capture_target: ScreenCaptureTarget,
) -> Result<(), String> {
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("Recording already in progress".into());
        }
    }

    let Some(app_state) = app.try_state::<ArcLock<App>>() else {
        return Err("App state not initialized".into());
    };
    let app_state = app_state.inner().clone();

    app_state
        .write()
        .await
        .set_pending_recording(RecordingMode::Studio, capture_target.clone())?;

    // From here, any early return must clear the pending state and tell the
    // main window why — otherwise it's stuck showing a "starting…" state for
    // a recording that never began. It also has to put the main window back:
    // the countdown below hides it and shows the toolbar before anything is
    // actually capturing, so a failure after that point would otherwise leave
    // no window on screen at all.
    macro_rules! fail {
        ($err:expr) => {{
            let error: String = $err;
            error!(%error, "Failed to start recording");
            app_state.write().await.clear_pending_recording();
            let _ = RecordingEvent::StartFailed { error: error.clone() }.emit(&app);
            restore_main_window(&app);
            return Err(error);
        }};
    }

    let settings = GeneralSettingsStore::get(&app)
        .ok()
        .flatten()
        .unwrap_or_default();
    let system_audio = RecordingSettingsStore::get(&app)
        .ok()
        .flatten()
        .map(|s| s.system_audio)
        .unwrap_or(false);

    let mic_feed = match lock_mic_feed(&app_state).await {
        Ok(feed) => feed,
        Err(error) => fail!(error),
    };
    let camera_feed = match lock_camera_feed(&app_state).await {
        Ok(feed) => feed,
        Err(error) => fail!(error),
    };

    let pretty_name = crate::library::timestamped_pretty_name();
    let project_dir = GeneralSettingsStore::recordings_dir(&app).join(&pretty_name);
    if let Err(e) = std::fs::create_dir_all(&project_dir) {
        fail!(format!("Failed to create recording directory: {e}"));
    }

    // `recording_countdown` has always been a real setting with a default of
    // 3 (general_settings.rs) but nothing ever counted down, so it silently
    // did nothing. The toolbar renders `Countdown`, so the handoff has to
    // happen *before* the actor exists — otherwise the first seconds of the
    // recording are the user still getting ready.
    let countdown = settings.recording_countdown.filter(|value| *value > 0);

    // Window/Area capture only shows the *target*'s pixels — nothing outside
    // it can leak into the recording regardless of what's on screen there.
    // This is purely a visible-to-the-recorder aid, dimming the rest of the
    // display so it's never ambiguous mid-recording what's actually being
    // captured. A Display target already covers the whole screen, so there's
    // nothing to dim.
    let occluder_target = match &capture_target {
        ScreenCaptureTarget::Window { id } => scap_targets::Window::from_id(id).and_then(|window| {
            let bounds = window.display_relative_logical_bounds()?;
            let screen_id = window.display()?.id();
            Some((screen_id, bounds))
        }),
        ScreenCaptureTarget::Area { screen, bounds } => Some((screen.clone(), *bounds)),
        ScreenCaptureTarget::Display { .. } | ScreenCaptureTarget::CameraOnly => None,
    };
    if let Some((screen_id, target_bounds)) = occluder_target {
        let occluder_app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = (ShowQuiroWindow::WindowCaptureOccluder {
                screen_id,
                target_bounds: Some(target_bounds),
            })
            .show(&occluder_app)
            .await
            {
                error!(?err, "Failed to show window capture occluder");
            }
        });
    }

    if let Some(main) = WindowId::Main.get(&app) {
        let _ = main.hide();
    }
    {
        let handoff_app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = (ShowQuiroWindow::InProgressRecording {
                countdown,
                capture_target: None,
            })
            .show(&handoff_app)
            .await
            {
                error!(?err, "Failed to show recording controls window");
            }
        });
    }

    if let Some(seconds) = countdown {
        for remaining in (1..=seconds).rev() {
            let _ = RecordingEvent::Countdown { value: remaining }.emit(&app);
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    let mut builder = studio_recording::Actor::builder(project_dir.clone(), capture_target.clone())
        .with_system_audio(system_audio)
        .with_custom_cursor(settings.custom_cursor_capture)
        .with_keyboard_capture(settings.capture_keyboard_events)
        // Fragmented output exists so a crash mid-recording can be recovered
        // and finished later — in Cap that finishing step happens in the
        // editor. Quiro has no editor to do that, so a fragmented recording
        // here would have no way to ever finish; a single continuous file
        // does not need that recovery path at all.
        .with_fragmented(false)
        .with_out_of_process_muxer(settings.out_of_process_muxer)
        .with_max_fps(settings.max_fps)
        .with_quality(settings.studio_recording_quality.into());
    if let Some(mic_feed) = mic_feed.clone() {
        builder = builder.with_mic_feed(mic_feed);
    }
    if let Some(camera_feed) = camera_feed.clone() {
        builder = builder.with_camera_feed(camera_feed);
    }

    #[cfg(target_os = "macos")]
    let handle = builder.build(None).await;
    #[cfg(not(target_os = "macos"))]
    let handle = builder.build().await;

    let handle = match handle {
        Ok(handle) => handle,
        Err(e) => fail!(format!("Failed to start recording: {e}")),
    };

    *state.0.lock().map_err(|e| e.to_string())? = Some(ActiveRecording {
        handle,
        project_dir,
        pretty_name,
        mic_lock: mic_feed,
        paused: AtomicBool::new(false),
    });

    app_state
        .write()
        .await
        .set_current_recording(capture_target);
    apply_content_protection(&app, true);

    let _ = RecordingEvent::Started.emit(&app);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn pause_recording(
    state: tauri::State<'_, RecordingSession>,
    app: AppHandle,
) -> Result<(), String> {
    let handle = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|active| active.handle.clone())
    };
    let Some(handle) = handle else {
        return Err("No recording in progress".into());
    };
    handle.pause().await.map_err(|e| e.to_string())?;
    set_paused_flag(&state, true)?;
    let _ = RecordingEvent::Paused.emit(&app);
    Ok(())
}

/// Records the pause state after the actor has actually accepted the change,
/// so a failed pause/resume can't leave the flag lying about what's happening.
fn set_paused_flag(
    state: &tauri::State<'_, RecordingSession>,
    paused: bool,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(active) = guard.as_ref() {
        active.paused.store(paused, Ordering::Release);
    }
    Ok(())
}

/// One binding for pause and resume — a global shortcut has no way to show two
/// different keys for two halves of the same toggle, and the user pressing
/// "pause" again plainly means resume.
#[tauri::command]
#[specta::specta]
pub async fn toggle_pause_recording(
    state: tauri::State<'_, RecordingSession>,
    app: AppHandle,
) -> Result<(), String> {
    let paused = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let Some(active) = guard.as_ref() else {
            return Err("No recording in progress".into());
        };
        active.paused.load(Ordering::Acquire)
    };

    if paused {
        resume_recording(state, app).await
    } else {
        pause_recording(state, app).await
    }
}

#[tauri::command]
#[specta::specta]
pub async fn resume_recording(
    state: tauri::State<'_, RecordingSession>,
    app: AppHandle,
) -> Result<(), String> {
    let handle = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|active| active.handle.clone())
    };
    let Some(handle) = handle else {
        return Err("No recording in progress".into());
    };
    handle.resume().await.map_err(|e| e.to_string())?;
    set_paused_flag(&state, false)?;
    let _ = RecordingEvent::Resumed.emit(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn stop_recording(
    app: AppHandle,
    state: tauri::State<'_, RecordingSession>,
) -> Result<String, String> {
    let active = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("No recording in progress")?;

    let stop_result = active.handle.stop().await;

    if let Some(app_state) = app.try_state::<ArcLock<App>>() {
        app_state.write().await.clear_recording_state();
    }
    apply_content_protection(&app, false);

    let completed = match stop_result {
        Ok(completed) => completed,
        Err(e) => {
            let error = e.to_string();
            error!(%error, "Recording stop failed");
            let _ = RecordingEvent::Failed {
                error: error.clone(),
            }
            .emit(&app);
            restore_main_window(&app);
            return Err(error);
        }
    };

    let output_path = match finalize_recording_output(&active.project_dir, &completed.meta) {
        Ok(path) => path,
        Err(error) => {
            error!(%error, "Failed to finalize recording output");
            let _ = RecordingEvent::Failed {
                error: error.clone(),
            }
            .emit(&app);
            restore_main_window(&app);
            return Err(error);
        }
    };

    let meta = RecordingMeta {
        platform: Some(Platform::default()),
        project_path: active.project_dir.clone(),
        pretty_name: active.pretty_name.clone(),
        sharing: None,
        inner: RecordingMetaInner::Studio(Box::new(completed.meta)),
        upload: None,
    };
    if let Err(e) = meta.save_for_project() {
        warn!(error = ?e, "Failed to save recording metadata");
    }

    restore_main_window(&app);

    let _ = RecordingEvent::Stopped.emit(&app);

    let output_path = output_path.to_string_lossy().to_string();

    // The main window's own React state doesn't know recording stopped (it
    // was hidden, not driving the toolbar's Stop click) — this event is how
    // it finds out and resets its UI instead of showing a stale "Stop
    // Recording" button that would just error on click.
    let _ = tauri::Emitter::emit(&app, "recording-stopped", &output_path);

    Ok(output_path)
}

/// `RecordingMeta::output_path()` always points at `output/result.mp4` —
/// nothing in the capture pipeline writes there directly yet (that's the
/// export step, which the editor doesn't have yet), so a non-fragmented
/// recording's one segment is copied into place here instead.
fn finalize_recording_output(
    project_dir: &PathBuf,
    meta: &StudioRecordingMeta,
) -> Result<PathBuf, String> {
    // The actor always produces `MultipleSegments` — `SingleSegment` is a
    // read-only legacy shape nothing here ever constructs (confirmed by
    // grepping the crate: no `StudioRecordingMeta::SingleSegment` literal
    // exists in studio_recording.rs). With `with_fragmented(false)` and no
    // pause/resume in between, a recording never has more than one segment,
    // so `segments[0]` is always the whole take — matching Cap's own
    // `handle_recording_finish`, which reads the exact same field.
    let StudioRecordingMeta::MultipleSegments { inner } = meta else {
        return Err("Expected a MultipleSegments recording (got the legacy SingleSegment shape)".into());
    };
    let Some(segment) = inner.segments.first() else {
        return Err("Recording produced no segments".into());
    };

    let segment_path = segment.display.path.to_path(project_dir);
    let output_dir = project_dir.join("output");
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let output_path = output_dir.join("result.mp4");

    // Copied, not moved: the editor loads its display track from the segment
    // path recorded in `recording-meta.json`, so moving the file out of
    // `content/segments/` leaves every recording un-editable.
    std::fs::copy(&segment_path, &output_path)
        .map_err(|e| format!("Failed to finalize recording output: {e}"))?;

    Ok(output_path)
}

/// Stops the actor and drops the session *without* finalizing any output or
/// writing metadata — the half of `stop_recording` that both discard and
/// restart need. Returns the project directory so the caller can decide what
/// happens to it.
async fn teardown_active_recording(
    app: &AppHandle,
    state: &tauri::State<'_, RecordingSession>,
) -> Result<PathBuf, String> {
    let active = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("No recording in progress")?;

    // cancel() tears the pipeline down without assembling a CompletedRecording
    // — stop() would do all the segment finalisation work only for it to be
    // deleted a moment later.
    if let Err(e) = active.handle.cancel().await {
        warn!(error = ?e, "Discarded recording did not cancel cleanly");
    }

    if let Some(app_state) = app.try_state::<ArcLock<App>>() {
        app_state.write().await.clear_recording_state();
    }
    apply_content_protection(app, false);

    Ok(active.project_dir)
}

/// The capture target of whatever is recording right now. Read before
/// `teardown_active_recording`, which clears it.
async fn active_capture_target(app: &AppHandle) -> Option<ScreenCaptureTarget> {
    let app_state = app.try_state::<ArcLock<App>>()?;
    let guard = app_state.read().await;
    match &guard.recording_state {
        crate::RecordingState::Active { target }
        | crate::RecordingState::Pending { target, .. } => {
            Some(target.clone())
        }
        crate::RecordingState::None => None,
    }
}

/// Recording-scoped mic mute. The feed keeps running at its normal cadence and
/// silence is written instead, so muting can't desync audio against video.
/// Returns the resulting state so the caller never has to guess.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(state))]
pub async fn set_recording_mic_muted(
    state: tauri::State<'_, RecordingSession>,
    muted: bool,
) -> Result<bool, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let active = guard.as_ref().ok_or("No recording in progress")?;
    let mic_lock = active
        .mic_lock
        .as_ref()
        .ok_or("This recording has no microphone")?;

    mic_lock.set_recording_muted(muted);
    Ok(mic_lock.is_recording_muted())
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, state))]
pub async fn discard_recording(
    app: AppHandle,
    state: tauri::State<'_, RecordingSession>,
) -> Result<(), String> {
    let project_dir = teardown_active_recording(&app, &state).await?;

    if let Err(e) = std::fs::remove_dir_all(&project_dir) {
        warn!(error = ?e, ?project_dir, "Failed to remove discarded recording");
    }

    restore_main_window(&app);
    let _ = RecordingEvent::Stopped.emit(&app);

    Ok(())
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, state))]
pub async fn restart_recording(
    app: AppHandle,
    state: tauri::State<'_, RecordingSession>,
) -> Result<(), String> {
    let target = active_capture_target(&app)
        .await
        .ok_or("No recording in progress")?;

    let project_dir = teardown_active_recording(&app, &state).await?;
    if let Err(e) = std::fs::remove_dir_all(&project_dir) {
        warn!(error = ?e, ?project_dir, "Failed to remove restarted recording");
    }

    // The occluder isn't reusable across recordings (its target rect is baked
    // into its URL) and start_recording below unconditionally spawns a fresh
    // one for a Window/Area target — without this the old one is orphaned
    // rather than replaced, and a repeated restart piles up duplicates.
    close_window_capture_occluders(&app);

    // Deliberately not restore_main_window() first: start_recording hides it
    // again immediately, and showing it in between makes the main window flash
    // over whatever is being recorded.
    start_recording(app, state, target).await
}

/// Unlike the toolbar (hidden, not closed, so the next recording reuses the
/// window) the occluder's target rect is baked into its URL at creation —
/// there's nothing to reuse it *for*, and the next recording almost certainly
/// targets a different window/area anyway. Close outright.
fn close_window_capture_occluders(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if matches!(
            WindowId::from_str(&label),
            Ok(WindowId::WindowCaptureOccluder { .. })
        ) {
            // Same DirectComposition ghost-surface issue close_target_select_
            // overlay_windows works around: hide() alone leaves a transparent
            // overlay's surface composited on screen on Windows.
            #[cfg(windows)]
            let _ = window.close();
            #[cfg(not(windows))]
            let _ = window.hide();
        }
    }
}

fn restore_main_window(app: &AppHandle) {
    close_window_capture_occluders(app);

    // Toolbar goes back to hidden rather than closed, so the next
    // start_recording reuses the same window instead of rebuilding it.
    if let Some(toolbar) = WindowId::RecordingControls.get(app) {
        let _ = toolbar.hide();
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = (ShowQuiroWindow::Main {
            init_target_mode: None,
        })
        .show(&handle)
        .await
        {
            error!(?err, "Failed to restore main window");
        }
    });
}
