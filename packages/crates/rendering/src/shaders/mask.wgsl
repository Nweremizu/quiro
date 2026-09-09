struct Uniforms {
    rect_center: vec2<f32>,
    rect_size: vec2<f32>,
    feather: f32,
    opacity: f32,
    effect_size: f32,
    darkness: f32,
    mode: u32,
    shape: u32,
    output_size: vec2<f32>,
    corner_radius: f32,
    _padding: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var source_texture: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;

const MODE_PIXELATE: u32 = 0u;
const MODE_HIGHLIGHT: u32 = 1u;
const MODE_BLUR_HORIZONTAL: u32 = 2u;
const MODE_BLUR_VERTICAL: u32 = 3u;
const MODE_REDACT: u32 = 4u;

const SHAPE_RECT: u32 = 0u;
const SHAPE_ELLIPSE: u32 = 1u;
const SHAPE_ROUNDED_RECT: u32 = 2u;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );

    let pos = positions[vertex_index];
    var out: VertexOutput;
    out.position = vec4<f32>(pos, 0.0, 1.0);
    out.uv = vec2<f32>(pos.x * 0.5 + 0.5, 1.0 - (pos.y * 0.5 + 0.5));
    return out;
}

// All of the region maths runs in PIXELS, not UV.
//
// UV space is stretched by the frame's aspect: one unit across is 1920px on a
// 16:9 frame and one unit down is 1080px. Measuring a distance with `length()`
// in that space mixes the two, so a feather that should be round came out
// ~1.78x wider horizontally than vertically, and every corner was elliptical
// in the wrong direction. Converting to pixels first makes every distance
// below isotropic and lets one feather value mean one thing.

fn region_half_extent_px() -> vec2<f32> {
    return uniforms.rect_size * 0.5 * uniforms.output_size;
}

/// Signed distance to the region edge, in pixels. Negative inside.
fn region_sdf_px(uv: vec2<f32>) -> f32 {
    let half_px = region_half_extent_px();
    let delta = abs(uv - uniforms.rect_center) * uniforms.output_size;

    if uniforms.shape == SHAPE_ELLIPSE {
        // Exact ellipse SDF is iterative; this is the standard cheap
        // approximation, which is accurate near the boundary — the only place
        // the feather actually samples it.
        let safe = max(half_px, vec2<f32>(1e-3));
        let normalized = delta / safe;
        let k = length(normalized);
        // Scale the normalized overshoot back into pixels along the gradient.
        return (k - 1.0) * min(safe.x, safe.y);
    }

    var corner = 0.0;
    if uniforms.shape == SHAPE_ROUNDED_RECT {
        corner = clamp(uniforms.corner_radius, 0.0, 0.5)
            * 2.0
            * min(half_px.x, half_px.y);
    }

    // Rounded-box SDF: shrink the box by the radius, then measure to it and
    // subtract. With corner = 0 this is the plain box SDF.
    let inner = max(half_px - vec2<f32>(corner), vec2<f32>(0.0));
    let d = delta - inner;
    let outside = length(max(d, vec2<f32>(0.0)));
    let inside = min(max(d.x, d.y), 0.0);
    return outside + inside - corner;
}

fn region_mask(uv: vec2<f32>) -> f32 {
    let sdf = region_sdf_px(uv);
    // Feather is a fraction of the region's shorter axis, resolved here where
    // the frame size is known. The 1e-3 floor keeps the smoothstep from
    // dividing by zero and gives a hard edge when feather is 0 — which Redact
    // and Spotlight rely on.
    let half_px = region_half_extent_px();
    let edge = max(uniforms.feather * min(half_px.x, half_px.y), 1e-3);
    return clamp(smoothstep(0.0, edge, -sdf), 0.0, 1.0);
}

fn pixelate_sample(uv: vec2<f32>) -> vec4<f32> {
    let px_size = max(uniforms.effect_size, 1.0);
    let cell = px_size / uniforms.output_size;
    let snapped = floor(uv / cell) * cell + cell * 0.5;
    let texture_size = textureDimensions(source_texture);
    let max_coord = vec2<i32>(texture_size) - vec2<i32>(1);
    let coord = clamp(
        vec2<i32>(snapped * vec2<f32>(texture_size)),
        vec2<i32>(0),
        max_coord,
    );
    return textureLoad(source_texture, coord, 0);
}

fn blur_sample(uv: vec2<f32>, direction: vec2<f32>) -> vec4<f32> {
    let radius = max(uniforms.effect_size, 1.0);
    let sample_step = direction * radius / (uniforms.output_size * 12.0);
    var color = vec4<f32>(0.0);
    var weight_sum = 0.0;

    for (var index = -12; index <= 12; index++) {
        let distance = f32(index) / 4.0;
        let weight = exp(-0.5 * distance * distance);
        color += textureSampleLevel(
            source_texture,
            source_sampler,
            uv + f32(index) * sample_step,
            0.0,
        ) * weight;
        weight_sum += weight;
    }

    return color / weight_sum;
}

/// The horizontal pass has to cover every texel the vertical pass will later
/// sample, so it runs over the region grown by the blur radius. In pixels, for
/// the same reason as everything else here.
fn horizontal_blur_support(uv: vec2<f32>) -> bool {
    let half_px = region_half_extent_px();
    let delta = abs(uv - uniforms.rect_center) * uniforms.output_size;
    return delta.x <= half_px.x && delta.y <= half_px.y + uniforms.effect_size;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let base = textureSample(source_texture, source_sampler, uv);
    let mask = region_mask(uv);

    if uniforms.mode == MODE_PIXELATE {
        let pixelated = pixelate_sample(uv);
        let effect = vec4<f32>(pixelated.rgb, base.a);
        return mix(base, effect, mask * uniforms.opacity);
    }

    if uniforms.mode == MODE_BLUR_HORIZONTAL {
        if !horizontal_blur_support(uv) {
            return base;
        }
        let blurred = blur_sample(uv, vec2<f32>(1.0, 0.0));
        return vec4<f32>(blurred.rgb, base.a);
    }

    if uniforms.mode == MODE_BLUR_VERTICAL {
        if mask <= 0.0 {
            discard;
        }
        let blurred = blur_sample(uv, vec2<f32>(0.0, 1.0));
        // Alpha carries the mask for the composite; opacity rides along with
        // it rather than being a second, separate blend.
        return vec4<f32>(blurred.rgb, mask * uniforms.opacity);
    }

    if uniforms.mode == MODE_REDACT {
        // Redaction is a security property, not a visual effect: inside the
        // region no source pixel may survive. `interpolate_masks` forces the
        // feather to zero for this mode so `mask` is effectively binary, and
        // the fill is opaque rather than blended, so nothing leaks through a
        // soft edge or a partial opacity.
        // Deliberately ignores `opacity`: a translucent redaction is not a
        // redaction. This is the one branch that must not blend.
        let fill = vec4<f32>(vec3<f32>(32.0, 34.0, 38.0) / 255.0, base.a);
        return select(base, fill, mask >= 0.5);
    }

    if uniforms.mode == MODE_HIGHLIGHT {
        let darkness = clamp(uniforms.darkness * uniforms.opacity, 0.0, 1.0);
        let outside = vec4<f32>(base.rgb * (1.0 - darkness), base.a);
        return mix(outside, base, mask);
    }

    return base;
}
