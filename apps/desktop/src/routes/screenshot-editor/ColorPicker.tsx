import { cn, Popover, PopoverContent, PopoverTrigger } from "@quiro/ui";
import { useEffect, useRef, useState } from "react";
import {
	type Color,
	ColorArea,
	type ColorChannel,
	ColorField,
	ColorSlider,
	ColorThumb,
	Input,
	parseColor,
	SliderTrack,
} from "react-aria-components";
import IconLucidePipette from "~icons/lucide/pipette";
import { rgbToHex } from "./ui";

// The Color-tab picker in StylePanel. Built on react-aria-components' colour
// primitives — an accessible 2-D area, hue/alpha sliders, hex parsing — styled
// with the panel's own tokens. Canonical state is an HSB Color so the area and
// hue slider keep working at brightness/saturation extremes where RGB would
// collapse the hue; the value is reported back as an [r,g,b] triple plus a
// 0–255 alpha.

type RGB = [number, number, number];

export interface ColorPickerValue {
	value: RGB;
	alpha: number;
}

const FORMATS = ["hex", "rgb", "hsl"] as const;
type Format = (typeof FORMATS)[number];

const CHANNEL_LABEL: Partial<Record<ColorChannel, string>> = {
	red: "R",
	green: "G",
	blue: "B",
	hue: "H",
	saturation: "S",
	lightness: "L",
};

const clamp = (n: number, min: number, max: number) =>
	Math.min(Math.max(n, min), max);

const rgbaCss = ([r, g, b]: RGB, alpha: number) =>
	`rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 255) / 255})`;

function toColor({ value, alpha }: ColorPickerValue): Color {
	const [r, g, b] = value;
	return parseColor(
		`rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 255) / 255})`,
	).toFormat("hsb");
}

function fromColor(color: Color): ColorPickerValue {
	const rgb = color.toFormat("rgb");
	return {
		value: [
			Math.round(rgb.getChannelValue("red")),
			Math.round(rgb.getChannelValue("green")),
			Math.round(rgb.getChannelValue("blue")),
		],
		alpha: Math.round(color.getChannelValue("alpha") * 255),
	};
}

const keyOf = ({ value, alpha }: ColorPickerValue) =>
	`${value.join(",")}:${alpha}`;

// Feature-detected: the native picker is Chromium-only, so it's absent in the
// macOS (WKWebView) and Linux (WebKitGTK) Tauri webviews.
const eyeDropperSupported =
	typeof window !== "undefined" && "EyeDropper" in window;

export function ColorPicker({
	value,
	alpha = 255,
	showAlpha = true,
	onChange,
	onInteractStart,
	onInteractEnd,
}: {
	value: RGB;
	alpha?: number;
	/** Show the alpha slider + input. When off, the reported alpha is always 255. */
	showAlpha?: boolean;
	onChange: (next: ColorPickerValue) => void;
	/** Fires before the first change of a slider/area drag, so the caller can
	 *  collapse the whole drag into one undo entry. */
	onInteractStart?: () => void;
	/** Fires when that drag ends. */
	onInteractEnd?: () => void;
}) {
	const [color, setColor] = useState<Color>(() => toColor({ value, alpha }));
	const [format, setFormat] = useState<Format>("rgb");

	// Re-seed when the value changes from outside (undo/redo, a preset swatch,
	// project load). Our own emits set lastEmitted first, so they don't bounce.
	const lastEmitted = useRef(keyOf({ value, alpha }));
	useEffect(() => {
		const key = keyOf({ value, alpha });
		if (key !== lastEmitted.current) {
			lastEmitted.current = key;
			setColor(toColor({ value, alpha }));
		}
	}, [value, alpha]);

	const emit = (next: Color) => {
		setColor(next);
		const out = fromColor(next);
		if (!showAlpha) out.alpha = 255;
		lastEmitted.current = keyOf(out);
		onChange(out);
	};

	// A slider/area drag fires onChange repeatedly then onChangeEnd once; open
	// an undo scope on the first change and close it at the end.
	const dragging = useRef(false);
	const beginDrag = () => {
		if (!dragging.current) {
			dragging.current = true;
			onInteractStart?.();
		}
	};
	const endDrag = () => {
		if (dragging.current) {
			dragging.current = false;
			onInteractEnd?.();
		}
	};

	const pickWithEyeDropper = async () => {
		const Ctor = (
			window as unknown as {
				EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
			}
		).EyeDropper;
		if (!Ctor) return;
		try {
			const { sRGBHex } = await new Ctor().open();
			emit(parseColor(sRGBHex).toFormat("hsb"));
		} catch {
			// user dismissed the eyedropper
		}
	};

	const channelColor =
		format === "hsl" ? color.toFormat("hsl") : color.toFormat("rgb");
	const channels: ColorChannel[] =
		format === "hsl"
			? ["hue", "saturation", "lightness"]
			: ["red", "green", "blue"];

	return (
		<div className="flex flex-col gap-2.5">
			<ColorArea
				className="cap-color-area"
				colorSpace="hsb"
				xChannel="saturation"
				yChannel="brightness"
				value={color}
				onChange={(next) => {
					beginDrag();
					emit(next);
				}}
				onChangeEnd={(next) => {
					emit(next);
					endDrag();
				}}
			>
				<ColorThumb className="cap-color-thumb" />
			</ColorArea>

			<div className="flex items-center gap-2">
				{eyeDropperSupported && (
					<button
						type="button"
						onClick={() => void pickWithEyeDropper()}
						aria-label="Pick a colour from the screen"
						className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-gray-5 text-gray-11 transition-colors hover:bg-gray-3 hover:text-gray-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/50"
					>
						<IconLucidePipette className="size-4" />
					</button>
				)}

				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<ColorSlider
						className="cap-color-slider"
						colorSpace="hsb"
						channel="hue"
						value={color}
						onChange={(next) => {
							beginDrag();
							emit(next);
						}}
						onChangeEnd={(next) => {
							emit(next);
							endDrag();
						}}
					>
						<SliderTrack className="cap-color-slider-track">
							<ColorThumb className="cap-color-thumb mt-1" />
						</SliderTrack>
					</ColorSlider>

					{showAlpha && (
						<ColorSlider
							className="cap-color-slider"
							channel="alpha"
							value={color}
							onChange={(next) => {
								beginDrag();
								emit(next);
							}}
							onChangeEnd={(next) => {
								emit(next);
								endDrag();
							}}
						>
							<div className="cap-color-alpha-bg">
								<SliderTrack className="cap-color-slider-track">
									<ColorThumb className="cap-color-thumb mt-1" />
								</SliderTrack>
							</div>
						</ColorSlider>
					)}
				</div>
			</div>

			<div className="flex items-center gap-1 rounded-lg bg-gray-3 p-1">
				{FORMATS.map((id) => (
					<button
						key={id}
						type="button"
						aria-pressed={format === id}
						onClick={() => setFormat(id)}
						className={cn(
							"h-6 flex-1 rounded-md text-xs uppercase transition-colors duration-150",
							format === id
								? "bg-gray-1 text-gray-12 shadow-sm"
								: "text-gray-11 hover:text-gray-12",
						)}
					>
						{id}
					</button>
				))}
			</div>

			<div className="flex items-start justify-between shrink-0 gap-2">
				{format === "hex" ? (
					<div className="shrink-0 space-y-1">
						<p className="text-[10px] font-medium uppercase tracking-wide text-gray-10">
							HEX CODE
						</p>
						<ColorField
							aria-label="Hex colour"
							value={color}
							onChange={(next) => next && emit(next.toFormat("hsb"))}
							className="min-w-0 flex-1"
						>
							<Input className="w-full rounded-md border border-gray-5 bg-gray-1 px-2 py-1 text-center text-[13px] uppercase tabular-nums text-gray-12 outline-none focus:ring-1 focus:ring-accent-400" />
						</ColorField>
					</div>
				) : (
					<div className="flex min-w-0 flex-1 gap-1.5">
						{channels.map((channel) => (
							<ChannelInput
								key={channel}
								color={channelColor}
								channel={channel}
								onCommit={(next) => emit(next.toFormat("hsb"))}
							/>
						))}
					</div>
				)}

				{showAlpha && (
					<ChannelInput
						color={color}
						channel="alpha"
						suffix="%"
						onCommit={emit}
					/>
				)}
			</div>
		</div>
	);
}

function ChannelInput({
	color,
	channel,
	suffix,
	onCommit,
}: {
	color: Color;
	channel: ColorChannel;
	suffix?: string;
	onCommit: (color: Color) => void;
}) {
	const range = color.getChannelRange(channel);
	const isAlpha = channel === "alpha";
	const shown = isAlpha
		? String(Math.round(color.getChannelValue("alpha") * 100))
		: String(Math.round(color.getChannelValue(channel)));

	const [draft, setDraft] = useState<string | null>(null);

	const commit = (raw: string) => {
		const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
		if (Number.isFinite(parsed)) {
			const next = isAlpha ? parsed / 100 : parsed;
			onCommit(
				color.withChannelValue(
					channel,
					clamp(next, range.minValue, range.maxValue),
				),
			);
		}
		setDraft(null);
	};

	return (
		<label
			className={cn(
				"flex flex-col items-center gap-1",
				isAlpha ? "w-fit!  flex-1!" : "min-w-0 flex-1",
			)}
		>
			<span className="text-[10px] font-medium uppercase tracking-wide text-gray-10">
				{isAlpha ? "A" : (CHANNEL_LABEL[channel] ?? channel)}
			</span>
			<div className="flex w-full items-center rounded-md border border-gray-5 bg-gray-1 focus-within:ring-1 focus-within:ring-accent-400">
				<input
					type="text"
					inputMode="numeric"
					value={draft ?? shown}
					onChange={(event) => setDraft(event.target.value)}
					onFocus={(event) => event.currentTarget.select()}
					onBlur={(event) => commit(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							commit(event.currentTarget.value);
							event.currentTarget.blur();
						}
					}}
					className="w-full min-w-12 bg-transparent px-1.5 py-1 text-center text-[13px] tabular-nums text-gray-12 outline-none"
				/>
				{suffix && (
					<span className="pr-1.5 text-[11px] text-gray-10">{suffix}</span>
				)}
			</div>
		</label>
	);
}

// A swatch button that opens the picker in a popover — the form used in the
// Style panel, where the inline picker would push everything else off-screen.
// Portalled, so it isn't clipped by the panel's scroll container.
export function ColorPickerPopover({
	value,
	alpha = 255,
	showAlpha = true,
	label,
	className,
	onChange,
	onInteractStart,
	onInteractEnd,
}: {
	value: RGB;
	alpha?: number;
	showAlpha?: boolean;
	/** Accessible name for the trigger, e.g. "Background colour". */
	label: string;
	className?: string;
	onChange: (next: ColorPickerValue) => void;
	onInteractStart?: () => void;
	onInteractEnd?: () => void;
}) {
	const translucent = showAlpha && alpha < 255;

	return (
		<Popover>
			<PopoverTrigger
				render={
					<button
						type="button"
						aria-label={label}
						className={cn(
							"flex h-8 items-center gap-2 rounded-lg border border-gray-5 bg-gray-1 py-1 pl-1 pr-2 text-[13px] text-gray-12 outline-none transition-colors hover:bg-gray-2 focus-visible:ring-2 focus-visible:ring-accent-400/50",
							className,
						)}
					>
						<span
							className={cn(
								"size-6 shrink-0 overflow-hidden rounded-md border border-gray-a5",
								translucent && "cap-color-swatch-bg",
							)}
						>
							<span
								className="block size-full"
								style={{
									backgroundColor: rgbaCss(value, showAlpha ? alpha : 255),
								}}
							/>
						</span>
						<span className="truncate tabular-nums uppercase">
							{rgbToHex(value)}
						</span>
					</button>
				}
			/>
			<PopoverContent
				align="start"
				className="w-64 p-3 z-[100000]! bg-background! relative"
			>
				<ColorPicker
					value={value}
					alpha={alpha}
					showAlpha={showAlpha}
					onChange={onChange}
					onInteractStart={onInteractStart}
					onInteractEnd={onInteractEnd}
				/>
			</PopoverContent>
		</Popover>
	);
}
