//! Global shortcuts.
//!
//! Adapted from Cap's `hotkeys.rs`. The store previously lived in the
//! frontend's `store.ts` as a type with a comment saying registration "isn't
//! built yet" — this is that registration, so the store moves to Rust and is
//! specta-exported like `GeneralSettingsStore`/`RecordingSettingsStore`.
//!
//! This module also owns the global-shortcut plugin, which used to be
//! registered inline in `lib.rs` with a handler that only recognised Escape.
//! Escape still behaves exactly as before (it cancels a target-select overlay,
//! see `WindowFocusManager::register_escape`) — it's handled first and is not
//! bindable, so a user shortcut can never shadow the one key that gets them out
//! of a full-screen overlay.

use crate::{
    OnEscapePress, RequestSetTargetMode, capture, recording,
    recording_settings::{RecordingSettingsStore, RecordingTargetMode},
};
use quiro_recording::RecordingMode;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;
use tauri_specta::Event;
use tracing::{error, warn};

#[derive(Serialize, Deserialize, Type, PartialEq, Clone, Copy, Debug)]
pub struct Hotkey {
    #[specta(type = String)]
    code: Code,
    meta: bool,
    ctrl: bool,
    alt: bool,
    shift: bool,
}

impl From<Hotkey> for Shortcut {
    fn from(hotkey: Hotkey) -> Self {
        let mut modifiers = Modifiers::empty();

        if hotkey.meta {
            modifiers |= Modifiers::META;
        }
        if hotkey.ctrl {
            modifiers |= Modifiers::CONTROL;
        }
        if hotkey.alt {
            modifiers |= Modifiers::ALT;
        }
        if hotkey.shift {
            modifiers |= Modifiers::SHIFT;
        }

        Shortcut::new(Some(modifiers), hotkey.code)
    }
}

impl Hotkey {
    /// A bare Escape is reserved for cancelling target-select overlays. Escape
    /// *with* modifiers is fine — it can't be produced while dismissing an
    /// overlay, so it doesn't collide.
    fn shadows_escape(&self) -> bool {
        self.code == Code::Escape && !(self.meta || self.ctrl || self.alt || self.shift)
    }
}

#[derive(Serialize, Deserialize, Type, PartialEq, Eq, Hash, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::enum_variant_names)]
pub enum HotkeyAction {
    StartStudioRecording,
    StopRecording,
    RestartRecording,
    TogglePauseRecording,
    CycleRecordingMode,
    OpenRecordingPicker,
    OpenRecordingPickerDisplay,
    OpenRecordingPickerWindow,
    OpenRecordingPickerArea,
    ScreenshotDisplay,
    ScreenshotWindow,
    ScreenshotArea,
    #[serde(other)]
    Other,
}

#[derive(Serialize, Deserialize, Type, Default, Clone)]
pub struct HotkeysStore {
    hotkeys: HashMap<HotkeyAction, Hotkey>,
}

impl HotkeysStore {
    pub fn get(app: &AppHandle) -> Result<Option<Self>, String> {
        let Ok(Some(value)) = app.store("store").map(|s| s.get("hotkeys")) else {
            return Ok(None);
        };

        serde_json::from_value(value).map_err(|e| e.to_string())
    }

    fn save(&self, app: &AppHandle) -> Result<(), String> {
        let store = app.store("store").map_err(|e| e.to_string())?;
        store.set(
            "hotkeys",
            serde_json::to_value(self).map_err(|e| e.to_string())?,
        );
        store.save().map_err(|e| e.to_string())
    }
}

pub type HotkeysState = Mutex<HotkeysStore>;

/// Emitted when a hotkey asks for a recording to start. Unlike stop/pause,
/// starting needs a capture target, and the main window is the thing that knows
/// which one is currently selected — so this goes to the frontend rather than
/// calling `start_recording` with a guess.
#[derive(Serialize, Deserialize, Type, tauri_specta::Event, Debug, Clone)]
pub struct RequestStartRecording {
    pub mode: RecordingMode,
}

pub fn init(app: &AppHandle) {
    if let Err(err) = app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if !matches!(event.state(), ShortcutState::Pressed) {
                    return;
                }

                // Escape first and unconditionally: it's only ever registered
                // while a target-select overlay is open, and it must keep
                // working regardless of what the user has bound.
                if shortcut.key == Code::Escape && shortcut.mods.is_empty() {
                    let _ = OnEscapePress.emit(app);
                    return;
                }

                let Some(state) = app.try_state::<HotkeysState>() else {
                    return;
                };
                let Ok(store) = state.lock() else {
                    warn!("Hotkeys state poisoned; ignoring shortcut");
                    return;
                };

                for (action, hotkey) in &store.hotkeys {
                    if &Shortcut::from(*hotkey) == shortcut {
                        let app = app.clone();
                        let action = *action;
                        crate::spawn_on_runtime(async move {
                            if let Err(err) = handle_hotkey(app, action).await {
                                error!(?action, %err, "Hotkey action failed");
                            }
                        });
                    }
                }
            })
            .build(),
    ) {
        error!(%err, "Failed to register global shortcut plugin");
        return;
    }

    let store = match HotkeysStore::get(app) {
        Ok(Some(store)) => store,
        Ok(None) => HotkeysStore::default(),
        Err(err) => {
            warn!(%err, "Failed to load hotkeys store; starting empty");
            HotkeysStore::default()
        }
    };

    let global_shortcut = app.global_shortcut();
    for hotkey in store.hotkeys.values() {
        if let Err(err) = global_shortcut.register(Shortcut::from(*hotkey)) {
            // A shortcut the OS or another app already owns can't be taken;
            // that's the user's to resolve, not a startup failure.
            warn!(%err, "Failed to register a saved hotkey");
        }
    }

    app.manage(Mutex::new(store));
}

async fn handle_hotkey(app: AppHandle, action: HotkeyAction) -> Result<(), String> {
    match action {
        HotkeyAction::StartStudioRecording => {
            let _ = RequestStartRecording {
                mode: RecordingMode::Studio,
            }
            .emit(&app);
            Ok(())
        }
        HotkeyAction::StopRecording => recording::stop_recording(app.clone(), app.state())
            .await
            .map(|_| ()),
        HotkeyAction::RestartRecording => {
            recording::restart_recording(app.clone(), app.state()).await
        }
        HotkeyAction::TogglePauseRecording => {
            recording::toggle_pause_recording(app.state(), app.clone()).await
        }
        HotkeyAction::CycleRecordingMode => {
            let current = RecordingSettingsStore::get(&app)
                .ok()
                .flatten()
                .and_then(|s| s.mode)
                .unwrap_or_default();

            let next = match current {
                RecordingMode::Studio => RecordingMode::Screenshot,
                RecordingMode::Screenshot => RecordingMode::Studio,
            };

            RecordingSettingsStore::set_mode(&app, next)
                .map_err(|e| format!("Failed to cycle recording mode: {e}"))
        }
        HotkeyAction::OpenRecordingPicker => emit_target_mode(&app, None),
        HotkeyAction::OpenRecordingPickerDisplay => {
            emit_target_mode(&app, Some(RecordingTargetMode::Display))
        }
        HotkeyAction::OpenRecordingPickerWindow => {
            emit_target_mode(&app, Some(RecordingTargetMode::Window))
        }
        HotkeyAction::OpenRecordingPickerArea => {
            emit_target_mode(&app, Some(RecordingTargetMode::Area))
        }
        HotkeyAction::ScreenshotDisplay => {
            // `None` already means "the display under the cursor" — see the
            // comment on take_screenshot, which was written for exactly this.
            capture::take_screenshot(app.clone(), None)
                .await
                .map(|_| ())
        }
        HotkeyAction::ScreenshotWindow => {
            use scap_targets::Window;

            // Scoped so the `Window` is dropped before the await: it wraps a
            // raw platform handle and isn't `Send`, so holding it across the
            // await would make this whole future unspawnable.
            let id = {
                let window = Window::get_topmost_at_cursor()
                    .ok_or_else(|| "No window under the cursor".to_string())?;
                window.id()
            };

            capture::take_screenshot(
                app.clone(),
                Some(quiro_recording::sources::screen_capture::ScreenCaptureTarget::Window { id }),
            )
            .await
            .map(|_| ())
        }
        HotkeyAction::ScreenshotArea => {
            RecordingSettingsStore::set_mode(&app, RecordingMode::Screenshot)
                .map_err(|e| format!("Failed to switch to screenshot mode: {e}"))?;

            emit_target_mode(&app, Some(RecordingTargetMode::Area))
        }
        HotkeyAction::Other => Ok(()),
    }
}

fn emit_target_mode(
    app: &AppHandle,
    target_mode: Option<RecordingTargetMode>,
) -> Result<(), String> {
    RequestSetTargetMode {
        target_mode,
        display_id: None,
    }
    .emit(app)
    .map_err(|e| e.to_string())
}

/// Binds `hotkey` to `action`, or clears the binding when `hotkey` is `None`.
/// Registration happens immediately so the shortcut is live without a restart,
/// and the store is written so it survives one.
#[tauri::command]
#[specta::specta]
pub fn set_hotkey(
    app: AppHandle,
    action: HotkeyAction,
    hotkey: Option<Hotkey>,
) -> Result<(), String> {
    if let Some(hotkey) = hotkey
        && hotkey.shadows_escape()
    {
        return Err(
            "Escape on its own is reserved for closing the capture overlay. Add a modifier."
                .to_string(),
        );
    }

    let global_shortcut = app.global_shortcut();
    let state = app.state::<HotkeysState>();
    let mut store = state.lock().map_err(|e| e.to_string())?;

    let previous = store.hotkeys.get(&action).copied();

    match hotkey {
        Some(hotkey) => store.hotkeys.insert(action, hotkey),
        None => store.hotkeys.remove(&action),
    };

    // Only release the old shortcut once nothing else is bound to it —
    // two actions sharing a chord would otherwise deregister each other.
    if let Some(previous) = previous
        && !store.hotkeys.values().any(|h| h == &previous)
    {
        let _ = global_shortcut.unregister(Shortcut::from(previous));
    }

    if let Some(hotkey) = hotkey
        && let Err(err) = global_shortcut.register(Shortcut::from(hotkey))
    {
        // Put the store back the way it was: reporting success for a shortcut
        // the OS refused would leave the page showing a binding that does
        // nothing.
        match previous {
            Some(previous) => store.hotkeys.insert(action, previous),
            None => store.hotkeys.remove(&action),
        };
        return Err(format!(
            "That shortcut is already in use by another app: {err}"
        ));
    }

    store.save(&app)
}

#[tauri::command]
#[specta::specta]
pub fn get_hotkeys(app: AppHandle) -> Result<HotkeysStore, String> {
    let state = app.state::<HotkeysState>();
    let store = state.lock().map_err(|e| e.to_string())?;
    Ok(store.clone())
}
