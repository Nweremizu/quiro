//! Screenshot capture.
//!
//! The heavy lifting already lived in `quiro_recording::screenshot` — a full
//! port of Cap's capture path (Windows.Graphics.Capture fast path, GDI
//! fallback, per-target cropping, display/window/area support) that nothing
//! called. This module is the app-level pipeline around it: pick a target,
//! get Quiro's own overlays out of the shot, capture, then encode and record
//! the result in the library off the main thread.

use quiro_recording::sources::screen_capture::ScreenCaptureTarget;
use scap_targets::Display;
use std::str::FromStr;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tracing::{error, instrument};

use crate::NewScreenshotAdded;
use crate::windows::{
    WindowId, apply_content_protection, content_protection_enabled, hide_overlay,
};

/// Quiro's own picker/overlay windows are on screen at the moment a
/// screenshot is triggered from the target picker, and they would otherwise
/// be captured along with the content behind them.
async fn hide_own_overlays(app: &AppHandle) {
    let had_target_overlay = app.webview_windows().keys().any(|label| {
        matches!(
            WindowId::from_str(label),
            Ok(WindowId::TargetSelectOverlay { .. })
        )
    });

    // TargetSelectOverlay windows get the same Windows-specific treatment as
    // target_select_overlay::close_target_select_overlay_windows uses (see
    // its own comment): hide() leaves the DirectComposition transparency
    // surface composited on screen for these windows on Windows, so a plain
    // hide_overlay() here left a ghost of the picker briefly visible right
    // after every screenshot — on whichever display it happened to be
    // covering. Closing them, like the frontend's own dismiss already does,
    // fully releases the surface instead.
    crate::target_select_overlay::close_target_select_overlay_windows(app);

    let mut hid_any = had_target_overlay;

    for (label, window) in app.webview_windows() {
        if let Ok(id) = WindowId::from_str(&label)
            && matches!(
                id,
                WindowId::WindowCaptureOccluder { .. }
                    | WindowId::CaptureArea
                    | WindowId::ModeSelect
                    | WindowId::RecordingsOverlay
            )
        {
            hide_overlay(&window);
            hid_any = true;
        }
    }

    // Hiding/closing is asynchronous at the compositor level — capturing
    // immediately still catches the window mid-fade.
    if hid_any {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app))]
pub async fn take_screenshot(
    app: AppHandle,
    target: Option<ScreenCaptureTarget>,
) -> Result<String, String> {
    // No explicit target means "whatever the cursor is on" rather than always
    // the primary display, which is what you want from a global shortcut or a
    // tray click on a multi-monitor setup.
    let target = target.unwrap_or_else(|| ScreenCaptureTarget::Display {
        id: Display::get_containing_cursor()
            .unwrap_or_else(Display::primary)
            .id(),
    });

    hide_own_overlays(&app).await;

    let restore_content_protection = content_protection_enabled(&app);
    apply_content_protection(&app, true);
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let image_result = quiro_recording::screenshot::capture_screenshot(target).await;
    apply_content_protection(&app, restore_content_protection);

    let image = image_result.map_err(|e| format!("Failed to capture screenshot: {e}"))?;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("screenshots");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let pretty_name = crate::library::timestamped_pretty_name();
    let path = dir.join(format!("{pretty_name}.png"));

    // PNG encoding of a 4K frame is well into "visible stall" territory, so it
    // stays off the async runtime's worker threads.
    let write_path = path.clone();
    tokio::task::spawn_blocking(move || image.save(&write_path).map_err(|e| e.to_string()))
        .await
        .map_err(|e| format!("Screenshot encode task failed: {e}"))??;

    let sort_time_millis = chrono::Local::now().timestamp_millis();
    crate::library::write_sidecar_meta(&path, &pretty_name, sort_time_millis)?;

    // Lets any open library view refresh without polling.
    let _ = NewScreenshotAdded { path: path.clone() }.emit(&app);

    crate::notify_user(&app, "Screenshot captured", &pretty_name, false);

    Ok(path.to_string_lossy().to_string())
}

/// Convenience for callers that already know they want the whole display the
/// cursor is on (tray, shortcuts) and don't want to build a target.
pub(crate) fn spawn_screenshot_of_cursor_display(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = take_screenshot(app, None).await {
            error!(?err, "Screenshot failed");
        }
    });
}
