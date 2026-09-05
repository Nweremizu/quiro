import type { MotionState } from "@/utils/tauri";
import { Field, Slider, Subfield } from "./ui";

// The motion state a zoom segment moves into.
//
// Deliberately not an animation editor. There are no keyframes, no times and no
// curves here, because there is nothing to author on the way back — the same
// springs that carry the zoom in and out carry these, and rest is always the
// untransformed canvas. So the user answers one question, "what should this
// look like while it is engaged", and the system owns everything else.
//
// Every value is a delta from the resting canvas, which is why they all read as
// "none" at zero rather than as an absolute placement.

const PRESETS: Array<{ label: string; state: MotionState }> = [
	{ label: "Push in", state: {} },
	{ label: "Drift left", state: { offsetX: -0.08 } },
	{ label: "Drift right", state: { offsetX: 0.08 } },
	{ label: "Tilt", state: { tiltY: 12, offsetX: 0.04 } },
	{ label: "Lean back", state: { tiltX: 14 } },
	{ label: "Skew", state: { tiltY: 16, spin: -4 } },
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
}: {
	motion: MotionState;
	onChange: (motion: MotionState) => void;
}) {
	const patch = (next: Partial<MotionState>) => onChange({ ...motion, ...next });

	return (
		<Field name="Movement">
			<div className="flex flex-wrap gap-1 pb-1">
				{PRESETS.map((preset) => (
					<button
						key={preset.label}
						type="button"
						onClick={() => onChange(preset.state)}
						className={
							isActive(motion, preset.state)
								? "rounded-md bg-gray-5 px-2 py-1 text-[0.6875rem] text-gray-12"
								: "rounded-md bg-gray-3 px-2 py-1 text-[0.6875rem] text-gray-11 hover:bg-gray-4"
						}
					>
						{preset.label}
					</button>
				))}
			</div>

			<Subfield name="Horizontal">
				<Slider
					size="sm"
					label="Horizontal drift"
					format={(v) => (v === 0 ? "None" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`)}
					min={-0.5}
					max={0.5}
					step={0.01}
					value={motion.offsetX ?? 0}
					onChange={(offsetX) => patch({ offsetX })}
				/>
			</Subfield>

			<Subfield name="Vertical">
				<Slider
					size="sm"
					label="Vertical drift"
					format={(v) => (v === 0 ? "None" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`)}
					min={-0.5}
					max={0.5}
					step={0.01}
					value={motion.offsetY ?? 0}
					onChange={(offsetY) => patch({ offsetY })}
				/>
			</Subfield>

			<Subfield name="Rotation">
				<Slider
					size="sm"
					label="Rotation"
					format={(v) => (v === 0 ? "None" : `${Math.round(v)}°`)}
					min={-45}
					max={45}
					step={1}
					value={motion.rotation ?? 0}
					onChange={(rotation) => patch({ rotation })}
				/>
			</Subfield>

			<Subfield name="Tilt X">
				<Slider
					size="sm"
					label="Perspective tilt X"
					format={(v) => (v === 0 ? "None" : `${Math.round(v)}°`)}
					min={-45}
					max={45}
					step={1}
					value={motion.tiltX ?? 0}
					onChange={(tiltX) => patch({ tiltX })}
				/>
			</Subfield>

			<Subfield name="Tilt Y">
				<Slider
					size="sm"
					label="Perspective tilt Y"
					format={(v) => (v === 0 ? "None" : `${Math.round(v)}°`)}
					min={-45}
					max={45}
					step={1}
					value={motion.tiltY ?? 0}
					onChange={(tiltY) => patch({ tiltY })}
				/>
			</Subfield>

			<Subfield name="Spin">
				<Slider
					size="sm"
					label="Perspective spin"
					format={(v) => (v === 0 ? "None" : `${Math.round(v)}°`)}
					min={-45}
					max={45}
					step={1}
					value={motion.spin ?? 0}
					onChange={(spin) => patch({ spin })}
				/>
			</Subfield>
		</Field>
	);
}
