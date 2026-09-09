//! H.264 encoding for the editor preview stream.
//!
//! The preview used to ship raw RGBA: 8.1MB per frame at 1080p, 486MB/s at
//! 60fps. Measurement showed the render pipeline holding a steady 60fps while
//! delivery topped out around 24fps and then collapsed, so the bytes on the
//! wire were the remaining constraint. Encoding takes a frame to tens of KB
//! instead of megabytes.
//!
//! **All-intra on purpose.** The socket is fed by a `watch` channel that keeps
//! only the newest frame and drops the rest — correct for a live preview, fatal
//! for inter-frame prediction, because a P-frame would reference frames the
//! decoder never received. Every frame being a keyframe costs bitrate and buys
//! immunity to that, to seeking, and to scrubbing.

use ffmpeg::format::Pixel;
use quiro_enc_ffmpeg::h264::{H264EncoderBuilder, H264Preset};
use quiro_enc_ffmpeg::h264_packet::H264PacketEncoder;
use quiro_media_info::VideoInfo;

/// One encoded frame, plus the decoder configuration when it has changed.
pub struct EncodedPreviewFrame {
    pub data: Vec<u8>,
    /// SPS/PPS for `VideoDecoder.configure`, on **every** frame.
    ///
    /// Sending it once was a bug: clients connect after the encoder has already
    /// produced frames, and reconnect during a session, so any client that was
    /// not listening at that exact moment never configured its decoder and
    /// rendered nothing at all. It is tens of bytes against a keyframe, so
    /// repeating it costs nothing measurable.
    pub config: Option<Vec<u8>>,
    pub width: u32,
    pub height: u32,
}

/// Rebuilds itself whenever the preview's output size changes — which happens
/// on every quality switch and aspect-ratio edit.
/// Hardware first for the preview.
///
/// The default priority selected `libx264`, which measured ~35ms per 1080p
/// all-intra frame and degraded to ~100ms — a hard ceiling of 10fps regardless
/// of how little data reaches the wire. The builder still falls back through
/// this list, so a machine whose hardware encoder fails its self-test simply
/// lands on software as before.
#[cfg(target_os = "windows")]
const PREVIEW_ENCODER_PRIORITY: &[&str] =
    &["h264_nvenc", "h264_qsv", "h264_amf", "h264_mf", "libx264"];
#[cfg(target_os = "macos")]
const PREVIEW_ENCODER_PRIORITY: &[&str] = &["h264_videotoolbox", "libx264"];
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
const PREVIEW_ENCODER_PRIORITY: &[&str] = &["h264_nvenc", "h264_qsv", "libx264"];

pub struct PreviewEncoder {
    encoder: Option<H264PacketEncoder>,
    /// Reused across frames. Allocating a fresh 8.1MB RGBA frame per encode was
    /// its own source of the slowdown — the same allocation churn that made
    /// `pack_avg_ms` climb on the raw path.
    input: Option<ffmpeg::frame::Video>,
    /// Pixel format the encoder was built for; a change rebuilds it.
    format: Option<Pixel>,
    converted: Option<ffmpeg::frame::Video>,
    size: (u32, u32),
    /// Kept for the encoder's lifetime and attached to every frame, so a client
    /// can join or rejoin the stream at any point.
    config: Option<Vec<u8>>,
    fps: u32,
}

impl PreviewEncoder {
    pub fn new(fps: u32) -> Self {
        Self {
            encoder: None,
            input: None,
            format: None,
            converted: None,
            size: (0, 0),
            config: None,
            fps: fps.max(1),
        }
    }

    fn ensure_encoder(
        &mut self,
        input_format: Pixel,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        if self.encoder.is_some()
            && self.size == (width, height)
            && self.format == Some(input_format)
        {
            return Ok(());
        }

        // Odd dimensions are rounded up by the builder; track what we asked for
        // so a repeated request does not rebuild every frame.
        let info = VideoInfo::from_raw_ffmpeg(input_format, width, height, self.fps);
        let encoder = H264EncoderBuilder::new(info)
            .with_preset(H264Preset::Ultrafast)
            .with_encoder_priority_override(PREVIEW_ENCODER_PRIORITY)
            .all_intra()
            .build_standalone()
            .map_err(|e| format!("preview encoder build failed: {e}"))?;

        let config = encoder.extradata();
        tracing::info!(
            codec = encoder.codec_name(),
            width,
            height,
            config_bytes = config.len(),
            "Preview encoder ready"
        );

        self.config = (!config.is_empty()).then_some(config);
        self.size = (width, height);
        self.format = Some(input_format);
        self.encoder = Some(encoder);
        // Sized to the new output; the converted frame is reallocated by the
        // encoder on first use.
        self.input = None;
        self.converted = None;
        Ok(())
    }

    /// Encodes one NV12 frame — a full-height Y plane followed by a
    /// half-height interleaved UV plane, both at `y_stride`.
    ///
    /// NV12 is what the GPU now hands back and what the encoder wants, so this
    /// is a plane copy with no colour conversion on either side.
    pub fn encode_nv12(
        &mut self,
        data: &[u8],
        y_stride: u32,
        width: u32,
        height: u32,
        frame_number: u32,
    ) -> Result<Option<EncodedPreviewFrame>, String> {
        self.ensure_encoder(Pixel::NV12, width, height)?;
        let frame = self
            .input
            .get_or_insert_with(|| ffmpeg::frame::Video::new(Pixel::NV12, width, height));

        let src_stride = y_stride as usize;
        let row_bytes = width as usize;
        let y_rows = height as usize;
        let uv_rows = height.div_ceil(2) as usize;

        for (plane, rows, src_offset) in
            [(0usize, y_rows, 0usize), (1, uv_rows, src_stride * y_rows)]
        {
            let dst_stride = frame.stride(plane);
            let dst = frame.data_mut(plane);
            for row in 0..rows {
                let from = src_offset + row * src_stride;
                let to = row * dst_stride;
                if from + row_bytes > data.len() || to + row_bytes > dst.len() {
                    break;
                }
                dst[to..to + row_bytes].copy_from_slice(&data[from..from + row_bytes]);
            }
        }

        self.emit(frame_number, width, height)
    }

    /// Encodes one RGBA frame. `stride` is the GPU readback's padded row width,
    /// which is usually wider than `width * 4`.
    pub fn encode(
        &mut self,
        rgba: &[u8],
        stride: u32,
        width: u32,
        height: u32,
        frame_number: u32,
    ) -> Result<Option<EncodedPreviewFrame>, String> {
        self.ensure_encoder(Pixel::RGBA, width, height)?;
        let frame = self
            .input
            .get_or_insert_with(|| ffmpeg::frame::Video::new(Pixel::RGBA, width, height));
        let dst_stride = frame.stride(0);
        let src_stride = stride as usize;
        let row_bytes = (width as usize) * 4;

        {
            let dst = frame.data_mut(0);
            for row in 0..height as usize {
                let from = row * src_stride;
                let to = row * dst_stride;
                if from + row_bytes > rgba.len() || to + row_bytes > dst.len() {
                    break;
                }
                dst[to..to + row_bytes].copy_from_slice(&rgba[from..from + row_bytes]);
            }
        }

        self.emit(frame_number, width, height)
    }

    /// Runs the encoder over whatever is currently in `self.input`.
    fn emit(
        &mut self,
        frame_number: u32,
        width: u32,
        height: u32,
    ) -> Result<Option<EncodedPreviewFrame>, String> {
        let encoder = self
            .encoder
            .as_mut()
            .expect("callers call ensure_encoder first");
        let frame = self.input.as_mut().expect("callers fill the input frame");

        let timestamp = std::time::Duration::from_secs_f64(frame_number as f64 / self.fps as f64);

        let mut encoded: Option<Vec<u8>> = None;
        encoder
            .encode_frame_reusable(frame, &mut self.converted, timestamp, |packet| {
                // All-intra, so at most one packet per frame; if the encoder
                // ever emits more, the later one is the real picture data.
                encoded = Some(packet.data);
                Ok(())
            })
            .map_err(|e| format!("preview encode failed: {e}"))?;

        Ok(encoded.map(|data| EncodedPreviewFrame {
            data,
            config: self.config.clone(),
            width,
            height,
        }))
    }
}
