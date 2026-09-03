//! System diagnostics for the Feedback settings page.
//!
//! `quiro_recording::diagnostics` already collects everything worth reporting,
//! but its `SystemDiagnostics` is a different struct per platform — exporting
//! that shape directly would give the frontend a type that changes with the
//! build target. This flattens it into labelled groups instead: the page only
//! ever displays these values or copies them as text, so a stable
//! `Vec<DiagnosticGroup>` is both easier to render and easier to paste into a
//! bug report than three divergent structs.

use quiro_recording::diagnostics;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEntry {
    pub label: String,
    pub value: String,
    /// Marks a value the user probably needs to act on — a missing permission,
    /// software rendering, no hardware encoder. The page styles these.
    #[serde(default)]
    pub warning: bool,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticGroup {
    pub title: String,
    pub entries: Vec<DiagnosticEntry>,
}

fn entry(label: &str, value: impl Into<String>) -> DiagnosticEntry {
    DiagnosticEntry {
        label: label.to_string(),
        value: value.into(),
        warning: false,
    }
}

fn flagged(label: &str, value: impl Into<String>, warning: bool) -> DiagnosticEntry {
    DiagnosticEntry {
        label: label.to_string(),
        value: value.into(),
        warning,
    }
}

fn yes_no(value: bool) -> &'static str {
    if value { "Yes" } else { "No" }
}

fn app_group(app: &AppHandle) -> DiagnosticGroup {
    let version = app.package_info().version.to_string();

    DiagnosticGroup {
        title: "Application".to_string(),
        entries: vec![
            entry("Version", version),
            entry("Platform", std::env::consts::OS),
            entry("Architecture", std::env::consts::ARCH),
        ],
    }
}

fn hardware_group() -> DiagnosticGroup {
    let hw = diagnostics::collect_hardware_info();

    DiagnosticGroup {
        title: "Hardware".to_string(),
        entries: vec![
            entry("CPU", hw.cpu_brand),
            entry("Cores", hw.cpu_cores.to_string()),
            entry(
                "Memory",
                format!(
                    "{} MB total, {} MB available",
                    hw.total_memory_mb, hw.available_memory_mb
                ),
            ),
        ],
    }
}

fn display_group() -> DiagnosticGroup {
    let displays = diagnostics::collect_displays();

    let entries = if displays.is_empty() {
        vec![flagged("Displays", "None detected", true)]
    } else {
        displays
            .into_iter()
            .map(|d| {
                let label = if d.is_primary {
                    format!("{} (primary)", d.name)
                } else {
                    d.name.clone()
                };
                entry(
                    &label,
                    format!(
                        "{}×{} @ {} Hz, {}× scale",
                        d.width, d.height, d.refresh_rate, d.scale_factor
                    ),
                )
            })
            .collect()
    };

    DiagnosticGroup {
        title: "Displays".to_string(),
        entries,
    }
}

#[cfg(target_os = "windows")]
fn capture_group() -> DiagnosticGroup {
    let d = diagnostics::collect_diagnostics();
    let mut entries = Vec::new();

    if let Some(version) = d.windows_version {
        entries.push(flagged(
            "Windows",
            version.display_name,
            !version.meets_requirements,
        ));
    }

    if let Some(gpu) = d.gpu_info {
        entries.push(entry("GPU", format!("{} ({})", gpu.description, gpu.vendor)));
        entries.push(flagged(
            "Hardware encoding",
            yes_no(gpu.supports_hardware_encoding),
            !gpu.supports_hardware_encoding,
        ));
    }

    entries.push(flagged(
        "Software rendering",
        yes_no(d.rendering_status.is_using_software_rendering),
        d.rendering_status.is_using_software_rendering,
    ));
    entries.push(flagged(
        "Graphics capture",
        yes_no(d.graphics_capture_supported),
        !d.graphics_capture_supported,
    ));
    entries.push(entry(
        "D3D11 video processor",
        yes_no(d.d3d11_video_processor_available),
    ));

    if let Some(warning) = d.rendering_status.warning_message {
        entries.push(flagged("Warning", warning, true));
    }

    entries.push(encoders_entry(d.available_encoders));

    DiagnosticGroup {
        title: "Graphics & capture".to_string(),
        entries,
    }
}

#[cfg(target_os = "macos")]
fn capture_group() -> DiagnosticGroup {
    let d = diagnostics::collect_diagnostics();
    let mut entries = Vec::new();

    if let Some(version) = d.macos_version {
        entries.push(entry(
            "macOS",
            format!("{} ({})", version.display_name, version.build_number),
        ));
        entries.push(entry("Apple silicon", yes_no(version.is_apple_silicon)));
    }

    if let Some(gpu) = d.gpu_name {
        entries.push(entry("GPU", gpu));
    }

    entries.push(flagged("Metal", yes_no(d.metal_supported), !d.metal_supported));
    entries.push(flagged(
        "Screen capture",
        yes_no(d.screen_capture_supported),
        !d.screen_capture_supported,
    ));
    entries.push(encoders_entry(d.available_encoders));

    DiagnosticGroup {
        title: "Graphics & capture".to_string(),
        entries,
    }
}

#[cfg(target_os = "linux")]
fn capture_group() -> DiagnosticGroup {
    let d = diagnostics::collect_diagnostics();
    let mut entries = Vec::new();

    if let Some(kernel) = d.kernel_version {
        entries.push(entry("Kernel", kernel));
    }
    if let Some(gpu) = d.gpu_name {
        entries.push(entry("GPU", gpu));
    }

    entries.push(flagged(
        "Screen capture",
        yes_no(d.screen_capture_supported),
        !d.screen_capture_supported,
    ));
    entries.push(encoders_entry(d.available_encoders));

    DiagnosticGroup {
        title: "Graphics & capture".to_string(),
        entries,
    }
}

fn encoders_entry(encoders: Vec<String>) -> DiagnosticEntry {
    if encoders.is_empty() {
        flagged("Available encoders", "None detected", true)
    } else {
        entry("Available encoders", encoders.join(", "))
    }
}

/// Off the main thread: the platform collectors query GPU adapters and probe
/// encoders, which is slow enough to stutter the window if run inline.
#[tauri::command(async)]
#[specta::specta]
pub fn get_system_diagnostics(app: AppHandle) -> Vec<DiagnosticGroup> {
    vec![
        app_group(&app),
        capture_group(),
        hardware_group(),
        display_group(),
    ]
}

/// Absolute path of the directory the app writes logs to, so the Feedback page
/// can reveal it in the file manager. Cap uploads logs to its own servers;
/// Quiro has no backend, so the user gets the folder instead.
#[tauri::command]
#[specta::specta]
pub fn get_logs_dir(app: AppHandle) -> Result<String, String> {
    use tauri::Manager;

    app.path()
        .app_log_dir()
        .map(|dir| dir.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}
