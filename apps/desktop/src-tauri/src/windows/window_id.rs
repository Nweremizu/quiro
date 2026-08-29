use super::*;

#[derive(Clone, Deserialize, Type)]
pub enum WindowId {
    Main,
    Settings,
    RecordingsOverlay,
    WindowCaptureOccluder { screen_id: DisplayId },
    TargetSelectOverlay { display_id: DisplayId },
    CaptureArea,
    Camera,
    RecordingControls,
    ModeSelect,
    Debug,
    Teleprompter,
    /// Multi-instance, one per open screenshot — see `is_screenshot_editor_
    /// label`/`screenshot_editor_label_for_path`. Mirrors how `Camera` is
    /// multi-instance: many labels map to this one variant, and the real
    /// identity (which path) lives only in the label, not here.
    ScreenshotEditor,
}

impl FromStr for WindowId {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "main" => Self::Main,
            "settings" => Self::Settings,
            s if is_camera_window_label(s) => Self::Camera,
            s if is_screenshot_editor_label(s) => Self::ScreenshotEditor,
            "capture-area" => Self::CaptureArea,
            // legacy identifier
            "in-progress-recording" => Self::RecordingControls,
            "recordings-overlay" => Self::RecordingsOverlay,
            "mode-select" => Self::ModeSelect,
            "debug" => Self::Debug,
            "teleprompter" => Self::Teleprompter,
            s if s.starts_with("window-capture-occluder-") => Self::WindowCaptureOccluder {
                screen_id: s
                    .replace("window-capture-occluder-", "")
                    .parse::<DisplayId>()
                    .map_err(|e| e.to_string())?,
            },
            s if s.starts_with("target-select-overlay-") => Self::TargetSelectOverlay {
                display_id: s
                    .replace("target-select-overlay-", "")
                    .parse::<DisplayId>()
                    .map_err(|e| e.to_string())?,
            },
            _ => return Err(format!("unknown window label: {s}")),
        })
    }
}

impl std::fmt::Display for WindowId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Main => write!(f, "main"),
            Self::Settings => write!(f, "settings"),
            Self::Camera => write!(f, "camera"),
            Self::WindowCaptureOccluder { screen_id } => {
                write!(f, "window-capture-occluder-{screen_id}")
            }
            Self::CaptureArea => write!(f, "capture-area"),
            Self::TargetSelectOverlay { display_id } => {
                write!(f, "target-select-overlay-{display_id}")
            }
            Self::RecordingControls => write!(f, "in-progress-recording"), // legacy identifier
            Self::RecordingsOverlay => write!(f, "recordings-overlay"),
            Self::ModeSelect => write!(f, "mode-select"),
            Self::Debug => write!(f, "debug"),
            Self::Teleprompter => write!(f, "teleprompter"),
            // Never an actual window's label (see `screenshot_editor_label_
            // for_path`) — this variant only stands for "some screenshot
            // editor, whichever" in contexts that don't need one specific.
            Self::ScreenshotEditor => write!(f, "screenshot-editor"),
        }
    }
}

impl WindowId {
    pub fn label(&self) -> String {
        self.to_string()
    }

    pub fn title(&self) -> String {
        match self {
            Self::Settings => "Quiro Settings".to_string(),
            Self::WindowCaptureOccluder { .. } => "Quiro Window Capture Occluder".to_string(),
            Self::CaptureArea => "Quiro Capture Area".to_string(),
            Self::RecordingControls => "Quiro Recording Controls".to_string(),
            Self::ModeSelect => "Quiro Mode Selection".to_string(),
            Self::Camera => "Quiro Camera".to_string(),
            Self::RecordingsOverlay => "Quiro Recordings Overlay".to_string(),
            Self::TargetSelectOverlay { .. } => "Quiro Target Select".to_string(),
            Self::Teleprompter => "Quiro Teleprompter".to_string(),
            Self::ScreenshotEditor => "Quiro Screenshot Editor".to_string(),
            _ => "Quiro".to_string(),
        }
    }

    #[cfg(target_os = "macos")]
    pub fn activates_dock(&self) -> bool {
        matches!(
            self,
            Self::Main | Self::Settings | Self::ModeSelect | Self::ScreenshotEditor
        )
    }

    pub fn is_transparent(&self) -> bool {
        if matches!(self, Self::Settings) {
            return cfg!(target_os = "macos");
        }

        matches!(
            self,
            Self::Main
                | Self::Camera
                | Self::WindowCaptureOccluder { .. }
                | Self::CaptureArea
                | Self::RecordingControls
                | Self::RecordingsOverlay
                | Self::TargetSelectOverlay { .. }
        )
    }

    pub fn get(&self, app: &AppHandle<Wry>) -> Option<WebviewWindow> {
        if matches!(self, Self::Camera) {
            return current_camera_window(app);
        }

        let label = self.label();
        app.get_webview_window(&label)
    }

    #[cfg(target_os = "macos")]
    pub fn traffic_lights_position(&self) -> Option<Option<LogicalPosition<f64>>> {
        match self {
            Self::Camera
            | Self::Main
            | Self::WindowCaptureOccluder { .. }
            | Self::CaptureArea
            | Self::RecordingsOverlay
            | Self::RecordingControls
            | Self::TargetSelectOverlay { .. } => None,
            Self::Settings => Some(Some(LogicalPosition::new(22.0, 22.0))),
            Self::Teleprompter => Some(Some(LogicalPosition::new(14.0, 14.0))),
            _ => Some(None),
        }
    }

    pub fn min_size(&self) -> Option<(f64, f64)> {
        Some(match self {
            Self::Main => (330.0, 395.0),
            Self::Settings => (780.0, 560.0),
            Self::Camera => (200.0, 200.0),
            Self::ModeSelect => (580.0, 340.0),
            _ => return None,
        })
    }
}
