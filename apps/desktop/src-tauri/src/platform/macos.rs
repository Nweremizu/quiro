//! macOS window tweaks that Tauri doesn't expose: window level, opacity, and
//! rounded content corners.
//!
//! Every function here dereferences an `NSWindow` pointer and talks to AppKit,
//! so all of them must be called on the main thread. The callers in
//! `windows/` wrap them in `run_on_main_thread`.

use objc2_app_kit::{NSWindow, NSWindowLevel};
use tauri::{WebviewWindow, Window};

/// Borrow the `NSWindow` behind a Tauri window.
///
/// # Safety
/// Must be called on the main thread, with the window still alive.
unsafe fn with_ns_window<T>(
    ptr: *mut std::ffi::c_void,
    f: impl FnOnce(&NSWindow) -> T,
) -> Option<T> {
    if ptr.is_null() {
        return None;
    }
    Some(f(unsafe { &*ptr.cast::<NSWindow>() }))
}

pub fn set_window_level(window: Window, level: NSWindowLevel) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    unsafe {
        with_ns_window(ptr, |ns_window| ns_window.setLevel(level));
    }
}

pub fn set_window_opacity(window: Window, opacity: f64) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    unsafe {
        with_ns_window(ptr, |ns_window| ns_window.setAlphaValue(opacity));
    }
}

/// Round the window's content corners. Tauri's own decorations are hidden for
/// these windows, so without this the content renders with square corners
/// inside a rounded window shape.
pub fn apply_squircle_corners(window: &WebviewWindow, radius: f64) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    unsafe {
        with_ns_window(ptr, |ns_window| {
            let Some(content_view) = ns_window.contentView() else {
                return;
            };
            // Corner radius lives on the backing layer, so the view needs one.
            content_view.setWantsLayer(true);
            if let Some(layer) = content_view.layer() {
                layer.setCornerRadius(radius);
                layer.setMasksToBounds(true);
            }
        });
    }
}

// ponytail: the Liquid Glass background is reported as unavailable rather than
// approximated. The frontend already treats `false` as "not applied" and keeps
// its normal background, so the window renders correctly — it just doesn't get
// the effect. Approximating it with an NSVisualEffectView would look like a
// different material, which is worse than not claiming to support it.
//
// Implement properly when there's a Mac to check it against; it's cosmetic and
// none of it is verifiable from CI.
pub fn apply_liquid_glass_background(
    _window: &Window,
    _enabled: bool,
    _radius: f64,
) -> Result<bool, String> {
    Ok(false)
}

pub fn apply_main_window_liquid_glass_background(
    _window: &Window,
    _enabled: bool,
    _radius: f64,
) -> Result<bool, String> {
    Ok(false)
}
