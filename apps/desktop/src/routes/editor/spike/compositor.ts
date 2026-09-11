import * as THREE from "three";
import { events } from "@/utils/tauri";
import type { SocketFrame } from "../../screenshot-editor/frameSocket";
import type { PlaybackStore } from "../playback-store";

// The prototype's compositor: the recording as a textured plane in a real 3D
// scene, with a camera and a post chain. This is the piece that would replace
// the Rust compositor if the numbers hold up — everything the Rust side keeps
// doing (decode, seek, timeline evaluation, audio, mux) is untouched.
//
// Deliberately hand-rolled rather than using EffectComposer: the prototype has
// to measure the cost of the passes it actually needs, not of a general
// framework, and the bloom here is the cheapest thing that stresses a
// multi-pass chain (two extra fullscreen draws plus a downsample).

export const SCENE_PRESETS = ["flat", "tilt", "tilt-bloom"] as const;
export type ScenePreset = (typeof SCENE_PRESETS)[number];

type Size = { width: number; height: number };

const BLOOM_SCALE = 0.5;

export class ThreeCompositor {
	readonly canvas: HTMLCanvasElement;

	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera: THREE.PerspectiveCamera;
	private readonly plane: THREE.Mesh<
		THREE.PlaneGeometry,
		THREE.MeshBasicMaterial
	>;
	private texture: THREE.Texture | null = null;

	// Post chain: scene -> bright pass -> blur -> composite to canvas.
	private readonly sceneTarget: THREE.WebGLRenderTarget;
	private readonly bloomTarget: THREE.WebGLRenderTarget;
	private readonly postScene = new THREE.Scene();
	private readonly postCamera = new THREE.OrthographicCamera(
		-1,
		1,
		1,
		-1,
		0,
		1,
	);
	private readonly postQuad: THREE.Mesh<
		THREE.PlaneGeometry,
		THREE.ShaderMaterial
	>;

	private preset: ScenePreset = "tilt-bloom";

	constructor(canvas: HTMLCanvasElement, size: Size) {
		this.canvas = canvas;

		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: false,
			// The encoder reads back from this canvas, so it has to keep its
			// contents after a draw.
			preserveDrawingBuffer: true,
			powerPreference: "high-performance",
		});
		this.renderer.setPixelRatio(1);
		this.renderer.setSize(size.width, size.height, false);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.camera = new THREE.PerspectiveCamera(
			35,
			size.width / size.height,
			0.1,
			100,
		);
		this.camera.position.set(0, 0, 3.2);

		this.plane = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({ transparent: false }),
		);
		this.scene.add(this.plane);
		this.scene.add(new THREE.AmbientLight(0xffffff, 1));

		const targetOptions = {
			depthBuffer: false,
			stencilBuffer: false,
			type: THREE.UnsignedByteType,
		};
		this.sceneTarget = new THREE.WebGLRenderTarget(
			size.width,
			size.height,
			targetOptions,
		);
		this.bloomTarget = new THREE.WebGLRenderTarget(
			Math.max(1, Math.round(size.width * BLOOM_SCALE)),
			Math.max(1, Math.round(size.height * BLOOM_SCALE)),
			targetOptions,
		);

		this.postQuad = new THREE.Mesh(
			new THREE.PlaneGeometry(2, 2),
			new THREE.ShaderMaterial({
				uniforms: {
					scene: { value: this.sceneTarget.texture },
					bloom: { value: this.bloomTarget.texture },
					texel: {
						value: new THREE.Vector2(1 / size.width, 1 / size.height),
					},
					mode: { value: 0 },
					threshold: { value: 0.7 },
					intensity: { value: 0.6 },
				},
				vertexShader: POST_VERTEX,
				fragmentShader: POST_FRAGMENT,
			}),
		);
		this.postScene.add(this.postQuad);
	}

	setPreset(preset: ScenePreset) {
		this.preset = preset;

		// A fixed pose per preset: the prototype is measuring cost, and an
		// animated camera would make frame times incomparable between runs.
		if (preset === "flat") {
			this.plane.rotation.set(0, 0, 0);
			this.camera.position.set(0, 0, 3.2);
		} else {
			this.plane.rotation.set(-0.12, 0.36, 0);
			this.camera.position.set(0.35, 0.12, 3.0);
		}
		this.camera.lookAt(0, 0, 0);
	}

	/** Replaces the plane's texture with the newest decoded frame. */
	/** `texImage2D` takes either — the frame socket hands back a `VideoFrame`
	 * on its fast path and an `ImageBitmap` on the fallback. */
	uploadFrame(bitmap: ImageBitmap | VideoFrame, width: number, height: number) {
		if (this.texture) this.texture.dispose();

		this.texture = new THREE.Texture(bitmap);
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.texture.flipY = true;
		this.texture.needsUpdate = true;

		this.plane.material.map = this.texture;
		this.plane.material.needsUpdate = true;

		// Keep the recording's aspect regardless of the output's.
		const aspect = height > 0 ? width / height : 1;
		this.plane.scale.set(aspect * 1.4, 1.4, 1);
	}

	render() {
		const bloom = this.preset === "tilt-bloom";
		const material = this.postQuad.material;

		if (!bloom) {
			this.renderer.setRenderTarget(null);
			this.renderer.render(this.scene, this.camera);
			return;
		}

		this.renderer.setRenderTarget(this.sceneTarget);
		this.renderer.render(this.scene, this.camera);

		material.uniforms.mode.value = 1; // bright pass + blur
		this.renderer.setRenderTarget(this.bloomTarget);
		this.renderer.render(this.postScene, this.postCamera);

		material.uniforms.mode.value = 2; // composite
		this.renderer.setRenderTarget(null);
		this.renderer.render(this.postScene, this.postCamera);
	}

	/** Asks the Rust side for one specific frame and resolves when it lands.
	 * This is the primitive that makes an offline pass deterministic: the same
	 * event the editor uses for scrubbing. */
	requestFrame(
		playback: PlaybackStore,
		frameNumber: number,
		fps: number,
		resolutionBase: { width: number; height: number },
		timeoutMs = 2000,
	): Promise<{ frame: SocketFrame | null; deliveryMs: number }> {
		return new Promise((resolve) => {
			let settled = false;
			const requestedAt = performance.now();

			const unsubscribe = playback.subscribeFrame(() => {
				const frame = playback.getFrame();
				// The renderer echoes the requested index back, so a stale frame
				// can't be mistaken for the one that was asked for.
				if (!frame || frame.frameNumber !== frameNumber) return;

				settled = true;
				unsubscribe();
				window.clearTimeout(timer);
				// Everything from asking Rust for the frame to holding a usable
				// bitmap: render, websocket, the client's stride copy and
				// createImageBitmap. Splitting this out is what separates "the
				// renderer is slow" from "delivery is slow".
				resolve({ frame, deliveryMs: performance.now() - requestedAt });
			});

			const timer = window.setTimeout(() => {
				if (settled) return;
				unsubscribe();
				resolve({ frame: null, deliveryMs: performance.now() - requestedAt });
			}, timeoutMs);

			void events.renderFrameEvent.emit({
				frame_number: frameNumber,
				fps,
				resolution_base: {
					x: resolutionBase.width,
					y: resolutionBase.height,
				},
			});
		});
	}

	dispose() {
		this.texture?.dispose();
		this.plane.geometry.dispose();
		this.plane.material.dispose();
		this.postQuad.geometry.dispose();
		this.postQuad.material.dispose();
		this.sceneTarget.dispose();
		this.bloomTarget.dispose();
		this.renderer.dispose();
	}
}

const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const POST_FRAGMENT = /* glsl */ `
uniform sampler2D scene;
uniform sampler2D bloom;
uniform vec2 texel;
uniform int mode;
uniform float threshold;
uniform float intensity;
varying vec2 vUv;

// Nine-tap blur of everything above the threshold. Cheap on purpose: the
// prototype is measuring the cost of having a multi-pass chain at all.
vec3 brightBlur() {
	vec3 total = vec3(0.0);
	for (int x = -1; x <= 1; x++) {
		for (int y = -1; y <= 1; y++) {
			vec2 offset = vec2(float(x), float(y)) * texel * 2.0;
			vec3 sampled = texture2D(scene, vUv + offset).rgb;
			float luma = dot(sampled, vec3(0.2126, 0.7152, 0.0722));
			total += max(sampled - threshold, 0.0) * step(threshold, luma);
		}
	}
	return total / 9.0;
}

void main() {
	if (mode == 1) {
		gl_FragColor = vec4(brightBlur(), 1.0);
		return;
	}

	vec3 base = texture2D(scene, vUv).rgb;
	vec3 glow = texture2D(bloom, vUv).rgb * intensity;
	gl_FragColor = vec4(base + glow, 1.0);
}
`;
