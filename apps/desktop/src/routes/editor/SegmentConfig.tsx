import { Select, Switch } from "@quiro/ui";
import type {
	CameraXPosition,
	CameraYPosition,
	MaskKind,
	SceneMode,
	ZoomSegment,
} from "@/utils/tauri";
import { useEditorContext } from "./context";
import { Field, Slider, Subfield } from "./ui";

// Selecting a timeline segment replaces the sidebar's tabs with that
// segment's own settings, the way Cap's does — the properties that only make
// sense for one segment live here rather than in the global tabs.

const SCENE_MODES: Array<{ label: string; value: SceneMode }> = [
	{ label: "Default", value: "default" },
	{ label: "Camera only", value: "cameraOnly" },
	{ label: "Hide camera", value: "hideCamera" },
	{ label: "Split screen", value: "splitScreen" },
];

const MASK_KINDS: Array<{ label: string; value: MaskKind }> = [
	{ label: "Blur sensitive area", value: "sensitive" },
	{ label: "Highlight", value: "highlight" },
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

			return (
				<Panel title="Mask segment">
					<Field name="Effect">
						<Select
							value={segment.maskType}
							onValueChange={(maskType) =>
								patchAt("maskSegments", selection.index, { maskType })
							}
							options={MASK_KINDS.map(({ label, value }) => ({
								label,
								value: String(value),
							}))}
						/>
					</Field>

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

					{segment.maskType === "sensitive" ? (
						<Slider
							size="sm"
							label="Pixelation"
							format={(v) => `${Math.round(v * 100)}%`}
							min={0}
							max={1}
							step={0.01}
							value={segment.pixelation ?? 0}
							onChange={(pixelation) =>
								patchAt("maskSegments", selection.index, { pixelation })
							}
						/>
					) : (
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
					)}

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

			return (
				<Panel title="Text segment">
					<Field name="Content">
						<textarea
							value={segment.content ?? ""}
							onChange={(event) =>
								patchAt("textSegments", selection.index, {
									content: event.target.value,
								})
							}
							className="min-h-16 w-full rounded-lg border border-gray-4 bg-gray-2 p-2 text-xs text-gray-12"
						/>
					</Field>

					<Slider
						size="sm"
						label="Font size"
						format={(v) => `${Math.round(v)}px`}
						min={8}
						max={200}
						value={segment.fontSize ?? 48}
						onChange={(fontSize) =>
							patchAt("textSegments", selection.index, { fontSize })
						}
					/>

					<Field name="Style">
						<Subfield name="Italic">
							<Switch
								checked={segment.italic ?? false}
								onCheckedChange={(italic) =>
									patchAt("textSegments", selection.index, { italic })
								}
							/>
						</Subfield>
						<Subfield name="Colour">
							<input
								type="color"
								aria-label="Text colour"
								value={segment.color ?? "#ffffff"}
								onChange={(event) =>
									patchAt("textSegments", selection.index, {
										color: event.target.value,
									})
								}
								className="size-8 cursor-pointer rounded-lg border border-gray-4 bg-transparent"
							/>
						</Subfield>
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
