use super::*;

pub(crate) fn lock_window_text_scale(_window: &WebviewWindow<Wry>) {
    #[cfg(windows)]
    {
        let scale_factor = match _window.scale_factor() {
            Ok(scale_factor) => scale_factor,
            Err(e) => {
                warn!("Failed to read window scale factor: {}", e);
                return;
            }
        };

        if let Err(e) = _window.with_webview(move |webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller3;
            use windows_core::Interface;

            let controller = webview.controller();

            if let Err(e) = controller.SetZoomFactor(1.0) {
                warn!("Failed to lock WebView zoom factor: {}", e);
            }

            let Ok(controller3) = controller.cast::<ICoreWebView2Controller3>() else {
                warn!("Failed to access WebView2 controller scale APIs");
                return;
            };

            if let Err(e) = controller3.SetShouldDetectMonitorScaleChanges(false) {
                warn!("Failed to disable WebView scale detection: {}", e);
            }

            if let Err(e) = controller3.SetRasterizationScale(scale_factor) {
                warn!("Failed to lock WebView rasterization scale: {}", e);
            }
        }) {
            warn!("Failed to access platform WebView: {}", e);
        }
    }
}

/// `lock_window_text_scale` disables WebView2's own monitor-scale detection
/// (so the Windows text-size setting can't zoom the UI), which also stops it
/// following per-monitor DPI. The new scale factor must be forwarded here on
/// every `ScaleFactorChanged`, or a window dragged to a monitor with
/// different scaling keeps rasterizing and laying out at the old DPI.
pub fn update_window_rasterization_scale(_window: &WebviewWindow<Wry>, _scale_factor: f64) {
    #[cfg(windows)]
    {
        if let Err(e) = _window.with_webview(move |webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller3;
            use windows_core::Interface;

            let controller = webview.controller();

            let Ok(controller3) = controller.cast::<ICoreWebView2Controller3>() else {
                warn!("Failed to access WebView2 controller scale APIs");
                return;
            };

            if let Err(e) = controller3.SetRasterizationScale(_scale_factor) {
                warn!("Failed to update WebView rasterization scale: {}", e);
            }
        }) {
            warn!("Failed to access platform WebView: {}", e);
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn add_traffic_lights(
    window: &WebviewWindow<Wry>,
    controls_inset: Option<LogicalPosition<f64>>,
) {
    use crate::platform::delegates;

    let target_window = window.clone();
    window
        .run_on_main_thread(move || {
            delegates::setup(
                target_window.as_ref().window(),
                controls_inset.unwrap_or(DEFAULT_TRAFFIC_LIGHTS_INSET),
            );

            let c_win = target_window.clone();
            target_window.on_window_event(move |event| match event {
                tauri::WindowEvent::ThemeChanged(..) | tauri::WindowEvent::Focused(..) => {
                    position_traffic_lights_impl(&c_win.as_ref().window(), controls_inset);
                }
                _ => {}
            });
        })
        .ok();
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(window))]
pub fn set_theme(window: tauri::Window, theme: AppTheme) {
    let _ = window.set_theme(match theme {
        AppTheme::System => None,
        AppTheme::Light => Some(tauri::Theme::Light),
        AppTheme::Dark => Some(tauri::Theme::Dark),
    });

    #[cfg(target_os = "macos")]
    match WindowId::from_str(window.label()) {
        Ok(win) if win.traffic_lights_position().is_some() => position_traffic_lights(window, None),
        Ok(_) | Err(_) => {}
    }
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(_window))]
pub fn position_traffic_lights(_window: tauri::Window, _controls_inset: Option<(f64, f64)>) {
    #[cfg(target_os = "macos")]
    position_traffic_lights_impl(
        &_window,
        _controls_inset.map(LogicalPosition::from).or_else(|| {
            // Attempt to get the default inset from the window's traffic lights position
            WindowId::from_str(_window.label())
                .ok()
                .and_then(|id| id.traffic_lights_position().flatten())
        }),
    );
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(_window))]
pub fn set_teleprompter_window_level(_window: tauri::Window, _always_on_top: bool) {
    #[cfg(target_os = "macos")]
    if _window.label() == WindowId::Teleprompter.to_string() {
        let level = if _always_on_top {
            TELEPROMPTER_PANEL_LEVEL
        } else {
            objc2_app_kit::NSNormalWindowLevel
        };
        crate::platform::set_window_level(_window, level);
    }

    #[cfg(not(target_os = "macos"))]
    if _window.label() == WindowId::Teleprompter.to_string()
        && let Err(error) = _window.set_always_on_top(_always_on_top)
    {
        warn!(?error, "Failed to update teleprompter window level");
    }
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(_window))]
pub fn set_teleprompter_window_opacity(_window: tauri::Window, _opacity: f64) {
    #[cfg(target_os = "macos")]
    if _window.label() == WindowId::Teleprompter.to_string() {
        crate::platform::set_window_opacity(_window, _opacity);
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn position_traffic_lights_impl(
    window: &tauri::Window,
    controls_inset: Option<LogicalPosition<f64>>,
) {
    use crate::platform::delegates::{UnsafeWindowHandle, position_window_controls};
    let c_win = window.clone();
    window
        .run_on_main_thread(move || {
            let ns_window = match c_win.ns_window() {
                Ok(handle) => handle,
                Err(_) => return,
            };
            position_window_controls(
                UnsafeWindowHandle(ns_window),
                &controls_inset.unwrap_or(DEFAULT_TRAFFIC_LIGHTS_INSET),
            );
        })
        .ok();
}

#[specta::specta]
#[tauri::command(async)]
#[instrument(skip(_window))]
pub async fn apply_macos_liquid_glass_background(
    _window: tauri::Window,
    _enabled: bool,
    _radius: f64,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let window = _window.clone();
        let (tx, rx) = tokio::sync::oneshot::channel();

        _window
            .run_on_main_thread(move || {
                let result = if window.label() == WindowId::Main.label() {
                    crate::platform::apply_main_window_liquid_glass_background(
                        &window, _enabled, _radius,
                    )
                } else {
                    crate::platform::apply_liquid_glass_background(&window, _enabled, _radius)
                };
                let _ = tx.send(result);
            })
            .map_err(|error| error.to_string())?;

        return rx
            .await
            .map_err(|_| "macOS Liquid Glass task was cancelled".to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

#[specta::specta]
#[tauri::command(async)]
#[instrument(skip(_window))]
pub fn set_window_transparent(_window: tauri::Window, _value: bool) {
    #[cfg(target_os = "macos")]
    {
        let ns_win = _window
            .ns_window()
            .expect("Failed to get native window handle")
            as *const objc2_app_kit::NSWindow;

        unsafe {
            (*ns_win).setOpaque(!_value);
        }
    }
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app))]
pub async fn is_camera_window_open(app: AppHandle<Wry>) -> bool {
    WindowId::Camera
        .get(&app)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}
