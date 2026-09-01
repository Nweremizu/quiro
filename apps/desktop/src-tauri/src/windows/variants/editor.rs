use crate::windows::*;
use std::path::Path;

/// Same reasoning as `screenshot_editor::try_reuse`: re-opening a recording
/// that already has an editor open focuses it rather than starting a second
/// instance racing the first over the same project config.
pub(crate) async fn try_reuse(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
) -> Option<tauri::Result<WebviewWindow>> {
    let ShowQuiroWindow::Editor { path } = this else {
        return None;
    };

    let path = crate::editor::project_dir_for(path);
    let window = app.get_webview_window(&editor_label_for_path(&path))?;

    window.show().ok();
    window.unminimize().ok();
    window.set_focus().ok();

    Some(Ok(window))
}

pub(crate) async fn show_editor(
    this: &ShowQuiroWindow,
    app: &AppHandle<Wry>,
    path: &Path,
) -> tauri::Result<WebviewWindow> {
    let path = crate::editor::project_dir_for(path);
    let label = editor_label_for_path(&path);
    let should_protect = should_protect_window(app, &WindowId::Editor.title());

    // `create_editor_instance` takes only the Window, so this label -> path
    // mapping has to exist before the webview loads.
    crate::editor::EditorPaths::set(app, label.clone(), path.clone());

    // Overlaps building the instance (decoders, renderer, frame socket) with
    // the webview boot; `create_editor_instance` claims whatever this
    // produced.
    crate::editor::PendingEditorInstances::start_prewarm(app, label.clone(), path.clone()).await;

    let window = match this
        .window_builder_with_label(app, "/editor".to_string(), label.clone())
        .maximized(true)
        .resizable(true)
        .fullscreen(false)
        .content_protected(should_protect)
        .inner_size(1240.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .visible(true)
        .build()
    {
        Ok(window) => window,
        Err(error) => {
            crate::editor::PendingEditorInstances::get(app)
                .cancel_prewarm(&label)
                .await;
            return Err(error);
        }
    };

    lock_window_text_scale(&window);

    // An instance owns decoders, a wgpu renderer and an audio output; closing
    // the webview releases none of them on its own.
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            restore_main_window_after_editor(&app_handle, &label);

            let app_handle = app_handle.clone();
            let label = label.clone();
            tauri::async_runtime::spawn(async move {
                crate::editor::EditorInstances::remove(&app_handle, &label).await;
            });
        }
    });

    Ok(window)
}
