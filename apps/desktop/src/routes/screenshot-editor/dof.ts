import type { FocusConfig } from "@/utils/tauri";

// Cinematic depth of field for the screenshot, on the GPU.
//
// This is a camera simulation, not a blur filter. Every pixel gets its own
// circle of confusion from how far it sits from the elliptical plane of focus,
// and the blur gathers over a disc of that radius — so there is never a mask
// edge, only a continuous defocus ramp.
//
// It runs over the screenshot region alone. Samples are clamped to that
// region's bounds, so the bokeh can never reach out and drag the composition's
// background into the screenshot, and the background itself is never touched.

export type DofQuality = "preview" | "final";

/** Sample counts, benchmarked against the interactive requirement: dragging the
 * focus has to stay responsive, an export does not. */
const SAMPLES: Record<DofQuality, number> = {
	preview: 24,
	final: 64,
};

/** Max circle of confusion as a fraction of the screenshot's shorter side, at
 * `blur = 100`. Keeping it relative is what makes a 1x and a 2x export look
 * identical rather than one being twice as soft. */
const MAX_COC_FRACTION = 0.06;

const VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  // Fullscreen triangle: cheaper than a quad and avoids the diagonal seam.
  vec2 pos = vec2(
    float((gl_VertexID << 1) & 2),
    float(gl_VertexID & 2)
  );

  // Y is flipped here, and it matters more than it looks. GL's framebuffer
  // origin is bottom-left while the canvas this gets drawn back into is
  // top-left, so without this every sample is read from the mirrored row: the
  // screenshot comes out upside down, and aiming the focus at the top of the
  // image sharpens the bottom of it.
  vUv = vec2(pos.x, 1.0 - pos.y);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTexture;

// The screenshot's sub-rectangle inside the uploaded composite, in that
// texture's UV space. Sampling is clamped to it so the blur cannot reach the
// background around the screenshot.
uniform vec2 uRegionMin;
uniform vec2 uRegionSize;

uniform vec2 uFocus;
uniform vec2 uFocusRadius;
uniform float uFocusRotation;

uniform vec2 uResolution;
uniform float uMaxCoc;
uniform float uFalloff;
uniform float uInnerEdge;
uniform float uNearBlur;
uniform float uFarBlur;
uniform float uHighlight;
uniform float uCatEye;
uniform int uSamples;

const float TAU = 6.28318530718;
const float GOLDEN_ANGLE = 2.39996323;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Gamma 2.0 as a cheap stand-in for sRGB. Light adds linearly and gamma-encoded
// values do not, so averaging the encoded numbers is precisely what makes a
// blur look like a smudge instead of defocused light. Everything between these
// two lives in linear space.
vec3 toLinear(vec3 c) { return c * c; }
vec3 toGamma(vec3 c) { return sqrt(max(c, 0.0)); }

// The source is an ordinary 8-bit screenshot, so a blown highlight carries no
// more energy than mid-grey and would simply dissolve when averaged. Putting
// the top end back before the gather is what lets bright spots spread into
// bokeh discs that hold their shape.
vec3 expandHighlights(vec3 linear) {
  return linear * (1.0 + uHighlight * smoothstep(0.45, 1.0, luma(linear)) * 7.0);
}

/** Circle of confusion, in pixels, for a point in region-local UV space. */
float coc(vec2 uv) {
  // Worked in pixels so the ellipse and its rotation stay true to what the
  // user dragged, whatever the screenshot's aspect ratio.
  vec2 d = (uv - uFocus) * uResolution;

  float c = cos(-uFocusRotation);
  float s = sin(-uFocusRotation);
  d = vec2(d.x * c - d.y * s, d.x * s + d.y * c);

  vec2 radiusPx = max(uFocusRadius * uResolution, vec2(1.0));
  float distance = length(d / radiusPx);

  // 1 across the plane of focus, easing to 0 outside it. The inner edge is
  // what "Depth" narrows, so a higher setting keeps less of the frame sharp.
  float focusFactor = 1.0 - smoothstep(uInnerEdge, 1.0, distance);

  // Never a threshold: the exponent shapes how quickly defocus builds, but
  // the ramp itself is continuous everywhere.
  float amount = pow(1.0 - focusFactor, uFalloff);

  // Content above the plane of focus reads as further away, below as nearer,
  // which lets a composition defocus one side harder than the other.
  float nearness = smoothstep(-0.2, 0.2, uv.y - uFocus.y);
  return uMaxCoc * amount * mix(uFarBlur, uNearBlur, nearness);
}

// Interleaved gradient noise. Spinning each pixel's sample spiral by a
// different amount turns the concentric rings an undersampled disc would
// otherwise show into fine noise, which the eye accepts as grain.
float dither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 regionMax = uRegionMin + uRegionSize;
  vec2 sourceUv = uRegionMin + vUv * uRegionSize;

  float radius = coc(vUv);
  vec4 centerTexel = texture(uTexture, clamp(sourceUv, uRegionMin, regionMax));
  // Carried through rather than forced opaque, so a composition exported with
  // no background keeps its transparency instead of gaining a black rectangle.
  float alpha = centerTexel.a;

  // Inside the plane of focus there is nothing to gather: leave it genuinely
  // sharp rather than running a one-pixel blur over it.
  if (radius < 0.5) {
    fragColor = vec4(centerTexel.rgb, alpha);
    return;
  }

  vec3 accum = expandHighlights(toLinear(centerTexel.rgb));
  float total = 1.0;

  // Optical vignetting. A real barrel clips the aperture progressively toward
  // the frame edge, squashing round bokeh into the "cat's eye" that fast
  // lenses are recognised by. Radial extent is kept, tangential is squeezed.
  vec2 fromCenter = vUv - 0.5;
  vec2 radial = normalize(fromCenter + vec2(1e-5));
  float squash = 1.0 - clamp(length(fromCenter) * 2.0 * uCatEye, 0.0, 0.8);

  float spin = dither(gl_FragCoord.xy) * TAU + uFocusRotation;

  // A golden-angle spiral with a sqrt radius distributes samples evenly over
  // a disc. A square grid would read as a computer-generated blur; this reads
  // as an aperture.
  for (int i = 0; i < uSamples; i++) {
    float fi = float(i) + 0.5;
    float r = radius * sqrt(fi / float(uSamples));
    float angle = fi * GOLDEN_ANGLE + spin;

    vec2 offset = vec2(cos(angle), sin(angle)) * r;
    float along = dot(offset, radial);
    offset = radial * along + (offset - radial * along) * squash;

    vec2 localUv = vUv + offset / uResolution;
    vec2 sampleUv = clamp(
      uRegionMin + localUv * uRegionSize,
      uRegionMin,
      regionMax
    );

    // Scatter-as-gather: a sample only reaches this pixel if its own circle of
    // confusion is wide enough to span the gap between them. Without it, the
    // sharp region smears outward into the defocus instead of staying put —
    // the giveaway that a blur was painted on rather than focused.
    float w = clamp(coc(localUv) - r + 1.0, 0.0, 1.0);

    accum += expandHighlights(toLinear(texture(uTexture, sampleUv).rgb)) * w;
    total += w;
  }

  // Left to clip on write rather than tonemapped: a highlight that overruns
  // the disc is exactly what a sensor does, and it gives bokeh a bright core
  // with a defined edge.
  fragColor = vec4(toGamma(accum / total), alpha);
}`;

const compile = (
	gl: WebGL2RenderingContext,
	type: number,
	source: string,
): WebGLShader | null => {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		if (import.meta.env.DEV)
			console.error(
				"DOF shader failed to compile",
				gl.getShaderInfoLog(shader),
			);
		gl.deleteShader(shader);
		return null;
	}
	return shader;
};

export type DofSource = {
	/** The full composite the screenshot sits inside. */
	canvas: HTMLCanvasElement;
	/** Identity of the frame currently on it, so the texture upload — the one
	 * genuinely expensive step that does not depend on the focus — is skipped
	 * while only the focus is being dragged. */
	revision: unknown;
};

export type DofRegion = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/**
 * Owns one WebGL2 context and renders the defocused screenshot into its own
 * canvas, which the caller composites back over the frame.
 *
 * Preview and export drive the same instance and the same shader — only the
 * sample count and the resolution differ — so what is exported is what was on
 * screen, at whatever scale the export asked for.
 */
export class DofRenderer {
	private canvas: HTMLCanvasElement;
	private gl: WebGL2RenderingContext | null;
	private program: WebGLProgram | null = null;
	private texture: WebGLTexture | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private uniforms = new Map<string, WebGLUniformLocation | null>();
	private uploadedRevision: unknown = Symbol("never");

	constructor() {
		this.canvas = document.createElement("canvas");
		this.gl = this.canvas.getContext("webgl2", {
			// Alpha is kept so a screenshot composited over no background stays
			// transparent through the pass.
			alpha: true,
			antialias: false,
			depth: false,
			stencil: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: true,
		});
		if (this.gl) this.init(this.gl);
	}

	get supported() {
		return this.program !== null;
	}

	private init(gl: WebGL2RenderingContext) {
		const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
		const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
		if (!vertex || !fragment) return;

		const program = gl.createProgram();
		if (!program) return;
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		gl.deleteShader(vertex);
		gl.deleteShader(fragment);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			if (import.meta.env.DEV)
				console.error(
					"DOF program failed to link",
					gl.getProgramInfoLog(program),
				);
			gl.deleteProgram(program);
			return;
		}

		this.program = program;
		// The fullscreen triangle is generated from gl_VertexID, so the VAO
		// carries no buffers — it exists because core profiles require one bound.
		this.vao = gl.createVertexArray();
		this.texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}

	/** `gl.useProgram` matches the `use*` naming convention, so calling it after
	 * a guard clause trips Biome's rules-of-hooks check — in a class method that
	 * is not a component. Going through an alias keeps the lint meaningful
	 * instead of suppressed. */
	private activateProgram(gl: WebGL2RenderingContext, program: WebGLProgram) {
		const activate = gl.useProgram;
		activate.call(gl, program);
	}

	private location(name: string) {
		const gl = this.gl;
		const program = this.program;
		if (!gl || !program) return null;
		if (!this.uniforms.has(name))
			this.uniforms.set(name, gl.getUniformLocation(program, name));
		return this.uniforms.get(name) ?? null;
	}

	/**
	 * Renders the screenshot region of `source` defocused around `focus`.
	 * Returns the canvas holding the result — sized to `region` — or null when
	 * WebGL2 is unavailable, which the caller reads as "skip the effect".
	 */
	render(
		source: DofSource,
		region: DofRegion,
		focus: FocusConfig,
		quality: DofQuality,
	): HTMLCanvasElement | null {
		const gl = this.gl;
		const program = this.program;
		// Every bail-out is gathered here: further down, an early return would sit
		// between statements Biome reads as conditionally-called React hooks
		// (`gl.useProgram` matches the `use*` convention).
		if (!gl || !program || gl.isContextLost()) return null;

		const width = Math.max(1, Math.round(region.width));
		const height = Math.max(1, Math.round(region.height));
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}

		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		if (this.uploadedRevision !== source.revision) {
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				source.canvas,
			);
			this.uploadedRevision = source.revision;
		}

		gl.viewport(0, 0, width, height);
		this.activateProgram(gl, program);
		gl.bindVertexArray(this.vao);

		const sw = source.canvas.width;
		const sh = source.canvas.height;

		// The dials, resolved into lens terms here so the shader stays about
		// optics and the UI stays about photography.
		const shorterSide = Math.min(width, height);
		const maxCoc = (focus.blur / 100) * shorterSide * MAX_COC_FRACTION;
		const depth = Math.max(0, Math.min(100, focus.depth)) / 100;

		gl.uniform1i(this.location("uTexture"), 0);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);

		gl.uniform2f(this.location("uRegionMin"), region.x / sw, region.y / sh);
		gl.uniform2f(
			this.location("uRegionSize"),
			region.width / sw,
			region.height / sh,
		);
		gl.uniform2f(this.location("uFocus"), focus.x, focus.y);
		gl.uniform2f(this.location("uFocusRadius"), focus.radiusX, focus.radiusY);
		gl.uniform1f(
			this.location("uFocusRotation"),
			(focus.rotation * Math.PI) / 180,
		);
		gl.uniform2f(this.location("uResolution"), width, height);
		gl.uniform1f(this.location("uMaxCoc"), maxCoc);
		// Depth steepens the ramp and pulls the sharp core in at the same time,
		// which is what "more depth of field control" feels like on a real lens.
		gl.uniform1f(this.location("uFalloff"), 0.75 + depth * 3.0);
		gl.uniform1f(this.location("uInnerEdge"), 0.75 - depth * 0.5);
		gl.uniform1f(this.location("uNearBlur"), focus.nearBlur);
		gl.uniform1f(this.location("uFarBlur"), focus.farBlur);
		// One dial, one coherent idea of "lens character": a wider aperture both
		// blooms highlights harder and vignettes the bokeh into cat's eyes.
		gl.uniform1f(this.location("uHighlight"), focus.lens / 100);
		gl.uniform1f(this.location("uCatEye"), (focus.lens / 100) * 0.6);
		gl.uniform1i(this.location("uSamples"), SAMPLES[quality]);

		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindVertexArray(null);

		return this.canvas;
	}

	/** Forces the next render to re-upload, e.g. after the frame changed
	 * underneath without its identity changing. */
	invalidate() {
		this.uploadedRevision = Symbol("invalidated");
	}

	dispose() {
		const gl = this.gl;
		if (!gl) return;
		if (this.program) gl.deleteProgram(this.program);
		if (this.texture) gl.deleteTexture(this.texture);
		if (this.vao) gl.deleteVertexArray(this.vao);
		this.program = null;
		this.texture = null;
		this.vao = null;
		this.gl = null;
	}
}

/** The renderer holds a WebGL2 context, and browsers cap how many of those can
 * exist at once — so preview and export share one rather than each making their
 * own and racing the limit. */
let shared: DofRenderer | null = null;
export const sharedDofRenderer = () => {
	if (!shared) shared = new DofRenderer();
	return shared;
};
