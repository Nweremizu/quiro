use std::sync::Arc;
use std::time::Instant;

use quiro_project::{ClipTransitionType, CursorEvents, ProjectConfiguration};
use quiro_rendering::{
    DecodedSegmentFrames, FrameLayout, FrameRenderStageTimings, FrameRenderer, Nv12RenderedFrame,
    ProjectUniforms, RenderVideoConstants, RenderedFrame, RendererLayers, TransitionRenderInput,
};
use tokio::sync::{mpsc, oneshot};

use crate::telemetry::{PlaybackRenderOutputFormat, PlaybackTelemetry, PlaybackTelemetryEvent};

#[allow(clippy::large_enum_variant)]
pub enum RendererMessage {
    PrepareOutputSize {
        width: u32,
        height: u32,
    },
    RenderFrame {
        segment_frames: DecodedSegmentFrames,
        uniforms: ProjectUniforms,
        finished: oneshot::Sender<bool>,
        cursor: Arc<CursorEvents>,
        queued_at: Instant,
        // Single-shot callers (a paused scrub) have no follow-up frame to
        // flush the NV12 pipeline's one-frame-latency buffer, so they need
        // the immediate/blocking variant. Continuous playback callers keep
        // the pipelined path for throughput — their next frame flushes it.
        immediate: bool,
    },
    RenderTransition {
        outgoing: RendererTransitionInput,
        incoming: RendererTransitionInput,
        kind: ClipTransitionType,
        progress: f32,
        finished: oneshot::Sender<bool>,
        queued_at: Instant,
    },
    Stop {
        finished: oneshot::Sender<()>,
    },
}

pub struct RendererTransitionInput {
    pub segment_frames: DecodedSegmentFrames,
    pub uniforms: ProjectUniforms,
    pub cursor: Arc<CursorEvents>,
}

pub enum EditorFrameOutput {
    Rgba(RenderedFrame),
    Nv12(Nv12RenderedFrame),
}

impl EditorFrameOutput {
    pub fn frame_number(&self) -> u32 {
        match self {
            Self::Rgba(frame) => frame.frame_number,
            Self::Nv12(frame) => frame.frame_number,
        }
    }
}

pub type RendererLayersReceiver = oneshot::Receiver<RendererLayers>;

pub type EditorFrameCallback = Box<dyn FnMut(EditorFrameOutput, FrameLayout) + Send>;

pub struct Renderer {
    rx: mpsc::Receiver<RendererMessage>,
    frame_cb: EditorFrameCallback,
    render_constants: Arc<RenderVideoConstants>,
    layers_rx: RendererLayersReceiver,
    telemetry: Option<PlaybackTelemetry>,
}

pub struct RendererHandle {
    tx: mpsc::Sender<RendererMessage>,
    telemetry: Option<PlaybackTelemetry>,
}

pub fn start_renderer_layers_creation(
    render_constants: &Arc<RenderVideoConstants>,
    project: &ProjectConfiguration,
) -> RendererLayersReceiver {
    let (layers_tx, layers_rx) = oneshot::channel();
    let constants = render_constants.clone();
    let use_svg = project.cursor.use_svg;
    let cursor_type = project.cursor.cursor_type().clone();
    std::thread::Builder::new()
        .name("renderer-layers-init".into())
        .spawn(move || {
            let mut layers = RendererLayers::new_with_options(
                &constants.device,
                &constants.queue,
                constants.is_software_adapter,
            );
            layers.preload_cursor_assets(&constants, use_svg, &cursor_type);
            let _ = layers_tx.send(layers);
        })
        .expect("failed to spawn renderer layers init thread");
    layers_rx
}

pub async fn finish_renderer_layers_creation(
    layers_rx: RendererLayersReceiver,
) -> RendererLayersReceiver {
    let (layers_tx, ready_layers_rx) = oneshot::channel();
    if let Ok(layers) = layers_rx.await {
        let _ = layers_tx.send(layers);
    }
    ready_layers_rx
}

impl Renderer {
    pub fn spawn(
        render_constants: Arc<RenderVideoConstants>,
        frame_cb: EditorFrameCallback,
        layers_rx: RendererLayersReceiver,
    ) -> Result<RendererHandle, String> {
        Self::spawn_with_telemetry(render_constants, frame_cb, layers_rx, None)
    }

    pub fn spawn_with_telemetry(
        render_constants: Arc<RenderVideoConstants>,
        frame_cb: EditorFrameCallback,
        layers_rx: RendererLayersReceiver,
        telemetry: Option<PlaybackTelemetry>,
    ) -> Result<RendererHandle, String> {
        let (tx, rx) = mpsc::channel(64);

        let this = Self {
            rx,
            frame_cb,
            render_constants,
            layers_rx,
            telemetry: telemetry.clone(),
        };

        tokio::spawn(this.run());

        Ok(RendererHandle { tx, telemetry })
    }

    async fn run(self) {
        let Renderer {
            mut rx,
            mut frame_cb,
            render_constants,
            layers_rx,
            telemetry,
        } = self;

        let mut frame_renderer = FrameRenderer::new(&render_constants);

        let mut layers = match layers_rx.await {
            Ok(layers) => layers,
            Err(_) => {
                tracing::error!("Failed to receive pre-created renderer layers, creating inline");
                let mut layers = RendererLayers::new_with_options(
                    &render_constants.device,
                    &render_constants.queue,
                    render_constants.is_software_adapter,
                );
                let project = render_constants.recording_meta.project_config();
                layers.preload_cursor_assets(
                    &render_constants,
                    project.cursor.use_svg,
                    project.cursor.cursor_type(),
                );
                layers
            }
        };

        struct PendingFrame {
            input: PendingRenderInput,
            finished: oneshot::Sender<bool>,
            queued_at: Instant,
            immediate: bool,
        }

        enum PendingRenderInput {
            Single(RendererTransitionInput),
            Transition {
                outgoing: RendererTransitionInput,
                incoming: Box<RendererTransitionInput>,
                kind: ClipTransitionType,
                progress: f32,
            },
        }

        impl PendingRenderInput {
            fn uniforms(&self) -> &ProjectUniforms {
                match self {
                    Self::Single(input) => &input.uniforms,
                    Self::Transition { incoming, .. } => &incoming.uniforms,
                }
            }
        }

        let mut pending_frame: Option<PendingFrame> = None;

        loop {
            let frame_to_render = if let Some(pending) = pending_frame.take() {
                Some(pending)
            } else {
                match rx.recv().await {
                    Some(RendererMessage::PrepareOutputSize { width, height }) => {
                        Self::prepare_output_size(&telemetry, &mut frame_renderer, width, height);
                        continue;
                    }
                    Some(RendererMessage::RenderFrame {
                        segment_frames,
                        uniforms,
                        finished,
                        cursor,
                        queued_at,
                        immediate,
                    }) => Some(PendingFrame {
                        input: PendingRenderInput::Single(RendererTransitionInput {
                            segment_frames,
                            uniforms,
                            cursor,
                        }),
                        finished,
                        queued_at,
                        immediate,
                    }),
                    Some(RendererMessage::RenderTransition {
                        outgoing,
                        incoming,
                        kind,
                        progress,
                        finished,
                        queued_at,
                    }) => Some(PendingFrame {
                        input: PendingRenderInput::Transition {
                            outgoing,
                            incoming: Box::new(incoming),
                            kind,
                            progress,
                        },
                        immediate: false,
                        finished,
                        queued_at,
                    }),
                    Some(RendererMessage::Stop { finished }) => {
                        let _ = finished.send(());
                        return;
                    }
                    None => return,
                }
            };

            let Some(mut current) = frame_to_render else {
                continue;
            };

            let mut drained_count = 0u32;
            let queue_drain_start = Instant::now();
            while let Ok(msg) = rx.try_recv() {
                match msg {
                    RendererMessage::PrepareOutputSize { width, height } => {
                        Self::prepare_output_size(&telemetry, &mut frame_renderer, width, height);
                    }
                    RendererMessage::RenderFrame {
                        segment_frames,
                        uniforms,
                        finished,
                        cursor,
                        queued_at,
                        immediate,
                    } => {
                        let dropped_frame_number = current.input.uniforms().frame_number;
                        let replacement_frame_number = uniforms.frame_number;
                        let _ = current.finished.send(false);
                        if let Some(telemetry) = &telemetry {
                            telemetry.emit(PlaybackTelemetryEvent::RendererDropped {
                                frame_number: dropped_frame_number,
                                replacement_frame_number,
                            });
                        }
                        current = PendingFrame {
                            input: PendingRenderInput::Single(RendererTransitionInput {
                                segment_frames,
                                uniforms,
                                cursor,
                            }),
                            finished,
                            queued_at,
                            immediate,
                        };
                        drained_count += 1;
                    }
                    RendererMessage::RenderTransition {
                        outgoing,
                        incoming,
                        kind,
                        progress,
                        finished,
                        queued_at,
                    } => {
                        let dropped_frame_number = current.input.uniforms().frame_number;
                        let replacement_frame_number = incoming.uniforms.frame_number;
                        let _ = current.finished.send(false);
                        if let Some(telemetry) = &telemetry {
                            telemetry.emit(PlaybackTelemetryEvent::RendererDropped {
                                frame_number: dropped_frame_number,
                                replacement_frame_number,
                            });
                        }
                        current = PendingFrame {
                            input: PendingRenderInput::Transition {
                                outgoing,
                                incoming: Box::new(incoming),
                                kind,
                                progress,
                            },
                            finished,
                            queued_at,
                            immediate: false,
                        };
                        drained_count += 1;
                    }
                    RendererMessage::Stop { finished } => {
                        let _ = current.finished.send(false);
                        let _ = finished.send(());
                        return;
                    }
                }
                if queue_drain_start.elapsed().as_millis() > 5 {
                    break;
                }
            }

            let queue_wait = current.queued_at.elapsed();
            let drain_duration = queue_drain_start.elapsed();
            let flush_start = Instant::now();
            if drained_count > 0 {
                let _ = frame_renderer.flush_pipeline().await;
            }
            let flush_duration = if drained_count > 0 {
                flush_start.elapsed()
            } else {
                std::time::Duration::ZERO
            };

            let render_start = Instant::now();
            let input_frame_number = current.input.uniforms().frame_number;
            let frame_layout = current.input.uniforms().frame_layout();
            let immediate = current.immediate;
            let render_result = match current.input {
                // NV12 for the common path: the GPU converts, so the readback
                // moves 3.1MB instead of 8.1MB at 1080p — the readback being
                // the last remaining constraint on preview throughput — and the
                // encoder takes NV12 natively, skipping a CPU colour
                // conversion. Transitions stay RGBA below; they are rare and
                // have no immediate NV12 variant to call.
                //
                // This calls `render_nv12` (not `render_immediate_nv12`) for
                // continuous playback deliberately: the NV12 converter holds
                // two readback buffers so a transfer can overlap the next
                // render, but only once two are ever queued at once —
                // `render_immediate_nv12` forces a synchronous wait the
                // instant one isn't ready, which would engage every frame and
                // remove the overlap this crate is built around. `render_nv12`
                // accepts `None` (one frame of latency), and the next frame in
                // the stream flushes it.
                //
                // A single-shot request (a paused scrub, a quality change)
                // has no next frame to flush that buffer, so it must use the
                // immediate variant or the frontend never sees the result.
                PendingRenderInput::Single(input) if immediate => frame_renderer
                    .render_immediate_nv12_with_timings(
                        input.segment_frames,
                        input.uniforms,
                        &input.cursor,
                        true,
                        &mut layers,
                    )
                    .await
                    .map(|(frame, timings)| (Some(EditorFrameOutput::Nv12(frame)), timings)),
                PendingRenderInput::Single(input) => frame_renderer
                    .render_nv12_with_timings(
                        input.segment_frames,
                        input.uniforms,
                        &input.cursor,
                        true,
                        &mut layers,
                    )
                    .await
                    .map(|(frame, timings)| (frame.map(EditorFrameOutput::Nv12), timings)),
                PendingRenderInput::Transition {
                    outgoing,
                    incoming,
                    kind,
                    progress,
                } => frame_renderer
                    .render_transition_immediate(
                        TransitionRenderInput {
                            segment_frames: outgoing.segment_frames,
                            uniforms: outgoing.uniforms,
                            cursor: &outgoing.cursor,
                            render_display: true,
                        },
                        TransitionRenderInput {
                            segment_frames: incoming.segment_frames,
                            uniforms: incoming.uniforms,
                            cursor: &incoming.cursor,
                            render_display: true,
                        },
                        kind,
                        progress,
                        &mut layers,
                    )
                    .await
                    .map(|frame| {
                        (
                            Some(EditorFrameOutput::Rgba(frame)),
                            FrameRenderStageTimings::default(),
                        )
                    }),
            };
            match render_result {
                Ok((Some(output), render_stage_timings)) => {
                    let render_duration = render_start.elapsed();
                    let frame_number = output.frame_number();
                    let output_format = match output {
                        EditorFrameOutput::Nv12(_) => PlaybackRenderOutputFormat::Nv12,
                        EditorFrameOutput::Rgba(_) => PlaybackRenderOutputFormat::Rgba,
                    };
                    let callback_start = Instant::now();
                    (frame_cb)(output, frame_layout);
                    let callback_duration = callback_start.elapsed();
                    if let Some(telemetry) = &telemetry {
                        telemetry.emit(PlaybackTelemetryEvent::RendererFrame {
                            frame_number,
                            input_frame_number,
                            queue_wait,
                            drain_duration,
                            flush_duration,
                            render_duration,
                            render_stage_timings: Box::new(render_stage_timings),
                            callback_duration,
                            drained_count,
                            output_format,
                        });
                    }
                    let _ = current.finished.send(true);
                }
                // The readback that would have covered this submission isn't
                // ready yet — normal for roughly the first frame after the
                // renderer or the NV12 converter was (re)created. Nothing to
                // hand to `frame_cb` this iteration; the frame reappears one
                // call later via the overlap once a second is queued.
                Ok((None, _)) => {
                    let _ = current.finished.send(true);
                }
                Err(e) => {
                    tracing::error!(error = %e, "Failed to render frame in editor");
                    let _ = current.finished.send(false);
                }
            }
        }
    }

    fn prepare_output_size(
        telemetry: &Option<PlaybackTelemetry>,
        frame_renderer: &mut FrameRenderer<'_>,
        width: u32,
        height: u32,
    ) {
        let start = Instant::now();
        frame_renderer.prepare_output_size(width, height);
        if let Some(telemetry) = telemetry {
            telemetry.emit(PlaybackTelemetryEvent::RendererPrepared {
                output_width: width,
                output_height: height,
                duration: start.elapsed(),
            });
        }
    }
}

impl RendererHandle {
    pub fn prepare_output_size(&self, width: u32, height: u32) {
        let _ = self
            .tx
            .try_send(RendererMessage::PrepareOutputSize { width, height });
    }

    pub fn render_frame(
        &self,
        segment_frames: DecodedSegmentFrames,
        uniforms: ProjectUniforms,
        cursor: Arc<CursorEvents>,
    ) {
        let (finished_tx, _finished_rx) = oneshot::channel();
        let frame_number = uniforms.frame_number;
        if self
            .tx
            .try_send(RendererMessage::RenderFrame {
                segment_frames,
                uniforms,
                finished: finished_tx,
                cursor,
                queued_at: Instant::now(),
                immediate: false,
            })
            .is_err()
            && let Some(telemetry) = &self.telemetry
        {
            telemetry.emit(PlaybackTelemetryEvent::RendererSendFailed { frame_number });
        }
    }

    pub fn render_transition_frame(
        &self,
        outgoing: RendererTransitionInput,
        incoming: RendererTransitionInput,
        kind: ClipTransitionType,
        progress: f32,
    ) {
        let (finished_tx, _finished_rx) = oneshot::channel();
        let frame_number = incoming.uniforms.frame_number;
        if self
            .tx
            .try_send(RendererMessage::RenderTransition {
                outgoing,
                incoming,
                kind,
                progress,
                finished: finished_tx,
                queued_at: Instant::now(),
            })
            .is_err()
            && let Some(telemetry) = &self.telemetry
        {
            telemetry.emit(PlaybackTelemetryEvent::RendererSendFailed { frame_number });
        }
    }

    pub fn render_frame_blocking(
        &self,
        segment_frames: DecodedSegmentFrames,
        uniforms: ProjectUniforms,
        cursor: Arc<CursorEvents>,
    ) {
        let (finished_tx, _finished_rx) = oneshot::channel();
        let frame_number = uniforms.frame_number;
        let msg = RendererMessage::RenderFrame {
            segment_frames,
            uniforms,
            finished: finished_tx,
            cursor,
            queued_at: Instant::now(),
            immediate: false,
        };
        if self.tx.blocking_send(msg).is_err()
            && let Some(telemetry) = &self.telemetry
        {
            telemetry.emit(PlaybackTelemetryEvent::RendererSendFailed { frame_number });
        }
    }

    pub async fn render_frame_confirmed(
        &self,
        segment_frames: DecodedSegmentFrames,
        uniforms: ProjectUniforms,
        cursor: Arc<CursorEvents>,
    ) -> bool {
        let (finished_tx, finished_rx) = oneshot::channel();
        let frame_number = uniforms.frame_number;
        let msg = RendererMessage::RenderFrame {
            segment_frames,
            uniforms,
            finished: finished_tx,
            cursor,
            queued_at: Instant::now(),
            // Single-shot: no follow-up frame will arrive to flush the
            // pipelined NV12 buffer, so this must render synchronously.
            immediate: true,
        };
        if self.tx.send(msg).await.is_err() {
            if let Some(telemetry) = &self.telemetry {
                telemetry.emit(PlaybackTelemetryEvent::RendererSendFailed { frame_number });
            }
            return false;
        }

        finished_rx.await.unwrap_or(false)
    }

    pub async fn render_transition_frame_confirmed(
        &self,
        outgoing: RendererTransitionInput,
        incoming: RendererTransitionInput,
        kind: ClipTransitionType,
        progress: f32,
    ) -> bool {
        let (finished_tx, finished_rx) = oneshot::channel();
        let frame_number = incoming.uniforms.frame_number;
        let message = RendererMessage::RenderTransition {
            outgoing,
            incoming,
            kind,
            progress,
            finished: finished_tx,
            queued_at: Instant::now(),
        };
        if self.tx.send(message).await.is_err() {
            if let Some(telemetry) = &self.telemetry {
                telemetry.emit(PlaybackTelemetryEvent::RendererSendFailed { frame_number });
            }
            return false;
        }

        finished_rx.await.unwrap_or(false)
    }

    pub fn render_frame_wait(
        &self,
        segment_frames: DecodedSegmentFrames,
        uniforms: ProjectUniforms,
        cursor: Arc<CursorEvents>,
    ) -> bool {
        let (finished_tx, finished_rx) = oneshot::channel();
        let frame_number = uniforms.frame_number;
        let msg = RendererMessage::RenderFrame {
            segment_frames,
            uniforms,
            finished: finished_tx,
            cursor,
            queued_at: Instant::now(),
            immediate: false,
        };
        if self.tx.blocking_send(msg).is_err() {
            if let Some(telemetry) = &self.telemetry {
                telemetry.emit(PlaybackTelemetryEvent::RendererSendFailed { frame_number });
            }
            return false;
        }

        finished_rx.blocking_recv().unwrap_or(false)
    }

    pub fn render_transition_frame_wait(
        &self,
        outgoing: RendererTransitionInput,
        incoming: RendererTransitionInput,
        kind: ClipTransitionType,
        progress: f32,
    ) -> bool {
        let (finished_tx, finished_rx) = oneshot::channel();
        let frame_number = incoming.uniforms.frame_number;
        let message = RendererMessage::RenderTransition {
            outgoing,
            incoming,
            kind,
            progress,
            finished: finished_tx,
            queued_at: Instant::now(),
        };
        if self.tx.blocking_send(message).is_err() {
            if let Some(telemetry) = &self.telemetry {
                telemetry.emit(PlaybackTelemetryEvent::RendererSendFailed { frame_number });
            }
            return false;
        }

        finished_rx.blocking_recv().unwrap_or(false)
    }

    pub async fn stop(&self) {
        let (tx, rx) = oneshot::channel();
        if self
            .tx
            .send(RendererMessage::Stop { finished: tx })
            .await
            .is_err()
        {
            tracing::debug!("Renderer stop message skipped because renderer task already stopped");
        }
        let _ = rx.await;
    }
}
