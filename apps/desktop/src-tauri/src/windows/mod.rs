#![allow(unused_mut)]
#![allow(unused_imports)]

use anyhow::anyhow;
use futures::pin_mut;
use scap_targets::{Display, DisplayId, bounds::LogicalBounds};
use serde::Deserialize;
use specta::Type;
use std::{
    ops::Deref,
    path::PathBuf,
    str::FromStr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry,
};
use tauri_specta::Event;
use tokio::sync::RwLock;
use tracing::{debug, error, info, instrument, warn};

#[cfg(target_os = "macos")]
use crate::panel_manager::{PanelManager, PanelState, PanelWindowType, is_window_handle_valid};

use crate::{
    App, ArcLock, CameraWindowCloseGate, CameraWindowPositionGuard, MainWindowReadyState,
    NewNotification, RequestSetTargetMode, camera_preview_error_message, emit_camera_preview_clear,
    emit_camera_preview_error, fake_window,
    general_settings::{self, AppTheme, GeneralSettingsStore},
    permissions,
    recording::{RecordingEvent, RecordingInputKind},
    recording_settings::RecordingTargetMode,
    target_select_overlay::WindowFocusManager,
    window_exclusion::WindowExclusion,
};
use quiro_recording::{feeds, sources::screen_capture::ScreenCaptureTarget};

mod commands;
mod content_protection;
mod geometry;
mod helpers;
mod platform;
mod show_window;
mod variants;
mod window_id;

pub use commands::*;
pub use content_protection::*;
pub use geometry::*;
pub use helpers::*;
pub use platform::*;
pub use show_window::*;
pub use window_id::*;
