import { Select, Switch } from "@quiro/ui";
import { FontPicker } from "@/components/FontPicker";
import type {
	CameraXPosition,
	CameraYPosition,
	GrowType,
	MaskMode,
	MaskShape,
	SceneMode,
	TextAlign,
	TextTransform,
	VerticalAlign,
	ZoomSegment,
} from "@/utils/tauri";
import {
	FLAT_PERSPECTIVE,
	IDENTITY_LAYER_TRANSFORM,
	TransformControls,
} from "@/components/TransformControls";
import { MotionStateControls } from "./MotionStateControls";
import { OUTPUT_SIZE, useEditorContext } from "./context";
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

const MASK_MODES: Array<{ label: string; value: MaskMode }> = [
	{ label: "Blur", value: "blur" },
	{ label: "Pixelate", value: "pixelate" },
	{ label: "Redact (irreversible)", value: "redact" },
	{ label: "Spotlight", value: "spotlight" },
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

const MASK_SHAPES: Array<{ label: string; value: MaskShape }> = [
	{ label: "Rectangle", value: "rect" },
	{ label: "Ellipse", value: "ellipse" },
	{ label: "Rounded", value: "roundedRect" },
];

export function SegmentConfig() {
	const { project, setProject, selection } = useEditorContext();
	if (!project || !selection) return null;

	const timeline = project.timeline;

	const patchAt = <K extends keyof NonNullable<typeof timeline>>(
		key: K,
		index: number,
		patch: object,
	) =>
		setProject((current) => {
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

	switch (selection.type) {
		case "zoom": {
			const segment = timeline?.zoomSegments?.[selection.index];
			if (!segment) return null;
			const manual =
				typeof segment.mode === "object" ? segment.mode.manual : null;

			return (
				<Panel title="Zoom segment">
					<Slider
						size="sm"
						label="Amount"
						format={(v) => `${v.toFixed(1)}x`}
						min={1}
						max={4}
						step={0.1}
						value={segment.amount}
						onChange={(amount) =>
							patchAt("zoomSegments", selection.index, { amount })
						}
					/>

					<Field name="Focus">
						<Subfield name="Follow cursor">
							<Switch
								checked={segment.mode === "auto"}
								onCheckedChange={(auto) =>
									patchAt("zoomSegments", selection.index, {
										mode: auto
											? "auto"
											: ({ manual: { x: 0.5, y: 0.5 } } as ZoomSegment["mode"]),
									})
								}
							/>
						</Subfield>

						{manual && (
							<>
								<Slider
									size="sm"
									label="Horizontal"
									format={(v) => `${Math.round(v * 100)}%`}
									min={0}
									max={1}
									step={0.01}
									value={manual.x}
									onChange={(x) =>
										patchAt("zoomSegments", selection.index, {
											mode: { manual: { ...manual, x } },
										})
									}
								/>
								<Slider
									size="sm"
									label="Vertical"
									format={(v) => `${Math.round(v * 100)}%`}
									min={0}
									max={1}
									step={0.01}
									value={manual.y}
									onChange={(y) =>
										patchAt("zoomSegments", selection.index, {
											mode: { manual: { ...manual, y } },
										})
									}
								/>
							</>
						)}
					</Field>

					<MotionStateControls
						motion={segment.motion ?? {}}
						onChange={(motion) =>
							patchAt("zoomSegments", selection.index, { motion })
						}
					/>
				</Panel>
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
			// `mode` is optional in the bindings because it carries a serde
			// default; migrated configs always have one.
			const mode: MaskMode = segment.mode ?? "blur";

			return (
				<Panel title="Mask segment">
					<Field name="Effect">
						<Select
							value={mode}
							onValueChange={(next) =>
								patchAt("maskSegments", selection.index, {
									mode: next as MaskMode,
								})
							}
							options={MASK_MODES.map(({ label, value }) => ({
								label,
								value: String(value),
							}))}
						/>
					</Field>

					<Field name="Shape">
						<Select
							value={segment.shape ?? "rect"}
							onValueChange={(next) =>
								patchAt("maskSegments", selection.index, {
									shape: next as MaskShape,
								})
							}
							options={MASK_SHAPES.map(({ label, value }) => ({
								label,
								value: String(value),
							}))}
						/>
					</Field>

					{REVERSIBLE_MODES.has(mode) ? (
						<p className="text-xs text-gray-11">
							Obscures the area but does not destroy it — the original pixels
							can in principle be recovered. Use Redact for anything sensitive.
						</p>
					) : null}

					{/* Redaction is deliberately hard-edged: a feathered boundary
					    leaves partially-original pixels, which would break the one
					    promise this mode makes. */}
					{mode === "redact" ? null : (
						<Slider
							size="sm"
							label="Feather"
							format={(v) => `${Math.round(v * 100)}%`}
							min={0}
							max={1}
							step={0.01}
							value={segment.feather ?? 0}
							onChange={(feather) =>
								patchAt("maskSegments", selection.index, { feather })
							}
						/>
					)}

					{mode === "blur" || mode === "pixelate" ? (
						<Slider
							size="sm"
							label={mode === "blur" ? "Blur radius" : "Block size"}
							format={(v) => `${Math.round(v)}`}
							min={MASK_AMOUNT_MIN}
							max={MASK_AMOUNT_MAX}
							step={1}
							value={segment.amount ?? MASK_AMOUNT_DEFAULT}
							onChange={(amount) =>
								patchAt("maskSegments", selection.index, { amount })
							}
						/>
					) : null}

					{mode === "spotlight" ? (
						<Slider
							size="sm"
							label="Outside darkness"
							format={(v) => `${Math.round(v * 100)}%`}
							min={0}
							max={1}
							step={0.01}
							value={segment.darkness ?? 0}
							onChange={(darkness) =>
								patchAt("maskSegments", selection.index, { darkness })
							}
						/>
					) : null}

					<Field name="Enabled">
						<Switch
							checked={segment.enabled ?? true}
							onCheckedChange={(enabled) =>
								patchAt("maskSegments", selection.index, { enabled })
							}
						/>
					</Field>
				</Panel>
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
							<input
								type="color"
								aria-label="Text colour"
								value={style.color}
								onChange={(event) => updateStyle({ color: event.target.value })}
								className="size-8 cursor-pointer rounded-lg border border-gray-4 bg-transparent"
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

					<Field name="Audio while sped up">
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

					<ClipTransform index={selection.index} />
				</Panel>
			);
		}

		default:
			return null;
	}
}

/** Zoom / Position / Rotation for one clip.
 *
 * Scoped to the clip rather than the project: `TimelineSegment.transform` and
 * `.perspective` override `background.displayTransform` / `.perspective` for
 * the stretch of time that clip covers, resolved per frame by
 * `ProjectConfiguration::with_clip_layer_overrides`. A clip that sets neither
 * inherits the project-wide placement, so the panel opens showing whatever the
 * clip currently renders with, and the first drag makes it the clip's own. */
function ClipTransform({ index }: { index: number }) {
	const { project, setProject } = useEditorContext();
	const segment = project?.timeline?.segments?.[index];

	const transform =
		segment?.transform ??
		project?.background.displayTransform ??
		IDENTITY_LAYER_TRANSFORM;
	const perspective =
		segment?.perspective ?? project?.background.perspective ?? FLAT_PERSPECTIVE;

	const patchClip = (patch: Partial<NonNullable<typeof segment>>) =>
		setProject((current) =>
			current.timeline
				? {
						...current,
						timeline: {
							...current.timeline,
							segments: current.timeline.segments.map((clip, i) =>
								i === index ? { ...clip, ...patch } : clip,
							),
						},
					}
				: current,
		);

	// Padding is symmetric and crop is applied before it, so neither moves the
	// card's *centre* — only `displayPosition` does. That makes the laid-out
	// centre exact here rather than an approximation, without the video editor
	// needing the screenshot editor's `getImageRect`.
	const laidOutCentre = {
		x: (project?.background.displayPosition?.x ?? 0.5) * OUTPUT_SIZE.x,
		y: (project?.background.displayPosition?.y ?? 0.5) * OUTPUT_SIZE.y,
	};

	if (!segment) return null;

	return (
		<TransformControls
			transform={transform}
			perspective={perspective}
			canvas={{ width: OUTPUT_SIZE.x, height: OUTPUT_SIZE.y }}
			laidOutCentre={laidOutCentre}
			// No focus pad: a clip is a span of moving frames, so there is no one
			// still to place a focal point against. Scale still zooms about
			// whatever origin the clip already carries.
			onTransformChange={(patch) =>
				patchClip({ transform: { ...transform, ...patch } })
			}
			onPerspectiveChange={(patch) =>
				patchClip({ perspective: { ...perspective, ...patch } })
			}
		/>
	);
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
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<button
				type="button"
				onClick={() => setSelection(null)}
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
