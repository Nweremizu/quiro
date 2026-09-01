use crate::windows::*;
use std::fmt::Write as _;
use std::path::Path;

/// `encodeURIComponent`-equivalent for the one value this module ever needs
/// to put in a URL: a raw filesystem path (drive-letter colon, backslashes,
/// spaces, and on Windows potentially non-ASCII, none of which are safe
/// unescaped in a query string). Not worth a dependency for the handful of
/// bytes actually worth escaping here.
fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => {
                let _ = write!(out, "%{byte:02X}");
            }
        }
    }
    out
}

/// Multi-instance, like `camera::try_reuse` — but keyed by path rather than
/// session id, since re-opening the *same* screenshot should focus its
/// already-open editor instead of spawning a second one racing the first
/// over the same project sidecar file.
pub(crate) async fn try_reuse(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
) -> Option<tauri::Result<WebviewWindow>> {
    let ShowQuiroWindow::ScreenshotEditor { path } = this else {
        return None;
    };

    let label = screenshot_editor_label_for_path(path);
    let window = app.get_webview_window(&label)?;

    window.show().ok();
    window.unminimize().ok();
    window.set_focus().ok();

    Some(Ok(window))
}

pub(crate) async fn show_screenshot_editor(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    path: &Path,
) -> tauri::Result<WebviewWindow> {
    let label = screenshot_editor_label_for_path(path);
    let should_protect = should_protect_window(app, &WindowId::ScreenshotEditor.title());

    // The editor asks the backend which screenshot it is showing (Cap's
    // `create_screenshot_editor_instance` takes only the Window), so this
    // label -> path mapping has to exist before the webview loads.
    crate::screenshot_editor::ScreenshotEditorPaths::set(app, label.clone(), path.to_path_buf());

    let encoded_path = percent_encode(&path.to_string_lossy());

    let window = this
        .window_builder_with_label(
            app,
            format!("/screenshot-editor?path={encoded_path}"),
            label.clone(),
        )
        .maximized(false)
        .resizable(true)
        .fullscreen(false)
        .content_protected(should_protect)
        .inner_size(960.0, 680.0)
        .min_inner_size(560.0, 400.0)
        .visible(true)
        .build()?;

    lock_window_text_scale(&window);

    // Brings the main window back, and releases the instance's renderer and
    // frame websocket — nothing was disposing them when the window closed.
    let app_handle = app.clone();
    let closed_window = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            restore_main_window_after_editor(&app_handle, &label);

            let closed_window = closed_window.clone();
            tauri::async_runtime::spawn(async move {
                crate::screenshot_editor::ScreenshotEditorInstances::remove(
                    closed_window.as_ref().window(),
                )
                .await;
            });
        }
    });

    Ok(window)
}
