use crate::windows::*;

pub(crate) async fn show_target_select_overlay(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    display_id: &DisplayId,
    target_mode: &Option<RecordingTargetMode>,
) -> tauri::Result<WebviewWindow> {
    let Some(display) = scap_targets::Display::from_id(display_id) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let is_hovered_display =
        scap_targets::Display::get_containing_cursor().map(|d| d.id()) == Some(display.id());

    let title = WindowId::TargetSelectOverlay {
        display_id: display_id.clone(),
    }
    .title();
    let should_protect = should_protect_window(app, &title);

    let target_mode_param = match target_mode {
        Some(RecordingTargetMode::Display) => "&targetMode=display",
        Some(RecordingTargetMode::Window) => "&targetMode=window",
        Some(RecordingTargetMode::Area) => "&targetMode=area",
        Some(RecordingTargetMode::Camera) => "&targetMode=camera",
        None => "",
    };

    let camera_ws_port = {
        let Some(state) = app.try_state::<ArcLock<App>>() else {
            warn!("App state unavailable during target select overlay creation");
            return Err(tauri::Error::WindowNotFound);
        };
        let state = state.read().await;
        state.camera_ws_port
    };

    #[cfg(target_os = "macos")]
    let panel_activation_guard = permissions::prepare_macos_panel_window(app);

    let mut window_builder = this
                    .window_builder(
                        app,
                        format!("/target-select-overlay?displayId={display_id}&isHoveredDisplay={is_hovered_display}{target_mode_param}"),
                    )
                    .maximized(false)
                    .resizable(false)
                    .fullscreen(false)
                    .shadow(false)
                    .content_protected(should_protect)
                    .always_on_top(true)
                    .visible_on_all_workspaces(true)
                    .skip_taskbar(true)
                    .transparent(true)
                    .visible(false)
                    .initialization_script(format!(
                        "window.__QUIRO__ = window.__QUIRO__ ?? {{}}; window.__QUIRO__.cameraWsPort = {camera_ws_port};"
                    ));

    #[cfg(target_os = "macos")]
    {
        let position = display.raw_handle().logical_position();
        let size = display.logical_size().unwrap();

        window_builder = window_builder
            .inner_size(size.width(), size.height())
            .position(position.x(), position.y());
    }

    #[cfg(windows)]
    {
        window_builder = window_builder.inner_size(100.0, 100.0).position(0.0, 0.0);
    }

    #[cfg(target_os = "linux")]
    {
        let position = display.raw_handle().physical_position().unwrap();
        let size = display.physical_size().unwrap();
        window_builder = window_builder
            .inner_size(size.width(), size.height())
            .position(position.x(), position.y());
    }

    let window = window_builder.build()?;
    lock_window_text_scale(&window);

    #[cfg(target_os = "linux")]
    {
        use tauri::{LogicalSize, PhysicalPosition};
        let position = display.raw_handle().physical_position().unwrap();
        let size = display.physical_size().unwrap();
        let _ = window.set_position(PhysicalPosition::new(position.x(), position.y()));
        let _ = window.set_size(LogicalSize::new(size.width(), size.height()));
    }

    #[cfg(windows)]
    {
        let Some(position) = display.raw_handle().physical_position() else {
            warn!(display_id = %display_id, "Missing display position for target select overlay");
            return Err(tauri::Error::WindowNotFound);
        };
        let Some(logical_size) = display.logical_size() else {
            warn!(display_id = %display_id, "Missing display logical size for target select overlay");
            return Err(tauri::Error::WindowNotFound);
        };
        let Some(physical_size) = display.physical_size() else {
            warn!(display_id = %display_id, "Missing display physical size for target select overlay");
            return Err(tauri::Error::WindowNotFound);
        };
        use tauri::{LogicalSize, PhysicalPosition, PhysicalSize};
        let _ = window.set_size(LogicalSize::new(
            logical_size.width(),
            logical_size.height(),
        ));
        let _ = window.set_position(PhysicalPosition::new(position.x(), position.y()));
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;

        match window.inner_size() {
            Ok(actual_physical_size)
                if physical_size.width() != actual_physical_size.width as f64 =>
            {
                let _ = window.set_size(LogicalSize::new(
                    logical_size.width(),
                    logical_size.height(),
                ));
            }
            Ok(_) => {}
            Err(err) => {
                warn!(%err, "Failed to read target select overlay inner size");
            }
        }
    }

    app.state::<WindowFocusManager>()
        .spawn(display_id, window.clone());

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

                let delegate = panel_delegate!(TargetSelectOverlayPanelDelegate {
                    window_did_become_key,
                    window_did_resign_key
                });

                delegate.set_listener(Box::new(|_delegate_name: String| {}));

                let panel = match window.to_panel() {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::error!(
                            "Failed to convert target select overlay to panel: {:?}",
                            e
                        );
                        crate::permissions::sync_macos_dock_visibility(&app);
                        return;
                    }
                };

                panel.set_collection_behaviour(
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenPrimary,
                );

                panel.set_delegate(delegate);

                #[allow(non_upper_case_globals)]
                const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
                panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

                let max_level = unsafe { CGWindowLevelForKey(kCGMaximumWindowLevelKey) };
                panel.set_level(max_level - 1);

                panel.order_front_regardless();
                panel.show();

                crate::permissions::schedule_macos_dock_visibility_sync(&app);
            }
        })
        .ok();
    }

    #[cfg(not(target_os = "macos"))]
    {
        window.show().ok();
    }

    Ok(window)
}

pub(crate) async fn show_window_capture_occluder(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    screen_id: &DisplayId,
    target_bounds: Option<LogicalBounds>,
) -> tauri::Result<WebviewWindow> {
    let Some(display) = Display::from_id(screen_id) else {
        return Err(tauri::Error::WindowNotFound);
    };

    let title = WindowId::WindowCaptureOccluder {
        screen_id: screen_id.clone(),
    }
    .title();
    let should_protect = should_protect_window(app, &title);

    // The blinds' rect, baked into the URL rather than fetched after mount —
    // there's no live "current recording" query on the frontend to fetch it
    // from (recording.rs already has the target in hand at the one moment
    // this window gets created), and a Window target's bounds are read once
    // here rather than tracked live if the user drags it mid-recording,
    // matching what recording.rs already does for this same target when
    // positioning the toolbar (see fake_window.rs's own once-per-tick, not
    // sub-frame, tracking).
    let url = match target_bounds {
        Some(bounds) => format!(
            "/window-capture-occluder?x={}&y={}&width={}&height={}",
            bounds.position().x(),
            bounds.position().y(),
            bounds.size().width(),
            bounds.size().height(),
        ),
        None => "/window-capture-occluder".to_string(),
    };

    let mut window_builder = this
        .window_builder(app, url)
        .maximized(false)
        .resizable(false)
        .fullscreen(false)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .content_protected(should_protect)
        .skip_taskbar(true)
        .transparent(true);

    #[cfg(target_os = "macos")]
    {
        let position = display.raw_handle().logical_position();
        let Some(size) = display.logical_size() else {
            warn!(screen_id = %screen_id, "Missing display logical size for window capture occluder");
            return Err(tauri::Error::WindowNotFound);
        };

        window_builder = window_builder
            .inner_size(size.width(), size.height())
            .position(position.x(), position.y());
    }

    // On Windows a window's DPI scale isn't known until it's placed on a
    // monitor, so sizing/positioning from display bounds at build time is
    // unreliable across monitors with different DPIs. Build a placeholder
    // and fix the geometry up after the window exists (below), mirroring
    // the TargetSelectOverlay path.
    #[cfg(windows)]
    {
        window_builder = window_builder.inner_size(100.0, 100.0).position(0.0, 0.0);
    }

    #[cfg(target_os = "linux")]
    {
        let position = display.raw_handle().physical_position().unwrap();
        let Some(size) = display.physical_size() else {
            warn!(screen_id = %screen_id, "Missing display size for window capture occluder");
            return Err(tauri::Error::WindowNotFound);
        };
        window_builder = window_builder
            .inner_size(size.width(), size.height())
            .position(position.x(), position.y());
    }

    let window = window_builder.build()?;
    lock_window_text_scale(&window);

    #[cfg(target_os = "linux")]
    {
        use tauri::{LogicalSize, PhysicalPosition};
        let position = display.raw_handle().physical_position().unwrap();
        if let Some(size) = display.physical_size() {
            let _ = window.set_position(PhysicalPosition::new(position.x(), position.y()));
            let _ = window.set_size(LogicalSize::new(size.width(), size.height()));
        }
    }

    // Fix up the occluder geometry now that the window exists and its real
    // per-monitor DPI is known: position with physical coordinates (which
    // are unambiguous across monitors), then set the logical size so the
    // window covers the full display. Verify the resulting physical size
    // matches the display and re-apply once if the initial placement raced
    // the DPI change.
    #[cfg(windows)]
    {
        let Some(position) = display.raw_handle().physical_position() else {
            warn!(screen_id = %screen_id, "Missing display position for window capture occluder");
            return Err(tauri::Error::WindowNotFound);
        };
        let Some(logical_size) = display.logical_size() else {
            warn!(screen_id = %screen_id, "Missing display logical size for window capture occluder");
            return Err(tauri::Error::WindowNotFound);
        };
        let Some(physical_size) = display.physical_size() else {
            warn!(screen_id = %screen_id, "Missing display physical size for window capture occluder");
            return Err(tauri::Error::WindowNotFound);
        };
        use tauri::{LogicalSize, PhysicalPosition};
        let _ = window.set_size(LogicalSize::new(
            logical_size.width(),
            logical_size.height(),
        ));
        let _ = window.set_position(PhysicalPosition::new(position.x(), position.y()));
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;

        match window.inner_size() {
            Ok(actual_physical_size)
                if physical_size.width() != actual_physical_size.width as f64 =>
            {
                let _ = window.set_size(LogicalSize::new(
                    logical_size.width(),
                    logical_size.height(),
                ));
            }
            Ok(_) => {}
            Err(err) => {
                warn!(%err, "Failed to read window capture occluder inner size");
            }
        }
    }

    if let Err(err) = window.set_ignore_cursor_events(true) {
        warn!(%err, "Failed to ignore cursor events for window capture occluder");
    }

    #[cfg(target_os = "macos")]
    {
        crate::platform::set_window_level(window.as_ref().window(), 900);
    }

    Ok(window)
}

pub(crate) async fn show_capture_area(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    screen_id: &DisplayId,
) -> tauri::Result<WebviewWindow> {
    let title = WindowId::CaptureArea.title();
    let should_protect = should_protect_window(app, &title);

    let mut window_builder = this
        .window_builder(app, "/capture-area")
        .maximized(false)
        .fullscreen(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .content_protected(should_protect)
        .skip_taskbar(true)
        .closable(true)
        .decorations(false)
        .transparent(true);

    let Some(display) = Display::from_id(screen_id) else {
        return Err(tauri::Error::WindowNotFound);
    };

    #[cfg(target_os = "macos")]
    if let Some(bounds) = display.raw_handle().logical_bounds() {
        window_builder = window_builder
            .inner_size(bounds.size().width(), bounds.size().height())
            .position(bounds.position().x(), bounds.position().y());
    }

    // On Windows a window's DPI scale isn't known until it's placed on a
    // monitor, so sizing/positioning from logical bounds at build time is
    // unreliable across monitors with different DPIs — the overlay ends up
    // sized for the wrong monitor and no longer covers the target display,
    // which truncates area selections on HiDPI secondary monitors. Build a
    // placeholder and fix the geometry up after the window exists (below),
    // mirroring the TargetSelectOverlay path.
    #[cfg(windows)]
    {
        window_builder = window_builder.inner_size(100.0, 100.0).position(0.0, 0.0);
    }

    #[cfg(target_os = "linux")]
    if let Some(bounds) = display.raw_handle().physical_bounds() {
        window_builder = window_builder
            .inner_size(bounds.size().width(), bounds.size().height())
            .position(bounds.position().x(), bounds.position().y());
    }

    let window = window_builder.build()?;
    lock_window_text_scale(&window);

    // Fix up the overlay geometry now that the window exists and its real
    // per-monitor DPI is known: position with physical coordinates (which are
    // unambiguous across monitors), then set the logical size so the window
    // covers the full display. Verify the resulting physical size matches the
    // display and re-apply once if the initial placement raced the DPI change.
    #[cfg(windows)]
    {
        let Some(position) = display.raw_handle().physical_position() else {
            warn!(display_id = %screen_id, "Missing display position for capture area overlay");
            return Err(tauri::Error::WindowNotFound);
        };
        let Some(logical_size) = display.logical_size() else {
            warn!(display_id = %screen_id, "Missing display logical size for capture area overlay");
            return Err(tauri::Error::WindowNotFound);
        };
        let Some(physical_size) = display.physical_size() else {
            warn!(display_id = %screen_id, "Missing display physical size for capture area overlay");
            return Err(tauri::Error::WindowNotFound);
        };
        use tauri::{LogicalSize, PhysicalPosition};
        let _ = window.set_size(LogicalSize::new(
            logical_size.width(),
            logical_size.height(),
        ));
        let _ = window.set_position(PhysicalPosition::new(position.x(), position.y()));
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;

        match window.inner_size() {
            Ok(actual_physical_size)
                if physical_size.width() != actual_physical_size.width as f64 =>
            {
                let _ = window.set_size(LogicalSize::new(
                    logical_size.width(),
                    logical_size.height(),
                ));
            }
            Ok(_) => {}
            Err(err) => {
                warn!(%err, "Failed to read capture area overlay inner size");
            }
        }
    }

    #[cfg(target_os = "linux")]
    if let Some(bounds) = display.raw_handle().physical_bounds() {
        use tauri::{LogicalSize, PhysicalPosition};
        let _ = window.set_position(PhysicalPosition::new(
            bounds.position().x(),
            bounds.position().y(),
        ));
        let _ = window.set_size(LogicalSize::new(
            bounds.size().width(),
            bounds.size().height(),
        ));
    }

    #[cfg(target_os = "macos")]
    crate::platform::set_window_level(
        window.as_ref().window(),
        objc2_app_kit::NSPopUpMenuWindowLevel,
    );

    // Hide the main window if the target monitor is the same
    if let Some(main_window) = WindowId::Main.get(app)
        && let (Ok(outer_pos), Ok(outer_size)) =
            (main_window.outer_position(), main_window.outer_size())
        && let Ok(scale_factor) = main_window.scale_factor()
        && display.intersects(outer_pos, outer_size, scale_factor)
    {
        let _ = main_window.minimize();
    };

    Ok(window)
}

pub(crate) async fn show_recordings_overlay(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    cursor_monitor: CursorMonitorInfo,
) -> tauri::Result<WebviewWindow> {
    let title = WindowId::RecordingsOverlay.title();
    let should_protect = should_protect_window(app, &title);

    let window = this
        .window_builder(app, "/recordings-overlay")
        .maximized(false)
        .resizable(false)
        .fullscreen(false)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .content_protected(should_protect)
        .inner_size(cursor_monitor.width, cursor_monitor.height)
        .skip_taskbar(true)
        .transparent(true)
        .build()?;
    lock_window_text_scale(&window);

    let _ = window.set_position(cursor_monitor.position(cursor_monitor.x, cursor_monitor.y));

    // The build-time inner_size above was interpreted with the DPI of
    // whatever monitor the window materialized on; now that it sits on the
    // cursor monitor, re-apply the logical size so it converts with that
    // monitor's scale, then verify against the expected physical size.
    #[cfg(windows)]
    {
        let _ = window.set_size(LogicalSize::new(
            cursor_monitor.width,
            cursor_monitor.height,
        ));
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;

        let expected_physical_width = (cursor_monitor.width * cursor_monitor.scale).round();
        match window.inner_size() {
            Ok(actual_physical_size)
                if expected_physical_width != actual_physical_size.width as f64 =>
            {
                let _ = window.set_size(LogicalSize::new(
                    cursor_monitor.width,
                    cursor_monitor.height,
                ));
            }
            Ok(_) => {}
            Err(err) => {
                warn!(%err, "Failed to read recordings overlay inner size");
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread({
            let window = window.clone();
            move || {
                use crate::panel_manager::try_to_panel;
                use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;

                let panel = match try_to_panel(&window) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::error!("Failed to convert recordings overlay to panel: {}", e);
                        return;
                    }
                };

                panel.set_level(cocoa::appkit::NSMainMenuWindowLevel);

                panel.set_collection_behaviour(
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorTransient
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorMoveToActiveSpace
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle,
                );

                #[allow(non_upper_case_globals)]
                const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
                panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);
            }
        })
        .ok();
    }

    fake_window::spawn_fake_window_listener(app.clone(), window.clone());

    Ok(window)
}
