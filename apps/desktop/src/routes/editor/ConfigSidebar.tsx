import { cn, Select, Switch } from "@quiro/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Disclosure } from "@/components/Disclosure";
import { PanelSection } from "@/components/PanelSection";
import type {
	BorderConfiguration,
	CameraXPosition,
	CameraYPosition,
	CornerStyle,
	CursorAnimationStyle,
	CursorType,
	FrameConfiguration,
	ProjectConfiguration,
	ShadowConfiguration,
} from "@/utils/tauri";
import IconLucideCamera from "~icons/lucide/camera";
import IconLucideCaptions from "~icons/lucide/captions";
import IconLucideCommand from "~icons/lucide/command";
import IconLucideFrame from "~icons/lucide/frame";
import IconLucideImage from "~icons/lucide/image";
import IconLucideKeyboard from "~icons/lucide/keyboard";
import IconLucideLayers from "~icons/lucide/layers";
import IconLucideMousePointer2 from "~icons/lucide/mouse-pointer-2";
import IconLucideSparkles from "~icons/lucide/sparkles";
import IconLucideVolume2 from "~icons/lucide/volume-2";
import { ColorPickerPopover } from "../screenshot-editor/ColorPicker";
import {
	ImageTab,
	WallpaperTab,
	WallpaperThumbnail,
} from "../screenshot-editor/ui";
import { useEditorContext } from "./context";
import { SegmentConfig } from "./SegmentConfig";
import { Field, Slider, Subfield } from "./ui";

// Cap's config sidebar: one icon tab per subject with a sliding indicator,
// and a single scrolling body underneath.

// `animationStyle` is only a label: the renderer reads tension/mass/friction.
// Picking a style has to write the spring values it stands for, or the choice
// does nothing. Mirrors `CursorAnimationStyle::preset()` in quiro-project —
// keep the two in step.
const CURSOR_ANIMATION_STYLES: Array<{
	value: CursorAnimationStyle;
	label: string;
	spring?: { tension: number; mass: number; friction: number };
}> = [
	{
		value: "slow",
		label: "Slow",
		spring: { tension: 200, mass: 2.25, friction: 40 },
	},
	{
		value: "smooth",
		label: "Smooth",
		spring: { tension: 80, mass: 2.5, friction: 28 },
	},
	{
		value: "mellow",
		label: "Mellow",
		spring: { tension: 470, mass: 3, friction: 70 },
	},
	{
		value: "fast",
		label: "Fast",
		spring: { tension: 380, mass: 1, friction: 30 },
	},
	{ value: "custom", label: "Custom" },
];

/** Which preset a set of spring values corresponds to, so hand-tuning one of
 * the sliders flips the style to Custom instead of leaving a stale label. */
function matchCursorStyle(spring: {
	tension: number;
	mass: number;
	friction: number;
}): CursorAnimationStyle {
	const match = CURSOR_ANIMATION_STYLES.find(
		(style) =>
			style.spring &&
			Math.abs(style.spring.tension - spring.tension) <= 1 &&
			Math.abs(style.spring.mass - spring.mass) <= 0.05 &&
			Math.abs(style.spring.friction - spring.friction) <= 0.2,
	);

	return match?.value ?? "custom";
}

const GRADIENT_DEFAULT_FROM: [number, number, number] = [71, 133, 255];
const GRADIENT_DEFAULT_TO: [number, number, number] = [255, 71, 102];

/** Presets for the video background gradient. Video-only (not shared with
 * the screenshot editor's `BACKGROUND_GRADIENTS`) because these can carry
 * `noiseIntensity`/`animated`/`animationSpeed` — fields that only exist on
 * `BackgroundSource::Gradient` and mean nothing for a static screenshot. */
const VIDEO_GRADIENT_PRESETS: Array<{
	name: string;
	from: [number, number, number];
	to: [number, number, number];
	noiseIntensity?: number;
	animated?: boolean;
	animationSpeed?: number;
}> = [
	{
		// "Northern lights": reduced from a 4-stop OKLCH aurora ramp (Minted
		// bamboo -> Clear bamboo -> Deep hanada -> Midnight lapis) to this
		// renderer's 2-stop model, using the ramp's outer two colors.
		// `animated`/`animationSpeed` are carried from the source template but
		// currently do nothing — the renderer never reads them (see
		// `packages/crates/rendering/src/layers/background.rs`), so this
		// preset is static today despite the name.
		name: "Northern lights",
		from: [234, 255, 244],
		to: [22, 34, 77],
		noiseIntensity: 6,
		animated: true,
		animationSpeed: 26,
	},
];

function rgbToHex([r, g, b]: [number, number, number]) {
	return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Photographic/mesh backgrounds shown as swatches in the Gradient section,
 * even though the renderer has no image-gradient hybrid — clicking one sets
 * `BackgroundSource::Wallpaper` (a real file), not `::Gradient` (2-stop
 * parametric), which is the only variant that can display a bitmap. Kept in
 * their own `gradients/` subfolder of `assets/backgrounds/` rather than
 * mixed into the flat wallpaper set, since `WallpaperThumbnail`'s resolve
 * path takes any relative filename — a subdirectory works the same as a
 * bare filename. Renamed from their original `Blue sky-1920x1080.png`-style
 * exports to match `WALLPAPER_FILENAMES`'s kebab-case, no-dimension-suffix
 * convention. */
const VIDEO_GRADIENT_IMAGE_PRESETS = [
	"gradients/afterglow.png",
	"gradients/aqua-glow.png",
	"gradients/blue-ocean-waves.png",
	"gradients/blue-sky.png",
	"gradients/cobalt.png",
	"gradients/deep-sea.png",
	"gradients/glassy-wisteria.png",
	"gradients/morning-haze.png",
	"gradients/neon-rise.png",
	"gradients/night.png",
	"gradients/solar-storm.png",
];

const TABS = [
	{ id: "background", label: "Background", icon: IconLucideImage },
	{ id: "camera", label: "Camera", icon: IconLucideCamera },
	{ id: "audio", label: "Audio", icon: IconLucideVolume2 },
	{ id: "cursor", label: "Cursor", icon: IconLucideMousePointer2 },
	{ id: "keyboard", label: "Keyboard", icon: IconLucideKeyboard },
	{ id: "hotkeys", label: "Hotkeys", icon: IconLucideCommand },
	{ id: "captions", label: "Captions", icon: IconLucideCaptions },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ConfigSidebar() {
	const { project, instance, selection } = useEditorContext();
	const [tab, setTab] = useState<TabId>("background");

	if (!project) return null;

	// A selected timeline segment takes over the panel, the way Cap's does.
	if (selection) {
		return (
			<div className="z-10 flex min-h-0 max-w-104 flex-1 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2">
				<SegmentConfig />
			</div>
		);
	}

	const hasCamera =
		instance?.recordings.segments.some((segment) => segment.camera !== null) ??
		false;

	return (
		<div className="z-10 flex min-h-0 max-w-104 flex-1 shrink-0  overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2">
			<div className="sticky top-0 z-60 flex h-96 mt-2  shrink-0 flex-col items-start overflow-hidden bg-gray-1 dark:bg-gray-2">
				{TABS.map(({ id, label, icon: Icon }) => {
					const selected = tab === id;
					const disabled = id === "camera" && !hasCamera;

					return (
						<button
							key={id}
							type="button"
							title={label}
							aria-label={label}
							aria-selected={selected}
							disabled={disabled}
							onClick={() => setTab(id)}
							className={cn(
								"group relative z-10 flex flex-1 items-center justify-center px-4 py-2 transition-colors focus:outline-hidden disabled:opacity-50",
								selected ? "text-gray-12" : "text-gray-11",
							)}
						>
							<div
								className={cn(
									"relative z-10 flex size-9 items-center justify-center rounded-lg border border-transparent transition will-change-transform",
									selected
										? "bg-gray-3"
										: "group-hover:border-gray-6 group-disabled:border-none",
								)}
							>
								<Icon className="size-4" />
							</div>
						</button>
					);
				})}
			</div>

			<div className="custom-scroll min-h-0 flex-1 overflow-y-scroll overflow-x-hidden text-[0.875rem]">
				{tab === "background" && <BackgroundConfig />}
				{tab === "camera" && <CameraConfig />}
				{tab === "audio" && <AudioConfig />}
				{tab === "cursor" && <CursorConfig />}
				{tab === "keyboard" && <KeyboardConfig />}
				{tab === "hotkeys" && <HotkeysConfig />}
				{tab === "captions" && <CaptionsConfig />}
			</div>
		</div>
	);
}

/** `sections` is for tabs built from `PanelSection`, which bring their own
 * padding and dividers — the flat variant's padding and 24px gaps would stack
 * on top of them and leave the dividers floating. */
function TabPanel({
	children,
	variant = "flat",
}: {
	children: React.ReactNode;
	variant?: "flat" | "sections";
}) {
	return (
		<div
			className={
				variant === "sections"
					? "flex flex-col [&>*:last-child]:border-b-0 mt-2 overflow-hidden"
					: "flex flex-col gap-6 p-4"
			}
		>
			{children}
		</div>
	);
}

function BackgroundConfig() {
	const { project, setProject } = useEditorContext();
	if (!project) return null;

	const background = project.background;
	const setBackground = (patch: Partial<ProjectConfiguration["background"]>) =>
		setProject((current) => ({
			...current,
			background: { ...current.background, ...patch },
		}));

	// `shadow` is the master intensity and `advancedShadow` only supplies the
	// size/opacity/blur it is drawn with — the renderer falls back to 50/18/50
	// when it is null (see rendering/src/lib.rs). So "Customise" stores those
	// defaults rather than turning a second feature on, and at zero intensity
	// there is nothing for them to affect.
	const shadowCustomised = background.advancedShadow !== null;
	const shadowInactive = background.shadow === 0;

	return (
		<TabPanel variant="sections">
			<PanelSection
				icon={<IconLucideImage className="size-4" />}
				title="Source"
			>
				{/* Custom Tabbed Navigation to replace the background type select  */}
				<div className="flex gap-2 bg-gray-3 p-1 rounded-xl mt-2 font-sans">
					<button
						className={cn(
							"*:*bg-gray-4 text-gray-12 rounded-lg px-2 py-1 hover:cursor-pointer text-sm font-medium transition-colors focus:outline-none	",
							background.source.type === "wallpaper" &&
								"bg-accent-solid text-accent-on-solid!",
						)}
						onClick={() =>
							setBackground({ source: { type: "wallpaper", path: null } })
						}
					>
						Wallpaper
					</button>
					<button
						className={cn(
							"*:*bg-gray-4 text-gray-12 rounded-lg px-2 py-1 hover:cursor-pointer text-sm font-medium transition-colors focus:outline-none	",
							background.source.type === "image" &&
								"bg-accent-solid text-accent-on-solid!",
						)}
						onClick={() =>
							setBackground({ source: { type: "image", path: null } })
						}
					>
						Image
					</button>
					<button
						className={cn(
							"*:*bg-gray-4 text-gray-12 rounded-lg px-2 py-1 hover:cursor-pointer text-sm font-medium transition-colors focus:outline-none	",
							background.source.type === "color" &&
								"bg-accent-solid text-accent-on-solid!",
						)}
						onClick={() =>
							setBackground({ source: { type: "color", value: [16, 16, 16] } })
						}
					>
						Colour
					</button>
					<button
						className={cn(
							"*:*bg-gray-4 text-gray-12 rounded-lg px-2 py-1 hover:cursor-pointer text-sm font-medium transition-colors focus:outline-none	",
							background.source.type === "gradient" &&
								"bg-accent-solid text-accent-on-solid!",
						)}
						onClick={() =>
							setBackground({
								source: {
									type: "gradient",
									from: GRADIENT_DEFAULT_FROM,
									to: GRADIENT_DEFAULT_TO,
								},
							})
						}
					>
						Gradient
					</button>
				</div>

				{background.source.type === "wallpaper" && (
					<WallpaperTab
						selectedPath={background.source.path}
						onSelect={(path) =>
							setBackground({ source: { type: "wallpaper", path } })
						}
					/>
				)}

				{background.source.type === "image" && (
					<ImageTab
						path={background.source.path}
						onPick={async () => {
							const picked = await open({
								multiple: false,
								directory: false,
								filters: [
									{
										name: "Image",
										extensions: ["png", "jpg", "jpeg", "webp", "avif", "gif"],
									},
								],
							});
							if (typeof picked === "string")
								setBackground({ source: { type: "image", path: picked } });
						}}
						onClear={() =>
							setBackground({ source: { type: "image", path: null } })
						}
					/>
				)}

				{background.source.type === "color" && (
					<ColorPickerPopover
						label="Background colour"
						showAlpha={false}
						value={background.source.value}
						onChange={({ value }) =>
							setBackground({ source: { type: "color", value } })
						}
					/>
				)}

				{background.source.type === "gradient" && (
					<div className="flex flex-col gap-3">
						<div className="flex flex-wrap gap-2">
							{VIDEO_GRADIENT_IMAGE_PRESETS.map((filename) => (
								<WallpaperThumbnail
									key={filename}
									filename={filename}
									selectedPath={
										background.source.type === "wallpaper"
											? background.source.path
											: null
									}
									onSelect={(path) =>
										setBackground({ source: { type: "wallpaper", path } })
									}
								/>
							))}
						</div>
						<div className="flex flex-wrap gap-2">
							{VIDEO_GRADIENT_PRESETS.map((preset) => {
								const source = background.source;
								// Narrowing `background.source.type` above the map doesn't
								// survive into this callback closure — TS re-widens the
								// union on every fresh property read inside a nested
								// function — so it's re-checked locally on `source` here.
								const gradientAngle =
									(source.type === "gradient" ? source.angle : undefined) ?? 90;
								const isActive =
									source.type === "gradient" &&
									rgbToHex(source.from) === rgbToHex(preset.from) &&
									rgbToHex(source.to) === rgbToHex(preset.to);
								return (
									<button
										key={preset.name}
										type="button"
										title={preset.name}
										aria-label={`Gradient preset: ${preset.name}`}
										aria-pressed={isActive}
										onClick={() =>
											setBackground({
												source: {
													type: "gradient",
													from: preset.from,
													to: preset.to,
													angle: gradientAngle,
													noise_intensity: preset.noiseIntensity,
													animated: preset.animated,
													animation_speed: preset.animationSpeed,
												},
											})
										}
										style={{
											background: `linear-gradient(${gradientAngle}deg, ${rgbToHex(preset.from)}, ${rgbToHex(preset.to)})`,
										}}
										className={cn(
											"size-7 rounded-lg border border-gray-5 transition-[opacity,box-shadow] duration-150 ease-[var(--ease-snappy)]",
											isActive
												? "ring-2 ring-accent-border-selected ring-offset-2 ring-offset-gray-1"
												: "hover:opacity-70",
										)}
									/>
								);
							})}
						</div>
						<Subfield name="From">
							<ColorPickerPopover
								label="Gradient start colour"
								showAlpha={false}
								value={background.source.from}
								onChange={({ value: from }) => {
									const source = background.source;
									if (source.type !== "gradient") return;
									setBackground({ source: { ...source, from } });
								}}
							/>
						</Subfield>
						<Subfield name="To">
							<ColorPickerPopover
								label="Gradient end colour"
								showAlpha={false}
								value={background.source.to}
								onChange={({ value: to }) => {
									const source = background.source;
									if (source.type !== "gradient") return;
									setBackground({ source: { ...source, to } });
								}}
							/>
						</Subfield>
						<Slider
							size="sm"
							label="Angle"
							format={(v) => `${v}°`}
							min={0}
							max={360}
							value={background.source.angle ?? 90}
							onChange={(angle) => {
								const source = background.source;
								if (source.type !== "gradient") return;
								setBackground({ source: { ...source, angle } });
							}}
						/>
					</div>
				)}
			</PanelSection>

			<PanelSection icon={<IconLucideFrame className="size-4" />} title="Shape">
				<Slider
					size="xs"
					label="Padding"
					format={(v) => `${Math.round(v)}%`}
					min={0}
					max={40}
					value={background.padding}
					onChange={(padding) => setBackground({ padding })}
				/>

				<Slider
					size="xs"
					label="Inset"
					format={(v) => `${Math.round(v)}%`}
					min={0}
					max={40}
					value={background.inset}
					onChange={(inset) => setBackground({ inset })}
				/>

				<Slider
					size="xs"
					label="Rounded corners"
					format={(v) => `${Math.round(v)}%`}
					min={0}
					max={30}
					value={background.rounding}
					onChange={(rounding) => setBackground({ rounding })}
				/>

				<Subfield name="Corner style">
					<Select
						className="w-36"
						value={background.roundingType}
						onValueChange={(roundingType) =>
							setBackground({ roundingType: roundingType as CornerStyle })
						}
						options={[
							{ label: "Squircle", value: "squircle" },
							{ label: "Rounded", value: "rounded" },
						]}
					/>
				</Subfield>
			</PanelSection>

			<PanelSection
				icon={<IconLucideLayers className="size-4" />}
				title="Depth"
			>
				<Slider
					size="xs"
					label="Shadow"
					format={(v) => `${Math.round(v)}%`}
					min={0}
					max={100}
					value={background.shadow}
					onChange={(shadow) => setBackground({ shadow })}
				/>

				<Disclosure
					label="Customise shadow"
					open={shadowCustomised}
					onOpenChange={(open) =>
						setBackground({
							advancedShadow: open ? { size: 50, opacity: 18, blur: 50 } : null,
						})
					}
				>
					{shadowInactive && (
						<p className="text-xs text-gray-11">
							Raise Shadow above 0% to see these take effect.
						</p>
					)}
					{background.advancedShadow && (
						<ShadowFields
							shadow={background.advancedShadow}
							onChange={(advancedShadow) => setBackground({ advancedShadow })}
						/>
					)}
				</Disclosure>

				<Slider
					size="xs"
					label="Background blur"
					format={(v) => `${Math.round(v)}%`}
					min={0}
					max={100}
					value={background.blur}
					onChange={(blur) => setBackground({ blur })}
				/>
			</PanelSection>

			<PanelSection
				icon={<IconLucideSparkles className="size-4" />}
				title="Decoration"
			>
				<Subfield name="Show border">
					<Switch
						aria-label="Show border"
						checked={background.border?.enabled ?? false}
						onCheckedChange={(enabled) =>
							setBackground({
								border: {
									width: background.border?.width ?? 2,
									color: background.border?.color ?? [255, 255, 255],
									opacity: background.border?.opacity ?? 60,
									enabled,
								},
							})
						}
					/>
				</Subfield>
				{background.border?.enabled && (
					<BorderFields
						border={background.border}
						onChange={(border) => setBackground({ border })}
					/>
				)}

				<Subfield name="Frame">
					<Select
						className="w-fit!"
						value={background.frame?.style ?? "none"}
						onValueChange={(style) =>
							setBackground({
								frame:
									style === "none"
										? null
										: {
												style: style as FrameConfiguration["style"],
												theme: background.frame?.theme ?? "dark",
												url: background.frame?.url ?? "",
												title: background.frame?.title ?? "",
											},
							})
						}
						options={[
							{ label: "None", value: "none" },
							{ label: "macOS window", value: "macOS" },
							{ label: "Windows window", value: "windows" },
							{ label: "Browser", value: "browser" },
							{ label: "MacBook", value: "macbook" },
						]}
					/>
				</Subfield>
				{background.frame && (
					<FrameFields
						frame={background.frame}
						onChange={(frame) => setBackground({ frame })}
					/>
				)}

				<Slider
					size="xs"
					label="Film grain"
					format={(v) => `${Math.round(v * 100)}%`}
					min={0}
					max={1}
					step={0.01}
					value={background.noiseIntensity ?? 0}
					onChange={(noiseIntensity) => setBackground({ noiseIntensity })}
				/>
			</PanelSection>
		</TabPanel>
	);
}

function CameraConfig() {
	const { project, setProject } = useEditorContext();
	if (!project) return null;

	const camera = project.camera;
	const setCamera = (patch: Partial<ProjectConfiguration["camera"]>) =>
		setProject((current) => ({
			...current,
			camera: { ...current.camera, ...patch },
		}));

	return (
		<TabPanel>
			<Field name="Camera" icon={<IconLucideCamera className="size-4" />}>
				<Subfield name="Hide camera">
					<Switch
						checked={camera.hide}
						onCheckedChange={(hide) => setCamera({ hide })}
					/>
				</Subfield>
				<Subfield name="Mirror camera">
					<Switch
						checked={camera.mirror}
						onCheckedChange={(mirror) => setCamera({ mirror })}
					/>
				</Subfield>
				<Subfield name="Position">
					<div className="flex gap-2">
						<Select
							className="w-28"
							value={camera.position.x}
							onValueChange={(x) =>
								setCamera({
									position: { ...camera.position, x: x as CameraXPosition },
								})
							}
							options={[
								{ label: "Left", value: "left" },
								{ label: "Center", value: "center" },
								{ label: "Right", value: "right" },
							]}
						/>
						<Select
							className="w-28"
							value={camera.position.y}
							onValueChange={(y) =>
								setCamera({
									position: { ...camera.position, y: y as CameraYPosition },
								})
							}
							options={[
								{ label: "Top", value: "top" },
								{ label: "Bottom", value: "bottom" },
							]}
						/>
					</div>
				</Subfield>
			</Field>

			<Slider
				size="sm"
				label="Size"
				format={(v) => `${Math.round(v)}%`}
				min={10}
				max={80}
				value={camera.size}
				onChange={(size) => setCamera({ size })}
			/>

			<Slider
				size="sm"
				label="Rounded corners"
				format={(v) => `${Math.round(v)}%`}
				min={0}
				max={100}
				value={camera.rounding}
				onChange={(rounding) => setCamera({ rounding })}
			/>

			<Slider
				size="sm"
				label="Shadow"
				format={(v) => `${Math.round(v)}%`}
				min={0}
				max={100}
				value={camera.shadow}
				onChange={(shadow) => setCamera({ shadow })}
			/>

			<Field name="Shape">
				<Select
					value={camera.shape}
					onValueChange={(shape) =>
						setCamera({ shape: shape as typeof camera.shape })
					}
					options={[
						{ label: "Square", value: "square" },
						{ label: "Source aspect", value: "source" },
					]}
				/>
			</Field>

			<Slider
				size="sm"
				label="Size during zoom"
				format={(v) => `${Math.round(v * 100)}%`}
				min={0.3}
				max={1}
				step={0.05}
				value={camera.scaleDuringZoom ?? 0.7}
				onChange={(scaleDuringZoom) => setCamera({ scaleDuringZoom })}
			/>

			<Field name="Background blur">
				<Select
					value={camera.backgroundBlur?.mode ?? "off"}
					onValueChange={(mode) =>
						setCamera({
							backgroundBlur: {
								mode: mode as NonNullable<typeof camera.backgroundBlur>["mode"],
							},
						})
					}
					options={[
						{ label: "Off", value: "off" },
						{ label: "Light", value: "light" },
						{ label: "Heavy", value: "heavy" },
					]}
				/>
			</Field>
		</TabPanel>
	);
}

function AudioConfig() {
	const { project, setProject } = useEditorContext();
	if (!project) return null;

	const audio = project.audio;
	const setAudio = (patch: Partial<ProjectConfiguration["audio"]>) =>
		setProject((current) => ({
			...current,
			audio: { ...current.audio, ...patch },
		}));

	return (
		<TabPanel>
			<Field
				name="Audio controls"
				icon={<IconLucideVolume2 className="size-4" />}
			>
				<Subfield name="Mute audio">
					<Switch
						checked={audio.mute}
						onCheckedChange={(mute) => setAudio({ mute })}
					/>
				</Subfield>
			</Field>

			<Slider
				size="sm"
				label="Microphone volume"
				format={(v) => `${v.toFixed(1)}dB`}
				min={-30}
				max={12}
				step={0.5}
				value={audio.micVolumeDb}
				onChange={(micVolumeDb) => setAudio({ micVolumeDb })}
			/>

			<Slider
				size="sm"
				label="System volume"
				format={(v) => `${v.toFixed(1)}dB`}
				min={-30}
				max={12}
				step={0.5}
				value={audio.systemVolumeDb}
				onChange={(systemVolumeDb) => setAudio({ systemVolumeDb })}
			/>

			<Field name="Microphone">
				<Subfield name="Improve mic quality">
					<Switch
						checked={audio.improve}
						onCheckedChange={(improve) => setAudio({ improve })}
					/>
				</Subfield>
				<Subfield name="Stereo mode">
					<Select
						className="w-32"
						value={audio.micStereoMode}
						onValueChange={(micStereoMode) =>
							setAudio({
								micStereoMode: micStereoMode as typeof audio.micStereoMode,
							})
						}
						options={[
							{ label: "Stereo", value: "stereo" },
							{ label: "Mono left", value: "monoL" },
							{ label: "Mono right", value: "monoR" },
						]}
					/>
				</Subfield>
			</Field>

			<ClipOffsets />
		</TabPanel>
	);
}

/** Per-clip A/V sync nudges. The recorder aligns tracks by start time, but a
 * device with unreported latency can still land tens of milliseconds out;
 * these are the manual correction. */
function ClipOffsets() {
	const { project, setProject } = useEditorContext();
	const clips = project?.clips ?? [];
	if (clips.length === 0) return null;

	const setOffset = (
		index: number,
		key: "camera" | "mic" | "system_audio",
		value: number,
	) =>
		setProject((current) => ({
			...current,
			clips: current.clips.map((clip) =>
				clip.index === index
					? {
							...clip,
							offsets: { ...clip.offsets, [key]: value },
							offsetsAutoCalculated: false,
						}
					: clip,
			),
		}));

	return (
		<>
			{clips.map((clip) => (
				<Field key={clip.index} name={`Clip ${clip.index + 1} sync`}>
					<Slider
						size="sm"
						label="Camera offset"
						format={(v) => `${(v).toFixed(2)}s`}
						min={-1}
						max={1}
						step={0.01}
						value={clip.offsets.camera ?? 0}
						onChange={(value) => setOffset(clip.index, "camera", value)}
					/>
					<Slider
						size="sm"
						label="Microphone offset"
						format={(v) => `${(v).toFixed(2)}s`}
						min={-1}
						max={1}
						step={0.01}
						value={clip.offsets.mic ?? 0}
						onChange={(value) => setOffset(clip.index, "mic", value)}
					/>
					<Slider
						size="sm"
						label="System audio offset"
						format={(v) => `${(v).toFixed(2)}s`}
						min={-1}
						max={1}
						step={0.01}
						value={clip.offsets.system_audio ?? 0}
						onChange={(value) => setOffset(clip.index, "system_audio", value)}
					/>
				</Field>
			))}
		</>
	);
}

function CursorConfig() {
	const { project, setProject } = useEditorContext();
	if (!project) return null;

	const cursor = project.cursor;
	const setCursor = (patch: Partial<ProjectConfiguration["cursor"]>) =>
		setProject((current) => ({
			...current,
			cursor: { ...current.cursor, ...patch },
		}));

	const applyStyle = (animationStyle: CursorAnimationStyle) => {
		const spring = CURSOR_ANIMATION_STYLES.find(
			(style) => style.value === animationStyle,
		)?.spring;

		setCursor(spring ? { animationStyle, ...spring } : { animationStyle });
	};

	/** Tuning a spring value by hand re-labels the style to match. */
	const setSpring = (
		patch: Partial<Pick<typeof cursor, "tension" | "mass" | "friction">>,
	) => {
		const next = {
			tension: patch.tension ?? cursor.tension,
			mass: patch.mass ?? cursor.mass,
			friction: patch.friction ?? cursor.friction,
		};

		setCursor({ ...next, animationStyle: matchCursorStyle(next) });
	};

	return (
		<TabPanel>
			<Field
				name="Cursor"
				icon={<IconLucideMousePointer2 className="size-4" />}
			>
				<Subfield name="Hide cursor">
					<Switch
						checked={cursor.hide}
						onCheckedChange={(hide) => setCursor({ hide })}
					/>
				</Subfield>
				<Subfield name="Hide when idle">
					<Switch
						checked={cursor.hideWhenIdle}
						onCheckedChange={(hideWhenIdle) => setCursor({ hideWhenIdle })}
					/>
				</Subfield>
				<Subfield name="Shape">
					<Select
						className="w-32"
						value={cursor.type}
						onValueChange={(type) => setCursor({ type: type as CursorType })}
						options={[
							{ label: "Auto", value: "auto" },
							{ label: "Pointer", value: "pointer" },
							{ label: "Circle", value: "circle" },
						]}
					/>
				</Subfield>
			</Field>

			<Slider
				size="sm"
				label="Size"
				format={(v) => `${Math.round(v)}%`}
				min={20}
				max={300}
				value={cursor.size}
				onChange={(size) => setCursor({ size })}
			/>

			<Slider
				size="sm"
				label="Motion blur"
				format={(v) => `${Math.round(v * 100)}%`}
				min={0}
				max={1}
				step={0.01}
				value={cursor.motionBlur}
				onChange={(motionBlur) => setCursor({ motionBlur })}
			/>

			<Field name="Movement">
				<Subfield name="Animation style">
					<Select
						className="w-32"
						value={cursor.animationStyle}
						onValueChange={(animationStyle) =>
							applyStyle(animationStyle as CursorAnimationStyle)
						}
						options={CURSOR_ANIMATION_STYLES.map(({ label, value }) => ({
							label,
							value: String(value),
						}))}
					/>
				</Subfield>
				<Subfield name="Disable smoothing">
					<Switch
						checked={cursor.raw}
						onCheckedChange={(raw) => setCursor({ raw })}
					/>
				</Subfield>
				<Subfield name="High quality SVG cursors">
					<Switch
						checked={cursor.useSvg}
						onCheckedChange={(useSvg) => setCursor({ useSvg })}
					/>
				</Subfield>
			</Field>

			<Field name="Spring" badge={cursor.raw ? "smoothing off" : undefined}>
				<Slider
					size="xs"
					label="Tension"
					format={(v) => `${Math.round(v)}`}
					min={1}
					max={500}
					value={cursor.tension}
					disabled={cursor.raw}
					onChange={(tension) => setSpring({ tension })}
				/>
				<Slider
					size="xs"
					label="Mass"
					format={(v) => `${v.toFixed(2)}`}
					min={0.1}
					max={10}
					step={0.05}
					value={cursor.mass}
					disabled={cursor.raw}
					onChange={(mass) => setSpring({ mass })}
				/>
				<Slider
					size="xs"
					label="Friction"
					format={(v) => `${Math.round(v)}`}
					min={1}
					max={100}
					value={cursor.friction}
					disabled={cursor.raw}
					onChange={(friction) => setSpring({ friction })}
				/>
			</Field>

			<Slider
				size="sm"
				label="Inactivity delay"
				format={(v) => `${v.toFixed(1)}s`}
				min={0.5}
				max={10}
				step={0.5}
				value={cursor.hideWhenIdleDelay}
				onChange={(hideWhenIdleDelay) => setCursor({ hideWhenIdleDelay })}
				disabled={!cursor.hideWhenIdle}
			/>
		</TabPanel>
	);
}

/** On-screen keystroke overlay. Segments come from the timeline's Add menu;
 * this tab styles them. */
function KeyboardConfig() {
	const { project, setProject } = useEditorContext();
	const settings = project?.keyboard?.settings;

	if (!settings) {
		return (
			<TabPanel>
				<p className="text-xs text-gray-10">
					Generate a keyboard track from the timeline's Add menu to style it
					here.
				</p>
			</TabPanel>
		);
	}

	const setSettings = (patch: Partial<typeof settings>) =>
		setProject((current) =>
			current.keyboard
				? {
						...current,
						keyboard: {
							...current.keyboard,
							settings: { ...current.keyboard.settings, ...patch },
						},
					}
				: current,
		);

	return (
		<TabPanel>
			<Field name="Keystrokes" icon={<IconLucideKeyboard className="size-4" />}>
				<Subfield name="Show keystrokes">
					<Switch
						checked={settings.enabled}
						onCheckedChange={(enabled) => setSettings({ enabled })}
					/>
				</Subfield>
				<Subfield name="Show modifiers">
					<Switch
						checked={settings.showModifiers}
						onCheckedChange={(showModifiers) => setSettings({ showModifiers })}
					/>
				</Subfield>
			</Field>

			<Slider
				size="sm"
				label="Size"
				format={(v) => `${Math.round(v)}px`}
				min={12}
				max={96}
				value={settings.size}
				onChange={(size) => setSettings({ size })}
			/>

			<Slider
				size="sm"
				label="Linger"
				format={(v) => `${v.toFixed(1)}s`}
				min={0.2}
				max={5}
				step={0.1}
				value={settings.lingerDuration}
				onChange={(lingerDuration) => setSettings({ lingerDuration })}
			/>
		</TabPanel>
	);
}

function HotkeysConfig() {
	const { project, setProject } = useEditorContext();
	if (!project) return null;

	return (
		<TabPanel>
			<Field name="Hotkeys" icon={<IconLucideCommand className="size-4" />}>
				<Subfield name="Show hotkeys on screen">
					<Switch
						checked={project.hotkeys.show}
						onCheckedChange={(show) =>
							setProject((current) => ({
								...current,
								hotkeys: { ...current.hotkeys, show },
							}))
						}
					/>
				</Subfield>
			</Field>
		</TabPanel>
	);
}

function CaptionsConfig() {
	const { project, setProject, selection } = useEditorContext();
	const captions = project?.captions;

	const selected =
		selection?.type === "caption" && captions
			? captions.segments[selection.index]
			: undefined;

	if (!captions || captions.segments.length === 0) {
		return (
			<TabPanel>
				{/* Transcription is not ported (it needs an ASR model); captions
				    authored elsewhere in `captions.json` still render and edit here. */}
				<p className="text-xs text-gray-10">No captions on this recording.</p>
			</TabPanel>
		);
	}

	const setSettings = (
		patch: Partial<NonNullable<ProjectConfiguration["captions"]>["settings"]>,
	) =>
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

	return (
		<TabPanel>
			<Field name="Captions" icon={<IconLucideCaptions className="size-4" />}>
				<Subfield name="Show captions">
					<Switch
						checked={captions.settings.enabled}
						onCheckedChange={(enabled) => setSettings({ enabled })}
					/>
				</Subfield>
			</Field>

			<Slider
				size="sm"
				label="Size"
				format={(v) => `${v}px`}
				min={12}
				max={96}
				value={captions.settings.size}
				onChange={(size) => setSettings({ size })}
			/>

			{selected && (
				<Field name="Selected caption">
					<textarea
						className="min-h-16 w-full rounded-lg border border-gray-4 bg-gray-2 p-2 text-xs text-gray-12"
						value={selected.text}
						onChange={(event) => {
							const text = event.target.value;
							const selectedIndex = selection?.index ?? -1;
							setProject((current) => {
								if (!current.captions) return current;
								const segments = current.captions.segments.map(
									(segment, index) =>
										index === selectedIndex ? { ...segment, text } : segment,
								);
								return {
									...current,
									captions: { ...current.captions, segments },
								};
							});
						}}
					/>
				</Field>
			)}
		</TabPanel>
	);
}

function ShadowFields({
	shadow,
	onChange,
}: {
	shadow: ShadowConfiguration;
	onChange: (shadow: ShadowConfiguration) => void;
}) {
	return (
		<>
			<Slider
				size="sm"
				label="Size"
				format={(v) => `${Math.round(v)}%`}
				min={0}
				max={100}
				value={shadow.size}
				onChange={(size) => onChange({ ...shadow, size })}
			/>
			<Slider
				size="sm"
				label="Opacity"
				format={(v) => `${Math.round(v)}%`}
				min={0}
				max={100}
				value={shadow.opacity}
				onChange={(opacity) => onChange({ ...shadow, opacity })}
			/>
			<Slider
				size="sm"
				label="Blur"
				format={(v) => `${Math.round(v)}%`}
				min={0}
				max={100}
				value={shadow.blur}
				onChange={(blur) => onChange({ ...shadow, blur })}
			/>
		</>
	);
}

function BorderFields({
	border,
	onChange,
}: {
	border: BorderConfiguration;
	onChange: (border: BorderConfiguration) => void;
}) {
	return (
		<AnimatePresence mode="wait">
			<motion.div
				initial={{ opacity: 0, y: -10 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -10 }}
				transition={{
					duration: 0.3,
					ease: "easeOut",
					type: "spring",
					bounce: 0.2,
					delay: 0.1,
				}}
				className="flex flex-col gap-3"
			>
				<Subfield name="Colour">
					<ColorPickerPopover
						label="Border colour"
						showAlpha={false}
						value={border.color}
						onChange={({ value: color }) => onChange({ ...border, color })}
					/>
				</Subfield>
				<Slider
					size="xs"
					label="Width"
					format={(v) => `${v.toFixed(1)}px`}
					min={0.5}
					max={16}
					step={0.5}
					value={border.width}
					onChange={(width) => onChange({ ...border, width })}
				/>
				<Slider
					size="xs"
					label="Opacity"
					format={(v) => `${Math.round(v)}%`}
					min={0}
					max={100}
					value={border.opacity}
					onChange={(opacity) => onChange({ ...border, opacity })}
				/>
			</motion.div>
		</AnimatePresence>
	);
}

function FrameFields({
	frame,
	onChange,
}: {
	frame: FrameConfiguration;
	onChange: (frame: FrameConfiguration) => void;
}) {
	return (
		<>
			<Subfield name="Theme">
				<Select
					className="w-28"
					value={frame.theme}
					onValueChange={(theme) =>
						onChange({ ...frame, theme: theme as FrameConfiguration["theme"] })
					}
					options={[
						{ label: "Dark", value: "dark" },
						{ label: "Light", value: "light" },
					]}
				/>
			</Subfield>

			{frame.style === "browser" && (
				<Subfield name="URL">
					<input
						value={frame.url}
						onChange={(event) =>
							onChange({ ...frame, url: event.target.value })
						}
						className="w-44 rounded-lg border border-gray-4 bg-gray-2 px-2 py-1 text-xs text-gray-12"
					/>
				</Subfield>
			)}

			{(frame.style === "macOS" || frame.style === "windows") && (
				<Subfield name="Title">
					<input
						value={frame.title}
						onChange={(event) =>
							onChange({ ...frame, title: event.target.value })
						}
						className="w-44 rounded-lg border border-gray-4 bg-gray-2 px-2 py-1 text-xs text-gray-12"
					/>
				</Subfield>
			)}
		</>
	);
}
