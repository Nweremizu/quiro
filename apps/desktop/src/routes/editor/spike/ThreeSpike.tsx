import { Button, cn, Select } from "@quiro/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "@/utils/tauri";
import { useEditorContext } from "../context";
import { SCENE_PRESETS, type ScenePreset, ThreeCompositor } from "./compositor";
import { type StreamFrame, streamFrames } from "./frame-stream";

// Throwaway harness for the "Rust = media engine, Three.js = compositor"
// prototype. It answers one question with numbers: can a frontend-composited
// export sustain a useful frame rate end to end?
//
// Pipeline under test:
//   Rust preview socket -> texture upload -> Three.js scene + post -> readback
//   -> WebCodecs VideoEncoder -> Rust (written to disk)
//
// Delete this directory and the three_spike Rust module and nothing else in
// the app changes.

const RESOLUTIONS = {
	"1080p": { width: 1920, height: 1080 },
	"4k": { width: 3840, height: 2160 },
} as const;

type ResolutionKey = keyof typeof RESOLUTIONS;

/** What fraction of the output resolution Rust is asked to render per frame.
 * Delivery cost that scales with this is transport; cost that doesn't is the
 * renderer's own latency. */
const SOURCE_SCALES = { "100%": 1, "50%": 0.5, "25%": 0.25 } as const;

type SourceScaleKey = keyof typeof SOURCE_SCALES;

/** `scrub` asks Rust for one frame at a time over the watch-channel preview
 * API, so rendering and compositing can never overlap. `stream` has Rust
 * render the whole range into a queue, which is what an export would do.
 * `drain` streams but composites nothing: it isolates what Rust can do when
 * Three.js isn't competing for the same GPU. `drain-nv12` drains the NV12
 * export path instead, to compare the two renderers directly — the frontend
 * can't decode NV12 yet, so it only measures Rust. */
const FEEDS = ["stream", "drain", "drain-nv12", "scrub"] as const;

type Feed = (typeof FEEDS)[number];

type Stats = {
	frames: number;
	/** Wall-clock frames per second across the whole chain. */
	fps: number;
	uploadMs: number;
	renderMs: number;
	encodeMs: number;
	droppedFrames: number;
	encodedBytes: number;
	heapMb: number | null;
};

const EMPTY_STATS: Stats = {
	frames: 0,
	fps: 0,
	uploadMs: 0,
	renderMs: 0,
	encodeMs: 0,
	droppedFrames: 0,
	encodedBytes: 0,
	heapMb: null,
};

/** Rolling mean, so a single slow frame doesn't dominate the readout. */
function mean(samples: number[]) {
	if (samples.length === 0) return 0;
	return samples.reduce((total, value) => total + value, 0) / samples.length;
}

export function ThreeSpike({ onClose }: { onClose: () => void }) {
	const { playback, duration } = useEditorContext();

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const compositorRef = useRef<ThreeCompositor | null>(null);

	const [resolution, setResolution] = useState<ResolutionKey>("1080p");
	const [preset, setPreset] = useState<ScenePreset>("tilt-bloom");
	const [sourceScale, setSourceScale] = useState<SourceScaleKey>("100%");
	const [feed, setFeed] = useState<Feed>("stream");
	const [stats, setStats] = useState<Stats>(EMPTY_STATS);
	const [encoding, setEncoding] = useState(false);
	const [report, setReport] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// --- live preview: composite whatever the editor last rendered ----------
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		let compositor: ThreeCompositor;
		try {
			compositor = new ThreeCompositor(canvas, RESOLUTIONS[resolution]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			return;
		}

		compositorRef.current = compositor;
		compositor.setPreset(preset);

		const uploads: number[] = [];
		const renders: number[] = [];
		let frames = 0;
		let startedAt = performance.now();

		const unsubscribe = playback.subscribeFrame(() => {
			const frame = playback.getFrame();
			if (!frame) return;

			const uploadStart = performance.now();
			compositor.uploadFrame(frame.bitmap, frame.width, frame.height);
			const renderStart = performance.now();
			compositor.render();
			const done = performance.now();

			uploads.push(renderStart - uploadStart);
			renders.push(done - renderStart);
			if (uploads.length > 60) uploads.shift();
			if (renders.length > 60) renders.shift();
			frames += 1;

			const elapsed = (done - startedAt) / 1000;
			if (elapsed >= 0.5) {
				const memory = (
					performance as Performance & { memory?: { usedJSHeapSize: number } }
				).memory;

				setStats((current) => ({
					...current,
					frames: current.frames + frames,
					fps: frames / elapsed,
					uploadMs: mean(uploads),
					renderMs: mean(renders),
					heapMb: memory ? memory.usedJSHeapSize / (1024 * 1024) : null,
				}));
				frames = 0;
				startedAt = done;
			}
		});

		return () => {
			unsubscribe();
			compositor.dispose();
			compositorRef.current = null;
		};
	}, [playback, resolution, preset]);

	// --- offline export: step every frame through the same scene ------------
	const runExport = useCallback(async () => {
		const compositor = compositorRef.current;
		if (!compositor || encoding) return;

		if (typeof VideoEncoder === "undefined") {
			setError("WebCodecs VideoEncoder is unavailable in this webview");
			return;
		}

		setEncoding(true);
		setError(null);
		setReport(null);

		const { width, height } = RESOLUTIONS[resolution];
		const fps = 30;
		// Cap the run: this measures throughput, it does not need the whole
		// recording.
		const totalFrames = Math.min(Math.ceil(duration * fps), fps * 10);

		const encodeSamples: number[] = [];
		const deliverySamples: number[] = [];
		const ipcSamples: number[] = [];
		const pendingWrites: Promise<unknown>[] = [];
		let encodedBytes = 0;
		let dropped = 0;

		try {
			const begin = await commands.spikeBeginCapture(
				`${resolution}-${preset}-${Date.now()}`,
			);
			if (begin.status === "error") throw new Error(begin.error);

			const encoder = new VideoEncoder({
				output: (chunk) => {
					const buffer = new Uint8Array(chunk.byteLength);
					chunk.copyTo(buffer);
					encodedBytes += buffer.byteLength;

					// NOTE: tauri-specta types this as `number[]`, so the chunk goes
					// over IPC as a JSON array — roughly 5 bytes of JSON per byte of
					// payload. A real implementation would use a raw-bytes channel,
					// so treat the measured hop cost as an upper bound, not the
					// achievable one.
					const startedAt = performance.now();
					pendingWrites.push(
						commands
							.spikeWriteChunk(Array.from(buffer))
							.then(() => ipcSamples.push(performance.now() - startedAt)),
					);
				},
				error: (cause) => setError(`Encoder: ${cause.message}`),
			});

			encoder.configure({
				codec: "avc1.640033",
				width,
				height,
				bitrate: resolution === "4k" ? 40_000_000 : 12_000_000,
				framerate: fps,
				latencyMode: "quality",
			});

			const scale = SOURCE_SCALES[sourceScale];
			const resolutionBase = {
				// Alignment the GPU readback path requires.
				width: (Math.round(width * scale) + 3) & ~3,
				height: (Math.round(height * scale) + 1) & ~1,
			};

			const startedAt = performance.now();
			const stream =
				feed === "scrub"
					? null
					: streamFrames(
							fps,
							resolutionBase,
							feed === "drain-nv12",
							totalFrames,
						);
			let waitedSince = performance.now();

			for (let index = 0; index < totalFrames; index++) {
				let frame: StreamFrame | null;

				if (stream) {
					const next = await stream.next();
					frame = next.done ? null : next.value;
					// Time spent waiting on Rust. Once compositing overlaps
					// rendering this should fall towards zero, which is the whole
					// point of the stream feed.
					deliverySamples.push(performance.now() - waitedSince);
					if (!frame) break;
				} else {
					const requested = await compositor.requestFrame(
						playback,
						index,
						fps,
						resolutionBase,
					);
					frame = requested.frame;
					deliverySamples.push(requested.deliveryMs);
				}

				if (!frame) {
					dropped += 1;
					continue;
				}

				if (feed !== "stream" || !frame.bitmap) {
					frame.bitmap?.close();
					waitedSince = performance.now();
					continue;
				}

				compositor.uploadFrame(frame.bitmap, frame.width, frame.height);
				compositor.render();

				const encodeStart = performance.now();
				const videoFrame = new VideoFrame(compositor.canvas, {
					timestamp: Math.round((index / fps) * 1_000_000),
					duration: Math.round(1_000_000 / fps),
				});
				encoder.encode(videoFrame, { keyFrame: index % (fps * 2) === 0 });
				videoFrame.close();
				encodeSamples.push(performance.now() - encodeStart);

				// Let the encoder drain so its queue can't hide the real cost.
				if (encoder.encodeQueueSize > 8) {
					await new Promise((resolve) => setTimeout(resolve, 0));
				}

				waitedSince = performance.now();
			}

			await stream?.return(undefined);

			await encoder.flush();
			encoder.close();
			// Every chunk must be on disk before the run is timed, or the hop
			// cost hides behind the loop.
			await Promise.all(pendingWrites);

			const seconds = (performance.now() - startedAt) / 1000;
			const finish = await commands.spikeFinishCapture();
			if (finish.status === "error") throw new Error(finish.error);

			setStats((current) => ({
				...current,
				encodeMs: mean(encodeSamples),
				droppedFrames: dropped,
				encodedBytes,
			}));

			setReport(
				[
					`${resolution} · ${preset} · source ${sourceScale} · ${feed}`,
					`${totalFrames} frames in ${seconds.toFixed(2)}s = ${(totalFrames / seconds).toFixed(1)} fps`,
					`realtime factor: ${(totalFrames / fps / seconds).toFixed(2)}x`,
					`delivery ${mean(deliverySamples).toFixed(1)}ms/frame  <-- ${feed === "scrub" ? "rust render + transport + bitmap" : "stall waiting on rust"}`,
					`encode ${mean(encodeSamples).toFixed(2)}ms/frame · dropped ${dropped}`,
					`ipc to rust ${mean(ipcSamples).toFixed(2)}ms/chunk (JSON-encoded, upper bound)`,
					`${(finish.data.bytes / (1024 * 1024)).toFixed(1)} MB written`,
					finish.data.path,
				].join("\n"),
			);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setEncoding(false);
		}
	}, [encoding, resolution, preset, sourceScale, feed, duration, playback]);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm font-medium text-gray-12">
					Three.js compositor prototype
				</span>

				<Select
					className="h-9 w-28"
					value={resolution}
					onValueChange={(value) => setResolution(value as ResolutionKey)}
					options={[
						{ label: "1080p", value: "1080p" },
						{ label: "4K", value: "4k" },
					]}
				/>

				<Select
					className="h-9 w-44"
					value={preset}
					onValueChange={(value) => setPreset(value as ScenePreset)}
					options={SCENE_PRESETS.map((value) => ({ label: value, value }))}
				/>

				<Select
					className="h-9 w-28"
					value={sourceScale}
					onValueChange={(value) => setSourceScale(value as SourceScaleKey)}
					options={Object.keys(SOURCE_SCALES).map((value) => ({
						label: `src ${value}`,
						value,
					}))}
				/>

				<Select
					className="h-9 w-28"
					value={feed}
					onValueChange={(value) => setFeed(value as Feed)}
					options={FEEDS.map((value) => ({ label: value, value }))}
				/>

				<Button
					variant="gray"
					disabled={encoding}
					onClick={() => void runExport()}
				>
					{encoding ? "Encoding…" : "Run export benchmark"}
				</Button>

				<Button variant="gray" className="ml-auto" onClick={onClose}>
					Back to player
				</Button>
			</div>

			<div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
				<canvas ref={canvasRef} className="size-full object-contain" />
			</div>

			<div className="grid grid-cols-2 gap-3 text-xs text-gray-11 md:grid-cols-4">
				<Stat label="preview fps" value={stats.fps.toFixed(1)} />
				<Stat label="upload" value={`${stats.uploadMs.toFixed(2)} ms`} />
				<Stat label="scene + post" value={`${stats.renderMs.toFixed(2)} ms`} />
				<Stat
					label="js heap"
					value={stats.heapMb ? `${stats.heapMb.toFixed(0)} MB` : "n/a"}
				/>
			</div>

			{(report || error) && (
				<pre
					className={cn(
						"max-h-40 overflow-auto rounded-lg border p-3 font-mono text-[11px] whitespace-pre-wrap",
						error
							? "border-red-5 bg-red-2 text-red-11"
							: "border-gray-3 bg-gray-2 text-gray-12",
					)}
				>
					{error ?? report}
				</pre>
			)}
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border border-gray-3 bg-gray-2 px-3 py-2">
			<div className="text-[10px] uppercase tracking-wide text-gray-10">
				{label}
			</div>
			<div className="text-sm tabular-nums text-gray-12">{value}</div>
		</div>
	);
}
