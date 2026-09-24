use std::{
    collections::HashSet,
    error::Error,
    fmt::{Display, Formatter},
    sync::{Mutex, OnceLock},
};

use posthog_rs::{CaptureExceptionOptions, ClientOptionsBuilder, ErrorTrackingOptionsBuilder};
use quiro_recording::feeds::camera::{CameraDeviceSettings, DeviceOrModelID};

use crate::crash_sentinel::UnexpectedTermination;

const POSTHOG_HOST: &str = "https://eu.i.posthog.com";

static REPORTED_ERRORS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug)]
struct TelemetryError {
    message: String,
}

impl Display for TelemetryError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for TelemetryError {}

pub fn init() {
    let Some(api_key) = option_env!("QUIRO_POSTHOG_API_KEY").filter(|key| !key.is_empty()) else {
        return;
    };

    let error_tracking = match ErrorTrackingOptionsBuilder::default()
        .capture_panics(true)
        .capture_stacktrace(true)
        .in_app_include_paths(vec!["quiro_desktop".to_string()])
        .build()
    {
        Ok(options) => options,
        Err(error) => {
            tracing::warn!(%error, "Failed to configure PostHog error tracking");
            return;
        }
    };

    let options = match ClientOptionsBuilder::default()
        .api_key(api_key.to_string())
        .host(POSTHOG_HOST)
        .error_tracking(error_tracking)
        .build()
    {
        Ok(options) => options,
        Err(error) => {
            tracing::warn!(%error, "Failed to configure PostHog client");
            return;
        }
    };

    if let Err(error) = tauri::async_runtime::block_on(posthog_rs::init_global(options)) {
        tracing::warn!(%error, "Failed to initialize PostHog error tracking");
    }
}

pub fn capture_error(area: &str, operation: &str, error_kind: &str) {
    let key = format!("{area}:{operation}:{error_kind}");
    let reported = REPORTED_ERRORS.get_or_init(|| Mutex::new(HashSet::new()));
    let Ok(mut reported) = reported.lock() else {
        return;
    };
    if !reported.insert(key) {
        return;
    }
    drop(reported);

    let area = area.to_string();
    let operation = operation.to_string();
    let error_kind = error_kind.to_string();
    tauri::async_runtime::spawn(async move {
        let error = TelemetryError {
            message: format!("{operation} failed"),
        };
        let options = match CaptureExceptionOptions::new()
            .property("area", &area)
            .and_then(|options| options.property("operation", &operation))
            .and_then(|options| options.property("error_kind", &error_kind))
        {
            Ok(options) => options,
            Err(error) => {
                tracing::warn!(%error, "Failed to build PostHog exception context");
                return;
            }
        };

        if let Err(error) = posthog_rs::capture_exception_with(&error, options).await {
            tracing::debug!(%error, "Failed to capture PostHog exception");
        }
    });
}

fn camera_error_kind(error: &str) -> &'static str {
    if error.contains("CameraFrameConversion/") {
        "frame_conversion"
    } else if error.contains("CameraTimeout/") {
        "no_frames"
    } else if error.contains("DeviceNotFound") {
        "device_not_found"
    } else if error.contains("InvalidFormat") {
        "invalid_format"
    } else if error.contains("StartCapturing/") {
        "capture_start"
    } else if error.contains("BuildStreamCrashed") {
        "setup_thread"
    } else if error.contains("FeedLocked") {
        "feed_locked"
    } else {
        "camera_setup"
    }
}

fn camera_model_id(id: &DeviceOrModelID) -> Option<String> {
    match id {
        DeviceOrModelID::ModelID(model_id) => Some(model_id.to_string()),
        DeviceOrModelID::DeviceID(device_id) => {
            let lowercase = device_id.to_ascii_lowercase();
            let extract = |marker: &str| {
                let start = lowercase.find(marker)? + marker.len();
                let value = lowercase.get(start..start + 4)?;
                value
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
                    .then_some(value)
            };
            Some(format!("{}:{}", extract("vid_")?, extract("pid_")?))
        }
    }
}

pub fn capture_camera_failure(
    operation: &str,
    id: &DeviceOrModelID,
    settings: Option<CameraDeviceSettings>,
    failure: &str,
) {
    let error_kind = camera_error_kind(failure);
    let model_id = camera_model_id(id);
    let key = format!("camera:{operation}:{error_kind}:{model_id:?}:{settings:?}");
    let reported = REPORTED_ERRORS.get_or_init(|| Mutex::new(HashSet::new()));
    let Ok(mut reported) = reported.lock() else {
        return;
    };
    if !reported.insert(key) {
        return;
    }
    drop(reported);

    let operation = operation.to_string();
    let error_kind = error_kind.to_string();
    let failure = failure.chars().take(512).collect::<String>();
    let selection_kind = match id {
        DeviceOrModelID::DeviceID(_) => "device_id",
        DeviceOrModelID::ModelID(_) => "model_id",
    };
    tauri::async_runtime::spawn(async move {
        let error = TelemetryError {
            message: format!("Camera {operation}: {error_kind}"),
        };
        let mut options = match CaptureExceptionOptions::new()
            .property("area", "camera")
            .and_then(|options| options.property("operation", &operation))
            .and_then(|options| options.property("error_kind", &error_kind))
            .and_then(|options| options.property("failure_detail", &failure))
            .and_then(|options| options.property("selection_kind", selection_kind))
            .and_then(|options| options.property("platform", std::env::consts::OS))
            .and_then(|options| options.property("app_version", env!("CARGO_PKG_VERSION")))
        {
            Ok(options) => options,
            Err(error) => {
                tracing::warn!(%error, "Failed to build camera exception context");
                return;
            }
        };
        if let Some(model_id) = model_id {
            let Ok(updated) = options.property("camera_model_id", model_id) else {
                return;
            };
            options = updated;
        }
        if let Some(settings) = settings {
            if let Ok(updated) = options.property("requested_width", settings.width) {
                options = updated;
            } else {
                return;
            }
            if let Ok(updated) = options.property("requested_height", settings.height) {
                options = updated;
            } else {
                return;
            }
            if let Ok(updated) = options.property("requested_frame_rate", settings.frame_rate) {
                options = updated;
            } else {
                return;
            }
        }

        if let Err(error) = posthog_rs::capture_exception_with(&error, options).await {
            tracing::debug!(%error, "Failed to capture camera exception");
        }
    });
}

pub fn capture_unexpected_termination(termination: UnexpectedTermination) {
    let area = "process".to_string();
    let operation = "previous_session_unexpected_termination".to_string();
    tauri::async_runtime::spawn(async move {
        let error = TelemetryError {
            message: "Previous Quiro session terminated unexpectedly".to_string(),
        };
        let options = match CaptureExceptionOptions::new()
            .property("area", &area)
            .and_then(|options| options.property("operation", &operation))
            .and_then(|options| options.property("during_gpu_init", termination.during_gpu_init))
            .and_then(|options| {
                options.property("in_graphics_recovery", termination.in_graphics_recovery)
            })
            .and_then(|options| options.property("blur_active", termination.blur_active))
        {
            Ok(options) => options,
            Err(error) => {
                tracing::warn!(%error, "Failed to build PostHog termination context");
                return;
            }
        };

        if let Err(error) = posthog_rs::capture_exception_with(&error, options).await {
            tracing::debug!(%error, "Failed to capture unexpected termination");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_failures_keep_the_frame_stage() {
        assert_eq!(
            camera_error_kind("CameraTimeout/selected_format=NV12"),
            "no_frames"
        );
        assert_eq!(
            camera_error_kind("CameraFrameConversion/H264 decoder needs more data"),
            "frame_conversion"
        );
    }

    #[test]
    fn camera_model_id_does_not_include_a_device_serial() {
        let id = DeviceOrModelID::DeviceID(r"\\?\usb#vid_046d&pid_0825#private_serial".to_string());
        assert_eq!(camera_model_id(&id).as_deref(), Some("046d:0825"));
    }
}
