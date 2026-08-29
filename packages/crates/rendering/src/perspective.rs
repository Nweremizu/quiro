//! Perspective projection for the composited card.
//!
//! The card is a flat rectangle, so tilting it in 3D and projecting the result
//! is exactly a homography — a 3x3 matrix — and no geometry is needed. That
//! matters, because `composite-video-frame.wgsl` rasterises the card as a
//! fullscreen triangle with a signed distance field rather than a quad. There
//! are no vertices to transform.
//!
//! So the shader goes the other way: for each screen pixel it applies the
//! *inverse* homography to find where that pixel lands on the card plane, then
//! runs the existing SDF, border, UV and motion-blur maths at that point
//! completely unchanged. One substitution at the top of `fs_main` buys
//! perspective for every feature the shader already has.
//!
//! Everything here works in screen pixels, and the returned matrix maps screen
//! pixels back to screen-pixel-shaped card coordinates (card space translated
//! back out to `center`). That is what makes [`IDENTITY`] a true no-op: the
//! video and camera layers send it and their pixels do not move at all.
//!
//! [`fit_scale`] handles the other half of tilting a card: a steep enough
//! angle projects a flat rectangle's footprint to something larger than
//! itself, which can spill past the output frame. Rather than growing the
//! canvas or clipping, the caller shrinks the card around its own centre by
//! whatever [`fit_scale`] returns before tilting it — a no-op whenever the
//! card already fits.

/// Past this the card is edge-on: it projects to a line, occupies almost no
/// pixels, and the homography becomes so ill-conditioned that the inverse
/// blows up long before the determinant reaches zero. Clamping is both the
/// numerically stable choice and the right product behaviour — a tilt slider
/// whose last degree renders nothing is a broken control.
pub const MAX_TILT_DEG: f32 = 85.0;

/// Column-major 3x3 for WGSL. Each `mat3x3<f32>` column occupies 16 bytes in
/// the uniform address space, so every column carries a trailing pad float.
pub type PerspectiveMatrix = [[f32; 4]; 3];

/// Leaves every pixel exactly where it is.
pub const IDENTITY: PerspectiveMatrix = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
];

/// How the card is oriented, in degrees, plus the camera distance that controls
/// how strong the foreshortening is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Perspective {
    /// Rotation about the horizontal axis — the card leaning away or toward.
    pub tilt_x_deg: f32,
    /// Rotation about the vertical axis — the card turning left or right.
    pub tilt_y_deg: f32,
    /// In-plane spin. No foreshortening on its own.
    pub rotate_deg: f32,
    /// Camera distance in pixels, as in CSS `perspective`. Smaller is a wider
    /// lens and a more dramatic convergence; larger flattens toward isometric.
    pub distance_px: f32,
}

impl Default for Perspective {
    fn default() -> Self {
        Self {
            tilt_x_deg: 0.0,
            tilt_y_deg: 0.0,
            rotate_deg: 0.0,
            distance_px: 1000.0,
        }
    }
}

impl Perspective {
    /// Whether this leaves the card untouched, so callers can skip the work and
    /// send [`IDENTITY`] instead.
    pub fn is_identity(&self) -> bool {
        self.tilt_x_deg.abs() < f32::EPSILON
            && self.tilt_y_deg.abs() < f32::EPSILON
            && self.rotate_deg.abs() < f32::EPSILON
    }
}

/// Depth-dial endpoints in pixels, matching CSS `perspective` semantics: a
/// smaller distance is a wider lens close to the card, which reads as more
/// dramatic convergence for the same tilt angle. Chosen against typical
/// screenshot-editor output sizes (roughly 800-2500px on the long edge) so
/// the dial's full range stays visually meaningful without tuning per image.
const MAX_DISTANCE_PX: f32 = 4000.0;
const MIN_DISTANCE_PX: f32 = 500.0;

/// Converts the popover's 0-100 depth dial to a camera distance. Linear for
/// now — a first pass to get the control on screen; worth revisiting once the
/// look is visible, since perspective falloff is not naturally linear.
pub fn distance_px_from_depth(depth: f32) -> f32 {
    let t = (depth / 100.0).clamp(0.0, 1.0);
    MAX_DISTANCE_PX + (MIN_DISTANCE_PX - MAX_DISTANCE_PX) * t
}

impl From<&quiro_project::PerspectiveConfiguration> for Perspective {
    fn from(config: &quiro_project::PerspectiveConfiguration) -> Self {
        Self {
            tilt_x_deg: config.tilt_x,
            tilt_y_deg: config.tilt_y,
            rotate_deg: config.rotate,
            distance_px: distance_px_from_depth(config.depth),
        }
    }
}

type Mat3 = [[f32; 3]; 3];

/// Row-major multiply.
fn mul(a: &Mat3, b: &Mat3) -> Mat3 {
    let mut out = [[0.0f32; 3]; 3];
    for (r, row) in out.iter_mut().enumerate() {
        for (c, cell) in row.iter_mut().enumerate() {
            *cell = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
        }
    }
    out
}

fn invert(m: &Mat3) -> Option<Mat3> {
    let c00 = m[1][1] * m[2][2] - m[1][2] * m[2][1];
    let c01 = m[1][2] * m[2][0] - m[1][0] * m[2][2];
    let c02 = m[1][0] * m[2][1] - m[1][1] * m[2][0];

    let det = m[0][0] * c00 + m[0][1] * c01 + m[0][2] * c02;
    if det.abs() < 1e-9 {
        return None;
    }
    let inv_det = 1.0 / det;

    Some([
        [
            c00 * inv_det,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv_det,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv_det,
        ],
        [
            c01 * inv_det,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv_det,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv_det,
        ],
        [
            c02 * inv_det,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv_det,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv_det,
        ],
    ])
}

/// Forward homography: card-plane pixels (relative to the card centre) to
/// screen pixels (also relative to the centre), before the perspective divide.
///
/// The card occupies the z = 0 plane, so a card point `(x, y)` maps to the 3D
/// point `x * col0 + y * col1`, where the columns come from the rotation. Only
/// two columns of the rotation matrix are ever needed — the third would scale
/// a z coordinate that is always zero.
fn forward(p: &Perspective) -> Mat3 {
    let (ax, ay, az) = (
        p.tilt_x_deg.clamp(-MAX_TILT_DEG, MAX_TILT_DEG).to_radians(),
        p.tilt_y_deg.clamp(-MAX_TILT_DEG, MAX_TILT_DEG).to_radians(),
        // In-plane spin never degenerates, so it is left alone.
        p.rotate_deg.to_radians(),
    );
    let (sx, cx) = ax.sin_cos();
    let (sy, cy) = ay.sin_cos();
    let (sz, cz) = az.sin_cos();

    // R = Rx * Ry * Rz, first two columns only.
    let col0 = [cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz];
    let col1 = [-cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz];

    let d = p.distance_px.max(1.0);

    // Pinhole with the camera at +z looking back at the origin: a point at
    // depth z projects by d / (d - z). Written homogeneously so the divide
    // happens once, in the shader.
    [
        [d * col0[0], d * col1[0], 0.0],
        [d * col0[1], d * col1[1], 0.0],
        [-col0[2], -col1[2], d],
    ]
}

/// Largest scale in `(0, 1]` that keeps the card's tilted silhouette inside
/// `clip` — a screen-space rect `[minX, minY, maxX, maxY]`, ordinarily the
/// output frame — by shrinking the flat rectangle uniformly about `center`
/// before tilting it with `perspective`. Returns `1.0` untouched whenever the
/// card already fits, so a flat or gently tilted card is never resized: only
/// a tilt that would actually spill past the edge costs anything.
///
/// `half_size` is the flat card's own half-width/half-height, in the same
/// units as `center` and `clip`.
pub fn fit_scale(
    perspective: &Perspective,
    center: [f32; 2],
    half_size: [f32; 2],
    clip: [f32; 4],
) -> f32 {
    if perspective.is_identity() {
        return 1.0;
    }

    let f = forward(perspective);
    let fits = |s: f32| -> bool {
        let half = [half_size[0] * s, half_size[1] * s];
        let corners = [
            [-half[0], -half[1]],
            [half[0], -half[1]],
            [-half[0], half[1]],
            [half[0], half[1]],
        ];
        corners.iter().all(|c| {
            let w = f[2][0] * c[0] + f[2][1] * c[1] + f[2][2];
            if w <= 1e-4 {
                return false;
            }
            let x = (f[0][0] * c[0] + f[0][1] * c[1]) / w + center[0];
            let y = (f[1][0] * c[0] + f[1][1] * c[1]) / w + center[1];
            x >= clip[0] && x <= clip[2] && y >= clip[1] && y <= clip[3]
        })
    };

    if fits(1.0) {
        return 1.0;
    }
    // A centre already outside the clip (some pre-existing layout condition —
    // extreme padding, an off-canvas split — unrelated to perspective) has no
    // rescue via scaling: shrinking toward it only ever converges on a point
    // still outside clip. Leaving the card at full size is no worse.
    if !fits(0.0) {
        return 1.0;
    }

    // `fits` is monotonic in s for every geometry this editor produces —
    // `distance_px` (hundreds to thousands of px) dwarfs the card's own
    // half-size, so shrinking the card only ever pulls its corners closer to
    // centre. That makes bisection exact enough in a fixed small step count,
    // rather than solving the quartic in s an exact bbox formula would need.
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    for _ in 0..24 {
        let mid = (lo + hi) * 0.5;
        if fits(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

/// The matrix the shader wants: absolute screen pixels to absolute card-plane
/// pixels, with the card centred on `center`.
///
/// Tilts are clamped to [`MAX_TILT_DEG`] before projecting, so the edge-on
/// case that would make this uninvertible cannot normally be reached. The
/// [`IDENTITY`] fallback is a last-resort net for a matrix that still comes out
/// singular: rendering the card flat beats rendering nothing.
pub fn inverse_matrix(p: &Perspective, center: [f32; 2]) -> PerspectiveMatrix {
    if p.is_identity() {
        return IDENTITY;
    }

    let Some(inv) = invert(&forward(p)) else {
        return IDENTITY;
    };

    // Screen pixels are absolute, but the homography is about the card centre,
    // so shift in, project, shift back out.
    let to_center: Mat3 = [
        [1.0, 0.0, -center[0]],
        [0.0, 1.0, -center[1]],
        [0.0, 0.0, 1.0],
    ];
    let from_center: Mat3 = [
        [1.0, 0.0, center[0]],
        [0.0, 1.0, center[1]],
        [0.0, 0.0, 1.0],
    ];

    to_wgsl_columns(&mul(&from_center, &mul(&inv, &to_center)))
}

/// Row-major to the column-major layout WGSL expects, padding each column out
/// to 16 bytes.
fn to_wgsl_columns(m: &Mat3) -> PerspectiveMatrix {
    [
        [m[0][0], m[1][0], m[2][0], 0.0],
        [m[0][1], m[1][1], m[2][1], 0.0],
        [m[0][2], m[1][2], m[2][2], 0.0],
    ]
}

/// What the display composite site in `lib.rs` actually calls: `None` (the
/// common case — video, camera, and a screenshot that has never touched the
/// Perspective popover) is `IDENTITY`; `Some` derives the card's centre from
/// its own screen-space target bounds and projects about that point.
///
/// Pulled out of the call site as its own function so this — config in,
/// matrix out — is unit-testable without spinning up a GPU device, which
/// `ProjectUniforms::new` otherwise requires.
pub fn inv_perspective_for_display(
    config: Option<&quiro_project::PerspectiveConfiguration>,
    target_bounds: [f32; 4],
) -> PerspectiveMatrix {
    let Some(config) = config else {
        return IDENTITY;
    };
    let center = [
        (target_bounds[0] + target_bounds[2]) * 0.5,
        (target_bounds[1] + target_bounds[3]) * 0.5,
    ];
    inverse_matrix(&Perspective::from(config), center)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Applies the matrix the way the shader does, including the divide.
    fn apply(m: &PerspectiveMatrix, p: [f32; 2]) -> [f32; 2] {
        // Columns: m[c] is column c, so row r reads m[0][r], m[1][r], m[2][r].
        let x = m[0][0] * p[0] + m[1][0] * p[1] + m[2][0];
        let y = m[0][1] * p[0] + m[1][1] * p[1] + m[2][1];
        let w = m[0][2] * p[0] + m[1][2] * p[1] + m[2][2];
        [x / w, y / w]
    }

    fn assert_close(a: [f32; 2], b: [f32; 2], what: &str) {
        assert!(
            (a[0] - b[0]).abs() < 0.01 && (a[1] - b[1]).abs() < 0.01,
            "{what}: got {a:?}, want {b:?}",
        );
    }

    #[test]
    fn identity_leaves_pixels_alone() {
        // The case every video and camera frame takes.
        let m = inverse_matrix(&Perspective::default(), [960.0, 540.0]);
        assert_eq!(m, IDENTITY);
        for p in [[0.0, 0.0], [960.0, 540.0], [1919.0, 1079.0], [-40.0, 12.5]] {
            assert_close(apply(&m, p), p, "identity");
        }
    }

    #[test]
    fn centre_is_a_fixed_point() {
        // Whatever the orientation, the pixel at the card centre maps to the
        // card's own centre — the rotation happens about it.
        let center = [800.0, 450.0];
        for (tx, ty, rz) in [(20.0, 0.0, 0.0), (0.0, -35.0, 0.0), (15.0, 25.0, 10.0)] {
            let m = inverse_matrix(
                &Perspective {
                    tilt_x_deg: tx,
                    tilt_y_deg: ty,
                    rotate_deg: rz,
                    distance_px: 1200.0,
                },
                center,
            );
            assert_close(apply(&m, center), center, "centre fixed");
        }
    }

    #[test]
    fn inverse_undoes_the_forward_projection() {
        // The real contract: project a card point to screen by hand, then check
        // the shader's matrix sends that screen pixel back to the card point.
        let center = [640.0, 360.0];
        let p = Perspective {
            tilt_x_deg: 18.0,
            tilt_y_deg: -24.0,
            rotate_deg: 6.0,
            distance_px: 900.0,
        };
        let f = forward(&p);
        let m = inverse_matrix(&p, center);

        for card in [[0.0, 0.0], [200.0, 120.0], [-320.0, 180.0], [95.0, -240.0]] {
            let w = f[2][0] * card[0] + f[2][1] * card[1] + f[2][2];
            let screen = [
                (f[0][0] * card[0] + f[0][1] * card[1]) / w + center[0],
                (f[1][0] * card[0] + f[1][1] * card[1]) / w + center[1],
            ];
            let back = apply(&m, screen);
            assert_close(
                back,
                [card[0] + center[0], card[1] + center[1]],
                "round trip",
            );
        }
    }

    #[test]
    fn in_plane_rotation_has_no_foreshortening() {
        // A 180 degree spin is a pure flip about the centre: a point one
        // hundred pixels right of centre must land one hundred pixels left,
        // with no perspective divide skewing it.
        let center = [500.0, 500.0];
        let m = inverse_matrix(
            &Perspective {
                rotate_deg: 180.0,
                ..Default::default()
            },
            center,
        );
        assert_close(apply(&m, [600.0, 500.0]), [400.0, 500.0], "spin x");
        assert_close(apply(&m, [500.0, 620.0]), [500.0, 380.0], "spin y");
    }

    #[test]
    fn extreme_tilt_is_clamped_not_degenerate() {
        // 90 degrees is edge-on. cos(90) in f32 is about -4.4e-8 rather than
        // zero, so the matrix is *near* singular, not singular — a determinant
        // check cannot catch it, and the inverse explodes into six-figure
        // entries. Clamping keeps the geometry well conditioned instead.
        let center = [100.0, 100.0];
        let at_90 = inverse_matrix(
            &Perspective {
                tilt_y_deg: 90.0,
                ..Default::default()
            },
            center,
        );
        let at_max = inverse_matrix(
            &Perspective {
                tilt_y_deg: MAX_TILT_DEG,
                ..Default::default()
            },
            center,
        );
        assert_eq!(at_90, at_max, "past the limit should pin to the limit");

        for col in at_90 {
            for value in col {
                assert!(value.is_finite(), "matrix must stay finite: {at_90:?}");
            }
        }
        // Still a real projection, and the centre still holds.
        assert_ne!(at_90, IDENTITY);
        assert_close(apply(&at_90, center), center, "clamped centre");
    }

    #[test]
    fn stays_finite_across_the_whole_range() {
        // Sweeps the sliders, including both extremes and a very short camera
        // distance, and insists nothing ever produces a NaN for the shader.
        for tilt in [-180.0, -90.0, -85.0, -30.0, 0.0, 30.0, 85.0, 90.0, 180.0] {
            for distance in [1.0, 50.0, 800.0, 10_000.0] {
                let m = inverse_matrix(
                    &Perspective {
                        tilt_x_deg: tilt,
                        tilt_y_deg: tilt * 0.5,
                        rotate_deg: tilt * 0.25,
                        distance_px: distance,
                    },
                    [640.0, 360.0],
                );
                for col in m {
                    for value in col {
                        assert!(
                            value.is_finite(),
                            "tilt {tilt} distance {distance} produced {m:?}",
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn tilting_away_shrinks_the_far_edge() {
        // The defining property of perspective: with the card leaning back, the
        // receding edge must occupy less screen space than the near edge. In
        // the inverse direction that means a screen pixel above centre maps to
        // a card point further from centre than its mirror below.
        let center = [0.0, 0.0];
        let m = inverse_matrix(
            &Perspective {
                tilt_x_deg: 35.0,
                distance_px: 800.0,
                ..Default::default()
            },
            center,
        );
        let up = apply(&m, [0.0, -200.0]);
        let down = apply(&m, [0.0, 200.0]);
        assert!(
            up[1].abs() > down[1].abs(),
            "expected asymmetric foreshortening, got up {up:?} down {down:?}",
        );
    }

    #[test]
    fn depth_dial_endpoints_and_default() {
        // 0 is the flattest the dial goes, 100 the most dramatic; the default
        // (45) should land between the two, not clamp to either end.
        assert_eq!(distance_px_from_depth(0.0), MAX_DISTANCE_PX);
        assert_eq!(distance_px_from_depth(100.0), MIN_DISTANCE_PX);
        let default_distance = distance_px_from_depth(45.0);
        assert!(default_distance > MIN_DISTANCE_PX && default_distance < MAX_DISTANCE_PX);

        // Out-of-range input (a slider bug, a hand-edited sidecar) must not
        // send the camera behind the card or out past the flat end.
        assert_eq!(distance_px_from_depth(-50.0), MAX_DISTANCE_PX);
        assert_eq!(distance_px_from_depth(150.0), MIN_DISTANCE_PX);
    }

    #[test]
    fn config_conversion_maps_every_field() {
        let config = quiro_project::PerspectiveConfiguration {
            tilt_x: 12.0,
            tilt_y: -8.0,
            rotate: 3.0,
            depth: 80.0,
        };
        let p = Perspective::from(&config);
        assert_eq!(p.tilt_x_deg, 12.0);
        assert_eq!(p.tilt_y_deg, -8.0);
        assert_eq!(p.rotate_deg, 3.0);
        assert_eq!(p.distance_px, distance_px_from_depth(80.0));
    }

    #[test]
    fn display_entry_point_none_is_identity() {
        // The state every video frame and an untouched screenshot are in.
        let m = inv_perspective_for_display(None, [0.0, 0.0, 1920.0, 1080.0]);
        assert_eq!(m, IDENTITY);
    }

    #[test]
    fn display_entry_point_derives_centre_from_bounds() {
        // The function must find the card's own centre from its bounds rather
        // than assuming the frame origin — a card placed off-centre by padding
        // or a split layout should still rotate about itself, not the corner.
        let config = quiro_project::PerspectiveConfiguration {
            tilt_x: 20.0,
            ..Default::default()
        };
        let bounds = [200.0, 100.0, 1400.0, 900.0];
        let expected_center = [800.0, 500.0];

        let m = inv_perspective_for_display(Some(&config), bounds);
        assert_ne!(m, IDENTITY, "a non-zero tilt must actually project");
        assert_close(
            apply(&m, expected_center),
            expected_center,
            "card centre fixed",
        );
    }

    /// Re-derives the tilted footprint's bounding box the way `fit_scale`
    /// itself does internally, so tests can check the returned scale actually
    /// produces a footprint inside `clip` rather than trusting the function's
    /// own arithmetic.
    fn projected_bbox(p: &Perspective, center: [f32; 2], half_size: [f32; 2]) -> [f32; 4] {
        let f = forward(p);
        let corners = [
            [-half_size[0], -half_size[1]],
            [half_size[0], -half_size[1]],
            [-half_size[0], half_size[1]],
            [half_size[0], half_size[1]],
        ];
        let mut bbox = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for c in corners {
            let w = f[2][0] * c[0] + f[2][1] * c[1] + f[2][2];
            let x = (f[0][0] * c[0] + f[0][1] * c[1]) / w + center[0];
            let y = (f[1][0] * c[0] + f[1][1] * c[1]) / w + center[1];
            bbox[0] = bbox[0].min(x);
            bbox[1] = bbox[1].min(y);
            bbox[2] = bbox[2].max(x);
            bbox[3] = bbox[3].max(y);
        }
        bbox
    }

    #[test]
    fn fit_scale_leaves_flat_card_untouched() {
        // No tilt at all: identical to the video/camera default, and the
        // fastest path — no projection math should even run.
        let s = fit_scale(
            &Perspective::default(),
            [500.0, 500.0],
            [400.0, 300.0],
            [0.0, 0.0, 1000.0, 1000.0],
        );
        assert_eq!(s, 1.0);
    }

    #[test]
    fn fit_scale_is_a_true_no_op_when_already_inside() {
        // A tilted card that comfortably fits a generous clip must not shrink
        // at all — "shrink to fit only when it would clip", not "always fit".
        let p = Perspective {
            tilt_x_deg: 10.0,
            tilt_y_deg: 5.0,
            ..Default::default()
        };
        let s = fit_scale(
            &p,
            [960.0, 540.0],
            [200.0, 120.0],
            [0.0, 0.0, 1920.0, 1080.0],
        );
        assert_eq!(s, 1.0);
    }

    #[test]
    fn fit_scale_shrinks_just_enough_to_fit_when_it_would_clip() {
        // A card far too big for its frame at a dramatic tilt: must shrink,
        // and the shrunk footprint must actually land inside clip — not just
        // "smaller than before", but correct.
        let p = Perspective {
            tilt_x_deg: 30.0,
            tilt_y_deg: -15.0,
            distance_px: 900.0,
            ..Default::default()
        };
        let center = [500.0, 500.0];
        let half_size = [900.0, 700.0];
        let clip = [0.0, 0.0, 1000.0, 1000.0];

        let s = fit_scale(&p, center, half_size, clip);
        assert!(s < 1.0, "expected a shrink, got {s}");
        assert!(s > 0.0, "expected a usable card, not a collapsed one");

        let bbox = projected_bbox(&p, center, [half_size[0] * s, half_size[1] * s]);
        let epsilon = 1.0; // bisection tolerance, in px, over 24 steps on [0,1]
        assert!(
            bbox[0] >= clip[0] - epsilon
                && bbox[1] >= clip[1] - epsilon
                && bbox[2] <= clip[2] + epsilon
                && bbox[3] <= clip[3] + epsilon,
            "shrunk footprint {bbox:?} does not fit clip {clip:?}",
        );
    }

    #[test]
    fn fit_scale_bails_out_when_centre_itself_is_outside_clip() {
        // Not a perspective problem — some other layout condition already put
        // the card's centre off the canvas. No scale fixes that, so this must
        // not collapse the card to nothing chasing an unreachable fit.
        let p = Perspective {
            tilt_x_deg: 20.0,
            ..Default::default()
        };
        let s = fit_scale(
            &p,
            [-500.0, -500.0],
            [200.0, 200.0],
            [0.0, 0.0, 1000.0, 1000.0],
        );
        assert_eq!(s, 1.0);
    }

    #[test]
    fn fit_scale_never_exceeds_one() {
        // Across a spread of tilts and clip sizes, the scale is always a
        // shrink or a no-op — never an enlargement past the card's own size.
        for tilt in [0.0, 5.0, 20.0, 45.0, 80.0] {
            for clip_size in [200.0, 800.0, 3000.0] {
                let p = Perspective {
                    tilt_x_deg: tilt,
                    tilt_y_deg: tilt * 0.6,
                    ..Default::default()
                };
                let s = fit_scale(
                    &p,
                    [clip_size / 2.0, clip_size / 2.0],
                    [400.0, 300.0],
                    [0.0, 0.0, clip_size, clip_size],
                );
                assert!(
                    (0.0..=1.0).contains(&s),
                    "tilt {tilt} clip {clip_size} gave {s}"
                );
            }
        }
    }
}

/// Guards the CPU/GPU contract for the composite uniform buffer.
///
/// A uniform struct whose Rust layout disagrees with its WGSL declaration does
/// not fail loudly — every field past the mismatch silently reads garbage. So
/// the shader is parsed and validated here, and its computed layout is checked
/// against the Rust struct.
#[cfg(test)]
mod shader_contract {
    use crate::composite_frame::CompositeVideoFrameUniforms;

    const SOURCE: &str = include_str!("shaders/composite-video-frame.wgsl");

    #[test]
    fn composite_shader_is_valid_wgsl() {
        let module = wgpu::naga::front::wgsl::parse_str(SOURCE).unwrap_or_else(|e| {
            panic!(
                "composite-video-frame.wgsl failed to parse:
{e:?}"
            )
        });

        wgpu::naga::valid::Validator::new(
            wgpu::naga::valid::ValidationFlags::all(),
            wgpu::naga::valid::Capabilities::all(),
        )
        .validate(&module)
        .unwrap_or_else(|e| {
            panic!(
                "composite-video-frame.wgsl failed validation:
{e:?}"
            )
        });
    }

    #[test]
    fn uniform_layout_matches_the_shader() {
        let module = wgpu::naga::front::wgsl::parse_str(SOURCE).expect("parse");

        let (_, ty) = module
            .types
            .iter()
            .find(|(_, t)| t.name.as_deref() == Some("Uniforms"))
            .expect("Uniforms struct present in shader");

        // `span` is the struct's laid-out size, which is what the buffer needs.
        let wgpu::naga::TypeInner::Struct { span, .. } = ty.inner else {
            panic!("Uniforms should be a struct");
        };

        let gpu_size = span as usize;
        let cpu_size = size_of::<CompositeVideoFrameUniforms>();

        assert_eq!(
            cpu_size, gpu_size,
            "CompositeVideoFrameUniforms is {cpu_size} bytes but the shader's              Uniforms struct is {gpu_size}; fields past the mismatch would read              garbage on the GPU",
        );
    }
}
