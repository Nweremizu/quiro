// Annotation shapes, drawn as SDFs over a full-screen quad — one draw per
// annotation, same approach as caption_bg.wgsl.
//
// Fill and stroke come from one distance field rather than two passes: the
// stroke is the band around `d == 0` and the fill is everything inside, so a
// semi-transparent shape never double-blends where the two meet.

struct AnnotationUniforms {
    // x, y, width, height in output pixels.
    rect: vec4<f32>,
    fill_color: vec4<f32>,
    stroke_color: vec4<f32>,
    // shape (0 = rect, 1 = ellipse), stroke_width px, corner_radius px, rotation radians
    params: vec4<f32>,
    // Master alpha from opacity * animation envelope; rest is padding.
    opacity: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: AnnotationUniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0),
    );

    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    return output;
}

fn rounded_rect_sdf(p: vec2<f32>, half_size: vec2<f32>, radius: f32) -> f32 {
    let r = min(radius, min(half_size.x, half_size.y));
    let q = abs(p) - (half_size - vec2<f32>(r));
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// Exact ellipse SDF is iterative; this is the standard gradient-normalised
// approximation, which is accurate to well under a pixel at annotation sizes
// and does not need a loop.
fn ellipse_sdf(p: vec2<f32>, half_size: vec2<f32>) -> f32 {
    let r = max(half_size, vec2<f32>(0.0001));
    let k1 = length(p / r);
    let k2 = length(p / (r * r));
    if k2 == 0.0 {
        return -min(r.x, r.y);
    }
    return (k1 - 1.0) * k1 / k2;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let rect_min = uniforms.rect.xy;
    let rect_size = uniforms.rect.zw;
    let half_size = rect_size * 0.5;
    let centre = rect_min + half_size;

    let shape = uniforms.params.x;
    let stroke_width = uniforms.params.y;
    let radius = uniforms.params.z;
    let rotation = uniforms.params.w;

    // Rotate the sample point *back* into the shape's own frame, so the shape
    // itself needs no rotated geometry.
    let offset = position.xy - centre;
    let c = cos(-rotation);
    let s = sin(-rotation);
    let local = vec2<f32>(
        offset.x * c - offset.y * s,
        offset.x * s + offset.y * c,
    );

    var distance: f32;
    if shape < 0.5 {
        distance = rounded_rect_sdf(local, half_size, radius);
    } else {
        distance = ellipse_sdf(local, half_size);
    }

    // One pixel of feather. Antialiasing the SDF is the whole reason to draw
    // shapes this way rather than as tessellated triangles.
    let aa = 1.0;

    // The stroke straddles the edge, matching how SVG centres a stroke on its
    // path — otherwise the exported frame would sit half a stroke-width off
    // the editing overlay.
    let half_stroke = stroke_width * 0.5;
    let stroke_coverage = select(
        0.0,
        1.0 - smoothstep(half_stroke - aa, half_stroke + aa, abs(distance)),
        stroke_width > 0.0,
    );
    let fill_coverage = 1.0 - smoothstep(-aa, aa, distance);

    let fill_a = uniforms.fill_color.a * fill_coverage;
    let stroke_a = uniforms.stroke_color.a * stroke_coverage;

    // Stroke over fill, premultiplied so a translucent stroke shows the fill
    // through it instead of replacing it.
    let out_a = stroke_a + fill_a * (1.0 - stroke_a);
    if out_a <= 0.0 {
        return vec4<f32>(0.0);
    }
    let rgb = (uniforms.stroke_color.rgb * stroke_a
        + uniforms.fill_color.rgb * fill_a * (1.0 - stroke_a)) / out_a;

    return vec4<f32>(rgb, out_a * uniforms.opacity.x);
}
