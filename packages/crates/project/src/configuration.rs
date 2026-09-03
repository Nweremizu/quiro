use std::{
    collections::BTreeMap,
    fmt,
    ops::{Add, Div, Mul, Sub, SubAssign},
    path::Path,
    sync::LazyLock,
};

use crate::frame_layout;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum AspectRatio {
    #[default]
    Wide,
    Vertical,
    Square,
    Classic,
    Tall,
}

pub type Color = [u16; 3];

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum BackgroundSource {
    Wallpaper {
        path: Option<String>,
    },
    Image {
        path: Option<String>,
    },
    Color {
        value: Color,
        #[serde(default = "default_alpha")]
        alpha: u8,
    },
    Gradient {
        from: Color,
        to: Color,
        #[serde(default = "default_gradient_angle")]
        angle: u16,
        #[serde(default)]
        noise_intensity: Option<f32>,
        #[serde(default)]
        noise_scale: Option<f32>,
        #[serde(default)]
        animated: Option<bool>,
        #[serde(default)]
        animation_speed: Option<f32>,
    },
}

fn default_gradient_angle() -> u16 {
    90
}

fn default_alpha() -> u8 {
    u8::MAX
}

impl Default for BackgroundSource {
    fn default() -> Self {
        BackgroundSource::Color {
            value: [255, 255, 255],
            alpha: 255,
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct XY<T> {
    pub x: T,
    pub y: T,
}

impl<T> XY<T> {
    pub const fn new(x: T, y: T) -> Self {
        Self { x, y }
    }

    pub fn map<U, F: Fn(T) -> U>(self, f: F) -> XY<U> {
        XY {
            x: f(self.x),
            y: f(self.y),
        }
    }
}

impl<T: Add<Output = T>> Add for XY<T> {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }
}

impl<T: Sub<Output = T>> Sub for XY<T> {
    type Output = Self;

    fn sub(self, other: Self) -> Self {
        Self {
            x: self.x - other.x,
            y: self.y - other.y,
        }
    }
}

impl<T: Sub<Output = T> + Copy> Sub<T> for XY<T> {
    type Output = Self;

    fn sub(self, other: T) -> Self {
        Self {
            x: self.x - other,
            y: self.y - other,
        }
    }
}

impl<T: Mul<Output = T> + Copy> Mul<XY<T>> for XY<T> {
    type Output = Self;

    fn mul(self, other: Self) -> Self {
        Self {
            x: self.x * other.x,
            y: self.y * other.y,
        }
    }
}

impl<T: Mul<Output = T> + Copy> Mul<T> for XY<T> {
    type Output = Self;

    fn mul(self, other: T) -> Self {
        Self {
            x: self.x * other,
            y: self.y * other,
        }
    }
}

impl<T: Div<Output = T> + Copy> Div<T> for XY<T> {
    type Output = Self;

    fn div(self, other: T) -> Self {
        Self {
            x: self.x / other,
            y: self.y / other,
        }
    }
}

impl<T: Div<Output = T>> Div<XY<T>> for XY<T> {
    type Output = Self;

    fn div(self, other: XY<T>) -> Self {
        Self {
            x: self.x / other.x,
            y: self.y / other.y,
        }
    }
}

impl<T> SubAssign for XY<T>
where
    T: SubAssign + Copy,
{
    fn sub_assign(&mut self, rhs: Self) {
        self.x -= rhs.x;
        self.y -= rhs.y;
    }
}

impl From<XY<f32>> for XY<f64> {
    fn from(val: XY<f32>) -> Self {
        XY {
            x: val.x as f64,
            y: val.y as f64,
        }
    }
}

impl<T> From<(T, T)> for XY<T> {
    fn from(val: (T, T)) -> Self {
        XY { x: val.0, y: val.1 }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum CornerStyle {
    #[default]
    Squircle,
    Rounded,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Crop {
    pub position: XY<u32>,
    pub size: XY<u32>,
}

impl Crop {
    pub fn aspect_ratio(&self) -> f32 {
        self.size.x as f32 / self.size.y as f32
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct ShadowConfiguration {
    pub size: f32,
    pub opacity: f32,
    pub blur: f32,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BorderConfiguration {
    pub enabled: bool,
    pub width: f32,
    pub color: Color,
    pub opacity: f32,
}

/// Decorative frame drawn around the screen recording (browser window,
/// macOS window, MacBook bezel, ...). The video is inset inside the frame's
/// chrome; the framed card as a whole follows padding / position / zoom
/// exactly like the bare video does today.
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrameStyle {
    /// No frame: the video renders bare, exactly as before this feature.
    #[default]
    None,
    /// A macOS window title bar with traffic-light buttons.
    MacOS,
    /// A Windows 11 window title bar with minimize/maximize/close controls.
    Windows,
    /// A browser toolbar: traffic lights plus a centered URL pill.
    Browser,
    /// A MacBook mockup: black bezel, aluminum body and deck.
    Macbook,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrameTheme {
    #[default]
    Dark,
    Light,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FrameConfiguration {
    pub style: FrameStyle,
    pub theme: FrameTheme,
    /// Text shown in the browser style's URL pill.
    pub url: String,
    /// Text shown in the macOS window style's title bar.
    pub title: String,
}

impl Default for FrameConfiguration {
    fn default() -> Self {
        Self {
            style: FrameStyle::None,
            theme: FrameTheme::default(),
            url: "Cap.so".to_string(),
            title: String::new(),
        }
    }
}

impl FrameConfiguration {
    pub fn active_style(config: Option<&FrameConfiguration>) -> FrameStyle {
        config.map(|f| f.style).unwrap_or(FrameStyle::None)
    }

    pub fn is_active(&self) -> bool {
        self.style != FrameStyle::None
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct BackgroundConfiguration {
    pub source: BackgroundSource,
    pub blur: f64,
    pub padding: f64,
    pub rounding: f64,
    pub rounding_type: CornerStyle,
    pub inset: u32,
    pub crop: Option<Crop>,
    /// Normalized (0-1) center of the display rect in output-frame space.
    /// `None` keeps the display centered. When a frame is active this is the
    /// center of the framed card (chrome included), not the bare video.
    pub display_position: Option<XY<f64>>,
    pub shadow: f32,
    pub advanced_shadow: Option<ShadowConfiguration>,
    pub border: Option<BorderConfiguration>,
    /// Decorative frame around the recording. `None` (or `FrameStyle::None`)
    /// renders the bare video exactly as before the feature existed.
    pub frame: Option<FrameConfiguration>,
    /// 3D tilt of the card. `None` renders it perfectly flat, pixel-identical
    /// to before this field existed — screenshots are the only surface that
    /// ever sets it; video and camera layers never see anything else.
    pub perspective: Option<PerspectiveConfiguration>,
    /// Film-grain noise laid over the whole background, whatever the source
    /// (colour, gradient, wallpaper, imported image). `None`/`0` renders no
    /// noise, byte-identical to before this field existed. When unset the
    /// renderer falls back to a gradient source's own `noise_intensity`.
    #[serde(default)]
    pub noise_intensity: Option<f32>,
    /// Grain size for `noise_intensity`. Defaults to `3.0` when noise is on.
    #[serde(default)]
    pub noise_scale: Option<f32>,
    /// Free placement of the capture inside the canvas: drag, uniform scale,
    /// in-plane rotation. `None` renders exactly the layout-derived placement
    /// this field did not exist to change.
    ///
    /// Its offset composes with [`Self::display_position`] rather than
    /// replacing it: that one is an absolute centre clamped into the frame,
    /// this one is a free delta on top, so a layer may leave the canvas
    /// entirely and be clipped.
    #[serde(default)]
    pub display_transform: Option<LayerTransform>,
}

impl Default for BorderConfiguration {
    fn default() -> Self {
        Self {
            enabled: false,
            width: 5.0,
            color: [255, 255, 255], // White
            opacity: 80.0,          // 80% opacity
        }
    }
}

impl Default for BackgroundConfiguration {
    fn default() -> Self {
        Self {
            source: BackgroundSource::default(),
            blur: 0.0,
            padding: 0.0,
            rounding: 0.0,
            rounding_type: CornerStyle::default(),
            inset: 0,
            crop: None,
            display_position: None,
            shadow: 73.6,
            advanced_shadow: Some(ShadowConfiguration::default()),
            border: None, // Border is disabled by default for backwards compatibility
            frame: None,  // No decorative frame by default
            perspective: None, // Flat by default
            noise_intensity: None,
            noise_scale: None,
            display_transform: None,
        }
    }
}

/// A composited layer's placement relative to the canvas it lives in.
///
/// The canvas is a fixed viewport, not a bounding box: it owns the output size
/// and the background, and whatever a layer puts outside it is clipped by the
/// render target rather than growing the frame. This is how far a layer has
/// been moved, scaled and spun inside that viewport, measured from wherever
/// the layout put it.
///
/// `offset` is a fraction of the canvas rather than pixels, so a composition
/// authored against the editor's preview survives an export at any other
/// resolution. Rotation is deliberately separate from the rect: the renderer
/// carries it in the card homography, which leaves `offset` and `scale`
/// describing an axis-aligned rect that layout, hit-testing and the annotation
/// anchor can all still reason about.
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LayerTransform {
    /// Displacement from the laid-out position, as a fraction of canvas
    /// width and height. Zero leaves the layer where layout put it.
    pub offset: XY<f64>,
    /// Uniform scale about the layer's own centre.
    pub scale: f64,
    /// In-plane rotation about the layer's own centre, in degrees.
    pub rotation: f64,
}

/// Below this the layer is a speck no gesture could recover, and the rounding
/// and shadow maths it feeds start dividing by near-zero extents.
pub const MIN_LAYER_SCALE: f64 = 0.05;
/// Above this a drag has effectively lost the layer: every handle is off
/// screen, so there is no way back except undo.
pub const MAX_LAYER_SCALE: f64 = 8.0;
/// A layer may be dragged clean off the canvas — that is the point of a
/// clipping viewport — but not so far that finding it again is a puzzle.
pub const MAX_LAYER_OFFSET: f64 = 2.0;

impl Default for LayerTransform {
    fn default() -> Self {
        Self {
            offset: XY::new(0.0, 0.0),
            scale: 1.0,
            rotation: 0.0,
        }
    }
}

impl LayerTransform {
    /// Whether this leaves the layer exactly where layout put it, so callers
    /// can take the untransformed path and stay bit-identical to a project
    /// that has never touched the gizmo.
    pub fn is_identity(&self) -> bool {
        self.offset.x == 0.0
            && self.offset.y == 0.0
            && (self.scale - 1.0).abs() < f64::EPSILON
            && self.rotation == 0.0
    }

    /// The same transform with every field pulled into a range the renderer
    /// can draw. Sidecars are hand-editable and gestures can produce NaN from
    /// a degenerate pointer delta, so this is applied on the way into the
    /// renderer rather than trusted at the edge.
    pub fn clamped(&self) -> Self {
        let finite = |value: f64, fallback: f64| if value.is_finite() { value } else { fallback };
        Self {
            offset: XY::new(
                finite(self.offset.x, 0.0).clamp(-MAX_LAYER_OFFSET, MAX_LAYER_OFFSET),
                finite(self.offset.y, 0.0).clamp(-MAX_LAYER_OFFSET, MAX_LAYER_OFFSET),
            ),
            scale: finite(self.scale, 1.0).clamp(MIN_LAYER_SCALE, MAX_LAYER_SCALE),
            rotation: finite(self.rotation, 0.0) % 360.0,
        }
    }
}

/// Screenshot-editor "Perspective" control: tilts the card in 3D. Degrees and
/// a 0-100 depth dial rather than a raw camera distance, so the schema reads
/// the same way the popover's sliders do; `quiro-rendering` converts this into
/// the homography the shader actually wants.
#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PerspectiveConfiguration {
    /// Leaning away from (positive) or toward (negative) the viewer, degrees.
    pub tilt_x: f32,
    /// Turning left (negative) or right (positive), degrees.
    pub tilt_y: f32,
    /// In-plane spin, degrees. No foreshortening on its own.
    pub rotate: f32,
    /// 0-100. Higher reads as a wider lens closer to the card, which makes the
    /// same tilt angle look more dramatic; lower flattens toward isometric.
    pub depth: f32,
}

impl Default for PerspectiveConfiguration {
    fn default() -> Self {
        Self {
            tilt_x: 0.0,
            tilt_y: 0.0,
            rotate: 0.0,
            depth: 45.0,
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum CameraXPosition {
    Left,
    Center,
    #[default]
    Right,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum CameraYPosition {
    Top,
    #[default]
    Bottom,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CameraPosition {
    pub x: CameraXPosition,
    pub y: CameraYPosition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundBlurMode {
    #[default]
    Off,
    Light,
    Heavy,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct BackgroundBlurConfig {
    pub mode: BackgroundBlurMode,
}

impl BackgroundBlurConfig {
    pub fn is_active(&self) -> bool {
        self.mode != BackgroundBlurMode::Off
    }
}

impl Default for BackgroundBlurConfig {
    fn default() -> Self {
        Self {
            mode: BackgroundBlurMode::Off,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct Camera {
    pub hide: bool,
    pub mirror: bool,
    pub position: CameraPosition,
    /// Normalized (0-1) center of the camera rect in output-frame space.
    /// Overrides `position` when set.
    pub manual_position: Option<XY<f64>>,
    pub size: f32,
    #[serde(alias = "zoom_size")]
    pub zoom_size: Option<f32>,
    pub rounding: f32,
    pub shadow: f32,
    #[serde(alias = "advanced_shadow")]
    pub advanced_shadow: Option<ShadowConfiguration>,
    pub shape: CameraShape,
    #[serde(alias = "rounding_type")]
    pub rounding_type: CornerStyle,
    #[serde(default = "Camera::default_scale_during_zoom")]
    pub scale_during_zoom: f32,
    #[serde(default)]
    pub background_blur: BackgroundBlurConfig,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum CameraShape {
    #[default]
    Square,
    Source,
}

impl Camera {
    pub fn default_zoom_size() -> f32 {
        60.0
    }

    fn default_rounding() -> f32 {
        100.0
    }

    fn default_scale_during_zoom() -> f32 {
        0.7
    }
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            hide: false,
            mirror: false,
            position: CameraPosition::default(),
            manual_position: None,
            size: 30.0,
            zoom_size: Some(Self::default_zoom_size()),
            rounding: Self::default_rounding(),
            shadow: 62.5,
            advanced_shadow: Some(ShadowConfiguration {
                size: 33.9,
                opacity: 44.2,
                blur: 10.5,
            }),
            shape: CameraShape::Square,
            rounding_type: CornerStyle::default(),
            scale_during_zoom: Self::default_scale_during_zoom(),
            background_blur: BackgroundBlurConfig::default(),
        }
    }
}

impl Default for ShadowConfiguration {
    fn default() -> Self {
        Self {
            size: 14.4,
            opacity: 68.1,
            blur: 3.8,
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum StereoMode {
    #[default]
    Stereo,
    MonoL,
    MonoR,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioConfiguration {
    pub mute: bool,
    pub improve: bool,
    pub mic_volume_db: f32,
    pub mic_stereo_mode: StereoMode,
    pub system_volume_db: f32,
}

impl Default for AudioConfiguration {
    fn default() -> Self {
        Self {
            mute: false,
            improve: false,
            mic_volume_db: 0.0,
            mic_stereo_mode: StereoMode::default(),
            system_volume_db: 0.0,
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CursorType {
    #[default]
    Auto,
    Pointer,
    Circle,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CursorAnimationStyle {
    Slow,
    Smooth,
    #[default]
    #[serde(alias = "regular", alias = "quick", alias = "rapid")]
    Mellow,
    Fast,
    Custom,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug)]
pub struct CursorSmoothingPreset {
    pub tension: f32,
    pub mass: f32,
    pub friction: f32,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClickSpringConfig {
    pub tension: f32,
    pub mass: f32,
    pub friction: f32,
}

impl Default for ClickSpringConfig {
    fn default() -> Self {
        Self {
            tension: 530.0,
            mass: 1.0,
            friction: 40.0,
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMovementSpring {
    pub stiffness: f32,
    pub damping: f32,
    pub mass: f32,
}

impl Default for ScreenMovementSpring {
    fn default() -> Self {
        Self {
            stiffness: 200.0,
            damping: 40.0,
            mass: 2.25,
        }
    }
}

impl CursorAnimationStyle {
    pub fn preset(self) -> Option<CursorSmoothingPreset> {
        match self {
            Self::Slow => Some(CursorSmoothingPreset {
                tension: 200.0,
                mass: 2.25,
                friction: 40.0,
            }),
            Self::Smooth => Some(CursorSmoothingPreset {
                tension: 80.0,
                mass: 2.5,
                friction: 28.0,
            }),
            Self::Mellow => Some(CursorSmoothingPreset {
                tension: 470.0,
                mass: 3.0,
                friction: 70.0,
            }),
            Self::Fast => Some(CursorSmoothingPreset {
                tension: 380.0,
                mass: 1.0,
                friction: 30.0,
            }),
            Self::Custom => None,
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct CursorConfiguration {
    pub hide: bool,
    pub hide_when_idle: bool,
    pub hide_when_idle_delay: f32,
    pub size: u32,
    r#type: CursorType,
    pub animation_style: CursorAnimationStyle,
    pub tension: f32,
    pub mass: f32,
    pub friction: f32,
    pub raw: bool,
    pub motion_blur: f32,
    pub use_svg: bool,
    #[serde(default = "CursorConfiguration::default_rotation_amount")]
    pub rotation_amount: f32,
    #[serde(default)]
    pub base_rotation: f32,
    #[serde(default)]
    pub click_spring: Option<ClickSpringConfig>,
    #[serde(default)]
    pub stop_movement_in_last_seconds: Option<f32>,
}

impl Default for CursorConfiguration {
    fn default() -> Self {
        let animation_style = CursorAnimationStyle::default();
        let mut config = Self {
            hide: false,
            hide_when_idle: false,
            hide_when_idle_delay: Self::default_hide_when_idle_delay(),
            size: 100,
            r#type: CursorType::default(),
            animation_style,
            tension: 470.0,
            mass: 3.0,
            friction: 70.0,
            raw: false,
            // Matches default_screen_motion_blur (the editor drives both
            // fields with one slider, and load() re-couples them).
            motion_blur: 1.0,
            use_svg: true,
            rotation_amount: Self::default_rotation_amount(),
            base_rotation: 0.0,
            click_spring: None,
            stop_movement_in_last_seconds: None,
        };

        if let Some(preset) = animation_style.preset() {
            config.tension = preset.tension;
            config.mass = preset.mass;
            config.friction = preset.friction;
        }

        config
    }
}
impl CursorConfiguration {
    fn default_hide_when_idle_delay() -> f32 {
        2.0
    }

    fn default_rotation_amount() -> f32 {
        0.15
    }

    pub fn cursor_type(&self) -> &CursorType {
        &self.r#type
    }

    pub fn click_spring_config(&self) -> ClickSpringConfig {
        self.click_spring.unwrap_or_default()
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HotkeysConfiguration {
    show: bool,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSegment {
    #[serde(default, rename = "recordingSegment")]
    pub recording_clip: u32,
    pub timescale: f64,
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed_audio_mode: Option<ClipSpeedAudioMode>,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipSpeedAudioMode {
    #[default]
    Mute,
    MaintainPitch,
    MatchSpeed,
}

impl TimelineSegment {
    fn interpolate_time(&self, tick: f64) -> Option<f64> {
        if tick > self.duration() {
            None
        } else {
            Some(self.start + tick * self.timescale)
        }
    }

    /// in seconds
    pub fn duration(&self) -> f64 {
        (self.end - self.start) / self.timescale
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum GlideDirection {
    #[default]
    None,
    Left,
    Right,
    Up,
    Down,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ZoomSegment {
    pub start: f64,
    pub end: f64,
    pub amount: f64,
    pub mode: ZoomMode,
    #[serde(default)]
    pub glide_direction: GlideDirection,
    #[serde(default = "ZoomSegment::default_glide_speed")]
    pub glide_speed: f64,
    #[serde(default)]
    pub instant_animation: bool,
    #[serde(default = "ZoomSegment::default_edge_snap_ratio")]
    pub edge_snap_ratio: f64,
}

impl ZoomSegment {
    fn default_glide_speed() -> f64 {
        0.5
    }

    fn default_edge_snap_ratio() -> f64 {
        0.25
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum ZoomMode {
    Auto,
    Manual { x: f32, y: f32 },
}

/// What a mask does to the region it covers.
///
/// Replaces the old split between a `MaskKind` of `sensitive`/`highlight` —
/// which was a *category*, not a mode — and a discriminant smuggled into the
/// effect amount by adding 1000 to it. One enum, readable in the JSON,
/// checkable by the compiler.
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MaskMode {
    /// Separable gaussian. Obscures; does **not** guarantee irreversibility —
    /// a gaussian is deconvolvable in principle.
    #[default]
    Blur,
    /// Nearest-neighbour block averaging. Also not irreversible: each block
    /// leaks the average of the pixels under it.
    Pixelate,
    /// Opaque fill. The only mode safe for credentials — no source pixel
    /// survives inside the region.
    Redact,
    /// Darkens everything *outside* the region rather than obscuring inside
    /// it. This is what the old `highlight` kind always did; the name now says
    /// so, since "highlight" reads as drawing *on* the region.
    Spotlight,
}

impl MaskMode {
    /// Whether the original pixels can, even in principle, be recovered.
    /// Drives the warning copy in the inspectors — a redaction tool that is
    /// vague about this is worse than one that has no redaction at all.
    pub fn is_reversible(self) -> bool {
        match self {
            MaskMode::Blur | MaskMode::Pixelate => true,
            MaskMode::Redact | MaskMode::Spotlight => false,
        }
    }
}

/// The region's outline. Rendering for the non-rect variants lands with the
/// shader rewrite in plan 004; the field exists now so that change is not
/// another migration.
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MaskShape {
    #[default]
    Rect,
    Ellipse,
    RoundedRect,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskEffectContract {
    pub default_amount: f64,
    pub min_amount: f64,
    pub max_amount: f64,
}

static MASK_EFFECT_CONTRACT: LazyLock<MaskEffectContract> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../mask-effects.json"))
        .expect("embedded mask effect contract must be valid JSON")
});

pub fn mask_effect_contract() -> &'static MaskEffectContract {
    &MASK_EFFECT_CONTRACT
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaskScalarKeyframe {
    pub time: f64,
    pub value: f64,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaskVectorKeyframe {
    pub time: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaskKeyframes {
    #[serde(default)]
    pub position: Vec<MaskVectorKeyframe>,
    #[serde(default)]
    pub size: Vec<MaskVectorKeyframe>,
    #[serde(default)]
    pub intensity: Vec<MaskScalarKeyframe>,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MaskSegment {
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub track: u32,
    #[serde(default = "MaskSegment::default_enabled")]
    pub enabled: bool,
    /// What the mask does. Legacy configs carry `maskType` + `pixelation`
    /// instead and are converted by
    /// [`ProjectConfiguration::migrate_mask_model`].
    #[serde(default)]
    pub mode: MaskMode,
    /// Effect strength in the contract's units (see `mask-effects.json`),
    /// 1080p-relative and scaled by output height at render time. Meaningless
    /// for [`MaskMode::Spotlight`], which uses `darkness` instead.
    #[serde(default = "MaskSegment::default_amount")]
    pub amount: f64,
    #[serde(default)]
    pub shape: MaskShape,
    pub center: XY<f64>,
    pub size: XY<f64>,
    #[serde(default)]
    pub feather: f64,
    #[serde(default = "MaskSegment::default_opacity")]
    pub opacity: f64,
    #[serde(default)]
    pub darkness: f64,
    #[serde(default = "MaskSegment::default_fade_duration")]
    pub fade_duration: f64,
    #[serde(default)]
    pub keyframes: MaskKeyframes,
}

impl MaskSegment {
    fn default_enabled() -> bool {
        true
    }

    fn default_opacity() -> f64 {
        1.0
    }

    fn default_amount() -> f64 {
        mask_effect_contract().default_amount
    }

    fn default_fade_duration() -> f64 {
        0.15
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TextSegment {
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub track: u32,
    #[serde(default = "TextSegment::default_enabled")]
    pub enabled: bool,
    #[serde(default = "TextSegment::default_content")]
    pub content: String,
    #[serde(default = "TextSegment::default_center")]
    pub center: XY<f64>,
    #[serde(default = "TextSegment::default_size")]
    pub size: XY<f64>,
    #[serde(default = "TextSegment::default_font_family")]
    pub font_family: String,
    #[serde(default = "TextSegment::default_font_size")]
    pub font_size: f32,
    #[serde(default = "TextSegment::default_font_weight")]
    pub font_weight: f32,
    #[serde(default)]
    pub italic: bool,
    #[serde(default = "TextSegment::default_color")]
    pub color: String,
    #[serde(default = "TextSegment::default_fade_duration")]
    pub fade_duration: f64,
}

impl TextSegment {
    fn default_enabled() -> bool {
        true
    }

    fn default_content() -> String {
        "Text".to_string()
    }

    fn default_center() -> XY<f64> {
        XY::new(0.5, 0.5)
    }

    fn default_size() -> XY<f64> {
        XY::new(0.35, 0.2)
    }

    fn default_font_family() -> String {
        "sans-serif".to_string()
    }

    fn default_font_size() -> f32 {
        48.0
    }

    fn default_font_weight() -> f32 {
        700.0
    }

    fn default_color() -> String {
        "#ffffff".to_string()
    }

    fn default_fade_duration() -> f64 {
        0.15
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum SceneMode {
    #[default]
    Default,
    CameraOnly,
    HideCamera,
    SplitScreen,
    /// Like [`SceneMode::SplitScreen`], but the screen and camera render as
    /// padded, rounded, shadowed cards floating over the background instead
    /// of full-bleed halves. Shares [`SplitLayout`] for per-pane pan/zoom.
    Floating,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct SplitLayout {
    pub screen_zoom: f64,
    pub screen_position: XY<f64>,
    pub camera_zoom: f64,
    pub camera_position: XY<f64>,
}

impl Default for SplitLayout {
    fn default() -> Self {
        Self {
            screen_zoom: 1.0,
            screen_position: XY::new(0.5, 0.5),
            camera_zoom: 1.0,
            camera_position: XY::new(0.5, 0.5),
        }
    }
}

fn default_scene_transition() -> f64 {
    0.3
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SceneSegment {
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub mode: SceneMode,
    #[serde(default)]
    pub split_layout: Option<SplitLayout>,
    #[serde(default = "default_scene_transition")]
    pub transition_in: f64,
    #[serde(default = "default_scene_transition")]
    pub transition_out: f64,
}

/// A timeline-positioned audio clip (background music or imported audio).
///
/// Unlike the recording's mic/system audio (which is keyed to recording clips),
/// these segments live in output/timeline time exactly like zoom/text/mask
/// segments. `path` is resolved relative to the project directory so projects
/// stay portable when moved.
#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackSegment {
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub track: u32,
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default = "AudioTrackSegment::default_enabled")]
    pub enabled: bool,
    /// Offset into the source audio file (seconds) at which playback begins.
    #[serde(default)]
    pub trim_start: f64,
    #[serde(default)]
    pub volume_db: f32,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    /// Source duration in seconds, persisted so the UI can clamp resizing
    /// without re-decoding the file.
    #[serde(default)]
    pub duration: Option<f64>,
}

impl AudioTrackSegment {
    fn default_enabled() -> bool {
        true
    }
}

pub const MIN_CLIP_TRANSITION_DURATION: f64 = 0.05;

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ClipTransitionType {
    #[default]
    CrossFade,
    FadeThroughBlack,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipTransition {
    pub segment_index: u32,
    #[serde(rename = "type")]
    pub kind: ClipTransitionType,
    pub duration: f64,
}

fn deserialize_clip_transitions<'de, D>(deserializer: D) -> Result<Vec<ClipTransition>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let transitions = Vec::<ClipTransition>::deserialize(deserializer)?;
    let mut by_segment = BTreeMap::new();
    for transition in transitions {
        by_segment.insert(transition.segment_index, transition);
    }
    Ok(by_segment.into_values().collect())
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TimelineConfiguration {
    pub segments: Vec<TimelineSegment>,
    // NOTE: omitted from the JSON when empty, but the generated TypeScript
    // still types this as a present array — specta applies `#[specta(...)]`
    // before `#[serde(...)]`, so `skip_serializing_if` (not `Option::is_none`)
    // resets the optional flag and no attribute here can win. The editor
    // normalizes the timeline on load instead; see `normalizeTimeline`.
    #[serde(
        default,
        deserialize_with = "deserialize_clip_transitions",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub transitions: Vec<ClipTransition>,
    pub zoom_segments: Vec<ZoomSegment>,
    #[serde(default)]
    pub scene_segments: Vec<SceneSegment>,
    #[serde(default)]
    pub mask_segments: Vec<MaskSegment>,
    #[serde(default)]
    pub text_segments: Vec<TextSegment>,
    #[serde(default)]
    pub caption_segments: Vec<CaptionTrackSegment>,
    #[serde(default)]
    pub keyboard_segments: Vec<crate::KeyboardTrackSegment>,
    #[serde(default)]
    pub audio_segments: Vec<AudioTrackSegment>,
}

#[derive(Clone, Copy, Debug)]
pub struct TimelineSource<'a> {
    pub source_time: f64,
    pub segment_index: usize,
    pub segment: &'a TimelineSegment,
}

#[derive(Clone, Copy, Debug)]
pub enum TimelineFrameMapping<'a> {
    Single {
        source: TimelineSource<'a>,
        output_end: f64,
    },
    Transition {
        outgoing: TimelineSource<'a>,
        incoming: TimelineSource<'a>,
        kind: ClipTransitionType,
        progress: f64,
        duration: f64,
        output_end: f64,
    },
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CaptionTrackSegment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(default)]
    pub words: Vec<CaptionWord>,
    #[serde(default)]
    pub fade_duration_override: Option<f32>,
    #[serde(default)]
    pub linger_duration_override: Option<f32>,
    #[serde(default)]
    pub position_override: Option<String>,
    #[serde(default)]
    pub color_override: Option<String>,
    #[serde(default)]
    pub background_color_override: Option<String>,
    #[serde(default)]
    pub font_size_override: Option<u32>,
}

impl TimelineConfiguration {
    pub fn effective_transition(&self, segment_index: usize) -> Option<ClipTransition> {
        if segment_index == 0 || segment_index >= self.segments.len() {
            return None;
        }

        debug_assert!(
            self.transitions.windows(2).all(|transitions| {
                transitions[0].segment_index <= transitions[1].segment_index
            })
        );

        let transition_position = self
            .transitions
            .partition_point(|transition| transition.segment_index as usize <= segment_index);
        let transition = self.transitions.get(transition_position.checked_sub(1)?)?;
        if transition.segment_index as usize != segment_index {
            return None;
        }
        if !transition.duration.is_finite() || transition.duration <= 0.0 {
            return None;
        }

        let maximum = self.segments[segment_index - 1]
            .duration()
            .min(self.segments[segment_index].duration())
            / 2.0;
        if !maximum.is_finite() || maximum < MIN_CLIP_TRANSITION_DURATION {
            return None;
        }

        Some(ClipTransition {
            duration: transition
                .duration
                .clamp(MIN_CLIP_TRANSITION_DURATION, maximum),
            ..*transition
        })
    }

    pub fn get_frame_mapping(&self, frame_time: f64) -> Option<TimelineFrameMapping<'_>> {
        if self.transitions.is_empty() {
            return self.get_segment_time_without_transitions(frame_time).map(
                |(source_time, segment, segment_index, output_end)| TimelineFrameMapping::Single {
                    source: TimelineSource {
                        source_time,
                        segment_index,
                        segment,
                    },
                    output_end,
                },
            );
        }

        let mut segment_start = 0.0;

        for (segment_index, segment) in self.segments.iter().enumerate() {
            let incoming = self.effective_transition(segment_index);
            let incoming_duration = incoming.as_ref().map_or(0.0, |value| value.duration);

            if let Some(transition) = incoming {
                let output_end = segment_start + transition.duration;
                if frame_time >= segment_start && frame_time < output_end {
                    let elapsed = frame_time - segment_start;
                    let outgoing_segment = &self.segments[segment_index - 1];
                    let outgoing_time = outgoing_segment.interpolate_time(
                        outgoing_segment.duration() - transition.duration + elapsed,
                    )?;
                    let incoming_time = segment.interpolate_time(elapsed)?;

                    return Some(TimelineFrameMapping::Transition {
                        outgoing: TimelineSource {
                            source_time: outgoing_time,
                            segment_index: segment_index - 1,
                            segment: outgoing_segment,
                        },
                        incoming: TimelineSource {
                            source_time: incoming_time,
                            segment_index,
                            segment,
                        },
                        kind: transition.kind,
                        progress: (elapsed / transition.duration).clamp(0.0, 1.0),
                        duration: transition.duration,
                        output_end,
                    });
                }
            }

            let next_transition = self.effective_transition(segment_index + 1);
            let next_duration = next_transition.as_ref().map_or(0.0, |value| value.duration);
            let single_start = segment_start + incoming_duration;
            let output_end = segment_start + segment.duration() - next_duration;

            if frame_time >= single_start && frame_time < output_end {
                let source_time = segment.interpolate_time(frame_time - segment_start)?;
                return Some(TimelineFrameMapping::Single {
                    source: TimelineSource {
                        source_time,
                        segment_index,
                        segment,
                    },
                    output_end,
                });
            }

            segment_start += segment.duration() - next_duration;
        }

        None
    }

    pub fn get_segment_time(&self, frame_time: f64) -> Option<(f64, &TimelineSegment)> {
        if !self.transitions.is_empty() {
            return match self.get_frame_mapping(frame_time)? {
                TimelineFrameMapping::Single { source, .. } => {
                    Some((source.source_time, source.segment))
                }
                TimelineFrameMapping::Transition { incoming, .. } => {
                    Some((incoming.source_time, incoming.segment))
                }
            };
        }

        self.get_segment_time_without_transitions(frame_time)
            .map(|(source_time, segment, _, _)| (source_time, segment))
    }

    fn get_segment_time_without_transitions(
        &self,
        frame_time: f64,
    ) -> Option<(f64, &TimelineSegment, usize, f64)> {
        let mut accum_duration = 0.0;

        for (segment_index, segment) in self.segments.iter().enumerate() {
            if frame_time < accum_duration + segment.duration() {
                return segment
                    .interpolate_time(frame_time - accum_duration)
                    .map(|time| {
                        (
                            time,
                            segment,
                            segment_index,
                            accum_duration + segment.duration(),
                        )
                    });
            }

            accum_duration += segment.duration();
        }

        None
    }

    pub fn duration(&self) -> f64 {
        let segment_duration = self.segments.iter().map(TimelineSegment::duration).sum();
        if self.transitions.is_empty() {
            return segment_duration;
        }

        segment_duration
            - (1..self.segments.len())
                .filter_map(|segment_index| self.effective_transition(segment_index))
                .map(|transition| transition.duration)
                .sum::<f64>()
    }
}

pub const WALLPAPERS_PATH: &str = "assets/backgrounds/macOS";

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptionWord {
    pub text: String,
    pub start: f32,
    pub end: f32,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptionSegment {
    pub id: String,
    pub start: f32,
    pub end: f32,
    pub text: String,
    #[serde(default)]
    pub words: Vec<CaptionWord>,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionPosition {
    TopLeft,
    TopCenter,
    TopRight,
    #[default]
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptionSettings {
    pub enabled: bool,
    pub font: String,
    pub size: u32,
    pub color: String,
    #[serde(alias = "backgroundColor")]
    pub background_color: String,
    #[serde(alias = "backgroundOpacity")]
    pub background_opacity: u32,
    pub position: String,
    pub italic: bool,
    #[serde(alias = "fontWeight")]
    pub font_weight: u32,
    pub outline: bool,
    #[serde(alias = "outlineColor")]
    pub outline_color: String,
    #[serde(alias = "exportWithSubtitles")]
    pub export_with_subtitles: bool,
    #[serde(alias = "highlightColor")]
    pub highlight_color: String,
    #[serde(alias = "fadeDuration")]
    pub fade_duration: f32,
    #[serde(alias = "lingerDuration")]
    pub linger_duration: f32,
    #[serde(alias = "wordTransitionDuration")]
    pub word_transition_duration: f32,
    #[serde(alias = "activeWordHighlight")]
    pub active_word_highlight: bool,
    #[serde(alias = "manualPosition")]
    pub manual_position: Option<XY<f32>>,
    pub preset: String,
    pub animation: String,
    #[serde(alias = "highlightStyle")]
    pub highlight_style: String,
    pub uppercase: bool,
}

impl CaptionSettings {
    fn default_highlight_color() -> String {
        "#FFFFFF".to_string()
    }

    fn default_font_weight() -> u32 {
        700
    }

    fn default_fade_duration() -> f32 {
        0.15
    }

    fn default_linger_duration() -> f32 {
        0.4
    }

    fn default_word_transition_duration() -> f32 {
        0.25
    }

    fn default_active_word_highlight() -> bool {
        false
    }

    fn default_preset() -> String {
        "classic".to_string()
    }

    fn default_animation() -> String {
        "bounce".to_string()
    }

    fn default_highlight_style() -> String {
        "color".to_string()
    }
}

impl Default for CaptionSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            font: "System Sans-Serif".to_string(),
            size: 24,
            color: "#FFFFFF".to_string(),
            background_color: "#000000".to_string(),
            background_opacity: 90,
            position: "bottom-center".to_string(),
            italic: false,
            font_weight: Self::default_font_weight(),
            outline: false,
            outline_color: "#000000".to_string(),
            export_with_subtitles: false,
            highlight_color: Self::default_highlight_color(),
            fade_duration: Self::default_fade_duration(),
            linger_duration: Self::default_linger_duration(),
            word_transition_duration: Self::default_word_transition_duration(),
            active_word_highlight: Self::default_active_word_highlight(),
            manual_position: None,
            preset: Self::default_preset(),
            animation: Self::default_animation(),
            highlight_style: Self::default_highlight_style(),
            uppercase: false,
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptionsData {
    pub segments: Vec<CaptionSegment>,
    pub settings: CaptionSettings,
    /// When true, `segments` are stored in source/recording time and the
    /// rendered `timeline.caption_segments` are derived by projecting them
    /// through the current edit list, so captions stay aligned to their spoken
    /// content as clips are trimmed, deleted, reordered, or inserted. Legacy
    /// projects (false) stored segments in already-edited output time and are
    /// migrated to source time on first load.
    #[serde(default)]
    pub source_timed: bool,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct KeyboardSettings {
    pub enabled: bool,
    pub font: String,
    pub size: u32,
    pub color: String,
    pub background_color: String,
    pub background_opacity: u32,
    pub position: String,
    pub font_weight: u32,
    pub fade_duration: f32,
    pub linger_duration: f32,
    pub grouping_threshold_ms: f64,
    pub show_modifiers: bool,
    pub show_special_keys: bool,
    pub uppercase: bool,
}

impl Default for KeyboardSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            font: "System Sans-Serif".to_string(),
            size: 50,
            color: "#FFFFFF".to_string(),
            background_color: "#000000".to_string(),
            background_opacity: 95,
            position: "bottom-center".to_string(),
            font_weight: 400,
            fade_duration: 0.15,
            linger_duration: 0.8,
            grouping_threshold_ms: 500.0,
            show_modifiers: true,
            show_special_keys: true,
            uppercase: false,
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardData {
    pub settings: KeyboardSettings,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default)]
pub struct ClipOffsets {
    #[serde(default)]
    pub camera: f32,
    #[serde(default)]
    pub mic: f32,
    #[serde(default)]
    pub system_audio: f32,
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipConfiguration {
    pub index: u32,
    pub offsets: ClipOffsets,
    /// Whether `offsets` were computed automatically (recording start-time
    /// alignment + device sync calibration) rather than entered by the user.
    /// Cleared by the editor UI once the user edits an offset.
    #[serde(default)]
    pub offsets_auto_calculated: bool,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AnnotationType {
    Arrow,
    Circle,
    Rectangle,
    Text,
    Mask,
    Focus,
}

/// Arrow-only shape/style. All optional on `Annotation`: absent reproduces the
/// original straight arrow with a single solid head. Geometry lives in the
/// frontend's `arrow.ts`; the renderer never draws annotations.
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ArrowCurve {
    Straight,
    Quadratic,
    Cubic,
    Elbow,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ArrowHead {
    None,
    Arrow,
    Triangle,
    Circle,
    Square,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LineStyle {
    Solid,
    Dashed,
    Dotted,
}

/// Cinematic depth of field over the screenshot: an elliptical plane of focus,
/// with blur growing continuously with distance from it — a circle-of-confusion
/// approximation rather than a sharp-inside/blurred-outside mask. Applies to the
/// screenshot only; the composition's background is never touched.
///
/// The region is normalized to the screenshot (0..1 on each axis) so the effect
/// is resolution-independent and survives padding, crop and aspect-ratio changes
/// that move the screenshot within the frame.
///
/// `blur`, `depth` and `lens` are the user-facing dials (0-100); the shader
/// derives max circle-of-confusion, falloff curve and bokeh highlight strength
/// from them, so no lens terminology leaks into the UI.
/// Outline of the plane of focus. An ellipse is the lens-native shape; a
/// rectangle suits UI screenshots, where the subject is usually a panel, a
/// toolbar or a dialog rather than a round object.
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FocusShape {
    #[default]
    Ellipse,
    Rectangle,
}

#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FocusConfig {
    pub x: f64,
    pub y: f64,
    pub radius_x: f64,
    pub radius_y: f64,
    /// Degrees, clockwise. Lets the plane of focus follow a diagonal subject.
    pub rotation: f64,
    pub shape: FocusShape,

    pub blur: f64,
    pub depth: f64,
    pub lens: f64,

    /// Asymmetry multipliers: content above the focus reads as further away,
    /// below as nearer, so a composition can defocus one side harder. `1.0`
    /// each side is symmetric.
    pub near_blur: f64,
    pub far_blur: f64,
}

impl Default for FocusConfig {
    fn default() -> Self {
        Self {
            x: 0.5,
            y: 0.5,
            radius_x: 0.20,
            radius_y: 0.16,
            rotation: 0.0,
            shape: FocusShape::Ellipse,
            // Tuned on screen rather than derived: a gentle circle of confusion
            // over a wide, softly-ramped plane of focus. `lens` stays low
            // because it drives a real highlight expansion — enough to read as
            // optics, not enough to blow out a bright UI.
            blur: 18.0,
            depth: 26.0,
            lens: 5.0,
            near_blur: 0.55,
            far_blur: 0.55,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum AnnotationValidationError {
    MaskModeMissing {
        id: String,
    },
    MaskAmountMissing {
        id: String,
    },
    MaskAmountInvalid {
        id: String,
        amount: f64,
    },
    MaskDataNotAllowed {
        id: String,
        annotation_type: AnnotationType,
    },
    FocusDataMissing {
        id: String,
    },
    FocusDataNotAllowed {
        id: String,
        annotation_type: AnnotationType,
    },
}

impl fmt::Display for AnnotationValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MaskModeMissing { id } => {
                write!(f, "annotation {id} of type mask is missing maskMode")
            }
            Self::MaskAmountMissing { id } => {
                write!(f, "annotation {id} of type mask is missing maskAmount")
            }
            Self::MaskAmountInvalid { id, amount } => {
                write!(f, "annotation {id} has invalid maskAmount {amount}")
            }
            Self::MaskDataNotAllowed {
                id,
                annotation_type,
            } => write!(
                f,
                "annotation {id} with type {annotation_type:?} cannot include mask data"
            ),
            Self::FocusDataMissing { id } => {
                write!(f, "annotation {id} of type focus is missing focus")
            }
            Self::FocusDataNotAllowed {
                id,
                annotation_type,
            } => write!(
                f,
                "annotation {id} with type {annotation_type:?} cannot include focus data"
            ),
        }
    }
}

impl std::error::Error for AnnotationValidationError {}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    #[serde(rename = "type")]
    pub annotation_type: AnnotationType,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub stroke_color: String,
    pub stroke_width: f64,
    pub fill_color: String,
    pub opacity: f64,
    pub rotation: f64,
    pub text: Option<String>,
    /// What this mask does. `None` on every non-mask annotation; required on a
    /// mask. Shares [`MaskMode`] with the timeline's `MaskSegment` — one
    /// taxonomy for one concept.
    #[serde(default, alias = "maskType")]
    pub mask_mode: Option<MaskMode>,
    /// Effect strength in the mask contract's units, 1080p-relative, exactly
    /// as `MaskSegment::amount`. Legacy configs stored this as
    /// `maskLevel` in frame pixels, which meant something different at every
    /// frame size; converted by
    /// [`ProjectConfiguration::migrate_annotation_space`].
    #[serde(default, alias = "maskLevel")]
    pub mask_amount: Option<f64>,
    #[serde(default)]
    pub mask_shape: Option<MaskShape>,
    /// 0..1 of the region's shorter axis. Ignored for
    /// [`MaskMode::Redact`], which must stay hard-edged.
    #[serde(default)]
    pub mask_feather: Option<f64>,
    /// Spotlight only: how far the area *outside* the region is darkened.
    #[serde(default)]
    pub mask_darkness: Option<f64>,
    /// 0..1 of the region's shorter axis, for [`MaskShape::RoundedRect`].
    #[serde(default)]
    pub mask_corner_radius: Option<f64>,
    #[serde(default)]
    pub focus: Option<FocusConfig>,
    #[serde(default)]
    pub arrow_curve: Option<ArrowCurve>,
    #[serde(default)]
    pub arrow_bend: Option<f64>,
    #[serde(default)]
    pub arrow_start_head: Option<ArrowHead>,
    #[serde(default)]
    pub arrow_end_head: Option<ArrowHead>,
    #[serde(default)]
    pub arrow_head_size: Option<f64>,
    #[serde(default)]
    pub line_style: Option<LineStyle>,
    #[serde(default)]
    pub arrow_taper: Option<bool>,
}

impl Annotation {
    pub fn validate(&self) -> Result<(), AnnotationValidationError> {
        // Type-specific payloads are mutually exclusive: each type must carry
        // its own and nothing else's.
        if self.annotation_type != AnnotationType::Mask
            && (self.mask_mode.is_some()
                || self.mask_amount.is_some()
                || self.mask_shape.is_some()
                || self.mask_feather.is_some()
                || self.mask_darkness.is_some()
                || self.mask_corner_radius.is_some())
        {
            return Err(AnnotationValidationError::MaskDataNotAllowed {
                id: self.id.clone(),
                annotation_type: self.annotation_type,
            });
        }

        if self.annotation_type != AnnotationType::Focus && self.focus.is_some() {
            return Err(AnnotationValidationError::FocusDataNotAllowed {
                id: self.id.clone(),
                annotation_type: self.annotation_type,
            });
        }

        match self.annotation_type {
            AnnotationType::Mask => {
                let Some(mode) = self.mask_mode else {
                    return Err(AnnotationValidationError::MaskModeMissing {
                        id: self.id.clone(),
                    });
                };

                // Redact and Spotlight have no strength: one is opaque or it
                // is not a redaction, and the other is driven by `darkness`.
                if matches!(mode, MaskMode::Redact | MaskMode::Spotlight) {
                    return Ok(());
                }

                let amount = self.mask_amount.ok_or_else(|| {
                    AnnotationValidationError::MaskAmountMissing {
                        id: self.id.clone(),
                    }
                })?;

                if !amount.is_finite() || amount <= 0.0 {
                    return Err(AnnotationValidationError::MaskAmountInvalid {
                        id: self.id.clone(),
                        amount,
                    });
                }

                Ok(())
            }
            AnnotationType::Focus => {
                if self.focus.is_none() {
                    return Err(AnnotationValidationError::FocusDataMissing {
                        id: self.id.clone(),
                    });
                }

                Ok(())
            }
            _ => Ok(()),
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectConfiguration {
    pub aspect_ratio: Option<AspectRatio>,
    pub background: BackgroundConfiguration,
    pub camera: Camera,
    pub audio: AudioConfiguration,
    pub cursor: CursorConfiguration,
    pub hotkeys: HotkeysConfiguration,
    pub timeline: Option<TimelineConfiguration>,
    pub captions: Option<CaptionsData>,
    pub keyboard: Option<KeyboardData>,
    pub clips: Vec<ClipConfiguration>,
    pub annotations: Vec<Annotation>,
    #[serde(skip_serializing)]
    pub hidden_text_segments: Vec<usize>,
    #[serde(default = "ProjectConfiguration::default_screen_motion_blur")]
    pub screen_motion_blur: f32,
    #[serde(default)]
    pub screen_movement_spring: ScreenMovementSpring,
    /// How text segment font sizes are interpreted. 0 (legacy): the renderer
    /// multiplied `font_size` by `size.y / 0.2`, coupling glyph size to the
    /// box. 1: `font_size` alone determines glyph size (1080p-relative);
    /// legacy configs are migrated on load by baking the box factor into
    /// `font_size`. The field-level default keeps old files at 0 while
    /// `Default::default()` produces the current version.
    #[serde(default)]
    pub text_size_version: u32,
    /// How annotation geometry is interpreted. 0 (legacy): `x`/`y`/`width`/
    /// `height` are pixels in the rendered output frame — a frame whose size
    /// and content offset are recomputed whenever padding, crop or aspect
    /// ratio changes, so the stored numbers stop meaning what they meant.
    /// 1: normalized 0..1 against the annotation's [`AnnotationAnchor`].
    ///
    /// The field-level default keeps old files at 0 while `Default::default()`
    /// produces the current version — the same arrangement as
    /// [`Self::text_size_version`]. Migration is *not* performed here: it needs
    /// the capture dimensions and the frame-layout maths, neither of which this
    /// crate has. See `annotation_space::migrate`.
    #[serde(default)]
    pub annotation_space_version: u32,
    /// How mask segments are encoded. 0 (legacy): a `maskType` of
    /// `sensitive`/`highlight` plus a `pixelation` float that smuggled
    /// blur-vs-pixelate into its own value by adding 1000 to it. 1: an explicit
    /// [`MaskMode`] and a plain `amount`. Migrated on load — see
    /// [`Self::migrate_mask_model`].
    #[serde(default)]
    pub mask_model_version: u32,
}

pub const TEXT_SIZE_VERSION: u32 = 1;

/// Version 1 stores annotation geometry normalized to its anchor. See
/// [`ProjectConfiguration::annotation_space_version`].
/// 1 normalized geometry to the anchor. 2 additionally converted mask
/// strength from frame pixels to the contract's 1080p-relative units, so a
/// screenshot mask means the same thing as a timeline one.
pub const ANNOTATION_SPACE_VERSION: u32 = 2;

/// The height mask amounts are expressed relative to, matching
/// `MASK_EFFECT_BASE_HEIGHT` in the renderer.
const MASK_AMOUNT_BASE_HEIGHT: f64 = 1080.0;

/// Version 1 stores an explicit [`MaskMode`] rather than a category plus a
/// magic offset. See [`ProjectConfiguration::mask_model_version`].
pub const MASK_MODEL_VERSION: u32 = 1;

/// The offset legacy configs added to `pixelation` to mean "this is a blur".
/// Only the migration knows this number; nothing else may.
const LEGACY_BLUR_ENCODING_OFFSET: f64 = 1000.0;

fn camera_config_needs_migration(value: &Value) -> bool {
    value
        .get("camera")
        .and_then(|camera| camera.as_object())
        .is_some_and(|camera| {
            camera.contains_key("zoom_size")
                || camera.contains_key("advanced_shadow")
                || camera.contains_key("rounding_type")
        })
}

impl Default for ProjectConfiguration {
    fn default() -> Self {
        Self {
            aspect_ratio: Default::default(),
            background: Default::default(),
            camera: Default::default(),
            audio: Default::default(),
            cursor: Default::default(),
            hotkeys: Default::default(),
            timeline: Default::default(),
            captions: Default::default(),
            keyboard: Default::default(),
            clips: Default::default(),
            annotations: Default::default(),
            hidden_text_segments: Default::default(),
            screen_motion_blur: Self::default_screen_motion_blur(),
            screen_movement_spring: Default::default(),
            text_size_version: TEXT_SIZE_VERSION,
            annotation_space_version: ANNOTATION_SPACE_VERSION,
            mask_model_version: MASK_MODEL_VERSION,
        }
    }
}

impl ProjectConfiguration {
    fn default_screen_motion_blur() -> f32 {
        // Screen Studio's default blur amount is 1.0; with length-based blur
        // semantics (amount scales the smear length, output fully blurred)
        // 1.0 reproduces its out-of-the-box look.
        1.0
    }

    pub fn validate(&self) -> Result<(), AnnotationValidationError> {
        for annotation in &self.annotations {
            annotation.validate()?;
        }

        Ok(())
    }

    /// Convert legacy pixel annotation geometry to normalized 0..1.
    ///
    /// Not part of [`Self::load`], which has no way to know the capture
    /// dimensions — and the maths needs them. Call this from the one place
    /// that has both, right after loading.
    ///
    /// Legacy geometry is in **rendered output frame** pixels, which include
    /// the padding inset — not capture pixels. The conversion therefore
    /// subtracts the content offset before dividing, and the frame it is
    /// measured against is reconstructed from the config exactly as the
    /// preview renderer does it: `output_size` at a `resolution_base` of
    /// `base_size`, which is what the screenshot editor renders at.
    ///
    /// Returns `true` if the config changed and should be written back.
    /// Returns `false` — leaving the version at 0 so a later run can retry —
    /// when the frame cannot be resolved. Guessing a divisor here would move
    /// every annotation in the project silently, which is strictly worse than
    /// deferring.
    pub fn migrate_annotation_space(&mut self, capture_size: XY<u32>) -> bool {
        if self.annotation_space_version >= ANNOTATION_SPACE_VERSION {
            return false;
        }

        if capture_size.x == 0 || capture_size.y == 0 {
            return false;
        }

        // Nothing to convert: stamp the version so this never runs again.
        if self.annotations.is_empty() {
            self.annotation_space_version = ANNOTATION_SPACE_VERSION;
            return true;
        }

        let (base_w, base_h) = frame_layout::base_size(self, capture_size);
        let resolution_base = XY::new(base_w, base_h);
        // `None` means a decorative frame is active and the content rect
        // depends on chrome insets this crate does not carry.
        let Some((offset, size)) = frame_layout::content_rect(self, capture_size, resolution_base)
        else {
            return false;
        };

        if !(size.x > 0.0) || !(size.y > 0.0) {
            return false;
        }

        let from_version = self.annotation_space_version;

        // The frame the legacy pixels were authored against — mask strength is
        // relative to its full height, not to the capture inside it.
        let (_, frame_height) = frame_layout::output_size(self, capture_size, resolution_base);
        let frame_height = f64::from(frame_height.max(1));

        for annotation in &mut self.annotations {
            if from_version < 1 {
                annotation.x = (annotation.x - offset.x) / size.x;
                annotation.y = (annotation.y - offset.y) / size.y;
                // Extents are differences, so they scale without the origin
                // shift — and keep their sign, which a backwards-drawn shape
                // relies on.
                annotation.width /= size.x;
                annotation.height /= size.y;
                // A stroke normalized against both axes would change thickness
                // whenever the aspect ratio changed. One axis only; height, to
                // match the 1080p-relative convention `TextSegment::font_size`
                // already uses.
                annotation.stroke_width /= size.y;
                // `arrow_head_size` is measured in the same pixels as the
                // stroke and must travel with it, or curved arrows re-shape on
                // load.
                if let Some(head) = annotation.arrow_head_size.as_mut() {
                    *head /= size.y;
                }
            }

            if from_version < 2
                && annotation.annotation_type == AnnotationType::Mask
                && let Some(amount) = annotation.mask_amount.as_mut()
            {
                // Frame pixels → 1080p-relative, the inverse of the renderer's
                // `scaled_effect_size`. At a 1080-tall frame this is identity,
                // which is why the two units were never noticed to differ.
                *amount = *amount * MASK_AMOUNT_BASE_HEIGHT / frame_height;
            }
        }

        self.annotation_space_version = ANNOTATION_SPACE_VERSION;
        true
    }

    /// Convert legacy `maskType` + `pixelation` segments to an explicit
    /// [`MaskMode`] and `amount`.
    ///
    /// The legacy values cannot be recovered from the parsed struct — the
    /// fields no longer exist on it — so this reads them out of the raw JSON,
    /// the same way the camera migration does. Segments are matched by index,
    /// which is safe because serde preserved their order.
    ///
    /// Conversion goes through the *old reader's* semantics rather than the
    /// raw stored number, so a migrated project renders exactly as it did
    /// before. That matters more than it sounds: the video editor's pixelation
    /// slider wrote 0..1 into a field the renderer clamped to 4..80, so most
    /// real configs hold a value that rendered as the minimum. Migrating the
    /// stored number literally would change how they look.
    ///
    /// Returns `true` if anything changed and the file should be rewritten.
    fn migrate_mask_model(&mut self, raw: Option<&Value>) -> bool {
        if self.mask_model_version >= MASK_MODEL_VERSION {
            return false;
        }

        let contract = mask_effect_contract();
        // The old `normalize_effect_amount`, reproduced exactly.
        let normalize = |amount: f64| -> f64 {
            if amount <= 0.0 {
                contract.default_amount
            } else {
                amount.clamp(contract.min_amount, contract.max_amount)
            }
        };

        let legacy = raw
            .and_then(|value| value.get("timeline"))
            .and_then(|timeline| timeline.get("maskSegments"))
            .and_then(|segments| segments.as_array());

        if let Some(timeline) = self.timeline.as_mut() {
            for (index, segment) in timeline.mask_segments.iter_mut().enumerate() {
                let entry = legacy.and_then(|items| items.get(index));

                let legacy_kind = entry
                    .and_then(|item| item.get("maskType"))
                    .and_then(|kind| kind.as_str());
                let legacy_amount = entry
                    .and_then(|item| item.get("pixelation"))
                    .and_then(|amount| amount.as_f64());

                match legacy_kind {
                    Some("highlight") => {
                        segment.mode = MaskMode::Spotlight;
                        // Spotlight ignores `amount`; leave the default rather
                        // than carrying a meaningless number forward.
                    }
                    // `sensitive`, or absent (the field's own default).
                    _ => {
                        let stored = legacy_amount
                            .filter(|amount| amount.is_finite())
                            .unwrap_or(contract.default_amount);
                        if stored >= LEGACY_BLUR_ENCODING_OFFSET {
                            segment.mode = MaskMode::Blur;
                            segment.amount = normalize(stored - LEGACY_BLUR_ENCODING_OFFSET);
                        } else {
                            segment.mode = MaskMode::Pixelate;
                            segment.amount = normalize(stored);
                        }
                    }
                }
            }
        }

        // Annotations carried their own two-variant `maskType`, whose values
        // are already valid `MaskMode` variants — a serde alias on
        // `mask_mode` reads them directly, so there is nothing to convert
        // here. Only a mask that never had the field needs filling in, and it
        // gets the same default the frontend's `?? \"blur\"` already applied.
        // (The *amount* is a different story: its legacy units were frame
        // pixels, so it needs the frame size and is converted in
        // `migrate_annotation_space`.)
        for annotation in &mut self.annotations {
            if annotation.annotation_type == AnnotationType::Mask && annotation.mask_mode.is_none()
            {
                annotation.mask_mode = Some(MaskMode::Blur);
            }
        }

        self.mask_model_version = MASK_MODEL_VERSION;
        true
    }

    pub fn load(project_path: impl AsRef<Path>) -> Result<Self, std::io::Error> {
        let project_path = project_path.as_ref();
        let config_path = project_path.join("project-config.json");
        let config_str = std::fs::read_to_string(&config_path)?;
        let parsed_value = serde_json::from_str::<Value>(&config_str).ok();
        let missing_screen_motion_blur = parsed_value.as_ref().is_some_and(|value| {
            value
                .as_object()
                .is_some_and(|object| !object.contains_key("screenMotionBlur"))
        });
        let needs_camera_migration = parsed_value
            .as_ref()
            .map(camera_config_needs_migration)
            .unwrap_or(false);
        let mut config: Self = serde_json::from_str(&config_str)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        let cursor_motion_blur = config.cursor.motion_blur.clamp(0.0, 1.0);
        let screen_motion_blur = config.screen_motion_blur.clamp(0.0, 1.0);
        let needs_motion_blur_clamp = (config.cursor.motion_blur - cursor_motion_blur).abs()
            > f32::EPSILON
            || (config.screen_motion_blur - screen_motion_blur).abs() > f32::EPSILON;
        let needs_screen_motion_blur_migration = missing_screen_motion_blur
            || (screen_motion_blur - cursor_motion_blur).abs() > f32::EPSILON;
        config.cursor.motion_blur = cursor_motion_blur;
        if needs_screen_motion_blur_migration {
            config.screen_motion_blur = config.cursor.motion_blur;
        } else {
            config.screen_motion_blur = screen_motion_blur;
        }

        // Legacy text configs coupled glyph size to the box: the renderer
        // multiplied font_size by size.y / 0.2. Bake that factor into
        // font_size so the new decoupled law renders them identically.
        let mut needs_text_size_migration = false;
        if config.text_size_version == 0 {
            if let Some(timeline) = config.timeline.as_mut() {
                for segment in &mut timeline.text_segments {
                    let scale = (segment.size.y / 0.2).clamp(0.25, 4.0) as f32;
                    let migrated = (segment.font_size * scale).clamp(1.0, 480.0);
                    if (migrated - segment.font_size).abs() > f32::EPSILON {
                        segment.font_size = migrated;
                        needs_text_size_migration = true;
                    }
                }
            }
            config.text_size_version = TEXT_SIZE_VERSION;
        }

        let needs_mask_model_migration = config.migrate_mask_model(parsed_value.as_ref());

        config
            .validate()
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;

        if needs_camera_migration
            || needs_mask_model_migration
            || needs_motion_blur_clamp
            || needs_screen_motion_blur_migration
            || needs_text_size_migration
        {
            match config.write(project_path) {
                Ok(_) => {
                    eprintln!("Updated project-config.json migrated settings");
                }
                Err(error) => {
                    eprintln!("Failed to migrate project-config.json: {error}");
                }
            }
        }

        Ok(config)
    }

    pub fn write(&self, project_path: impl AsRef<Path>) -> Result<(), std::io::Error> {
        self.validate()
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;

        let project_path = project_path.as_ref();
        let config_path = project_path.join("project-config.json");
        let temp_path =
            project_path.join(format!(".project-config-{}.json.tmp", uuid::Uuid::new_v4()));

        std::fs::write(&temp_path, serde_json::to_string_pretty(self)?)?;

        if let Err(error) = std::fs::rename(&temp_path, &config_path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(error);
        }

        Ok(())
    }

    pub fn get_segment_time(&self, frame_time: f64) -> Option<(f64, &TimelineSegment)> {
        self.timeline
            .as_ref()
            .and_then(|t| t.get_segment_time(frame_time))
    }
}

pub const SLOW_SMOOTHING_SAMPLES: usize = 24;
pub const REGULAR_SMOOTHING_SAMPLES: usize = 16;
pub const FAST_SMOOTHING_SAMPLES: usize = 10;

pub const SLOW_VELOCITY_THRESHOLD: f64 = 0.003;
pub const REGULAR_VELOCITY_THRESHOLD: f64 = 0.008;
pub const FAST_VELOCITY_THRESHOLD: f64 = 0.015;

#[cfg(test)]
mod tests {
    use super::*;

    fn timeline_with_transitions(transitions: Vec<ClipTransition>) -> TimelineConfiguration {
        TimelineConfiguration {
            segments: vec![
                TimelineSegment {
                    recording_clip: 0,
                    timescale: 1.0,
                    start: 0.0,
                    end: 4.0,
                    name: None,
                    speed_audio_mode: None,
                },
                TimelineSegment {
                    recording_clip: 1,
                    timescale: 1.0,
                    start: 10.0,
                    end: 16.0,
                    name: None,
                    speed_audio_mode: None,
                },
            ],
            transitions,
            zoom_segments: Vec::new(),
            scene_segments: Vec::new(),
            mask_segments: Vec::new(),
            text_segments: Vec::new(),
            caption_segments: Vec::new(),
            keyboard_segments: Vec::new(),
            audio_segments: Vec::new(),
        }
    }

    #[test]
    fn timeline_without_transitions_keeps_legacy_mapping() {
        let timeline = timeline_with_transitions(Vec::new());

        assert_eq!(timeline.duration(), 10.0);
        let (time, segment) = timeline.get_segment_time(4.5).unwrap();
        assert_eq!(time, 10.5);
        assert_eq!(segment.recording_clip, 1);
        assert!(matches!(
            timeline.get_frame_mapping(4.5),
            Some(TimelineFrameMapping::Single { source, output_end: 10.0 })
                if source.segment_index == 1 && source.source_time == 10.5
        ));
        assert!(
            serde_json::to_value(&timeline)
                .unwrap()
                .get("transitions")
                .is_none()
        );
    }

    #[test]
    fn timeline_maps_both_sources_inside_transition() {
        let timeline = timeline_with_transitions(vec![ClipTransition {
            segment_index: 1,
            kind: ClipTransitionType::CrossFade,
            duration: 1.0,
        }]);

        assert_eq!(timeline.duration(), 9.0);
        assert_eq!(
            serde_json::to_value(&timeline).unwrap()["transitions"][0]["type"],
            "cross-fade"
        );
        assert!(matches!(
            timeline.get_frame_mapping(3.5),
            Some(TimelineFrameMapping::Transition {
                outgoing,
                incoming,
                kind: ClipTransitionType::CrossFade,
                progress,
                duration: 1.0,
                output_end: 4.0,
            }) if outgoing.segment_index == 0
                && outgoing.source_time == 3.5
                && incoming.segment_index == 1
                && incoming.source_time == 10.5
                && progress == 0.5
        ));
    }

    #[test]
    fn timeline_segment_speed_audio_mode_is_backward_compatible() {
        let legacy: TimelineSegment = serde_json::from_value(serde_json::json!({
            "recordingSegment": 0,
            "timescale": 2.0,
            "start": 0.0,
            "end": 4.0
        }))
        .unwrap();
        assert_eq!(legacy.speed_audio_mode, None);

        let serialized = serde_json::to_value(&legacy).unwrap();
        assert!(serialized.get("speedAudioMode").is_none());

        let maintain_pitch: TimelineSegment = serde_json::from_value(serde_json::json!({
            "recordingSegment": 0,
            "timescale": 2.0,
            "start": 0.0,
            "end": 4.0,
            "speedAudioMode": "maintainPitch"
        }))
        .unwrap();
        assert_eq!(
            maintain_pitch.speed_audio_mode,
            Some(ClipSpeedAudioMode::MaintainPitch)
        );
    }

    #[test]
    fn timeline_clamps_transition_to_half_the_shorter_clip() {
        let timeline = timeline_with_transitions(vec![ClipTransition {
            segment_index: 1,
            kind: ClipTransitionType::FadeThroughBlack,
            duration: 9.0,
        }]);

        let transition = timeline.effective_transition(1).unwrap();
        assert_eq!(transition.duration, 2.0);
        assert_eq!(timeline.duration(), 8.0);
    }

    #[test]
    fn legacy_timeline_json_defaults_to_no_transitions() {
        let timeline: TimelineConfiguration = serde_json::from_value(serde_json::json!({
            "segments": [
                { "recordingSegment": 0, "timescale": 1.0, "start": 0.0, "end": 4.0 }
            ],
            "zoomSegments": []
        }))
        .unwrap();

        assert!(timeline.transitions.is_empty());
        assert_eq!(timeline.duration(), 4.0);
    }

    #[test]
    fn transition_json_is_normalized_by_segment_index() {
        let timeline: TimelineConfiguration = serde_json::from_value(serde_json::json!({
            "segments": [
                { "recordingSegment": 0, "timescale": 1.0, "start": 0.0, "end": 4.0 },
                { "recordingSegment": 0, "timescale": 1.0, "start": 4.0, "end": 8.0 },
                { "recordingSegment": 0, "timescale": 1.0, "start": 8.0, "end": 12.0 }
            ],
            "transitions": [
                { "segmentIndex": 2, "type": "cross-fade", "duration": 0.5 },
                { "segmentIndex": 1, "type": "cross-fade", "duration": 0.25 },
                { "segmentIndex": 2, "type": "fade-through-black", "duration": 1.0 }
            ],
            "zoomSegments": []
        }))
        .unwrap();

        assert_eq!(timeline.transitions.len(), 2);
        assert_eq!(timeline.transitions[0].segment_index, 1);
        assert_eq!(timeline.transitions[1].segment_index, 2);
        assert_eq!(
            timeline.transitions[1].kind,
            ClipTransitionType::FadeThroughBlack
        );
    }

    fn write_config_with_motion_blur_values(
        project_path: &std::path::Path,
        cursor_motion_blur: f64,
        screen_motion_blur: Option<f64>,
    ) {
        let mut value = serde_json::to_value(ProjectConfiguration::default()).unwrap();
        let object = value.as_object_mut().unwrap();
        match screen_motion_blur {
            Some(value) => {
                object.insert("screenMotionBlur".to_string(), Value::from(value));
            }
            None => {
                object.remove("screenMotionBlur");
            }
        }
        object
            .get_mut("cursor")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("motionBlur".to_string(), Value::from(cursor_motion_blur));

        std::fs::write(
            project_path.join("project-config.json"),
            serde_json::to_string(&value).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn default_motion_blur_is_full() {
        // 1.0 matches Screen Studio's default amount under length-based blur
        // semantics; the two fields must agree because the editor drives them
        // with one slider and load() re-couples them.
        let config = ProjectConfiguration::default();

        assert_eq!(config.cursor.motion_blur, 1.0);
        assert_eq!(config.screen_motion_blur, 1.0);
    }

    #[test]
    fn mask_without_an_amount_uses_a_visible_safe_default() {
        let segment: MaskSegment = serde_json::from_value(serde_json::json!({
            "start": 0.0,
            "end": 1.0,
            "center": { "x": 0.5, "y": 0.5 },
            "size": { "x": 0.25, "y": 0.25 }
        }))
        .unwrap();

        assert_eq!(segment.amount, 16.0);
    }

    #[test]
    fn load_uses_cursor_motion_blur_when_screen_motion_blur_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        write_config_with_motion_blur_values(dir.path(), 0.0, None);

        let config = ProjectConfiguration::load(dir.path()).unwrap();

        assert_eq!(config.cursor.motion_blur, 0.0);
        assert_eq!(config.screen_motion_blur, 0.0);
    }

    #[test]
    fn load_uses_cursor_motion_blur_when_screen_motion_blur_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        write_config_with_motion_blur_values(dir.path(), 0.0, Some(1.0));

        let config = ProjectConfiguration::load(dir.path()).unwrap();

        assert_eq!(config.cursor.motion_blur, 0.0);
        assert_eq!(config.screen_motion_blur, 0.0);
    }

    #[test]
    fn load_caps_motion_blur_to_slider_range() {
        let dir = tempfile::tempdir().unwrap();
        write_config_with_motion_blur_values(dir.path(), 2.0, Some(2.0));

        let config = ProjectConfiguration::load(dir.path()).unwrap();

        assert_eq!(config.cursor.motion_blur, 1.0);
        assert_eq!(config.screen_motion_blur, 1.0);
    }

    #[test]
    fn load_without_manual_positions_defaults_to_none() {
        let dir = tempfile::tempdir().unwrap();

        let mut value = serde_json::to_value(ProjectConfiguration::default()).unwrap();
        let object = value.as_object_mut().unwrap();
        object
            .get_mut("camera")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove("manualPosition");
        object
            .get_mut("background")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove("displayPosition");
        std::fs::write(
            dir.path().join("project-config.json"),
            serde_json::to_string(&value).unwrap(),
        )
        .unwrap();

        let config = ProjectConfiguration::load(dir.path()).unwrap();

        assert!(config.camera.manual_position.is_none());
        assert!(config.background.display_position.is_none());
    }

    #[test]
    fn manual_positions_round_trip() {
        let dir = tempfile::tempdir().unwrap();

        let mut config = ProjectConfiguration::default();
        config.camera.manual_position = Some(XY::new(0.25, 0.75));
        config.background.display_position = Some(XY::new(0.5, 0.4));
        std::fs::write(
            dir.path().join("project-config.json"),
            serde_json::to_string(&config).unwrap(),
        )
        .unwrap();

        let loaded = ProjectConfiguration::load(dir.path()).unwrap();

        assert_eq!(loaded.camera.manual_position, Some(XY::new(0.25, 0.75)));
        assert_eq!(loaded.background.display_position, Some(XY::new(0.5, 0.4)));
    }

    fn write_config_with_text_segment(
        project_path: &std::path::Path,
        font_size: f32,
        size_y: f64,
        text_size_version: Option<u32>,
    ) {
        let config = ProjectConfiguration {
            timeline: Some(TimelineConfiguration {
                segments: Vec::new(),
                transitions: Vec::new(),
                zoom_segments: Vec::new(),
                scene_segments: Vec::new(),
                mask_segments: Vec::new(),
                text_segments: vec![TextSegment {
                    start: 0.0,
                    end: 1.0,
                    track: 0,
                    enabled: true,
                    content: "Text".to_string(),
                    center: XY::new(0.5, 0.5),
                    size: XY::new(0.35, size_y),
                    font_family: "sans-serif".to_string(),
                    font_size,
                    font_weight: 700.0,
                    italic: false,
                    color: "#ffffff".to_string(),
                    fade_duration: 0.15,
                }],
                caption_segments: Vec::new(),
                keyboard_segments: Vec::new(),
                audio_segments: Vec::new(),
            }),
            ..Default::default()
        };

        let mut value = serde_json::to_value(&config).unwrap();
        let object = value.as_object_mut().unwrap();
        match text_size_version {
            Some(version) => {
                object.insert("textSizeVersion".to_string(), Value::from(version));
            }
            None => {
                object.remove("textSizeVersion");
            }
        }
        std::fs::write(
            project_path.join("project-config.json"),
            serde_json::to_string(&value).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn legacy_text_segment_bakes_box_scale_into_font_size() {
        let dir = tempfile::tempdir().unwrap();
        // Legacy renderer drew this at 96 * (0.4 / 0.2) = 2x glyph scale.
        write_config_with_text_segment(dir.path(), 96.0, 0.4, None);

        let config = ProjectConfiguration::load(dir.path()).unwrap();

        let segment = &config.timeline.as_ref().unwrap().text_segments[0];
        assert_eq!(segment.font_size, 192.0);
        assert_eq!(config.text_size_version, TEXT_SIZE_VERSION);

        // The migration must persist so it never runs twice.
        let reloaded = ProjectConfiguration::load(dir.path()).unwrap();
        let segment = &reloaded.timeline.as_ref().unwrap().text_segments[0];
        assert_eq!(segment.font_size, 192.0);
    }

    #[test]
    fn legacy_text_segment_at_base_height_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        write_config_with_text_segment(dir.path(), 48.0, 0.2, None);

        let config = ProjectConfiguration::load(dir.path()).unwrap();

        let segment = &config.timeline.as_ref().unwrap().text_segments[0];
        assert_eq!(segment.font_size, 48.0);
        assert_eq!(config.text_size_version, TEXT_SIZE_VERSION);
    }

    #[test]
    fn current_text_config_is_not_rebaked() {
        let dir = tempfile::tempdir().unwrap();
        write_config_with_text_segment(dir.path(), 96.0, 0.4, Some(TEXT_SIZE_VERSION));

        let config = ProjectConfiguration::load(dir.path()).unwrap();

        let segment = &config.timeline.as_ref().unwrap().text_segments[0];
        assert_eq!(segment.font_size, 96.0);
    }

    #[test]
    fn legacy_config_without_motion_rework_fields_resolves_defaults() {
        let dir = tempfile::tempdir().unwrap();

        // Hand-written pre-rework project-config.json: zoom segments carry
        // only start/end/amount/mode (no glideDirection / glideSpeed /
        // instantAnimation / edgeSnapRatio), the cursor uses the old spring
        // triple, and the camera uses the position enum.
        let legacy_json = r#"{
            "camera": {
                "hide": false,
                "mirror": false,
                "position": { "x": "left", "y": "top" },
                "size": 25.0
            },
            "cursor": {
                "animationStyle": "custom",
                "tension": 120.0,
                "mass": 2.0,
                "friction": 32.0
            },
            "timeline": {
                "segments": [
                    { "recordingSegment": 0, "timescale": 1.0, "start": 0.0, "end": 10.0 }
                ],
                "zoomSegments": [
                    { "start": 1.0, "end": 3.0, "amount": 2.0, "mode": "auto" },
                    {
                        "start": 5.0,
                        "end": 7.0,
                        "amount": 1.5,
                        "mode": { "manual": { "x": 0.25, "y": 0.75 } }
                    }
                ]
            }
        }"#;
        std::fs::write(dir.path().join("project-config.json"), legacy_json).unwrap();

        let config = ProjectConfiguration::load(dir.path()).unwrap();

        let timeline = config.timeline.as_ref().expect("timeline should load");
        assert_eq!(timeline.zoom_segments.len(), 2);
        for segment in &timeline.zoom_segments {
            assert_eq!(segment.glide_direction, GlideDirection::None);
            assert_eq!(segment.glide_speed, 0.5);
            assert!(!segment.instant_animation);
            assert_eq!(segment.edge_snap_ratio, 0.25);
        }
        assert!(matches!(timeline.zoom_segments[0].mode, ZoomMode::Auto));
        assert!(matches!(
            timeline.zoom_segments[1].mode,
            ZoomMode::Manual { x, y }
                if (x - 0.25).abs() < f32::EPSILON && (y - 0.75).abs() < f32::EPSILON
        ));

        // The old cursor spring triple survives untouched.
        assert_eq!(config.cursor.animation_style, CursorAnimationStyle::Custom);
        assert_eq!(config.cursor.tension, 120.0);
        assert_eq!(config.cursor.mass, 2.0);
        assert_eq!(config.cursor.friction, 32.0);

        // The camera position enum still parses.
        assert!(matches!(config.camera.position.x, CameraXPosition::Left));
        assert!(matches!(config.camera.position.y, CameraYPosition::Top));

        // Config written back by the load migration must round-trip with the
        // resolved defaults intact.
        let reloaded = ProjectConfiguration::load(dir.path()).unwrap();
        let reloaded_timeline = reloaded.timeline.as_ref().unwrap();
        assert_eq!(reloaded_timeline.zoom_segments.len(), 2);
        assert_eq!(reloaded_timeline.zoom_segments[0].glide_speed, 0.5);
        assert_eq!(reloaded_timeline.zoom_segments[0].edge_snap_ratio, 0.25);
        assert!(!reloaded_timeline.zoom_segments[0].instant_animation);

        // The screen movement spring (which drives the new zoom timeline)
        // resolves to its default for legacy configs.
        let spring = config.screen_movement_spring;
        let default_spring = ScreenMovementSpring::default();
        assert_eq!(spring.stiffness, default_spring.stiffness);
        assert_eq!(spring.damping, default_spring.damping);
        assert_eq!(spring.mass, default_spring.mass);
    }
}

#[cfg(test)]
mod annotation_space_tests {
    use super::*;

    fn annotation(x: f64, y: f64, width: f64, height: f64) -> Annotation {
        Annotation {
            id: "a".to_string(),
            annotation_type: AnnotationType::Rectangle,
            x,
            y,
            width,
            height,
            stroke_color: "#000".to_string(),
            stroke_width: 4.0,
            fill_color: "transparent".to_string(),
            opacity: 1.0,
            rotation: 0.0,
            text: None,
            mask_mode: None,
            mask_amount: None,
            mask_shape: None,
            mask_feather: None,
            mask_darkness: None,
            mask_corner_radius: None,
            focus: None,
            arrow_curve: None,
            arrow_bend: None,
            arrow_start_head: None,
            arrow_end_head: None,
            arrow_head_size: None,
            line_style: None,
            arrow_taper: None,
        }
    }

    fn config_with(padding: f64, annotations: Vec<Annotation>) -> ProjectConfiguration {
        let mut config = ProjectConfiguration {
            annotation_space_version: 0,
            annotations,
            ..Default::default()
        };
        config.background.padding = padding;
        config
    }

    /// The content rect is what the renderer would place the capture at, so a
    /// migrated annotation must resolve back to the pixels it started as.
    #[test]
    fn migration_round_trips_through_the_content_rect() {
        let capture = XY::new(1920u32, 1080u32);
        let mut config = config_with(30.0, vec![annotation(400.0, 300.0, 200.0, 150.0)]);

        let (base_w, base_h) = frame_layout::base_size(&config, capture);
        let (offset, size) =
            frame_layout::content_rect(&config, capture, XY::new(base_w, base_h)).unwrap();

        assert!(config.migrate_annotation_space(capture));
        assert_eq!(config.annotation_space_version, ANNOTATION_SPACE_VERSION);

        let a = &config.annotations[0];
        assert!((a.x * size.x + offset.x - 400.0).abs() < 1e-9);
        assert!((a.y * size.y + offset.y - 300.0).abs() < 1e-9);
        assert!((a.width * size.x - 200.0).abs() < 1e-9);
        assert!((a.height * size.y - 150.0).abs() < 1e-9);
    }

    /// The bug this whole plan exists to fix: the same normalized annotation
    /// must land on the same part of the capture after the padding changes,
    /// where a pixel-stored one would have stayed put and drifted off it.
    #[test]
    fn normalized_geometry_tracks_the_capture_across_a_padding_change() {
        let capture = XY::new(1920u32, 1080u32);
        let mut config = config_with(0.0, vec![annotation(960.0, 540.0, 100.0, 100.0)]);
        assert!(config.migrate_annotation_space(capture));
        let normalized = config.annotations[0].x;

        // Same document, more padding: the capture shrinks inside a bigger frame.
        config.background.padding = 60.0;
        let (base_w, base_h) = frame_layout::base_size(&config, capture);
        let (offset, size) =
            frame_layout::content_rect(&config, capture, XY::new(base_w, base_h)).unwrap();

        let resolved = normalized * size.x + offset.x;
        // It moved, because the capture moved — which is the point.
        assert!(
            (resolved - 960.0).abs() > 1.0,
            "expected the resolved position to follow the capture, got {resolved}"
        );
        // And it is still at the same fraction across the capture.
        assert!(((resolved - offset.x) / size.x - normalized).abs() < 1e-9);
    }

    /// Stroke width is normalized against one axis, so a change of aspect
    /// ratio cannot make a stroke thicker in one direction than the other.
    #[test]
    fn stroke_width_normalizes_against_height_only() {
        let capture = XY::new(1920u32, 1080u32);
        let mut config = config_with(0.0, vec![annotation(0.0, 0.0, 10.0, 10.0)]);
        let (base_w, base_h) = frame_layout::base_size(&config, capture);
        let (_, size) =
            frame_layout::content_rect(&config, capture, XY::new(base_w, base_h)).unwrap();

        assert!(config.migrate_annotation_space(capture));
        assert!((config.annotations[0].stroke_width - 4.0 / size.y).abs() < 1e-12);
    }

    #[test]
    fn migration_is_idempotent() {
        let capture = XY::new(1920u32, 1080u32);
        let mut config = config_with(20.0, vec![annotation(100.0, 100.0, 50.0, 50.0)]);
        assert!(config.migrate_annotation_space(capture));
        let after_first = config.annotations[0].x;
        // A second run must be a no-op, not a second divide.
        assert!(!config.migrate_annotation_space(capture));
        assert_eq!(config.annotations[0].x, after_first);
    }

    #[test]
    fn empty_annotations_still_stamp_the_version() {
        let capture = XY::new(1920u32, 1080u32);
        let mut config = config_with(0.0, vec![]);
        assert!(config.migrate_annotation_space(capture));
        assert_eq!(config.annotation_space_version, ANNOTATION_SPACE_VERSION);
    }

    /// An unresolvable capture size must defer rather than guess a divisor.
    #[test]
    fn unresolvable_capture_size_defers() {
        let mut config = config_with(0.0, vec![annotation(10.0, 10.0, 5.0, 5.0)]);
        assert!(!config.migrate_annotation_space(XY::new(0u32, 0u32)));
        assert_eq!(config.annotation_space_version, 0);
        assert_eq!(config.annotations[0].x, 10.0);
    }

    /// A decorative frame insets the content by chrome this crate cannot
    /// measure, so the migration must defer instead of using the bare rect.
    #[test]
    fn decorative_frame_defers() {
        let capture = XY::new(1920u32, 1080u32);
        let mut config = config_with(0.0, vec![annotation(10.0, 10.0, 5.0, 5.0)]);
        config.background.frame = Some(FrameConfiguration {
            style: FrameStyle::MacOS,
            ..Default::default()
        });
        assert!(!config.migrate_annotation_space(capture));
        assert_eq!(config.annotation_space_version, 0);
        assert_eq!(config.annotations[0].x, 10.0);
    }

    /// Backwards-drawn shapes carry negative extents until they commit; the
    /// migration must not silently flip them.
    #[test]
    fn negative_extents_keep_their_sign() {
        let capture = XY::new(1920u32, 1080u32);
        let mut config = config_with(0.0, vec![annotation(500.0, 500.0, -200.0, -100.0)]);
        assert!(config.migrate_annotation_space(capture));
        assert!(config.annotations[0].width < 0.0);
        assert!(config.annotations[0].height < 0.0);
    }
}

#[cfg(test)]
mod mask_model_tests {
    use super::*;

    fn write_legacy_config(dir: &Path, segments: serde_json::Value) {
        let config = serde_json::json!({
            "aspectRatio": null,
            "background": {},
            "camera": {},
            "audio": {},
            "cursor": {},
            "hotkeys": {},
            "timeline": { "segments": [], "zoomSegments": [], "maskSegments": segments },
            "clips": [],
            "annotations": []
        });
        std::fs::write(
            dir.join("project-config.json"),
            serde_json::to_string_pretty(&config).unwrap(),
        )
        .unwrap();
    }

    fn legacy_segment(mask_type: &str, pixelation: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "start": 0.0,
            "end": 1.0,
            "maskType": mask_type,
            "pixelation": pixelation,
            "center": { "x": 0.5, "y": 0.5 },
            "size": { "x": 0.25, "y": 0.25 }
        })
    }

    /// The plan's headline case: the `+1000` discriminant becomes an explicit
    /// blur at the amount that was hidden inside it.
    #[test]
    fn blur_encoding_becomes_an_explicit_blur() {
        let dir = tempfile::tempdir().unwrap();
        write_legacy_config(
            dir.path(),
            serde_json::json!([legacy_segment("sensitive", serde_json::json!(1016.0))]),
        );

        let config = ProjectConfiguration::load(dir.path()).unwrap();
        let segment = &config.timeline.as_ref().unwrap().mask_segments[0];

        assert_eq!(segment.mode, MaskMode::Blur);
        assert_eq!(segment.amount, 16.0);
        assert_eq!(config.mask_model_version, MASK_MODEL_VERSION);
    }

    #[test]
    fn a_plain_amount_becomes_a_pixelate() {
        let dir = tempfile::tempdir().unwrap();
        write_legacy_config(
            dir.path(),
            serde_json::json!([legacy_segment("sensitive", serde_json::json!(24.0))]),
        );

        let config = ProjectConfiguration::load(dir.path()).unwrap();
        let segment = &config.timeline.as_ref().unwrap().mask_segments[0];

        assert_eq!(segment.mode, MaskMode::Pixelate);
        assert_eq!(segment.amount, 24.0);
    }

    #[test]
    fn highlight_becomes_spotlight() {
        let dir = tempfile::tempdir().unwrap();
        write_legacy_config(
            dir.path(),
            serde_json::json!([legacy_segment("highlight", serde_json::json!(0.0))]),
        );

        let config = ProjectConfiguration::load(dir.path()).unwrap();
        assert_eq!(
            config.timeline.as_ref().unwrap().mask_segments[0].mode,
            MaskMode::Spotlight
        );
    }

    /// The video editor's slider wrote 0..1 into a field the renderer clamped
    /// to 4..80, so almost every real config holds a value that rendered as
    /// the minimum. Migrating the stored number literally would change how
    /// those projects look; going through the old reader's semantics keeps
    /// them identical.
    #[test]
    fn slider_range_values_migrate_to_what_they_actually_rendered_as() {
        let dir = tempfile::tempdir().unwrap();
        write_legacy_config(
            dir.path(),
            serde_json::json!([legacy_segment("sensitive", serde_json::json!(0.35))]),
        );

        let config = ProjectConfiguration::load(dir.path()).unwrap();
        let segment = &config.timeline.as_ref().unwrap().mask_segments[0];

        assert_eq!(segment.mode, MaskMode::Pixelate);
        assert_eq!(segment.amount, 4.0, "0.35 clamped to the contract minimum");
    }

    #[test]
    fn migration_persists_and_does_not_run_twice() {
        let dir = tempfile::tempdir().unwrap();
        write_legacy_config(
            dir.path(),
            serde_json::json!([legacy_segment("sensitive", serde_json::json!(1024.0))]),
        );

        let first = ProjectConfiguration::load(dir.path()).unwrap();
        assert_eq!(
            first.timeline.as_ref().unwrap().mask_segments[0].amount,
            24.0
        );

        // The rewritten file must survive a second load unchanged — a rerun
        // would otherwise re-read a `pixelation` that is no longer there and
        // reset the mode.
        let second = ProjectConfiguration::load(dir.path()).unwrap();
        let segment = &second.timeline.as_ref().unwrap().mask_segments[0];
        assert_eq!(segment.mode, MaskMode::Blur);
        assert_eq!(segment.amount, 24.0);
    }

    /// Only `Redact` and `Spotlight` destroy or avoid the source pixels. The
    /// inspectors key their warning copy off this, so it is worth pinning.
    #[test]
    fn reversibility_is_stated_correctly() {
        assert!(MaskMode::Blur.is_reversible());
        assert!(MaskMode::Pixelate.is_reversible());
        assert!(!MaskMode::Redact.is_reversible());
        assert!(!MaskMode::Spotlight.is_reversible());
    }
}

#[cfg(test)]
mod annotation_mask_tests {
    use super::*;

    fn legacy_mask_annotation(mask_type: &str, mask_level: f64) -> serde_json::Value {
        serde_json::json!({
            "id": "m1",
            "type": "mask",
            "x": 100.0, "y": 100.0, "width": 200.0, "height": 100.0,
            "strokeColor": "#000", "strokeWidth": 2.0,
            "fillColor": "transparent", "opacity": 1.0, "rotation": 0.0,
            "text": null,
            "maskType": mask_type,
            "maskLevel": mask_level
        })
    }

    /// The legacy keys are read straight into the new fields: `maskType`'s
    /// values were already valid `MaskMode` variants, so an alias does the
    /// whole job and no index-matched raw-JSON walk is needed.
    #[test]
    fn legacy_keys_deserialize_through_the_aliases() {
        let annotation: Annotation =
            serde_json::from_value(legacy_mask_annotation("pixelate", 20.0)).unwrap();

        assert_eq!(annotation.mask_mode, Some(MaskMode::Pixelate));
        assert_eq!(annotation.mask_amount, Some(20.0));
    }

    /// Writing must use the new key, or the migration would never settle.
    #[test]
    fn serialization_uses_the_new_key() {
        let annotation: Annotation =
            serde_json::from_value(legacy_mask_annotation("blur", 16.0)).unwrap();
        let written = serde_json::to_value(&annotation).unwrap();

        assert!(written.get("maskAmount").is_some());
        assert!(written.get("maskMode").is_some());
        assert!(written.get("maskLevel").is_none());
        assert!(written.get("maskType").is_none());
    }

    /// Legacy mask strength was in frame pixels; the unified units are
    /// 1080p-relative. At a 1080-tall frame the two coincide, which is exactly
    /// why the mismatch went unnoticed.
    #[test]
    fn mask_amount_converts_from_frame_pixels_to_1080p_relative() {
        let capture = XY::new(1920u32, 1080u32);
        let mut config = ProjectConfiguration {
            annotation_space_version: 0,
            mask_model_version: MASK_MODEL_VERSION,
            annotations: vec![
                serde_json::from_value(legacy_mask_annotation("blur", 16.0)).unwrap(),
            ],
            ..Default::default()
        };

        let (_, frame_height) = frame_layout::output_size(&config, capture, {
            let (w, h) = frame_layout::base_size(&config, capture);
            XY::new(w, h)
        });

        assert!(config.migrate_annotation_space(capture));

        let expected = 16.0 * 1080.0 / f64::from(frame_height);
        let actual = config.annotations[0].mask_amount.unwrap();
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    /// A project already migrated by version 1 must still pick up the units
    /// conversion, and must not have its geometry normalized a second time.
    #[test]
    fn version_one_projects_get_the_units_conversion_only() {
        let capture = XY::new(1920u32, 1080u32);
        let mut annotation: Annotation =
            serde_json::from_value(legacy_mask_annotation("blur", 16.0)).unwrap();
        // Already-normalized geometry, as version 1 left it.
        annotation.x = 0.25;
        annotation.y = 0.25;
        annotation.width = 0.5;
        annotation.height = 0.25;

        let mut config = ProjectConfiguration {
            annotation_space_version: 1,
            mask_model_version: MASK_MODEL_VERSION,
            annotations: vec![annotation],
            ..Default::default()
        };
        // Padding makes the frame taller than the capture, so the units
        // conversion is observable. With no padding the frame is exactly
        // 1080 tall and the two units coincide — which is the whole reason
        // this mismatch went unnoticed.
        config.background.padding = 40.0;

        assert!(config.migrate_annotation_space(capture));

        let migrated = &config.annotations[0];
        assert_eq!(migrated.x, 0.25, "geometry must not be re-normalized");
        assert_eq!(migrated.width, 0.5);
        // The units conversion did run: at a frame taller than 1080 the
        // 1080p-relative amount is smaller than the pixel value it came from.
        let amount = migrated.mask_amount.unwrap();
        assert!(
            amount > 0.0 && amount < 16.0,
            "expected a converted amount below the original 16px, got {amount}"
        );
        assert_eq!(config.annotation_space_version, ANNOTATION_SPACE_VERSION);
    }

    /// A mask that never carried a mode gets the same default the frontend's
    /// `?? "blur"` already applied, rather than failing validation.
    #[test]
    fn a_mask_without_a_mode_defaults_to_blur() {
        let dir = tempfile::tempdir().unwrap();
        let config = serde_json::json!({
            "aspectRatio": null, "background": {}, "camera": {}, "audio": {},
            "cursor": {}, "hotkeys": {}, "timeline": null, "clips": [],
            "annotations": [{
                "id": "m1", "type": "mask",
                "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2,
                "strokeColor": "#000", "strokeWidth": 2.0,
                "fillColor": "transparent", "opacity": 1.0, "rotation": 0.0,
                "text": null, "maskLevel": 16.0
            }]
        });
        std::fs::write(
            dir.path().join("project-config.json"),
            serde_json::to_string_pretty(&config).unwrap(),
        )
        .unwrap();

        let loaded = ProjectConfiguration::load(dir.path()).unwrap();
        assert_eq!(loaded.annotations[0].mask_mode, Some(MaskMode::Blur));
    }

    /// Redact and Spotlight have no strength, so requiring an amount from them
    /// would make the two modes unusable on the screenshot path.
    #[test]
    fn modes_without_a_strength_validate_without_an_amount() {
        for mode in [MaskMode::Redact, MaskMode::Spotlight] {
            let mut annotation: Annotation =
                serde_json::from_value(legacy_mask_annotation("blur", 16.0)).unwrap();
            annotation.mask_mode = Some(mode);
            annotation.mask_amount = None;

            assert!(
                annotation.validate().is_ok(),
                "{mode:?} should validate without an amount"
            );
        }
    }

    #[test]
    fn obscuring_modes_still_require_a_usable_amount() {
        let mut annotation: Annotation =
            serde_json::from_value(legacy_mask_annotation("blur", 16.0)).unwrap();
        annotation.mask_amount = Some(0.0);

        assert!(annotation.validate().is_err());
    }

    /// Mask-only fields must not appear on other annotation types.
    #[test]
    fn mask_payload_is_rejected_on_non_mask_annotations() {
        let mut annotation: Annotation =
            serde_json::from_value(legacy_mask_annotation("blur", 16.0)).unwrap();
        annotation.annotation_type = AnnotationType::Rectangle;

        assert!(annotation.validate().is_err());

        annotation.mask_mode = None;
        annotation.mask_amount = None;
        annotation.mask_feather = Some(0.2);
        assert!(
            annotation.validate().is_err(),
            "the new mask fields must be covered by the exclusivity check too"
        );
    }
}
