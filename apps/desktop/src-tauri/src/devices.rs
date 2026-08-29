use cpal::traits::{DeviceTrait, HostTrait};
use quiro_camera::CameraInfo;
use serde::Serialize;
use specta::Type;

// Tauri runs a *synchronous* `#[tauri::command]` on the main thread — the same
// thread as the window event loop. Device enumeration goes out to the OS
// camera/audio stacks (DirectShow + Media Foundation on Windows, cpal
// everywhere) and routinely takes hundreds of milliseconds, more with virtual
// camera drivers installed. Running that on the main thread froze the whole UI
// each time — visible as a stuttering cursor, since the devices snapshot polls
// every 5s. Each command below is an async wrapper that moves the work to the
// blocking pool; the `_blocking` cores stay callable from ordinary Rust (see
// `build_devices_snapshot`).
pub(crate) fn list_cameras_blocking() -> Vec<CameraInfo> {
    quiro_camera::list_cameras().collect()
}

#[tauri::command]
#[specta::specta]
pub async fn list_cameras() -> Vec<CameraInfo> {
    tokio::task::spawn_blocking(list_cameras_blocking)
        .await
        .unwrap_or_default()
}

pub(crate) fn list_audio_devices_blocking() -> Vec<String> {
    let Ok(devices) = cpal::default_host().input_devices() else {
        return Vec::new();
    };

    devices.filter_map(|device| device.name().ok()).collect()
}

#[tauri::command]
#[specta::specta]
pub async fn list_audio_devices() -> Vec<String> {
    tokio::task::spawn_blocking(list_audio_devices_blocking)
        .await
        .unwrap_or_default()
}

#[derive(Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CameraFormatInfo {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f32,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CameraWithFormats {
    pub device_id: String,
    pub display_name: String,
    pub model_id: Option<String>,
    pub formats: Vec<CameraFormatInfo>,
    pub best_format: Option<CameraFormatInfo>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_camera_formats(device_id: String) -> Option<CameraWithFormats> {
    tokio::task::spawn_blocking(move || get_camera_formats_blocking(device_id))
        .await
        .ok()
        .flatten()
}

// Doubly expensive: `list_cameras` enumerates every device to find this one,
// then `formats()` enumerates again internally to probe it.
fn get_camera_formats_blocking(device_id: String) -> Option<CameraWithFormats> {
    let camera = quiro_camera::list_cameras().find(|c| c.device_id() == device_id)?;

    let formats: Vec<CameraFormatInfo> = camera
        .formats()
        .unwrap_or_default()
        .into_iter()
        .map(|f| CameraFormatInfo {
            width: f.width(),
            height: f.height(),
            frame_rate: f.frame_rate(),
        })
        .collect();

    let best_format = formats
        .iter()
        .max_by(|a, b| {
            (a.width * a.height, a.frame_rate)
                .partial_cmp(&(b.width * b.height, b.frame_rate))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();

    Some(CameraWithFormats {
        device_id: camera.device_id().to_string(),
        display_name: camera.display_name().to_string(),
        model_id: camera.model_id().map(|m| m.to_string()),
        formats,
        best_format,
    })
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneFormatInfo {
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneInfo {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub formats: Vec<MicrophoneFormatInfo>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_microphone_info(name: String) -> Option<MicrophoneInfo> {
    tokio::task::spawn_blocking(move || get_microphone_info_blocking(name))
        .await
        .ok()
        .flatten()
}

fn get_microphone_info_blocking(name: String) -> Option<MicrophoneInfo> {
    let device = cpal::default_host()
        .input_devices()
        .ok()?
        .find(|d| d.name().map(|n| n == name).unwrap_or(false))?;

    let default_config = device.default_input_config().ok();
    let (sample_rate, channels) = default_config
        .as_ref()
        .map(|c| (c.sample_rate().0, c.channels()))
        .unwrap_or((0, 0));

    let mut formats: Vec<MicrophoneFormatInfo> = device
        .supported_input_configs()
        .map(|configs| {
            configs
                .map(|c| MicrophoneFormatInfo {
                    sample_rate: c.max_sample_rate().0,
                    channels: c.channels(),
                })
                .collect()
        })
        .unwrap_or_default();
    formats.sort_by(|a, b| (b.sample_rate, b.channels).cmp(&(a.sample_rate, a.channels)));
    formats.dedup_by(|a, b| a.sample_rate == b.sample_rate && a.channels == b.channels);

    Some(MicrophoneInfo {
        name,
        sample_rate,
        channels,
        formats,
    })
}

#[derive(Serialize, Clone, Type, tauri_specta::Event, PartialEq)]
pub struct DevicesUpdated {
    pub cameras: Vec<CameraInfo>,
    pub microphones: Vec<String>,
    pub permissions: crate::permissions::OSPermissionsCheck,
}

#[tauri::command]
#[specta::specta]
pub async fn get_devices_snapshot() -> DevicesUpdated {
    tokio::task::spawn_blocking(build_devices_snapshot)
        .await
        .unwrap_or_else(|_| build_devices_snapshot())
}

pub(crate) fn build_devices_snapshot() -> DevicesUpdated {
    let permissions = crate::permissions::do_permissions_check(false);

    DevicesUpdated {
        // Skip the expensive OS enumeration entirely when we lack permission —
        // it can't return anything usable anyway, and this runs on a timer.
        cameras: if permissions.camera.permitted() {
            list_cameras_blocking()
        } else {
            Vec::new()
        },
        microphones: if permissions.microphone.permitted() {
            list_audio_devices_blocking()
        } else {
            Vec::new()
        },
        permissions,
    }
}
