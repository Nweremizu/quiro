import { Button, cn, Select, Switch, toast } from "@quiro/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import {
	type CaptionAudioSource,
	type CaptionModelInfo,
	type CaptionSegment,
	type CaptionSettings,
	commands,
	events,
} from "@/utils/tauri";
import IconLucideCaptions from "~icons/lucide/captions";
import IconLucideChevronRight from "~icons/lucide/chevron-right";
import IconLucideCircleCheck from "~icons/lucide/circle-check";
import IconLucideDownload from "~icons/lucide/download";
import IconLucideFileText from "~icons/lucide/file-text";
import IconLucideHardDrive from "~icons/lucide/hard-drive";
import IconLucideLoaderCircle from "~icons/lucide/loader-circle";
import IconLucideMove from "~icons/lucide/move";
import IconLucidePalette from "~icons/lucide/palette";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import { ColorPickerPopover } from "../screenshot-editor/ColorPicker";
import { hexToRgb, rgbToHex } from "../screenshot-editor/ui";
import { ConfirmAction } from "./ConfirmAction";
import { saveCaptionFile } from "./caption-export";
import {
	registerCaptionGeneration,
	unregisterCaptionGeneration,
} from "./caption-generation";
import { mapCaptionsToEditedTimeline, mapEditedTimeToSource } from "./captions";
import { useEditorContext } from "./context";
import { MotionPositionPad } from "./motion-position-pad";
import { Slider, Subfield } from "./ui";

type ModelId = "best" | "best-max" | "small" | "medium";

const LANGUAGES = [
	{ label: "Auto detect", value: "auto" },
	{ label: "English", value: "en" },
	{ label: "Spanish", value: "es" },
	{ label: "French", value: "fr" },
	{ label: "German", value: "de" },
	{ label: "Italian", value: "it" },
	{ label: "Portuguese", value: "pt" },
	{ label: "Dutch", value: "nl" },
	{ label: "Polish", value: "pl" },
	{ label: "Russian", value: "ru" },
	{ label: "Ukrainian", value: "uk" },
	{ label: "Turkish", value: "tr" },
	{ label: "Arabic", value: "ar" },
	{ label: "Hebrew", value: "he" },
	{ label: "Hindi", value: "hi" },
	{ label: "Indonesian", value: "id" },
	{ label: "Malay", value: "ms" },
	{ label: "Vietnamese", value: "vi" },
	{ label: "Thai", value: "th" },
	{ label: "Chinese", value: "zh" },
	{ label: "Japanese", value: "ja" },
	{ label: "Korean", value: "ko" },
	{ label: "Swedish", value: "sv" },
	{ label: "Danish", value: "da" },
	{ label: "Norwegian", value: "no" },
	{ label: "Finnish", value: "fi" },
	{ label: "Czech", value: "cs" },
	{ label: "Greek", value: "el" },
	{ label: "Romanian", value: "ro" },
	{ label: "Hungarian", value: "hu" },
];

const PRESETS: Record<string, Partial<CaptionSettings>> = {
	classic: {
		font: "System Sans-Serif",
		fontWeight: 700,
		size: 50,
		color: "#FFFFFF",
		backgroundColor: "#000000",
		backgroundOpacity: 90,
		outline: false,
		activeWordHighlight: false,
		animation: "bounce",
	},
	karaoke: {
		fontWeight: 700,
		size: 52,
		color: "#FFFFFF",
		backgroundColor: "#000000",
		backgroundOpacity: 35,
		highlightColor: "#FFD400",
		activeWordHighlight: true,
		highlightStyle: "color",
		animation: "none",
	},
	highlight: {
		fontWeight: 700,
		size: 54,
		backgroundOpacity: 0,
		outline: true,
		highlightColor: "#7C3AED",
		activeWordHighlight: true,
		highlightStyle: "pill",
		uppercase: true,
	},
	pop: {
		fontWeight: 700,
		size: 56,
		backgroundOpacity: 0,
		outline: true,
		highlightColor: "#FACC15",
		activeWordHighlight: true,
		animation: "pop",
		uppercase: true,
	},
	minimal: {
		fontWeight: 600,
		size: 46,
		backgroundOpacity: 0,
		outline: true,
		activeWordHighlight: false,
		animation: "none",
	},
};

const PRESET_OPTIONS = [
	{ id: "classic", label: "Classic", sample: "Clear and bold" },
	{ id: "karaoke", label: "Karaoke", sample: "Word highlight" },
	{ id: "highlight", label: "Highlight", sample: "High impact" },
	{ id: "pop", label: "Pop", sample: "Animated emphasis" },
	{ id: "minimal", label: "Minimal", sample: "Simple outline" },
] as const;

const DEFAULT_SETTINGS: CaptionSettings = {
	enabled: true,
	font: "System Sans-Serif",
	size: 50,
	color: "#FFFFFF",
	backgroundColor: "#000000",
	backgroundOpacity: 90,
	position: "bottom-center",
	italic: false,
	fontWeight: 700,
	outline: false,
	outlineColor: "#000000",
	exportWithSubtitles: true,
	highlightColor: "#FFFFFF",
	fadeDuration: 0.2,
	lingerDuration: 0.4,
	wordTransitionDuration: 0.25,
	activeWordHighlight: false,
	manualPosition: null,
	preset: "classic",
	animation: "bounce",
	highlightStyle: "color",
	uppercase: false,
};

function colorValue(value: string): [number, number, number] {
	return hexToRgb(value) ?? [255, 255, 255];
}

export function CaptionsConfig() {
	const {
		instance,
		project,
		setProject,
		setSelection,
		playback,
		seek,
		prettyName,
	} = useEditorContext();
	const [models, setModels] = useState<CaptionModelInfo[]>([]);
	const availableModels = models.filter((item) => item.available);
	const [model, setModel] = useState<ModelId>("best");
	const [language, setLanguage] = useState("auto");
	const [audioSource, setAudioSource] = useState<CaptionAudioSource>("Mixed");
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState(0);
	const [downloadStatus, setDownloadStatus] = useState("Preparing download");
	const [generating, setGenerating] = useState(false);
	const [generationStatus, setGenerationStatus] = useState("");
	const generationId = useRef<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const captions = project?.captions;
	const timeline = project?.timeline;
	const captionSegments = timeline?.captionSegments ?? [];

	const refreshModels = useCallback(async () => {
		const result = await commands.getCaptionModels();
		if (result.status === "error") {
			setError(result.error);
			return;
		}
		setModels(result.data);
		const selected = result.data.find(
			(item) => item.id === model && item.available,
		);
		if (!selected) {
			const recommended = result.data.find((item) => item.recommended);
			if (recommended) setModel(recommended.id as ModelId);
		}
	}, [model]);
	useEffect(() => {
		void refreshModels();
	}, [refreshModels]);
	const installed =
		models.find((item) => item.id === model)?.installed ?? false;

	const refreshDownloadStatus = useCallback(async () => {
		const result = await commands.getCaptionModelDownloadStatus(model);
		if (result.status === "error") return;
		const status = result.data;
		if (!status) return;
		setDownloadStatus(status.message);
		setDownloadProgress((current) =>
			status.state === "downloading"
				? Math.max(current, status.progress)
				: status.progress,
		);
		setDownloading(status.state === "downloading");
		if (status.state === "completed") await refreshModels();
		if (status.state === "failed") setError(status.message);
	}, [model, refreshModels]);

	useEffect(() => {
		void refreshDownloadStatus();
		const interval = window.setInterval(
			() => void refreshDownloadStatus(),
			500,
		);
		return () => window.clearInterval(interval);
	}, [refreshDownloadStatus]);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		void events.captionGenerationProgress
			.listen((event) => {
				if (event.payload.job_id === generationId.current) {
					setGenerationStatus(
						`${event.payload.message} · ${Math.round(event.payload.progress)}%`,
					);
				}
			})
			.then((stop) => {
				unlisten = stop;
			});
		return () => unlisten?.();
	}, []);

	const projected = useMemo(() => {
		if (!captions || !timeline || !instance) return [];
		return mapCaptionsToEditedTimeline(
			captions.segments,
			timeline.segments,
			instance.recordings.segments,
			timeline.transitions ?? [],
		);
	}, [captions, timeline, instance]);

	const patchSettings = (patch: Partial<CaptionSettings>) =>
		setProject((current) =>
			current.captions
				? {
						...current,
						captions: {
							...current.captions,
							settings: { ...current.captions.settings, ...patch },
						},
					}
				: current,
		);
	const patchStyleSettings = (patch: Partial<CaptionSettings>) =>
		patchSettings({ ...patch, preset: "custom" });

	const download = async () => {
		setDownloading(true);
		setError(null);
		setDownloadProgress(0);
		setDownloadStatus("Preparing download");
		const result = await commands.downloadCaptionModel(model);
		if (result.status === "error") {
			setDownloading(false);
			setError(result.error);
			return;
		}
		toast.success("Caption model download started");
	};
	const cancelDownload = async () => {
		const result = await commands.cancelCaptionModelDownload(model);
		if (result.status === "error") setError(result.error);
	};
	const deleteModel = async () => {
		const result = await commands.deleteCaptionModel(model);
		if (result.status === "error") {
			setError(result.error);
			return;
		}
		await refreshModels();
		toast.success("Caption model removed");
	};

	const generate = async () => {
		if (!instance || !project) return;
		setGenerating(true);
		setError(null);
		setGenerationStatus("Preparing audio");
		const jobId = crypto.randomUUID();
		generationId.current = jobId;
		registerCaptionGeneration(jobId);
		const result = await commands.transcribeProjectAudio(
			instance.path,
			model,
			language,
			audioSource,
			jobId,
		);
		unregisterCaptionGeneration(jobId);
		generationId.current = null;
		setGenerationStatus("");
		setGenerating(false);
		if (result.status === "error") {
			setError(result.error);
			return;
		}
		if (result.data.segments.length === 0) {
			setError("No speech was detected in this recording.");
			return;
		}
		setProject((current) => ({
			...current,
			captions: {
				segments: result.data.segments,
				settings: current.captions?.settings ?? DEFAULT_SETTINGS,
				sourceTimed: true,
			},
		}));
		toast.success("Captions generated");
	};
	const cancelGeneration = () => {
		const jobId = generationId.current;
		if (jobId) void commands.cancelCaptionGeneration(jobId);
	};

	const addCaption = () => {
		if (!instance || !timeline) return;
		const sourceTime = mapEditedTimeToSource(
			playback.getTime(),
			timeline.segments,
			instance.recordings.segments,
			timeline.transitions ?? [],
		);
		if (sourceTime === null) return;
		const segment: CaptionSegment = {
			id: crypto.randomUUID(),
			start: sourceTime,
			end: sourceTime + 2,
			text: "New caption",
			words: [{ text: "New caption", start: sourceTime, end: sourceTime + 2 }],
		};
		setProject((current) => ({
			...current,
			captions: current.captions
				? {
						...current.captions,
						segments: [...current.captions.segments, segment].sort(
							(a, b) => a.start - b.start,
						),
					}
				: {
						segments: [segment],
						settings: DEFAULT_SETTINGS,
						sourceTimed: true,
					},
		}));
	};

	const exportSubtitles = async (format: "srt" | "vtt") => {
		await saveCaptionFile(format, prettyName, projected);
	};

	return (
		<div className="mt-2 flex flex-col gap-4 overflow-hidden [&>*:last-child]:border-b-0">
			<div className="mx-3 flex items-center gap-3 rounded-xl border border-gray-4 bg-gray-2 p-3">
				<div className="grid size-9 shrink-0 place-items-center rounded-lg bg-gray-4 text-gray-11">
					<IconLucideCaptions className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					<h2 className="text-balance text-xs font-semibold text-gray-12">
						{captionSegments.length > 0 ? "Captions ready" : "Add captions"}
					</h2>
					<p className="mt-0.5 truncate text-[11px] text-gray-10">
						{captionSegments.length > 0
							? `${captionSegments.length} visible ${captionSegments.length === 1 ? "caption" : "captions"}`
							: "Transcribe speech locally or add captions manually"}
					</p>
				</div>
				{captions && captions.segments.length > 0 && (
					<Switch
						aria-label="Show captions"
						checked={captions.settings.enabled}
						onCheckedChange={(enabled) => patchSettings({ enabled })}
					/>
				)}
			</div>

			<PanelSection
				icon={<IconLucideHardDrive className="size-4" />}
				title={captionSegments.length > 0 ? "Generate" : "Create captions"}
				defaultOpen={captionSegments.length === 0}
			>
				<div className="rounded-xl bg-gray-3 p-3">
					<p className="text-pretty text-xs text-gray-10">
						Speech recognition runs on this device. Once a model is downloaded,
						your audio stays local.
					</p>
				</div>
				<Subfield name="Model">
					<Select
						value={model}
						onValueChange={(value) => setModel(value as ModelId)}
						options={availableModels.map((item) => ({
							label: `${item.label} · ${item.engine} · ${Math.round(item.sizeBytes / 1_000_000)} MB`,
							value: item.id,
						}))}
					/>
				</Subfield>
				{!installed && (
					<div className="flex flex-col gap-2">
						<Button
							variant={downloading ? "outline" : "accent"}
							className="w-full"
							onClick={() =>
								downloading ? void cancelDownload() : void download()
							}
						>
							<IconLucideDownload className="size-4" />
							{downloading ? "Cancel download" : "Download model"}
						</Button>
						{downloading && (
							<div className="flex flex-col gap-1" role="status">
								<div className="flex items-center justify-between gap-2 text-[11px] text-gray-10">
									<span className="truncate">{downloadStatus}</span>
									<span className="shrink-0 tabular-nums">
										{Math.round(downloadProgress)}%
									</span>
								</div>
								<progress
									aria-label="Caption model download progress"
									max={100}
									value={downloadProgress}
									className="h-1.5 w-full accent-accent-solid"
								/>
							</div>
						)}
					</div>
				)}
				{installed && (
					<>
						<Subfield name="Language">
							<Select
								value={language}
								onValueChange={(value) => value && setLanguage(value)}
								options={LANGUAGES}
							/>
						</Subfield>
						<Subfield name="Audio source">
							<Select
								value={audioSource}
								onValueChange={(value) =>
									value && setAudioSource(value as CaptionAudioSource)
								}
								options={[
									{ label: "Microphone + system", value: "Mixed" },
									...(instance?.recordings.segments.some(
										(segment) => segment.mic,
									)
										? [{ label: "Microphone", value: "Microphone" }]
										: []),
									...(instance?.recordings.segments.some(
										(segment) => segment.system_audio,
									)
										? [{ label: "System audio", value: "System" }]
										: []),
								]}
							/>
						</Subfield>
						{generating ? (
							<Button
								variant="outline"
								className="w-full"
								onClick={cancelGeneration}
							>
								<IconLucideLoaderCircle className="size-4" />
								Cancel generation
							</Button>
						) : captions?.segments.length ? (
							<ConfirmAction
								triggerVariant="accent"
								triggerClassName="w-full"
								title="Regenerate captions?"
								description="This replaces the current transcript and removes any text corrections you made."
								confirmLabel="Regenerate"
								confirmVariant="accent"
								onConfirm={() => void generate()}
							>
								<IconLucideRefreshCw className="size-4" />
								Regenerate captions
							</ConfirmAction>
						) : (
							<Button
								variant="accent"
								className="w-full"
								onClick={() => void generate()}
							>
								<IconLucideCaptions className="size-4" />
								Generate captions
							</Button>
						)}
						<ConfirmAction
							triggerVariant="ghost"
							triggerClassName="w-full text-red-11 hover:text-red-11"
							title="Delete downloaded model?"
							description="You will need to download this model again before generating more captions. Existing captions are not affected."
							confirmLabel="Delete model"
							onConfirm={() => void deleteModel()}
						>
							<IconLucideTrash2 className="size-4" />
							Delete downloaded model
						</ConfirmAction>
					</>
				)}
				{error && (
					<p
						role="alert"
						className="rounded-lg bg-red-3 p-2 text-xs text-red-11"
					>
						{error}
					</p>
				)}
				{generating && generationStatus && (
					<p role="status" className="text-xs text-gray-10">
						{generationStatus}
					</p>
				)}
				{!captions?.segments.length && (
					<Button variant="outline" className="w-full" onClick={addCaption}>
						<IconLucidePlus className="size-4" />
						Add caption manually
					</Button>
				)}
			</PanelSection>

			{captions && captions.segments.length > 0 && (
				<>
					<PanelSection
						icon={<IconLucideFileText className="size-4" />}
						title="Transcript"
					>
						<div className="flex items-center justify-between gap-3">
							<p className="text-xs text-gray-10">
								Select a caption to edit its text and timing.
							</p>
							<Button
								variant="outline"
								size="xs"
								className="shrink-0"
								onClick={addCaption}
							>
								<IconLucidePlus className="size-3.5" />
								Add
							</Button>
						</div>
						<ol className="custom-scroll flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
							{captionSegments.length === 0 && (
								<li className="rounded-xl bg-gray-3 p-3 text-pretty text-xs text-gray-10">
									No captions remain in the edited timeline. Move the playhead
									and add one manually.
								</li>
							)}
							{captionSegments.map((segment, index) => (
								<li key={segment.id}>
									<button
										type="button"
										className="group flex w-full items-center gap-2 rounded-lg border border-transparent bg-gray-3 px-2.5 py-2 text-left outline-none transition-colors duration-100 hover:border-gray-5 hover:bg-gray-4 focus-visible:border-accent-border-selected focus-visible:ring-2 focus-visible:ring-accent-focus-ring/40"
										onClick={() => {
											seek(segment.start);
											setSelection({ type: "caption", index, id: segment.id });
										}}
									>
										<span className="w-10 shrink-0 rounded-md bg-gray-2 px-1.5 py-1 text-center text-[10px] tabular-nums text-gray-9">
											{segment.start.toFixed(1)}
										</span>
										<span className="min-w-0 flex-1 truncate text-xs text-gray-12">
											{segment.text || "Empty caption"}
										</span>
										<IconLucideChevronRight className="size-3.5 shrink-0 text-gray-8 transition-transform duration-100 group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" />
									</button>
								</li>
							))}
						</ol>
					</PanelSection>

					<PanelSection
						icon={<IconLucidePalette className="size-4" />}
						title="Style"
					>
						<fieldset>
							<legend className="mb-2 text-xs font-medium text-gray-12">
								Preset
							</legend>
							<div className="grid grid-cols-2 gap-2">
								{PRESET_OPTIONS.map((preset) => {
									const selected = captions.settings.preset === preset.id;
									return (
										<button
											type="button"
											key={preset.id}
											aria-pressed={selected}
											onClick={() =>
												patchSettings({
													...PRESETS[preset.id],
													preset: preset.id,
												})
											}
											className={cn(
												"flex min-h-16 flex-col items-start justify-center rounded-xl border bg-gray-3 px-3 text-left outline-none transition-[background-color,border-color] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50",
												selected
													? "border-accent-border-selected bg-gray-4"
													: "border-transparent hover:border-gray-5 hover:bg-gray-4",
											)}
										>
											<span className="flex w-full items-center gap-2 text-xs font-semibold text-gray-12">
												{preset.label}
												{selected && (
													<IconLucideCircleCheck className="ml-auto size-3.5 text-accent-solid" />
												)}
											</span>
											<span className="mt-1 text-[10px] text-gray-9">
												{preset.sample}
											</span>
										</button>
									);
								})}
							</div>
						</fieldset>
						<Subfield name="Uppercase">
							<Switch
								aria-label="Uppercase captions"
								checked={captions.settings.uppercase}
								onCheckedChange={(uppercase) =>
									patchStyleSettings({ uppercase })
								}
							/>
						</Subfield>
						<Subfield name="Word highlight">
							<Switch
								aria-label="Highlight active words"
								checked={captions.settings.activeWordHighlight}
								onCheckedChange={(activeWordHighlight) =>
									patchStyleSettings({ activeWordHighlight })
								}
							/>
						</Subfield>
						<Slider
							size="sm"
							label="Size"
							min={12}
							max={96}
							value={captions.settings.size}
							format={(value) => `${value}px`}
							onChange={(size) => patchStyleSettings({ size })}
						/>
						<Subfield name="Font">
							<Select
								value={captions.settings.font}
								onValueChange={(font) => font && patchStyleSettings({ font })}
								options={[
									{ label: "System Sans", value: "System Sans-Serif" },
									{ label: "System Serif", value: "System Serif" },
									{ label: "System Mono", value: "System Monospace" },
								]}
							/>
						</Subfield>
						<Subfield name="Weight">
							<Select
								value={String(captions.settings.fontWeight)}
								onValueChange={(fontWeight) =>
									fontWeight &&
									patchStyleSettings({ fontWeight: Number(fontWeight) })
								}
								options={[
									{ label: "Regular", value: "400" },
									{ label: "Medium", value: "500" },
									{ label: "Bold", value: "700" },
								]}
							/>
						</Subfield>
						<Subfield name="Italic">
							<Switch
								aria-label="Italic captions"
								checked={captions.settings.italic}
								onCheckedChange={(italic) => patchStyleSettings({ italic })}
							/>
						</Subfield>
						<Subfield name="Outline">
							<Switch
								aria-label="Caption outline"
								checked={captions.settings.outline}
								onCheckedChange={(outline) => patchStyleSettings({ outline })}
							/>
						</Subfield>
						<div className="grid grid-cols-2 gap-2">
							<Subfield name="Text">
								<ColorPickerPopover
									label="Caption text colour"
									showAlpha={false}
									value={colorValue(captions.settings.color)}
									onChange={({ value }) =>
										patchStyleSettings({ color: rgbToHex(value) })
									}
								/>
							</Subfield>
							<Subfield name="Background">
								<ColorPickerPopover
									label="Caption background colour"
									showAlpha={false}
									value={colorValue(captions.settings.backgroundColor)}
									onChange={({ value }) =>
										patchStyleSettings({ backgroundColor: rgbToHex(value) })
									}
								/>
							</Subfield>
							{captions.settings.activeWordHighlight && (
								<Subfield name="Highlight">
									<ColorPickerPopover
										label="Active word highlight colour"
										showAlpha={false}
										value={colorValue(captions.settings.highlightColor)}
										onChange={({ value }) =>
											patchStyleSettings({ highlightColor: rgbToHex(value) })
										}
									/>
								</Subfield>
							)}
							{captions.settings.outline && (
								<Subfield name="Outline">
									<ColorPickerPopover
										label="Caption outline colour"
										showAlpha={false}
										value={colorValue(captions.settings.outlineColor)}
										onChange={({ value }) =>
											patchStyleSettings({ outlineColor: rgbToHex(value) })
										}
									/>
								</Subfield>
							)}
						</div>
						<Slider
							size="sm"
							label="Background opacity"
							min={0}
							max={100}
							value={captions.settings.backgroundOpacity}
							format={(value) => `${value}%`}
							onChange={(backgroundOpacity) =>
								patchStyleSettings({ backgroundOpacity })
							}
						/>
						{captions.settings.activeWordHighlight && (
							<>
								<Subfield name="Highlight style">
									<Select
										value={captions.settings.highlightStyle}
										onValueChange={(highlightStyle) =>
											highlightStyle && patchStyleSettings({ highlightStyle })
										}
										options={[
											{ label: "Text colour", value: "color" },
											{ label: "Pill", value: "pill" },
										]}
									/>
								</Subfield>
								<Slider
									size="sm"
									label="Word transition"
									min={0}
									max={0.6}
									step={0.05}
									value={captions.settings.wordTransitionDuration}
									format={(value) => `${value.toFixed(2)}s`}
									onChange={(wordTransitionDuration) =>
										patchStyleSettings({ wordTransitionDuration })
									}
								/>
							</>
						)}
					</PanelSection>

					<PanelSection
						icon={<IconLucideMove className="size-4" />}
						title="Placement & motion"
					>
						<Slider
							size="sm"
							label="Fade"
							min={0}
							max={50}
							value={captions.settings.fadeDuration * 100}
							format={(value) => `${value / 100}s`}
							onChange={(value) =>
								patchStyleSettings({ fadeDuration: value / 100 })
							}
						/>
						<Slider
							size="sm"
							label="Linger"
							min={0}
							max={100}
							value={captions.settings.lingerDuration * 100}
							format={(value) => `${value / 100}s`}
							onChange={(value) =>
								patchStyleSettings({ lingerDuration: value / 100 })
							}
						/>
						<Subfield name="Animation">
							<Select
								value={captions.settings.animation}
								onValueChange={(animation) =>
									animation && patchStyleSettings({ animation })
								}
								options={[
									{ label: "None", value: "none" },
									{ label: "Bounce", value: "bounce" },
									{ label: "Pop", value: "pop" },
								]}
							/>
						</Subfield>
						<Subfield name="Position">
							<Select
								value={captions.settings.position}
								onValueChange={(position) => {
									if (position) patchStyleSettings({ position });
								}}
								options={[
									{ label: "Top left", value: "top-left" },
									{ label: "Top center", value: "top-center" },
									{ label: "Top right", value: "top-right" },
									{ label: "Bottom left", value: "bottom-left" },
									{ label: "Bottom center", value: "bottom-center" },
									{ label: "Bottom right", value: "bottom-right" },
									{ label: "Manual", value: "manual" },
								]}
							/>
						</Subfield>
						{captions.settings.position === "manual" && (
							<MotionPositionPad
								value={{
									offsetX: (captions.settings.manualPosition?.x ?? 0.5) - 0.5,
									offsetY: (captions.settings.manualPosition?.y ?? 0.8) - 0.5,
								}}
								onChange={(value) =>
									patchStyleSettings({
										manualPosition: {
											x: value.offsetX + 0.5,
											y: value.offsetY + 0.5,
										},
									})
								}
								onPreview={(value) =>
									patchStyleSettings({
										manualPosition: {
											x: value.offsetX + 0.5,
											y: value.offsetY + 0.5,
										},
									})
								}
								onCommit={(value) =>
									patchStyleSettings({
										manualPosition: {
											x: value.offsetX + 0.5,
											y: value.offsetY + 0.5,
										},
									})
								}
							/>
						)}
					</PanelSection>

					<PanelSection
						icon={<IconLucideDownload className="size-4" />}
						title="Export"
						defaultOpen={false}
					>
						<Subfield name="Burn captions into export">
							<Switch
								aria-label="Burn captions into exported video"
								checked={captions.settings.exportWithSubtitles}
								onCheckedChange={(exportWithSubtitles) =>
									patchSettings({ exportWithSubtitles })
								}
							/>
						</Subfield>
						<div className="grid grid-cols-2 gap-2">
							<Button
								variant="outline"
								onClick={() => void exportSubtitles("srt")}
							>
								Save SRT
							</Button>
							<Button
								variant="outline"
								onClick={() => void exportSubtitles("vtt")}
							>
								Save VTT
							</Button>
						</div>
					</PanelSection>
				</>
			)}
		</div>
	);
}
