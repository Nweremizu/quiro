/**
 * Camera tuning comparison harness (dev-only, issue #21).
 *
 * Renders the same zoom regions twice — once under the current defaults, once
 * under a candidate tuning — and writes a side-by-side HTML report of the
 * resulting camera trajectories.
 *
 *   npm run compare:camera-tuning
 *   npm run compare:camera-tuning -- --smoothness 0.8 --zoom-in-easing snappy
 *
 * What it compares, and why that is the right thing:
 *
 * The sweep (#29) tunes how the camera moves. That motion is fully determined
 * by the same pure functions the export renderers call — findDominantRegion,
 * computeZoomTransform, getZoomSpringConfig and stepSpringValue — so this
 * drives exactly those, and plots the scale and pan the renderer would apply.
 * It deliberately does not encode video: an MP4 would add a decode, a
 * composite and an encode on top of the trajectory without changing it, and
 * would need a real recording to run at all.
 *
 * Two traps this respects, both of which silently invalidate a comparison:
 *
 * 1. The camera spring only runs during playback. Scrubbing, seeking and
 *    Classic Animation all snap to the projected transform, so a spring change
 *    is invisible while scrubbing. Every frame here is stepped, never sampled.
 * 2. Preview steps the spring on wall-clock delta, export on content time. The
 *    solver is analytic but the target moves every frame, so the two are not
 *    bit-identical. This steps on content time — export against export — and
 *    reports the measured divergence separately.
 */

import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
	buildCameraMotionOptions,
	findDominantRegion,
} from "../src/components/editor/videoPlayback/zoomRegionUtils";
import {
	createSpringState,
	getZoomSpringConfig,
	stepSpringValue,
} from "../src/components/editor/videoPlayback/motionSmoothing";
import { computeZoomTransform } from "../src/components/editor/videoPlayback/zoomTransform";
import {
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_SMOOTHNESS,
	ZOOM_DEPTH_SCALES,
	type ZoomRegion,
	type ZoomTransitionEasing,
} from "../src/types/editor";

const FRAME_RATE = 60;
const FRAME_MS = 1000 / FRAME_RATE;
const STAGE = { width: 1920, height: 1080 };
const BASE_MASK = { x: 0, y: 0, width: 1920, height: 1080 };

interface Tuning {
	label: string;
	zoomSmoothness: number;
	cameraSpringStiffnessMultiplier: number;
	cameraSpringDampingMultiplier: number;
	cameraSpringMassMultiplier: number;
	zoomInDurationMs: number;
	zoomOutDurationMs: number;
	zoomInEasing: ZoomTransitionEasing;
	zoomOutEasing: ZoomTransitionEasing;
}

const CURRENT: Tuning = {
	label: "current defaults",
	zoomSmoothness: DEFAULT_ZOOM_SMOOTHNESS,
	cameraSpringStiffnessMultiplier: 1,
	cameraSpringDampingMultiplier: 1.13,
	cameraSpringMassMultiplier: 1.12,
	zoomInDurationMs: DEFAULT_ZOOM_IN_DURATION_MS,
	zoomOutDurationMs: DEFAULT_ZOOM_OUT_DURATION_MS,
	zoomInEasing: "quiro",
	zoomOutEasing: "quiro",
};

/**
 * A deliberately ordinary demo shape: punch in, hold, pull out, then a second
 * shallower zoom close behind it so chained motion is visible too.
 */
const REGIONS: ZoomRegion[] = [
	{
		id: "a",
		startMs: 500,
		endMs: 4000,
		depth: 4,
		focus: { cx: 0.32, cy: 0.4 },
		mode: "manual",
	},
	{
		id: "b",
		startMs: 5000,
		endMs: 8000,
		depth: 2,
		focus: { cx: 0.7, cy: 0.62 },
		mode: "manual",
	},
];
const DURATION_MS = 9000;

interface Sample {
	timeMs: number;
	scale: number;
	x: number;
	y: number;
}

/** Steps the camera exactly as an export renderer does: fixed content-time delta. */
function renderTrajectory(tuning: Tuning, deltas?: number[]): Sample[] {
	const options = buildCameraMotionOptions({
		connectZooms: true,
		zoomInDurationMs: tuning.zoomInDurationMs,
		zoomOutDurationMs: tuning.zoomOutDurationMs,
		zoomInEasing: tuning.zoomInEasing,
		zoomOutEasing: tuning.zoomOutEasing,
	});
	const config = getZoomSpringConfig(tuning.zoomSmoothness, {
		stiffnessMultiplier: tuning.cameraSpringStiffnessMultiplier,
		dampingMultiplier: tuning.cameraSpringDampingMultiplier,
		massMultiplier: tuning.cameraSpringMassMultiplier,
	});

	const springScale = createSpringState(1);
	const springX = createSpringState(0);
	const springY = createSpringState(0);
	const samples: Sample[] = [];

	let timeMs = 0;
	let frame = 0;
	while (timeMs <= DURATION_MS) {
		const { region, strength, blendedScale } = findDominantRegion(
			REGIONS,
			timeMs,
			options,
		);
		const zoomScale =
			region && strength > 0
				? (blendedScale ?? ZOOM_DEPTH_SCALES[region.depth])
				: 1;
		const focus = region && strength > 0 ? region.focus : { cx: 0.5, cy: 0.5 };
		const projected = computeZoomTransform({
			stageSize: STAGE,
			baseMask: BASE_MASK,
			zoomScale,
			zoomProgress: region && strength > 0 ? strength : 0,
			focusX: focus.cx,
			focusY: focus.cy,
		});

		const deltaMs = deltas ? deltas[frame % deltas.length] : FRAME_MS;
		samples.push({
			timeMs,
			scale: stepSpringValue(springScale, projected.scale, deltaMs, config),
			x: stepSpringValue(springX, projected.x, deltaMs, config),
			y: stepSpringValue(springY, projected.y, deltaMs, config),
		});

		timeMs += FRAME_MS;
		frame += 1;
	}

	return samples;
}

/**
 * How far a variable-rate preview drifts from a fixed-rate export.
 *
 * Jitter pattern is a plausible dropped/long-frame mix rather than a worst
 * case; the point is to know the order of magnitude, not to bound it.
 */
function measurePreviewExportDivergence(tuning: Tuning) {
	const exportRun = renderTrajectory(tuning);
	// The pattern must sum to its own length so the preview advances content
	// time at the same average rate as the export. Otherwise this measures a
	// systematic clock drift rather than the effect of uneven frame pacing,
	// which is the thing that actually differs between the two paths.
	const jitter = [0.5, 2, 1, 0.5, 1];
	const previewRun = renderTrajectory(
		tuning,
		jitter.map((multiplier) => FRAME_MS * multiplier),
	);

	let maxScale = 0;
	let maxPanPx = 0;
	// Divergence that survives once the camera has settled would be a real
	// error; divergence only while the camera is moving is a timing artefact
	// that closes itself. They warrant very different responses, so measure
	// both. "Settled" = the tail of the clip, after the last zoom has ended.
	let settledScale = 0;
	let settledPanPx = 0;
	for (let i = 0; i < exportRun.length; i += 1) {
		const scaleDelta = Math.abs(exportRun[i].scale - previewRun[i].scale);
		const panDelta = Math.hypot(
			exportRun[i].x - previewRun[i].x,
			exportRun[i].y - previewRun[i].y,
		);
		maxScale = Math.max(maxScale, scaleDelta);
		maxPanPx = Math.max(maxPanPx, panDelta);
		if (exportRun[i].timeMs > 8500) {
			settledScale = Math.max(settledScale, scaleDelta);
			settledPanPx = Math.max(settledPanPx, panDelta);
		}
	}
	return { maxScale, maxPanPx, settledScale, settledPanPx };
}

function parseArgs(): Tuning {
	const args = process.argv.slice(2);
	const read = (flag: string) => {
		const i = args.indexOf(`--${flag}`);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const num = (flag: string, fallback: number) => {
		const raw = read(flag);
		const parsed = raw === undefined ? Number.NaN : Number(raw);
		return Number.isFinite(parsed) ? parsed : fallback;
	};
	const easing = (flag: string, fallback: ZoomTransitionEasing) =>
		(read(flag) as ZoomTransitionEasing | undefined) ?? fallback;

	return {
		label: "candidate",
		zoomSmoothness: num("smoothness", 0.7),
		cameraSpringStiffnessMultiplier: num("stiffness", CURRENT.cameraSpringStiffnessMultiplier),
		cameraSpringDampingMultiplier: num("damping", CURRENT.cameraSpringDampingMultiplier),
		cameraSpringMassMultiplier: num("mass", CURRENT.cameraSpringMassMultiplier),
		zoomInDurationMs: num("zoom-in-ms", CURRENT.zoomInDurationMs),
		zoomOutDurationMs: num("zoom-out-ms", CURRENT.zoomOutDurationMs),
		zoomInEasing: easing("zoom-in-easing", CURRENT.zoomInEasing),
		zoomOutEasing: easing("zoom-out-easing", CURRENT.zoomOutEasing),
	};
}

function polyline(samples: Sample[], pick: (s: Sample) => number, min: number, max: number) {
	const span = max - min || 1;
	return samples
		.map((s) => {
			const px = (s.timeMs / DURATION_MS) * 960;
			const py = 220 - ((pick(s) - min) / span) * 200;
			return `${px.toFixed(1)},${py.toFixed(1)}`;
		})
		.join(" ");
}

function chart(title: string, a: Sample[], b: Sample[], pick: (s: Sample) => number) {
	const values = [...a, ...b].map(pick);
	const min = Math.min(...values);
	const max = Math.max(...values);
	return `
    <section>
      <h2>${title}</h2>
      <svg viewBox="0 0 960 240" width="100%" height="240" role="img">
        <rect x="0" y="0" width="960" height="240" fill="#0e0e12" />
        <polyline points="${polyline(a, pick, min, max)}" fill="none" stroke="#7dd3fc" stroke-width="2" />
        <polyline points="${polyline(b, pick, min, max)}" fill="none" stroke="#f0a030" stroke-width="2" />
      </svg>
      <p class="range">min ${min.toFixed(3)} · max ${max.toFixed(3)}</p>
    </section>`;
}

function main() {
	const candidate = parseArgs();
	const currentRun = renderTrajectory(CURRENT);
	const candidateRun = renderTrajectory(candidate);
	const divergence = measurePreviewExportDivergence(CURRENT);

	const describe = (t: Tuning) =>
		`smoothness ${t.zoomSmoothness} · spring ${t.cameraSpringStiffnessMultiplier}/${t.cameraSpringDampingMultiplier}/${t.cameraSpringMassMultiplier} · ` +
		`in ${Math.round(t.zoomInDurationMs)}ms ${t.zoomInEasing} · out ${Math.round(t.zoomOutDurationMs)}ms ${t.zoomOutEasing}`;

	const html = `<!doctype html>
<meta charset="utf-8">
<title>Camera tuning comparison</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; background: #08080b; color: #e6e6ea; margin: 24px auto; max-width: 1000px; }
  h1 { font-size: 18px; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #9b9ba6; }
  .key { display: flex; gap: 24px; margin-bottom: 20px; }
  .swatch { display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: -1px; }
  .range { color: #6f6f7a; font-size: 12px; margin-top: 4px; }
  .note { border-left: 2px solid #2a2a33; padding-left: 12px; color: #9b9ba6; }
</style>
<h1>Camera tuning comparison</h1>
<div class="key">
  <div><span class="swatch" style="background:#7dd3fc"></span><strong>${CURRENT.label}</strong><br>${describe(CURRENT)}</div>
  <div><span class="swatch" style="background:#f0a030"></span><strong>${candidate.label}</strong><br>${describe(candidate)}</div>
</div>
${chart("Camera scale", currentRun, candidateRun, (s) => s.scale)}
${chart("Pan X (stage px)", currentRun, candidateRun, (s) => s.x)}
${chart("Pan Y (stage px)", currentRun, candidateRun, (s) => s.y)}
<p class="note">
  Both sides use identical source regions and duration; only the tuning differs.
  Every frame is stepped through the spring at a fixed ${FRAME_RATE}fps content-time
  delta, matching the export path — the camera spring does not run while
  scrubbing, so scrubbed frames cannot be used to judge a spring change.
</p>
<p class="note">
  Preview vs export divergence at the current defaults, over this clip with a
  jittered frame delta whose mean matches the export rate.
  Peak while moving: scale ${divergence.maxScale.toExponential(2)},
  pan ${divergence.maxPanPx.toFixed(2)} stage px of 1920.
  Once settled: scale ${divergence.settledScale.toExponential(2)},
  pan ${divergence.settledPanPx.toExponential(2)} px.
</p>
`;

	// release/ is already gitignored, so the report never shows up as a
	// stray untracked file after a comparison run.
	const dir = resolve(process.cwd(), "release");
	mkdirSync(dir, { recursive: true });
	const out = resolve(dir, "camera-tuning-comparison.html");
	writeFileSync(out, html);
	console.log(`wrote ${out}`);
	console.log(
		`preview/export divergence while moving — scale ${divergence.maxScale.toExponential(3)}, pan ${divergence.maxPanPx.toFixed(3)}px of ${STAGE.width}`,
	);
	console.log(
		`preview/export divergence once settled — scale ${divergence.settledScale.toExponential(3)}, pan ${divergence.settledPanPx.toExponential(3)}px`,
	);
}

main();
