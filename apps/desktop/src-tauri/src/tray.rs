use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};
use tauri_specta::Event;
use tracing::error;

use crate::recording_settings::RecordingTargetMode;
use crate::target_select_overlay::{open_target_select_overlays, WindowFocusManager};
use crate::windows::ShowQuiroWindow;
use crate::CurrentRecordingChanged;

// Whether the *current* ExitRequested is a deliberate quit (tray's "Quit")
// versus one Tauri fires on its own — e.g. when the last window closes.
// Read by lib.rs's ExitRequested handler: only a deliberate quit is allowed
// to proceed past that handler's own (separate) export-aware shutdown gate.
// Without this, closing every window (e.g. closing Settings right after it
// hid the main window — see show_window.rs's hide_recording_windows) would
// leave the app running with no window and no way back in short of
// relaunching; the tray icon is that way back in, so it must outlive an
// incidental "no windows left" moment.
pub static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);

// Guards against stacking a listener per Quit click while a recording is
// still finalizing — one retry armed at a time is enough.
static RETRY_ARMED: AtomicBool = AtomicBool::new(false);

/// Re-requests exit once nothing is recording/pending, so a quit made while
/// a recording is finalizing doesn't kill it mid-write — it just waits.
/// Safe to call repeatedly; only the first call while a wait is already in
/// flight actually registers anything.
pub fn retry_exit_when_recording_stops(app: AppHandle<Wry>) {
    if RETRY_ARMED.swap(true, Ordering::AcqRel) {
        return;
    }

    let listener_app = app.clone();
    CurrentRecordingChanged::listen_any(&app, move |_| {
        let still_recording = listener_app
            .try_state::<crate::ArcLock<crate::App>>()
            .and_then(|state| {
                state
                    .try_read()
                    .ok()
                    .map(|state| state.is_recording_active_or_pending())
            })
            .unwrap_or(true);

        if !still_recording {
            RETRY_ARMED.store(false, Ordering::Release);
            listener_app.exit(0);
        }
    });
}
pub fn create_tray(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", "Open Quiro", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "record_display", "Record Display", true, None::<&str>)?,
            &MenuItem::with_id(app, "record_window", "Record Window", true, None::<&str>)?,
            &MenuItem::with_id(app, "record_area", "Record Area", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "screenshot", "Take Screenshot", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit Quiro", true, None::<&str>)?,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("tauri.conf.json must configure an app icon");

    TrayIconBuilder::with_id("tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            let app = app.clone();

            let target_mode = match event.id.0.as_str() {
                "record_display" => Some(RecordingTargetMode::Display),
                "record_window" => Some(RecordingTargetMode::Window),
                "record_area" => Some(RecordingTargetMode::Area),
                _ => None,
            };

            match event.id.0.as_str() {
                "open" => {
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = (ShowQuiroWindow::Main {
                            init_target_mode: None,
                        })
                        .show(&app)
                        .await
                        {
                            error!(?err, "Failed to open main window from tray");
                        }
                    });
                }
                "record_display" | "record_window" | "record_area" => {
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<WindowFocusManager>();
                        if let Err(err) =
                            open_target_select_overlays(app.clone(), state, None, None, target_mode)
                                .await
                        {
                            error!(?err, "Failed to open target picker from tray");
                        }
                    });
                }
                "screenshot" => {
                    crate::capture::spawn_screenshot_of_cursor_display(app);
                }
                "settings" => {
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = (ShowQuiroWindow::Settings { page: None }).show(&app).await
                        {
                            error!(?err, "Failed to open settings from tray");
                        }
                    });
                }
                "quit" => {
                    // Marks this as a real, user-requested exit — the
                    // ExitRequested handler in lib.rs only lets a
                    // window-close-triggered exit through when this is set.
                    QUIT_REQUESTED.store(true, Ordering::Release);
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
