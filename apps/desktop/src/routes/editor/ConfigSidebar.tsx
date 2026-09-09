import { cn, Select, Switch } from "@quiro/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Disclosure } from "@/components/Disclosure";
import { PanelSection } from "@/components/PanelSection";
import { FEATURES } from "@/features";
import { invalidateCachedFileImage } from "@/utils/image-cache";
import type {
	BorderConfiguration,
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
import IconLucideEye from "~icons/lucide/eye";
import IconLucideFrame from "~icons/lucide/frame";
import IconLucideGauge from "~icons/lucide/gauge";
import IconLucideImage from "~icons/lucide/image";
import IconLucideKeyboard from "~icons/lucide/keyboard";
import IconLucideLayers from "~icons/lucide/layers";
import IconLucideMousePointer2 from "~icons/lucide/mouse-pointer-2";
import IconLucideSparkles from "~icons/lucide/sparkles";
import IconLucideVolume2 from "~icons/lucide/volume-2";
import IconLucideWind from "~icons/lucide/wind";
import IconLucideZoomIn from "~icons/lucide/zoom-in";
import { ColorPickerPopover } from "../screenshot-editor/ColorPicker";
import {
	ImageTab,
	WallpaperTab,
	WallpaperThumbnail,
} from "../screenshot-editor/ui";
import { CaptionsConfig } from "./CaptionsConfig";
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

const CURSOR_APPEARANCES: Array<{ type: CursorType; label: string }> = [
	{ type: "auto", label: "Auto" },
	{ type: "pointer", label: "Pointer" },
	{ type: "circle", label: "Circle" },
	{ type: "macosDark", label: "macOS" },
	{ type: "rounded", label: "Round" },
	{ type: "capsule", label: "Pill" },
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

const VISIBLE_TABS = TABS.filter(
	(tab) => tab.id !== "captions" || FEATURES.captions,
);

type TabId = (typeof TABS)[number]["id"];

export function ConfigSidebar() {
	const { project, instance, selection } = useEditorContext();
	const [tab, setTab] = useState<TabId>("background");

	if (!project) return null;

	// A selected timeline segment takes over the panel, the way Cap's does.
	if (selection) {
		return (
			<div className="flex h-full min-h-0 max-h-full max-w-104 flex-1 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2">
				<SegmentConfig />
			</div>
		);
	}

	const hasCamera =
		instance?.recordings.segments.some((segment) => segment.camera !== null) ??
		false;

	return (
		<div className="flex h-full min-h-0 max-h-full max-w-104 flex-1 shrink-0 overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2">
			<div className="sticky top-0 z-60 flex h-96 mt-2  shrink-0 flex-col items-start overflow-hidden bg-gray-1 dark:bg-gray-2">
				{VISIBLE_TABS.map(({ id, label, icon: Icon }) => {
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

			<div className="custom-scroll min-h-0 max-h-full flex-1 self-stretch overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] text-[0.875rem]">
				{tab === "background" && <BackgroundConfig />}
				{tab === "camera" && <CameraConfig />}
				{tab === "audio" && <AudioConfig />}
				{tab === "cursor" && <CursorConfig />}
				{tab === "keyboard" && <KeyboardConfig />}
				{tab === "hotkeys" && <HotkeysConfig />}
				{FEATURES.captions && tab === "captions" && <CaptionsConfig />}
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
					? "flex flex-col [&>*:last-child]:border-b-0 mt-2 overflow-hidden gap-4"
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
							if (typeof picked === "string") {
								invalidateCachedFileImage(picked);
								setBackground({ source: { type: "image", path: picked } });
							}
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
	const reduceMotion = useReducedMotion();
	if (!project) return null;

	const camera = project.camera;
	const setCamera = (patch: Partial<ProjectConfiguration["camera"]>) =>
		setProject((current) => ({
			...current,
			camera: { ...current.camera, ...patch },
		}));

	const positions = [
		{ x: "left", y: "top", label: "Top left" },
		{ x: "center", y: "top", label: "Top center" },
		{ x: "right", y: "top", label: "Top right" },
		{ x: "left", y: "bottom", label: "Bottom left" },
		{ x: "center", y: "bottom", label: "Bottom center" },
		{ x: "right", y: "bottom", label: "Bottom right" },
	] as const;
	const positionDescription = camera.manualPosition
		? "Custom position"
		: `${camera.position.y} ${camera.position.x}`;
	const indicatorPosition = camera.manualPosition ?? {
		x: { left: 1 / 6, center: 1 / 2, right: 5 / 6 }[camera.position.x],
		y: { top: 1 / 4, bottom: 3 / 4 }[camera.position.y],
	};

	return (
		<TabPanel variant="sections">
			<PanelSection
				icon={<IconLucideCamera className="size-4" />}
				title="Camera"
			>
				<Subfield name="Hide camera">
					<Switch
						aria-label="Hide camera"
						checked={camera.hide}
						onCheckedChange={(hide) => setCamera({ hide })}
					/>
				</Subfield>
				<Subfield name="Mirror camera">
					<Switch
						aria-label="Mirror camera"
						checked={camera.mirror}
						onCheckedChange={(mirror) => setCamera({ mirror })}
					/>
				</Subfield>

				<fieldset className="min-w-0">
					<legend className="sr-only">Position</legend>
					<div className="mb-2 flex items-center justify-between gap-3">
						<span
							aria-hidden="true"
							className="text-xs font-medium text-gray-12"
						>
							Position
						</span>
						<span className="truncate text-[0.625rem] font-medium capitalize text-gray-9">
							{positionDescription}
						</span>
					</div>
					<div
						dir="ltr"
						className="gray-button-shadow relative grid min-h-32 grid-cols-3 grid-rows-2 overflow-hidden rounded-xl bg-gray-3 p-1"
					>
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-2 inset-y-2 rounded-lg border border-gray-5 bg-gray-2/60 shadow-[inset_0_1px_2px_oklch(0_0_0/0.06)]"
						/>
						{positions.map((position) => {
							const selected =
								!camera.manualPosition &&
								camera.position.x === position.x &&
								camera.position.y === position.y;

							return (
								<div key={position.label} className="relative z-10 min-h-14">
									<input
										id={`camera-position-${position.y}-${position.x}`}
										type="radio"
										name="camera-position"
										value={`${position.y}-${position.x}`}
										checked={selected}
										onChange={() =>
											setCamera({
												position: { x: position.x, y: position.y },
												manualPosition: null,
											})
										}
										className="peer sr-only"
									/>
									<label
										htmlFor={`camera-position-${position.y}-${position.x}`}
										className="relative flex size-full min-h-14 cursor-pointer items-center justify-center rounded-lg -outline-offset-2 transition-[background-color,box-shadow] duration-100 peer-checked:bg-transparent/85 peer-focus-visible:outline-2 peer-focus-visible:outline-accent-focus-ring active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none"
									>
										<span className="sr-only">{position.label}</span>
										<span
											aria-hidden="true"
											className={cn(
												"size-1 rounded-full bg-gray-8 transition-opacity duration-100 motion-reduce:transition-none",
												selected && "opacity-0",
											)}
										/>
									</label>
								</div>
							);
						})}
						<motion.div
							aria-hidden="true"
							initial={false}
							animate={{
								left: `${indicatorPosition.x * 100}%`,
								top: `${indicatorPosition.y * 100}%`,
							}}
							transition={
								reduceMotion
									? { duration: 0 }
									: { type: "spring", duration: 0.55, bounce: 0 }
							}
							className={cn(
								"pointer-events-none absolute z-20 size-0 transition-opacity duration-100 motion-reduce:transition-none",
								camera.hide && "opacity-45",
							)}
						>
							<div className="dark-button-shadow absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-gray-5 shadow-sm">
								<span
									style={{ borderRadius: `${camera.rounding}%` }}
									className="dark-button-shadow size-5 border border-accent-border-selected bg-accent-solid shadow-sm"
								/>
							</div>
						</motion.div>
					</div>
				</fieldset>
			</PanelSection>

			<PanelSection icon={<IconLucideFrame className="size-4" />} title="Shape">
				<fieldset>
					<legend className="mb-2 text-xs font-medium text-gray-12">
						Frame
					</legend>
					<div className="grid grid-cols-2 gap-2">
						{[
							{ value: "source", label: "Source aspect" },
							{ value: "square", label: "Square crop" },
						].map((shape) => (
							<div key={shape.value} className="min-w-0">
								<input
									id={`camera-shape-${shape.value}`}
									type="radio"
									name="camera-shape"
									value={shape.value}
									checked={camera.shape === shape.value}
									onChange={() =>
										setCamera({ shape: shape.value as typeof camera.shape })
									}
									className="peer sr-only"
								/>
								<label
									htmlFor={`camera-shape-${shape.value}`}
									className="gray-button-shadow flex min-h-24 cursor-pointer flex-col gap-2 rounded-xl bg-gray-3 p-1.5 text-[0.6875rem] font-medium text-gray-10 outline-offset-2 transition-[background-color,color,box-shadow] duration-100 peer-checked:bg-gray-4 peer-checked:text-gray-12 peer-checked:shadow-[inset_0_0_0_2px_var(--accent-border-selected),0_1px_2px_oklch(0_0_0/0.08)] peer-focus-visible:outline-2 peer-focus-visible:outline-accent-focus-ring active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none"
								>
									<CameraFrameDrawing
										shape={shape.value as typeof camera.shape}
										rounding={camera.rounding}
									/>
									<span className="flex w-full min-w-0 items-center justify-between gap-2 px-1">
										<span className="truncate">{shape.label}</span>
										<span
											aria-hidden="true"
											className={cn(
												"grid size-3.5 shrink-0 place-items-center rounded-full border border-gray-7 bg-gray-2",
												camera.shape === shape.value &&
													"border-accent-solid bg-accent-solid",
											)}
										>
											{camera.shape === shape.value && (
												<span className="size-2 rounded-full bg-accent-solid dark-button-shadow" />
											)}
										</span>
									</span>
								</label>
							</div>
						))}
					</div>
				</fieldset>
				<Slider
					size="xs"
					label="Size"
					ariaLabel="Camera size"
					format={(v) => `${Math.round(v)}%`}
					min={10}
					max={80}
					value={camera.size}
					onChange={(size) => setCamera({ size })}
				/>
				<Slider
					size="xs"
					label="Rounded corners"
					ariaLabel="Camera corner rounding"
					format={(v) => `${Math.round(v)}%`}
					min={0}
					max={100}
					value={camera.rounding}
					onChange={(rounding) => setCamera({ rounding })}
				/>
			</PanelSection>

			<PanelSection
				icon={<IconLucideLayers className="size-4" />}
				title="Depth"
			>
				<Slider
					size="xs"
					label="Shadow"
					ariaLabel="Camera shadow"
					format={(v) => `${Math.round(v)}%`}
					min={0}
					max={100}
					value={camera.shadow}
					onChange={(shadow) => setCamera({ shadow })}
				/>
				<Subfield name="Background blur">
					<Select
						size="sm"
						value={camera.backgroundBlur?.mode ?? "off"}
						onValueChange={(mode) =>
							setCamera({
								backgroundBlur: {
									mode: mode as NonNullable<
										typeof camera.backgroundBlur
									>["mode"],
								},
							})
						}
						options={[
							{ label: "Off", value: "off" },
							{ label: "Light", value: "light" },
							{ label: "Heavy", value: "heavy" },
						]}
					/>
				</Subfield>
			</PanelSection>

			<PanelSection
				icon={<IconLucideZoomIn className="size-4" />}
				title="During zoom"
			>
				<Slider
					size="xs"
					label="Size"
					ariaLabel="Camera size during screen zoom"
					format={(v) => `${Math.round(v * 100)}%`}
					min={0.3}
					max={1}
					step={0.05}
					value={camera.scaleDuringZoom ?? 0.7}
					onChange={(scaleDuringZoom) => setCamera({ scaleDuringZoom })}
				/>
			</PanelSection>
		</TabPanel>
	);
}

function CameraFrameDrawing({
	shape,
	rounding,
}: {
	shape: ProjectConfiguration["camera"]["shape"];
	rounding: number;
}) {
	const radius = (rounding / 100) * (shape === "square" ? 10 : 12);

	return (
		<svg
			viewBox="0 0 96 56"
			aria-hidden="true"
			className="h-13 w-full rounded-lg bg-gray-2 text-gray-a10 shadow-[inset_0_1px_2px_oklch(0_0_0/0.06)]"
		>
			{/* <rect
				x="0.5"
				y="0.5"
				width="95"
				height="55"
				rx="7.5"
				fill="none"
				stroke="var(--gray-5)"
			/> */}
			{shape === "source" ? (
				<>
					<rect
						x="15"
						y="10"
						width="66"
						height="36"
						rx={radius}
						fill="currentColor"
						fillOpacity="0.1"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
					<circle
						cx="48"
						cy="23"
						r="6"
						fill="currentColor"
						fillOpacity="0.55"
					/>
					<path
						d="M34 40c1.8-7.2 7-10.8 14-10.8S60.2 32.8 62 40"
						fill="currentColor"
						fillOpacity="0.34"
					/>
					<path
						d="M21 16h6M69 16h6M21 40h6M69 40h6"
						stroke="currentColor"
						strokeLinecap="round"
						strokeOpacity="0.45"
					/>
				</>
			) : (
				<>
					<rect
						x="31"
						y="11"
						width="34"
						height="34"
						rx={radius}
						fill="currentColor"
						fillOpacity="0.1"
						stroke="currentColor"
						strokeWidth="1.5"
					/>

					<circle
						cx="48"
						cy="23"
						r="5.5"
						fill="currentColor"
						fillOpacity="0.55"
					/>
					<path
						d="M37 40c1.5-6.8 5.5-10.2 11-10.2S57.5 33.2 59 40"
						fill="currentColor"
						fillOpacity="0.34"
					/>
				</>
			)}
		</svg>
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
		<TabPanel variant="sections">
			<PanelSection
				icon={<IconLucideMousePointer2 className="size-4" />}
				title="Appearance"
			>
				<div className="grid grid-cols-3 gap-1.5">
					{CURSOR_APPEARANCES.map(({ type, label }) => (
						<CursorShapeButton
							key={type}
							type={type}
							label={label}
							selected={cursor.type === type}
							onSelect={() => setCursor({ type })}
						/>
					))}
				</div>
				<Slider
					size="sm"
					label="Size"
					format={(v) => `${Math.round(v)}%`}
					min={20}
					max={300}
					value={cursor.size}
					onChange={(size) => setCursor({ size })}
				/>
				<Subfield name="High quality SVG">
					<Switch
						checked={cursor.useSvg}
						onCheckedChange={(useSvg) => setCursor({ useSvg })}
					/>
				</Subfield>
			</PanelSection>

			<PanelSection
				icon={<IconLucideEye className="size-4" />}
				title="Visibility"
			>
				<Subfield name="Show cursor">
					<Switch
						checked={!cursor.hide}
						onCheckedChange={(visible) => setCursor({ hide: !visible })}
					/>
				</Subfield>
				<Subfield name="Hide when idle">
					<Switch
						checked={cursor.hideWhenIdle}
						onCheckedChange={(hideWhenIdle) => setCursor({ hideWhenIdle })}
					/>
				</Subfield>
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
			</PanelSection>

			<PanelSection icon={<IconLucideWind className="size-4" />} title="Motion">
				<Subfield name="Smooth movement">
					<Switch
						checked={!cursor.raw}
						onCheckedChange={(smooth) => setCursor({ raw: !smooth })}
					/>
				</Subfield>
				<div
					className={cn(
						"grid grid-cols-5 gap-1 rounded-xl bg-gray-3 p-1 transition-opacity duration-100 motion-reduce:transition-none",
						cursor.raw && "opacity-45",
					)}
				>
					{CURSOR_ANIMATION_STYLES.map((style) => (
						<CursorMotionStyleButton
							key={style.value}
							style={style.value}
							label={style.label}
							selected={cursor.animationStyle === style.value}
							disabled={cursor.raw}
							onSelect={() => applyStyle(style.value)}
						/>
					))}
				</div>
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
			</PanelSection>

			<PanelSection
				icon={<IconLucideGauge className="size-4" />}
				title="Spring"
				defaultOpen={false}
			>
				{cursor.raw && (
					<p className="rounded-lg bg-gray-3 px-2.5 py-2 text-[11px] text-gray-10">
						Turn on smooth movement to use spring controls.
					</p>
				)}
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
			</PanelSection>
		</TabPanel>
	);
}

function CursorShapeButton({
	type,
	label,
	selected,
	onSelect,
}: {
	type: CursorType;
	label: string;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={cn(
				"group flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl px-2 text-[10px] font-semibold outline-none transition-[background-color,color,scale] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
				selected
					? "bg-gray-4 text-gray-12 ring-1 ring-accent-border-selected"
					: "bg-gray-2 text-gray-10 hover:bg-gray-3 hover:text-gray-12",
			)}
		>
			<CursorShapeDrawing type={type} selected={selected} />
			{label}
		</button>
	);
}

function CursorShapeDrawing({
	type,
	selected,
}: {
	type: CursorType;
	selected: boolean;
}) {
	if (type === "circle") {
		return (
			<svg viewBox="0 0 32 24" aria-hidden="true" className="h-6 w-8">
				<circle
					cx="16"
					cy="12"
					r="7"
					fill="var(--gray-1)"
					stroke="var(--gray-7)"
				/>
				<circle cx="16" cy="12" r="2.5" fill="var(--accent-solid)" />
			</svg>
		);
	}

	const fill = selected ? "var(--accent-solid)" : "var(--gray-11)";

	return (
		<svg viewBox="0 0 32 24" aria-hidden="true" className="h-6 w-8">
			{type === "macosDark" ? (
				<path
					d="M8 3.5v17l4.5-4.4 3.5 7.6 3.2-1.5-3.6-7.4h6.5L8 3.5Z"
					fill="var(--gray-12)"
					stroke="var(--gray-1)"
					strokeWidth="1.7"
					strokeLinejoin="round"
				/>
			) : type === "rounded" ? (
				<path
					d="M8.4 4.1c-.7-.5-1.5 0-1.5.7v15.5c0 .9 1.1 1.3 1.7.7l3.7-4 3 6.2 3-1.5-2.9-6h5.8c.9 0 1.3-1.2.5-1.7L8.4 4.1Z"
					fill={fill}
					stroke="var(--gray-1)"
					strokeWidth="1.6"
					strokeLinejoin="round"
				/>
			) : type === "capsule" ? (
				<path
					d="M9 4.2c-.7-.5-1.5 0-1.5.8v14.8c0 .9 1.1 1.3 1.7.7l3.4-3.5 3 6 2.7-1.3-2.8-5.7h5.1c.9 0 1.2-1.1.5-1.7L9 4.2Z"
					fill="var(--gray-12)"
					stroke="var(--accent-solid)"
					strokeWidth="1.7"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			) : (
				<>
					<path
						d="M9 4.5 22 14h-6l-3.5 5.5L9 4.5Z"
						fill={fill}
						stroke="var(--gray-1)"
						strokeLinejoin="round"
					/>
					{type === "auto" && (
						<path
							d="m23 4 .7 1.8L25.5 6.5l-1.8.7L23 9l-.7-1.8-1.8-.7 1.8-.7L23 4Z"
							fill="var(--accent-solid)"
						/>
					)}
				</>
			)}
		</svg>
	);
}

function CursorMotionStyleButton({
	style,
	label,
	selected,
	disabled,
	onSelect,
}: {
	style: CursorAnimationStyle;
	label: string;
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
				"flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[9px] font-semibold outline-none transition-[background-color,color,scale] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 enabled:active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
				selected
					? "bg-gray-1 text-gray-12"
					: "text-gray-10 enabled:hover:bg-gray-4 enabled:hover:text-gray-12",
			)}
		>
			<CursorMotionDrawing style={style} selected={selected} />
			<span className="w-full truncate">{label}</span>
		</button>
	);
}

function CursorMotionDrawing({
	style,
	selected,
}: {
	style: CursorAnimationStyle;
	selected: boolean;
}) {
	const stroke = selected ? "var(--accent-solid)" : "currentColor";

	return (
		<svg viewBox="0 0 32 12" aria-hidden="true" className="h-3 w-7" fill="none">
			{style === "slow" && (
				<path
					d="M7 6h12m-3-3 3 3-3 3"
					stroke={stroke}
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			)}
			{style === "smooth" && (
				<path
					d="M4 8c5 0 5-4 10-4s5 4 10 4"
					stroke={stroke}
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			)}
			{style === "mellow" && (
				<path
					d="M4 7c4-4 8-4 12 0s8 4 12 0"
					stroke={stroke}
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			)}
			{style === "fast" && (
				<path
					d="M3 6h23m-4-4 4 4-4 4M7 3 4 6l3 3"
					stroke={stroke}
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			)}
			{style === "custom" && (
				<>
					<path
						d="M5 3h22M5 9h22"
						stroke="var(--gray-7)"
						strokeLinecap="round"
					/>
					<circle cx="12" cy="3" r="2" fill="var(--accent-solid)" />
					<circle cx="21" cy="9" r="2" fill="var(--accent-solid)" />
				</>
			)}
		</svg>
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
