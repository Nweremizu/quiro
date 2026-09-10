//! GPU-native camera frame conversion (macOS).
//!
//! On Windows the camera preview can hand a captured frame to the GPU without
//! a CPU round-trip. The macOS equivalent means bridging the frame's
//! `CVPixelBuffer` into wgpu as a texture — IOSurface → `MTLTexture` →
//! `wgpu::Texture` via wgpu-hal's Metal backend — plus a YCbCr→RGB pass for
//! the biplanar formats AVFoundation actually delivers (`420v`/`420f`), since
//! only some cameras hand back BGRA.
//!
//! That isn't implemented yet, so this reports the fast path as unavailable
//! and the preview falls back to the CPU conversion in `camera.rs` (it logs
//! "Camera GPU-native preview unavailable (..); using CPU conversion" once and
//! carries on). The preview is correct either way — this costs a per-frame
//! copy and colour conversion on the CPU, not a feature.
//!
//! ponytail: deliberately unimplemented, not overlooked. Implement it when
//! macOS camera preview CPU cost actually shows up in a profile — and with a
//! Mac on hand, since none of this is testable from CI alone.

use quiro_recording::NativeCameraFrame;

/// What kind of pixel data a frame carries, once implemented — BGRA vs one of
/// the biplanar YCbCr formats. Uninhabited for now: [`classify_frame`] never
/// returns one, which is what makes the rest of this module unreachable rather
/// than merely unused.
pub enum NativeFrameKind {}

pub struct NativeFrameConverter {
    /// Uninhabited, so a `NativeFrameConverter` can't be constructed at all.
    /// [`Self::new`] returning `None` is then a fact the type system carries,
    /// rather than a runtime detail a future edit could silently contradict.
    _uninhabited: NativeFrameKind,
}

impl NativeFrameConverter {
    pub fn new(_device: &wgpu::Device) -> Option<Self> {
        None
    }

    pub fn render_frame(
        &self,
        _device: &wgpu::Device,
        _queue: &wgpu::Queue,
        _frame: &NativeCameraFrame,
        _kind: &NativeFrameKind,
        _target: &wgpu::TextureView,
    ) -> Result<(), String> {
        // Unreachable: `self` cannot exist.
        match self._uninhabited {}
    }
}

pub fn classify_frame(_frame: &NativeCameraFrame) -> Result<NativeFrameKind, String> {
    Err("GPU-native camera frame conversion is not implemented on macOS".to_string())
}
