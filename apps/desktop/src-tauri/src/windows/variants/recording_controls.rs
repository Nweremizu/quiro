use crate::windows::*;

pub(crate) async fn try_reuse(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
) -> Option<tauri::Result<WebviewWindow>> {
    #[cfg(target_os = "macos")]
    if let ShowQuiroWindow::InProgressRecording { capture_target, .. } = this
        && let Some(window) = this.id().get(app)
    {
        use crate::panel_manager::is_window_handle_valid;

        if is_window_handle_valid(&window) {
            debug!("InProgressRecording: reusing existing window");
            let width = crate::fake_window::RECORDING_CONTROLS_WIDTH;
            let height = crate::fake_window::RECORDING_CONTROLS_HEIGHT;
            let (pos_x, pos_y) = capture_target
                .as_ref()
                .and_then(fake_window::calculate_recording_controls_position_for_target)
                .unwrap_or_else(|| {
                    CursorMonitorInfo::get().bottom_center_position(width, height, 120.0)
                });
            let _ = window.set_position(tauri::LogicalPosition::new(pos_x, pos_y));

            let label = window.label().to_string();
            app.run_on_main_thread({
                let app = app.clone();
                move || {
                    use tauri_nspanel::ManagerExt;
                    if let Ok(panel) = app.get_webview_panel(&label) {
                        panel.order_front_regardless();
                        panel.show();
                    }
                }
            })
            .ok();
            fake_window::spawn_fake_window_listener(app.clone(), window.clone());
            return Some(Ok(window));
        } else {
            warn!("InProgressRecording window handle invalid, destroying and recreating...");
            let _ = window.destroy();

            let window_id = this.id();
            let max_wait = std::time::Duration::from_millis(500);
            let poll_interval = std::time::Duration::from_millis(25);
            let start = std::time::Instant::now();
            while start.elapsed() < max_wait {
                if window_id.get(app).is_none() {
                    debug!(
                        "InProgressRecording window removed from registry after {:?}",
                        start.elapsed()
                    );
                    break;
                }
                tokio::time::sleep(poll_interval).await;
            }

            if window_id.get(app).is_some() {
                error!("InProgressRecording window STILL in registry, cannot recreate");
                return Some(Err(tauri::Error::WindowNotFound));
            }
            debug!("InProgressRecording window cleaned up, will recreate");
        }
    }

    #[cfg(not(target_os = "macos"))]
    if let ShowQuiroWindow::InProgressRecording { capture_target, .. } = this
        && let Some(window) = this.id().get(app)
    {
        let width = crate::fake_window::RECORDING_CONTROLS_WIDTH;
        let height = crate::fake_window::RECORDING_CONTROLS_HEIGHT;
        let (pos_x, pos_y) = capture_target
            .as_ref()
            .and_then(fake_window::calculate_recording_controls_position_for_target)
            .unwrap_or_else(|| {
                CursorMonitorInfo::get().bottom_center_position(width, height, 120.0)
            });
        let _ = window.set_position(logical_point_position(pos_x, pos_y));
        window.show().ok();
        window.set_focus().ok();
        fake_window::spawn_fake_window_listener(app.clone(), window.clone());
        return Some(Ok(window));
    }

    None
}

pub(crate) async fn show_in_progress_recording(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    countdown: &Option<u32>,
    capture_target: &Option<ScreenCaptureTarget>,
    cursor_monitor: CursorMonitorInfo,
) -> tauri::Result<WebviewWindow> {
    let width = crate::fake_window::RECORDING_CONTROLS_WIDTH;
    let height = crate::fake_window::RECORDING_CONTROLS_HEIGHT;

    let title = WindowId::RecordingControls.title();
    let should_protect = should_protect_window(app, &title);

    #[cfg(target_os = "macos")]
    let panel_activation_guard = permissions::prepare_macos_panel_window(app);

    #[cfg(target_os = "macos")]
    let window = {
        this.window_builder(app, "/toolbar")
            .maximized(false)
            .resizable(false)
            .fullscreen(false)
            .shadow(false)
            .always_on_top(true)
            .transparent(true)
            .visible_on_all_workspaces(true)
            .content_protected(should_protect)
            .inner_size(width, height)
            .skip_taskbar(true)
            .visible(false)
            .initialization_script(format!(
                "window.COUNTDOWN = {};",
                countdown.unwrap_or_default()
            ))
            .build()?
    };

    #[cfg(windows)]
    let window = this
        .window_builder(app, "/toolbar")
        .maximized(false)
        .resizable(false)
        .fullscreen(false)
        .shadow(false)
        .always_on_top(true)
        .transparent(true)
        .visible_on_all_workspaces(true)
        .content_protected(should_protect)
        .inner_size(width, height)
        .skip_taskbar(false)
        .initialization_script(format!(
            "window.COUNTDOWN = {};",
            countdown.unwrap_or_default()
        ))
        .build()?;

    #[cfg(target_os = "linux")]
    let window = this
        .window_builder(app, "/toolbar")
        .maximized(false)
        .resizable(false)
        .fullscreen(false)
        .shadow(false)
        .always_on_top(true)
        .transparent(true)
        .visible_on_all_workspaces(true)
        .content_protected(should_protect)
        .inner_size(width, height)
        .skip_taskbar(false)
        .initialization_script(format!(
            "window.COUNTDOWN = {};",
            countdown.unwrap_or_default()
        ))
        .build()?;

    lock_window_text_scale(&window);

    #[cfg(target_os = "windows")]
    log_window_content_protection(&window, should_protect, &title);

    let (pos_x, pos_y) = capture_target
        .as_ref()
        .and_then(fake_window::calculate_recording_controls_position_for_target)
        .unwrap_or_else(|| cursor_monitor.bottom_center_position(width, height, 120.0));
    let _ = window.set_position(logical_point_position(pos_x, pos_y));

    debug!(
        "InProgressRecording window: cursor_monitor=({}, {}, {}, {}), pos=({}, {})",
        cursor_monitor.x,
        cursor_monitor.y,
        cursor_monitor.width,
        cursor_monitor.height,
        pos_x,
        pos_y
    );

    debug!(
        "InProgressRecording window created: label={}, inner_size={:?}, outer_position={:?}",
        window.label(),
        window.inner_size(),
        window.outer_position()
    );

    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread({
            let window = window.clone();
            let app = app.clone();
            let panel_activation_guard = panel_activation_guard;
            move || {
                let _panel_activation_guard = panel_activation_guard;
                use tauri_nspanel::WebviewWindowExt as NSPanelWebviewWindowExt;
                use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
                use tauri_nspanel::panel_delegate;

                #[link(name = "CoreGraphics", kind = "framework")]
                unsafe extern "C" {
                    fn CGWindowLevelForKey(key: i32) -> i32;
                }

                #[allow(non_upper_case_globals)]
                const kCGMaximumWindowLevelKey: i32 = 10;

                let delegate = panel_delegate!(RecordingControlsPanelDelegate {
                    window_did_become_key,
                    window_did_resign_key
                });

                delegate.set_listener(Box::new(|_delegate_name: String| {}));

                let panel = match window.to_panel() {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::error!("Failed to convert recording controls to panel: {:?}", e);
                        crate::permissions::sync_macos_dock_visibility(&app);
                        return;
                    }
                };

                panel.set_collection_behaviour(
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenPrimary,
                );

                panel.set_delegate(delegate);

                let max_level = unsafe { CGWindowLevelForKey(kCGMaximumWindowLevelKey) };
                panel.set_level(max_level);

                panel.order_front_regardless();
                panel.show();

                crate::permissions::schedule_macos_dock_visibility_sync(&app);
            }
        })
        .ok();

        fake_window::spawn_fake_window_listener(app.clone(), window.clone());
    }

    #[cfg(windows)]
    {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let show_result = window.show();
        debug!(
            "InProgressRecording window.show() result: {:?}",
            show_result
        );
        window.set_focus().ok();
        fake_window::spawn_fake_window_listener(app.clone(), window.clone());
    }

    Ok(window)
}
