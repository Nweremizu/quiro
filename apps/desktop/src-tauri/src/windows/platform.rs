use super::*;

#[cfg(target_os = "macos")]
pub(crate) const DEFAULT_TRAFFIC_LIGHTS_INSET: LogicalPosition<f64> =
    LogicalPosition::new(12.0, 12.0);

#[cfg(target_os = "macos")]
pub(crate) const MAIN_PANEL_LEVEL: i32 = 100;

#[cfg(target_os = "macos")]
pub(crate) const TELEPROMPTER_PANEL_LEVEL: objc2_app_kit::NSWindowLevel =
    MAIN_PANEL_LEVEL as isize + 1;

#[cfg(windows)]
pub(crate) const WINDOWS_WEBVIEW2_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-vulkan --use-angle=d3d11";

#[cfg(windows)]
pub(crate) fn windows_webview2_browser_args() -> String {
    let mut args = WINDOWS_WEBVIEW2_BROWSER_ARGS.to_string();
    if quiro_rendering::force_software_wgpu_adapter()
        || std::env::args_os().any(|arg| arg.to_str() == Some("--disable-gpu"))
    {
        args.push_str(" --disable-gpu");
    }
    args
}

// This function checks the Windows registry to determine if the system is in dark mode.
#[cfg(target_os = "macos")]
pub(crate) fn is_system_dark_mode() -> bool {
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSString;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let app: id = msg_send![class!(NSApplication), sharedApplication];
        let appearance: id = msg_send![app, effectiveAppearance];
        if appearance == nil {
            return false;
        }
        let name: id = msg_send![appearance, name];
        if name == nil {
            return false;
        }
        let dark_appearance = NSString::alloc(nil).init_str("NSAppearanceNameDarkAqua");
        let vibrant_dark = NSString::alloc(nil).init_str("NSAppearanceNameVibrantDark");
        let is_dark: bool = msg_send![name, isEqualToString: dark_appearance];
        let is_vibrant_dark: bool = msg_send![name, isEqualToString: vibrant_dark];
        is_dark || is_vibrant_dark
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn is_system_dark_mode() -> bool {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) =
        hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
        && let Ok(value) = key.get_value::<u32, _>("AppsUseLightTheme")
    {
        return value == 0;
    }
    false
}

#[cfg(target_os = "linux")]
pub(crate) fn is_system_dark_mode() -> bool {
    let output = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "color-scheme"])
        .output();
    if let Ok(output) = output
        && output.status.success()
    {
        return String::from_utf8_lossy(&output.stdout).contains("dark");
    }
    false
}
