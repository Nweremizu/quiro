import {
	Button,
	cn,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Select,
	Switch,
	toast,
} from "@quiro/ui";
import { Channel } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	commands,
	type ExportSettings,
	type FramesRendered,
	type GifQuality,
} from "@/utils/tauri";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideCheckCircle2 from "~icons/lucide/check-circle-2";
import IconLucideClipboard from "~icons/lucide/clipboard";
import IconLucideFilm from "~icons/lucide/film";
import IconLucideFolderDown from "~icons/lucide/folder-down";
import IconLucideGauge from "~icons/lucide/gauge";
import IconLucideLoaderCircle from "~icons/lucide/loader-circle";
import IconLucideUpload from "~icons/lucide/upload";
import { saveCaptionFile } from "./caption-export";
import { OUTPUT_SIZE, useEditorContext } from "./context";

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
type GifQualityKey = "fast" | "balanced" | "best";

/** Bits per pixel each compression level targets — also what the preview
 * renders at, so the thumbnail degrades the way the export will. */
const COMPRESSION_BPP: Record<Quality, number> = {
	maximum: 0.3,
	social: 0.15,
	web: 0.08,
	potato: 0.04,
};

/** GIF encoding quality is a 1-100 knob plus a speed-over-quality flag. */
const GIF_QUALITIES: Array<{
	label: string;
	value: GifQualityKey;
	gif: GifQuality;
}> = [
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

const FORMAT_OPTIONS: Array<{
	value: Format;
	label: string;
	detail: string;
}> = [
	{ value: "mp4", label: "MP4", detail: "Universal" },
	{ value: "mov", label: "MOV", detail: "ProRes" },
	{ value: "gif", label: "GIF", detail: "Looping" },
];

const QUALITY_OPTIONS: Array<{
	value: Quality;
	label: string;
	detail: string;
}> = [
	{ value: "maximum", label: "Maximum", detail: "Best detail" },
	{ value: "social", label: "Social", detail: "Balanced" },
	{ value: "web", label: "Web", detail: "Smaller file" },
	{ value: "potato", label: "Tiny", detail: "Smallest" },
];

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
		custom_bpp: quality === "potato" ? COMPRESSION_BPP.potato : null,
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
	const { instance, prettyName, playback, project, setProject } =
		useEditorContext();

	const [format, setFormat] = useState<Format>("mp4");
	const [fps, setFps] = useState(30);
	const [resolution, setResolution] = useState<ResolutionKey>("1080p");
	const [quality, setQuality] = useState<Quality>("maximum");
	const [gifQuality, setGifQuality] = useState<GifQualityKey>("balanced");
	const [destination, setDestination] = useState<Destination>("file");
	const [preview, setPreview] = useState<string | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
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
	const previewCompressionBpp =
		format === "gif"
			? { fast: 0.06, balanced: 0.12, best: 0.2 }[gifQuality]
			: format === "mov"
				? COMPRESSION_BPP.maximum
				: COMPRESSION_BPP[quality];

	useEffect(() => {
		if (!open || !projectPath) return;

		let cancelled = false;
		setEstimates(null);
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

	useEffect(() => {
		if (!open || exporting) return;

		let cancelled = false;
		let unsubscribe: (() => void) | undefined;
		setPreviewLoading(true);

		const capture = () => {
			if (cancelled) return false;
			const frame = playback.getFrame();
			if (!frame) return false;

			const scale = Math.min(1, 1280 / frame.width);
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(frame.width * scale));
			canvas.height = Math.max(1, Math.round(frame.height * scale));
			const context = canvas.getContext("2d");
			if (!context) return false;

			context.drawImage(frame.bitmap, 0, 0, canvas.width, canvas.height);
			const quality = Math.min(
				0.95,
				Math.max(
					0.4,
					((previewCompressionBpp - 0.04) / (0.3 - 0.04)) * (0.95 - 0.4) + 0.4,
				),
			);
			setPreview(canvas.toDataURL("image/jpeg", quality));
			setPreviewLoading(false);
			return true;
		};

		unsubscribe = playback.subscribeFrame(() => {
			if (!capture()) return;
			unsubscribe?.();
			unsubscribe = undefined;
		});
		if (capture()) {
			unsubscribe();
			unsubscribe = undefined;
		}

		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [open, exporting, playback, previewCompressionBpp]);

	const startExport = useCallback(async () => {
		if (!projectPath || exporting) return;
		if (project) {
			const saved = await commands.setProjectConfig(project);
			if (saved.status === "error") {
				toast.error(saved.error);
				return;
			}
		}

		const exportId = `export-${Date.now()}`;
		exportIdRef.current = exportId;
		progressRef.current = null;
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
		const renderedFrames =
			(progressRef.current as FramesRendered | null)?.total_frames ?? 0;

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
	}, [
		projectPath,
		exporting,
		project,
		settings,
		prettyName,
		format,
		destination,
	]);

	const cancel = () => {
		const exportId = exportIdRef.current;
		if (exportId) void commands.cancelExport(exportId);
	};

	const percent =
		progress && progress.total_frames > 0
			? Math.round((progress.rendered_count / progress.total_frames) * 100)
			: 0;

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && exporting) return;
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent
				className={cn(
					"flex h-[min(44rem,75vh)] w-[min(48rem,75vw)]! max-w-none flex-col overflow-hidden overscroll-contain p-0",
					exporting && "[&>button:last-child]:hidden",
				)}
			>
				<DialogHeader className="shrink-0 flex-row items-center gap-3 py-4 ps-5 pe-12">
					<div className="shrink-0 flex-row items-center gap-3  flex">
						<div className="gray-button-shadow grid size-9 shrink-0 place-items-center rounded-xl bg-gray-3 text-gray-11">
							<IconLucideUpload aria-hidden="true" className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle>Export video</DialogTitle>
							<p className="mt-0.5 truncate text-xs text-gray-10">
								{prettyName}.{format}
							</p>
						</div>
						<div className="ms-auto hidden items-center gap-2 rounded-xl bg-gray-3 px-3 py-2 text-xs tabular-nums text-gray-10 sm:flex">
							<span className="font-semibold text-gray-12">
								{RESOLUTIONS[resolution].x} × {RESOLUTIONS[resolution].y}
							</span>
							<span className="text-gray-8">·</span>
							<span>{fps} fps</span>
						</div>
					</div>
				</DialogHeader>

				<div className="custom-scroll grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_19rem] gap-4 overflow-y-auto bg-gray-2 p-4 max-[900px]:grid-cols-1">
					<div className="flex min-h-72 flex-col gap-3">
						<div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl bg-gray-3 p-2 shadow-[inset_0_1px_3px_oklch(0_0_0/0.08)]">
							<div className="relative flex aspect-video max-h-full w-full items-center justify-center overflow-hidden rounded-lg bg-gray-12">
								{preview ? (
									<img
										src={preview}
										alt="Export preview"
										className="size-full object-contain outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
									/>
								) : (
									<div className="flex flex-col items-center gap-2 text-gray-8">
										<IconLucideFilm aria-hidden="true" className="size-7" />
										<span className="text-xs">Preparing preview…</span>
									</div>
								)}

								{previewLoading && !exporting && (
									<div className="pointer-events-none absolute end-3 top-3 grid size-8 place-items-center rounded-full bg-gray-12/70 text-gray-1 shadow-lg backdrop-blur-sm">
										<IconLucideLoaderCircle
											aria-hidden="true"
											className="size-4 animate-spin motion-reduce:animate-none"
										/>
									</div>
								)}

								<div className="pointer-events-none absolute start-3 top-3 flex items-center gap-1.5 rounded-lg bg-gray-12/70 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-1 shadow-lg backdrop-blur-sm">
									{format} · {resolution}
								</div>

								{exporting && (
									<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-12/72 px-10 text-gray-1 backdrop-blur-sm">
										<IconLucideLoaderCircle
											aria-hidden="true"
											className="size-8 animate-spin motion-reduce:animate-none"
										/>
										<p className="text-sm font-semibold">
											{progress.total_frames > 0
												? `Exporting ${percent}%`
												: "Preparing export"}
										</p>
										<div
											role="progressbar"
											aria-label="Export progress"
											aria-valuemin={0}
											aria-valuemax={100}
											aria-valuenow={percent}
											className="h-1.5 w-full max-w-72 overflow-hidden rounded-full bg-gray-1/20"
										>
											<div
												className="h-full rounded-full bg-accent-solid transition-[width] duration-100 motion-reduce:transition-none"
												style={{ width: `${percent}%` }}
											/>
										</div>
									</div>
								)}
							</div>
						</div>

						<div className="grid grid-cols-2 gap-2">
							<div className="rounded-xl bg-gray-3 px-3 py-2.5">
								<p className="text-[10px] font-medium uppercase tracking-wide text-gray-9">
									Estimated size
								</p>
								<p className="mt-1 text-sm font-semibold tabular-nums text-gray-12">
									{estimates
										? `${estimates.sizeMb.toFixed(1)} MB`
										: "Calculating…"}
								</p>
							</div>
							<div className="rounded-xl bg-gray-3 px-3 py-2.5">
								<p className="text-[10px] font-medium uppercase tracking-wide text-gray-9">
									Render time
								</p>
								<p className="mt-1 text-sm font-semibold tabular-nums text-gray-12">
									{estimates
										? `About ${Math.max(1, Math.round(estimates.seconds))}s`
										: "Calculating…"}
								</p>
							</div>
						</div>

						{summary && !exporting && (
							<div
								role="status"
								className="flex items-start gap-2.5 rounded-xl bg-gray-3 px-3 py-2.5 text-xs text-gray-10"
							>
								<IconLucideCheckCircle2
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-accent-text"
								/>
								<div className="min-w-0">
									<p className="font-semibold text-gray-12">
										Exported {summary.frames} frames in{" "}
										{summary.seconds.toFixed(1)}s
									</p>
									<p className="mt-0.5 truncate" title={summary.path}>
										{summary.path}
									</p>
								</div>
							</div>
						)}
					</div>

					<div className="custom-scroll min-h-0 overflow-y-auto rounded-2xl bg-gray-1 p-4 shadow-[0_0_0_1px_oklch(0_0_0/0.06),0_2px_4px_oklch(0_0_0/0.04)] max-[900px]:overflow-visible dark:shadow-[0_0_0_1px_oklch(1_0_0/0.08)]">
						<div className="flex flex-col gap-5">
							<fieldset disabled={exporting}>
								<legend className="mb-2 text-xs font-semibold text-gray-12">
									Format
								</legend>
								<div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-3 p-1">
									{FORMAT_OPTIONS.map((option) => {
										const selected = format === option.value;
										return (
											<button
												key={option.value}
												type="button"
												aria-pressed={selected}
												onClick={() => setFormat(option.value)}
												className={cn(
													"flex min-h-8 flex-col items-center justify-center rounded-lg px-1 outline-none transition-[background-color,color,scale] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.96] disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none",
													selected
														? "bg-gray-1 text-gray-12 gray-button-shadow!"
														: "text-gray-10 hover:bg-gray-4 hover:text-gray-12",
												)}
											>
												<span className="text-[11px] font-bold">
													{option.label}
												</span>
											</button>
										);
									})}
								</div>
							</fieldset>

							<fieldset disabled={exporting}>
								<legend className="mb-2 text-xs font-semibold text-gray-12">
									Output
								</legend>
								<div className="grid grid-cols-2 gap-2">
									<label className="flex flex-col gap-1.5 text-[10px] font-medium text-gray-9">
										Resolution
										<Select
											disabled={exporting}
											className="w-full!"
											value={resolution}
											onValueChange={(value) =>
												setResolution(value as ResolutionKey)
											}
											options={[
												{ label: "720p", value: "720p" },
												{ label: "1080p", value: "1080p" },
												{ label: "4K", value: "4k" },
											]}
										/>
									</label>
									<label className="flex flex-col gap-1.5 text-[10px] font-medium text-gray-9">
										Frame rate
										<Select
											disabled={exporting}
											className="w-full!"
											value={String(fps)}
											onValueChange={(value) => setFps(Number(value))}
											options={[
												{ label: "24 fps", value: "24" },
												{ label: "30 fps", value: "30" },
												{ label: "60 fps", value: "60" },
											]}
										/>
									</label>
								</div>
							</fieldset>

							<fieldset disabled={exporting}>
								<legend className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-12">
									<IconLucideGauge
										aria-hidden="true"
										className="size-3.5 text-gray-9"
									/>
									Quality
								</legend>
								{format === "mp4" ? (
									<div className="grid grid-cols-2 gap-2">
										{QUALITY_OPTIONS.map((option) => (
											<ExportChoice
												key={option.value}
												label={option.label}
												detail={option.detail}
												selected={quality === option.value}
												disabled={exporting}
												onSelect={() => setQuality(option.value)}
											/>
										))}
									</div>
								) : format === "gif" ? (
									<div className="grid grid-cols-3 gap-2">
										{GIF_QUALITIES.map((option) => (
											<ExportChoice
												key={option.value}
												label={option.label}
												selected={gifQuality === option.value}
												disabled={exporting}
												onSelect={() => setGifQuality(option.value)}
											/>
										))}
									</div>
								) : (
									<div className="rounded-xl bg-gray-3 px-3 py-2.5 text-xs text-gray-10">
										<span className="font-semibold text-gray-12">ProRes</span>{" "}
										keeps editing quality with a larger file.
									</div>
								)}
							</fieldset>

							<fieldset disabled={exporting}>
								<legend className="mb-2 text-xs font-semibold text-gray-12">
									Destination
								</legend>
								{project?.captions && project.captions.segments.length > 0 && (
									<div className="mb-3 flex flex-col gap-2">
										<label className="flex items-center justify-between rounded-xl bg-gray-3 px-3 py-2.5 text-xs font-medium text-gray-12">
											Burn captions into export
											<Switch
												checked={project.captions.settings.exportWithSubtitles}
												onCheckedChange={(exportWithSubtitles) =>
													setProject((current) =>
														current.captions
															? {
																	...current,
																	captions: {
																		...current.captions,
																		settings: {
																			...current.captions.settings,
																			exportWithSubtitles,
																		},
																	},
																}
															: current,
													)
												}
											/>
										</label>
										<div className="grid grid-cols-2 gap-2">
											<Button
												variant="gray"
												onClick={() =>
													void saveCaptionFile(
														"srt",
														prettyName,
														project.timeline?.captionSegments ?? [],
													)
												}
											>
												Save SRT
											</Button>
											<Button
												variant="gray"
												onClick={() =>
													void saveCaptionFile(
														"vtt",
														prettyName,
														project.timeline?.captionSegments ?? [],
													)
												}
											>
												Save VTT
											</Button>
										</div>
									</div>
								)}
								<div className="grid grid-cols-2 gap-2">
									<ExportChoice
										label="Save file"
										detail="Choose folder"
										icon={
											<IconLucideFolderDown
												aria-hidden="true"
												className="size-4"
											/>
										}
										selected={destination === "file"}
										disabled={exporting}
										onSelect={() => setDestination("file")}
									/>
									<ExportChoice
										label="Copy path"
										detail="To clipboard"
										icon={
											<IconLucideClipboard
												aria-hidden="true"
												className="size-4"
											/>
										}
										selected={destination === "clipboard"}
										disabled={exporting}
										onSelect={() => setDestination("clipboard")}
									/>
								</div>
							</fieldset>
						</div>
					</div>
				</div>

				<DialogFooter className="shrink-0 items-center gap-3 px-5 py-4">
					<div
						role="status"
						aria-live="polite"
						className="me-auto min-w-0 truncate text-xs tabular-nums text-gray-10"
					>
						{exporting && progress.total_frames > 0
							? `${progress.rendered_count} of ${progress.total_frames} frames · ${elapsed.toFixed(1)}s · ${rate(progress, elapsed)}`
							: exporting
								? `Preparing… ${elapsed.toFixed(1)}s`
								: estimates
									? `${estimates.sizeMb.toFixed(1)} MB estimated`
									: "Ready to export"}
					</div>
					{exporting ? (
						<Button variant="gray" onClick={cancel}>
							Cancel export
						</Button>
					) : (
						<>
							<Button variant="gray" onClick={() => onOpenChange(false)}>
								Close
							</Button>
							<Button
								disabled={previewLoading}
								onClick={() => void startExport()}
							>
								<IconLucideUpload aria-hidden="true" className="size-4" />
								{previewLoading
									? "Preparing preview"
									: `Export ${format.toUpperCase()}`}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ExportChoice({
	label,
	detail,
	icon,
	selected,
	disabled,
	onSelect,
}: {
	label: string;
	detail?: string;
	icon?: ReactNode;
	selected: boolean;
	disabled: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			disabled={disabled}
			onClick={onSelect}
			className={cn(
				"relative flex min-h-14 min-w-0 items-center gap-2 rounded-xl px-2.5 text-start outline-none transition-[background-color,color,scale,box-shadow] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.96] disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none",
				selected
					? "bg-gray-3 text-gray-12 shadow-[inset_0_0_0_1px_var(--accent-border-selected)]"
					: "bg-gray-2 text-gray-10 hover:bg-gray-3 hover:text-gray-12",
			)}
		>
			{icon && <span className="shrink-0 text-gray-9">{icon}</span>}
			<span className="min-w-0">
				<span className="block truncate text-[11px] font-semibold">
					{label}
				</span>
				{detail && (
					<span className="mt-0.5 block truncate text-[9px] opacity-65">
						{detail}
					</span>
				)}
			</span>
			{selected && (
				<span className="ms-auto grid size-4 shrink-0 place-items-center rounded-full bg-accent-solid text-white">
					<IconLucideCheck aria-hidden="true" className="size-2.5" />
				</span>
			)}
		</button>
	);
}
