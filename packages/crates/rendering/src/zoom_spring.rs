//! Deterministic spring-simulated zoom transform timeline.
//!
//! Replaces both the duration-based easing state machine that used to live in
//! `zoom.rs` (spring_ease / spring_ease_out / instant_ease over
//! `ZOOM_DURATION`) and the cursor-following `ZoomFocusInterpolator` layer.
//!
//! Six channels — `amount` (zoom scale), `center` (2D framing center in
//! `SegmentBounds::from_amount_center` travel space), `activity` (the 0/1
//! "any zoom active" step that drives camera scale-during-zoom) and the three
//! motion-state pairs (offset, tilt, rotation/spin) that carry the canvas into
//! and back out of a segment's [`MotionState`] — are each
//! integrated by an analytic [`SpringMassDamperSimulation`] chasing
//! step-function targets, retargeted every 8 ms step with velocity always
//! carried across retargets. There are no fixed animation durations and no
//! boundary special-cases: segment starts/ends/re-aims are just target changes
//! the spring smooths through for continuous motion.
//!
//! The timeline lives in TIMELINE time. Cursor events are in RECORDING time,
//! so click-cluster construction and the "active cluster at time t" lookup map
//! through the project's [`TimelineConfiguration`] (identity when absent).
//!
//! Precompute is lazy (`ensure_precomputed_until`) and must happen in the same
//! mutable phase render loops already used for the focus interpolator; the
//! render hot path only calls [`ZoomTransformTimeline::sample`], which is an
//! index + lerp over the cached samples with no allocation and no locking.
//! The result is a pure function of (segments, cursor events, spring config),
//! so sequential playback and seeking produce bit-identical transforms, and
//! export matches playback by construction.

use quiro_project::{
    Crop, CursorEvents, ProjectConfiguration, ScreenMovementSpring, TimelineConfiguration, XY,
    ZoomMode, ZoomSegment,
};

use crate::{
    spring_mass_damper::{SpringMassDamperSimulation, SpringMassDamperSimulationConfig},
    zoom::{InterpolatedZoom, MotionOffsets, SegmentBounds},
};

/// Fixed precompute step (125 Hz), matching the sampling density the old
/// focus interpolator used.
const STEP_MS: f64 = 8.0;

/// Instant-animation segments snap all channels (no spring) while inside the
/// segment and within this window of its boundaries.
const INSTANT_SNAP_WINDOW_SECS: f64 = 0.1;

/// While the zoom amount is at (or within a hair of) identity the viewport
/// covers the whole frame regardless of the center, so the center channel is
/// free to track its target instantly — this pre-aims upcoming zooms so they
/// scale straight toward their focus. Any center jump while amount <= this
/// bound moves the viewport by at most (bound - 1) of the card: sub-pixel.
const CENTER_PREAIM_MAX_AMOUNT: f32 = 1.0005;

/// Greedy click-cluster bounding-box limits, as a fraction of the visible
/// zoomed viewport (50% width x 70% height).
/// A spring chasing a moving target trails it by friction/tension seconds at
/// steady state, whatever its mass. Aiming that far ahead of the cursor
/// cancels the trail, so the shot is centred on where the cursor *is* rather
/// than where it was — without stiffening the spring, which is what keeps the
/// motion smooth. The same trick centres the drawn cursor (see
/// `cursor_interpolation::spring_lag_ms`); at high magnification the residual
/// trail is the difference between "tracks the cursor" and "chases it".
fn spring_lead_ms(config: &SpringMassDamperSimulationConfig) -> f64 {
    // Equivalent to `!(tension > 0.0)`, but without a negated partial-order
    // comparison — `tension <= 0.0` alone would treat NaN as valid, since
    // every NaN comparison is false.
    if config.tension.is_nan() || config.tension <= 0.0 || !config.friction.is_finite() {
        return 0.0;
    }
    (f64::from(config.friction / config.tension) * 1000.0).clamp(0.0, MAX_AIM_LEAD_MS)
}

/// Ceiling on the look-ahead. A very soft spring would otherwise aim so far
/// into the future that the shot anticipates movement that has not happened.
const MAX_AIM_LEAD_MS: f64 = 400.0;

/// Half-size of the dead zone the cursor may roam inside before the camera
/// re-aims, as a fraction of the *visible* (zoomed) viewport. Small enough
/// that the cursor is never far from centre at high magnification; large
/// enough that ordinary hand tremor doesn't drag the frame around. The spring
/// smooths whatever movement does get through.
const DEAD_ZONE_HALF_WIDTH: f64 = 0.06;
const DEAD_ZONE_HALF_HEIGHT: f64 = 0.08;

/// Fallback focus when a segment has no usable cursor data.
const FALLBACK_FOCUS: (f64, f64) = (0.5, 0.5);

/// Maps raw display-UV cursor coordinates into cropped-content UV space.
///
/// Cursor events are normalized to the FULL recorded display, but zoom
/// centers ([`SegmentBounds::from_amount_center`]) are proportions of the
/// rendered (cropped) content. Without this remap a cropped recording aims
/// its auto zoom at the wrong spot — and clustering dead-zone distances are
/// measured in the wrong scale. Identity when the recording is uncropped.
#[derive(Clone, Copy, Debug)]
pub struct CursorCropMap {
    /// Crop top-left in raw display UV.
    offset: XY<f64>,
    /// Crop size in raw display UV.
    scale: XY<f64>,
}

impl CursorCropMap {
    /// `None` when the crop covers the whole screen (identity) or when the
    /// inputs are degenerate.
    pub fn from_crop(crop: &Crop, screen_size: XY<u32>) -> Option<Self> {
        if screen_size.x == 0 || screen_size.y == 0 || crop.size.x == 0 || crop.size.y == 0 {
            return None;
        }
        if crop.position.x == 0
            && crop.position.y == 0
            && crop.size.x >= screen_size.x
            && crop.size.y >= screen_size.y
        {
            return None;
        }
        let screen = XY::new(f64::from(screen_size.x), f64::from(screen_size.y));
        Some(Self {
            offset: XY::new(
                f64::from(crop.position.x) / screen.x,
                f64::from(crop.position.y) / screen.y,
            ),
            scale: XY::new(
                f64::from(crop.size.x) / screen.x,
                f64::from(crop.size.y) / screen.y,
            ),
        })
    }

    /// Raw display UV -> content UV. Positions outside the crop map outside
    /// [0, 1]; consumers clamp at the point of use so movement into a
    /// cropped-away strip still aims the camera at that content edge.
    fn map(&self, x: f64, y: f64) -> (f64, f64) {
        (
            (x - self.offset.x) / self.scale.x,
            (y - self.offset.y) / self.scale.y,
        )
    }
}

/// The cursor's path through one zoom segment, in content-UV space and
/// sorted by RECORDING time.
///
/// Auto zoom used to aim at the centre of a bounding box around a *cluster* of
/// recent movement. That box was up to half the visible viewport wide, so the
/// cursor could sit far from the middle of the shot — and because a cluster's
/// box was built from its whole lifetime, the aim also drifted toward where
/// the cursor was about to go. Both errors scale with magnification, which is
/// why they were most obvious zoomed in. Aiming at the cursor's actual
/// interpolated position removes them; steadiness comes from the dead zone in
/// `targets_at` and the spring, not from blurring the target.
#[derive(Debug)]
pub(crate) struct CursorPath {
    /// Sorted ascending; parallel to `points`.
    times_ms: Vec<f64>,
    points: Vec<(f64, f64)>,
}

impl CursorPath {
    fn new(times_ms: Vec<f64>, points: Vec<(f64, f64)>) -> Self {
        debug_assert_eq!(times_ms.len(), points.len());
        Self { times_ms, points }
    }

    fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// Where the cursor was at `time_ms`, linearly interpolated between the
    /// two surrounding samples. Before the first and after the last sample the
    /// path holds at its endpoints, so a segment that starts before any
    /// recorded movement still aims somewhere sensible.
    fn sample(&self, time_ms: f64) -> Option<(f64, f64)> {
        if self.is_empty() || !time_ms.is_finite() {
            return self.points.first().copied();
        }

        match self
            .times_ms
            .binary_search_by(|probe| probe.total_cmp(&time_ms))
        {
            Ok(index) => Some(self.points[index]),
            Err(0) => self.points.first().copied(),
            Err(index) if index >= self.points.len() => self.points.last().copied(),
            Err(index) => {
                let (before_t, after_t) = (self.times_ms[index - 1], self.times_ms[index]);
                let (before, after) = (self.points[index - 1], self.points[index]);
                let span = after_t - before_t;

                // Coincident timestamps would divide by zero; take the later.
                // (`span.is_nan()` can't actually happen here — timestamps are
                // always finite — but `span <= 0.0` alone would silently treat
                // NaN as valid, so spell out the real condition instead.)
                if span.is_nan() || span <= 0.0 {
                    return Some(after);
                }

                let progress = ((time_ms - before_t) / span).clamp(0.0, 1.0);
                Some((
                    before.0 + (after.0 - before.0) * progress,
                    before.1 + (after.1 - before.1) * progress,
                ))
            }
        }
    }
}

/// Collects every cursor move inside a segment's RECORDING-time range into a
/// sampled path, mapped into content-UV space.
pub(crate) fn build_cursor_path(
    cursor_events: &CursorEvents,
    segment_start_secs: f64,
    segment_end_secs: f64,
    crop: Option<CursorCropMap>,
) -> CursorPath {
    let start_ms = segment_start_secs * 1000.0;
    let end_ms = segment_end_secs * 1000.0;
    // Clustering happens in CONTENT UV space: dead-zone limits are fractions
    // of the visible (cropped) viewport, so raw display UVs must be remapped
    // before distances mean what the constants say they mean.
    let map_uv = |x: f64, y: f64| crop.map_or((x, y), |c| c.map(x, y));

    // Non-finite coordinates (corrupted files, synthetic event generators)
    // must never reach the aim math: NaN propagates through min/max and
    // clamp, which would poison the spring targets for the whole timeline.
    let finite = |m: &&quiro_project::CursorMoveEvent| {
        m.x.is_finite() && m.y.is_finite() && m.time_ms.is_finite()
    };

    let mut times_ms = Vec::new();
    let mut points = Vec::new();

    // One sample immediately before the range keeps the segment's opening
    // frames aimed where the cursor already was, rather than at its first
    // movement after the zoom began.
    if let Some(prior) = cursor_events
        .moves
        .iter()
        .filter(finite)
        .rev()
        .find(|m| m.time_ms <= start_ms)
    {
        times_ms.push(prior.time_ms);
        points.push(map_uv(prior.x, prior.y));
    }

    for event in cursor_events
        .moves
        .iter()
        .filter(finite)
        .filter(|m| m.time_ms >= start_ms && m.time_ms <= end_ms)
    {
        // Events are not guaranteed sorted; a backwards step would break the
        // binary search, so drop anything out of order.
        if times_ms.last().is_some_and(|last| event.time_ms < *last) {
            continue;
        }
        times_ms.push(event.time_ms);
        points.push(map_uv(event.x, event.y));
    }

    if points.is_empty()
        && let Some(next) = cursor_events
            .moves
            .iter()
            .filter(finite)
            .find(|m| m.time_ms >= start_ms)
    {
        times_ms.push(next.time_ms);
        points.push(map_uv(next.x, next.y));
    }

    CursorPath::new(times_ms, points)
}

/// One entry of the timeline-time -> recording-time mapping derived from
/// [`TimelineConfiguration::get_segment_time`]'s accumulation logic.
#[derive(Clone, Copy)]
struct TimeMapSegment {
    timeline_start: f64,
    timeline_end: f64,
    recording_start: f64,
    timescale: f64,
    recording_clip: u32,
}

fn build_time_map(timeline: Option<&TimelineConfiguration>) -> Vec<TimeMapSegment> {
    let Some(timeline) = timeline else {
        return Vec::new();
    };

    let mut map = Vec::with_capacity(timeline.segments.len());
    let mut accum = 0.0;
    for (segment_index, segment) in timeline.segments.iter().enumerate() {
        if !timeline.transitions.is_empty() {
            accum -= timeline
                .effective_transition(segment_index)
                .map_or(0.0, |transition| transition.duration);
        }
        let duration = segment.duration();
        if !duration.is_finite() || duration <= 0.0 {
            continue;
        }
        map.push(TimeMapSegment {
            timeline_start: accum,
            timeline_end: accum + duration,
            recording_start: segment.start,
            timescale: segment.timescale,
            recording_clip: segment.recording_clip,
        });
        accum += duration;
    }
    map
}

/// Maps a timeline timestamp to recording seconds. Identity when no timeline
/// is configured; clamps to the nearest edit boundary outside the timeline.
fn map_timeline_to_recording_secs(
    map: &[TimeMapSegment],
    timeline_secs: f64,
    recording_clip: Option<u32>,
    prefer_outgoing: bool,
) -> f64 {
    let Some(first) = map.first() else {
        return timeline_secs;
    };

    if timeline_secs <= first.timeline_start {
        return first.recording_start;
    }

    let contains = |segment: &&TimeMapSegment| {
        timeline_secs >= segment.timeline_start && timeline_secs < segment.timeline_end
    };
    let segment = recording_clip
        .and_then(|recording_clip| {
            if prefer_outgoing {
                map.iter()
                    .filter(contains)
                    .find(|segment| segment.recording_clip == recording_clip)
            } else {
                map.iter()
                    .rev()
                    .filter(contains)
                    .find(|segment| segment.recording_clip == recording_clip)
            }
        })
        .or_else(|| map.iter().rev().find(contains));
    if let Some(segment) = segment {
        return segment.recording_start
            + (timeline_secs - segment.timeline_start) * segment.timescale;
    }

    let last = map.last().expect("map is non-empty");
    last.recording_start + (last.timeline_end - last.timeline_start) * last.timescale
}

/// One precomputed step. Sample times are implicit: `samples[i]` is the state
/// at `i * STEP_MS`, so lookup is pure index math.
#[derive(Clone, Copy, Debug)]
struct TimelineSample {
    amount: f32,
    center: XY<f32>,
    activity: f32,
    snapped: bool,
    /// Motion-state channels, paired into the 2D springs that drive them:
    /// (offset x, offset y), (tilt x, tilt y), (rotation, spin).
    motion_offset: XY<f32>,
    motion_tilt: XY<f32>,
    motion_rot: XY<f32>,
}

struct PrecomputeState {
    /// 2D framing center in `from_amount_center` travel space.
    center_sim: SpringMassDamperSimulation,
    /// x = zoom amount, y = zoom activity (0/1 step -> smooth camera driver).
    aux_sim: SpringMassDamperSimulation,
    /// Motion-state channels. Three 2D springs rather than six 1D ones,
    /// sharing the zoom's spring config so a motion state departs and returns
    /// with exactly the zoom's feel. Their rest target is zero, which is what
    /// makes "transition back to the original state" fall out for free.
    motion_offset_sim: SpringMassDamperSimulation,
    motion_tilt_sim: SpringMassDamperSimulation,
    motion_rot_sim: SpringMassDamperSimulation,
    /// Last center target while a segment was active. Held during zoom-out so
    /// the outgoing framing stays anchored instead of re-aiming mid-flight.
    held_center_target: XY<f32>,
    /// Where auto-follow is currently pointed, before edge snapping. Carried
    /// between steps so the dead zone is measured against the live aim rather
    /// than recomputed from scratch each step.
    auto_aim: Option<(f64, f64)>,
}

struct StepTargets {
    amount: f32,
    center: XY<f32>,
    activity: f32,
    motion_offset: XY<f32>,
    motion_tilt: XY<f32>,
    motion_rot: XY<f32>,
    segment_active: bool,
    snap: bool,
    /// The auto-follow aim this step settled on, for the next step's dead
    /// zone. `None` for manual segments and while no segment is active.
    auto_aim: Option<(f64, f64)>,
}

/// Deterministic, lazily precomputed zoom transform timeline.
///
/// Construction is cheap (clusters only); integration happens on demand via
/// [`Self::ensure_precomputed_until`] which must be called from a mutable
/// phase (exactly where the old focus interpolator's precompute ran) before
/// [`Self::sample`] is used for the corresponding frame times.
pub struct ZoomTransformTimeline {
    samples: Vec<TimelineSample>,
    state: Option<PrecomputeState>,
    zoom_segments: Vec<ZoomSegment>,
    /// Parallel to `zoom_segments`: the cursor's sampled path (RECORDING-time
    /// ms) for Auto segments, `None` for Manual ones.
    cursor_paths: Vec<Option<CursorPath>>,
    time_map: Vec<TimeMapSegment>,
    recording_clip: Option<u32>,
    prefer_outgoing: bool,
    /// Total number of samples covering [0, duration] plus one lerp partner.
    total_samples: usize,
    /// How far ahead of the playhead the auto-follow aim samples the cursor,
    /// cancelling the centring spring's steady-state trail.
    aim_lead_ms: f64,
}

struct RecordingClipSelection {
    recording_clip: Option<u32>,
    prefer_outgoing: bool,
}

impl ZoomTransformTimeline {
    pub fn new(
        zoom_segments: &[ZoomSegment],
        timeline: Option<&TimelineConfiguration>,
        cursor_events: &CursorEvents,
        spring: ScreenMovementSpring,
        duration_secs: f64,
        crop: Option<CursorCropMap>,
    ) -> Self {
        Self::new_for_recording_clip(
            zoom_segments,
            timeline,
            cursor_events,
            spring,
            duration_secs,
            crop,
            RecordingClipSelection {
                recording_clip: None,
                prefer_outgoing: false,
            },
        )
    }

    fn new_for_recording_clip(
        zoom_segments: &[ZoomSegment],
        timeline: Option<&TimelineConfiguration>,
        cursor_events: &CursorEvents,
        spring: ScreenMovementSpring,
        duration_secs: f64,
        crop: Option<CursorCropMap>,
        selection: RecordingClipSelection,
    ) -> Self {
        let RecordingClipSelection {
            recording_clip,
            prefer_outgoing,
        } = selection;
        let mut zoom_segments = zoom_segments.to_vec();
        zoom_segments.sort_by(|a, b| a.start.total_cmp(&b.start).then(a.end.total_cmp(&b.end)));

        let time_map = build_time_map(timeline);
        let cursor_paths = zoom_segments
            .iter()
            .map(|segment| match segment.mode {
                ZoomMode::Auto => {
                    let recording_start = map_timeline_to_recording_secs(
                        &time_map,
                        segment.start,
                        recording_clip,
                        prefer_outgoing,
                    );
                    let recording_end = map_timeline_to_recording_secs(
                        &time_map,
                        segment.end,
                        recording_clip,
                        prefer_outgoing,
                    )
                    .max(recording_start);
                    Some(build_cursor_path(
                        cursor_events,
                        recording_start,
                        recording_end,
                        crop,
                    ))
                }
                ZoomMode::Manual { .. } => None,
            })
            .collect();

        let duration_secs = if duration_secs.is_finite() {
            duration_secs.max(0.0)
        } else {
            0.0
        };
        // One sample per step across the duration, plus one trailing sample so
        // a lookup right at the end always has a lerp partner.
        let total_samples = (duration_secs * 1000.0 / STEP_MS).ceil() as usize + 2;
        let aim_lead_ms = spring_lead_ms(&SpringMassDamperSimulationConfig {
            tension: spring.stiffness,
            mass: spring.mass,
            friction: spring.damping,
        });

        if zoom_segments.is_empty() {
            return Self {
                samples: vec![TimelineSample {
                    motion_offset: XY::new(0.0, 0.0),
                    motion_tilt: XY::new(0.0, 0.0),
                    motion_rot: XY::new(0.0, 0.0),
                    amount: 1.0,
                    center: XY::new(0.5, 0.5),
                    activity: 0.0,
                    snapped: false,
                }],
                state: None,
                zoom_segments,
                cursor_paths,
                time_map,
                recording_clip,
                prefer_outgoing,
                total_samples: 1,
                aim_lead_ms,
            };
        }

        let spring_config = SpringMassDamperSimulationConfig {
            tension: spring.stiffness,
            mass: spring.mass,
            friction: spring.damping,
        };

        let mut timeline = Self {
            samples: Vec::new(),
            state: None,
            zoom_segments,
            cursor_paths,
            time_map,
            recording_clip,
            prefer_outgoing,
            total_samples,
            aim_lead_ms,
        };

        // Seed the simulations at rest on the t=0 target so the very first
        // frame is already correct and `samples` is never empty.
        let initial = timeline.targets_at(0.0, XY::new(0.5, 0.5), None);
        let mut center_sim = SpringMassDamperSimulation::new(spring_config);
        center_sim.set_position(initial.center);
        center_sim.set_velocity(XY::new(0.0, 0.0));
        center_sim.set_target_position(initial.center);

        let mut aux_sim = SpringMassDamperSimulation::new(spring_config);
        aux_sim.set_position(XY::new(initial.amount, initial.activity));
        aux_sim.set_velocity(XY::new(0.0, 0.0));
        aux_sim.set_target_position(XY::new(initial.amount, initial.activity));

        let mut motion_offset_sim = SpringMassDamperSimulation::new(spring_config);
        motion_offset_sim.set_position(initial.motion_offset);
        motion_offset_sim.set_velocity(XY::new(0.0, 0.0));
        motion_offset_sim.set_target_position(initial.motion_offset);

        let mut motion_tilt_sim = SpringMassDamperSimulation::new(spring_config);
        motion_tilt_sim.set_position(initial.motion_tilt);
        motion_tilt_sim.set_velocity(XY::new(0.0, 0.0));
        motion_tilt_sim.set_target_position(initial.motion_tilt);

        let mut motion_rot_sim = SpringMassDamperSimulation::new(spring_config);
        motion_rot_sim.set_position(initial.motion_rot);
        motion_rot_sim.set_velocity(XY::new(0.0, 0.0));
        motion_rot_sim.set_target_position(initial.motion_rot);

        timeline.samples.push(TimelineSample {
            amount: initial.amount.max(1.0),
            motion_offset: initial.motion_offset,
            motion_tilt: initial.motion_tilt,
            motion_rot: initial.motion_rot,
            center: XY::new(
                initial.center.x.clamp(0.0, 1.0),
                initial.center.y.clamp(0.0, 1.0),
            ),
            activity: initial.activity.clamp(0.0, 1.0),
            snapped: false,
        });
        timeline.state = Some(PrecomputeState {
            center_sim,
            aux_sim,
            motion_offset_sim,
            motion_tilt_sim,
            motion_rot_sim,
            held_center_target: initial.center,
            auto_aim: initial.auto_aim,
        });
        timeline
    }

    /// Convenience constructor pulling zoom segments, edit mapping, spring
    /// config and crop mapping out of a [`ProjectConfiguration`].
    /// `screen_size` is the raw recorded display size in px
    /// (`RenderOptions::screen_size`), needed to normalize the project's
    /// pixel-space crop into cursor UV space.
    pub fn from_project(
        project: &ProjectConfiguration,
        cursor_events: &CursorEvents,
        duration_secs: f64,
        screen_size: XY<u32>,
    ) -> Self {
        Self::from_project_for_recording_clip(
            project,
            cursor_events,
            duration_secs,
            screen_size,
            None,
            false,
        )
    }

    pub fn from_project_for_clip(
        project: &ProjectConfiguration,
        cursor_events: &CursorEvents,
        duration_secs: f64,
        screen_size: XY<u32>,
        recording_clip: u32,
    ) -> Self {
        Self::from_project_for_recording_clip(
            project,
            cursor_events,
            duration_secs,
            screen_size,
            Some(recording_clip),
            false,
        )
    }

    pub fn from_project_for_outgoing_clip(
        project: &ProjectConfiguration,
        cursor_events: &CursorEvents,
        duration_secs: f64,
        screen_size: XY<u32>,
        recording_clip: u32,
    ) -> Self {
        Self::from_project_for_recording_clip(
            project,
            cursor_events,
            duration_secs,
            screen_size,
            Some(recording_clip),
            true,
        )
    }

    fn from_project_for_recording_clip(
        project: &ProjectConfiguration,
        cursor_events: &CursorEvents,
        duration_secs: f64,
        screen_size: XY<u32>,
        recording_clip: Option<u32>,
        prefer_outgoing: bool,
    ) -> Self {
        let crop = project
            .background
            .crop
            .as_ref()
            .and_then(|crop| CursorCropMap::from_crop(crop, screen_size));
        Self::new_for_recording_clip(
            project
                .timeline
                .as_ref()
                .map(|t| t.zoom_segments.as_slice())
                .unwrap_or(&[]),
            project.timeline.as_ref(),
            cursor_events,
            project.screen_movement_spring,
            duration_secs,
            crop,
            RecordingClipSelection {
                recording_clip,
                prefer_outgoing,
            },
        )
    }

    /// Extends the precomputed cache to cover `timeline_secs`. Amortized and
    /// cheap (125 trivial steps per second of content); a no-op once the
    /// requested range — or the whole duration — is covered.
    pub fn ensure_precomputed_until(&mut self, timeline_secs: f32) {
        if self.state.is_none() {
            return;
        }
        let need_ms = (f64::from(timeline_secs).max(0.0)) * 1000.0;
        // +2: floor index plus its lerp partner.
        let need_samples = ((need_ms / STEP_MS).ceil() as usize + 2).min(self.total_samples);
        while self.samples.len() < need_samples && self.state.is_some() {
            self.advance_one_step();
        }
    }

    /// Precomputes the full duration.
    pub fn precompute(&mut self) {
        while self.state.is_some() {
            self.advance_one_step();
        }
    }

    /// Samples the transform at a TIMELINE timestamp: binary index + lerp over
    /// the precomputed steps. No allocation, no locks, no simulation work —
    /// safe for the render hot path. Times outside the precomputed range clamp
    /// to the nearest cached sample.
    pub fn sample(&self, timeline_secs: f32) -> InterpolatedZoom {
        let Some(last) = self.samples.len().checked_sub(1) else {
            return InterpolatedZoom {
                t: 0.0,
                bounds: SegmentBounds::default(),
                motion: MotionOffsets::default(),
            };
        };

        let pos = (f64::from(timeline_secs).max(0.0)) * 1000.0 / STEP_MS;
        let idx = (pos as usize).min(last);
        let next = (idx + 1).min(last);
        let frac = (pos - idx as f64).clamp(0.0, 1.0) as f32;

        let a = self.samples[idx];
        let b = self.samples[next];

        let amount = a.amount + (b.amount - a.amount) * frac;
        let center_x = a.center.x + (b.center.x - a.center.x) * frac;
        let center_y = a.center.y + (b.center.y - a.center.y) * frac;
        let activity = a.activity + (b.activity - a.activity) * frac;
        let lerp2 = |a: XY<f32>, b: XY<f32>| {
            XY::new(
                f64::from(a.x + (b.x - a.x) * frac),
                f64::from(a.y + (b.y - a.y) * frac),
            )
        };
        let offset = lerp2(a.motion_offset, b.motion_offset);
        let tilt = lerp2(a.motion_tilt, b.motion_tilt);
        let rot = lerp2(a.motion_rot, b.motion_rot);

        InterpolatedZoom {
            t: f64::from(activity).clamp(0.0, 1.0),
            bounds: SegmentBounds::from_amount_center(
                f64::from(amount),
                XY::new(f64::from(center_x), f64::from(center_y)),
            ),
            motion: MotionOffsets {
                offset,
                tilt,
                rotation: rot.x,
                spin: rot.y,
            },
        }
    }

    /// Whether any precomputed step in `[from_secs, to_secs]` was an instant
    /// snap (no spring). Motion-effect consumers can use this to suppress
    /// velocity-derived effects across intentional discontinuities.
    pub fn snapped_within(&self, from_secs: f32, to_secs: f32) -> bool {
        if self.samples.is_empty() {
            return false;
        }
        let last = self.samples.len() - 1;
        let lo_ms = f64::from(from_secs.min(to_secs)).max(0.0) * 1000.0;
        let hi_ms = f64::from(from_secs.max(to_secs)).max(0.0) * 1000.0;
        let lo = ((lo_ms / STEP_MS) as usize).min(last);
        let hi = ((hi_ms / STEP_MS).ceil() as usize).min(last);
        self.samples[lo..=hi].iter().any(|s| s.snapped)
    }

    fn advance_one_step(&mut self) {
        let Some(state) = self.state.as_ref() else {
            return;
        };
        let held_center = state.held_center_target;
        let prev_aim = state.auto_aim;

        let step_index = self.samples.len();
        let step_secs = step_index as f64 * STEP_MS / 1000.0;
        let targets = self.targets_at(step_secs, held_center, prev_aim);

        let Some(state) = self.state.as_mut() else {
            return;
        };

        if targets.segment_active {
            state.held_center_target = targets.center;
        }
        state.auto_aim = targets.auto_aim;

        state.center_sim.set_target_position(targets.center);
        state
            .aux_sim
            .set_target_position(XY::new(targets.amount, targets.activity));
        state
            .motion_offset_sim
            .set_target_position(targets.motion_offset);
        state.motion_tilt_sim.set_target_position(targets.motion_tilt);
        state.motion_rot_sim.set_target_position(targets.motion_rot);

        if targets.snap {
            // Instant animation: park the springs on the target with zero
            // velocity so no motion (or motion-derived effect) leaks through.
            state.center_sim.set_position(targets.center);
            state.center_sim.set_velocity(XY::new(0.0, 0.0));
            state
                .aux_sim
                .set_position(XY::new(targets.amount, targets.activity));
            state.aux_sim.set_velocity(XY::new(0.0, 0.0));
            // Instant animation means instant for the whole motion state too,
            // or the tilt would still be easing after the cut has landed.
            for sim in [
                &mut state.motion_offset_sim,
                &mut state.motion_tilt_sim,
                &mut state.motion_rot_sim,
            ] {
                let target = sim.target_position;
                sim.set_position(target);
                sim.set_velocity(XY::new(0.0, 0.0));
            }
        } else {
            // While the amount spring sits at identity the viewport shows the
            // whole frame no matter where the center is — the center channel
            // is unobservable, so track its target instantly (free pre-aim).
            // An incoming zoom then launches already aimed at its focus and
            // scales straight toward it, instead of zooming about the stale
            // center and dragging over at high magnification (a huge late pan
            // that also detonated the motion blur). The epsilon bounds any
            // theoretical pop to sub-pixel: (amount - 1) * |center jump| of
            // the card, i.e. < 0.05% of the card size.
            if state.aux_sim.position.x <= CENTER_PREAIM_MAX_AMOUNT {
                state.center_sim.set_position(targets.center);
                state.center_sim.set_velocity(XY::new(0.0, 0.0));
            }
            state.center_sim.run(STEP_MS as f32);
            state.aux_sim.run(STEP_MS as f32);
            state.motion_offset_sim.run(STEP_MS as f32);
            state.motion_tilt_sim.run(STEP_MS as f32);
            state.motion_rot_sim.run(STEP_MS as f32);
        }

        // Geometric safety: a sprung amount below 1 would show out-of-bounds
        // background ("bounce-out"), so clamp and kill velocity on that axis
        // only. Centers are clamped per-sample instead (the spring target is
        // always in-band, so overshoot is transient and tiny).
        if state.aux_sim.position.x < 1.0 {
            state.aux_sim.position.x = 1.0;
            state.aux_sim.velocity.x = 0.0;
        }

        self.samples.push(TimelineSample {
            amount: state.aux_sim.position.x,
            center: XY::new(
                state.center_sim.position.x.clamp(0.0, 1.0),
                state.center_sim.position.y.clamp(0.0, 1.0),
            ),
            activity: state.aux_sim.position.y.clamp(0.0, 1.0),
            snapped: targets.snap,
            motion_offset: state.motion_offset_sim.position,
            motion_tilt: state.motion_tilt_sim.position,
            motion_rot: state.motion_rot_sim.position,
        });

        if self.samples.len() >= self.total_samples {
            self.state = None;
        }
    }

    fn targets_at(
        &self,
        timeline_secs: f64,
        held_center: XY<f32>,
        prev_aim: Option<(f64, f64)>,
    ) -> StepTargets {
        // Same active predicate `SegmentsCursor` used: (start, end].
        let active = self
            .zoom_segments
            .iter()
            .position(|s| timeline_secs > s.start && timeline_secs <= s.end);

        let snap = self.zoom_segments.iter().any(|s| {
            s.instant_animation
                && timeline_secs >= s.start - INSTANT_SNAP_WINDOW_SECS
                && timeline_secs <= s.end + INSTANT_SNAP_WINDOW_SECS
        });

        let mut auto_aim = None;

        match active {
            Some(index) => {
                let segment = &self.zoom_segments[index];
                let amount = if segment.amount.is_finite() {
                    segment.amount.max(1.0)
                } else {
                    1.0
                };
                let center = match segment.mode {
                    ZoomMode::Manual { x, y } => {
                        (f64::from(x).clamp(0.0, 1.0), f64::from(y).clamp(0.0, 1.0))
                    }
                    ZoomMode::Auto => {
                        let recording_ms = map_timeline_to_recording_secs(
                            &self.time_map,
                            timeline_secs,
                            self.recording_clip,
                            self.prefer_outgoing,
                        ) * 1000.0;
                        let live = self.cursor_paths[index]
                            .as_ref()
                            .and_then(|path| path.sample(recording_ms + self.aim_lead_ms))
                            .unwrap_or(FALLBACK_FOCUS);
                        let live = (live.0.clamp(0.0, 1.0), live.1.clamp(0.0, 1.0));

                        // Dead zone, sized against the *visible* viewport: the
                        // aim only moves once the cursor would otherwise leave
                        // the box, and then only far enough to put it back on
                        // the edge. Constant in screen terms at any zoom, so
                        // the cursor is never further from centre than the box
                        // however far in the shot is pushed.
                        auto_aim = Some(match prev_aim {
                            Some(aim) => {
                                let half_w = DEAD_ZONE_HALF_WIDTH / amount;
                                let half_h = DEAD_ZONE_HALF_HEIGHT / amount;
                                (
                                    aim.0.clamp(live.0 - half_w, live.0 + half_w),
                                    aim.1.clamp(live.1 - half_h, live.1 + half_h),
                                )
                            }
                            // First step of a segment: start exactly on the
                            // cursor rather than easing in from a stale aim.
                            None => live,
                        });

                        let aim = auto_aim.unwrap_or(live);
                        SegmentBounds::calculate_follow_center(aim, amount)
                    }
                };

                // The engaged canvas state. Because these are targets rather
                // than a blend, two adjacent segments with different states
                // cross-fade through the spring instead of cutting.
                let motion = &segment.motion;

                StepTargets {
                    amount: amount as f32,
                    center: XY::new(center.0 as f32, center.1 as f32),
                    activity: 1.0,
                    segment_active: true,
                    snap,
                    auto_aim,
                    motion_offset: XY::new(motion.offset_x as f32, motion.offset_y as f32),
                    motion_tilt: XY::new(motion.tilt_x as f32, motion.tilt_y as f32),
                    motion_rot: XY::new(motion.rotation as f32, motion.spin as f32),
                }
            }
            None => StepTargets {
                amount: 1.0,
                // Rest is the untransformed canvas, so every motion channel
                // targets zero and the spring carries the shot back on its own.
                motion_offset: XY::new(0.0, 0.0),
                motion_tilt: XY::new(0.0, 0.0),
                motion_rot: XY::new(0.0, 0.0),
                // Hold the last active framing while zooming out so the
                // outgoing shot stays anchored (irrelevant once amount = 1).
                center: held_center,
                activity: 0.0,
                segment_active: false,
                snap,
                // Dropping the aim means the next segment starts on the
                // cursor instead of easing over from the previous shot.
                auto_aim: None,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use quiro_project::{
        ClipTransition, ClipTransitionType, CursorClickEvent, CursorMoveEvent, GlideDirection,
        MotionState, TimelineSegment, ZoomMode,
    };

    use super::*;

    fn manual_segment(start: f64, end: f64, amount: f64, x: f64, y: f64) -> ZoomSegment {
        ZoomSegment {
            start,
            end,
            amount,
            mode: ZoomMode::Manual {
                x: x as f32,
                y: y as f32,
            },
            glide_direction: GlideDirection::default(),
            glide_speed: 0.5,
            instant_animation: false,
            edge_snap_ratio: 0.25,
            motion: MotionState::default(),
        }
    }

    fn auto_segment(start: f64, end: f64, amount: f64) -> ZoomSegment {
        ZoomSegment {
            mode: ZoomMode::Auto,
            ..manual_segment(start, end, amount, 0.5, 0.5)
        }
    }

    fn move_event(time_ms: f64, x: f64, y: f64) -> CursorMoveEvent {
        CursorMoveEvent {
            active_modifiers: vec![],
            cursor_id: "default".to_string(),
            time_ms,
            x,
            y,
        }
    }

    fn click_event(time_ms: f64) -> CursorClickEvent {
        CursorClickEvent {
            active_modifiers: vec![],
            cursor_num: 0,
            cursor_id: "default".to_string(),
            time_ms,
            down: true,
        }
    }

    fn timeline_for(
        segments: &[ZoomSegment],
        cursor: &CursorEvents,
        duration: f64,
    ) -> ZoomTransformTimeline {
        ZoomTransformTimeline::new(
            segments,
            None,
            cursor,
            ScreenMovementSpring::default(),
            duration,
            None,
        )
    }

    fn motion_segment(start: f64, end: f64, motion: MotionState) -> ZoomSegment {
        ZoomSegment {
            motion,
            ..manual_segment(start, end, 1.5, 0.5, 0.5)
        }
    }

    /// The whole premise: rest is untransformed, the segment moves the canvas,
    /// and it comes back on its own with no second keyframe to author.
    #[test]
    fn a_motion_state_departs_and_returns_to_rest() {
        let segments = [motion_segment(
            2.0,
            5.0,
            MotionState {
                tilt_x: 20.0,
                offset_x: 0.3,
                ..Default::default()
            },
        )];
        let mut timeline = timeline_for(&segments, &CursorEvents::default(), 12.0);
        timeline.ensure_precomputed_until(12.0);

        // Before it starts: exactly the canvas the user configured.
        assert!(timeline.sample(0.5).motion.is_identity());

        // Fully engaged near the end of the segment.
        let engaged = timeline.sample(4.8).motion;
        assert!(
            engaged.tilt.x > 15.0 && engaged.offset.x > 0.2,
            "should have reached most of the motion state, got {engaged:?}"
        );

        // Well after it ends: back to rest, with no authored return.
        let returned = timeline.sample(11.0).motion;
        assert!(
            returned.tilt.x.abs() < 0.5 && returned.offset.x.abs() < 0.01,
            "should have relaxed back to the resting canvas, got {returned:?}"
        );
    }

    /// The end of the chain: the config the renderer actually reads must carry
    /// the motion. Everything upstream of this passed while the product did
    /// nothing, so this is the assertion that was missing.
    #[test]
    fn resolved_project_carries_the_motion_state() {
        let mut project = ProjectConfiguration::default();
        project.timeline = Some(TimelineConfiguration {
            segments: vec![TimelineSegment {
                recording_clip: 0,
                timescale: 1.0,
                start: 0.0,
                end: 12.0,
                name: None,
                speed_audio_mode: None,
                transform: None,
                perspective: None,
            }],
            transitions: vec![],
            zoom_segments: vec![motion_segment(
                2.0,
                5.0,
                MotionState {
                    tilt_x: 20.0,
                    offset_x: 0.25,
                    ..Default::default()
                },
            )],
            scene_segments: vec![],
            mask_segments: vec![],
            text_segments: vec![],
            caption_segments: vec![],
            keyboard_segments: vec![],
            audio_segments: vec![],
        });

        let mut timeline = ZoomTransformTimeline::from_project(
            &project,
            &CursorEvents::default(),
            12.0,
            XY::new(1920, 1080),
        );
        timeline.ensure_precomputed_until(12.0);

        // At rest the renderer must see the untouched project.
        assert!(
            crate::resolve_project_for_frame(&project, &timeline, 0.5).is_none(),
            "resting canvas should need no resolution at all"
        );

        // Engaged: the fields the render path reads must have moved.
        let engaged = crate::resolve_project_for_frame(&project, &timeline, 4.8)
            .expect("an engaged motion state must resolve a project");
        let perspective = engaged
            .background
            .perspective
            .expect("motion should have created a perspective");
        let transform = engaged
            .background
            .display_transform
            .expect("motion should have created a display transform");

        assert!(
            perspective.tilt_x > 15.0,
            "tilt did not reach the renderer, got {}",
            perspective.tilt_x
        );
        assert!(
            transform.offset.x > 0.2,
            "offset did not reach the renderer, got {}",
            transform.offset.x
        );
    }

    /// The app never calls `new` directly — it goes through `from_project`.
    /// This asserts motion survives that path, so a green unit test on `new`
    /// can never again pass while the product does nothing.
    #[test]
    fn motion_survives_the_from_project_construction_path() {
        let mut project = ProjectConfiguration::default();
        project.timeline = Some(TimelineConfiguration {
            segments: vec![TimelineSegment {
                recording_clip: 0,
                timescale: 1.0,
                start: 0.0,
                end: 12.0,
                name: None,
                speed_audio_mode: None,
                transform: None,
                perspective: None,
            }],
            transitions: vec![],
            zoom_segments: vec![motion_segment(
                2.0,
                5.0,
                MotionState {
                    tilt_x: 20.0,
                    ..Default::default()
                },
            )],
            scene_segments: vec![],
            mask_segments: vec![],
            text_segments: vec![],
            caption_segments: vec![],
            keyboard_segments: vec![],
            audio_segments: vec![],
        });

        let mut timeline = ZoomTransformTimeline::from_project(
            &project,
            &CursorEvents::default(),
            12.0,
            XY::new(1920, 1080),
        );
        timeline.ensure_precomputed_until(12.0);

        let engaged = timeline.sample(4.8).motion;
        assert!(
            engaged.tilt.x > 15.0,
            "motion did not survive from_project, got {engaged:?}"
        );
    }

    /// A segment with no motion configured must not disturb the canvas, so
    /// every existing zoom-only project renders exactly as before.
    #[test]
    fn a_plain_zoom_segment_leaves_the_canvas_untransformed() {
        let segments = [manual_segment(2.0, 5.0, 2.0, 0.5, 0.5)];
        let mut timeline = timeline_for(&segments, &CursorEvents::default(), 10.0);
        timeline.ensure_precomputed_until(10.0);

        for step in 0..100 {
            let at = step as f32 * 0.1;
            assert!(
                timeline.sample(at).motion.is_identity(),
                "motion leaked at t={at}"
            );
        }
    }

    /// Motion is spring-driven, so it must be continuous — no cut into the
    /// state and no snap back out of it.
    #[test]
    fn motion_moves_continuously_across_the_segment_edges() {
        let segments = [motion_segment(
            2.0,
            5.0,
            MotionState {
                tilt_x: 30.0,
                ..Default::default()
            },
        )];
        let mut timeline = timeline_for(&segments, &CursorEvents::default(), 12.0);
        timeline.ensure_precomputed_until(12.0);

        let mut previous = timeline.sample(0.0).motion.tilt.x;
        let mut worst: f64 = 0.0;
        for step in 1..1200 {
            let current = timeline.sample(step as f32 * 0.01).motion.tilt.x;
            worst = worst.max((current - previous).abs());
            previous = current;
        }

        // Judged against the travel, not an absolute: a cut moves the whole
        // 30 degrees in one step, while a spring at peak velocity covers a few
        // percent of it. Anything under a tenth is unambiguously sprung.
        assert!(
            worst < 3.0,
            "largest 10ms step was {worst} degrees of 30 travelled"
        );
    }

    /// Adjacent segments with different states must cross-fade rather than
    /// cut, which is what springing the *target* buys over blending an
    /// envelope.
    #[test]
    fn adjacent_motion_states_cross_fade() {
        let segments = [
            motion_segment(
                1.0,
                3.0,
                MotionState {
                    tilt_x: 25.0,
                    ..Default::default()
                },
            ),
            motion_segment(
                3.0,
                5.0,
                MotionState {
                    tilt_x: -25.0,
                    ..Default::default()
                },
            ),
        ];
        let mut timeline = timeline_for(&segments, &CursorEvents::default(), 10.0);
        timeline.ensure_precomputed_until(10.0);

        let mut previous = timeline.sample(2.5).motion.tilt.x;
        let mut worst: f64 = 0.0;
        for step in 0..200 {
            let current = timeline.sample(2.5 + step as f32 * 0.01).motion.tilt.x;
            worst = worst.max((current - previous).abs());
            previous = current;
        }

        // 50 degrees of travel between the opposing states; a cut would show
        // the whole swing in a single step.
        assert!(
            worst < 5.0,
            "handover between opposing states jumped {worst} degrees of 50 in one step"
        );
    }

    /// Instant animation means instant for the whole state, or the tilt would
    /// still be easing after the cut has landed.
    #[test]
    fn instant_animation_snaps_motion_too() {
        let segments = [ZoomSegment {
            instant_animation: true,
            ..motion_segment(
                2.0,
                5.0,
                MotionState {
                    tilt_x: 20.0,
                    ..Default::default()
                },
            )
        }];
        let mut timeline = timeline_for(&segments, &CursorEvents::default(), 10.0);
        timeline.ensure_precomputed_until(10.0);

        // A spring would still be climbing this soon after the start.
        let just_after = timeline.sample(2.1).motion.tilt.x;
        assert!(
            (just_after - 20.0).abs() < 0.5,
            "instant animation should have landed on the state, got {just_after}"
        );
    }

    #[test]
    fn empty_zoom_timeline_stays_constant_without_precompute_work() {
        let mut timeline = timeline_for(&[], &CursorEvents::default(), 60.0 * 60.0);
        timeline.ensure_precomputed_until(60.0 * 60.0);

        assert!(timeline.state.is_none());
        assert_eq!(timeline.samples.len(), 1);
        assert_eq!(timeline.sample(60.0 * 60.0).display_amount(), 1.0);
    }

    /// Max |value delta| and |slope delta| between adjacent 8ms sample
    /// intervals across the whole precomputed range, measured on the VISIBLE
    /// viewport rect (bounds corners + amount), not the latent channels: the
    /// center channel deliberately snaps to its target while the amount sits
    /// at identity (free pre-aim, geometrically invisible), and bounds are
    /// what the renderer — and the motion-blur velocity analysis — consume.
    fn max_step_discontinuities(timeline: &ZoomTransformTimeline) -> (f64, f64) {
        let step_secs = STEP_MS / 1000.0;
        let values: Vec<[f64; 5]> = timeline
            .samples
            .iter()
            .map(|s| {
                let bounds = SegmentBounds::from_amount_center(
                    f64::from(s.amount),
                    XY::new(f64::from(s.center.x), f64::from(s.center.y)),
                );
                [
                    f64::from(s.amount),
                    bounds.top_left.x,
                    bounds.top_left.y,
                    bounds.bottom_right.x,
                    bounds.bottom_right.y,
                ]
            })
            .collect();

        let mut max_value_jump = 0.0f64;
        let mut max_slope_jump = 0.0f64;
        for window in values.windows(3) {
            for ((&v0, &v1), &v2) in window[0].iter().zip(window[1].iter()).zip(window[2].iter()) {
                let slope_a = (v1 - v0) / step_secs;
                let slope_b = (v2 - v1) / step_secs;
                max_value_jump = max_value_jump.max((v1 - v0).abs()).max((v2 - v1).abs());
                max_slope_jump = max_slope_jump.max((slope_b - slope_a).abs());
            }
        }
        (max_value_jump, max_slope_jump)
    }

    fn assert_viewport_in_bounds(zoom: &InterpolatedZoom, context: &str) {
        // The display rect must cover the full output on both axes; anything
        // less shows out-of-bounds background.
        assert!(
            zoom.bounds.top_left.x <= 1e-6 && zoom.bounds.top_left.y <= 1e-6,
            "{context}: top_left out of bounds: {:?}",
            zoom.bounds
        );
        assert!(
            zoom.bounds.bottom_right.x >= 1.0 - 1e-6 && zoom.bounds.bottom_right.y >= 1.0 - 1e-6,
            "{context}: bottom_right out of bounds: {:?}",
            zoom.bounds
        );
        assert!(
            zoom.display_amount() >= 1.0 - 1e-6,
            "{context}: amount below 1: {}",
            zoom.display_amount()
        );
        assert!(
            (0.0..=1.0).contains(&zoom.t),
            "{context}: t out of [0,1]: {}",
            zoom.t
        );
    }

    #[test]
    fn sequential_and_seek_precompute_are_identical() {
        let cursor = CursorEvents {
            moves: vec![
                move_event(0.0, 0.2, 0.3),
                move_event(1500.0, 0.8, 0.7),
                move_event(4000.0, 0.4, 0.9),
            ],
            clicks: vec![click_event(1200.0), click_event(3600.0)],
        };
        let segments = vec![
            auto_segment(1.0, 4.0, 2.0),
            manual_segment(6.0, 8.0, 3.0, 0.2, 0.8),
        ];

        let mut sequential = timeline_for(&segments, &cursor, 10.0);
        let mut chunk_time = 0.0f32;
        while chunk_time < 10.5 {
            sequential.ensure_precomputed_until(chunk_time);
            chunk_time += 0.037; // deliberately not a multiple of the step
        }
        sequential.precompute();

        let mut seeked = timeline_for(&segments, &cursor, 10.0);
        seeked.precompute();

        assert_eq!(sequential.samples.len(), seeked.samples.len());
        for (index, (a, b)) in sequential
            .samples
            .iter()
            .zip(seeked.samples.iter())
            .enumerate()
        {
            assert_eq!(a.amount.to_bits(), b.amount.to_bits(), "amount @ {index}");
            assert_eq!(
                a.center.x.to_bits(),
                b.center.x.to_bits(),
                "center.x @ {index}"
            );
            assert_eq!(
                a.center.y.to_bits(),
                b.center.y.to_bits(),
                "center.y @ {index}"
            );
            assert_eq!(
                a.activity.to_bits(),
                b.activity.to_bits(),
                "activity @ {index}"
            );
        }

        // Sampling backwards after a forward precompute is pure cache lookup
        // and must equal a fresh sample of the same time.
        let early = sequential.sample(1.5);
        let late = sequential.sample(9.0);
        let early_again = sequential.sample(1.5);
        assert_eq!(early.bounds, early_again.bounds);
        assert!(late.display_amount().is_finite());
    }

    #[test]
    fn velocity_is_continuous_across_segment_boundaries() {
        // The old easing scheme had C1 breaks at segment start/end that
        // required `segment_end_focus` patches; the spring must not. Bounds
        // derived from the default spring: |accel| <= (k*disp + c*v)/m with
        // disp <= 2, v <= ~7/s => ~300/s^2, i.e. slope deltas of at most
        // ~2.4/s between adjacent 8ms intervals. A duration-eased jump would
        // show up as a slope delta of tens per second.
        let cursor = CursorEvents {
            moves: vec![move_event(0.0, 0.7, 0.4)],
            clicks: vec![],
        };
        let segments = vec![
            auto_segment(1.0, 3.0, 3.0),
            manual_segment(3.5, 5.0, 2.0, 0.1, 0.9), // retarget mid-flight of the zoom-out
        ];
        let mut timeline = timeline_for(&segments, &cursor, 7.0);
        timeline.precompute();

        let (max_value_jump, max_slope_jump) = max_step_discontinuities(&timeline);
        assert!(
            max_value_jump < 0.1,
            "C0 violated: sample-to-sample jump {max_value_jump}"
        );
        assert!(
            max_slope_jump < 4.0,
            "velocity discontinuity across retargets: slope jump {max_slope_jump}/s"
        );
    }

    #[test]
    fn viewport_stays_in_bounds_for_all_t() {
        let cursor = CursorEvents {
            moves: vec![
                move_event(0.0, 0.02, 0.02),
                move_event(1000.0, 0.98, 0.03),
                move_event(2500.0, 0.97, 0.96),
                move_event(4000.0, 0.01, 0.99),
            ],
            clicks: vec![click_event(900.0), click_event(2400.0), click_event(3900.0)],
        };
        // Edge-hugging focus + manual corners + amounts up to 4x.
        let segments = vec![
            auto_segment(0.5, 4.5, 4.0),
            manual_segment(5.0, 6.0, 2.0, 0.0, 0.0),
            manual_segment(6.0, 7.0, 3.0, 1.0, 1.0),
        ];
        let mut timeline = timeline_for(&segments, &cursor, 9.0);
        timeline.precompute();

        let mut t = 0.0f32;
        while t <= 9.0 {
            let zoom = timeline.sample(t);
            assert_viewport_in_bounds(&zoom, &format!("t={t}"));
            t += 0.003; // off-grid sampling exercises the lerp too
        }
    }

    #[test]
    fn instant_segments_snap_without_spring() {
        let cursor = CursorEvents::default();
        let mut segment = manual_segment(1.0, 2.0, 2.5, 0.5, 0.5);
        segment.instant_animation = true;
        let mut timeline = timeline_for(&[segment], &cursor, 4.0);
        timeline.precompute();

        // One step into the segment the amount is already at target.
        let inside = timeline.sample(1.016);
        assert!(
            (inside.display_amount() - 2.5).abs() < 1e-4,
            "instant zoom-in did not snap: {}",
            inside.display_amount()
        );

        // One step past the end (still inside the +-100ms snap window) it is
        // already back at identity.
        let after = timeline.sample(2.016);
        assert!(
            (after.display_amount() - 1.0).abs() < 1e-4,
            "instant zoom-out did not snap: {}",
            after.display_amount()
        );

        assert!(timeline.snapped_within(0.95, 1.05));
        assert!(timeline.snapped_within(1.95, 2.05));
        assert!(!timeline.snapped_within(3.0, 4.0));
    }

    #[test]
    fn cluster_re_aim_is_smooth() {
        // Two click clusters far apart inside one long auto segment: the
        // target re-aims discretely, the sprung center must move smoothly.
        let cursor = CursorEvents {
            moves: vec![
                move_event(0.0, 0.1, 0.1),
                move_event(2000.0, 0.12, 0.12),
                move_event(5000.0, 0.9, 0.9),
                move_event(8000.0, 0.88, 0.88),
            ],
            clicks: vec![click_event(1000.0), click_event(6000.0)],
        };
        let segments = vec![auto_segment(0.5, 9.0, 2.0)];
        let mut timeline = timeline_for(&segments, &cursor, 10.0);
        timeline.precompute();

        let (max_value_jump, max_slope_jump) = max_step_discontinuities(&timeline);
        assert!(max_value_jump < 0.06, "re-aim value jump {max_value_jump}");
        assert!(max_slope_jump < 4.0, "re-aim slope jump {max_slope_jump}");

        // And it actually re-aims: early framing differs from late framing.
        let early = timeline.sample(3.0);
        let late = timeline.sample(8.9);
        assert!(
            (early.bounds.top_left.x - late.bounds.top_left.x).abs() > 0.05,
            "cluster re-aim never moved the framing"
        );
    }

    /// How far the cursor sits from the middle of the shot, as a fraction of
    /// the visible viewport. 0 is dead centre, 0.5 is the edge of frame.
    fn offset_from_shot_center(
        timeline: &ZoomTransformTimeline,
        at_secs: f32,
        cursor: (f64, f64),
    ) -> (f64, f64) {
        let zoom = timeline.sample(at_secs);
        let (left, top, size) = visible_viewport(&zoom);
        (
            (cursor.0 - (left + size / 2.0)) / size,
            (cursor.1 - (top + size / 2.0)) / size,
        )
    }

    #[test]
    fn auto_zoom_keeps_a_moving_cursor_near_the_center() {
        // A slow drag across the frame, sampled the way a real recording does.
        // Auto zoom used to aim at the centre of a cluster's bounding box, so
        // the cursor could sit a long way from the middle of the shot; it now
        // tracks the cursor itself, bounded by the dead zone.
        let moves: Vec<_> = (0..=60)
            .map(|step| {
                let progress = f64::from(step) / 60.0;
                move_event(f64::from(step) * 100.0, 0.2 + progress * 0.6, 0.5)
            })
            .collect();
        let cursor = CursorEvents {
            moves,
            clicks: vec![],
        };

        let amount = 2.0;
        let segments = vec![auto_segment(0.0, 6.0, amount)];
        let mut timeline = timeline_for(&segments, &cursor, 7.0);
        timeline.precompute();

        // Sample well after the zoom has engaged so the spring has settled.
        for step in 20..=55 {
            let time_ms = f64::from(step) * 100.0;
            let at_secs = (time_ms / 1000.0) as f32;
            let expected = (0.2 + (time_ms / 6000.0) * 0.6, 0.5);
            let (dx, dy) = offset_from_shot_center(&timeline, at_secs, expected);

            // The dead zone is DEAD_ZONE_HALF_WIDTH of the visible viewport;
            // allow a little spring lag on top of it.
            assert!(
                dx.abs() < DEAD_ZONE_HALF_WIDTH * 2.5,
                "cursor drifted {dx} of a viewport from centre at {at_secs}s"
            );
            assert!(
                dy.abs() < DEAD_ZONE_HALF_HEIGHT * 2.5,
                "cursor drifted {dy} of a viewport vertically at {at_secs}s"
            );
        }
    }

    #[test]
    fn tighter_zoom_holds_the_cursor_tighter() {
        // The dead zone is a fraction of the *visible* area, so pushing the
        // magnification up must not let the cursor wander further from centre
        // on screen — the failure mode being fixed here.
        let moves: Vec<_> = (0..=40)
            .map(|step| {
                let progress = f64::from(step) / 40.0;
                move_event(f64::from(step) * 100.0, 0.3 + progress * 0.4, 0.5)
            })
            .collect();
        let cursor = CursorEvents {
            moves,
            clicks: vec![],
        };

        let worst_offset = |amount: f64| {
            let segments = vec![auto_segment(0.0, 4.0, amount)];
            let mut timeline = timeline_for(&segments, &cursor, 5.0);
            timeline.precompute();

            (15..=38)
                .map(|step| {
                    let time_ms = f64::from(step) * 100.0;
                    let expected = (0.3 + (time_ms / 4000.0) * 0.4, 0.5);
                    offset_from_shot_center(&timeline, (time_ms / 1000.0) as f32, expected)
                        .0
                        .abs()
                })
                .fold(0.0_f64, f64::max)
        };

        let at_2x = worst_offset(2.0);
        let at_4x = worst_offset(4.0);

        assert!(
            at_4x < at_2x + 0.02,
            "4x framing ({at_4x}) is looser than 2x ({at_2x})"
        );
    }

    #[test]
    fn auto_zoom_does_not_aim_where_the_cursor_has_not_been_yet() {
        // The old cluster centre was the midpoint of a whole cluster's bounding
        // box, including movement still in the future, so the shot leaned
        // toward where the cursor was about to go. The aim must depend only on
        // the past.
        let cursor = CursorEvents {
            moves: vec![
                move_event(0.0, 0.2, 0.2),
                move_event(1000.0, 0.2, 0.2),
                // A late jump the early frames must know nothing about.
                move_event(4000.0, 0.85, 0.85),
                move_event(5000.0, 0.85, 0.85),
            ],
            clicks: vec![],
        };

        let segments = vec![auto_segment(0.0, 6.0, 2.0)];
        let mut timeline = timeline_for(&segments, &cursor, 7.0);
        timeline.precompute();

        let (dx, dy) = offset_from_shot_center(&timeline, 1.0, (0.2, 0.2));
        assert!(
            dx.abs() < 0.15 && dy.abs() < 0.15,
            "early framing leaned toward the future cursor ({dx}, {dy})"
        );
    }

    #[test]
    fn cursor_path_interpolates_between_samples() {
        let cursor = CursorEvents {
            moves: vec![move_event(0.0, 0.0, 0.0), move_event(1000.0, 1.0, 0.5)],
            clicks: vec![],
        };
        let path = build_cursor_path(&cursor, 0.0, 1.0, None);

        assert_eq!(path.sample(0.0), Some((0.0, 0.0)));
        assert_eq!(path.sample(500.0), Some((0.5, 0.25)));
        assert_eq!(path.sample(1000.0), Some((1.0, 0.5)));
        // Outside the recorded range the path holds its endpoints.
        assert_eq!(path.sample(-100.0), Some((0.0, 0.0)));
        assert_eq!(path.sample(9999.0), Some((1.0, 0.5)));
    }

    #[test]
    fn cursor_path_survives_unsorted_and_hostile_events() {
        let cursor = CursorEvents {
            moves: vec![
                move_event(0.0, 0.1, 0.1),
                move_event(f64::NAN, 0.5, 0.5),
                move_event(500.0, f64::INFINITY, 0.5),
                // Out of order: must not corrupt the binary search.
                move_event(200.0, 0.9, 0.9),
                move_event(800.0, 0.4, 0.4),
            ],
            clicks: vec![],
        };
        let path = build_cursor_path(&cursor, 0.0, 1.0, None);

        assert!(path.times_ms.windows(2).all(|w| w[0] <= w[1]));
        for time in [0.0, 100.0, 400.0, 900.0, f64::NAN] {
            let sampled = path.sample(time).expect("path should never be empty");
            assert!(sampled.0.is_finite() && sampled.1.is_finite());
        }
    }

    /// Raw-UV viewport of a sampled zoom: (left, top, size).
    fn visible_viewport(zoom: &InterpolatedZoom) -> (f64, f64, f64) {
        let amount = zoom.display_amount();
        (
            -zoom.bounds.top_left.x / amount,
            -zoom.bounds.top_left.y / amount,
            1.0 / amount,
        )
    }

    #[test]
    fn hovering_into_a_corner_re_aims_without_a_click() {
        // Regression for the real-recording report: clicks early near the
        // center, then the cursor HOVERS (no click) into the bottom-right
        // corner mid-segment. All movement participates in clustering, so
        // leaving the dead-zone box must re-aim the camera and bring the
        // hovered corner into the settled viewport.
        let corner = (0.95, 0.9);
        let mut moves = Vec::new();
        for i in 0..50 {
            moves.push(move_event(i as f64 * 100.0, 0.5, 0.5));
        }
        for i in 0..=20 {
            let t = i as f64 / 20.0;
            moves.push(move_event(
                5000.0 + t * 1000.0,
                0.5 + (corner.0 - 0.5) * t,
                0.5 + (corner.1 - 0.5) * t,
            ));
        }
        for i in 1..=30 {
            moves.push(move_event(6000.0 + i as f64 * 200.0, corner.0, corner.1));
        }
        let cursor = CursorEvents {
            moves,
            clicks: vec![click_event(1500.0), click_event(2000.0)],
        };
        let segments = vec![auto_segment(1.0, 15.1, 2.0)];
        let mut timeline = timeline_for(&segments, &cursor, 16.0);
        timeline.precompute();

        // Two seconds after arriving in the corner the spring has settled.
        let settled = timeline.sample(8.0);
        let (left, top, size) = visible_viewport(&settled);
        assert!(
            corner.0 >= left && corner.0 <= left + size,
            "hovered corner x {} outside viewport [{left}, {}]",
            corner.0,
            left + size
        );
        assert!(
            corner.1 >= top && corner.1 <= top + size,
            "hovered corner y {} outside viewport [{top}, {}]",
            corner.1,
            top + size
        );

        // And the framing genuinely moved from the early click-cluster view.
        let early = timeline.sample(4.0);
        let (early_left, early_top, _) = visible_viewport(&early);
        assert!(
            (left - early_left).abs() > 0.1 || (top - early_top).abs() > 0.1,
            "camera never re-aimed toward the hovered corner"
        );
        assert_viewport_in_bounds(&settled, "corner hover settle");
    }

    #[test]
    fn hostile_cursor_data_never_breaks_the_timeline() {
        // Simulated/corrupted input: NaN and infinite coordinates, positions
        // far outside the crop (cursor on another monitor), and full-screen
        // teleports between consecutive events (automation tools). The
        // timeline must stay finite, in bounds and smooth throughout.
        let moves = vec![
            move_event(0.0, 0.5, 0.5),
            move_event(500.0, f64::NAN, 0.5),
            move_event(600.0, 0.5, f64::INFINITY),
            move_event(1000.0, -3.0, 7.5),
            move_event(1500.0, 0.02, 0.98),
            move_event(1550.0, 0.98, 0.02),
            move_event(1600.0, 0.02, 0.02),
            move_event(1650.0, 0.98, 0.98),
            move_event(4000.0, 1.4, -0.4),
            move_event(8000.0, 0.5, 0.5),
        ];
        let cursor = CursorEvents {
            moves,
            clicks: vec![click_event(f64::NAN), click_event(1500.0)],
        };
        let segments = vec![auto_segment(0.5, 9.0, 2.0)];
        let mut timeline = timeline_for(&segments, &cursor, 10.0);
        timeline.precompute();

        for sample in &timeline.samples {
            assert!(
                sample.amount.is_finite()
                    && sample.center.x.is_finite()
                    && sample.center.y.is_finite()
                    && sample.activity.is_finite(),
                "non-finite sample: {sample:?}"
            );
        }
        let mut t = 0.0f32;
        while t <= 10.0 {
            let zoom = timeline.sample(t);
            assert!(
                zoom.bounds.top_left.x.is_finite() && zoom.bounds.bottom_right.y.is_finite(),
                "non-finite bounds at t={t}"
            );
            assert_viewport_in_bounds(&zoom, &format!("hostile input at t={t}"));
            t += 0.037;
        }
        let (max_value_jump, _) = max_step_discontinuities(&timeline);
        assert!(
            max_value_jump < 0.08,
            "teleporting input caused a visible jump: {max_value_jump}"
        );
    }

    #[test]
    fn empty_cursor_events_fall_back_to_centered_focus() {
        let cursor = CursorEvents::default();
        let segments = vec![auto_segment(0.5, 5.0, 2.0)];
        let mut timeline = timeline_for(&segments, &cursor, 6.0);
        timeline.precompute();

        // Well after the spring has settled (~1s), framing is centered.
        let settled = timeline.sample(4.5);
        let expected = SegmentBounds::from_amount_center(
            2.0,
            XY::new(
                SegmentBounds::calculate_follow_center(FALLBACK_FOCUS, 2.0).0,
                SegmentBounds::calculate_follow_center(FALLBACK_FOCUS, 2.0).1,
            ),
        );
        assert!((settled.bounds.top_left.x - expected.top_left.x).abs() < 1e-3);
        assert!((settled.bounds.bottom_right.y - expected.bottom_right.y).abs() < 1e-3);
        assert!((settled.t - 1.0).abs() < 1e-3);
    }

    #[test]
    fn steady_state_matches_manual_target_framing() {
        // Parity anchor with the retired easing implementation: a settled
        // manual zoom must land on exactly the same framing formula.
        let cursor = CursorEvents::default();
        let segments = vec![manual_segment(0.5, 6.0, 2.0, 0.3, 0.7)];
        let mut timeline = timeline_for(&segments, &cursor, 7.0);
        timeline.precompute();

        let settled = timeline.sample(5.5);
        let expected = SegmentBounds::from_amount_center(2.0, XY::new(0.3, 0.7));
        assert!((settled.bounds.top_left.x - expected.top_left.x).abs() < 1e-3);
        assert!((settled.bounds.top_left.y - expected.top_left.y).abs() < 1e-3);
        assert!((settled.bounds.bottom_right.x - expected.bottom_right.x).abs() < 1e-3);
        assert!((settled.bounds.bottom_right.y - expected.bottom_right.y).abs() < 1e-3);
    }

    #[test]
    fn manual_corner_zoom_launches_already_aimed() {
        // A manual zoom to the top-left corner must scale straight into the
        // corner from the first visible frame — not zoom about the stale
        // (centered) framing and pan over at high magnification. While the
        // amount is at identity the center is unobservable, so the timeline
        // pre-aims it; with a corner-flush target (0,0) the viewport's
        // top-left then stays pinned to the content's top-left for the whole
        // ramp.
        let cursor = CursorEvents::default();
        let segments = vec![manual_segment(1.0, 5.0, 2.862, 0.0, 0.0)];
        let mut timeline = timeline_for(&segments, &cursor, 6.0);
        timeline.precompute();

        for t in [1.05f32, 1.2, 1.5, 2.0, 3.0] {
            let z = timeline.sample(t);
            assert!(
                z.bounds.top_left.x.abs() < 5e-3 && z.bounds.top_left.y.abs() < 5e-3,
                "viewport must stay corner-anchored during the ramp at t={t}: {:?}",
                z.bounds
            );
        }

        // Guard against the assertion above passing trivially (identity
        // bounds also have top_left = 0): the zoom must actually engage and
        // settle on the full manual amount.
        let settled = timeline.sample(4.5);
        assert!(
            (settled.display_amount() - 2.862).abs() < 1e-2,
            "zoom failed to settle on the manual amount: {}",
            settled.display_amount()
        );

        // And the pre-aim must never cause a visible pop: the viewport stays
        // continuous across the segment start. Thresholds mirror the other
        // continuity tests — a 2.862x ramp legitimately sweeps ~0.054/step at
        // peak spring velocity, while a center pop at (say) amount 1.5 would
        // jump ~0.25 in one step.
        let (max_value_jump, max_slope_jump) = max_step_discontinuities(&timeline);
        assert!(
            max_value_jump < 0.1,
            "pre-aim introduced a step discontinuity: {max_value_jump}"
        );
        assert!(
            max_slope_jump < 4.0,
            "pre-aim introduced a velocity discontinuity: {max_slope_jump}/s"
        );
    }

    #[test]
    fn zoom_out_returns_to_identity_and_zero_activity() {
        let cursor = CursorEvents::default();
        let segments = vec![manual_segment(0.5, 2.0, 2.0, 0.5, 0.5)];
        let mut timeline = timeline_for(&segments, &cursor, 6.0);
        timeline.precompute();

        let rest = timeline.sample(5.5);
        assert!((rest.display_amount() - 1.0).abs() < 1e-4);
        assert!(rest.t < 1e-3);
        assert!((rest.bounds.top_left.x).abs() < 1e-4);
        assert!((rest.bounds.bottom_right.x - 1.0).abs() < 1e-4);
    }

    #[test]
    fn degenerate_segments_do_not_break_the_timeline() {
        let cursor = CursorEvents {
            moves: vec![move_event(0.0, 0.5, 0.5)],
            clicks: vec![],
        };
        let segments = vec![
            manual_segment(1.0, 1.0, 2.0, 0.5, 0.5), // zero duration
            manual_segment(3.0, 2.5, 2.0, 0.5, 0.5), // reversed
            auto_segment(100.0, 105.0, 2.0),         // beyond duration
        ];
        let mut timeline = timeline_for(&segments, &cursor, 5.0);
        timeline.precompute();

        let mut t = 0.0f32;
        while t <= 5.0 {
            let zoom = timeline.sample(t);
            assert_viewport_in_bounds(&zoom, &format!("degenerate t={t}"));
            // None of these segments can activate, so the timeline is identity.
            assert!(
                (zoom.display_amount() - 1.0).abs() < 1e-6,
                "degenerate segment activated at t={t}"
            );
            t += 0.05;
        }

        // Zero-duration timelines (screenshot paths) still sample safely.
        let mut zero = timeline_for(&[], &CursorEvents::default(), 0.0);
        zero.ensure_precomputed_until(1.0);
        let frame0 = zero.sample(0.0);
        assert!((frame0.display_amount() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn sampling_before_precompute_clamps_to_seed_instead_of_diverging() {
        // The old focus interpolator silently fell back to a *different*
        // interpolation when precompute had not run (the scrub-path bug).
        // The timeline instead clamps to what is cached — callers must ensure
        // first, but an unensured sample can never disagree with an ensured
        // one at t=0.
        let cursor = CursorEvents::default();
        let segments = vec![manual_segment(0.5, 2.0, 2.0, 0.5, 0.5)];
        let unensured = timeline_for(&segments, &cursor, 6.0);
        let frame0 = unensured.sample(0.0);
        assert!((frame0.display_amount() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn precompute_cost_is_bounded_for_long_projects() {
        use std::time::{Duration, Instant};

        // Synthetic 30-minute project: 10 auto zoom segments and 50k cursor
        // move events with a click every 3 seconds.
        let duration_secs = 1800.0;
        let moves: Vec<CursorMoveEvent> = (0..50_000)
            .map(|i| {
                let t_ms = i as f64 * (duration_secs * 1000.0 / 50_000.0);
                move_event(
                    t_ms,
                    ((i as f64 * 0.0011).sin() + 1.0) / 2.0,
                    ((i as f64 * 0.0007).cos() + 1.0) / 2.0,
                )
            })
            .collect();
        let clicks: Vec<CursorClickEvent> =
            (0..600).map(|i| click_event(i as f64 * 3_000.0)).collect();
        let cursor = CursorEvents { moves, clicks };
        let segments: Vec<ZoomSegment> = (0..10)
            .map(|i| auto_segment(i as f64 * 170.0 + 10.0, i as f64 * 170.0 + 40.0, 2.0))
            .collect();

        // Amortization: ensuring an early time must NOT precompute the whole
        // 30-minute timeline. 1s of content is ~127 samples at the 8ms step;
        // the full timeline would be ~225k.
        let construct_start = Instant::now();
        let mut lazy = timeline_for(&segments, &cursor, duration_secs);
        let construct_elapsed = construct_start.elapsed();
        let ensure_start = Instant::now();
        lazy.ensure_precomputed_until(1.0);
        let ensure_elapsed = ensure_start.elapsed();
        let lazy_samples = lazy.samples.len();
        println!(
            "construct: {construct_elapsed:?}, ensure(1s): {ensure_elapsed:?}, samples after early ensure: {lazy_samples}"
        );
        assert!(
            lazy_samples < 1_000,
            "early ensure_precomputed_until precomputed {lazy_samples} samples; amortization is broken"
        );

        // Full precompute of the 30-minute timeline.
        let mut timeline = timeline_for(&segments, &cursor, duration_secs);
        let precompute_start = Instant::now();
        timeline.precompute();
        let precompute_elapsed = precompute_start.elapsed();
        let total_samples = timeline.samples.len();
        println!("precompute({total_samples} samples): {precompute_elapsed:?}");

        // 10k hot-path samples spread across the whole duration.
        let sample_start = Instant::now();
        let mut checksum = 0.0f64;
        for i in 0..10_000u32 {
            let t = (i as f32 * 0.18) % duration_secs as f32;
            checksum += timeline.sample(t).display_amount();
        }
        let sample_elapsed = sample_start.elapsed();
        println!("10k samples: {sample_elapsed:?} (checksum {checksum})");

        // Generous debug-mode bounds; release is far faster.
        assert!(
            precompute_elapsed < Duration::from_millis(500),
            "full precompute took {precompute_elapsed:?} (>500ms) for a 30-minute project"
        );
        assert!(
            sample_elapsed < Duration::from_millis(50),
            "10k samples took {sample_elapsed:?} (>50ms)"
        );
    }

    #[test]
    fn timeline_mapping_filters_clusters_in_recording_time() {
        // Timeline: single segment showing recording range [10s, 20s] at 1x,
        // so timeline t=1s corresponds to recording t=11s. A click at
        // recording 11s must aim the zoom; a click at recording 1s must not.
        let timeline_config = TimelineConfiguration {
            segments: vec![TimelineSegment {
                recording_clip: 0,
                timescale: 1.0,
                start: 10.0,
                end: 20.0,
                name: None,
                speed_audio_mode: None,
                transform: None,
                perspective: None,
            }],
            transitions: vec![],
            zoom_segments: vec![],
            scene_segments: vec![],
            mask_segments: vec![],
            text_segments: vec![],
            caption_segments: vec![],
            keyboard_segments: vec![],
            audio_segments: vec![],
        };
        let cursor = CursorEvents {
            moves: vec![
                move_event(1_000.0, 0.05, 0.05), // recording 1s: outside edit
                move_event(11_000.0, 0.9, 0.9),  // recording 11s: inside edit
            ],
            clicks: vec![click_event(1_000.0), click_event(11_000.0)],
        };
        let segments = vec![auto_segment(0.5, 8.0, 2.0)];
        let mut timeline = ZoomTransformTimeline::new(
            &segments,
            Some(&timeline_config),
            &cursor,
            ScreenMovementSpring::default(),
            10.0,
            None,
        );
        timeline.precompute();

        // Settled framing aims at the in-edit click (0.9, 0.9), not (0.05, 0.05).
        let settled = timeline.sample(6.0);
        let toward_bottom_right = SegmentBounds::from_amount_center(
            2.0,
            XY::new(
                SegmentBounds::calculate_follow_center((0.9, 0.9), 2.0).0,
                SegmentBounds::calculate_follow_center((0.9, 0.9), 2.0).1,
            ),
        );
        assert!(
            (settled.bounds.top_left.x - toward_bottom_right.top_left.x).abs() < 1e-2,
            "expected framing near {:?}, got {:?}",
            toward_bottom_right,
            settled.bounds
        );
    }

    #[test]
    fn timeline_mapping_uses_incoming_source_during_transition() {
        let timeline = TimelineConfiguration {
            segments: vec![
                TimelineSegment {
                    recording_clip: 0,
                    timescale: 1.0,
                    start: 0.0,
                    end: 4.0,
                    name: None,
                    speed_audio_mode: None,
                    transform: None,
                    perspective: None,
                    },
                TimelineSegment {
                    recording_clip: 0,
                    timescale: 1.0,
                    start: 10.0,
                    end: 14.0,
                    name: None,
                    speed_audio_mode: None,
                    transform: None,
                    perspective: None,
                    },
            ],
            transitions: vec![ClipTransition {
                segment_index: 1,
                kind: ClipTransitionType::CrossFade,
                duration: 0.5,
            }],
            zoom_segments: Vec::new(),
            scene_segments: Vec::new(),
            mask_segments: Vec::new(),
            text_segments: Vec::new(),
            caption_segments: Vec::new(),
            keyboard_segments: Vec::new(),
            audio_segments: Vec::new(),
        };
        let map = build_time_map(Some(&timeline));

        assert_eq!(
            map_timeline_to_recording_secs(&map, 3.25, None, false),
            3.25
        );
        assert_eq!(
            map_timeline_to_recording_secs(&map, 3.75, None, false),
            10.25
        );
        assert_eq!(
            map_timeline_to_recording_secs(&map, 3.75, Some(0), false),
            10.25
        );
        assert_eq!(
            map_timeline_to_recording_secs(&map, 3.75, Some(0), true),
            3.75
        );
    }

    #[test]
    fn crop_map_identity_cases() {
        let screen = XY::new(1000u32, 1000u32);
        // Full-screen crop is the identity: no map.
        let full = Crop {
            position: XY::new(0, 0),
            size: XY::new(1000, 1000),
        };
        assert!(CursorCropMap::from_crop(&full, screen).is_none());
        // Degenerate inputs never produce a map.
        let degenerate = Crop {
            position: XY::new(0, 0),
            size: XY::new(0, 500),
        };
        assert!(CursorCropMap::from_crop(&degenerate, screen).is_none());
        assert!(CursorCropMap::from_crop(&full, XY::new(0, 0)).is_none());
    }

    #[test]
    fn crop_remaps_auto_zoom_focus_into_content_space() {
        // Screen 1000x1000 cropped to the bottom half: content = y 500..1000.
        let crop = Crop {
            position: XY::new(0, 500),
            size: XY::new(1000, 500),
        };
        let map = CursorCropMap::from_crop(&crop, XY::new(1000, 1000)).unwrap();

        // Cursor parked at raw (0.5, 0.75) = the exact CENTER of the visible
        // content. Uncropped this raw y would edge-snap to a bottom-flush
        // framing; content-space it must settle centered.
        let cursor = CursorEvents {
            moves: vec![move_event(0.0, 0.5, 0.75), move_event(8_000.0, 0.5, 0.75)],
            clicks: vec![],
        };
        let segments = vec![auto_segment(0.5, 8.0, 2.0)];
        let mut with_crop = ZoomTransformTimeline::new(
            &segments,
            None,
            &cursor,
            ScreenMovementSpring::default(),
            10.0,
            Some(map),
        );
        with_crop.precompute();

        let settled = with_crop.sample(6.0);
        let centered = SegmentBounds::from_amount_center(2.0, XY::new(0.5, 0.5));
        assert!(
            (settled.bounds.top_left.y - centered.top_left.y).abs() < 1e-2,
            "expected centered framing {:?}, got {:?}",
            centered,
            settled.bounds
        );

        let mut without_crop = timeline_for(&segments, &cursor, 10.0);
        without_crop.precompute();
        let raw_settled = without_crop.sample(6.0);
        assert!(
            (raw_settled.bounds.top_left.y - centered.top_left.y).abs() > 0.2,
            "control: uncropped framing should NOT be centered, got {:?}",
            raw_settled.bounds
        );
    }

    #[test]
    fn cursor_in_cropped_away_region_aims_at_content_edge() {
        // Bottom-half crop; the cursor hovers in the removed TOP strip
        // (raw y = 0.05 -> content y < 0). The framing must clamp to a
        // top-flush viewport, not wander or blow up.
        let crop = Crop {
            position: XY::new(0, 500),
            size: XY::new(1000, 500),
        };
        let map = CursorCropMap::from_crop(&crop, XY::new(1000, 1000)).unwrap();

        let cursor = CursorEvents {
            moves: vec![move_event(0.0, 0.5, 0.05), move_event(8_000.0, 0.5, 0.05)],
            clicks: vec![],
        };
        let segments = vec![auto_segment(0.5, 8.0, 2.0)];
        let mut timeline = ZoomTransformTimeline::new(
            &segments,
            None,
            &cursor,
            ScreenMovementSpring::default(),
            10.0,
            Some(map),
        );
        timeline.precompute();

        let settled = timeline.sample(6.0);
        let top_flush = SegmentBounds::from_amount_center(2.0, XY::new(0.5, 0.0));
        assert!(
            (settled.bounds.top_left.y - top_flush.top_left.y).abs() < 1e-2,
            "expected top-flush framing {:?}, got {:?}",
            top_flush,
            settled.bounds
        );
    }
}
