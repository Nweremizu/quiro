//! Traffic-light (close/minimise/zoom) placement for macOS windows.
//!
//! Quiro's windows use a hidden titlebar with the content drawn underneath, so
//! AppKit's default button placement lands them in the wrong spot. These
//! helpers move the buttons to a caller-supplied inset from the window's
//! top-left corner.
//!
//! Everything here touches AppKit and must run on the main thread; the callers
//! in `windows/commands.rs` wrap these in `run_on_main_thread`.

use objc2_app_kit::{NSWindow, NSWindowButton};
use tauri::LogicalPosition;

/// A raw `NSWindow*` from `WebviewWindow::ns_window()`.
///
/// Tauri hands the pointer back as `*mut c_void`, which isn't `Send`, but the
/// callers need to move it into a `run_on_main_thread` closure. Wrapping it
/// makes that possible; the safety argument is that the pointer is only ever
/// dereferenced on the main thread, which is where AppKit requires it anyway.
pub struct UnsafeWindowHandle(pub *mut std::ffi::c_void);

unsafe impl Send for UnsafeWindowHandle {}
unsafe impl Sync for UnsafeWindowHandle {}

/// Position the controls once, when the window is first set up. Re-positioning
/// on theme/focus changes is driven by the caller's window-event handler.
pub fn setup(window: tauri::Window, inset: LogicalPosition<f64>) {
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    position_window_controls(UnsafeWindowHandle(ns_window), &inset);
}

pub fn position_window_controls(handle: UnsafeWindowHandle, inset: &LogicalPosition<f64>) {
    if handle.0.is_null() {
        return;
    }

    // Safe as long as this runs on the main thread with a live window, which
    // is the documented contract for every caller.
    let window: &NSWindow = unsafe { &*handle.0.cast::<NSWindow>() };

    let (Some(close), Some(miniaturize), Some(zoom)) = (
        window.standardWindowButton(NSWindowButton::CloseButton),
        window.standardWindowButton(NSWindowButton::MiniaturizeButton),
        window.standardWindowButton(NSWindowButton::ZoomButton),
    ) else {
        // A window built without those buttons in its style mask.
        return;
    };

    let close_frame = close.frame();
    let button_height = close_frame.size.height;
    // Enough room for the button plus the requested gap above it.
    let title_bar_height = button_height + inset.y * 2.0;

    // The buttons share a titlebar container view. Resize it to the height the
    // inset implies and pin it to the top of the window — AppKit's origin is
    // bottom-left, so "top" means (window height - container height).
    if let Some(container) = unsafe { close.superview() } {
        let mut rect = container.frame();
        rect.size.height = title_bar_height;
        rect.origin.y = window.frame().size.height - title_bar_height;
        container.setFrame(rect);
    }

    // Preserve AppKit's own spacing rather than hardcoding one, so the layout
    // still tracks the system metric if it ever changes.
    let spacing = miniaturize.frame().origin.x - close_frame.origin.x;
    let y = (title_bar_height - button_height) / 2.0;

    for (index, button) in [&close, &miniaturize, &zoom].into_iter().enumerate() {
        let mut origin = button.frame().origin;
        origin.x = inset.x + spacing * index as f64;
        origin.y = y;
        button.setFrameOrigin(origin);
    }
}
