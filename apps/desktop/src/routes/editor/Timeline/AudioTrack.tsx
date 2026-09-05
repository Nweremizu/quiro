import { useEffect, useMemo, useRef, useState } from "react";
import { type AudioTrackSegment, commands } from "@/utils/tauri";
import { mergeSpans } from "../clip-merge";
import { useEditorContext } from "../context";
import { useTimeline } from "./context";
import { SegmentTrack } from "./SegmentTrack";

// The recording's own microphone and system audio are not editable segments —
// they belong to the clips — so this track draws them as a waveform backdrop
// and lays any imported audio segments on top.

/** dBFS levels, one per 100ms, as the backend reports them. */
const SAMPLE_SECONDS = 0.1;
const FLOOR_DB = -60;

function useWaveform(
	load: () => Promise<{ status: "ok"; data: number[][] } | { status: "error" }>,
) {
	const [levels, setLevels] = useState<number[]>([]);
	const loadRef = useRef(load);
	loadRef.current = load;

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			// Decoding every track is expensive, so this runs once per mount —
			// waveforms describe the source audio, which editing never changes.
			const result = await loadRef.current();
			if (cancelled || result.status === "error") return;
			// One waveform per recording segment; concatenated, they line up with
			// the timeline as long as no clip has been trimmed.
			setLevels(result.data.flat());
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	return levels;
}

function Waveform({
	levels,
	className,
}: {
	levels: number[];
	className: string;
}) {
	const timeline = useTimeline();
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			// Same guard as the player's ResizeObserver: an unconditional
			// setState here creates a new object on every tick, even a
			// redundant one fired by an unrelated layout pass elsewhere on
			// the page, forcing a canvas resize that reads as a shift.
			setSize((current) =>
				current.width === width && current.height === height
					? current
					: { width, height },
			);
		});
		observer.observe(canvas);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !context || size.width === 0 || levels.length === 0) return;

		const dpr = window.devicePixelRatio || 1;
		canvas.width = size.width * dpr;
		canvas.height = size.height * dpr;
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, size.width, size.height);
		context.fillStyle = "rgba(255,255,255,0.55)";

		// One bar per pixel column, reading whichever sample that column lands on.
		for (let x = 0; x < size.width; x++) {
			const time = timeline.position + x / timeline.pixelsPerSecond;
			const sample = levels[Math.floor(time / SAMPLE_SECONDS)];
			if (sample === undefined) continue;

			const level = Math.min(Math.max((sample - FLOOR_DB) / -FLOOR_DB, 0), 1);
			const height = Math.max(level * size.height, 1);
			context.fillRect(x, (size.height - height) / 2, 1, height);
		}
	}, [levels, size, timeline.position, timeline.pixelsPerSecond]);

	return <canvas ref={canvasRef} className={className} />;
}

export function AudioTrack() {
	const { project, setProject, instance } = useEditorContext();

	const micLevels = useWaveform(() => commands.getMicWaveforms());
	const systemLevels = useWaveform(() => commands.getSystemAudioWaveforms());

	const hasMic = useMemo(
		() => instance?.recordings.segments.some((segment) => segment.mic !== null),
		[instance],
	);
	const hasSystemAudio = useMemo(
		() =>
			instance?.recordings.segments.some(
				(segment) => segment.system_audio !== null,
			),
		[instance],
	);

	return (
		<>
			<div className="absolute inset-0 overflow-hidden rounded-xl bg-[var(--track-audio)]/25">
				{hasMic && (
					<Waveform
						levels={micLevels}
						className="absolute inset-x-0 top-0 h-1/2 w-full"
					/>
				)}
				{hasSystemAudio && (
					<Waveform
						levels={systemLevels}
						className="absolute inset-x-0 bottom-0 h-1/2 w-full"
					/>
				)}
			</div>

			<SegmentTrack<AudioTrackSegment>
				segments={project?.timeline?.audioSegments ?? []}
				color="var(--track-audio)"
				selectionType="audio"
				label={(segment) => segment.name || "Audio"}
				onChange={(index, next) =>
					setProject((current) =>
						current.timeline
							? {
									...current,
									timeline: {
										...current.timeline,
										audioSegments: (current.timeline.audioSegments ?? []).map(
											(segment, i) => (i === index ? next : segment),
										),
									},
								}
							: current,
					)
				}
				onMerge={(index) =>
					setProject((current) =>
						current.timeline
							? {
									...current,
									timeline: {
										...current.timeline,
										audioSegments: mergeSpans(
											current.timeline.audioSegments ?? [],
											index,
										),
									},
								}
							: current,
					)
				}
				onDelete={(index) =>
					setProject((current) =>
						current.timeline
							? {
									...current,
									timeline: {
										...current.timeline,
										audioSegments: (
											current.timeline.audioSegments ?? []
										).filter((_, i) => i !== index),
									},
								}
							: current,
					)
				}
			/>
		</>
	);
}
