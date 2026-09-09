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
    // curve, bend, line style, tapered
    arrow_style: vec4<f32>,
    // start head, end head, head scale, reveal
    arrow_heads: vec4<f32>,
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

fn segment_distance(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let ab = b - a;
    let denominator = max(dot(ab, ab), 0.0001);
    let t = clamp(dot(p - a, ab) / denominator, 0.0, 1.0);
    return length(p - (a + ab * t));
}

fn arrow_point(t: f32, start: vec2<f32>, end: vec2<f32>) -> vec2<f32> {
    let delta = end - start;
    let chord = max(length(delta), 0.0001);
    let normal = vec2<f32>(-delta.y, delta.x) / chord;
    let offset = normal * uniforms.arrow_style.y * chord;
    let curve = uniforms.arrow_style.x;

    if curve < 0.5 {
        return mix(start, end, t);
    }
    if curve < 1.5 {
        let control = (start + end) * 0.5 + offset;
        let u = 1.0 - t;
        return u * u * start + 2.0 * u * t * control + t * t * end;
    }
    if curve < 2.5 {
        let c1 = start + delta / 3.0 + offset;
        let c2 = start + delta * (2.0 / 3.0) - offset;
        let u = 1.0 - t;
        return u * u * u * start + 3.0 * u * u * t * c1
            + 3.0 * u * t * t * c2 + t * t * t * end;
    }

    let horizontal_first = abs(delta.x) >= abs(delta.y);
    let corner = select(vec2<f32>(start.x, end.y), vec2<f32>(end.x, start.y), horizontal_first);
    let first_length = length(corner - start);
    let second_length = length(end - corner);
    let split = first_length / max(first_length + second_length, 0.0001);
    if t <= split {
        return mix(start, corner, t / max(split, 0.0001));
    }
    return mix(corner, end, (t - split) / max(1.0 - split, 0.0001));
}

fn triangle_contains(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> bool {
    let s1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    let s2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
    let s3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
    return (s1 >= 0.0 && s2 >= 0.0 && s3 >= 0.0)
        || (s1 <= 0.0 && s2 <= 0.0 && s3 <= 0.0);
}

fn arrow_head_coverage(
    p: vec2<f32>,
    tip: vec2<f32>,
    inward: vec2<f32>,
    kind: f32,
    size: f32,
    stroke_width: f32,
) -> f32 {
    if kind < 0.5 {
        return 0.0;
    }
    let axis = normalize(inward + vec2<f32>(0.00001));
    let normal = vec2<f32>(-axis.y, axis.x);
    let centre = tip + axis * size * 0.5;
    if kind < 1.5 {
        let wing = max(14.0, max(1.0, stroke_width) * 5.0) * uniforms.arrow_heads.z * 0.5;
        let base = tip + axis * size;
        let distance = min(
            segment_distance(p, base + normal * wing, tip),
            segment_distance(p, tip, base - normal * wing),
        );
        return 1.0 - smoothstep(stroke_width * 0.5, stroke_width * 0.5 + 1.0, distance);
    }
    if kind < 2.5 {
        let wing = max(14.0, max(1.0, stroke_width) * 5.0) * uniforms.arrow_heads.z * 0.5;
        let base = tip + axis * size;
        return select(0.0, 1.0, triangle_contains(p, base + normal * wing, tip, base - normal * wing));
    }
    if kind < 3.5 {
        let distance = length(p - centre) - size * 0.5;
        return 1.0 - smoothstep(-0.5, 0.5, distance);
    }
    let local = vec2<f32>(dot(p - centre, axis), dot(p - centre, normal));
    let distance = max(abs(local.x), abs(local.y)) - size * 0.5;
    return 1.0 - smoothstep(-0.5, 0.5, distance);
}

fn arrow_coverage(p: vec2<f32>) -> f32 {
    let start = uniforms.rect.xy;
    let end = uniforms.rect.xy + uniforms.rect.zw;
    let stroke_width = max(uniforms.params.y, 1.0);
    let reveal = clamp(uniforms.arrow_heads.w, 0.0, 1.0);
    let chord = max(length(end - start), 0.0001);
    let line_style = uniforms.arrow_style.z;
    var coverage = 0.0;

    for (var i = 0; i < 48; i = i + 1) {
        let t0 = f32(i) / 48.0;
        let t1 = f32(i + 1) / 48.0;
        if t0 >= reveal {
            break;
        }
        let visible_t1 = min(t1, reveal);
        let phase = t0 * chord;
        var enabled = true;
        if line_style > 0.5 && line_style < 1.5 {
            enabled = fract(phase / max(stroke_width * 5.0, 1.0)) < 0.6;
        } else if line_style >= 1.5 {
            enabled = fract(phase / max(stroke_width * 2.01, 1.0)) < 0.18;
        }
        if enabled {
            let width_scale = select(1.0, mix(0.2, 1.0, t0), uniforms.arrow_style.w > 0.5);
            let distance = segment_distance(
                p,
                arrow_point(t0, start, end),
                arrow_point(visible_t1, start, end),
            );
            coverage = max(
                coverage,
                1.0 - smoothstep(stroke_width * width_scale * 0.5, stroke_width * width_scale * 0.5 + 1.0, distance),
            );
        }
    }

    let head_size = max(10.0, stroke_width * 2.6) * uniforms.arrow_heads.z;
    let pointed_size = max(20.0, stroke_width * 6.0) * uniforms.arrow_heads.z;
    let start_kind = uniforms.arrow_heads.x;
    let end_kind = uniforms.arrow_heads.y;
    let start_size = select(pointed_size, head_size, start_kind >= 2.5);
    let end_size = select(pointed_size, head_size, end_kind >= 2.5);
    let start_inward = arrow_point(1.0 / 48.0, start, end) - start;
    let end_inward = arrow_point(47.0 / 48.0, start, end) - end;
    coverage = max(coverage, arrow_head_coverage(p, start, start_inward, start_kind, start_size, stroke_width));
    if reveal >= 0.999 {
        coverage = max(coverage, arrow_head_coverage(p, end, end_inward, end_kind, end_size, stroke_width));
    }
    return coverage;
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

    if shape > 1.5 {
        let coverage = arrow_coverage(position.xy);
        let alpha = uniforms.stroke_color.a * uniforms.opacity.x * coverage;
        return vec4<f32>(uniforms.stroke_color.rgb, alpha);
    }

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
