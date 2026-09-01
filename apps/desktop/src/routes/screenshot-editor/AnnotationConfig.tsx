import { cn, Select, Switch } from "@quiro/ui";
import { useRef } from "react";
import type { Annotation } from "@/utils/tauri";
import { useScreenshotEditorContext } from "./context";
import { Field, hexToRgb, RgbInput, rgbToHex, Slider } from "./ui";

const CURVE_OPTIONS = [
	{ value: "straight", label: "Straight" },
	{ value: "quadratic", label: "Curved" },
	{ value: "cubic", label: "S-curve" },
	{ value: "elbow", label: "Elbow" },
];

const LINE_OPTIONS = [
	{ value: "solid", label: "Solid" },
	{ value: "dashed", label: "Dashed" },
	{ value: "dotted", label: "Dotted" },
];

const HEAD_OPTIONS = [
	{ value: "none", label: "None" },
	{ value: "arrow", label: "Arrow" },
	{ value: "triangle", label: "Triangle" },
	{ value: "circle", label: "Circle" },
	{ value: "square", label: "Square" },
];

// React port of Cap's `AnnotationConfig.tsx` — the inspector that appears
// beside the canvas when an annotation is selected. Which controls are shown
// depends on the annotation type: a mask has no stroke, an arrow has no fill,
// text sizes by font size rather than stroke width.

/** The annotation colours are plain CSS colour strings, while RgbInput works
 * in RGB triples — "transparent" has no triple, so it falls back to black
 * rather than crashing the picker. */
function toRgb(color: string): [number, number, number] {
	return hexToRgb(color) ?? [0, 0, 0];
}

export function AnnotationConfig() {
	const { annotations, selectedAnnotationId, updateAnnotation, history } =
		useScreenshotEditorContext();

	const annotation = annotations.find((a) => a.id === selectedAnnotationId);
	if (!annotation) return null;

	const update = <K extends keyof Annotation>(key: K, value: Annotation[K]) =>
		updateAnnotation(annotation.id, { [key]: value } as Partial<Annotation>);

	// One undo entry per slider drag rather than one per pixel.
	const dragScope = () => {
		const resume = history.pause();
		return () => resume();
	};

	const isMask = annotation.type === "mask";
	const isText = annotation.type === "text";
	const isArrow = annotation.type === "arrow";
	const isFocus = annotation.type === "focus";
	const hasFill =
		annotation.type === "rectangle" || annotation.type === "circle";
	const canRotate = hasFill || isText;

	// Focus has its own inspector: none of the shared stroke/fill controls
	// apply, and its six dials all live on a nested config object.
	if (isFocus && annotation.focus) {
		const focus = annotation.focus;
		const setFocus = (patch: Partial<typeof focus>) =>
			update("focus", { ...focus, ...patch });

		// Photography, not shader terminology: Blur is the maximum circle of
		// confusion, Depth shapes the falloff and narrows the plane of focus, and
		// Lens is how strongly highlights bloom into bokeh.
		return (
			<div className="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-3 bg-gray-1 p-3">
				<span className="text-xs font-medium text-gray-12">Focus</span>
				<p className="text-pretty text-xs text-gray-10">
					Press F and click the screenshot to aim, or drag the region.
				</p>

				<Field name="Region">
					<div className="flex items-center gap-1 rounded-lg bg-gray-3 p-1">
						{(
							[
								{ value: "ellipse", label: "Ellipse" },
								{ value: "rectangle", label: "Rectangle" },
							] as const
						).map((option) => (
							<button
								key={option.value}
								type="button"
								aria-pressed={focus.shape === option.value}
								onClick={() => setFocus({ shape: option.value })}
								className={cn(
									"h-7 flex-1 rounded-md text-xs transition-colors",
									focus.shape === option.value
										? "bg-gray-1 text-gray-12 shadow-sm"
										: "text-gray-10 hover:text-gray-12",
								)}
							>
								{option.label}
							</button>
						))}
					</div>
				</Field>

				<SliderWithHistory
					label="Blur"
					value={focus.blur}
					min={0}
					max={100}
					format={(v) => `${Math.round(v)}%`}
					onChange={(blur) => setFocus({ blur })}
					dragScope={dragScope}
				/>
				<SliderWithHistory
					label="Depth"
					value={focus.depth}
					min={0}
					max={100}
					format={(v) => `${Math.round(v)}%`}
					onChange={(depth) => setFocus({ depth })}
					dragScope={dragScope}
				/>
				<SliderWithHistory
					label="Lens"
					value={focus.lens}
					min={0}
					max={100}
					format={(v) => `${Math.round(v)}%`}
					onChange={(lens) => setFocus({ lens })}
					dragScope={dragScope}
				/>

				<div className="flex flex-col gap-4 border-t border-gray-4 pt-4">
					<span className="text-xs font-medium text-gray-11">Advanced</span>
					<SliderWithHistory
						label="Far blur"
						value={focus.farBlur}
						min={0}
						max={2}
						step={0.05}
						format={(v) => `${v.toFixed(2)}×`}
						onChange={(farBlur) => setFocus({ farBlur })}
						dragScope={dragScope}
					/>
					<SliderWithHistory
						label="Near blur"
						value={focus.nearBlur}
						min={0}
						max={2}
						step={0.05}
						format={(v) => `${v.toFixed(2)}×`}
						onChange={(nearBlur) => setFocus({ nearBlur })}
						dragScope={dragScope}
					/>
					<SliderWithHistory
						label="Rotation"
						value={focus.rotation}
						min={-90}
						max={90}
						format={(v) => `${Math.round(v)}°`}
						onChange={(rotation) => setFocus({ rotation })}
						dragScope={dragScope}
					/>
					<SliderWithHistory
						label="Strength"
						value={annotation.opacity}
						min={0}
						max={1}
						step={0.01}
						format={(v) => `${Math.round(v * 100)}%`}
						onChange={(v) => update("opacity", v)}
						dragScope={dragScope}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-3 bg-gray-1 p-3">
			<span className="text-xs font-medium text-gray-12">
				{isMask ? "Mask" : isText ? "Text" : "Shape"}
			</span>

			{!isMask && (
				<Field name="Color">
					<RgbInput
						value={toRgb(annotation.strokeColor)}
						onChange={(rgb) => update("strokeColor", rgbToHex(rgb))}
					/>
				</Field>
			)}

			{!isMask && !isText && (
				<SliderWithHistory
					label="Stroke"
					value={annotation.strokeWidth}
					format={(v) => `${Math.round(v)}px`}
					min={1}
					max={40}
					onChange={(v) => update("strokeWidth", v)}
					dragScope={dragScope}
				/>
			)}

			{canRotate && (
				<SliderWithHistory
					label="Rotation"
					value={annotation.rotation}
					format={(v) => `${Math.round(v)}°`}
					min={-180}
					max={180}
					onChange={(v) => update("rotation", v)}
					dragScope={dragScope}
				/>
			)}

			{isArrow && (
				<>
					<Field name="Curve">
						<Select
							variant="light"
							className="h-8 w-full text-xs"
							options={CURVE_OPTIONS}
							value={annotation.arrowCurve ?? "straight"}
							onValueChange={(v) =>
								update("arrowCurve", v as Annotation["arrowCurve"])
							}
						/>
					</Field>
					<Field name="Line">
						<Select
							variant="light"
							className="h-8 w-full text-xs"
							options={LINE_OPTIONS}
							value={annotation.lineStyle ?? "solid"}
							onValueChange={(v) =>
								update("lineStyle", v as Annotation["lineStyle"])
							}
						/>
					</Field>
					<Field name="Start head">
						<Select
							variant="light"
							className="h-8 w-full text-xs"
							options={HEAD_OPTIONS}
							value={annotation.arrowStartHead ?? "none"}
							onValueChange={(v) =>
								update("arrowStartHead", v as Annotation["arrowStartHead"])
							}
						/>
					</Field>
					<Field name="End head">
						<Select
							variant="light"
							className="h-8 w-full text-xs"
							options={HEAD_OPTIONS}
							value={annotation.arrowEndHead ?? "triangle"}
							onValueChange={(v) =>
								update("arrowEndHead", v as Annotation["arrowEndHead"])
							}
						/>
					</Field>
					<SliderWithHistory
						label="Head size"
						value={annotation.arrowHeadSize ?? 1}
						min={0.5}
						max={3}
						step={0.1}
						format={(v) => `${v.toFixed(1)}×`}
						onChange={(v) => update("arrowHeadSize", v)}
						dragScope={dragScope}
					/>
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium text-gray-11">Taper</span>
						<Switch
							checked={annotation.arrowTaper ?? false}
							onCheckedChange={(v) => update("arrowTaper", v)}
						/>
					</div>
				</>
			)}

			{isText && (
				<SliderWithHistory
					label="Size"
					value={annotation.height}
					format={(v) => `${Math.round(v)}px`}
					min={8}
					max={200}
					onChange={(v) => update("height", v)}
					dragScope={dragScope}
				/>
			)}

			{hasFill && (
				<Field name="Fill">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => update("fillColor", "transparent")}
							className={cn(
								"h-8 flex-1 rounded-lg border text-xs transition-colors",
								annotation.fillColor === "transparent"
									? "border-accent-400 bg-accent-300/20 text-gray-12"
									: "border-gray-5 text-gray-11 hover:bg-gray-3",
							)}
						>
							None
						</button>
						<RgbInput
							value={toRgb(annotation.fillColor)}
							onChange={(rgb) => update("fillColor", rgbToHex(rgb))}
						/>
					</div>
				</Field>
			)}

			{isMask && (
				<>
					<Field name="Style">
						<div className="flex items-center gap-1 rounded-lg bg-gray-3 p-1">
							{(["blur", "pixelate"] as const).map((style) => (
								<button
									key={style}
									type="button"
									onClick={() => update("maskType", style)}
									className={cn(
										"h-7 flex-1 rounded-md text-xs capitalize transition-colors",
										(annotation.maskType ?? "blur") === style
											? "bg-gray-1 text-gray-12 shadow-sm"
											: "text-gray-10 hover:text-gray-12",
									)}
								>
									{style}
								</button>
							))}
						</div>
					</Field>
					<SliderWithHistory
						label="Strength"
						value={annotation.maskLevel ?? 16}
						min={1}
						max={50}
						onChange={(v) => update("maskLevel", v)}
						dragScope={dragScope}
					/>
				</>
			)}

			<SliderWithHistory
				label="Opacity"
				value={annotation.opacity}
				format={(v) => `${Math.round(v * 100)}%`}
				min={0}
				max={1}
				step={0.01}
				onChange={(v) => update("opacity", v)}
				dragScope={dragScope}
			/>
		</div>
	);
}

/** Wraps Slider so a whole drag collapses into one undo entry, using the
 * context's pause/resume rather than snapshotting per change. */
function SliderWithHistory({
	label,
	value,
	min,
	max,
	step = 1,
	format,
	onChange,
	dragScope,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	format?: (value: number) => string;
	onChange: (value: number) => void;
	dragScope: () => () => void;
}) {
	// Has to be a ref, not a local: the first change re-renders this component,
	// which would reset a plain variable to null and lose the resume handle —
	// history would then be paused on every drag and never resumed.
	const resume = useRef<(() => void) | null>(null);

	return (
		<Slider
			label={label}
			value={value}
			min={min}
			max={max}
			step={step}
			format={format}
			onChange={(next) => {
				if (!resume.current) resume.current = dragScope();
				onChange(next);
			}}
			onDragEnd={() => {
				resume.current?.();
				resume.current = null;
			}}
		/>
	);
}
