import { cn } from "@quiro/ui";
import { useId, useState } from "react";
import type { MotionState } from "@/utils/tauri";
import IconLucideChevronDown from "~icons/lucide/chevron-down";
import { MotionPositionPad } from "./motion-position-pad";
import { Slider } from "./ui";

type MotionPresetId = "push" | "left" | "right" | "tilt" | "lean" | "skew";

const PRESETS: Array<{
	id: MotionPresetId;
	label: string;
	state: MotionState;
}> = [
	{ id: "push", label: "Push in", state: {} },
	{ id: "left", label: "Drift left", state: { offsetX: -0.08 } },
	{ id: "right", label: "Drift right", state: { offsetX: 0.08 } },
	{ id: "tilt", label: "Tilt", state: { tiltY: 12, offsetX: 0.04 } },
	{ id: "lean", label: "Lean back", state: { tiltX: 14 } },
	{ id: "skew", label: "Skew", state: { tiltY: 16, spin: -4 } },
];

const isActive = (state: MotionState, preset: MotionState) =>
	(state.offsetX ?? 0) === (preset.offsetX ?? 0) &&
	(state.offsetY ?? 0) === (preset.offsetY ?? 0) &&
	(state.rotation ?? 0) === (preset.rotation ?? 0) &&
	(state.tiltX ?? 0) === (preset.tiltX ?? 0) &&
	(state.tiltY ?? 0) === (preset.tiltY ?? 0) &&
	(state.spin ?? 0) === (preset.spin ?? 0);

export function MotionStateControls({
	motion,
	onChange,
	onPreview,
	onCommit,
}: {
	motion: MotionState;
	onChange: (motion: MotionState) => void;
	onPreview: (motion: MotionState) => void;
	onCommit: (motion: MotionState) => void;
}) {
	const activePreset = PRESETS.find((preset) => isActive(motion, preset.state));
	const [fineTuningOpen, setFineTuningOpen] = useState(true);
	const fineTuningId = useId();
	const patch = (next: Partial<MotionState>) =>
		onChange({ ...motion, ...next });

	return (
		<section>
			<div className="mb-3 flex items-end justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-gray-12">Movement</h2>
					<p className="mt-0.5 text-[11px] text-gray-10">
						Animate position and rotation across this segment.
					</p>
				</div>
				<span className="shrink-0 rounded-full bg-gray-3 px-2 py-1 text-[10px] font-medium text-gray-10">
					{activePreset?.label ?? "Custom"}
				</span>
			</div>

			<div className="grid grid-cols-3 gap-1.5">
				{PRESETS.map((preset) => {
					const active = activePreset?.id === preset.id;

					return (
						<button
							key={preset.id}
							type="button"
							aria-pressed={active}
							onClick={() => onChange(preset.state)}
							className={cn(
								"group flex min-h-11 min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color,color,scale] duration-100 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
								active
									? "bg-gray-4 text-gray-12 ring-1 ring-accent-border-selected"
									: "bg-gray-2 text-gray-10 hover:bg-gray-3 hover:text-gray-12",
							)}
						>
							<MotionDrawing preset={preset.id} active={active} />
							<span className="min-w-0 truncate text-[10px] font-semibold leading-tight">
								{preset.label}
							</span>
						</button>
					);
				})}
			</div>

			<div className="mt-3 rounded-xl bg-gray-2">
				<button
					type="button"
					aria-expanded={fineTuningOpen}
					aria-controls={fineTuningId}
					onClick={() => setFineTuningOpen((open) => !open)}
					className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-semibold text-gray-12 outline-none transition-[background-color,scale] duration-100 hover:bg-gray-3 focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none"
				>
					Position & rotation
					<span className="ml-auto text-[10px] font-normal text-gray-9">
						Position + 4 angles
					</span>
					<IconLucideChevronDown
						className={cn(
							"size-3.5 text-gray-9 transition-transform duration-150 ease-[var(--ease-snappy)] motion-reduce:transition-none",
							fineTuningOpen && "rotate-180",
						)}
					/>
				</button>
				<div
					id={fineTuningId}
					inert={!fineTuningOpen}
					className={cn(
						"grid overflow-hidden transition-[grid-template-rows] duration-200 ease-[var(--ease-snappy)] motion-reduce:transition-none",
						fineTuningOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
					)}
				>
					<div className="min-h-0 overflow-hidden">
						<div className="flex flex-col gap-5 px-3 pt-2 pb-3">
							<MotionControlGroup title="Position">
								<MotionPositionPad
									value={{
										offsetX: motion.offsetX ?? 0,
										offsetY: motion.offsetY ?? 0,
									}}
									onChange={patch}
									onPreview={(position) =>
										onPreview({ ...motion, ...position })
									}
									onCommit={(position) => onCommit({ ...motion, ...position })}
								/>
							</MotionControlGroup>

							<MotionControlGroup title="Rotation">
								<Slider
									size="xs"
									label="Rotation"
									format={formatDegrees}
									min={-45}
									max={45}
									value={motion.rotation ?? 0}
									onChange={(rotation) => patch({ rotation })}
								/>
								<Slider
									size="xs"
									label="Tilt X"
									ariaLabel="Perspective tilt X"
									format={formatDegrees}
									min={-45}
									max={45}
									value={motion.tiltX ?? 0}
									onChange={(tiltX) => patch({ tiltX })}
								/>
								<Slider
									size="xs"
									label="Tilt Y"
									ariaLabel="Perspective tilt Y"
									format={formatDegrees}
									min={-45}
									max={45}
									value={motion.tiltY ?? 0}
									onChange={(tiltY) => patch({ tiltY })}
								/>
								<Slider
									size="xs"
									label="Spin"
									ariaLabel="Perspective spin"
									format={formatDegrees}
									min={-45}
									max={45}
									value={motion.spin ?? 0}
									onChange={(spin) => patch({ spin })}
								/>
							</MotionControlGroup>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function MotionControlGroup({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-9">
				{title}
			</span>
			{children}
		</div>
	);
}

function MotionDrawing({
	preset,
	active,
}: {
	preset: MotionPresetId;
	active: boolean;
}) {
	return (
		<svg
			viewBox="0 0 28 28"
			aria-hidden="true"
			className="size-7 shrink-0"
			fill="none"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle
				cx="14"
				cy="14"
				r="12.5"
				fill="var(--gray-2)"
				stroke={active ? "var(--accent-border-selected)" : "var(--gray-6)"}
			/>
			{preset === "push" && (
				<>
					<rect
						x="8.5"
						y="8.5"
						width="11"
						height="11"
						rx="2.5"
						stroke="var(--gray-8)"
					/>
					<rect
						x="11"
						y="11"
						width="6"
						height="6"
						rx="1.5"
						fill="var(--accent-solid)"
						stroke="var(--accent-solid)"
					/>
				</>
			)}
			{preset === "left" && (
				<>
					<circle cx="18.5" cy="14" r="1.5" fill="var(--gray-8)" />
					<path
						d="M18 14H9m3-3-3 3 3 3"
						stroke="var(--accent-solid)"
						strokeWidth="1.8"
					/>
				</>
			)}
			{preset === "right" && (
				<>
					<circle cx="9.5" cy="14" r="1.5" fill="var(--gray-8)" />
					<path
						d="M10 14h9m-3-3 3 3-3 3"
						stroke="var(--accent-solid)"
						strokeWidth="1.8"
					/>
				</>
			)}
			{preset === "tilt" && (
				<>
					<path
						d="m8.5 18 4-8h7l-4 8h-7Z"
						stroke="var(--accent-solid)"
						strokeWidth="1.5"
					/>
					<path d="M13 12.5h4" stroke="var(--gray-8)" />
				</>
			)}
			{preset === "lean" && (
				<>
					<path
						d="m9 19 2-10h6l2 10H9Z"
						stroke="var(--accent-solid)"
						strokeWidth="1.5"
					/>
					<path d="M11.5 12h5" stroke="var(--gray-8)" />
				</>
			)}
			{preset === "skew" && (
				<>
					<path
						d="m9 18 4-8h7l-4 8H9Z"
						stroke="var(--accent-solid)"
						strokeWidth="1.5"
					/>
					<path d="m12 16 5-4" stroke="var(--gray-8)" />
				</>
			)}
		</svg>
	);
}

const formatDegrees = (value: number) =>
	value === 0 ? "None" : `${Math.round(value)}°`;
