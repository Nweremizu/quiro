use super::*;

#[derive(Debug, Clone, Type, Deserialize)]
pub enum ShowQuiroWindow {
    Main {
        init_target_mode: Option<RecordingTargetMode>,
    },
    Settings {
        page: Option<String>,
    },
    RecordingsOverlay,
    WindowCaptureOccluder {
        screen_id: DisplayId,
        /// Display-relative bounds of the window/area being recorded — the
        /// occluder blacks out everything on the display *outside* this
        /// rect. `None` blacks out nothing (rather than the whole display),
        /// since a target whose bounds couldn't be resolved is the one case
        /// where covering the entire screen would be actively misleading.
        target_bounds: Option<LogicalBounds>,
    },
    TargetSelectOverlay {
        display_id: DisplayId,
        target_mode: Option<RecordingTargetMode>,
    },
    CaptureArea {
        screen_id: DisplayId,
    },
    Camera {
        centered: bool,
    },
    InProgressRecording {
        countdown: Option<u32>,
        #[serde(default)]
        capture_target: Option<ScreenCaptureTarget>,
    },
    ModeSelect,
    Onboarding,
    Debug,
    ScreenshotEditor {
        path: PathBuf,
    },
    Editor {
        path: PathBuf,
    },
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app))]
pub async fn show_window(app: AppHandle<Wry>, window: ShowQuiroWindow) {
    if let Err(err) = window.show(&app).await {
        error!(?err, "Failed to show window");
    }
}

impl ShowQuiroWindow {
    pub async fn show(&self, app: &AppHandle<Wry>) -> tauri::Result<WebviewWindow> {
        if matches!(self, Self::Main { .. }) && crate::should_show_onboarding(app) {
            return Box::pin(Self::Onboarding.show(app)).await;
        }

        let camera_window_label = if matches!(self, Self::Camera { .. }) {
            Some(camera_window_label_for_session(bump_camera_window_session(
                app,
            )))
        } else {
            None
        };

        // Before the reuse checks below, so focusing an already-open editor
        // hides the main window just like opening a new one does.
        if matches!(self, Self::Editor { .. } | Self::ScreenshotEditor { .. }) {
            hide_main_window_for_editor(app);
        }

        if let Some(result) = variants::camera::try_reuse(self, app).await {
            return result;
        }

        if let Some(result) = variants::screenshot_editor::try_reuse(self, app).await {
            return result;
        }

        if let Some(result) = variants::editor::try_reuse(self, app).await {
            return result;
        }

        if matches!(self, Self::Settings { .. }) {
            remember_settings_origin(app);
            hide_recording_windows(app, true);
            release_camera_preview_if_idle(app);
        }

        if let Some(result) = variants::recording_controls::try_reuse(self, app).await {
            return result;
        }

        if let Some(result) = variants::try_reuse_existing(self, app).await {
            return result;
        }

        let _id = self.id();
        let cursor_monitor = CursorMonitorInfo::get();

        let window = match self {
            Self::Main { init_target_mode } => {
                variants::main_window::show_main(self, app, init_target_mode, cursor_monitor)
                    .await?
            }
            Self::TargetSelectOverlay {
                display_id,
                target_mode,
            } => {
                variants::overlays::show_target_select_overlay(self, app, display_id, target_mode)
                    .await?
            }
            Self::Settings { page } => {
                variants::main_window::show_settings(self, app, page, cursor_monitor)
                    .await
                    .inspect_err(|_| restore_main_window_after_settings(app))?
            }
            Self::ModeSelect => {
                variants::main_window::show_mode_select(self, app, cursor_monitor).await?
            }
            Self::Onboarding => {
                if let Some(main) = WindowId::Main.get(app) {
                    let _ = main.hide();
                }

                let width = (cursor_monitor.width * 0.58).clamp(860.0, 1080.0);
                let height = (width * 0.72).clamp(690.0, 780.0);
                let window = self
                    .window_builder(app, "/onboarding")
                    .inner_size(width, height)
                    .min_inner_size(860.0, 690.0)
                    .resizable(false)
                    .maximized(false)
                    .maximizable(false)
                    .transparent(true)
                    .focused(true)
                    .shadow(true)
                    .build()?;
                lock_window_text_scale(&window);

                let (pos_x, pos_y) = cursor_monitor.center_position(width, height);
                let _ = window.set_position(cursor_monitor.position(pos_x, pos_y));
                window.show().ok();
                window.set_focus().ok();
                window
            }
            Self::Debug => {
                let width = 900.0;
                let height = 700.0;
                let window = self
                    .window_builder(app, "/debug")
                    .inner_size(width, height)
                    .min_inner_size(720.0, 520.0)
                    .resizable(true)
                    .maximized(false)
                    .focused(true)
                    .build()?;
                lock_window_text_scale(&window);

                let (pos_x, pos_y) = cursor_monitor.center_position(width, height);
                let _ = window.set_position(cursor_monitor.position(pos_x, pos_y));
                window.show().ok();
                window.set_focus().ok();
                window
            }
            // Both editors restore the main window if their own window fails
            // to appear — it was hidden above on the assumption one would.
            Self::ScreenshotEditor { path } => {
                variants::screenshot_editor::show_screenshot_editor(self, app, path)
                    .await
                    .inspect_err(|_| restore_main_window_after_editor(app, ""))?
            }
            Self::Editor { path } => variants::editor::show_editor(self, app, path)
                .await
                .inspect_err(|_| restore_main_window_after_editor(app, ""))?,
            Self::Camera { centered } => {
                variants::camera::show_camera(
                    self,
                    app,
                    centered,
                    camera_window_label,
                    cursor_monitor,
                )
                .await?
            }
            Self::WindowCaptureOccluder {
                screen_id,
                target_bounds,
            } => {
                variants::overlays::show_window_capture_occluder(
                    self,
                    app,
                    screen_id,
                    *target_bounds,
                )
                .await?
            }
            Self::CaptureArea { screen_id } => {
                variants::overlays::show_capture_area(self, app, screen_id).await?
            }
            Self::InProgressRecording {
                countdown,
                capture_target,
            } => {
                variants::recording_controls::show_in_progress_recording(
                    self,
                    app,
                    countdown,
                    capture_target,
                    cursor_monitor,
                )
                .await?
            }
            Self::RecordingsOverlay => {
                variants::overlays::show_recordings_overlay(self, app, cursor_monitor).await?
            }
        };

        // removing this for now as it causes windows to just stay hidden sometimes -_-
        // window.hide().ok();

        // Only reached on first creation — a reused window (see the
        // try_reuse/try_reuse_existing calls above) already has this from
        // when it was first shown.
        {
            let rasterization_window = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::ScaleFactorChanged { scale_factor, .. } = event {
                    update_window_rasterization_scale(&rasterization_window, *scale_factor);
                }
            });
        }

        #[cfg(target_os = "macos")]
        if let Some(position) = _id.traffic_lights_position() {
            add_traffic_lights(&window, position);
        }

        #[cfg(target_os = "macos")]
        if _id.activates_dock() {
            crate::permissions::sync_macos_dock_visibility(app);
        }

        Ok(window)
    }

    pub(crate) fn window_builder<'a>(
        &'a self,
        app: &'a AppHandle<Wry>,
        url: impl Into<PathBuf>,
    ) -> WebviewWindowBuilder<'a, Wry, AppHandle<Wry>> {
        let id = self.id();
        self.window_builder_with_label(app, url, id.label())
    }

    pub(crate) fn window_builder_with_label<'a>(
        &'a self,
        app: &'a AppHandle<Wry>,
        url: impl Into<PathBuf>,
        label: impl Into<String>,
    ) -> WebviewWindowBuilder<'a, Wry, AppHandle<Wry>> {
        let id = self.id();

        let settings = GeneralSettingsStore::get(app).ok().flatten();
        let window_transparency_enabled = settings
            .as_ref()
            .map(|s| s.window_transparency)
            .unwrap_or(false);
        let theme = settings
            .map(|s| match s.theme {
                AppTheme::System => None,
                AppTheme::Light => Some(tauri::Theme::Light),
                AppTheme::Dark => Some(tauri::Theme::Dark),
            })
            .unwrap_or(None);

        let mut builder = WebviewWindow::builder(app, label, WebviewUrl::App(url.into()))
            .title(id.title())
            .visible(false)
            .accept_first_mouse(true)
            .shadow(true)
            .theme(theme)
            .devtools(cfg!(debug_assertions));

        if !id.is_transparent() {
            let is_dark = match theme {
                Some(tauri::Theme::Dark) => true,
                Some(tauri::Theme::Light) => false,
                None | Some(_) => is_system_dark_mode(),
            };

            let bg_color = if is_dark { "#141414" } else { "#ffffff" };
            // An initialization script runs at document-start, where
            // `document.documentElement` can still be null — appending to it
            // unconditionally threw "Cannot read properties of null" and left
            // the window unthemed. Retry on readystatechange when that happens.
            let init_script = format!(
                r#"(function(){{var a=function(){{var r=document.head||document.documentElement;if(!r)return false;var s=document.createElement('style');s.textContent='html,body{{background-color:{bg_color}}}';r.appendChild(s);return true;}};if(!a())document.addEventListener('readystatechange',function h(){{if(a())document.removeEventListener('readystatechange',h);}});}})();"#
            );
            builder = builder.initialization_script(&init_script);

            // Native backing color so the window is themed before the webview's
            // first paint, allowing windows to be shown immediately without a
            // white/black flash. Skipped when the user has window transparency
            // enabled: an opaque native background would sit behind the
            // translucent webview content and defeat the effect.
            if !window_transparency_enabled {
                let native_bg = if is_dark {
                    tauri::window::Color(0x14, 0x14, 0x14, 0xff)
                } else {
                    tauri::window::Color(0xff, 0xff, 0xff, 0xff)
                };
                builder = builder.background_color(native_bg);
            }
        }

        if let Some(min) = id.min_size() {
            builder = builder
                .inner_size(min.0, min.1)
                .min_inner_size(min.0, min.1);
        }

        #[cfg(target_os = "macos")]
        {
            if id.traffic_lights_position().is_some() {
                builder = builder
                    .hidden_title(true)
                    .title_bar_style(tauri::TitleBarStyle::Overlay);
            } else {
                builder = builder.decorations(false)
            }
        }

        #[cfg(windows)]
        {
            let browser_args = windows_webview2_browser_args();
            let browser_args_json = serde_json::to_string(&browser_args)
                .expect("Failed to serialize Windows WebView2 browser arguments");
            builder = builder
                .decorations(false)
                .zoom_hotkeys_enabled(false)
                .additional_browser_args(&browser_args)
                .initialization_script(format!(
                    "window.__QUIRO__ = window.__QUIRO__ ?? {{}}; window.__QUIRO__.windowsWebview2BrowserArgs = {browser_args_json};"
                ));
        }

        // Linux has no native macOS-style traffic lights, so we drop the window
        // manager decorations and draw our own chrome (matching the macOS layout).
        #[cfg(target_os = "linux")]
        {
            builder = builder.decorations(false);
        }

        builder
    }

    pub fn id(&self) -> WindowId {
        match self {
            ShowQuiroWindow::Main { .. } => WindowId::Main,
            ShowQuiroWindow::Settings { .. } => WindowId::Settings,
            ShowQuiroWindow::RecordingsOverlay => WindowId::RecordingsOverlay,
            ShowQuiroWindow::TargetSelectOverlay { display_id, .. } => {
                WindowId::TargetSelectOverlay {
                    display_id: display_id.clone(),
                }
            }
            ShowQuiroWindow::WindowCaptureOccluder { screen_id, .. } => {
                WindowId::WindowCaptureOccluder {
                    screen_id: screen_id.clone(),
                }
            }
            ShowQuiroWindow::CaptureArea { .. } => WindowId::CaptureArea,
            ShowQuiroWindow::Camera { .. } => WindowId::Camera,
            ShowQuiroWindow::InProgressRecording { .. } => WindowId::RecordingControls,
            ShowQuiroWindow::ModeSelect => WindowId::ModeSelect,
            ShowQuiroWindow::Onboarding => WindowId::Onboarding,
            ShowQuiroWindow::Debug => WindowId::Debug,
            ShowQuiroWindow::ScreenshotEditor { .. } => WindowId::ScreenshotEditor,
            ShowQuiroWindow::Editor { .. } => WindowId::Editor,
        }
    }
}
