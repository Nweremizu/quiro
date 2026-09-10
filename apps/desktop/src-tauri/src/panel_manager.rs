//! Lifecycle tracking for the macOS windows that get converted to `NSPanel`s.
//!
//! The camera preview is an NSPanel so it can float above full-screen apps
//! without taking focus. Converting a window to a panel is a one-way, main-
//! thread operation, and the window can be shown/hidden repeatedly while an
//! earlier create or destroy is still in flight. Without coordination, a
//! rapid toggle can start a second conversion on a window that's mid-teardown.
//!
//! This tracks a small state machine per panel window so callers can ask "is
//! one already being created?" and wait rather than racing.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use tauri::{Manager, WebviewWindow};
use tauri_nspanel::{ManagerExt, Panel, WebviewWindowExt};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PanelWindowType {
    Camera,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PanelState {
    /// No window exists.
    None,
    /// A window is being built and converted to a panel.
    Creating,
    /// The panel exists and is usable.
    Ready,
    /// The window is being torn down.
    Destroying,
}

#[derive(Debug, Clone, Copy)]
struct Entry {
    state: PanelState,
    /// Identifies the create attempt that owns this entry, so a stale
    /// completion from an earlier attempt can't mark a newer one ready.
    operation_id: u64,
}

impl Default for Entry {
    fn default() -> Self {
        Self {
            state: PanelState::None,
            operation_id: 0,
        }
    }
}

type Entries = Arc<Mutex<HashMap<PanelWindowType, Entry>>>;

#[derive(Default)]
pub struct PanelManager {
    entries: Entries,
    next_operation_id: AtomicU64,
}

impl PanelManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn get_state(&self, window_type: PanelWindowType) -> PanelState {
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&window_type)
            .map(|entry| entry.state)
            .unwrap_or(PanelState::None)
    }

    /// Claim the right to create this panel. `None` means someone else already
    /// holds the claim (or the panel is up), and the caller should wait rather
    /// than start a second conversion.
    ///
    /// Dropping the returned guard without calling [`PanelCreateGuard::mark_completed`]
    /// releases the claim, so a failed or panicking create can't wedge the
    /// state at `Creating` forever.
    pub async fn try_begin_create(
        &self,
        window_type: PanelWindowType,
    ) -> Option<PanelCreateGuard> {
        let operation_id = self.next_operation_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = entries.entry(window_type).or_default();

        if entry.state != PanelState::None {
            return None;
        }

        *entry = Entry {
            state: PanelState::Creating,
            operation_id,
        };

        Some(PanelCreateGuard {
            entries: Arc::clone(&self.entries),
            window_type,
            operation_id,
            completed: false,
        })
    }

    /// Mark the panel usable. `operation_id` of 0 means "unconditional" — used
    /// when adopting a window that already exists rather than completing a
    /// create we started.
    pub async fn mark_ready(&self, window_type: PanelWindowType, operation_id: u64) {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = entries.entry(window_type).or_default();

        // A late completion from a superseded attempt must not clobber the
        // state of the attempt that replaced it.
        if operation_id != 0 && entry.operation_id != operation_id {
            return;
        }

        entry.state = PanelState::Ready;
    }

    pub async fn force_reset(&self, window_type: PanelWindowType) {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        entries.insert(window_type, Entry::default());
    }

    /// Wait until the panel reaches one of `states`. Returns false on timeout.
    ///
    /// Polls rather than using a notifier: transitions are driven from main-
    /// thread callbacks and window events, several of which can't easily
    /// signal back, and the waits here are bounded to a few hundred ms.
    pub async fn wait_for_state(
        &self,
        window_type: PanelWindowType,
        states: &[PanelState],
        timeout: Duration,
    ) -> bool {
        const POLL_INTERVAL: Duration = Duration::from_millis(25);
        let deadline = Instant::now() + timeout;

        loop {
            if states.contains(&self.get_state(window_type).await) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }
}

pub struct PanelCreateGuard {
    entries: Entries,
    window_type: PanelWindowType,
    pub operation_id: u64,
    completed: bool,
}

impl PanelCreateGuard {
    /// The create succeeded — leave the state alone on drop.
    pub fn mark_completed(&mut self) {
        self.completed = true;
    }
}

impl Drop for PanelCreateGuard {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Only release the claim if it's still ours; a newer attempt may have
        // taken over after a force_reset.
        if let Some(entry) = entries.get_mut(&self.window_type)
            && entry.operation_id == self.operation_id
        {
            *entry = Entry::default();
        }
    }
}

/// Convert a window to an `NSPanel`, returning the existing panel if it has
/// already been converted — `to_panel()` is not idempotent, and these windows
/// are shown and hidden repeatedly.
pub fn try_to_panel(window: &WebviewWindow) -> tauri::Result<Panel> {
    if let Ok(panel) = window.app_handle().get_webview_panel(window.label()) {
        return Ok(panel);
    }
    window.to_panel()
}

/// Whether the window still has a live native handle.
///
/// A window can outlive its `NSWindow` in Tauri's registry briefly during
/// teardown; acting on one in that state is what produced the
/// "exists but handle is invalid" crashes the camera path guards against.
pub fn is_window_handle_valid(window: &WebviewWindow) -> bool {
    window
        .ns_window()
        .map(|handle| !handle.is_null())
        .unwrap_or(false)
}
