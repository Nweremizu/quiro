use super::*;

pub(crate) const DEFAULT_FALLBACK_DISPLAY_WIDTH: f64 = 1920.0;
pub(crate) const DEFAULT_FALLBACK_DISPLAY_HEIGHT: f64 = 1080.0;

pub(crate) struct CursorMonitorInfo {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    // On Windows each monitor's "logical" rect is its physical rect divided by
    // its own scale, so logical rects of mixed-DPI monitors overlap and tao's
    // LogicalPosition conversion (which uses whatever monitor the window
    // currently occupies) can land a window on the wrong monitor. Positioning
    // must go through this monitor's own scale, as a physical position.
    #[cfg(windows)]
    pub(crate) scale: f64,
}

impl CursorMonitorInfo {
    pub(crate) fn get() -> Self {
        Self::from_display(&Display::get_containing_cursor().unwrap_or_else(Display::primary))
    }

    pub(crate) fn from_display(display: &Display) -> Self {
        let bounds = display.raw_handle().logical_bounds();

        #[cfg(windows)]
        let scale = bounds
            .as_ref()
            .map(|b| b.size().width())
            .filter(|width| *width > 0.0)
            .and_then(|logical_width| {
                display
                    .physical_size()
                    .map(|physical| physical.width() / logical_width)
            })
            .filter(|scale| scale.is_finite() && *scale > 0.0)
            .unwrap_or(1.0);

        let (x, y, width, height) = bounds
            .map(|b| {
                (
                    b.position().x(),
                    b.position().y(),
                    b.size().width(),
                    b.size().height(),
                )
            })
            .unwrap_or((
                0.0,
                0.0,
                DEFAULT_FALLBACK_DISPLAY_WIDTH,
                DEFAULT_FALLBACK_DISPLAY_HEIGHT,
            ));

        Self {
            x,
            y,
            width,
            height,
            #[cfg(windows)]
            scale,
        }
    }

    /// Converts a global-logical point on this monitor into a `Position` that
    /// lands exactly there regardless of which monitor the window currently
    /// occupies. Logical on macOS/Linux (a true global space there), physical
    /// on Windows.
    pub(crate) fn position(&self, x: f64, y: f64) -> tauri::Position {
        #[cfg(windows)]
        return tauri::Position::Physical(tauri::PhysicalPosition::new(
            (x * self.scale).round() as i32,
            (y * self.scale).round() as i32,
        ));

        #[cfg(not(windows))]
        tauri::Position::Logical(tauri::LogicalPosition::new(x, y))
    }

    pub(crate) fn center_position(&self, window_width: f64, window_height: f64) -> (f64, f64) {
        let pos_x = self.x + (self.width - window_width) / 2.0;
        let pos_y = self.y + (self.height - window_height) / 2.0;
        (pos_x, pos_y)
    }

    pub(crate) fn bottom_center_position(
        &self,
        window_width: f64,
        window_height: f64,
        offset_y: f64,
    ) -> (f64, f64) {
        let pos_x = self.x + (self.width - window_width) / 2.0;
        let pos_y = self.y + self.height - window_height - offset_y;
        (pos_x, pos_y)
    }

    pub(crate) fn from_window(window: &tauri::WebviewWindow) -> Self {
        let Ok(window_pos) = window.outer_position() else {
            return Self::get();
        };

        // outer_position is physical. On Windows, resolve the display in
        // physical space (per-monitor logical rects overlap in mixed-DPI
        // layouts). On macOS, convert to logical points, a true global space.
        // On Linux scap reports logical bounds in unscaled physical units, so
        // the raw position compares directly.
        #[cfg(windows)]
        {
            let (pos_x, pos_y) = (window_pos.x as f64, window_pos.y as f64);
            for display in Display::list() {
                if let Some(bounds) = display.raw_handle().physical_bounds() {
                    let (x, y, width, height) = (
                        bounds.position().x(),
                        bounds.position().y(),
                        bounds.size().width(),
                        bounds.size().height(),
                    );

                    if pos_x >= x && pos_x < x + width && pos_y >= y && pos_y < y + height {
                        return Self::from_display(&display);
                    }
                }
            }

            Self::get()
        }

        #[cfg(target_os = "macos")]
        {
            let scale = window.scale_factor().unwrap_or(1.0);
            let pos = window_pos.to_logical::<f64>(scale);

            for display in Display::list() {
                if display_contains_logical(&display, pos.x, pos.y) {
                    return Self::from_display(&display);
                }
            }

            Self::get()
        }

        #[cfg(target_os = "linux")]
        {
            let (pos_x, pos_y) = (window_pos.x as f64, window_pos.y as f64);

            for display in Display::list() {
                if display_contains_logical(&display, pos_x, pos_y) {
                    return Self::from_display(&display);
                }
            }

            Self::get()
        }
    }
}

pub(crate) fn display_contains_logical(display: &Display, pos_x: f64, pos_y: f64) -> bool {
    display
        .raw_handle()
        .logical_bounds()
        .map(|bounds| {
            let (x, y, width, height) = (
                bounds.position().x(),
                bounds.position().y(),
                bounds.size().width(),
                bounds.size().height(),
            );

            pos_x >= x && pos_x < x + width && pos_y >= y && pos_y < y + height
        })
        .unwrap_or(false)
}

pub(crate) fn display_containing_logical(pos_x: f64, pos_y: f64) -> Option<Display> {
    Display::list()
        .into_iter()
        .find(|display| display_contains_logical(display, pos_x, pos_y))
}

/// Resolves the display a persisted window position belongs to, preferring the
/// display it was saved on. On Windows the saved logical coordinates are only
/// meaningful relative to that display (mixed-DPI logical rects overlap), so
/// restores must convert through its scale rather than the window's current one.
pub(crate) fn display_for_saved_position(
    pos_x: f64,
    pos_y: f64,
    display_id: Option<&DisplayId>,
) -> Option<Display> {
    display_id
        .and_then(Display::from_id)
        .filter(|display| display_contains_logical(display, pos_x, pos_y))
        .or_else(|| display_containing_logical(pos_x, pos_y))
}

/// Converts a global-logical point into a `Position` that lands exactly there,
/// resolving the owning display by containment when the caller doesn't know it.
/// Falls back to a plain logical position when no display contains the point.
pub fn logical_point_position(pos_x: f64, pos_y: f64) -> tauri::Position {
    #[cfg(windows)]
    if let Some(display) = display_containing_logical(pos_x, pos_y) {
        return CursorMonitorInfo::from_display(&display).position(pos_x, pos_y);
    }

    tauri::Position::Logical(tauri::LogicalPosition::new(pos_x, pos_y))
}

/// Outer window size for a given preview state. The preview itself is `size`
/// tall and 1:1 wide in Round/Square; only Full goes wide, at the camera's own
/// aspect ratio but never narrower than 16:9 (`frame_aspect` is None until the
/// first frame arrives, or on the native path which sizes itself). The toolbar
/// sits above the video in its own strip, so it adds to the height rather than
/// overlapping it.
pub(crate) fn camera_window_size_for_state(
    state: &crate::camera::CameraPreviewState,
    frame_aspect: Option<f32>,
) -> (f64, f64) {
    let toolbar_height = crate::camera::TOOLBAR_HEIGHT as f64;
    let size = state.size as f64;
    let wide = crate::camera::WIDE_CAMERA_ASPECT_RATIO;

    let window_width = if state.shape == crate::camera::CameraPreviewShape::Full {
        let aspect = frame_aspect
            .filter(|a| a.is_finite() && *a > 0.0)
            .map_or(wide, |a| a.max(wide));
        size * aspect as f64
    } else {
        size
    };

    (window_width, size + toolbar_height)
}

fn read_camera_preview_state(app: &AppHandle) -> crate::camera::CameraPreviewState {
    match app.try_state::<ArcLock<crate::App>>() {
        Some(state) => state
            .try_read()
            .ok()
            .and_then(|guard| guard.camera_preview.get_state().ok())
            .unwrap_or_default(),
        None => crate::camera::CameraPreviewState::default(),
    }
}

/// Resizes the camera window to match `state`, keeping it fully on its
/// current monitor, and tells the preview renderer about the new surface
/// size. Called whenever the toolbar changes size or shape.
pub(crate) fn resize_camera_window_for_state(
    app: &AppHandle,
    window: &WebviewWindow,
    state: &crate::camera::CameraPreviewState,
    frame_aspect: Option<f32>,
) {
    let (window_width, window_height) = camera_window_size_for_state(state, frame_aspect);

    // Growing near a screen edge would otherwise push the window partly
    // off-screen, where it can't be dragged back.
    let monitor_info = CursorMonitorInfo::from_window(window);
    let mut pos_x = monitor_info.x;
    let mut pos_y = monitor_info.y;
    if let Ok(outer) = window.outer_position()
        && let Ok(scale) = window.scale_factor()
    {
        let logical = outer.to_logical::<f64>(scale);
        pos_x = logical
            .x
            .min(monitor_info.x + monitor_info.width - window_width)
            .max(monitor_info.x);
        pos_y = logical
            .y
            .min(monitor_info.y + monitor_info.height - window_height)
            .max(monitor_info.y);
    }

    let _ = window.set_size(tauri::LogicalSize::new(window_width, window_height));
    if let Some(guard) = app.try_state::<CameraWindowPositionGuard>() {
        guard.ignore_for(600);
    }
    let _ = window.set_position(monitor_info.position(pos_x, pos_y));

    if let Some(app_state) = app.try_state::<ArcLock<crate::App>>()
        && let Ok(guard) = app_state.try_read()
    {
        guard
            .camera_preview
            .notify_window_resized(window_width as u32, window_height as u32);
    }
}

pub(crate) fn center_camera_window(app: &AppHandle, window: &WebviewWindow) {
    let camera_state = read_camera_preview_state(app);
    let (window_width, window_height) = camera_window_size_for_state(&camera_state, None);

    let monitor_info = CursorMonitorInfo::get();
    let (pos_x, pos_y) = monitor_info.center_position(window_width, window_height);

    let _ = window.set_size(tauri::LogicalSize::new(window_width, window_height));
    if let Some(guard) = app.try_state::<CameraWindowPositionGuard>() {
        guard.ignore_for(1000);
    }
    let _ = window.set_position(monitor_info.position(pos_x, pos_y));

    if let Some(state) = app.try_state::<ArcLock<crate::App>>()
        && let Ok(guard) = state.try_read()
    {
        guard
            .camera_preview
            .notify_window_resized(window_width as u32, window_height as u32);
    }
}

pub(crate) fn is_position_on_display(display_id: &DisplayId, pos_x: f64, pos_y: f64) -> bool {
    Display::from_id(display_id)
        .and_then(|display| display.raw_handle().logical_bounds())
        .map(|bounds| {
            let (x, y, width, height) = (
                bounds.position().x(),
                bounds.position().y(),
                bounds.size().width(),
                bounds.size().height(),
            );

            pos_x >= x && pos_x < x + width && pos_y >= y && pos_y < y + height
        })
        .unwrap_or(false)
}

pub(crate) fn display_name_for_position(pos_x: f64, pos_y: f64) -> Option<String> {
    Display::list().into_iter().find_map(|display| {
        let bounds = display.raw_handle().logical_bounds()?;
        let (x, y, width, height) = (
            bounds.position().x(),
            bounds.position().y(),
            bounds.size().width(),
            bounds.size().height(),
        );

        if pos_x >= x && pos_x < x + width && pos_y >= y && pos_y < y + height {
            display.name().filter(|name| !name.trim().is_empty())
        } else {
            None
        }
    })
}

pub(crate) fn is_position_on_monitor_name(monitor_name: &str, pos_x: f64, pos_y: f64) -> bool {
    Display::list().into_iter().any(|display| {
        if display.name().as_deref() != Some(monitor_name) {
            return false;
        }

        display
            .raw_handle()
            .logical_bounds()
            .map(|bounds| {
                let (x, y, width, height) = (
                    bounds.position().x(),
                    bounds.position().y(),
                    bounds.size().width(),
                    bounds.size().height(),
                );

                pos_x >= x && pos_x < x + width && pos_y >= y && pos_y < y + height
            })
            .unwrap_or(false)
    })
}

pub(crate) fn is_position_on_any_screen(pos_x: f64, pos_y: f64) -> bool {
    for display in Display::list() {
        if let Some(bounds) = display.raw_handle().logical_bounds() {
            let (x, y, width, height) = (
                bounds.position().x(),
                bounds.position().y(),
                bounds.size().width(),
                bounds.size().height(),
            );

            if pos_x >= x && pos_x < x + width && pos_y >= y && pos_y < y + height {
                return true;
            }
        }
    }
    false
}

// Recovers a window that ended up entirely off every connected display (e.g. the
// monitor it was on got disconnected), which otherwise leaves it open but unreachable.
pub(crate) fn recenter_window_if_offscreen(window: &WebviewWindow) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);

    let on_screen = Display::list()
        .iter()
        .any(|display| display.intersects(position, size, scale));
    if on_screen {
        return;
    }

    let monitor = CursorMonitorInfo::get();
    let (pos_x, pos_y) =
        monitor.center_position(size.width as f64 / scale, size.height as f64 / scale);
    let _ = window.set_position(monitor.position(pos_x, pos_y));
}

pub(crate) fn ensure_settings_window_bounds(window: &WebviewWindow) {
    const MIN_W: f64 = 780.0;
    const MIN_H: f64 = 560.0;
    let _ = window.set_min_size(Some(LogicalSize::new(MIN_W, MIN_H)));
    if let (Ok(physical), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
        let width = physical.width as f64 / scale;
        let height = physical.height as f64 / scale;
        if width < MIN_W || height < MIN_H {
            let _ = window.set_size(LogicalSize::new(width.max(MIN_W), height.max(MIN_H)));
        }
    }
}

// Credits: tauri-plugin-window-state
pub(crate) trait MonitorExt {
    fn intersects(
        &self,
        position: PhysicalPosition<i32>,
        size: PhysicalSize<u32>,
        scale: f64,
    ) -> bool;
}

impl MonitorExt for Display {
    fn intersects(
        &self,
        position: PhysicalPosition<i32>,
        size: PhysicalSize<u32>,
        _scale: f64,
    ) -> bool {
        #[cfg(target_os = "macos")]
        {
            let Some(bounds) = self.raw_handle().logical_bounds() else {
                return false;
            };

            let left = (bounds.position().x() * _scale) as i32;
            let right = left + (bounds.size().width() * _scale) as i32;
            let top = (bounds.position().y() * _scale) as i32;
            let bottom = top + (bounds.size().height() * _scale) as i32;

            [
                (position.x, position.y),
                (position.x + size.width as i32, position.y),
                (position.x, position.y + size.height as i32),
                (
                    position.x + size.width as i32,
                    position.y + size.height as i32,
                ),
            ]
            .into_iter()
            .any(|(x, y)| x >= left && x < right && y >= top && y < bottom)
        }

        #[cfg(windows)]
        {
            let Some(bounds) = self.raw_handle().physical_bounds() else {
                return false;
            };

            let left = bounds.position().x() as i32;
            let right = left + bounds.size().width() as i32;
            let top = bounds.position().y() as i32;
            let bottom = top + bounds.size().height() as i32;

            [
                (position.x, position.y),
                (position.x + size.width as i32, position.y),
                (position.x, position.y + size.height as i32),
                (
                    position.x + size.width as i32,
                    position.y + size.height as i32,
                ),
            ]
            .into_iter()
            .any(|(x, y)| x >= left && x < right && y >= top && y < bottom)
        }

        #[cfg(target_os = "linux")]
        {
            let Some(bounds) = self.raw_handle().physical_bounds() else {
                return false;
            };

            let left = bounds.position().x() as i32;
            let right = left + bounds.size().width() as i32;
            let top = bounds.position().y() as i32;
            let bottom = top + bounds.size().height() as i32;

            [
                (position.x, position.y),
                (position.x + size.width as i32, position.y),
                (position.x, position.y + size.height as i32),
                (
                    position.x + size.width as i32,
                    position.y + size.height as i32,
                ),
            ]
            .into_iter()
            .any(|(x, y)| x >= left && x < right && y >= top && y < bottom)
        }
    }
}
