import { Collapsible } from "@base-ui/react/collapsible";
import { cn, Select, Switch } from "@quiro/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import type { BackgroundConfiguration } from "@/utils/tauri";
import IconLucideImage from "~icons/lucide/image";
import IconLucideSquare from "~icons/lucide/square";
import IconLucideSun from "~icons/lucide/sun";
import IconLucideX from "~icons/lucide/x";
import { ColorPickerPopover } from "./ColorPicker";
import {
	BACKGROUND_COLOR_NAMES,
	BACKGROUND_COLORS,
	BACKGROUND_GRADIENTS,
	BACKGROUND_SOURCE_TABS,
	type BackgroundSourceType,
	DRAFT_COLOR,
	DRAFT_GRADIENT,
	ensureVisibleBackground,
	ensureVisibleFraming,
} from "./constants";
import { useScreenshotEditorContext } from "./context";
import {
	Field,
	ImageTab,
	PanelSection,
	rgbToHex,
	Slider,
	WallpaperTab,
} from "./ui";

// Persistent right-hand inspector — the counterpart to LayersPanel on the
// left, and a replacement for the toolbar's floating Background / Padding /
// Rounding / Shadow / Border popovers. Same underlying config and the same
// controls, just laid out as an always-visible panel of collapsible
// sections rather than one-at-a-time popups.

const ROUNDING_OPTIONS = [
	{ value: "squircle", label: "Squircle" },
	{ value: "rounded", label: "Rounded" },
];

const SOURCE_TAB_ID = "bg-source-tab";
const SOURCE_PANEL_ID = "bg-source-panel";

/** Segmented control that switches which background picker is shown. Same
 * shape as the blur/pixelate toggle in AnnotationConfig — a recessed track
 * with the active segment raised — and wired to the ARIA tabs pattern:
 * Left/Right move between tabs, each tab owns the panel below it. */
function SourceTabs({
	active,
	onSelect,
}: {
	active: BackgroundSourceType;
	onSelect: (type: BackgroundSourceType) => void;
}) {
	const types = BACKGROUND_SOURCE_TABS.map((tab) => tab.type);

	return (
		<div
			role="tablist"
			aria-label="Background source"
			className="flex items-center gap-1 rounded-lg bg-gray-3 p-1"
		>
			{BACKGROUND_SOURCE_TABS.map(({ type, label }) => {
				const selected = active === type;
				return (
					<button
						key={type}
						type="button"
						role="tab"
						id={`${SOURCE_TAB_ID}-${type}`}
						aria-selected={selected}
						aria-controls={SOURCE_PANEL_ID}
						tabIndex={selected ? 0 : -1}
						onClick={() => onSelect(type)}
						onKeyDown={(event) => {
							if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
								return;
							event.preventDefault();
							const step = event.key === "ArrowRight" ? 1 : -1;
							const next =
								types[
									(types.indexOf(active) + step + types.length) % types.length
								];
							onSelect(next);
							document.getElementById(`${SOURCE_TAB_ID}-${next}`)?.focus();
						}}
						className={cn(
							"h-7 flex-1 rounded-md text-xs transition-colors duration-150 px-1.5",
							selected
								? "bg-accent-solid text-accent-on-solid shadow-sm"
								: "text-gray-11 hover:text-gray-12",
						)}
					>
						{label}
					</button>
				);
			})}
		</div>
	);
}

function BackgroundSection({
	background,
	onChange,
}: {
	background: BackgroundConfiguration;
	onChange: (patch: Partial<BackgroundConfiguration>) => void;
}) {
	const { history } = useScreenshotEditorContext();
	const { source } = background;

	// One undo entry per colour-picker drag rather than one per emitted frame.
	const colorScope = useRef<(() => void) | null>(null);

	// The tab you're looking at, kept separate from the background that's
	// actually applied. Switching tabs only changes which picker shows — it
	// never writes to the project. (Clicking "Image" used to immediately
	// replace the current wallpaper with an empty image source before you'd
	// picked a file.) A background is committed only by picking a value below.
	const [activeTab, setActiveTab] = useState<BackgroundSourceType>(source.type);

	// Follow the applied source when it changes from outside this panel
	// (undo/redo, project load). Browsing a tab doesn't change source.type,
	// so this never yanks the panel away from someone mid-browse.
	useEffect(() => {
		setActiveTab(source.type);
	}, [source.type]);

	// Picking any *visible* background also nudges framing off zero, or the
	// choice is invisible — see ensureVisibleFraming.
	const selectSource = (next: BackgroundConfiguration["source"]) => {
		onChange({ source: next, ...ensureVisibleFraming(background) });
	};

	const pickImage = async () => {
		const picked = await open({
			multiple: false,
			filters: [
				{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "avif"] },
			],
		});
		if (typeof picked === "string") {
			selectSource({ type: "image", path: picked });
		}
	};

	// What the Color / Gradient pickers render. When the open tab isn't the
	// applied source, these are DRAFT_* placeholders the user hasn't committed.
	const colorValue = source.type === "color" ? source.value : DRAFT_COLOR;
	const gradient = source.type === "gradient" ? source : DRAFT_GRADIENT;
	const gradientAngle = gradient.angle ?? 90;
	const uncommitted = activeTab !== source.type;

	// Spread as the base of every gradient commit so an edit to one stop (or the
	// angle) keeps whatever else the applied gradient carries — noise, scale.
	const gradientBase = (
		source.type === "gradient"
			? source
			: {
					type: "gradient",
					from: gradient.from,
					to: gradient.to,
					angle: gradientAngle,
				}
	) satisfies BackgroundConfiguration["source"];

	return (
		<PanelSection
			icon={<IconLucideImage className="size-3.5" />}
			title="Background"
		>
			<SourceTabs active={activeTab} onSelect={setActiveTab} />

			<div
				role="tabpanel"
				id={SOURCE_PANEL_ID}
				aria-labelledby={`${SOURCE_TAB_ID}-${activeTab}`}
				className="flex flex-col gap-3"
			>
				{uncommitted && activeTab !== "image" && (
					<p className="text-xs text-gray-10">
						{activeTab === "wallpaper"
							? "Pick a wallpaper to apply it."
							: activeTab === "color"
								? "Pick a colour to apply it."
								: "Pick a gradient to apply it."}
					</p>
				)}

				{activeTab === "wallpaper" && (
					<WallpaperTab
						selectedPath={source.type === "wallpaper" ? source.path : null}
						onSelect={(path) => selectSource({ type: "wallpaper", path })}
					/>
				)}

				{activeTab === "image" && (
					<ImageTab
						path={source.type === "image" ? source.path : null}
						onPick={() => void pickImage()}
						onClear={() => onChange({ source: { type: "image", path: null } })}
					/>
				)}

				{activeTab === "color" && (
					<>
						<ColorPickerPopover
							label="Background colour"
							className="w-full"
							value={colorValue}
							alpha={source.type === "color" ? (source.alpha ?? 255) : 255}
							onChange={({ value, alpha }) =>
								selectSource(
									alpha < 255
										? { type: "color", value, alpha }
										: { type: "color", value },
								)
							}
							onInteractStart={() => {
								colorScope.current = history.pause();
							}}
							onInteractEnd={() => {
								colorScope.current?.();
								colorScope.current = null;
							}}
						/>
						<div className="flex flex-wrap gap-2">
							{BACKGROUND_COLORS.map((color, index) => {
								const isActive =
									source.type === "color" &&
									rgbToHex(source.value) === rgbToHex(color);
								return (
									<button
										key={rgbToHex(color)}
										type="button"
										aria-label={
											BACKGROUND_COLOR_NAMES[index] ?? rgbToHex(color)
										}
										aria-pressed={isActive}
										onClick={() =>
											selectSource({ type: "color", value: color })
										}
										style={{ background: rgbToHex(color) }}
										className={cn(
											"size-7 rounded-lg border border-gray-5 transition-[opacity,box-shadow] duration-150",
											isActive
												? "ring-2 ring-accent-border-selected ring-offset-2 ring-offset-gray-1"
												: "hover:opacity-70",
										)}
									/>
								);
							})}
						</div>
					</>
				)}

				{activeTab === "gradient" && (
					<>
						<div className="flex gap-2">
							<ColorPickerPopover
								label="Gradient start colour"
								className="min-w-0 flex-1"
								showAlpha={false}
								value={gradient.from}
								onChange={({ value }) =>
									selectSource({ ...gradientBase, from: value })
								}
								onInteractStart={() => {
									colorScope.current = history.pause();
								}}
								onInteractEnd={() => {
									colorScope.current?.();
									colorScope.current = null;
								}}
							/>
							<ColorPickerPopover
								label="Gradient end colour"
								className="min-w-0 flex-1"
								showAlpha={false}
								value={gradient.to}
								onChange={({ value }) =>
									selectSource({ ...gradientBase, to: value })
								}
								onInteractStart={() => {
									colorScope.current = history.pause();
								}}
								onInteractEnd={() => {
									colorScope.current?.();
									colorScope.current = null;
								}}
							/>
						</div>
						<Slider
							label="Angle"
							value={gradientAngle}
							onChange={(angle) =>
								source.type === "gradient"
									? onChange({ source: { ...source, angle } })
									: selectSource({ ...gradientBase, angle })
							}
							min={0}
							max={360}
							format={(v) => `${Math.round(v)}°`}
						/>
						<div className="flex flex-wrap gap-2">
							{BACKGROUND_GRADIENTS.map((preset, index) => {
								const isActive =
									source.type === "gradient" &&
									rgbToHex(source.from) === rgbToHex(preset.from) &&
									rgbToHex(source.to) === rgbToHex(preset.to);
								return (
									<button
										key={`${rgbToHex(preset.from)}${rgbToHex(preset.to)}`}
										type="button"
										aria-label={`Gradient preset ${index + 1}`}
										aria-pressed={isActive}
										onClick={() =>
											selectSource({
												...gradientBase,
												from: preset.from,
												to: preset.to,
											})
										}
										style={{
											background: `linear-gradient(${gradientAngle}deg, ${rgbToHex(preset.from)}, ${rgbToHex(preset.to)})`,
										}}
										className={cn(
											"size-7 rounded-lg border border-gray-5 transition-[opacity,box-shadow] duration-150",
											isActive
												? "ring-2 ring-accent-border-selected ring-offset-2 ring-offset-gray-1"
												: "hover:opacity-70",
										)}
									/>
								);
							})}
						</div>
					</>
				)}
			</div>

			<Slider
				label="Padding"
				value={background.padding}
				min={0}
				max={40}
				format={(v) => `${Math.round(v)}%`}
				onChange={(padding) =>
					// Raising padding over an invisible background would just
					// reveal more nothing — see ensureVisibleBackground.
					onChange({
						padding,
						...(padding > 0 ? ensureVisibleBackground(background) : {}),
					})
				}
			/>

			<Slider
				label="Background Blur"
				value={background.blur}
				onChange={(blur) => onChange({ blur })}
				min={0}
				max={100}
				format={(v) => `${Math.round(v)}%`}
			/>

			{/* Grain over the whole background, any source. Mirrors the
			    renderer's fallback to a gradient's own noise for older projects. */}
			<Slider
				label="Noise"
				value={
					background.noiseIntensity ??
					(source.type === "gradient" ? source.noise_intensity : null) ??
					0
				}
				onChange={(value) =>
					onChange({ noiseIntensity: value > 0 ? value : null })
				}
				min={0}
				max={100}
				format={(v) => `${Math.round(v)}%`}
			/>
		</PanelSection>
	);
}

function BorderSection({
	background,
	onChange,
}: {
	background: BackgroundConfiguration;
	onChange: (patch: Partial<BackgroundConfiguration>) => void;
}) {
	// Nullable in Cap's schema (absent means "never configured"), so every
	// edit merges onto a default rather than assuming an object exists.
	const border = background.border ?? {
		enabled: false,
		width: 5,
		color: [0, 0, 0] as [number, number, number],
		opacity: 50,
	};
	const { history } = useScreenshotEditorContext();

	const setBorder = (patch: Partial<typeof border>) =>
		onChange({ border: { ...border, ...patch } });
	const colorScope = useRef<(() => void) | null>(null);

	return (
		<PanelSection
			icon={<IconLucideSquare className="size-3.5" />}
			title="Border"
			defaultOpen={false}
		>
			<Slider
				label="Radius"
				value={background.rounding}
				min={0}
				max={100}
				format={(v) => `${Math.round(v)}px`}
				onChange={(rounding) => onChange({ rounding })}
			/>
			<Field name="Corner Style" shouldFlexRow>
				<Select
					variant="light"
					className="h-8 w-full text-xs"
					options={ROUNDING_OPTIONS}
					value={background.roundingType}
					onValueChange={(roundingType) =>
						onChange({
							roundingType:
								roundingType as BackgroundConfiguration["roundingType"],
						})
					}
				/>
			</Field>

			<div className="flex flex-row items-center justify-between  border-gray-4 ">
				<span className="text-xs font-medium text-gray-11">Border</span>
				<Switch
					checked={border.enabled}
					onCheckedChange={(enabled) => setBorder({ enabled })}
				/>
			</div>

			<Collapsible.Root open={border.enabled}>
				<Collapsible.Panel className="overflow-hidden">
					<div className="flex flex-col gap-4">
						<Slider
							label="Thickness"
							value={border.width}
							min={1}
							max={20}
							step={0.1}
							format={(v) => `${v.toFixed(1)}px`}
							onChange={(width) => setBorder({ width })}
						/>
						<Slider
							label="Opacity"
							value={border.opacity}
							min={0}
							max={100}
							step={0.1}
							format={(v) => `${Math.round(v)}%`}
							onChange={(opacity) => setBorder({ opacity })}
						/>
						<Field name="Color">
							<ColorPickerPopover
								label="Border colour"
								className="w-full"
								value={border.color}
								showAlpha={false}
								onChange={({ value }) => setBorder({ color: value })}
								onInteractStart={() => {
									colorScope.current = history.pause();
								}}
								onInteractEnd={() => {
									colorScope.current?.();
									colorScope.current = null;
								}}
							/>
						</Field>
					</div>
				</Collapsible.Panel>
			</Collapsible.Root>
		</PanelSection>
	);
}

function ShadowSection({
	background,
	onChange,
}: {
	background: BackgroundConfiguration;
	onChange: (patch: Partial<BackgroundConfiguration>) => void;
}) {
	// Cap's model: `shadow` is the master intensity, `advancedShadow` the
	// per-parameter detail, created on demand the first time it is touched.
	const advanced = background.advancedShadow ?? {
		size: 50,
		opacity: 18,
		blur: 50,
	};
	const setAdvanced = (patch: Partial<typeof advanced>) =>
		onChange({ advancedShadow: { ...advanced, ...patch } });

	return (
		<PanelSection
			icon={<IconLucideSun className="size-3.5" />}
			title="Shadow"
			defaultOpen={false}
		>
			<Slider
				label="Shadow"
				value={background.shadow}
				min={0}
				max={100}
				format={(v) => `${Math.round(v)}%`}
				onChange={(shadow) =>
					onChange({
						shadow,
						// Turning the shadow on for the first time needs detail
						// values to drive, or the renderer has nothing to shape it.
						...(shadow > 0 && !background.advancedShadow
							? { advancedShadow: advanced }
							: {}),
					})
				}
			/>
			<Slider
				label="Size"
				value={advanced.size}
				min={0}
				max={100}
				step={0.1}
				onChange={(size) => setAdvanced({ size })}
			/>
			<Slider
				label="Opacity"
				value={advanced.opacity}
				min={0}
				max={100}
				step={0.1}
				onChange={(opacity) => setAdvanced({ opacity })}
			/>
			<Slider
				label="Blur"
				value={advanced.blur}
				min={0}
				max={100}
				step={0.1}
				onChange={(blur) => setAdvanced({ blur })}
			/>
		</PanelSection>
	);
}

export function StylePanel() {
	const { project, updateBackground, setRightPanel } =
		useScreenshotEditorContext();
	if (!project) return null;
	const background = project.background;

	return (
		<div className="flex h-full w-full min-h-0 flex-col">
			<div className="flex h-11 shrink-0 items-center justify-between px-3">
				<span className="text-xs font-medium text-gray-12">Style</span>
				<button
					type="button"
					onClick={() => setRightPanel(null)}
					aria-label="Close style panel"
					className="flex size-6 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
				>
					<IconLucideX className="size-3.5" />
				</button>
			</div>

			<div className="custom-scroll min-h-0 flex-1 overflow-y-auto pb-10">
				<BackgroundSection
					background={background}
					onChange={updateBackground}
				/>
				<BorderSection background={background} onChange={updateBackground} />
				<ShadowSection background={background} onChange={updateBackground} />
			</div>
		</div>
	);
}
