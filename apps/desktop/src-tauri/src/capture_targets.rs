use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use quiro_recording::sources::screen_capture::{
    CaptureDisplay, CaptureWindow, list_displays, list_windows,
};
#[cfg(windows)]
use scap_direct3d::{Capturer, PixelFormat, Settings};
use scap_targets::{Display, Window, bounds::LogicalBounds};
use serde::Serialize;
use specta::Type;
#[cfg(windows)]
use std::sync::mpsc;
#[cfg(windows)]
use windows::Graphics::Capture::GraphicsCaptureItem;

/// Longest edge a thumbnail is downscaled to before being base64-encoded —
/// these are for picker-grid previews, not full quality, so keep them small.
#[cfg(windows)]
const THUMBNAIL_MAX_DIMENSION: u32 = 320;

#[derive(Serialize, Type)]
pub struct CaptureDisplayWithThumbnail {
    pub id: String,
    pub name: String,
    pub refresh_rate: u32,
    pub thumbnail: Option<String>,
}

#[derive(Serialize, Type)]
pub struct CaptureWindowWithThumbnail {
    pub id: String,
    pub owner_name: String,
    pub name: String,
    pub bounds: LogicalBounds,
    pub refresh_rate: u32,
    pub thumbnail: Option<String>,
    pub app_icon: Option<String>,
    pub bundle_identifier: Option<String>,
}

// `#[tauri::command(async)]` keeps these off the main thread — a synchronous
// command would run on the window event loop and stall the UI. Target
// enumeration touches the OS window/display APIs, and the `_with_thumbnails`
// variants additionally grab a real frame per target, which is slow enough to
// be very visible.
#[tauri::command(async)]
#[specta::specta]
pub fn list_capture_displays() -> Vec<CaptureDisplay> {
    list_displays().into_iter().map(|(info, _)| info).collect()
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_capture_windows() -> Vec<CaptureWindow> {
    list_windows().into_iter().map(|(info, _)| info).collect()
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_displays_with_thumbnails() -> Vec<CaptureDisplayWithThumbnail> {
    list_displays()
        .into_iter()
        .map(|(info, display)| CaptureDisplayWithThumbnail {
            id: info.id.to_string(),
            name: info.name,
            refresh_rate: info.refresh_rate,
            thumbnail: capture_display_thumbnail(&display).ok(),
        })
        .collect()
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_windows_with_thumbnails() -> Vec<CaptureWindowWithThumbnail> {
    list_windows()
        .into_iter()
        .map(|(info, window)| CaptureWindowWithThumbnail {
            id: info.id.to_string(),
            owner_name: info.owner_name,
            name: info.name,
            bounds: info.bounds,
            refresh_rate: info.refresh_rate,
            thumbnail: capture_window_thumbnail(&window).ok(),
            app_icon: window.app_icon().map(|bytes| to_png_data_uri_raw(&bytes)),
            bundle_identifier: info.bundle_identifier,
        })
        .collect()
}

#[cfg(windows)]
fn capture_display_thumbnail(display: &Display) -> Result<String, String> {
    let item = display
        .raw_handle()
        .try_as_capture_item()
        .map_err(|e| e.to_string())?;
    capture_single_frame_thumbnail(item)
}

#[cfg(windows)]
fn capture_window_thumbnail(window: &Window) -> Result<String, String> {
    let item = window
        .raw_handle()
        .try_as_capture_item()
        .map_err(|e| e.to_string())?;
    capture_single_frame_thumbnail(item)
}

// Thumbnail capture is Direct3D-based (`scap_direct3d` + GraphicsCaptureItem),
// so it has no equivalent here yet — the ScreenCaptureKit path isn't wired up.
// `thumbnail` is already Option, so the picker just renders without preview
// images rather than failing.
#[cfg(not(windows))]
fn capture_display_thumbnail(_display: &Display) -> Result<String, String> {
    Err("display thumbnails are only implemented on Windows".to_string())
}

#[cfg(not(windows))]
fn capture_window_thumbnail(_window: &Window) -> Result<String, String> {
    Err("window thumbnails are only implemented on Windows".to_string())
}

/// Grabs exactly one frame from a display or window and returns it as a
/// downscaled `data:image/png;base64,...` string. Mirrors `capture::
/// take_screenshot`'s single-frame-then-stop pattern, but scaled down and
/// kept in memory instead of written full-res to disk.
#[cfg(windows)]
fn capture_single_frame_thumbnail(item: GraphicsCaptureItem) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();

    // Windows draws its "this is being captured" border around the target for
    // the lifetime of the capture session, and these sessions are started from
    // a background prewarm the user never asked for — one per display and per
    // window. Without this the borders flash on and off across the desktop
    // whenever the main window is hovered. The recording and screenshot paths
    // already suppress it the same way (screenshot.rs, screen_capture/windows.rs).
    let mut settings = Settings {
        pixel_format: PixelFormat::B8G8R8A8Unorm,
        ..Default::default()
    };

    if let Ok(true) = Settings::can_is_border_required() {
        settings.is_border_required = Some(false);
    }

    let mut capturer = Capturer::new(
        item,
        settings,
        move |frame| {
            let buf = frame.as_buffer()?;
            let _ = tx.send((
                buf.data().to_vec(),
                buf.width(),
                buf.height(),
                buf.stride(),
            ));
            Ok(())
        },
        || Ok(()),
        None,
    )
    .map_err(|e| e.to_string())?;

    capturer.start().map_err(|e| e.to_string())?;
    let (data, width, height, stride) = rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    capturer.stop().ok();

    // D3D11 staging textures pad each row to `stride`, which can exceed
    // width*4 — trim the padding or the image comes out skewed (same fix as
    // capture::take_screenshot).
    let mut bgra = Vec::with_capacity((width * height * 4) as usize);
    for row in data.chunks(stride as usize) {
        bgra.extend_from_slice(&row[..(width * 4) as usize]);
    }
    // BGRA -> RGBA
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    let image = image::RgbaImage::from_raw(width, height, bgra)
        .ok_or_else(|| "captured buffer did not match its own dimensions".to_string())?;
    let thumbnail = image::imageops::thumbnail(
        &image,
        THUMBNAIL_MAX_DIMENSION.min(width),
        THUMBNAIL_MAX_DIMENSION.min(height),
    );

    let mut png_bytes = Vec::new();
    thumbnail
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| e.to_string())?;

    Ok(format!("data:image/png;base64,{}", BASE64.encode(png_bytes)))
}

fn to_png_data_uri_raw(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", BASE64.encode(bytes))
}
