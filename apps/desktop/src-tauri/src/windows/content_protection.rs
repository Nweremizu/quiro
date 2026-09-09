use super::*;

// Capture exclusion (WDA_EXCLUDEFROMCAPTURE / NSWindowSharingType::None) also hides
// the window from "capture-based" displays such as virtual/indirect/dummy-HDMI or
// mirrored monitors, making it invisible and unreachable. We therefore only protect
// Quiro's own windows while a recording is actually active, which is the only time the
// exclusion is meaningful.
//
// On desktops that are themselves delivered through a capture-based stream (Shadow
// and other cloud PCs, RDP, VMs), even recording-gated exclusion hides the recording
// controls from the user and trips DRM detectors (Shadow error S:102), so exclusion
// is skipped entirely there — Quiro's windows then appear in recordings, which is the
// lesser evil. Overridable via the QUIRO_WINDOW_CAPTURE_EXCLUSION env var.
#[cfg(target_os = "windows")]
pub fn capture_exclusion_hides_ui() -> bool {
    static LAST_LOGGED: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

    let reason = crate::platform::win::capture_streamed_display_reason();

    if let Ok(mut last) = LAST_LOGGED.lock()
        && *last != reason
    {
        match &reason {
            Some(reason) => warn!(
                %reason,
                "Skipping window capture exclusion: this desktop is viewed through a \
                 capture-based stream, so excluded windows would be invisible to the user. \
                 Quiro's windows will appear in recordings."
            ),
            None => info!("Window capture exclusion re-enabled"),
        }
        *last = reason.clone();
    }

    reason.is_some()
}

#[cfg(not(target_os = "windows"))]
pub fn capture_exclusion_hides_ui() -> bool {
    false
}

pub(crate) fn content_protection_enabled(app: &AppHandle<Wry>) -> bool {
    app.try_state::<ArcLock<crate::App>>()
        .and_then(|state| {
            state
                .try_read()
                .ok()
                .map(|app| app.is_recording_active_or_pending())
        })
        .unwrap_or(false)
}

pub(crate) fn window_capture_excluded(app: &AppHandle<Wry>, window_title: &str) -> bool {
    if window_title == WindowId::Teleprompter.title() {
        return true;
    }

    let matches = |list: &[WindowExclusion]| {
        list.iter()
            .any(|entry| entry.matches(None, None, Some(window_title)))
    };

    GeneralSettingsStore::get(app)
        .ok()
        .flatten()
        .map(|settings| matches(&settings.excluded_windows))
        .unwrap_or_else(|| matches(&general_settings::default_excluded_windows()))
}

pub(crate) fn should_protect_window(app: &AppHandle<Wry>, window_title: &str) -> bool {
    content_protection_enabled(app)
        && !capture_exclusion_hides_ui()
        && window_capture_excluded(app, window_title)
}

pub fn apply_content_protection(app: &AppHandle<Wry>, enabled: bool) {
    let enabled = enabled && !capture_exclusion_hides_ui();

    for (label, window) in app.webview_windows() {
        let Ok(id) = WindowId::from_str(&label) else {
            continue;
        };

        let title = id.title();
        let should_protect = enabled && window_capture_excluded(app, &title);
        let _ = window.set_content_protected(should_protect);

        #[cfg(target_os = "windows")]
        log_window_content_protection(&window, should_protect, &title);
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn cached_windows_version() -> Option<&'static scap_direct3d::WindowsVersion> {
    static VERSION: std::sync::OnceLock<Option<scap_direct3d::WindowsVersion>> =
        std::sync::OnceLock::new();
    VERSION
        .get_or_init(scap_direct3d::WindowsVersion::detect)
        .as_ref()
}

#[cfg(target_os = "windows")]
pub(crate) fn display_affinity_name(value: u32) -> &'static str {
    match value {
        0 => "WDA_NONE",
        1 => "WDA_MONITOR",
        17 => "WDA_EXCLUDEFROMCAPTURE",
        _ => "UNKNOWN",
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn log_window_content_protection(
    window: &WebviewWindow,
    enabled: bool,
    window_title: &str,
) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let expected = if enabled {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };

    if let Some(version) = cached_windows_version()
        && enabled
        && version.build < 19041
    {
        warn!(
            window = window.label(),
            title = window_title,
            version = %version.display_name(),
            expected = display_affinity_name(expected.0),
            "Window capture exclusion is not fully supported on this Windows build"
        );
    }

    let hwnd = match window.hwnd() {
        Ok(hwnd) => windows::Win32::Foundation::HWND(hwnd.0),
        Err(error) => {
            warn!(
                window = window.label(),
                title = window_title,
                error = %error,
                "Failed to get HWND for content protection diagnostics"
            );
            return;
        }
    };

    let mut applied = 0u32;
    match unsafe { GetWindowDisplayAffinity(hwnd, &mut applied) } {
        Ok(()) => {
            if applied == expected.0 {
                debug!(
                    window = window.label(),
                    title = window_title,
                    expected = display_affinity_name(expected.0),
                    applied = display_affinity_name(applied),
                    "Window content protection verified"
                );
            } else {
                warn!(
                    window = window.label(),
                    title = window_title,
                    expected = display_affinity_name(expected.0),
                    expected_raw = expected.0,
                    applied = display_affinity_name(applied),
                    applied_raw = applied,
                    "Window content protection mismatch"
                );
            }
        }
        Err(error) => {
            warn!(
                window = window.label(),
                title = window_title,
                expected = display_affinity_name(expected.0),
                error = %error,
                "Failed to query window display affinity"
            );
        }
    }
}

#[tauri::command]
#[specta::specta]
#[instrument(skip(app))]
pub fn refresh_window_content_protection(app: AppHandle<Wry>) -> Result<(), String> {
    let enabled = content_protection_enabled(&app);
    apply_content_protection(&app, enabled);
    Ok(())
}
