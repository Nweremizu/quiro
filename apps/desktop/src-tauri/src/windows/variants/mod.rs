use crate::windows::*;

pub(crate) mod camera;
pub(crate) mod editor;
pub(crate) mod main_window;
pub(crate) mod overlays;
pub(crate) mod recording_controls;
pub(crate) mod screenshot_editor;

pub(crate) async fn try_reuse_existing(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
) -> Option<tauri::Result<WebviewWindow>> {
    if !matches!(
        this,
        ShowQuiroWindow::Camera { .. }
            | ShowQuiroWindow::InProgressRecording { .. }
            | ShowQuiroWindow::ScreenshotEditor { .. }
            | ShowQuiroWindow::Editor { .. }
    ) && let Some(window) = this.id().get(app)
    {
        #[cfg(target_os = "macos")]
        if matches!(this, ShowQuiroWindow::Main { .. })
            && !app.state::<MainWindowReadyState>().is_ready()
        {
            return Some(Ok(window));
        }

        let cursor_display_id = if let ShowQuiroWindow::Main { init_target_mode } = this {
            if init_target_mode.is_some() {
                Display::get_containing_cursor()
                    .map(|d| d.id().to_string())
                    .or_else(|| Some(Display::primary().id().to_string()))
            } else {
                None
            }
        } else {
            None
        };

        if let ShowQuiroWindow::Main {
            init_target_mode: Some(target_mode),
        } = this
        {
            window.hide().ok();
            emit_app_event(
                app,
                RequestSetTargetMode {
                    target_mode: Some(*target_mode),
                    display_id: cursor_display_id,
                },
            );
        } else {
            let should_restore_main_window_inputs = matches!(this, ShowQuiroWindow::Main { .. });

            if matches!(
                this,
                ShowQuiroWindow::Main { .. } | ShowQuiroWindow::Settings { .. }
            ) {
                recenter_window_if_offscreen(&window);
            }

            window.show().ok();
            window.unminimize().ok();
            window.set_focus().ok();

            if let ShowQuiroWindow::Settings { .. } = this {
                ensure_settings_window_bounds(&window);
            }

            if let ShowQuiroWindow::Main { init_target_mode } = this {
                emit_app_event(
                    app,
                    RequestSetTargetMode {
                        target_mode: *init_target_mode,
                        display_id: cursor_display_id,
                    },
                );
            }

            if should_restore_main_window_inputs {
                restore_hidden_target_select_overlays(app);

                let app = app.clone();
                tokio::spawn(async move {
                    restore_main_window_inputs(&app).await;
                });
            }
        }

        #[cfg(target_os = "macos")]
        if this.id().activates_dock() {
            crate::permissions::sync_macos_dock_visibility(app);
        }

        return Some(Ok(window));
    }

    None
}

/// Opening Settings hides any target-select overlay and remembers it via
/// `remember_overlay_for_restore`. Nothing ever read those labels back, so the
/// picker silently vanished for good the moment Settings was opened — this is
/// the other half of that handshake, run when the main window returns.
fn restore_hidden_target_select_overlays(app: &AppHandle<Wry>) {
    let Some(focus_manager) = app.try_state::<WindowFocusManager>() else {
        return;
    };

    for label in focus_manager.take_overlay_restore_labels() {
        if let Some(window) = app.get_webview_window(&label) {
            show_overlay(&window);
        }
    }
}
