use crate::windows::*;

pub(crate) async fn show_main(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    init_target_mode: &Option<RecordingTargetMode>,
    cursor_monitor: CursorMonitorInfo,
) -> tauri::Result<WebviewWindow> {
    let title = WindowId::Main.title();
    let should_protect = should_protect_window(app, &title);

    #[cfg(target_os = "macos")]
    let panel_activation_guard = permissions::prepare_macos_panel_window(app);

    let window = this
        .window_builder(app, "/")
        .resizable(false)
        .maximized(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .content_protected(should_protect)
        .transparent(true)
        .visible(false)
        .initialization_script(format!(
            "
                        window.__QUIRO__ = window.__QUIRO__ ?? {{}};
                        window.__QUIRO__.initialTargetMode = {}
                    ",
            serde_json::to_string(init_target_mode)
                .expect("Failed to serialize initial target mode")
        ))
        .build()?;
    lock_window_text_scale(&window);

    let saved_position = GeneralSettingsStore::get(app)
        .ok()
        .flatten()
        .and_then(|s| s.main_window_position)
        .filter(|pos| is_position_on_any_screen(pos.x, pos.y));

    let main_position = if let Some(pos) = saved_position {
        match display_for_saved_position(pos.x, pos.y, pos.display_id.as_ref()) {
            Some(display) => CursorMonitorInfo::from_display(&display).position(pos.x, pos.y),
            None => tauri::Position::Logical(tauri::LogicalPosition::new(pos.x, pos.y)),
        }
    } else {
        let (pos_x, pos_y) = cursor_monitor.center_position(330.0, 395.0);
        cursor_monitor.position(pos_x, pos_y)
    };

    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread({
            let window = window.clone();
            let app = app.clone();
            let panel_activation_guard = panel_activation_guard;
            move || {
                let _panel_activation_guard = panel_activation_guard;
                use crate::panel_manager::try_to_panel;
                use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
                use tauri_nspanel::panel_delegate;

                let delegate = panel_delegate!(MainPanelDelegate {
                    window_did_become_key,
                    window_did_resign_key
                });

                delegate.set_listener(Box::new(|_delegate_name: String| {}));

                let panel = match try_to_panel(&window) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::error!("Failed to convert main window to panel: {}", e);
                        crate::permissions::sync_macos_dock_visibility(&app);
                        return;
                    }
                };

                panel.set_collection_behaviour(
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenPrimary,
                );

                panel.set_delegate(delegate);

                panel.set_level(MAIN_PANEL_LEVEL);

                let _ = window.set_position(main_position);

                crate::platform::apply_squircle_corners(&window, 16.0);

                crate::permissions::schedule_macos_dock_visibility_sync(&app);
            }
        })
        .ok();
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_position(main_position);

        #[cfg(windows)]
        {
            if let Err(e) = window.set_size(LogicalSize::new(330.0, 395.0)) {
                warn!("Failed to set Main window size on Windows: {}", e);
            }
            if let Err(e) = window.set_position(main_position) {
                warn!("Failed to position Main window on Windows: {}", e);
            }
        }

        window.show().ok();
    }

    Ok(window)
}

pub(crate) async fn show_settings(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    page: &Option<String>,
    cursor_monitor: CursorMonitorInfo,
) -> tauri::Result<WebviewWindow> {
    let mut builder = this
        .window_builder(
            app,
            format!("/settings/{}", page.clone().unwrap_or_default()),
        )
        .inner_size(782.0, 775.0)
        .min_inner_size(780.0, 560.0)
        .resizable(true)
        .maximized(false)
        .focused(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder.transparent(true);
    }

    let window = builder.build()?;
    lock_window_text_scale(&window);

    let (pos_x, pos_y) = cursor_monitor.center_position(782.0, 775.0);
    let _ = window.set_position(cursor_monitor.position(pos_x, pos_y));

    #[cfg(windows)]
    {
        if let Err(e) = window.set_size(LogicalSize::new(782.0, 775.0)) {
            warn!("Failed to set Settings window size on Windows: {}", e);
        }
        if let Err(e) = window.set_position(cursor_monitor.position(pos_x, pos_y)) {
            warn!("Failed to position Settings window on Windows: {}", e);
        }
    }

    ensure_settings_window_bounds(&window);

    Ok(window)
}

pub(crate) async fn show_mode_select(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    cursor_monitor: CursorMonitorInfo,
) -> tauri::Result<WebviewWindow> {
    if let Some(main) = WindowId::Main.get(app) {
        let _ = main.hide();
    }

    let window = this
        .window_builder(app, "/mode-select")
        .inner_size(580.0, 340.0)
        .min_inner_size(580.0, 340.0)
        .resizable(false)
        .maximized(false)
        .maximizable(false)
        .focused(true)
        .shadow(true)
        .build()?;
    lock_window_text_scale(&window);

    let (pos_x, pos_y) = cursor_monitor.center_position(580.0, 340.0);
    let _ = window.set_position(cursor_monitor.position(pos_x, pos_y));

    #[cfg(windows)]
    {
        use tauri::LogicalSize;
        if let Err(e) = window.set_size(LogicalSize::new(580.0, 340.0)) {
            warn!("Failed to set ModeSelect window size on Windows: {}", e);
        }
        if let Err(e) = window.set_position(cursor_monitor.position(pos_x, pos_y)) {
            warn!("Failed to position ModeSelect window on Windows: {}", e);
        }
    }

    window.show().ok();
    window.set_focus().ok();

    Ok(window)
}
