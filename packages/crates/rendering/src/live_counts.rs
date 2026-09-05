//! [DEBUG-7f21] Live-instance census for the GPU objects the preview path
//! allocates.
//!
//! Preview frame rate halves after the first playback and then plateaus, which
//! is the shape of exactly one extra thing existing from the second playback
//! onward rather than of unbounded growth. These counters answer that directly:
//! each type increments on construction and decrements on drop, and the census
//! is logged at every playback start. A reading of 1 -> 2 -> 2 on any row is
//! the answer.
//!
//! Temporary diagnostic. Remove with the rest of the `DEBUG-7f21` tag.

use std::sync::atomic::{AtomicI64, Ordering::Relaxed};

#[derive(Default)]
pub struct LiveGpuObjectCounts {
    pub render_sessions: AtomicI64,
    pub nv12_converters: AtomicI64,
    pub frame_renderers: AtomicI64,
    pub renderer_layers: AtomicI64,
    pub render_constants: AtomicI64,
    pub decoder_threads: AtomicI64,
    pub transition_compositors: AtomicI64,
}

impl LiveGpuObjectCounts {
    pub fn log(&self, context: &'static str) {
        tracing::info!(
            context,
            render_sessions = self.render_sessions.load(Relaxed),
            nv12_converters = self.nv12_converters.load(Relaxed),
            frame_renderers = self.frame_renderers.load(Relaxed),
            renderer_layers = self.renderer_layers.load(Relaxed),
            render_constants = self.render_constants.load(Relaxed),
            decoder_threads = self.decoder_threads.load(Relaxed),
            transition_compositors = self.transition_compositors.load(Relaxed),
            "LIVE_GPU_OBJECTS census"
        );
    }
}

pub static LIVE_GPU_OBJECTS: std::sync::LazyLock<LiveGpuObjectCounts> =
    std::sync::LazyLock::new(LiveGpuObjectCounts::default);

/// Increments its counter on construction and decrements on drop, so a type
/// only needs to hold one of these to be counted through every exit path.
pub struct LiveCountGuard(&'static AtomicI64);

impl LiveCountGuard {
    pub fn new(counter: &'static AtomicI64) -> Self {
        counter.fetch_add(1, Relaxed);
        Self(counter)
    }
}

impl Drop for LiveCountGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Relaxed);
    }
}
