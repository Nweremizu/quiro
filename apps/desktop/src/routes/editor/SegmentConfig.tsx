import { Button, cn, Select, Switch } from "@quiro/ui";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { FontPicker } from "@/components/FontPicker";
import type {
	CameraXPosition,
	CameraYPosition,
	CaptionSegment,
	CaptionTrackSegment,
	GrowType,
	MaskMode,
	MaskSegment,
	SceneMode,
	TextAlign,
	TextTransform,
	VerticalAlign,
	ZoomSegment,
} from "@/utils/tauri";
import IconLucideAperture from "~icons/lucide/aperture";
import IconLucideBlend from "~icons/lucide/blend";
import IconLucideCircle from "~icons/lucide/circle";
import IconLucideCrosshair from "~icons/lucide/crosshair";
import IconLucideGrid3X3 from "~icons/lucide/grid-3x3";
import IconLucideMousePointer2 from "~icons/lucide/mouse-pointer-2";
import IconLucideRectangleHorizontal from "~icons/lucide/rectangle-horizontal";
import IconLucideRotateCcw from "~icons/lucide/rotate-ccw";
import IconLucideShield from "~icons/lucide/shield";
import IconLucideSquareRoundCorner from "~icons/lucide/square-round-corner";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import { ColorPickerPopover } from "../screenshot-editor/ColorPicker";
import { hexToRgb, rgbToHex } from "../screenshot-editor/ui";
import { ConfirmAction } from "./ConfirmAction";
import {
	mapEditedTimeToSource,
	retimeCaptionSegment,
	sourceCaptionId,
	syncCaptionWordsWithText,
} from "./captions";
import { useEditorContext } from "./context";
import { MotionStateControls } from "./MotionStateControls";
import {
	textContentParagraph,
	textContentString,
	textContentStyle,
	withTextContentParagraph,
	withTextContentString,
	withTextContentStyle,
} from "./text-content";
import { Field, Slider, Subfield } from "./ui";

const TRANSFORM_OPTIONS: Array<{ label: string; value: TextTransform }> = [
	{ label: "None", value: "none" },
	{ label: "UPPERCASE", value: "uppercase" },
	{ label: "lowercase", value: "lowercase" },
	{ label: "Capitalize", value: "capitalize" },
];

const colorToRgb = (value: string): [number, number, number] =>
	hexToRgb(value) ?? [255, 255, 255];

const ALIGN_OPTIONS: Array<{ label: string; value: TextAlign }> = [
	{ label: "Left", value: "left" },
	{ label: "Center", value: "center" },
	{ label: "Right", value: "right" },
	{ label: "Justify", value: "justify" },
];

const VERTICAL_ALIGN_OPTIONS: Array<{ label: string; value: VerticalAlign }> = [
	{ label: "Top", value: "top" },
	{ label: "Middle", value: "center" },
	{ label: "Bottom", value: "bottom" },
];

const GROW_TYPE_OPTIONS: Array<{ label: string; value: GrowType }> = [
	{ label: "Hug (width)", value: "autoWidth" },
	{ label: "Wrap (height)", value: "autoHeight" },
	{ label: "Fixed", value: "fixed" },
];

// Selecting a timeline segment replaces the sidebar's tabs with that
// segment's own settings, the way Cap's does — the properties that only make
// sense for one segment live here rather than in the global tabs.

const SCENE_MODES: Array<{ label: string; value: SceneMode }> = [
	{ label: "Default", value: "default" },
	{ label: "Camera only", value: "cameraOnly" },
	{ label: "Hide camera", value: "hideCamera" },
	{ label: "Split screen", value: "splitScreen" },
];

const MASK_MODES = [
	{
		label: "Blur",
		description: "Soften details",
		value: "blur" as const,
		icon: IconLucideBlend,
	},
	{
		label: "Pixelate",
		description: "Break up details",
		value: "pixelate" as const,
		icon: IconLucideGrid3X3,
	},
	{
		label: "Redact",
		description: "Remove pixels",
		value: "redact" as const,
		icon: IconLucideShield,
	},
	{
		label: "Spotlight",
		description: "Dim the outside",
		value: "spotlight" as const,
		icon: IconLucideAperture,
	},
];

/** Blur and pixelate transform the pixels; the originals are still in there in
 * principle. Say so, rather than letting someone cover a password with a blur
 * and believe it is gone. */
const REVERSIBLE_MODES: ReadonlySet<MaskMode> = new Set<MaskMode>([
	"blur",
	"pixelate",
]);

/** The effect amount is in the mask contract's units, not 0..1 — the slider
 * that wrote 0..1 into this field made every value collapse to the minimum.
 * Kept in step with `mask-effects.json`. */
const MASK_AMOUNT_MIN = 4;
const MASK_AMOUNT_MAX = 80;
const MASK_AMOUNT_DEFAULT = 16;
const MASK_DARKNESS_DEFAULT = 0.55;
const MASK_FADE_DURATION_DEFAULT = 0.2;

const MASK_SHAPES = [
	{
		label: "Rectangle",
		value: "rect" as const,
		icon: IconLucideRectangleHorizontal,
	},
	{ label: "Ellipse", value: "ellipse" as const, icon: IconLucideCircle },
	{
		label: "Rounded",
		value: "roundedRect" as const,
		icon: IconLucideSquareRoundCorner,
	},
];

export function ZoomSegmentSettings({
	segment,
	onChange,
	onPreviewChange,
	onTransientChange,
	onDone,
}: {
	segment: ZoomSegment;
	onChange: (patch: Partial<ZoomSegment>) => void;
	onPreviewChange?: (patch: Partial<ZoomSegment>) => void;
	onTransientChange?: (patch: Partial<ZoomSegment>) => void;
	onDone: () => void;
}) {
	const manual = typeof segment.mode === "object" ? segment.mode.manual : null;
	const previewChange = onPreviewChange ?? onChange;
	const transientChange = onTransientChange ?? onChange;

	return (
		<SegmentPanel title="Zoom segment" onDone={onDone}>
			<section className="rounded-xl bg-gray-2 p-3">
				<div className="mb-3 flex items-center gap-3">
					<ZoomScaleDrawing amount={segment.amount} />
					<div className="min-w-0">
						<h2 className="text-xs font-semibold text-gray-12">Scale</h2>
						<p className="mt-0 text-[11px] text-gray-10">
							How close the canvas moves.
						</p>
					</div>
					<strong className="ml-auto font-mono text-lg font-semibold tabular-nums text-gray-12">
						{segment.amount.toFixed(1)}×
					</strong>
				</div>
				<Slider
					size="xs"
					ariaLabel="Zoom amount"
					format={(v) => `${v.toFixed(1)}x`}
					min={1}
					max={4}
					step={0.1}
					ticks={5}
					value={segment.amount}
					onChange={(amount) => onChange({ amount })}
				/>
			</section>

			<ZoomFocusControls
				manual={manual}
				followCursor={segment.mode === "auto"}
				onChange={(mode) => onChange({ mode })}
				onPreviewChange={(mode) => previewChange({ mode })}
				onTransientChange={(mode) => transientChange({ mode })}
			/>

			<MotionStateControls
				motion={segment.motion ?? {}}
				onChange={(motion) => onChange({ motion })}
				onPreview={(motion) => previewChange({ motion })}
				onCommit={(motion) => transientChange({ motion })}
			/>
		</SegmentPanel>
	);
}

function MaskSegmentSettings({
	segment,
	onChange,
	onDone,
}: {
	segment: MaskSegment;
	onChange: (patch: Partial<MaskSegment>) => void;
	onDone: () => void;
}) {
	const mode = segment.mode ?? "blur";
	const activeMode = MASK_MODES.find((option) => option.value === mode);
	const ActiveModeIcon = activeMode?.icon ?? IconLucideBlend;

	return (
		<SegmentPanel title="Mask segment" onDone={onDone}>
			<section className="rounded-xl bg-gray-2 p-3">
				<div className="flex items-center gap-3">
					<div className="grid size-10 shrink-0 place-items-center rounded-lg bg-gray-4 text-gray-12">
						<ActiveModeIcon className="size-5" />
					</div>
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-gray-12">
							{activeMode?.label ?? "Mask"}
						</h2>
						<p className="text-pretty text-[11px] text-gray-10">
							{activeMode?.description ?? "Control the selected region"}
						</p>
					</div>
					<Switch
						aria-label="Enable mask segment"
						checked={segment.enabled ?? true}
						onCheckedChange={(enabled) => onChange({ enabled })}
						className="ml-auto"
					/>
				</div>
			</section>

			<section>
				<div className="mb-3">
					<h2 className="text-sm font-semibold text-gray-12">Effect</h2>
					<p className="text-pretty text-[11px] text-gray-10">
						Choose how the selected area affects the video.
					</p>
				</div>
				<div className="grid grid-cols-2 gap-1.5">
					{MASK_MODES.map((option) => {
						const Icon = option.icon;
						const active = option.value === mode;

						return (
							<button
								key={option.value}
								type="button"
								aria-pressed={active}
								onClick={() =>
									onChange({
										mode: option.value,
										...(option.value === "spotlight" && segment.darkness == null
											? { darkness: MASK_DARKNESS_DEFAULT }
											: {}),
									})
								}
								className={cn(
									"flex min-h-14 items-center gap-2 rounded-lg px-2.5 text-left outline-none transition-[background-color,color,scale] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none",
									active
										? "bg-gray-4 text-gray-12 ring-1 ring-accent-border-selected"
										: "bg-gray-2 text-gray-10 hover:bg-gray-3 hover:text-gray-12",
								)}
							>
								<Icon className="size-4 shrink-0" />
								<span className="min-w-0">
									<span className="block truncate text-xs font-semibold">
										{option.label}
									</span>
									<span className="block truncate text-[10px] text-gray-10">
										{option.description}
									</span>
								</span>
							</button>
						);
					})}
				</div>
			</section>

			<section>
				<h2 className="mb-3 text-sm font-semibold text-gray-12">Shape</h2>
				<div className="grid grid-cols-3 gap-1.5 rounded-xl bg-gray-2 p-1">
					{MASK_SHAPES.map((option) => {
						const Icon = option.icon;
						const active = option.value === (segment.shape ?? "rect");

						return (
							<button
								key={option.value}
								type="button"
								aria-label={option.label}
								aria-pressed={active}
								title={option.label}
								onClick={() => onChange({ shape: option.value })}
								className={cn(
									"grid min-h-9 place-items-center rounded-lg outline-none transition-[background-color,color,scale] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
									active
										? "bg-gray-1 text-gray-12"
										: "text-gray-9 hover:bg-gray-3 hover:text-gray-12",
								)}
							>
								<Icon className="size-4" />
							</button>
						);
					})}
				</div>
			</section>

			<section className="flex flex-col gap-5 rounded-xl bg-gray-2 p-3">
				{mode === "blur" || mode === "pixelate" ? (
					<Slider
						size="sm"
						label={mode === "blur" ? "Blur radius" : "Block size"}
						format={(value) => `${Math.round(value)}`}
						min={MASK_AMOUNT_MIN}
						max={MASK_AMOUNT_MAX}
						step={1}
						value={segment.amount ?? MASK_AMOUNT_DEFAULT}
						onChange={(amount) => onChange({ amount })}
					/>
				) : null}

				{mode === "spotlight" ? (
					<Slider
						size="sm"
						label="Outside darkness"
						format={(value) => `${Math.round(value * 100)}%`}
						min={0}
						max={1}
						step={0.01}
						value={segment.darkness ?? MASK_DARKNESS_DEFAULT}
						onChange={(darkness) => onChange({ darkness })}
					/>
				) : null}

				{mode === "blur" || mode === "pixelate" ? (
					<Slider
						size="sm"
						label="Edge softness"
						format={(value) => `${Math.round(value * 100)}%`}
						min={0}
						max={1}
						step={0.01}
						value={segment.feather ?? 0}
						onChange={(feather) => onChange({ feather })}
					/>
				) : null}
			</section>

			{mode === "spotlight" ? (
				<section>
					<div className="mb-3">
						<h2 className="text-sm font-semibold text-gray-12">Animation</h2>
						<p className="text-pretty text-[11px] text-gray-10">
							Ease the spotlight on and off at both segment edges.
						</p>
					</div>
					<div className="rounded-xl bg-gray-2 p-3">
						<Slider
							size="sm"
							label="Fade in & out"
							format={(value) => `${value.toFixed(2)}s`}
							min={0}
							max={1.5}
							step={0.05}
							value={segment.fadeDuration ?? MASK_FADE_DURATION_DEFAULT}
							onChange={(fadeDuration) => onChange({ fadeDuration })}
						/>
					</div>
				</section>
			) : null}

			{REVERSIBLE_MODES.has(mode) ? (
				<div className="rounded-lg border border-amber-6 bg-amber-2 px-3 py-2.5">
					<p className="text-pretty text-[11px] leading-relaxed text-amber-11">
						Blur and pixelation hide details visually, but the original pixels
						may still be recoverable. Use Redact for sensitive information.
					</p>
				</div>
			) : null}
		</SegmentPanel>
	);
}

const FOCUS_POINTS = [
	{ label: "Top left", x: 0, y: 0 },
	{ label: "Top center", x: 0.5, y: 0 },
	{ label: "Top right", x: 1, y: 0 },
	{ label: "Center left", x: 0, y: 0.5 },
	{ label: "Center", x: 0.5, y: 0.5 },
	{ label: "Center right", x: 1, y: 0.5 },
	{ label: "Bottom left", x: 0, y: 1 },
	{ label: "Bottom center", x: 0.5, y: 1 },
	{ label: "Bottom right", x: 1, y: 1 },
] as const;

const FOCUS_PAD_INSET = 0.08;
const FOCUS_SNAP_RADIUS = 0.08;
const FOCUS_SNAP_VALUES = [0, 0.5, 1] as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// Renderer values stay normalized to 0..1. The inverse pair only insets their
// visual positions so edge handles remain visible, keeping input, dots, and the
// displayed handle on the same coordinate map.
const focusToPadPercent = (value: number) =>
	(FOCUS_PAD_INSET + clamp01(value) * (1 - FOCUS_PAD_INSET * 2)) * 100;

const focusFromPadFraction = (value: number) =>
	clamp01((value - FOCUS_PAD_INSET) / (1 - FOCUS_PAD_INSET * 2));

const snapFocusCoordinate = (value: number) => {
	const nearest = FOCUS_SNAP_VALUES.reduce((closest, candidate) =>
		Math.abs(candidate - value) < Math.abs(closest - value)
			? candidate
			: closest,
	);
	return Math.abs(nearest - value) <= FOCUS_SNAP_RADIUS ? nearest : value;
};

function useFocusPad(
	x: number,
	y: number,
	onStart: (x: number, y: number) => void,
	onPreview: (x: number, y: number) => void,
	onEnd: (x: number, y: number) => void,
) {
	const ref = useRef<HTMLDivElement>(null);
	const pendingPoint = useRef<{ clientX: number; clientY: number } | null>(
		null,
	);
	const pendingFrame = useRef<number | null>(null);
	const dragging = useRef(false);
	const latestPoint = useRef({ x, y });
	const callbacks = useRef({ onStart, onPreview, onEnd });
	callbacks.current = { onStart, onPreview, onEnd };
	const [visualPoint, setVisualPoint] = useState({ x, y });

	useEffect(() => {
		if (dragging.current) return;
		const next = { x, y };
		latestPoint.current = next;
		setVisualPoint(next);
	}, [x, y]);

	const readPoint = useCallback((clientX: number, clientY: number) => {
		const bounds = ref.current?.getBoundingClientRect();
		if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
		const x = focusFromPadFraction((clientX - bounds.left) / bounds.width);
		const y = focusFromPadFraction((clientY - bounds.top) / bounds.height);
		return {
			x: snapFocusCoordinate(x),
			y: snapFocusCoordinate(y),
		};
	}, []);

	const paintPreview = useCallback((point: { x: number; y: number }) => {
		latestPoint.current = point;
		setVisualPoint((current) =>
			current.x === point.x && current.y === point.y ? current : point,
		);
		callbacks.current.onPreview(point.x, point.y);
	}, []);

	const flushPreview = useCallback(() => {
		if (pendingFrame.current !== null) {
			cancelAnimationFrame(pendingFrame.current);
			pendingFrame.current = null;
		}
		const point = pendingPoint.current;
		pendingPoint.current = null;
		if (!point) return;
		const next = readPoint(point.clientX, point.clientY);
		if (next) paintPreview(next);
	}, [paintPreview, readPoint]);

	useEffect(
		() => () => {
			if (pendingFrame.current !== null)
				cancelAnimationFrame(pendingFrame.current);
		},
		[],
	);

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.currentTarget.setPointerCapture(event.pointerId);
			dragging.current = true;
			const point = readPoint(event.clientX, event.clientY);
			if (!point) return;
			latestPoint.current = point;
			setVisualPoint(point);
			callbacks.current.onStart(point.x, point.y);
		},
		[readPoint],
	);

	const onPointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
			pendingPoint.current = {
				clientX: event.clientX,
				clientY: event.clientY,
			};
			if (pendingFrame.current !== null) return;
			pendingFrame.current = requestAnimationFrame(() => {
				pendingFrame.current = null;
				const point = pendingPoint.current;
				pendingPoint.current = null;
				if (!point) return;
				const next = readPoint(point.clientX, point.clientY);
				if (next) paintPreview(next);
			});
		},
		[paintPreview, readPoint],
	);

	const endPointer = useCallback(() => {
		flushPreview();
		dragging.current = false;
		const point = latestPoint.current;
		callbacks.current.onEnd(point.x, point.y);
	}, [flushPreview]);

	return {
		ref,
		visualPoint,
		onPointerDown,
		onPointerMove,
		onPointerUp: endPointer,
		onPointerCancel: endPointer,
	};
}

function ZoomScaleDrawing({ amount }: { amount: number }) {
	const width = 48 / amount;
	const height = 30 / amount;

	return (
		<svg
			viewBox="0 0 64 40"
			aria-hidden="true"
			className="h-10 w-16 shrink-0 rounded-lg bg-gray-3 text-gray-9"
		>
			<rect
				x="5"
				y="5"
				width="54"
				height="30"
				rx="4"
				fill="none"
				stroke="currentColor"
				strokeWidth="1"
				opacity="0.45"
			/>
			<rect
				x={32 - width / 2}
				y={20 - height / 2}
				width={width}
				height={height}
				rx="2.5"
				fill="currentColor"
				opacity="0.9"
			/>
			<circle cx="32" cy="20" r="1.5" fill="var(--accent-solid)" />
		</svg>
	);
}

function ZoomFocusControls({
	manual,
	followCursor,
	onChange,
	onPreviewChange,
	onTransientChange,
}: {
	manual: { x: number; y: number } | null;
	followCursor: boolean;
	onChange: (mode: ZoomSegment["mode"]) => void;
	onPreviewChange: (mode: ZoomSegment["mode"]) => void;
	onTransientChange: (mode: ZoomSegment["mode"]) => void;
}) {
	const updateManualFocus = useCallback(
		(x: number, y: number) => onChange({ manual: { x, y } }),
		[onChange],
	);
	const updateManualFocusPreview = useCallback(
		(x: number, y: number) => onPreviewChange({ manual: { x, y } }),
		[onPreviewChange],
	);
	const updateManualFocusTransient = useCallback(
		(x: number, y: number) => onTransientChange({ manual: { x, y } }),
		[onTransientChange],
	);
	const focusPad = useFocusPad(
		manual?.x ?? 0.5,
		manual?.y ?? 0.5,
		updateManualFocus,
		updateManualFocusPreview,
		updateManualFocusTransient,
	);

	return (
		<section>
			<div className="mb-3">
				<h2 className="text-sm font-semibold text-gray-12">Focus</h2>
				<p className="mt-0.5 text-[11px] text-gray-10">
					Choose what remains at the center of the zoom.
				</p>
			</div>
			<div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-3 p-1">
				<button
					type="button"
					aria-pressed={followCursor}
					onClick={() => onChange("auto")}
					className={cn(
						"flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold outline-none transition-[background-color,color,scale] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
						followCursor
							? "bg-gray-1 text-gray-12"
							: "text-gray-10 hover:bg-gray-4 hover:text-gray-12",
					)}
				>
					<IconLucideMousePointer2 className="size-3.5" />
					Track cursor
				</button>
				<button
					type="button"
					aria-pressed={!followCursor}
					onClick={() => onChange({ manual: manual ?? { x: 0.5, y: 0.5 } })}
					className={cn(
						"flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold outline-none transition-[background-color,color,scale] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
						!followCursor
							? "bg-gray-1 text-gray-12"
							: "text-gray-10 hover:bg-gray-4 hover:text-gray-12",
					)}
				>
					<IconLucideCrosshair className="size-3.5" />
					Fixed point
				</button>
			</div>

			{manual ? (
				<div className="mt-3">
					<div
						ref={focusPad.ref}
						onPointerDown={focusPad.onPointerDown}
						onPointerMove={focusPad.onPointerMove}
						onPointerUp={focusPad.onPointerUp}
						onPointerCancel={focusPad.onPointerCancel}
						className="relative aspect-video cursor-crosshair touch-none select-none overflow-hidden rounded-xl bg-gray-3"
					>
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-x-[8%] top-1/2 h-px bg-gray-5"
						/>
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-y-[8%] left-1/2 w-px bg-gray-5"
						/>
						{FOCUS_POINTS.map((point) => {
							const active =
								Math.abs(focusPad.visualPoint.x - point.x) < 0.01 &&
								Math.abs(focusPad.visualPoint.y - point.y) < 0.01;

							return (
								<button
									key={point.label}
									type="button"
									aria-label={`Focus ${point.label.toLowerCase()}`}
									aria-pressed={active}
									onPointerDown={(event) => event.stopPropagation()}
									onClick={() => updateManualFocus(point.x, point.y)}
									className="group absolute z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring/60"
									style={{
										left: `${focusToPadPercent(point.x)}%`,
										top: `${focusToPadPercent(point.y)}%`,
									}}
								>
									<span
										aria-hidden="true"
										className={cn(
											"mx-auto block size-1.5 rounded-full transition-[background-color,scale] duration-100 group-hover:scale-150 motion-reduce:transform-none motion-reduce:transition-none",
											active ? "bg-transparent" : "bg-gray-8",
										)}
									/>
								</button>
							);
						})}
						<div
							aria-hidden="true"
							className="pointer-events-none absolute z-20 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-5 flex justify-center items-center"
							style={{
								left: `${focusToPadPercent(focusPad.visualPoint.x)}%`,
								top: `${focusToPadPercent(focusPad.visualPoint.y)}%`,
							}}
						>
							<span
								aria-hidden="true"
								className="pointer-events-none size-5  rounded-full bg-accent-solid dark-button-shadow"
							/>
						</div>
					</div>
					<div className="mt-2 grid grid-cols-2 gap-2">
						<Slider
							size="xs"
							label="X"
							ariaLabel="Focus horizontal position"
							format={(v) => `${Math.round(v * 100)}%`}
							min={0}
							max={1}
							step={0.01}
							value={manual.x}
							onChange={(x) => onChange({ manual: { ...manual, x } })}
						/>
						<Slider
							size="xs"
							label="Y"
							ariaLabel="Focus vertical position"
							format={(v) => `${Math.round(v * 100)}%`}
							min={0}
							max={1}
							step={0.01}
							value={manual.y}
							onChange={(y) => onChange({ manual: { ...manual, y } })}
						/>
					</div>
				</div>
			) : (
				<div className="mt-3 flex items-center gap-2 rounded-lg bg-gray-2 px-3 py-2.5 text-[11px] text-gray-10">
					<IconLucideMousePointer2 className="size-3.5 shrink-0 text-gray-9" />
					The zoom follows cursor movement automatically.
				</div>
			)}
		</section>
	);
}

export function SegmentConfig() {
	const {
		instance,
		project,
		setProject,
		setProjectTransient,
		previewProject,
		selection,
		setSelection,
	} = useEditorContext();
	if (!project || !selection) return null;

	const timeline = project.timeline;

	const patchAtWith = <K extends keyof NonNullable<typeof timeline>>(
		apply: typeof setProject,
		key: K,
		index: number,
		patch: object,
	) =>
		apply((current) => {
			if (!current.timeline) return current;
			const list = (current.timeline[key] ?? []) as unknown[];
			return {
				...current,
				timeline: {
					...current.timeline,
					[key]: list.map((segment, i) =>
						i === index ? { ...(segment as object), ...patch } : segment,
					),
				},
			};
		});
	const patchAt = <K extends keyof NonNullable<typeof timeline>>(
		key: K,
		index: number,
		patch: object,
	) => patchAtWith(setProject, key, index, patch);
	const patchAtTransient = <K extends keyof NonNullable<typeof timeline>>(
		key: K,
		index: number,
		patch: object,
	) => patchAtWith(setProjectTransient, key, index, patch);
	const previewAt = <K extends keyof NonNullable<typeof timeline>>(
		key: K,
		index: number,
		patch: object,
	) => patchAtWith(previewProject, key, index, patch);

	switch (selection.type) {
		case "caption": {
			const captionSegments = timeline?.captionSegments ?? [];
			const selectedSourceId = selection.id
				? sourceCaptionId(selection.id)
				: null;
			const segmentIndex = selection.id
				? captionSegments.findIndex((segment) => segment.id === selection.id)
				: selection.index;
			const fallbackIndex =
				selectedSourceId && segmentIndex < 0
					? captionSegments.findIndex(
							(segment) => sourceCaptionId(segment.id) === selectedSourceId,
						)
					: segmentIndex;
			const segment = captionSegments[fallbackIndex];
			const sourceId = segment ? sourceCaptionId(segment.id) : selectedSourceId;
			const captions = project.captions;
			const source = captions?.segments.find(
				(caption) => caption.id === sourceId,
			);
			if (!segment || !source || !sourceId || !captions || !instance)
				return null;

			const updateSource = (
				update: (caption: CaptionSegment) => CaptionSegment,
			) =>
				setProject((current) => {
					if (!current.captions) return current;
					const sourceIndex = current.captions.segments.findIndex(
						(caption) => caption.id === sourceId,
					);
					const sourceCaption = current.captions.segments[sourceIndex];
					if (!sourceCaption) return current;
					const updatedCaption = update(sourceCaption);
					const segments = current.captions.segments.map((caption, index) =>
						index === sourceIndex ? updatedCaption : caption,
					);
					const nextTimeline =
						!current.captions.sourceTimed && current.timeline
							? {
									...current.timeline,
									captionSegments: (current.timeline.captionSegments ?? []).map(
										(caption) =>
											sourceCaptionId(caption.id) === sourceId
												? {
														...caption,
														start: updatedCaption.start,
														end: updatedCaption.end,
														text: updatedCaption.text,
														words: updatedCaption.words,
													}
												: caption,
									),
								}
							: current.timeline;
					return {
						...current,
						captions: {
							...current.captions,
							segments,
						},
						timeline: nextTimeline,
					};
				});

			const updateTiming = (edge: "start" | "end", editedTime: number) => {
				if (!Number.isFinite(editedTime) || !timeline) return;
				const clampedEditedTime =
					edge === "start"
						? Math.max(0, Math.min(editedTime, segment.end - 0.001))
						: Math.max(segment.start + 0.001, editedTime);
				const sourceTime = captions.sourceTimed
					? mapEditedTimeToSource(
							clampedEditedTime,
							timeline.segments,
							instance.recordings.segments,
							timeline.transitions ?? [],
							{ start: source.start, end: source.end },
							edge === "start" ? "incoming" : "outgoing",
						)
					: clampedEditedTime;
				if (sourceTime === null) return;
				updateSource((caption) =>
					retimeCaptionSegment(
						caption,
						edge === "start" ? sourceTime : caption.start,
						edge === "end" ? sourceTime : caption.end,
					),
				);
			};

			const updateOverrides = (patch: Partial<CaptionTrackSegment>) =>
				setProject((current) => {
					if (!current.timeline) return current;
					return {
						...current,
						timeline: {
							...current.timeline,
							captionSegments: (current.timeline.captionSegments ?? []).map(
								(caption) =>
									sourceCaptionId(caption.id) === sourceId
										? { ...caption, ...patch }
										: caption,
							),
						},
					};
				});

			return (
				<Panel title={`Caption ${fallbackIndex + 1}`}>
					<Field name="Text">
						<textarea
							aria-label="Caption text"
							className="min-h-24 w-full resize-y rounded-lg border border-gray-4 bg-gray-2 px-3 py-2 text-sm text-gray-12 outline-none transition-colors focus:border-accent-border-selected"
							value={segment.text}
							onChange={(event) => {
								const text = event.target.value;
								updateSource((caption) => ({
									...caption,
									text,
									words: syncCaptionWordsWithText(
										text,
										caption.words ?? [],
										caption.start,
										caption.end,
									),
								}));
							}}
						/>
					</Field>

					<Field name="Timing">
						<div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 rounded-xl border border-gray-3 bg-gray-2/70 p-3">
							<label className="text-[11px] text-gray-10">
								Start
								<input
									type="number"
									aria-label="Caption start time"
									min={0}
									max={segment.end - 0.001}
									step={0.05}
									value={segment.start.toFixed(2)}
									onChange={(event) =>
										updateTiming("start", Number(event.target.value))
									}
									className="mt-1.5 w-full rounded-lg border border-gray-4 bg-gray-1 px-2 py-1.5 text-xs tabular-nums text-gray-12 outline-none focus:border-accent-border-selected"
								/>
							</label>
							<span className="pb-2 text-xs text-gray-9">to</span>
							<label className="text-[11px] text-gray-10">
								End
								<input
									type="number"
									aria-label="Caption end time"
									min={segment.start + 0.001}
									step={0.05}
									value={segment.end.toFixed(2)}
									onChange={(event) =>
										updateTiming("end", Number(event.target.value))
									}
									className="mt-1.5 w-full rounded-lg border border-gray-4 bg-gray-1 px-2 py-1.5 text-xs tabular-nums text-gray-12 outline-none focus:border-accent-border-selected"
								/>
							</label>
							<div className="col-span-3 flex items-center justify-between border-t border-gray-3 pt-2 text-xs text-gray-10">
								<span>Duration</span>
								<span className="font-medium tabular-nums text-gray-12">
									{Math.max(0, segment.end - segment.start).toFixed(2)}s
								</span>
							</div>
						</div>
					</Field>

					<Field name="Appearance">
						<Slider
							size="sm"
							label="Size"
							min={12}
							max={96}
							value={segment.fontSizeOverride ?? captions.settings.size}
							format={(value) => `${Math.round(value)}px`}
							onChange={(fontSizeOverride) =>
								updateOverrides({ fontSizeOverride })
							}
						/>
						<Subfield name="Position">
							<Select
								value={segment.positionOverride ?? "inherit"}
								onValueChange={(positionOverride) =>
									updateOverrides({
										positionOverride:
											positionOverride === "inherit" ? null : positionOverride,
									})
								}
								options={[
									{ label: "Use global", value: "inherit" },
									{ label: "Top left", value: "top-left" },
									{ label: "Top centre", value: "top-center" },
									{ label: "Top right", value: "top-right" },
									{ label: "Bottom left", value: "bottom-left" },
									{ label: "Bottom centre", value: "bottom-center" },
									{ label: "Bottom right", value: "bottom-right" },
								]}
							/>
						</Subfield>
						<div className="grid grid-cols-2 gap-2">
							<div className="text-[11px] text-gray-10">
								Text colour
								<ColorPickerPopover
									value={colorToRgb(
										segment.colorOverride ?? captions.settings.color,
									)}
									showAlpha={false}
									label="Choose text colour"
									onChange={({ value }) =>
										updateOverrides({ colorOverride: rgbToHex(value) })
									}
									className="mt-1.5 w-full"
								/>
							</div>
							<div className="text-[11px] text-gray-10">
								Background
								<ColorPickerPopover
									value={colorToRgb(
										segment.backgroundColorOverride ??
											captions.settings.backgroundColor,
									)}
									showAlpha={false}
									label="Choose background colour"
									onChange={({ value }) =>
										updateOverrides({
											backgroundColorOverride: rgbToHex(value),
										})
									}
									className="mt-1.5 w-full"
								/>
							</div>
						</div>
						<Slider
							size="sm"
							label="Fade"
							min={0}
							max={1}
							step={0.05}
							value={
								segment.fadeDurationOverride ?? captions.settings.fadeDuration
							}
							format={(value) => `${value.toFixed(2)}s`}
							onChange={(fadeDurationOverride) =>
								updateOverrides({ fadeDurationOverride })
							}
						/>
						<Slider
							size="sm"
							label="Linger"
							min={0}
							max={2}
							step={0.05}
							value={
								segment.lingerDurationOverride ??
								captions.settings.lingerDuration
							}
							format={(value) => `${value.toFixed(2)}s`}
							onChange={(lingerDurationOverride) =>
								updateOverrides({ lingerDurationOverride })
							}
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="w-full"
							onClick={() =>
								updateOverrides({
									backgroundColorOverride: null,
									colorOverride: null,
									fadeDurationOverride: null,
									fontSizeOverride: null,
									lingerDurationOverride: null,
									positionOverride: null,
								})
							}
						>
							<IconLucideRotateCcw className="size-3.5" />
							Reset overrides
						</Button>
					</Field>

					<ConfirmAction
						triggerVariant="ghost"
						triggerClassName="w-full text-red-11 hover:text-red-11"
						title="Delete this caption?"
						description="This removes the caption and its timing from the project."
						confirmLabel="Delete caption"
						onConfirm={() => {
							setProject((current) =>
								current.captions
									? {
											...current,
											captions: {
												...current.captions,
												segments: current.captions.segments.filter(
													(caption) => caption.id !== sourceId,
												),
											},
										}
									: current,
							);
							setSelection(null);
						}}
					>
						<IconLucideTrash2 className="size-3.5" />
						Delete caption
					</ConfirmAction>
				</Panel>
			);
		}

		case "zoom": {
			const segment = timeline?.zoomSegments?.[selection.index];
			if (!segment) return null;

			return (
				<ZoomSegmentSettings
					segment={segment}
					onChange={(patch) => patchAt("zoomSegments", selection.index, patch)}
					onPreviewChange={(patch) =>
						previewAt("zoomSegments", selection.index, patch)
					}
					onTransientChange={(patch) =>
						patchAtTransient("zoomSegments", selection.index, patch)
					}
					onDone={() => setSelection(null)}
				/>
			);
		}

		case "scene": {
			const segment = timeline?.sceneSegments?.[selection.index];
			if (!segment) return null;

			return (
				<Panel title="Scene segment">
					<Field name="Mode">
						<Select
							value={segment.mode ?? "default"}
							onValueChange={(mode) =>
								patchAt("sceneSegments", selection.index, { mode })
							}
							options={SCENE_MODES.map(({ label, value }) => ({
								label,
								value: String(value),
							}))}
						/>
					</Field>

					<Slider
						size="sm"
						label="Fade in"
						format={(v) => `${(v).toFixed(2)}s`}
						min={0}
						max={2}
						step={0.05}
						value={segment.transitionIn ?? 0.3}
						onChange={(transitionIn) =>
							patchAt("sceneSegments", selection.index, { transitionIn })
						}
					/>

					<Slider
						size="sm"
						label="Fade out"
						format={(v) => `${(v).toFixed(2)}s`}
						min={0}
						max={2}
						step={0.05}
						value={segment.transitionOut ?? 0.3}
						onChange={(transitionOut) =>
							patchAt("sceneSegments", selection.index, { transitionOut })
						}
					/>
				</Panel>
			);
		}

		case "mask": {
			const segment = timeline?.maskSegments?.[selection.index];
			if (!segment) return null;

			return (
				<MaskSegmentSettings
					segment={segment}
					onChange={(patch) => patchAt("maskSegments", selection.index, patch)}
					onDone={() => setSelection(null)}
				/>
			);
		}

		case "text": {
			const segment = timeline?.textSegments?.[selection.index];
			if (!segment) return null;
			const style = textContentStyle(segment.textContent);
			const paragraph = textContentParagraph(segment.textContent);

			// Segments have carried a single run since 002 — no rich
			// `contentEditable`, no DOM `Selection` to prefer, so every
			// run-level control here always patches the whole run.
			const updateStyle = (patch: Parameters<typeof withTextContentStyle>[1]) =>
				patchAt("textSegments", selection.index, {
					textContent: withTextContentStyle(segment.textContent, patch),
				});
			const updateParagraph = (
				patch: Parameters<typeof withTextContentParagraph>[1],
			) =>
				patchAt("textSegments", selection.index, {
					textContent: withTextContentParagraph(segment.textContent, patch),
				});
			const updateObject = (
				patch: Partial<NonNullable<typeof segment.textContent>>,
			) =>
				patchAt("textSegments", selection.index, {
					textContent: segment.textContent
						? { ...segment.textContent, ...patch }
						: null,
				});

			return (
				<Panel title="Text segment">
					<Field name="Content">
						<textarea
							value={textContentString(segment.textContent)}
							onChange={(event) =>
								patchAt("textSegments", selection.index, {
									textContent: withTextContentString(
										segment.textContent,
										event.target.value,
									),
								})
							}
							className="min-h-16 w-full rounded-lg border border-gray-4 bg-gray-2 p-2 text-xs text-gray-12"
						/>
					</Field>

					<Field name="Family">
						<FontPicker
							value={style.fontFamily}
							onChange={(fontFamily) => updateStyle({ fontFamily })}
						/>
					</Field>

					<Slider
						size="sm"
						label="Font size"
						format={(v) => `${Math.round(v)}px`}
						min={8}
						max={200}
						value={style.fontSize}
						onChange={(fontSize) => updateStyle({ fontSize })}
					/>

					<Slider
						size="sm"
						label="Letter spacing"
						format={(v) => `${v.toFixed(1)}px`}
						min={-5}
						max={20}
						step={0.5}
						value={style.letterSpacing}
						onChange={(letterSpacing) => updateStyle({ letterSpacing })}
					/>

					<Field name="Style">
						<Subfield name="Bold">
							<Switch
								checked={style.fontWeight >= 700}
								onCheckedChange={(bold) =>
									updateStyle({ fontWeight: bold ? 700 : 400 })
								}
							/>
						</Subfield>
						<Subfield name="Italic">
							<Switch
								checked={style.italic}
								onCheckedChange={(italic) => updateStyle({ italic })}
							/>
						</Subfield>
						<Subfield name="Underline">
							<Switch
								checked={style.decoration === "underline"}
								onCheckedChange={(on) =>
									updateStyle({ decoration: on ? "underline" : "none" })
								}
							/>
						</Subfield>
						<Subfield name="Colour">
							<ColorPickerPopover
								value={colorToRgb(style.color)}
								showAlpha={false}
								label="Choose text colour"
								onChange={({ value }) =>
									updateStyle({ color: rgbToHex(value) })
								}
								className="w-full"
							/>
						</Subfield>
					</Field>

					<Field name="Case">
						<Select
							value={style.transform}
							onValueChange={(transform) =>
								transform &&
								updateStyle({ transform: transform as TextTransform })
							}
							options={TRANSFORM_OPTIONS.map(({ label, value }) => ({
								label,
								value: String(value),
							}))}
						/>
					</Field>

					<Field name="Align">
						<Select
							value={paragraph.align}
							onValueChange={(align) =>
								align && updateParagraph({ align: align as TextAlign })
							}
							options={ALIGN_OPTIONS.map(({ label, value }) => ({
								label,
								value: String(value),
							}))}
						/>
					</Field>

					<Slider
						size="sm"
						label="Line height"
						format={(v) => `${v.toFixed(2)}×`}
						min={0.8}
						max={2.5}
						step={0.05}
						value={paragraph.lineHeight}
						onChange={(lineHeight) => updateParagraph({ lineHeight })}
					/>

					<Field name="Vertical align">
						<Select
							value={segment.textContent?.verticalAlign ?? "top"}
							onValueChange={(verticalAlign) =>
								verticalAlign &&
								updateObject({ verticalAlign: verticalAlign as VerticalAlign })
							}
							options={VERTICAL_ALIGN_OPTIONS.map(({ label, value }) => ({
								label,
								value: String(value),
							}))}
						/>
					</Field>

					<Field name="Grow">
						<Select
							value={segment.textContent?.growType ?? "autoHeight"}
							onValueChange={(growType) =>
								growType && updateObject({ growType: growType as GrowType })
							}
							options={GROW_TYPE_OPTIONS.map(({ label, value }) => ({
								label,
								value: String(value),
							}))}
						/>
					</Field>
				</Panel>
			);
		}

		case "audio": {
			const segment = timeline?.audioSegments?.[selection.index];
			if (!segment) return null;
			const segmentLength = Math.max(0, segment.end - segment.start);

			return (
				<Panel title="Audio segment">
					<Field name="Name">
						<span className="truncate text-xs text-gray-11">
							{segment.name || segment.path}
						</span>
					</Field>
					<Field name="Enabled">
						<Switch
							checked={segment.enabled ?? true}
							onCheckedChange={(enabled) =>
								patchAt("audioSegments", selection.index, { enabled })
							}
						/>
					</Field>
					<Slider
						size="sm"
						label="Volume"
						format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`}
						min={-60}
						max={12}
						step={0.5}
						value={segment.volumeDb ?? 0}
						onChange={(volumeDb) =>
							patchAt("audioSegments", selection.index, { volumeDb })
						}
					/>
					<Slider
						size="sm"
						label="Fade in"
						format={(value) => `${value.toFixed(2)}s`}
						min={0}
						max={Math.min(5, segmentLength)}
						step={0.05}
						value={segment.fadeIn ?? 0}
						onChange={(fadeIn) =>
							patchAt("audioSegments", selection.index, { fadeIn })
						}
					/>
					<Slider
						size="sm"
						label="Fade out"
						format={(value) => `${value.toFixed(2)}s`}
						min={0}
						max={Math.min(5, segmentLength)}
						step={0.05}
						value={segment.fadeOut ?? 0}
						onChange={(fadeOut) =>
							patchAt("audioSegments", selection.index, { fadeOut })
						}
					/>
				</Panel>
			);
		}

		case "keyboard": {
			const segment = timeline?.keyboardSegments?.[selection.index];
			if (!segment) return null;

			return (
				<Panel title="Keystroke segment">
					<Field name="Keys">
						<span className="truncate text-xs font-medium text-gray-12">
							{segment.displayText}
						</span>
					</Field>
					<Field name="Position">
						<Select
							value={segment.positionOverride ?? "global"}
							onValueChange={(positionOverride) =>
								patchAt("keyboardSegments", selection.index, {
									positionOverride:
										positionOverride === "global" ? null : positionOverride,
								})
							}
							options={[
								{ label: "Use global", value: "global" },
								{ label: "Top left", value: "top-left" },
								{ label: "Top centre", value: "top-center" },
								{ label: "Top right", value: "top-right" },
								{ label: "Bottom left", value: "bottom-left" },
								{ label: "Bottom centre", value: "bottom-center" },
								{ label: "Bottom right", value: "bottom-right" },
							]}
						/>
					</Field>
					<Slider
						size="sm"
						label="Size"
						format={(value) => `${Math.round(value)}px`}
						min={16}
						max={120}
						step={1}
						value={
							segment.fontSizeOverride ?? project.keyboard?.settings.size ?? 50
						}
						onChange={(fontSizeOverride) =>
							patchAt("keyboardSegments", selection.index, {
								fontSizeOverride,
							})
						}
					/>
					<Field name="Uppercase">
						<Select
							value={
								segment.uppercaseOverride == null
									? "global"
									: segment.uppercaseOverride
										? "on"
										: "off"
							}
							onValueChange={(value) =>
								patchAt("keyboardSegments", selection.index, {
									uppercaseOverride: value === "global" ? null : value === "on",
								})
							}
							options={[
								{ label: "Use global", value: "global" },
								{ label: "On", value: "on" },
								{ label: "Off", value: "off" },
							]}
						/>
					</Field>
					<Slider
						size="sm"
						label="Fade"
						format={(value) => `${value.toFixed(2)}s`}
						min={0}
						max={1}
						step={0.05}
						value={
							segment.fadeDurationOverride ??
							project.keyboard?.settings.fadeDuration ??
							0.15
						}
						onChange={(fadeDurationOverride) =>
							patchAt("keyboardSegments", selection.index, {
								fadeDurationOverride,
							})
						}
					/>
				</Panel>
			);
		}

		case "clip": {
			const segment = timeline?.segments?.[selection.index];
			if (!segment) return null;

			return (
				<Panel title="Clip">
					<Slider
						size="sm"
						label="Speed"
						format={(v) => `${v.toFixed(2)}x`}
						min={0.25}
						max={4}
						step={0.05}
						value={segment.timescale}
						onChange={(timescale) =>
							setProject((current) =>
								current.timeline
									? {
											...current,
											timeline: {
												...current.timeline,
												segments: current.timeline.segments.map(
													(clip, index) =>
														index === selection.index
															? { ...clip, timescale }
															: clip,
												),
											},
										}
									: current,
							)
						}
					/>

					<Field name="Audio while sped up" isRow>
						<Select
							value={segment.speedAudioMode ?? "maintainPitch"}
							onValueChange={(speedAudioMode) =>
								setProject((current) =>
									current.timeline
										? {
												...current,
												timeline: {
													...current.timeline,
													segments: current.timeline.segments.map(
														(clip, index) =>
															index === selection.index
																? {
																		...clip,
																		speedAudioMode:
																			speedAudioMode as typeof clip.speedAudioMode,
																	}
																: clip,
													),
												},
											}
										: current,
								)
							}
							options={[
								{ label: "Keep pitch", value: "maintainPitch" },
								{ label: "Match speed", value: "matchSpeed" },
								{ label: "Mute", value: "mute" },
							]}
						/>
					</Field>
				</Panel>
			);
		}

		default:
			return null;
	}
}

function Panel({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	const { setSelection } = useEditorContext();

	return (
		<SegmentPanel title={title} onDone={() => setSelection(null)}>
			{children}
		</SegmentPanel>
	);
}

function SegmentPanel({
	title,
	children,
	onDone,
}: {
	title: string;
	children: React.ReactNode;
	onDone: () => void;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<button
				type="button"
				onClick={onDone}
				className="flex h-16 w-full flex-none items-center gap-2 border-b border-gray-3 px-4 text-sm font-semibold text-gray-12 transition-colors hover:bg-gray-3"
			>
				{title}
				<span className="ml-auto text-xs text-gray-10">Done</span>
			</button>
			<div className="custom-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
				{children}
			</div>
		</div>
	);
}

/** Camera position options shared with the camera tab. */
export const CAMERA_X: Array<{ label: string; value: CameraXPosition }> = [
	{ label: "Left", value: "left" },
	{ label: "Center", value: "center" },
	{ label: "Right", value: "right" },
];

export const CAMERA_Y: Array<{ label: string; value: CameraYPosition }> = [
	{ label: "Top", value: "top" },
	{ label: "Bottom", value: "bottom" },
];
