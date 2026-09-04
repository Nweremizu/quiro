import { cn, Select, Switch } from "@quiro/ui";
import { useRef } from "react";
import { FontPicker } from "@/components/FontPicker";
import type {
	Annotation,
	GrowType,
	MaskMode,
	MaskShape,
	TextAlign,
	TextTransform,
	VerticalAlign,
} from "@/utils/tauri";
import { applyStyleToSelection } from "@/utils/text/apply-selection-style";
import { ColorPickerPopover } from "./ColorPicker";
import { useScreenshotEditorContext } from "./context";
import { anchorScale } from "./space";
import {
	textContentParagraph,
	textContentStyle,
	withTextContentParagraph,
	withTextContentStyle,
} from "./text-content";
import { Field, hexToRgb, RgbInput, rgbToHex, Slider } from "./ui";

/** The same four modes the timeline's mask inspector offers — one taxonomy,
 * so a screenshot mask and a video mask mean the same thing. */
const MASK_MODES: Array<{ label: string; value: MaskMode }> = [
	{ label: "Blur", value: "blur" },
	{ label: "Pixelate", value: "pixelate" },
	{ label: "Redact", value: "redact" },
	{ label: "Spotlight", value: "spotlight" },
];

/** Blur and pixelate transform the pixels rather than destroying them, so the
 * original is recoverable in principle. The inspector says so. */
const REVERSIBLE_MASK_MODES: ReadonlySet<MaskMode> = new Set<MaskMode>([
	"blur",
	"pixelate",
]);

/** Mask strength is in the contract's units (`mask-effects.json`), which are
 * 1080p-relative and scaled by frame height at paint time. */
const MASK_AMOUNT_MIN = 4;
const MASK_AMOUNT_MAX = 80;
const MASK_AMOUNT_DEFAULT = 16;

const MASK_SHAPES: Array<{ label: string; value: MaskShape }> = [
	{ label: "Rect", value: "rect" },
	{ label: "Ellipse", value: "ellipse" },
	{ label: "Rounded", value: "roundedRect" },
];

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

const TRANSFORM_OPTIONS: Array<{ value: TextTransform; label: string }> = [
	{ value: "none", label: "Aa" },
	{ value: "uppercase", label: "AA" },
	{ value: "lowercase", label: "aa" },
	{ value: "capitalize", label: "Aa " },
];

const ALIGN_OPTIONS: Array<{ value: TextAlign; label: string }> = [
	{ value: "left", label: "Left" },
	{ value: "center", label: "Center" },
	{ value: "right", label: "Right" },
	{ value: "justify", label: "Justify" },
];

const VERTICAL_ALIGN_OPTIONS: Array<{ value: VerticalAlign; label: string }> = [
	{ value: "top", label: "Top" },
	{ value: "center", label: "Middle" },
	{ value: "bottom", label: "Bottom" },
];

const GROW_TYPE_OPTIONS: Array<{ value: GrowType; label: string }> = [
	{ value: "autoWidth", label: "Hug" },
	{ value: "autoHeight", label: "Wrap" },
	{ value: "fixed", label: "Fixed" },
];

/** A row of mutually-exclusive buttons — the pattern already used inline for
 * mask mode/shape and arrow curve/line, pulled into one place now that the
 * text panel needs five more of them. `onMouseDown` prevents the default
 * focus shift so clicking a chip doesn't collapse whatever `Selection` is
 * live inside a `contentEditable` elsewhere on screen — run-level chips
 * (Style) need that; the rest don't care but it's harmless either way. */
function ChipGroup<T extends string>({
	options,
	value,
	onChange,
}: {
	options: Array<{ value: T; label: string }>;
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div className="flex items-center gap-1 rounded-lg bg-gray-3 p-1">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onChange(option.value)}
					className={cn(
						"h-7 flex-1 rounded-md text-xs transition-colors",
						value === option.value
							? "bg-gray-1 text-gray-12 shadow-sm"
							: "text-gray-10 hover:text-gray-12",
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

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
	const {
		annotations,
		selectedAnnotationId,
		updateAnnotation,
		history,
		anchorRect,
	} = useScreenshotEditorContext();
	const colorScope = useRef<(() => void) | null>(null);

	const annotation = annotations.find((a) => a.id === selectedAnnotationId);
	if (!annotation) return null;

	const update = <K extends keyof Annotation>(key: K, value: Annotation[K]) =>
		updateAnnotation(annotation.id, { [key]: value } as Partial<Annotation>);

	// Run-level: "applies to the DOM Selection when there is one and to the
	// whole object when there is not" (`plans/text-engine/004`). A live
	// `.text-editor` only exists while this annotation is being typed into —
	// `patch` here is in the panel's own px@1080 units, so font
	// size/letter-spacing are scaled before touching the DOM, which works in
	// real px, then scaled back by `applyStyleToSelection`'s caller-contract.
	const updateTextStyle = (
		patch: Parameters<typeof withTextContentStyle>[1],
	) => {
		const editor = document.querySelector<HTMLElement>(".text-editor");
		if (editor) {
			const scale = anchorScale(anchorRect);
			const scaledPatch = {
				...patch,
				...(patch.fontSize != null ? { fontSize: patch.fontSize * scale } : {}),
				...(patch.letterSpacing != null
					? { letterSpacing: patch.letterSpacing * scale }
					: {}),
			};
			const applied = applyStyleToSelection(
				editor,
				scaledPatch,
				textContentStyle(annotation.textContent),
			);
			if (applied) return;
		}
		updateAnnotation(annotation.id, {
			textContent: withTextContentStyle(annotation.textContent, patch),
		});
	};

	// Paragraph-level: always the whole object — there is no such thing as
	// "half a paragraph aligned differently," so this never consults the DOM
	// selection the way `updateTextStyle` does.
	const updateParagraph = (
		patch: Parameters<typeof withTextContentParagraph>[1],
	) =>
		updateAnnotation(annotation.id, {
			textContent: withTextContentParagraph(annotation.textContent, patch),
		});

	// Object-level: `growType`/`verticalAlign`/`halo` live on `TextContent`
	// itself, one per annotation — never scoped to a run or a paragraph.
	const updateTextObject = (patch: Partial<Annotation["textContent"]>) =>
		updateAnnotation(annotation.id, {
			textContent: annotation.textContent
				? { ...annotation.textContent, ...patch }
				: null,
		});

	// One undo entry per slider drag rather than one per pixel.
	const dragScope = () => {
		const resume = history.pause();
		return () => resume();
	};

	/** Which dimensions the renderer actually honours — see the Size field. */
	const growType = annotation.textContent?.growType ?? "autoWidth";

	const isMask = annotation.type === "mask";
	// Optional in the bindings because it carries a serde default; migrated
	// configs always have one.
	const maskMode: MaskMode = annotation.maskMode ?? "blur";
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
			<div className="flex h-full w-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
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
		<div className="flex h-full w-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
			<span className="text-xs font-medium text-gray-12">
				{isMask ? "Mask" : isText ? "Text" : "Shape"}
			</span>

			{!isMask && (
				<Field name="Color">
					<ColorPickerPopover
						label="Background colour"
						className="w-full"
						value={toRgb(
							isText
								? textContentStyle(annotation.textContent).color
								: annotation.strokeColor,
						)}
						onChange={({ value }) =>
							isText
								? updateTextStyle({ color: rgbToHex(value) })
								: update("strokeColor", rgbToHex(value))
						}
						onInteractStart={() => {
							colorScope.current = history.pause();
						}}
						onInteractEnd={() => {
							colorScope.current?.();
							colorScope.current = null;
						}}
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
				<>
					<Field name="Family">
						<FontPicker
							value={textContentStyle(annotation.textContent).fontFamily}
							onChange={(fontFamily) => updateTextStyle({ fontFamily })}
						/>
					</Field>

					<SliderWithHistory
						label="Size"
						value={textContentStyle(annotation.textContent).fontSize}
						format={(v) => `${Math.round(v)}px`}
						min={8}
						max={200}
						onChange={(fontSize) => updateTextStyle({ fontSize })}
						dragScope={dragScope}
					/>

					<Field name="Style">
						<div className="flex items-center gap-1 rounded-lg bg-gray-3 p-1">
							{(
								[
									{
										key: "bold",
										label: "B",
										active:
											textContentStyle(annotation.textContent).fontWeight >=
											700,
										toggle: () =>
											updateTextStyle({
												fontWeight:
													textContentStyle(annotation.textContent).fontWeight >=
													700
														? 400
														: 700,
											}),
									},
									{
										key: "italic",
										label: "I",
										active: textContentStyle(annotation.textContent).italic,
										toggle: () =>
											updateTextStyle({
												italic: !textContentStyle(annotation.textContent)
													.italic,
											}),
									},
									{
										key: "underline",
										label: "U",
										active:
											textContentStyle(annotation.textContent).decoration ===
											"underline",
										toggle: () =>
											updateTextStyle({
												decoration:
													textContentStyle(annotation.textContent)
														.decoration === "underline"
														? "none"
														: "underline",
											}),
									},
									{
										key: "strike",
										label: "S",
										active:
											textContentStyle(annotation.textContent).decoration ===
											"lineThrough",
										toggle: () =>
											updateTextStyle({
												decoration:
													textContentStyle(annotation.textContent)
														.decoration === "lineThrough"
														? "none"
														: "lineThrough",
											}),
									},
								] as const
							).map((chip) => (
								<button
									key={chip.key}
									type="button"
									onMouseDown={(event) => event.preventDefault()}
									onClick={chip.toggle}
									className={cn(
										"h-7 flex-1 rounded-md text-xs font-semibold transition-colors",
										chip.active
											? "bg-gray-1 text-gray-12 shadow-sm"
											: "text-gray-10 hover:text-gray-12",
									)}
								>
									{chip.label}
								</button>
							))}
						</div>
					</Field>

					<SliderWithHistory
						label="Letter spacing"
						value={textContentStyle(annotation.textContent).letterSpacing}
						format={(v) => `${v.toFixed(1)}px`}
						min={-5}
						max={20}
						step={0.5}
						onChange={(letterSpacing) => updateTextStyle({ letterSpacing })}
						dragScope={dragScope}
					/>

					<Field name="Case">
						<ChipGroup
							options={TRANSFORM_OPTIONS}
							value={textContentStyle(annotation.textContent).transform}
							onChange={(transform) => updateTextStyle({ transform })}
						/>
					</Field>

					<Field name="Align">
						<ChipGroup
							options={ALIGN_OPTIONS}
							value={textContentParagraph(annotation.textContent).align}
							onChange={(align) => updateParagraph({ align })}
						/>
					</Field>

					<SliderWithHistory
						label="Line height"
						value={textContentParagraph(annotation.textContent).lineHeight}
						format={(v) => `${v.toFixed(2)}×`}
						min={0.8}
						max={2.5}
						step={0.05}
						onChange={(lineHeight) => updateParagraph({ lineHeight })}
						dragScope={dragScope}
					/>

					<Field name="Vertical align">
						<ChipGroup
							options={VERTICAL_ALIGN_OPTIONS}
							value={annotation.textContent?.verticalAlign ?? "top"}
							onChange={(verticalAlign) => updateTextObject({ verticalAlign })}
						/>
					</Field>

					<Field name="Grow">
						<ChipGroup
							options={GROW_TYPE_OPTIONS}
							value={annotation.textContent?.growType ?? "autoWidth"}
							onChange={(growType) => updateTextObject({ growType })}
						/>
					</Field>

					{/* Explicit dimensions, for when the layout has to be exact
					    rather than whatever the text happens to measure. Each is
					    only editable where the grow type actually honours it:
					    "Hug" derives both from the text, "Wrap" derives height —
					    an enabled field the renderer ignores would be a lie.
					    Editing one promotes the grow type so the number sticks,
					    which is the same rule the resize handles follow. */}
					<Field name="Size">
						<div className="flex items-center gap-2">
							<Slider
								size="xxs"
								label="W"
								ariaLabel="Text box width"
								value={Math.round(annotation.width)}
								min={16}
								max={4000}
								disabled={growType === "autoWidth"}
								format={(v) => `${Math.round(v)}`}
								onChange={(width) => update("width", width)}
								onDragEnd={dragScope()}
							/>
							<Slider
								size="xxs"
								label="H"
								ariaLabel="Text box height"
								value={Math.round(annotation.height)}
								min={16}
								max={4000}
								disabled={growType !== "fixed"}
								format={(v) => `${Math.round(v)}`}
								onChange={(height) => update("height", height)}
								onDragEnd={dragScope()}
							/>
						</div>
					</Field>

					<Field name="Halo">
						<div className="flex items-center justify-between">
							<span className="text-xs text-gray-11">Outline</span>
							<Switch
								checked={annotation.textContent?.halo != null}
								onCheckedChange={(checked) =>
									updateTextObject({
										halo: checked ? { width: 2, color: "#000000" } : null,
									})
								}
							/>
						</div>
					</Field>

					{(() => {
						const halo = annotation.textContent?.halo;
						if (!halo) return null;
						return (
							<>
								<Field name="Halo colour">
									<RgbInput
										value={toRgb(halo.color)}
										onChange={(rgb) =>
											updateTextObject({
												halo: { ...halo, color: rgbToHex(rgb) },
											})
										}
									/>
								</Field>
								<SliderWithHistory
									label="Halo width"
									value={halo.width}
									format={(v) => `${v.toFixed(1)}px`}
									min={0.5}
									max={10}
									step={0.5}
									onChange={(width) =>
										updateTextObject({ halo: { ...halo, width } })
									}
									dragScope={dragScope}
								/>
							</>
						);
					})()}
				</>
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
									? "border-accent-border-selected bg-accent-solid/20 text-gray-12"
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
							{MASK_MODES.map(({ label, value }) => (
								<button
									key={value}
									type="button"
									onClick={() => update("maskMode", value)}
									className={cn(
										"h-7 flex-1 rounded-md text-xs transition-colors",
										maskMode === value
											? "bg-gray-1 text-gray-12 shadow-sm"
											: "text-gray-10 hover:text-gray-12",
									)}
								>
									{label}
								</button>
							))}
						</div>
					</Field>
					<Field name="Shape">
						<div className="flex items-center gap-1 rounded-lg bg-gray-3 p-1">
							{MASK_SHAPES.map(({ label, value }) => (
								<button
									key={value}
									type="button"
									onClick={() => update("maskShape", value)}
									className={cn(
										"h-7 flex-1 rounded-md text-xs transition-colors",
										(annotation.maskShape ?? "rect") === value
											? "bg-gray-1 text-gray-12 shadow-sm"
											: "text-gray-10 hover:text-gray-12",
									)}
								>
									{label}
								</button>
							))}
						</div>
					</Field>
					{REVERSIBLE_MASK_MODES.has(maskMode) ? (
						<p className="px-1 text-[11px] leading-snug text-gray-11">
							Obscures the area but does not destroy it. Use Redact for
							passwords, keys or anything else that must not be recoverable.
						</p>
					) : null}
					{maskMode === "blur" || maskMode === "pixelate" ? (
						<SliderWithHistory
							label={maskMode === "blur" ? "Blur radius" : "Block size"}
							value={annotation.maskAmount ?? MASK_AMOUNT_DEFAULT}
							min={MASK_AMOUNT_MIN}
							max={MASK_AMOUNT_MAX}
							onChange={(v) => update("maskAmount", v)}
							dragScope={dragScope}
						/>
					) : null}
					{maskMode === "spotlight" ? (
						<SliderWithHistory
							label="Outside darkness"
							value={annotation.maskDarkness ?? 0.5}
							format={(v) => `${Math.round(v * 100)}%`}
							min={0}
							max={1}
							step={0.01}
							onChange={(v) => update("maskDarkness", v)}
							dragScope={dragScope}
						/>
					) : null}
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
