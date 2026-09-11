use crate::windows::*;

pub(crate) async fn try_reuse(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
) -> Option<tauri::Result<WebviewWindow>> {
    if let ShowQuiroWindow::Camera { centered } = this {
        #[cfg(target_os = "macos")]
        {
            let panel_manager = app.state::<PanelManager>();
            let mut panel_state = panel_manager.get_state(PanelWindowType::Camera).await;

            if panel_state == PanelState::Destroying {
                debug!("Camera window is being destroyed, waiting...");
                let wait_result = panel_manager
                    .wait_for_state(
                        PanelWindowType::Camera,
                        &[PanelState::None],
                        std::time::Duration::from_millis(500),
                    )
                    .await;

                if !wait_result {
                    warn!("Camera destroy wait timed out, force resetting state");
                    panel_manager.force_reset(PanelWindowType::Camera).await;
                }
                panel_state = panel_manager.get_state(PanelWindowType::Camera).await;
            }

            if panel_state == PanelState::Creating {
                debug!("Camera window is being created, waiting...");
                panel_manager
                    .wait_for_state(
                        PanelWindowType::Camera,
                        &[PanelState::Ready],
                        std::time::Duration::from_millis(500),
                    )
                    .await;
            }
        }

        if let Some(window) = this.id().get(app) {
            #[cfg(target_os = "macos")]
            {
                use crate::panel_manager::is_window_handle_valid;

                let handle_valid = is_window_handle_valid(&window);

                if !handle_valid {
                    warn!(
                        "Camera window exists but handle is invalid, destroying and recreating..."
                    );
                    let cleanup_success =
                        cleanup_camera_window(app, Some(&window), true, true).await;
                    if !cleanup_success {
                        warn!(
                            "Camera window still in registry after cleanup attempts, will retry later"
                        );
                        return Some(Err(tauri::Error::WindowNotFound));
                    }
                    debug!("Camera window successfully removed from registry");
                } else {
                    let panel_manager = app.state::<PanelManager>();
                    let mut panel_state = panel_manager.get_state(PanelWindowType::Camera).await;

                    if panel_state == PanelState::Creating {
                        debug!("Camera window valid but state is Creating, waiting for completion");
                        panel_manager
                            .wait_for_state(
                                PanelWindowType::Camera,
                                &[PanelState::Ready, PanelState::None],
                                std::time::Duration::from_millis(1000),
                            )
                            .await;
                        panel_state = panel_manager.get_state(PanelWindowType::Camera).await;
                    }

                    if panel_state != PanelState::Ready {
                        debug!(
                            "Camera window exists but panel state is {:?}, updating to Ready",
                            panel_state
                        );
                        panel_manager.force_reset(PanelWindowType::Camera).await;
                        panel_manager.mark_ready(PanelWindowType::Camera, 0).await;
                    }

                    let Some(state) = app.try_state::<ArcLock<App>>() else {
                        warn!("App state unavailable while showing camera window");
                        return Some(Err(tauri::Error::WindowNotFound));
                    };
                    let mut app_state = state.write().await;

                    let enable_native_camera_preview =
                        GeneralSettingsStore::native_camera_preview_enabled(app);

                    let shutdown_preview = if !enable_native_camera_preview {
                        app_state.camera_preview.begin_shutdown()
                    } else {
                        None
                    };

                    ensure_camera_input_active(&mut app_state).await;

                    if enable_native_camera_preview
                        && let Err(err) =
                            init_native_camera_preview(&mut app_state, window.clone()).await
                    {
                        error!("Error reinitializing camera preview for existing window: {err}");
                    }

                    drop(app_state);

                    if let Some(rx) = shutdown_preview {
                        let _ = tokio::time::timeout(Duration::from_millis(500), rx).await;
                    }

                    let (show_tx, show_rx) = tokio::sync::oneshot::channel();
                    app.run_on_main_thread({
                        let window = window.clone();
                        move || {
                            use crate::panel_manager::try_to_panel;

                            // IMPORTANT: We intentionally use window.show() + set_focus() here
                            // instead of panel.order_front_regardless().
                            //
                            // order_front_regardless() was found to cause a crash after ~4-5
                            // camera toggle cycles due to macOS internal state accumulation.
                            // The crash manifested as a hard crash in the Metal/CAMetalLayer
                            // subsystem, not in our Rust code.
                            //
                            // Using standard Tauri window APIs avoids this macOS-specific issue
                            // while still properly showing and focusing the camera preview window.
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = show_tx.send(true);
                        }
                    })
                    .ok();

                    let show_result = show_rx.await.unwrap_or(false);

                    if show_result {
                        if *centered {
                            center_camera_window(app, &window);
                        }
                        return Some(Ok(window));
                    } else {
                        warn!("Camera panel show failed, will recreate window");
                        let cleanup_success =
                            cleanup_camera_window(app, Some(&window), true, true).await;
                        if !cleanup_success {
                            warn!(
                                "Camera window still in registry after show failure, will retry later"
                            );
                            return Some(Err(tauri::Error::WindowNotFound));
                        }
                        debug!("Camera window successfully removed after show failure");
                    }
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                let Some(state) = app.try_state::<ArcLock<App>>() else {
                    warn!("App state unavailable while showing camera window");
                    return Some(Err(tauri::Error::WindowNotFound));
                };
                let mut app_state = state.write().await;

                let enable_native_camera_preview =
                    GeneralSettingsStore::native_camera_preview_enabled(app);

                let shutdown_preview = if !enable_native_camera_preview {
                    app_state.camera_preview.begin_shutdown()
                } else {
                    None
                };

                ensure_camera_input_active(&mut app_state).await;

                if enable_native_camera_preview
                    && let Err(err) =
                        init_native_camera_preview(&mut app_state, window.clone()).await
                {
                    error!("Error reinitializing camera preview for existing window: {err}");
                }

                drop(app_state);

                if let Some(rx) = shutdown_preview {
                    let _ = tokio::time::timeout(Duration::from_millis(500), rx).await;
                }

                if *centered {
                    center_camera_window(app, &window);
                }
                window.show().ok();
                window.set_focus().ok();
                return Some(Ok(window));
            }
        }
    }

    None
}

pub(crate) async fn show_camera(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    centered: &bool,
    camera_window_label: Option<String>,
    cursor_monitor: CursorMonitorInfo,
) -> tauri::Result<WebviewWindow> {
    const DEFAULT_WINDOW_SIZE: f64 = 230.0 * 2.0;
    const CENTERED_WINDOW_SIZE: f64 = 400.0;

    #[cfg(target_os = "macos")]
    let create_guard = {
        let panel_manager = app.state::<PanelManager>();
        panel_manager
            .try_begin_create(PanelWindowType::Camera)
            .await
    };

    #[cfg(target_os = "macos")]
    let Some(mut create_guard) = create_guard else {
        let panel_manager = app.state::<PanelManager>();
        let state = panel_manager.get_state(PanelWindowType::Camera).await;
        warn!("Camera window creation blocked, current state: {:?}", state);
        if state == PanelState::Ready
            && let Some(window) = WindowId::Camera.get(app)
        {
            if *centered {
                center_camera_window(app, &window);
            }
            return Ok(window);
        }
        panel_manager
            .wait_for_state(
                PanelWindowType::Camera,
                &[PanelState::Ready, PanelState::None],
                std::time::Duration::from_millis(500),
            )
            .await;
        if let Some(window) = WindowId::Camera.get(app) {
            if *centered {
                center_camera_window(app, &window);
            }
            return Ok(window);
        }
        return Err(tauri::Error::WindowNotFound);
    };

    let enable_native_camera_preview = GeneralSettingsStore::native_camera_preview_enabled(app);

    {
        let Some(state) = app.try_state::<ArcLock<App>>() else {
            warn!("App state unavailable while creating camera window");
            return Err(tauri::Error::WindowNotFound);
        };
        let mut state = state.write().await;

        let shutdown_preview =
            if !enable_native_camera_preview && state.camera_preview.is_initialized() {
                state.camera_preview.begin_shutdown()
            } else {
                None
            };

        if enable_native_camera_preview && state.camera_preview.is_initialized() {
            warn!("Detected existing camera preview, will reuse it");
        }

        let should_protect = should_protect_window(app, &WindowId::Camera.title());

        #[cfg(target_os = "macos")]
        let panel_activation_guard = permissions::prepare_macos_panel_window(app);

        let label = camera_window_label
            .clone()
            .unwrap_or_else(|| WindowId::Camera.label());
        let mut window_builder = this
            .window_builder_with_label(app, "/camera", label)
            .maximized(false)
            .resizable(false)
            .shadow(false)
            .fullscreen(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .initialization_script(format!(
                "
			                window.__QUIRO__ = window.__QUIRO__ ?? {{}};
			                window.__QUIRO__.cameraWsPort = {};
			                window.__QUIRO__.cameraOnlyMode = {};
			                window.__QUIRO__.enableNativeCameraPreview = {};
		                ",
                state.camera_ws_port, centered, enable_native_camera_preview
            ))
            .content_protected(should_protect)
            .transparent(true)
            .visible(false);

        let window = match window_builder.build() {
            Ok(w) => w,
            Err(e) => {
                let is_label_exists = e.to_string().contains("already exists");
                if is_label_exists {
                    warn!("Camera webview label already exists, cleaning up for next attempt");
                    cleanup_camera_window(app, None, false, false).await;
                }

                #[cfg(target_os = "macos")]
                {
                    let panel_manager = app.state::<PanelManager>();
                    panel_manager.force_reset(PanelWindowType::Camera).await;
                }
                return Err(e);
            }
        };
        lock_window_text_scale(&window);

        #[cfg(target_os = "windows")]
        log_window_content_protection(&window, should_protect, &WindowId::Camera.title());

        let camera_monitor = WindowId::Main
            .get(app)
            .map(|w| CursorMonitorInfo::from_window(&w))
            .unwrap_or(cursor_monitor);

        let preferred_monitor_name = display_name_for_position(
            camera_monitor.x + camera_monitor.width / 2.0,
            camera_monitor.y + camera_monitor.height / 2.0,
        );

        let saved_position = GeneralSettingsStore::get(app)
            .ok()
            .flatten()
            .and_then(|settings| {
                if let Some(monitor_name) = preferred_monitor_name.as_deref() {
                    settings
                        .camera_window_positions_by_monitor_name
                        .get(monitor_name)
                        .cloned()
                        .filter(|pos| is_position_on_monitor_name(monitor_name, pos.x, pos.y))
                        .or_else(|| {
                            settings.camera_window_position.filter(|pos| {
                                is_position_on_monitor_name(monitor_name, pos.x, pos.y)
                            })
                        })
                } else {
                    settings.camera_window_position.filter(|pos| {
                        if let Some(display_id) = &pos.display_id {
                            is_position_on_display(display_id, pos.x, pos.y)
                        } else {
                            is_position_on_any_screen(pos.x, pos.y)
                        }
                    })
                }
            });

        let camera_position = if let Some(pos) = saved_position {
            match display_for_saved_position(pos.x, pos.y, pos.display_id.as_ref()) {
                Some(display) => CursorMonitorInfo::from_display(&display).position(pos.x, pos.y),
                None => tauri::Position::Logical(tauri::LogicalPosition::new(pos.x, pos.y)),
            }
        } else if *centered {
            let aspect_ratio = crate::camera::WIDE_CAMERA_ASPECT_RATIO as f64;
            let toolbar_height = 56.0;
            let window_width = CENTERED_WINDOW_SIZE * aspect_ratio;
            let window_height = CENTERED_WINDOW_SIZE + toolbar_height;
            let (camera_pos_x, camera_pos_y) =
                camera_monitor.center_position(window_width, window_height);
            camera_monitor.position(camera_pos_x, camera_pos_y)
        } else {
            let camera_pos_x =
                camera_monitor.x + camera_monitor.width - DEFAULT_WINDOW_SIZE - 100.0;
            let camera_pos_y =
                camera_monitor.y + camera_monitor.height - DEFAULT_WINDOW_SIZE - 100.0;
            camera_monitor.position(camera_pos_x, camera_pos_y)
        };

        #[cfg(not(target_os = "macos"))]
        {
            if let Some(guard) = app.try_state::<CameraWindowPositionGuard>() {
                guard.ignore_for(1000);
            }
            let _ = window.set_position(camera_position);
        }

        ensure_camera_input_active(&mut state).await;

        #[cfg(target_os = "macos")]
        {
            let panel_manager = app.state::<PanelManager>();
            let operation_id = create_guard.operation_id;

            let (panel_tx, panel_rx) = tokio::sync::oneshot::channel();
            app.run_on_main_thread({
                            let window = window.clone();
                            let app = app.clone();
                            let panel_activation_guard = panel_activation_guard;
                            move || {
                                let _panel_activation_guard = panel_activation_guard;
                                use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
                                use tauri_nspanel::panel_delegate;
                                use crate::panel_manager::try_to_panel;

                                #[link(name = "CoreGraphics", kind = "framework")]
                                unsafe extern "C" {
                                    fn CGWindowLevelForKey(key: i32) -> i32;
                                }

                                #[allow(non_upper_case_globals)]
                                const kCGMaximumWindowLevelKey: i32 = 10;

                                let delegate = panel_delegate!(CameraPanelDelegate {
                                    window_did_become_key,
                                    window_did_resign_key
                                });

                                delegate.set_listener(Box::new(|_delegate_name: String| {}));

                                let panel = match try_to_panel(&window) {
                                    Ok(p) => p,
                                    Err(e) => {
                                        tracing::error!("Failed to convert camera to panel: {}", e);
                                        crate::permissions::sync_macos_dock_visibility(&app);
                                        let _ = panel_tx.send(false);
                                        return;
                                    }
                                };

                                panel.set_collection_behaviour(
                                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenPrimary,
                                );

                                panel.set_delegate(delegate);

                                let max_level =
                                    unsafe { CGWindowLevelForKey(kCGMaximumWindowLevelKey) };
                                panel.set_level(max_level);

                                if let Some(guard) = app.try_state::<CameraWindowPositionGuard>() {
                                    guard.ignore_for(1000);
                                }
                                let _ = window.set_position(camera_position);

                                panel.order_front_regardless();
                                panel.show();
                                crate::permissions::schedule_macos_dock_visibility_sync(&app);
                                let _ = panel_tx.send(true);
                            }
                        })
                        .ok();

            if panel_rx.await.unwrap_or(false) {
                panel_manager
                    .mark_ready(PanelWindowType::Camera, operation_id)
                    .await;
                create_guard.mark_completed();
            } else {
                warn!("Camera panel creation failed");
                panel_manager.force_reset(PanelWindowType::Camera).await;
            }
        }

        if enable_native_camera_preview
            && let Err(err) = init_native_camera_preview(&mut state, window.clone()).await
        {
            error!("Error initializing camera preview, falling back to WebSocket preview: {err}");
        }

        #[cfg(not(target_os = "macos"))]
        {
            window.show().ok();
        }

        drop(state);

        if let Some(rx) = shutdown_preview {
            let _ = tokio::time::timeout(Duration::from_millis(500), rx).await;
        }

        Ok(window)
    }
}
