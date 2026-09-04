mod audio_meter;
mod camera;
mod camera_commands;
mod camera_legacy;
mod clip_thumbnails;
mod capture;
mod capture_targets;
mod crash_sentinel;
mod devices;
mod diagnostics;
mod editor;
mod export;
mod exit_shutdown;
mod fake_window;
mod fonts;
pub mod frame_ws;
mod general_settings;
mod gpu_context;
mod hotkeys;
mod import;
mod library;
mod permissions;
mod presets;
mod platform;
mod power_observer;
mod recording;
mod recording_settings;
mod screenshot_editor;
mod target_select_overlay;
mod three_spike;
mod tray;
mod window_exclusion;
mod windows;

use std::{
    collections::HashSet,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use camera::{CameraPreviewManager, CameraPreviewSender, CameraPreviewState};
use kameo::{Actor, actor::ActorRef};
use quiro_recording::{
    RecordingMode,
    feeds::{
        self,
        camera::{CameraFeed, DeviceOrModelID},
        microphone::{self, MicrophoneFeed},
    },
    sources::screen_capture::ScreenCaptureTarget,
};
use recording::{RecordingEvent, RecordingInputKind};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use tauri_specta::Event;
use tokio::sync::{Mutex, RwLock};
use tracing::{error, info, warn};
use windows::{ShowQuiroWindow, WindowId};

// ---------------------------------------------------------------------------
// Shared state aliases
// ---------------------------------------------------------------------------

pub type ArcLock<T> = Arc<RwLock<T>>;
pub type MutableState<'a, T> = State<'a, Arc<RwLock<T>>>;

/// Serialises camera-window open/close/reconfigure so a show and a teardown
/// can't interleave and leave an orphaned webview behind.
pub type CameraWindowOperationLock = Mutex<()>;

/// Lets the camera window's own close handler distinguish a deliberate
/// teardown (allowed) from the user clicking the OS close button (ignored, so
/// the preview keeps running).
pub struct CameraWindowCloseGate(AtomicBool);

impl Default for CameraWindowCloseGate {
    fn default() -> Self {
        Self(AtomicBool::new(false))
    }
}

impl CameraWindowCloseGate {
    pub fn allow_close(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    pub fn set_allow_close(&self, value: bool) {
        self.0.store(value, Ordering::Release);
    }
}

pub struct AppExitState(AtomicBool);

impl Default for AppExitState {
    fn default() -> Self {
        Self(AtomicBool::new(false))
    }
}

impl AppExitState {
    pub fn begin(&self) -> bool {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn is_exiting(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

pub struct MainWindowReadyState(AtomicBool);

impl Default for MainWindowReadyState {
    fn default() -> Self {
        Self(AtomicBool::new(false))
    }
}

impl MainWindowReadyState {
    pub fn is_ready(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    pub fn set_ready(&self, value: bool) {
        self.0.store(value, Ordering::Release);
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Programmatic camera-window moves (recentering, shape changes) also fire the
/// window's `Moved` event. This guard marks a short window during which those
/// events must not be persisted as a user-chosen position.
#[derive(Debug)]
pub struct CameraWindowPositionGuard {
    ignore_until_ms: AtomicU64,
}

impl Default for CameraWindowPositionGuard {
    fn default() -> Self {
        Self {
            ignore_until_ms: AtomicU64::new(0),
        }
    }
}

impl CameraWindowPositionGuard {
    pub fn ignore_for(&self, duration_ms: u64) {
        let now = now_millis();
        let until = now.saturating_add(duration_ms);
        self.ignore_until_ms.store(until, Ordering::Release);
    }

    pub fn should_ignore(&self) -> bool {
        let now = now_millis();
        now < self.ignore_until_ms.load(Ordering::Acquire)
    }
}

pub(crate) fn app_is_exiting(app: &AppHandle) -> bool {
    match app.try_state::<AppExitState>() {
        Some(state) => state.is_exiting(),
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[derive(Deserialize, Serialize, Type, tauri_specta::Event, Debug, Clone)]
pub struct RequestSetTargetMode {
    pub target_mode: Option<recording_settings::RecordingTargetMode>,
    pub display_id: Option<String>,
}

#[derive(Deserialize, Serialize, Type, tauri_specta::Event, Debug, Clone)]
pub struct RequestScreenCapturePrewarm {
    #[serde(default)]
    pub force: bool,
}

#[derive(Deserialize, Serialize, Type, tauri_specta::Event, Debug, Clone)]
pub struct NewNotification {
    pub title: String,
    pub body: String,
    pub is_error: bool,
}

/// Single path every recording/capture lifecycle notice goes through.
///
/// Emits `NewNotification` for any window that cares to listen (nothing does
/// today, but the event is cheap and already specta-registered), and — the
/// part that actually reaches the user — shows a native OS notification.
/// That's the part these calls were missing entirely before: an in-app toast
/// would need a window to show it in, but the one window most of these fire
/// from (the main window) is hidden for the entire length of a recording, so
/// an in-app toast would go unseen until the recording ends, if it survived
/// that long at all. Respects `enable_notifications`, defaulting to on to
/// match `GeneralSettingsStore`'s own default.
pub(crate) fn notify_user(app: &AppHandle, title: &str, body: &str, is_error: bool) {
    let _ = NewNotification {
        title: title.to_string(),
        body: body.to_string(),
        is_error,
    }
    .emit(app);

    let enabled = general_settings::GeneralSettingsStore::get(app)
        .ok()
        .flatten()
        .map_or(true, |settings| settings.enable_notifications);
    if !enabled {
        return;
    }

    use tauri_plugin_notification::NotificationExt;
    if let Err(err) = app.notification().builder().title(title).body(body).show() {
        warn!(%err, "Failed to show OS notification");
    }
}

#[derive(Deserialize, Serialize, Type, tauri_specta::Event, Debug, Clone)]
pub struct CurrentRecordingChanged;

/// Emitted once a screenshot is fully written to disk, so an open library
/// view can refresh instead of polling for new files.
#[derive(Deserialize, Serialize, Type, tauri_specta::Event, Debug, Clone)]
pub struct NewScreenshotAdded {
    pub path: std::path::PathBuf,
}

/// Emitted when Escape is pressed while a target-select overlay is open. The
/// overlays are transparent, click-through-ish windows that may not hold
/// keyboard focus, so Escape is caught as a global shortcut in Rust (see
/// `WindowFocusManager::register_escape`) rather than as a DOM keydown.
#[derive(Deserialize, Serialize, Type, tauri_specta::Event, Debug, Clone)]
pub struct OnEscapePress;

// ---------------------------------------------------------------------------
// Camera preview error plumbing
// ---------------------------------------------------------------------------

const CAMERA_PREVIEW_ERROR_EVENT: &str = "camera-preview-error";
const CAMERA_PREVIEW_CLEAR_EVENT: &str = "camera-preview-clear";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CameraPreviewErrorPayload {
    title: String,
    message: String,
}

pub(crate) fn camera_preview_error_message(err: &str) -> String {
    if err.contains("DeviceNotFound") {
        return "This camera is no longer available. Check that it is connected and allowed by system permissions.".to_string();
    }

    if err.contains("CameraTimeout") {
        return "No frames were received from this camera. It may be closed, disconnected, covered, or in use by another app.".to_string();
    }

    if err.contains("StartCapturing") {
        return "The system could not start this camera. It may be unavailable or in use by another app.".to_string();
    }

    if err.contains("InvalidFormat") {
        return "This camera did not report a usable capture format.".to_string();
    }

    "The selected camera could not be started. Choose another camera or reconnect this one."
        .to_string()
}

pub(crate) fn emit_camera_preview_error(app_handle: &AppHandle, message: String) {
    let _ = app_handle.emit(
        CAMERA_PREVIEW_ERROR_EVENT,
        CameraPreviewErrorPayload {
            title: "Camera unavailable".to_string(),
            message,
        },
    );
}

pub(crate) fn emit_camera_preview_clear(app_handle: &AppHandle) {
    let _ = app_handle.emit(CAMERA_PREVIEW_CLEAR_EVENT, ());
}

async fn add_camera_preview_ws_sender(
    camera_feed: &ActorRef<CameraFeed>,
    sender: flume::Sender<quiro_recording::FFmpegVideoFrame>,
) {
    if let Err(err) = camera_feed.ask(feeds::camera::AddSender(sender)).await {
        warn!(error = %err, "Failed to add WebSocket camera sender");
    }
}

async fn remove_camera_preview_ws_sender(
    camera_feed: &ActorRef<CameraFeed>,
    sender: flume::Sender<quiro_recording::FFmpegVideoFrame>,
) {
    if let Err(err) = camera_feed.ask(feeds::camera::RemoveSender(sender)).await {
        warn!(error = %err, "Failed to remove WebSocket camera sender");
    }
}

/// Keeps exactly one preview consumer attached to the camera feed: either the
/// native (wgpu) preview or the legacy websocket one, never both.
async fn sync_camera_preview_sender(
    camera_feed: &ActorRef<CameraFeed>,
    camera_ws_sender: flume::Sender<quiro_recording::FFmpegVideoFrame>,
    camera_preview_sender: Option<CameraPreviewSender>,
    use_ws_preview: bool,
) {
    if use_ws_preview {
        if let Some(sender) = camera_preview_sender
            && let Err(err) = sender.detach(camera_feed).await
        {
            warn!(error = %err, "Failed to remove native preview camera sender");
        }

        add_camera_preview_ws_sender(camera_feed, camera_ws_sender).await;
    } else if let Some(sender) = camera_preview_sender {
        if let Err(err) = sender.attach(camera_feed).await {
            warn!(error = %err, "Failed to add native preview camera sender");
        }
        remove_camera_preview_ws_sender(camera_feed, camera_ws_sender).await;
    } else {
        add_camera_preview_ws_sender(camera_feed, camera_ws_sender).await;
    }
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

/// Mirrors the recorder's lifecycle for the windowing layer. The encoder-owning
/// half lives in `recording::RecordingSession`; this half is what every window
/// decision (occluders, content protection, camera release) reads, so it only
/// carries the capture target.
#[derive(Debug, Clone)]
pub enum RecordingState {
    None,
    Pending {
        mode: RecordingMode,
        target: ScreenCaptureTarget,
    },
    Active {
        target: ScreenCaptureTarget,
    },
}

pub struct App {
    #[deprecated = "can be removed when native camera preview is ready"]
    pub camera_ws_port: u16,
    #[deprecated = "can be removed when native camera preview is ready"]
    pub camera_ws_sender: flume::Sender<quiro_recording::FFmpegVideoFrame>,
    pub camera_preview: CameraPreviewManager,
    pub camera_preview_state_tx: tokio::sync::watch::Sender<CameraPreviewState>,
    pub handle: AppHandle,
    pub recording_state: RecordingState,
    pub mic_feed: ActorRef<MicrophoneFeed>,
    pub mic_meter_sender: flume::Sender<microphone::MicrophoneSamples>,
    pub selected_mic_label: Option<String>,
    pub selected_camera_id: Option<DeviceOrModelID>,
    pub camera_in_use: bool,
    pub camera_cleanup_done: bool,
    pub camera_feed: ActorRef<CameraFeed>,
    pub disconnected_inputs: HashSet<RecordingInputKind>,
}

impl App {
    pub fn set_pending_recording(
        &mut self,
        mode: RecordingMode,
        target: ScreenCaptureTarget,
    ) -> Result<(), String> {
        if !matches!(self.recording_state, RecordingState::None) {
            return Err("Recording already in progress".to_string());
        }

        self.recording_state = RecordingState::Pending { mode, target };
        CurrentRecordingChanged.emit(&self.handle).ok();

        Ok(())
    }

    pub fn set_current_recording(&mut self, target: ScreenCaptureTarget) {
        self.recording_state = RecordingState::Active { target };
        CurrentRecordingChanged.emit(&self.handle).ok();
    }

    pub fn clear_pending_recording(&mut self) -> bool {
        if !matches!(self.recording_state, RecordingState::Pending { .. }) {
            return false;
        }

        self.recording_state = RecordingState::None;
        self.close_occluder_windows();
        crate::windows::apply_content_protection(&self.handle, false);
        if let Some(camera) = WindowId::Camera.get(&self.handle) {
            let _ = camera.set_content_protected(false);
        }
        CurrentRecordingChanged.emit(&self.handle).ok();

        true
    }

    pub fn clear_recording_state(&mut self) {
        self.recording_state = RecordingState::None;
        self.close_occluder_windows();
        crate::windows::apply_content_protection(&self.handle, false);
        CurrentRecordingChanged.emit(&self.handle).ok();
    }

    fn close_occluder_windows(&self) {
        for window in self.handle.webview_windows() {
            if window.0.starts_with("window-capture-occluder-") {
                let _ = window.1.close();
            }
        }
    }

    pub fn is_recording_active_or_pending(&self) -> bool {
        !matches!(self.recording_state, RecordingState::None)
    }

    pub fn capture_target(&self) -> Option<ScreenCaptureTarget> {
        match &self.recording_state {
            RecordingState::Pending { target, .. } | RecordingState::Active { target } => {
                Some(target.clone())
            }
            RecordingState::None => None,
        }
    }

    fn microphone_settings_for_label(
        &self,
        label: &str,
    ) -> Option<microphone::MicrophoneDeviceSettings> {
        recording_settings::RecordingSettingsStore::microphone_settings_for(&self.handle, label)
    }

    fn camera_settings_for_id(
        &self,
        id: &DeviceOrModelID,
    ) -> Option<feeds::camera::CameraDeviceSettings> {
        recording_settings::RecordingSettingsStore::camera_settings_for(&self.handle, id)
    }

    /// The microphone actor stops itself on an unrecoverable device error, so
    /// every path that needs it alive respawns it and re-applies the selection
    /// rather than silently recording silence.
    async fn restart_mic_feed(&mut self) -> Result<(), String> {
        info!("Restarting microphone feed after actor shutdown");

        let (error_tx, error_rx) = flume::bounded(1);
        let mic_feed = MicrophoneFeed::spawn(MicrophoneFeed::new(error_tx));

        spawn_mic_error_handler(self.handle.clone(), error_rx);

        mic_feed
            .ask(microphone::AddSender(self.mic_meter_sender.clone()))
            .await
            .map_err(|e| e.to_string())?;

        if let Some(label) = self.selected_mic_label.clone() {
            let settings = self.microphone_settings_for_label(&label);
            match mic_feed.ask(microphone::SetInput { label, settings }).await {
                Ok(ready) => {
                    if let Err(err) = ready.await {
                        if matches!(err, microphone::SetInputError::DeviceNotFound) {
                            warn!("Selected microphone not available while restarting feed");
                        } else {
                            return Err(err.to_string());
                        }
                    }
                }
                Err(kameo::error::SendError::HandlerError(
                    microphone::SetInputError::DeviceNotFound,
                )) => {
                    warn!("Selected microphone not available while restarting feed");
                }
                Err(err) => return Err(err.to_string()),
            }
        }

        self.mic_feed = mic_feed;

        Ok(())
    }

    async fn ensure_mic_feed_alive(&mut self) -> Result<(), String> {
        if self.mic_feed.is_alive() {
            return Ok(());
        }

        self.restart_mic_feed().await
    }

    async fn ensure_selected_mic_ready(&mut self) -> Result<(), String> {
        self.ensure_mic_feed_alive().await?;

        if let Some(label) = self.selected_mic_label.clone() {
            let settings = self.microphone_settings_for_label(&label);
            let ready = self
                .mic_feed
                .ask(microphone::SetInput { label, settings })
                .await
                .map_err(|e| e.to_string())?;

            ready.await.map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    async fn ensure_selected_camera_ready(&mut self) -> Result<(), String> {
        if let Some(id) = self.selected_camera_id.clone() {
            let settings = self.camera_settings_for_id(&id);
            let ready = self
                .camera_feed
                .ask(feeds::camera::SetInput {
                    id: id.clone(),
                    settings,
                })
                .await
                .map_err(|e| e.to_string())?;

            ready.await.map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    async fn handle_input_disconnect(&mut self, kind: RecordingInputKind) -> Result<(), String> {
        if !self.disconnected_inputs.insert(kind) {
            return Ok(());
        }

        let (title, body) = match kind {
            RecordingInputKind::Microphone => (
                "Microphone disconnected",
                "Recording continues. Silence will be used until the microphone reconnects.",
            ),
            RecordingInputKind::Camera => (
                "Camera disconnected",
                "Recording continues without camera. Camera overlay will resume when the device reconnects.",
            ),
        };

        notify_user(&self.handle, title, body, false);

        let _ = RecordingEvent::InputLost { input: kind }.emit(&self.handle);

        Ok(())
    }

    async fn handle_input_restored(&mut self, kind: RecordingInputKind) -> Result<(), String> {
        if !self.disconnected_inputs.remove(&kind) {
            return Ok(());
        }

        match kind {
            RecordingInputKind::Microphone => {
                self.ensure_selected_mic_ready().await.ok();
            }
            RecordingInputKind::Camera => match self.ensure_selected_camera_ready().await {
                Ok(()) => {
                    info!("Camera reconnected and reinitialized successfully");
                    notify_user(
                        &self.handle,
                        "Camera reconnected",
                        "Camera overlay has been restored.",
                        false,
                    );
                }
                Err(e) => {
                    warn!(error = %e, "Failed to reinitialize camera after reconnect, will retry on next poll");
                    self.disconnected_inputs.insert(RecordingInputKind::Camera);
                    return Ok(());
                }
            },
        }

        let _ = RecordingEvent::InputRestored { input: kind }.emit(&self.handle);

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Input selection commands
// ---------------------------------------------------------------------------

/// Tauri's `generate_handler!` re-imports each command's generated items into
/// the module that invokes it, which collides when the command is defined in
/// that same module — so these live one level down.
pub mod input_commands {
    use super::*;

#[tauri::command]
#[specta::specta]
pub async fn set_mic_input(
    state: MutableState<'_, App>,
    label: Option<String>,
) -> Result<(), String> {
    let desired_label = label;

    let (mic_feed, previous_label, app_handle) = {
        let mut app = state.write().await;
        app.ensure_mic_feed_alive().await?;

        if desired_label == app.selected_mic_label {
            if desired_label.is_some() && !matches!(app.recording_state, RecordingState::Active { .. })
            {
                app.ensure_selected_mic_ready().await?;
            }
            return Ok(());
        }

        let previous_label = app.selected_mic_label.clone();
        app.selected_mic_label = desired_label.clone();

        (app.mic_feed.clone(), previous_label, app.handle.clone())
    };

    let apply_result = async {
        match desired_label.as_ref() {
            None => {
                mic_feed
                    .ask(microphone::RemoveInput)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            Some(label) => {
                let settings = recording_settings::RecordingSettingsStore::microphone_settings_for(
                    &app_handle,
                    label,
                );
                mic_feed
                    .ask(microphone::SetInput {
                        label: label.clone(),
                        settings,
                    })
                    .await
                    .map_err(|e| e.to_string())?
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }

        Ok::<(), String>(())
    }
    .await;

    match apply_result {
        Ok(()) => {
            let mut app = state.write().await;
            let cleared = app
                .disconnected_inputs
                .remove(&RecordingInputKind::Microphone);

            if cleared {
                let _ = RecordingEvent::InputRestored {
                    input: RecordingInputKind::Microphone,
                }
                .emit(&app.handle);
            }

            Ok(())
        }
        Err(err) => {
            let mut app = state.write().await;
            if app.selected_mic_label == desired_label {
                app.selected_mic_label = previous_label;
            }
            Err(err)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn set_camera_input(
    app_handle: AppHandle,
    state: MutableState<'_, App>,
    id: Option<DeviceOrModelID>,
    skip_camera_window: Option<bool>,
) -> Result<(), String> {
    let operation_lock = app_handle.state::<CameraWindowOperationLock>();
    let _operation_guard = operation_lock.lock().await;

    let (camera_feed, current_id, camera_in_use) = {
        let app = state.read().await;
        (
            app.camera_feed.clone(),
            app.selected_camera_id.clone(),
            app.camera_in_use,
        )
    };

    let skip_camera_window = skip_camera_window.unwrap_or(false);
    let camera_window_is_visible = WindowId::Camera
        .get(&app_handle)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if id == current_id && camera_in_use && !skip_camera_window {
        if !camera_window_is_visible {
            ShowQuiroWindow::Camera { centered: false }
                .show(&app_handle)
                .await
                .map(|_| ())
                .map_err(|err| error!("Failed to show camera preview window: {err}"))
                .ok();
        }

        return Ok(());
    }

    match &id {
        None => {
            let shutdown_rx = {
                let app = &mut *state.write().await;
                app.camera_in_use = false;
                app.selected_camera_id = None;
                app.camera_cleanup_done = true;
                if skip_camera_window {
                    app.camera_preview.begin_shutdown()
                } else {
                    app.camera_preview.pause();
                    None
                }
            };

            camera_feed
                .ask(feeds::camera::RemoveInput)
                .await
                .map_err(|e| e.to_string())?;

            if let Some(rx) = shutdown_rx {
                let _ = tokio::time::timeout(Duration::from_millis(500), rx).await;
            }

            if !skip_camera_window
                && let Some(window) = WindowId::Camera.get(&app_handle)
            {
                let _ = window.hide();
            }
        }
        Some(id) => {
            emit_camera_preview_clear(&app_handle);
            let settings =
                recording_settings::RecordingSettingsStore::camera_settings_for(&app_handle, id);

            let (camera_ws_sender, camera_preview_sender, use_ws_preview) = {
                let app = &mut *state.write().await;
                let use_ws_preview = !(camera_window_is_visible
                    && app.camera_preview.is_initialized()
                    && !app.camera_preview.is_paused());
                app.selected_camera_id = Some(id.clone());
                app.camera_in_use = true;
                app.camera_cleanup_done = false;
                #[allow(deprecated)]
                (
                    app.camera_ws_sender.clone(),
                    app.camera_preview.sender(),
                    use_ws_preview,
                )
            };

            sync_camera_preview_sender(
                &camera_feed,
                camera_ws_sender,
                camera_preview_sender,
                use_ws_preview,
            )
            .await;

            if !skip_camera_window {
                show_camera_window_unlocked(&app_handle);
            }

            let result = camera_feed
                .ask(feeds::camera::SetInput {
                    id: id.clone(),
                    settings,
                })
                .await
                .map_err(|e| e.to_string());

            match result {
                Ok(ready) => match ready.await {
                    Ok(_) => emit_camera_preview_clear(&app_handle),
                    Err(e) => {
                        let message = camera_preview_error_message(&e.to_string());
                        emit_camera_preview_error(&app_handle, message);
                        return Err(e.to_string());
                    }
                },
                Err(e) => {
                    let message = camera_preview_error_message(&e);
                    emit_camera_preview_error(&app_handle, message);
                    return Err(e);
                }
            }
        }
    }

    Ok(())
}

}

pub(crate) use input_commands::set_mic_input;

// ---------------------------------------------------------------------------
// Window helpers used across modules
// ---------------------------------------------------------------------------

pub(crate) fn spawn_on_runtime<F>(future: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => {
            handle.spawn(future);
        }
        Err(err) => {
            warn!(error = %err, "No tokio runtime available; dropping background task");
        }
    }
}

pub(crate) fn panic_payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "<non-string panic payload>".to_string()
    }
}

/// Opens the camera window without taking `CameraWindowOperationLock` — callers
/// that already hold it would otherwise deadlock.
pub(crate) fn show_camera_window_unlocked(app: &AppHandle) {
    let app = app.clone();
    spawn_on_runtime(async move {
        let _ = ShowQuiroWindow::Camera { centered: false }.show(&app).await;
    });
}

pub(crate) fn restore_camera_window(app: &AppHandle) {
    let should_restore_camera = app
        .try_state::<ArcLock<App>>()
        .and_then(|state| {
            state
                .try_read()
                .ok()
                .map(|state| state.selected_camera_id.is_some() && !state.camera_cleanup_done)
        })
        .unwrap_or(false);

    if should_restore_camera {
        let app = app.clone();
        spawn_on_runtime(async move {
            let Some(operation_lock) = app.try_state::<CameraWindowOperationLock>() else {
                warn!("Camera window operation lock unavailable during restore");
                return;
            };
            let _operation_guard = operation_lock.lock().await;
            let _ = ShowQuiroWindow::Camera { centered: false }.show(&app).await;
        });
    }
}

pub(crate) fn restore_main_window_inputs(app: &AppHandle) {
    let handle = app.clone();
    spawn_on_runtime(async move {
        windows::restore_main_window_inputs(&handle).await;
    });
}

/// Waking from sleep invalidates capture sessions and device handles; give the
/// OS a moment to settle, then ask the frontend to re-prewarm screen capture.
pub(crate) fn schedule_resume_recovery(app_handle: AppHandle) {
    spawn_on_runtime(async move {
        if app_is_exiting(&app_handle) {
            return;
        }

        tokio::time::sleep(Duration::from_millis(500)).await;

        if app_is_exiting(&app_handle) {
            return;
        }

        let _ = RequestScreenCapturePrewarm { force: true }.emit(&app_handle);
    });
}

// ---------------------------------------------------------------------------
// Device watchers
// ---------------------------------------------------------------------------

fn spawn_mic_error_handler(app: AppHandle, error_rx: flume::Receiver<cpal::StreamError>) {
    spawn_on_runtime(async move {
        while let Ok(error) = error_rx.recv_async().await {
            warn!(error = %error, "Microphone feed reported an error");

            if app_is_exiting(&app) {
                break;
            }

            let Some(state) = app.try_state::<ArcLock<App>>() else {
                continue;
            };

            let _ = state
                .write()
                .await
                .handle_input_disconnect(RecordingInputKind::Microphone)
                .await;
        }
    });
}

/// Polls the device lists so a camera/mic that vanishes mid-session surfaces as
/// an `InputLost` event (and an `InputRestored` when it comes back) instead of
/// silently producing nothing.
fn spawn_device_watchers(app: AppHandle) {
    spawn_on_runtime(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3));
        let mut last_snapshot: Option<devices::DevicesUpdated> = None;

        loop {
            interval.tick().await;

            if app_is_exiting(&app) {
                break;
            }

            let snapshot = tokio::task::spawn_blocking(devices::build_devices_snapshot)
                .await
                .unwrap_or_else(|_| devices::build_devices_snapshot());
            if last_snapshot.as_ref() != Some(&snapshot) {
                let _ = snapshot.clone().emit(&app);
                last_snapshot = Some(snapshot);
            }

            let Some(state) = app.try_state::<ArcLock<App>>() else {
                continue;
            };

            let (selected_mic, selected_camera) = {
                let guard = state.read().await;
                (
                    guard.selected_mic_label.clone(),
                    guard.selected_camera_id.clone(),
                )
            };

            if let Some(label) = selected_mic {
                let present = tokio::task::spawn_blocking(move || {
                    devices::list_audio_devices_blocking().contains(&label)
                })
                .await
                .unwrap_or(true);

                let mut guard = state.write().await;
                let _ = if present {
                    guard
                        .handle_input_restored(RecordingInputKind::Microphone)
                        .await
                } else {
                    guard
                        .handle_input_disconnect(RecordingInputKind::Microphone)
                        .await
                };
            }

            if selected_camera.is_some() {
                let present =
                    tokio::task::spawn_blocking(|| !devices::list_cameras_blocking().is_empty())
                        .await
                        .unwrap_or(true);

                let mut guard = state.write().await;
                let _ = if present {
                    guard.handle_input_restored(RecordingInputKind::Camera).await
                } else {
                    guard
                        .handle_input_disconnect(RecordingInputKind::Camera)
                        .await
                };
            }
        }
    });
}

// ---------------------------------------------------------------------------
// tauri-specta bindings
// ---------------------------------------------------------------------------

/// Writes `apps/desktop/src/utils/tauri.ts` from [`specta_bindings`], with
/// exactly the options `run()`'s own debug-build export uses — the two must
/// not drift, or regenerating by one route produces a diff against the
/// other.
///
/// Exists as a `pub fn` so `src/bin/export-bindings.rs` can call it:
/// normally these bindings only regenerate on a debug desktop launch, which
/// needs a window, a webview and a display. The `--lib` test that used to
/// serve this purpose cannot run in every environment (a test-harness binary
/// that fails at load with `STATUS_ENTRYPOINT_NOT_FOUND` while the app's own
/// binary starts fine), and a plain `[[bin]]` links the same way the working
/// app does.
///
/// Run it with:
/// `cargo run -p quiro-desktop --bin export-bindings`
pub fn export_typescript_bindings() -> Result<(), Box<dyn std::error::Error>> {
    // Anchored to this crate's own directory, not the working directory:
    // `cargo run --bin export-bindings` runs from the workspace root, where
    // a relative `../src/...` resolves outside the repository entirely and
    // silently writes a file nobody is looking at.
    let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/utils/tauri.ts")
        .to_string_lossy()
        .into_owned();

    specta_bindings().export(
        specta_typescript::Typescript::default()
            .bigint(specta_typescript::BigIntExportBehavior::Number)
            // specta always emits its TAURI_CHANNEL import, which is only
            // referenced when some command actually takes a Channel — none
            // of Quiro's do, so tsconfig's `noUnusedLocals` fails the
            // production build on a generated file nobody can hand-edit.
            .header("// @ts-nocheck\n"),
        out,
    )?;
    Ok(())
}

/// Single source of truth for the frontend's `apps/desktop/src/utils/tauri.ts`
/// bindings — every command/event registered here is what actually gets
/// exported (in debug builds, see `run()`) and wired into the invoke handler.
/// Add a command here when you register it, not just in `generate_handler!`.
fn specta_bindings() -> tauri_specta::Builder {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            capture::take_screenshot,
            capture_targets::list_capture_displays,
            capture_targets::list_capture_windows,
            capture_targets::list_displays_with_thumbnails,
            capture_targets::list_windows_with_thumbnails,
            recording::start_recording,
            recording::stop_recording,
            recording::pause_recording,
            recording::resume_recording,
            recording::discard_recording,
            recording::restart_recording,
            recording::set_recording_mic_muted,
            recording::toggle_pause_recording,
            hotkeys::set_hotkey,
            hotkeys::get_hotkeys,
            editor::create_editor_instance,
            editor::start_playback,
            editor::stop_playback,
            editor::set_playhead_position,
            editor::start_frame_stream,
            editor::set_project_config,
            editor::update_project_config_in_memory,
            editor::get_editor_meta,
            editor::get_mic_waveforms,
            editor::get_system_audio_waveforms,
            editor::get_display_frame_for_cropping,
            clip_thumbnails::get_clip_thumbnail,
            editor::get_editor_project_path,
            editor::set_pretty_name,
            editor::generate_zoom_segments_from_clicks,
            editor::generate_keyboard_segments,
            editor::delete_editor_project,
            export::export_video,
            export::export_video_to_file,
            export::cancel_export,
            export::get_export_estimates,
            export::generate_export_preview,
            three_spike::spike_begin_capture,
            three_spike::spike_write_chunk,
            three_spike::spike_finish_capture,
            screenshot_editor::create_screenshot_editor_instance,
            screenshot_editor::update_screenshot_config,
            screenshot_editor::prewarm_screenshot_background,
            screenshot_editor::recognize_screenshot_text,
            screenshot_editor::render_screenshot_for_export,
            screenshot_editor::render_screenshot_project_for_export,
            screenshot_editor::measure_text,
            screenshot_editor::font_face_bytes,
            fonts::list_font_families,
            fonts::google_font_catalog,
            fonts::install_google_font,
            permissions::do_permissions_check,
            permissions::open_permission_settings,
            permissions::request_permission,
            devices::list_cameras,
            devices::list_audio_devices,
            devices::get_camera_formats,
            devices::get_microphone_info,
            devices::get_devices_snapshot,
            import::import_video,
            import::import_screenshot,
            library::list_recordings,
            library::list_screenshots,
            diagnostics::get_system_diagnostics,
            diagnostics::get_logs_dir,
            general_settings::get_default_excluded_windows,
            recording_settings::set_recording_mode,
            target_select_overlay::get_window_icon,
            target_select_overlay::get_target_under_cursor,
            target_select_overlay::display_information,
            target_select_overlay::focus_window,
            target_select_overlay::open_target_select_overlays,
            target_select_overlay::close_target_select_overlays,
            fake_window::set_fake_window_bounds,
            fake_window::remove_fake_window,
            platform::perform_haptic_feedback,
            platform::is_system_audio_capture_supported,
            windows::set_theme,
            windows::position_traffic_lights,
            windows::set_teleprompter_window_level,
            windows::set_teleprompter_window_opacity,
            windows::refresh_window_content_protection,
            windows::set_window_transparent,
            windows::show_window,
            windows::is_camera_window_open,
            input_commands::set_mic_input,
            input_commands::set_camera_input,
            camera_commands::get_camera_preview_state,
            camera_commands::set_camera_preview_state,
            camera_commands::set_camera_window_position,
            camera_commands::ignore_camera_window_position,
            camera_commands::close_camera_window,
        ])
        .events(tauri_specta::collect_events![
            RecordingEvent,
            NewNotification,
            RequestSetTargetMode,
            RequestScreenCapturePrewarm,
            CurrentRecordingChanged,
            NewScreenshotAdded,
            OnEscapePress,
            hotkeys::RequestStartRecording,
            target_select_overlay::TargetUnderCursor,
            audio_meter::AudioInputLevelChange,
            devices::DevicesUpdated,
            editor::RenderFrameEvent,
            editor::EditorStateChanged,
            editor::FrameLayoutEvent,
        ])
        // No collected command's signature happens to reference these types
        // directly, so they need an explicit export or the frontend loses
        // them. Both stores are read/written by the frontend's store.ts
        // directly through tauri-plugin-store (same "store" file, same
        // key), not through a command — see general_settings.rs/
        // recording_settings.rs for the Rust side of that same data.
        .typ::<ScreenCaptureTarget>()
        .typ::<general_settings::GeneralSettingsStore>()
        .typ::<presets::PresetsStore>()
        .typ::<recording_settings::RecordingSettingsStore>()
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

/// Opens a Chrome DevTools Protocol endpoint on the WebView2 instance, so the
/// running app's webview can be inspected and driven from outside — reading the
/// preview canvas back, clicking through the editor, screenshotting a real
/// composition. Windows only: WebView2 is Chromium and speaks CDP, while
/// macOS's WKWebView does not.
///
/// **Debug builds only, by construction.** The whole function is compiled out
/// of release, because a CDP port grants full control of the webview — script
/// execution, DOM, storage — to anything that can reach localhost. It is a
/// development affordance and must never ship.
///
/// `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is read by the WebView2 loader when
/// it creates the environment, which happens the first time a window is built,
/// so this has to run before any of that. `QUIRO_CDP_PORT` overrides the port
/// for anyone who needs 9222 for something else.
#[cfg(all(debug_assertions, windows))]
fn enable_webview_remote_debugging() {
    const VAR: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

    // Respect an existing value rather than clobbering it — someone may have
    // set other WebView2 flags deliberately.
    if std::env::var_os(VAR).is_some() {
        return;
    }

    let port = std::env::var("QUIRO_CDP_PORT").unwrap_or_else(|_| "9222".to_string());

    // SAFETY: `set_var` is unsound only when another thread may be reading the
    // environment concurrently. This is the first statement of `run()`, before
    // Tauri, the runtime, or any of our own threads exist.
    unsafe {
        std::env::set_var(VAR, format!("--remote-debugging-port={port}"));
    }

    eprintln!("webview remote debugging enabled on http://127.0.0.1:{port} (debug build only)");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(debug_assertions, windows))]
    enable_webview_remote_debugging();

    // Populates the table `ffmpeg::Error`'s Display reads from. Without it
    // every named FFmpeg error formats as an empty string, so failures
    // surface to the user as a bare "FFmpeg error:" with nothing after it.
    if let Err(err) = ffmpeg::init() {
        warn!(?err, "Failed to initialise FFmpeg");
    }

    let specta_builder = specta_bindings();

    // Regenerated on every debug launch so the frontend's bindings can never
    // drift from what's actually registered below — release builds skip this
    // and just use the invoke handler.
    // One implementation, shared with `cargo run --bin export-bindings`, so
    // regenerating by either route produces the same file rather than a
    // diff against the other.
    #[cfg(debug_assertions)]
    export_typescript_bindings().expect("Failed to export typescript bindings");

    // Extracted before `specta_builder` moves into `.setup()` below — this
    // produces an owned handler closure that doesn't need the builder to
    // stay alive, so the two calls don't fight over ownership.
    let specta_invoke_handler = specta_builder.invoke_handler();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // The global-shortcut plugin now lives in `hotkeys::init` (called from
        // setup below) rather than here: it needs the hotkeys store to dispatch
        // user bindings, and that store isn't loadable until the app handle
        // exists. Escape still behaves exactly as it did.
        .manage(recording::RecordingSession::default())
        .setup(move |app| {
            // Required for any `.emit()` call on a tauri-specta Event type
            // (RecordingEvent, DevicesUpdated, ...) — without this it
            // panics at the first emit with "EventRegistry not found".
            specta_builder.mount_events(app);

            let app = app.handle().clone();

            general_settings::init(&app);

            // Only macOS ever prompts here (Windows/Linux report Granted with
            // no dialog) — spawned rather than requested inline so a
            // first-launch permission sheet can't delay the main window
            // appearing.
            {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_notification::NotificationExt;
                    let notification = app.notification();
                    if matches!(
                        notification.permission_state(),
                        Ok(tauri::plugin::PermissionState::Prompt)
                    ) {
                        let _ = notification.request_permission();
                    }
                });
            }

            let logs_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            let _ = std::fs::create_dir_all(&logs_dir);
            crash_sentinel::init(&logs_dir, env!("CARGO_PKG_VERSION"));

            camera::init_preview_profile(total_system_memory());

            tauri::async_runtime::block_on(async {
                let (camera_preview_state_tx, camera_preview_state_rx) =
                    tokio::sync::watch::channel(CameraPreviewState::default());
                let (camera_tx, camera_ws_port, _shutdown) =
                    camera_legacy::create_camera_preview_ws(camera_preview_state_rx).await;
                let camera_ws_sender = camera_tx.clone();

                let (mic_samples_tx, _mic_samples_rx) = flume::bounded(8);
                let mic_meter_sender = mic_samples_tx.clone();

                let camera_feed = CameraFeed::spawn(CameraFeed::default());
                let _ = camera_feed.ask(feeds::camera::AddSender(camera_tx)).await;

                let (mic_error_tx, mic_error_rx) = flume::bounded(1);
                let mic_feed = MicrophoneFeed::spawn(MicrophoneFeed::new(mic_error_tx));
                if let Err(err) = mic_feed.ask(microphone::AddSender(mic_samples_tx)).await {
                    error!("Failed to attach audio meter sender: {err}");
                }

                // The camera window hides itself when the device disappears —
                // an empty preview surface is worse than no window at all.
                {
                    let camera_feed = camera_feed.clone();
                    let app = app.clone();
                    let _ = camera_feed
                        .tell(feeds::camera::OnFeedDisconnect(Box::new(move || {
                            if app_is_exiting(&app) {
                                return;
                            }

                            if let Some(win) = WindowId::Camera.get(&app) {
                                win.hide().ok();
                            }
                        })))
                        .send()
                        .await;
                }

                let camera_preview = CameraPreviewManager::new(&app);
                let camera_session_id_handle = camera_preview.session_id_handle();

                #[allow(deprecated)]
                app.manage(Arc::new(RwLock::new(App {
                    camera_ws_port,
                    camera_ws_sender,
                    handle: app.clone(),
                    camera_preview,
                    camera_preview_state_tx,
                    recording_state: RecordingState::None,
                    mic_feed,
                    mic_meter_sender,
                    selected_mic_label: None,
                    selected_camera_id: None,
                    camera_in_use: false,
                    camera_cleanup_done: false,
                    camera_feed,
                    disconnected_inputs: HashSet::new(),
                })));

                app.manage(camera_session_id_handle);
                app.manage(CameraWindowCloseGate::default());
                app.manage(gpu_context::PendingScreenshots::default());
                app.manage(screenshot_editor::ScreenshotEditorPaths::default());
                // Before any window opens: a project referencing a
                // previously downloaded family has to render with it on the
                // first frame, not once the font picker happens to be
                // opened.
                fonts::load_installed_fonts(&app);
                app.manage(editor::EditorPaths::default());
                app.manage(three_spike::SpikeSink::default());
                app.manage(CameraWindowPositionGuard::default());
                app.manage(CameraWindowOperationLock::default());
                app.manage(AppExitState::default());
                app.manage(MainWindowReadyState::default());
                app.manage(target_select_overlay::WindowFocusManager::default());

                spawn_mic_error_handler(app.clone(), mic_error_rx);
                spawn_device_watchers(app.clone());
            });

            hotkeys::init(&app);

            power_observer::install(&app);

            app.listen_any("main-window-ready", {
                let app = app.clone();
                move |_| {
                    app.state::<MainWindowReadyState>().set_ready(true);
                    gpu_context::prewarm_gpu();
                }
            });

            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = (ShowQuiroWindow::Main {
                    init_target_mode: None,
                })
                .show(&handle)
                .await
                {
                    error!("Failed to show startup window: {err}");
                }
            });

            tray::create_tray(&app)?;

            Ok(())
        })
        .invoke_handler(specta_invoke_handler)
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            let tauri::RunEvent::ExitRequested { api, .. } = event else {
                return;
            };

            // Closing every window must not end the process — the tray icon
            // (see tray.rs) is the only way back in otherwise. Only a
            // deliberate quit (tray's "Quit") gets past this gate; every
            // other ExitRequested, which fires just as much when the last
            // window closes, is cancelled outright.
            if !tray::QUIT_REQUESTED.load(Ordering::Acquire) {
                api.prevent_exit();
                return;
            }

            // A real quit — but not mid-recording: killing the process
            // while a recording is still finalizing would corrupt or lose
            // it, so this is a two-phase exit (see exit_shutdown.rs).
            // AppExitState (already read by other shutdown-aware code, e.g.
            // the camera-disconnect handler above) doubles as this phase's
            // "cleanup started" flag.
            let export_active = app_handle
                .try_state::<ArcLock<App>>()
                .and_then(|state| {
                    state
                        .try_read()
                        .ok()
                        .map(|state| state.is_recording_active_or_pending())
                })
                .unwrap_or(true);
            let exit_state = app_handle.state::<AppExitState>();

            match exit_shutdown::handle_exit_requested(
                exit_state.is_exiting(),
                export_active,
                true,
                || api.prevent_exit(),
            ) {
                exit_shutdown::ExitRequestDecision::StartCleanup => {
                    exit_state.begin();
                    crash_sentinel::mark_clean_exit();
                    app_handle.exit(0);
                }
                exit_shutdown::ExitRequestDecision::ExportActive => {
                    tray::retry_exit_when_recording_stops(app_handle.clone());
                }
                exit_shutdown::ExitRequestDecision::AlreadyExiting
                | exit_shutdown::ExitRequestDecision::AllowRuntimeExit => {}
            }
        });
}

fn total_system_memory() -> u64 {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    system.total_memory()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regenerates `../src/utils/tauri.ts` without launching the app.
    ///
    /// **Prefer `cargo run -p quiro-desktop --bin export-bindings`.** This
    /// test does the same thing, but a test-harness binary does not load in
    /// every environment (`STATUS_ENTRYPOINT_NOT_FOUND` at process start on
    /// at least one Windows setup, while the app's own binary and that
    /// `[[bin]]` both run fine), so the binary is the reliable route and
    /// this is kept only as the in-suite equivalent.
    ///
    /// `#[ignore]`d because it writes a real file as a side effect, which a
    /// plain `cargo test` run should not do silently. Run explicitly:
    /// `cargo test -p quiro-desktop --lib -- --ignored export_typescript_bindings`
    #[test]
    #[ignore]
    fn exports_typescript_bindings() {
        super::export_typescript_bindings().expect("Failed to export typescript bindings");
    }
}

