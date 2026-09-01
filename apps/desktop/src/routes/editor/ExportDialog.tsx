import {
	Button,
	Dialog,
	DialogContent,
	DialogTitle,
	Select,
	toast,
} from "@quiro/ui";
import { Channel } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	commands,
	type ExportSettings,
	type FramesRendered,
	type GifQuality,
} from "@/utils/tauri";
import { OUTPUT_SIZE, useEditorContext } from "./context";
import { Field } from "./ui";

type Format = "mp4" | "gif" | "mov";

/** What an export actually cost, kept on screen after it finishes: an export
 * that took four minutes is worth knowing about before starting the next one. */
type ExportSummary = {
	frames: number;
	seconds: number;
	path: string;
};
type Destination = "file" | "clipboard";
type Quality = "social" | "web" | "maximum" | "potato";

/** Bits per pixel each compression level targets — also what the preview
 * renders at, so the thumbnail degrades the way the export will. */
const COMPRESSION_BPP: Record<Quality, number> = {
	maximum: 0.3,
	social: 0.15,
	web: 0.08,
	potato: 0.04,
};

/** GIF encoding quality is a 1-100 knob plus a speed-over-quality flag. */
const GIF_QUALITIES: Array<{ label: string; value: string; gif: GifQuality }> =
	[
		{ label: "Fast", value: "fast", gif: { quality: 60, fast: true } },
		{ label: "Balanced", value: "balanced", gif: { quality: 90, fast: false } },
		{ label: "Best", value: "best", gif: { quality: 100, fast: false } },
	];

const RESOLUTIONS = {
	"720p": { x: 1280, y: 720 },
	"1080p": { x: OUTPUT_SIZE.x, y: OUTPUT_SIZE.y },
	"4k": { x: 3840, y: 2160 },
} as const;

type ResolutionKey = keyof typeof RESOLUTIONS;

function buildSettings(
	format: Format,
	fps: number,
	resolution: ResolutionKey,
	quality: Quality,
	gifQuality: GifQuality | null,
): ExportSettings {
	const resolutionBase = RESOLUTIONS[resolution];

	if (format === "gif") {
		return {
			format: "Gif",
			fps,
			resolution_base: resolutionBase,
			quality: gifQuality,
		};
	}

	if (format === "mov") {
		return {
			format: "Mov",
			fps,
			resolution_base: resolutionBase,
			cursor_only: false,
		};
	}

	return {
		format: "Mp4",
		fps,
		resolution_base: resolutionBase,
		compression:
			quality === "social" ? "Social" : quality === "web" ? "Web" : "Maximum",
		custom_bpp: null,
		force_ffmpeg_decoder: false,
		optimize_filesize: false,
	};
}

/** Frames per second so far, plus a rough time remaining. */
function rate(progress: FramesRendered, elapsed: number) {
	if (elapsed <= 0 || progress.rendered_count === 0) return "…";

	const fps = progress.rendered_count / elapsed;
	const remaining = (progress.total_frames - progress.rendered_count) / fps;

	return `${fps.toFixed(1)} fps · ~${Math.max(0, Math.round(remaining))}s left`;
}

export function ExportDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { instance, prettyName, playbackTime } = useEditorContext();

	const [format, setFormat] = useState<Format>("mp4");
	const [fps, setFps] = useState(30);
	const [resolution, setResolution] = useState<ResolutionKey>("1080p");
	const [quality, setQuality] = useState<Quality>("maximum");
	const [gifQuality, setGifQuality] = useState("balanced");
	const [destination, setDestination] = useState<Destination>("file");
	const [preview, setPreview] = useState<string | null>(null);
	const [progress, setProgress] = useState<FramesRendered | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const [summary, setSummary] = useState<ExportSummary | null>(null);
	const startedAtRef = useRef(0);
	const [estimates, setEstimates] = useState<{
		sizeMb: number;
		seconds: number;
	} | null>(null);

	// One id per export so Cancel can reach the run that is already going.
	const exportIdRef = useRef<string | null>(null);
	const progressRef = useRef<FramesRendered | null>(null);
	const exporting = progress !== null;

	const settings = buildSettings(
		format,
		fps,
		resolution,
		quality,
		GIF_QUALITIES.find((option) => option.value === gifQuality)?.gif ?? null,
	);
	const settingsKey = JSON.stringify(settings);
	const projectPath = instance?.path;

	useEffect(() => {
		if (!open || !projectPath) return;

		let cancelled = false;
		void (async () => {
			const result = await commands.getExportEstimates(
				projectPath,
				JSON.parse(settingsKey) as ExportSettings,
			);
			if (cancelled || result.status === "error") return;
			setEstimates({
				sizeMb: result.data.estimated_size_mb,
				seconds: result.data.estimated_time_seconds,
			});
		})();

		return () => {
			cancelled = true;
		};
	}, [open, projectPath, settingsKey]);

	// A ticking clock while exporting, so the dialog shows progress even
	// during the long gap before the first frame is rendered.
	useEffect(() => {
		if (!exporting) return;

		const timer = window.setInterval(
			() => setElapsed((performance.now() - startedAtRef.current) / 1000),
			100,
		);
		return () => window.clearInterval(timer);
	}, [exporting]);

	// One frame at the chosen settings, so quality is judged before committing
	// to a full render. Re-rendered whenever the settings change.
	useEffect(() => {
		// Never while exporting: the preview renders a full frame through the
		// same GPU path the export is using, and competing with it slows the
		// export down for a thumbnail nobody is looking at.
		if (!open || exporting) return;

		let cancelled = false;
		const timer = window.setTimeout(() => {
			void (async () => {
				const result = await commands.generateExportPreview(playbackTime, {
					fps,
					resolution_base: RESOLUTIONS[resolution],
					compression_bpp: COMPRESSION_BPP[quality],
					cursor_only: false,
				});
				if (cancelled || result.status === "error") return;
				setPreview(`data:image/jpeg;base64,${result.data.jpeg_base64}`);
			})();
		}, 150);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [open, exporting, playbackTime, fps, resolution, quality]);

	const startExport = useCallback(async () => {
		if (!projectPath || exporting) return;

		const exportId = `export-${Date.now()}`;
		exportIdRef.current = exportId;
		startedAtRef.current = performance.now();
		setElapsed(0);
		setSummary(null);
		setProgress({ rendered_count: 0, total_frames: 0 });

		const channel = new Channel<FramesRendered>();
		channel.onmessage = (message) => {
			progressRef.current = message;
			setProgress(message);
		};

		const result =
			destination === "file"
				? await commands.exportVideoToFile(
						projectPath,
						channel,
						settings,
						exportId,
						`${prettyName}.${format}`,
						format,
					)
				: await commands.exportVideo(projectPath, channel, settings, exportId);

		const seconds = (performance.now() - startedAtRef.current) / 1000;
		const renderedFrames = progressRef.current?.total_frames ?? 0;

		exportIdRef.current = null;
		setProgress(null);

		if (result.status === "error") {
			if (
				result.error !== "Export cancelled" &&
				result.error !== "Save dialog cancelled"
			)
				toast.error(result.error);
			return;
		}

		setSummary({ frames: renderedFrames, seconds, path: result.data });

		if (destination === "clipboard") {
			// The OS clipboard takes the finished file, so the export lands in the
			// project folder first and is copied from there.
			await writeText(result.data);
			toast.success("Export path copied to clipboard");
		} else {
			toast.success("Export complete");
		}
	}, [projectPath, exporting, settings, prettyName, format, destination]);

	const cancel = () => {
		const exportId = exportIdRef.current;
		if (exportId) void commands.cancelExport(exportId);
	};

	const percent =
		progress && progress.total_frames > 0
			? Math.round((progress.rendered_count / progress.total_frames) * 100)
			: 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-96">
				<DialogTitle>Export</DialogTitle>

				<div className="flex flex-col gap-4 p-4">
					<Field name="Format">
						<Select
							value={format}
							onValueChange={(value) => setFormat(value as Format)}
							options={[
								{ label: "MP4", value: "mp4" },
								{ label: "MOV (ProRes)", value: "mov" },
								{ label: "GIF", value: "gif" },
							]}
						/>
					</Field>

					<Field name="Resolution">
						<Select
							value={resolution}
							onValueChange={(value) => setResolution(value as ResolutionKey)}
							options={[
								{ label: "720p", value: "720p" },
								{ label: "1080p", value: "1080p" },
								{ label: "4K", value: "4k" },
							]}
						/>
					</Field>

					<Field name="Frame rate">
						<Select
							value={String(fps)}
							onValueChange={(value) => setFps(Number(value))}
							options={[
								{ label: "24 fps", value: "24" },
								{ label: "30 fps", value: "30" },
								{ label: "60 fps", value: "60" },
							]}
						/>
					</Field>

					<Field name="Destination">
						<Select
							value={destination}
							onValueChange={(value) => setDestination(value as Destination)}
							options={[
								{ label: "Save to file", value: "file" },
								{ label: "Copy path to clipboard", value: "clipboard" },
							]}
						/>
					</Field>

					{format === "gif" && (
						<Field name="GIF quality">
							<Select
								value={gifQuality}
								onValueChange={(value) => setGifQuality(value ?? "balanced")}
								options={GIF_QUALITIES.map(({ label, value }) => ({
									label,
									value,
								}))}
							/>
						</Field>
					)}

					{format === "mp4" && (
						<Field name="Quality">
							<Select
								value={quality}
								onValueChange={(value) => setQuality(value as Quality)}
								options={[
									{ label: "Maximum (best)", value: "maximum" },
									{ label: "Social", value: "social" },
									{ label: "Web", value: "web" },
									{ label: "Potato (smallest)", value: "potato" },
								]}
							/>
						</Field>
					)}

					{summary && !exporting && (
						<div className="rounded-lg border border-gray-3 bg-gray-2 p-3 text-xs text-gray-11">
							<div className="font-medium text-gray-12">
								{summary.frames} frames in {summary.seconds.toFixed(1)}s
								{summary.frames > 0 &&
									` · ${(summary.frames / summary.seconds).toFixed(1)} fps`}
							</div>
							<div className="mt-1 truncate" title={summary.path}>
								{summary.path}
							</div>
						</div>
					)}

					{preview && !exporting && (
						<img
							src={preview}
							alt="Export preview"
							className="w-full rounded-lg border border-gray-3"
						/>
					)}

					{estimates && !exporting && (
						<p className="text-xs text-gray-10">
							Roughly {estimates.sizeMb.toFixed(1)} MB, about{" "}
							{Math.max(1, Math.round(estimates.seconds))}s to render.
						</p>
					)}

					{exporting && (
						<div className="flex flex-col gap-1">
							<div className="h-1.5 overflow-hidden rounded-full bg-gray-4">
								<div
									className="h-full bg-accent-700 transition-[width]"
									style={{ width: `${percent}%` }}
								/>
							</div>
							<span className="text-xs tabular-nums text-gray-10">
								{progress.total_frames > 0
									? `${progress.rendered_count} / ${progress.total_frames} frames · ${elapsed.toFixed(1)}s · ${rate(progress, elapsed)}`
									: `Preparing… ${elapsed.toFixed(1)}s`}
							</span>
						</div>
					)}

					<div className="flex justify-end gap-2">
						{exporting ? (
							<Button variant="gray" onClick={cancel}>
								Cancel
							</Button>
						) : (
							<>
								<Button variant="gray" onClick={() => onOpenChange(false)}>
									Close
								</Button>
								<Button onClick={() => void startExport()}>Export</Button>
							</>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
