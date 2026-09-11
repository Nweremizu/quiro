use super::*;

pub fn hide_overlay(window: &WebviewWindow) {
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.hide();
}

pub fn show_overlay(window: &WebviewWindow) {
    let _ = window.set_ignore_cursor_events(false);
    let _ = window.show();
}

pub(crate) fn emit_app_event<E>(app: &AppHandle, event: E)
where
    E: Event + serde::Serialize + Clone,
{
    let event_name = std::any::type_name::<E>();
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| event.emit(app))) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => warn!(event = event_name, %error, "Failed to emit app event"),
        Err(panic) => {
            let message = crate::panic_payload_message(&panic);
            error!(event = event_name, panic = %message, "Suppressed panic while emitting app event");
        }
    }
}

pub(crate) fn hide_recording_windows(app: &AppHandle, restore_target_select_overlays: bool) {
    let focus_manager = app.try_state::<WindowFocusManager>();

    for (label, window) in app.webview_windows() {
        if let Ok(id) = WindowId::from_str(&label)
            && matches!(
                id,
                WindowId::TargetSelectOverlay { .. } | WindowId::Main | WindowId::Camera
            )
        {
            if matches!(id, WindowId::TargetSelectOverlay { .. }) {
                if restore_target_select_overlays
                    && window.is_visible().unwrap_or(false)
                    && let Some(focus_manager) = focus_manager.as_ref()
                {
                    focus_manager.remember_overlay_for_restore(label);
                }
                hide_overlay(&window);
            } else {
                let _ = window.hide();
            }
        }
    }
}

/// Release the live camera preview feed after `hide_recording_windows` when a
/// foreground window (Settings, an editor) takes over. Hiding the camera window
/// alone leaves the capture session running, so the OS camera-in-use indicator
/// stays lit while the user is in the editor. `restore_main_window_inputs`
/// re-attaches the feed when the main window comes back.
pub(crate) fn release_camera_preview_if_idle(app: &AppHandle) {
    let is_recording = app
        .try_state::<ArcLock<App>>()
        .and_then(|state| {
            state
                .try_read()
                .ok()
                .map(|state| state.is_recording_active_or_pending())
        })
        .unwrap_or(true);

    if is_recording {
        return;
    }

    let app = app.clone();
    tokio::spawn(async move {
        if let Some(state) = app.try_state::<ArcLock<App>>() {
            let app_state = &mut *state.write().await;
            app_state.camera_preview.pause();
            let _ = app_state.camera_feed.ask(feeds::camera::RemoveInput).await;
            app_state.camera_in_use = false;
        } else {
            warn!("App state unavailable while pausing camera preview");
        }
    });
}

pub(crate) fn bump_camera_window_session(app: &AppHandle) -> u64 {
    app.state::<Arc<AtomicU64>>().fetch_add(1, Ordering::AcqRel) + 1
}

pub(crate) fn camera_window_label_for_session(session_id: u64) -> String {
    format!("camera-{session_id}")
}

pub(crate) fn is_camera_window_label(label: &str) -> bool {
    label == "camera"
        || label
            .strip_prefix("camera-")
            .is_some_and(|suffix| suffix.parse::<u64>().is_ok())
}

/// One editor window per screenshot path, keyed by a hash of the path rather
/// than the path itself — a raw filesystem path (drive letter, colon,
/// backslashes, spaces) isn't a safe Tauri window label. Hashing loses the
/// ability to recover the path from the label, but nothing needs to: the
/// only use is "does a window for *this* path already exist", answered by
/// hashing the path again and checking, not by reversing an existing label.
pub(crate) fn screenshot_editor_label_for_path(path: &std::path::Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    format!("screenshot-editor-{:x}", hasher.finish())
}

pub(crate) fn is_screenshot_editor_label(label: &str) -> bool {
    label.starts_with("screenshot-editor-")
}

/// Same path-hash scheme as [`screenshot_editor_label_for_path`], for the
/// video editor's one-window-per-recording-project labels.
pub(crate) fn editor_label_for_path(path: &std::path::Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    format!("editor-{:x}", hasher.finish())
}

pub(crate) fn is_editor_label(label: &str) -> bool {
    label.starts_with("editor-")
}

pub(crate) fn camera_window_rank(label: &str) -> u64 {
    if label == "camera" {
        return 0;
    }

    label
        .strip_prefix("camera-")
        .and_then(|suffix| suffix.parse::<u64>().ok())
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
pub(crate) fn camera_window_labels(app: &AppHandle<Wry>) -> Vec<String> {
    app.webview_windows()
        .into_keys()
        .filter(|label| is_camera_window_label(label))
        .collect()
}

pub(crate) fn camera_webview_window_entries(app: &AppHandle<Wry>) -> Vec<(String, WebviewWindow)> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| is_camera_window_label(label))
        .collect()
}

pub(crate) fn camera_webview_windows(app: &AppHandle<Wry>) -> Vec<WebviewWindow> {
    camera_webview_window_entries(app)
        .into_iter()
        .map(|(_, window)| window)
        .collect()
}

pub(crate) fn current_camera_window(app: &AppHandle<Wry>) -> Option<WebviewWindow> {
    #[cfg(target_os = "macos")]
    {
        camera_webview_window_entries(app)
            .into_iter()
            .filter(|(_, window)| is_window_handle_valid(window))
            .max_by_key(|(label, _)| camera_window_rank(label))
            .map(|(_, window)| window)
    }

    #[cfg(not(target_os = "macos"))]
    {
        camera_webview_window_entries(app)
            .into_iter()
            .max_by_key(|(label, _)| camera_window_rank(label))
            .map(|(_, window)| window)
    }
}

pub(crate) fn destroy_camera_window_handle(
    app: &AppHandle<Wry>,
    window: WebviewWindow,
) -> tokio::sync::oneshot::Receiver<()> {
    let (destroy_tx, destroy_rx) = tokio::sync::oneshot::channel();
    let _ = window.as_ref().close();
    app.run_on_main_thread({
        let window = window.clone();
        move || {
            let _ = window.destroy();
            let _ = destroy_tx.send(());
        }
    })
    .ok();
    destroy_rx
}

pub(crate) async fn init_native_camera_preview(
    app_state: &mut App,
    window: WebviewWindow,
) -> Result<(), String> {
    let camera_feed = app_state.camera_feed.clone();
    let init_result = app_state
        .camera_preview
        .init_window(window, camera_feed.clone())
        .await;

    match init_result {
        Ok(()) => {
            #[allow(deprecated)]
            let camera_ws_sender = app_state.camera_ws_sender.clone();
            #[allow(deprecated)]
            if let Err(err) = camera_feed
                .ask(feeds::camera::RemoveSender(camera_ws_sender))
                .await
            {
                warn!(error = %err, "Failed to remove legacy camera preview sender");
            }
            Ok(())
        }
        Err(err) => {
            #[allow(deprecated)]
            let camera_ws_sender = app_state.camera_ws_sender.clone();
            #[allow(deprecated)]
            if let Err(add_err) = camera_feed
                .ask(feeds::camera::AddSender(camera_ws_sender))
                .await
            {
                warn!(error = %add_err, "Failed to restore legacy camera preview sender");
            }
            Err(err.to_string())
        }
    }
}

pub(crate) async fn ensure_camera_input_active(app_state: &mut App) {
    if let Some(id) = app_state.selected_camera_id.clone()
        && !app_state.camera_in_use
    {
        let settings = crate::recording_settings::RecordingSettingsStore::camera_settings_for(
            &app_state.handle,
            &id,
        );
        match app_state
            .camera_feed
            .ask(feeds::camera::SetInput { id, settings })
            .await
        {
            Ok(ready_future) => {
                if let Err(err) = ready_future.await {
                    error!("Camera failed to initialize: {err}");
                    return;
                }
            }
            Err(err) => {
                error!("Failed to send SetInput to camera feed: {err}");
                return;
            }
        }

        app_state.camera_in_use = true;
        app_state.camera_cleanup_done = false;
    }
}

pub(crate) async fn restore_main_window_inputs(app: &AppHandle) {
    let Some(state) = app.try_state::<ArcLock<App>>() else {
        warn!("App state unavailable while restoring main window inputs");
        return;
    };

    let should_restore = state
        .try_read()
        .map(|state| !state.is_recording_active_or_pending())
        .unwrap_or(false);

    if !should_restore {
        return;
    }

    let settings = crate::recording_settings::RecordingSettingsStore::get(app)
        .ok()
        .flatten()
        .unwrap_or_default();
    let stored_camera_id = settings.camera_id.clone();

    if let Err(err) = crate::set_mic_input(state.clone(), settings.mic_name).await {
        warn!("Failed to restore microphone input for main window: {err}");
    }

    let Some(operation_lock) = app.try_state::<crate::CameraWindowOperationLock>() else {
        warn!("CameraWindowOperationLock unavailable while restoring main window inputs");
        return;
    };
    let operation_guard = operation_lock.lock().await;

    let camera_to_restore = state
        .try_read()
        .map(|s| {
            if !s.camera_cleanup_done && !s.camera_in_use {
                s.selected_camera_id
                    .clone()
                    .or_else(|| stored_camera_id.clone())
            } else {
                None
            }
        })
        .unwrap_or(None);

    if let Some(camera_id) = camera_to_restore {
        emit_camera_preview_clear(app);
        let settings =
            crate::recording_settings::RecordingSettingsStore::camera_settings_for(app, &camera_id);

        let (camera_feed, camera_ws_sender, native_sender) = {
            let app_state = &mut *state.write().await;
            app_state.selected_camera_id = Some(camera_id.clone());
            app_state.camera_in_use = true;
            app_state.camera_cleanup_done = false;
            #[allow(deprecated)]
            (
                app_state.camera_feed.clone(),
                app_state.camera_ws_sender.clone(),
                app_state.camera_preview.sender(),
            )
        };

        if let Some(sender) = native_sender {
            #[allow(deprecated)]
            let _ = camera_feed
                .ask(feeds::camera::RemoveSender(camera_ws_sender))
                .await;
            if let Err(err) = sender.attach(&camera_feed).await {
                warn!(error = %err, "Failed to add native preview camera sender");
            }
        } else {
            #[allow(deprecated)]
            let _ = camera_feed
                .ask(feeds::camera::AddSender(camera_ws_sender))
                .await;
        }

        let mut showed_camera_window = false;
        let mut attempts = 0;
        let init_result: Result<(), String> = loop {
            attempts += 1;
            let request = camera_feed
                .ask(feeds::camera::SetInput {
                    id: camera_id.clone(),
                    settings,
                })
                .await
                .map_err(|e| e.to_string());

            if !showed_camera_window {
                showed_camera_window = true;
                crate::show_camera_window_unlocked(app);
            }

            match request {
                Ok(future) => match future.await {
                    Ok(_) => {
                        emit_camera_preview_clear(app);
                        break Ok(());
                    }
                    Err(e) => {
                        if attempts == 1 {
                            emit_camera_preview_error(
                                app,
                                camera_preview_error_message(&e.to_string()),
                            );
                        }
                        if attempts >= 3 {
                            break Err(format!(
                                "Failed to restore camera after {attempts} attempts: {e}"
                            ));
                        }
                        warn!("Camera restore attempt {attempts} failed: {e}. Retrying...");
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                },
                Err(e) => {
                    if attempts >= 3 {
                        break Err(e);
                    }
                    warn!("Camera restore attempt {attempts} failed: {e}. Retrying...");
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        };

        drop(operation_guard);

        match init_result {
            Ok(()) => crate::restore_camera_window(app),
            Err(error) => {
                let message = camera_preview_error_message(&error);
                warn!("Failed to restore camera input for main window: {error}");
                let _ = camera_feed.ask(feeds::camera::RemoveInput).await;
                let emit_input_lost = {
                    let app_state = &mut *state.write().await;
                    app_state.selected_camera_id = None;
                    app_state.camera_in_use = false;
                    app_state
                        .disconnected_inputs
                        .insert(RecordingInputKind::Camera)
                };
                crate::show_camera_window_unlocked(app);
                if emit_input_lost {
                    let _ = RecordingEvent::InputLost {
                        input: RecordingInputKind::Camera,
                    }
                    .emit(app);
                }
                emit_camera_preview_error(app, message.clone());
                crate::notify_user(app, "Camera unavailable", &message, true);
            }
        }
    }
}

pub(crate) async fn cleanup_camera_window(
    app: &AppHandle,
    window: Option<&WebviewWindow>,
    #[allow(unused_variables)] reset_panel: bool,
    wait_for_removal: bool,
) -> bool {
    use crate::CameraWindowCloseGate;

    #[cfg(target_os = "macos")]
    if reset_panel {
        let panel_manager = app.state::<PanelManager>();
        panel_manager.force_reset(PanelWindowType::Camera).await;
    }

    app.state::<CameraWindowCloseGate>().set_allow_close(true);

    #[cfg(target_os = "macos")]
    {
        let panel_labels = window
            .map(|window| vec![window.label().to_string()])
            .unwrap_or_else(|| camera_window_labels(app));
        let (panel_close_tx, panel_close_rx) = tokio::sync::oneshot::channel();
        let app_for_close = app.clone();
        app.run_on_main_thread(move || {
            use tauri_nspanel::ManagerExt;
            for label in panel_labels {
                if let Ok(panel) = app_for_close.get_webview_panel(&label) {
                    panel.released_when_closed(false);
                    panel.close();
                }
            }
            let _ = panel_close_tx.send(());
        })
        .ok();
        let _ = tokio::time::timeout(std::time::Duration::from_millis(500), panel_close_rx).await;
    }

    let windows = window
        .cloned()
        .map(|window| vec![window])
        .unwrap_or_else(|| camera_webview_windows(app));
    for window in windows {
        let destroy_rx = destroy_camera_window_handle(app, window);
        let _ = tokio::time::timeout(std::time::Duration::from_millis(500), destroy_rx).await;
    }

    if wait_for_removal {
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(2000);
        while start.elapsed() < timeout && !camera_webview_windows(app).is_empty() {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    let still_exists = !camera_webview_windows(app).is_empty();
    app.state::<CameraWindowCloseGate>().set_allow_close(false);

    !still_exists
}

/// An editor is a full-screen workspace, not a companion to the launcher, so
/// the main window steps aside while one is open and comes back when the last
/// one closes. Hidden rather than closed: the same window is reused, keeping
/// its React state and avoiding a rebuild on every editor round trip.
pub(crate) fn hide_main_window_for_editor(app: &AppHandle) {
    if let Some(main) = WindowId::Main.get(app) {
        let _ = main.hide();
    }
}

static SETTINGS_ORIGIN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub(crate) fn remember_settings_origin(app: &AppHandle) {
    let mut origin = SETTINGS_ORIGIN
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if origin.is_some() {
        return;
    }
    let settings_label = WindowId::Settings.to_string();
    if let Some(window) = app
        .webview_windows()
        .into_values()
        .find(|window| window.label() != settings_label && window.is_focused().unwrap_or(false))
    {
        *origin = Some(window.label().to_owned());
        let _ = window.hide();
    }
}

pub(crate) fn restore_main_window_after_settings(app: &AppHandle) {
    let origin = SETTINGS_ORIGIN
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take();
    if crate::app_is_exiting(app) {
        return;
    }

    let recording = app
        .try_state::<ArcLock<App>>()
        .and_then(|state| {
            state
                .try_read()
                .ok()
                .map(|s| s.is_recording_active_or_pending())
        })
        .unwrap_or(false);

    if recording {
        return;
    }

    if let Some(window) = origin.and_then(|label| app.get_webview_window(&label)) {
        if let Err(err) = window.show().and_then(|()| window.set_focus()) {
            error!(?err, "Failed to restore window after closing settings");
        }
    }
}

/// Counterpart to [`hide_main_window_for_editor`], called when an editor
/// window is destroyed. `closing_label` is excluded because a window is still
/// listed in `webview_windows()` while its own Destroyed event runs.
pub(crate) fn restore_main_window_after_editor(app: &AppHandle, closing_label: &str) {
    let another_editor_open = app.webview_windows().keys().any(|label| {
        label != closing_label
            && matches!(
                WindowId::from_str(label),
                Ok(WindowId::Editor | WindowId::ScreenshotEditor)
            )
    });

    if another_editor_open {
        return;
    }

    // A recording hides the main window on purpose (recording.rs) — closing an
    // editor mid-recording must not pop it back over the capture.
    let recording = app
        .try_state::<ArcLock<App>>()
        .and_then(|state| {
            state
                .try_read()
                .ok()
                .map(|s| s.is_recording_active_or_pending())
        })
        .unwrap_or(false);

    if recording {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::captions::release_ml_models().await;

        if let Err(err) = (ShowQuiroWindow::Main {
            init_target_mode: None,
        })
        .show(&app)
        .await
        {
            error!(
                ?err,
                "Failed to restore main window after closing an editor"
            );
        }
    });
}
