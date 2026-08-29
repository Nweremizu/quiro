//! Tauri commands backing the camera preview window's chrome (toolbar +
//! resize handles). The state itself, its persistence, and every bit of the
//! geometry math already existed — `CameraPreviewManager::get_state`/
//! `set_state` in camera.rs, `camera_window_size_for_state` in
//! windows/geometry.rs, `CameraWindowPositionGuard` in lib.rs — but nothing
//! exposed any of it to the frontend, so the preview window had no way to
//! read or change size, shape, mirroring or blur. These are that bridge.

use scap_targets::Display;
use tauri::{AppHandle, Manager, State, Wry};
use tracing::instrument;

use crate::camera::CameraPreviewState;
use crate::general_settings::{GeneralSettingsStore, WindowPosition};
use crate::windows::{WindowId, resize_camera_window_for_state};
use crate::{App, CameraWindowPositionGuard, MutableState};

#[tauri::command]
#[specta::specta]
#[instrument(skip(state))]
pub async fn get_camera_preview_state(
    state: MutableState<'_, App>,
) -> Result<CameraPreviewState, String> {
    state
        .read()
        .await
        .camera_preview
        .get_state()
        .map_err(|err| format!("Error reading camera preview state: {err}"))
}

/// `frame_aspect` is the live camera's width/height, so Full shape can widen
/// the window to the camera's own aspect instead of assuming 16:9. Only the
/// frontend knows it on the WS path (it decodes the frames); `None` is fine
/// and falls back to 16:9.
#[tauri::command]
#[specta::specta]
#[instrument(skip(app, state))]
pub async fn set_camera_preview_state(
    app: AppHandle,
    state: MutableState<'_, App>,
    preview_state: CameraPreviewState,
    frame_aspect: Option<f32>,
) -> Result<(), String> {
    let guard = state.read().await;
    let state_for_ws = preview_state.clone();

    guard
        .camera_preview
        .set_state(preview_state)
        .map_err(|err| format!("Error saving camera preview state: {err}"))?;

    // Drives the WS preview's own scaler (camera_legacy.rs watches this).
    let _ = guard.camera_preview_state_tx.send(state_for_ws.clone());

    // The native (macOS-only) preview resizes its own window off the
    // ReconfigureEvent::State that set_state just sent, using the live frame
    // aspect ratio — resizing again here would fight it with a slightly
    // different number. The WS path has no such loop, so it needs this.
    let native_preview_driving = guard.camera_preview.is_initialized();
    drop(guard);

    if !native_preview_driving
        && let Some(window) = WindowId::Camera.get(&app)
    {
        resize_camera_window_for_state(&app, &window, &state_for_ws, frame_aspect);
    }

    Ok(())
}

/// Persists where the user dragged the camera bubble to, both globally and
/// keyed by monitor name — the window-open path prefers the per-monitor entry
/// so an unplugged/rearranged display doesn't strand the window off-screen
/// (see windows/variants/camera.rs).
#[tauri::command]
#[specta::specta]
#[instrument(skip(app))]
pub fn set_camera_window_position(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    // Programmatic moves (centering, resize clamping) also fire the frontend's
    // move handler; the guard marks those so they aren't saved as user intent.
    if app
        .try_state::<CameraWindowPositionGuard>()
        .is_some_and(|guard| guard.should_ignore())
    {
        return Ok(());
    }

    GeneralSettingsStore::update(&app, |settings| {
        let display = crate::windows::display_containing_logical(x, y);
        let display_id = display.as_ref().map(Display::id);
        let monitor_name = display
            .as_ref()
            .and_then(|display| display.name())
            .filter(|name| !name.trim().is_empty());

        let position = WindowPosition { x, y, display_id };
        settings.camera_window_position = Some(position.clone());
        if let Some(monitor_name) = monitor_name {
            settings
                .camera_window_positions_by_monitor_name
                .insert(monitor_name, position);
        }
    })?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(guard))]
pub fn ignore_camera_window_position(
    guard: State<'_, CameraWindowPositionGuard>,
    duration_ms: u32,
) -> Result<(), String> {
    guard.ignore_for(duration_ms as u64);
    Ok(())
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app))]
pub fn close_camera_window(app: AppHandle<Wry>) -> Result<(), String> {
    if let Some(window) = WindowId::Camera.get(&app) {
        let _ = window.hide();
    }
    Ok(())
}
