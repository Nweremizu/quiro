import { cn, Popover, PopoverContent, PopoverTrigger } from "@quiro/ui";
import type {
	BackgroundConfiguration,
	PerspectiveConfiguration,
} from "@/utils/tauri";
import IconLucideBox from "~icons/lucide/box";
import { EditorButton, Field, Slider } from "../ui";

// Perspective control: tilts the card in 3D. Quiro-original — Cap has nothing
// to port here (their only "tilt" rotates the cursor sprite during video
// playback, not the card).
//
// Follows ShadowPopover's "created on demand" pattern: `background.perspective`
// stays `null` — rendering identically flat, bit-for-bit — until either a
// preset other than None is picked or a slider is first touched.

const DEFAULT_PERSPECTIVE: PerspectiveConfiguration = {
	tiltX: 0,
	tiltY: 0,
	rotate: 0,
	depth: 45,
};

type Preset = {
	id: string;
	label: string;
	config: PerspectiveConfiguration | null;
};

const PRESETS: Preset[] = [
	{ id: "none", label: "None", config: null },
	{
		id: "left",
		label: "Left",
		config: { tiltX: -8, tiltY: -22, rotate: 0, depth: 55 },
	},
	{
		id: "right",
		label: "Right",
		config: { tiltX: -8, tiltY: 22, rotate: 0, depth: 55 },
	},
	{
		id: "back",
		label: "Back",
		config: { tiltX: 18, tiltY: 0, rotate: 0, depth: 60 },
	},
];

/** A tiny card rendered with the same tilt as the preset it represents — an
 * actual CSS 3D transform, not a stand-in icon, so the button shows exactly
 * what picking it does. */
function PresetSwatch({ config }: { config: PerspectiveConfiguration | null }) {
	return (
		<div
			className="flex h-7 w-9 items-center justify-center"
			style={{ perspective: "80px" }}
		>
			<div
				className={cn(
					"h-4 w-6 rounded-[2px] border",
					config
						? "border-accent-border-selected/70 bg-accent-solid/20"
						: "border-gray-7 bg-gray-4",
				)}
				style={{
					transform: config
						? `rotateX(${config.tiltX}deg) rotateY(${config.tiltY}deg) rotateZ(${config.rotate}deg)`
						: undefined,
					transformStyle: "preserve-3d",
				}}
			/>
		</div>
	);
}

function matchesPreset(
	current: PerspectiveConfiguration | null,
	preset: PerspectiveConfiguration | null,
) {
	if (current === null || preset === null) return current === preset;
	return (
		current.tiltX === preset.tiltX &&
		current.tiltY === preset.tiltY &&
		current.rotate === preset.rotate &&
		current.depth === preset.depth
	);
}

export function PerspectivePopover({
	background,
	onChange,
	open,
	onOpenChange,
}: {
	background: BackgroundConfiguration;
	onChange: (patch: Partial<BackgroundConfiguration>) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const perspective = background.perspective;
	// Sliders always show a value, even before perspective exists, so dragging
	// one from "off" starts from a sensible position rather than 0/0/0/0.
	const display = perspective ?? DEFAULT_PERSPECTIVE;

	const set = (patch: Partial<PerspectiveConfiguration>) =>
		onChange({ perspective: { ...display, ...patch } });

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger
				render={
					<EditorButton
						icon={<IconLucideBox className="size-4" />}
						tooltip="Perspective"
						active={open}
					/>
				}
			/>
			<PopoverContent className="w-64 space-y-4" align="center" side="top">
				<Field name="Presets">
					<div className="grid grid-cols-4 gap-1.5">
						{PRESETS.map((preset) => (
							<button
								key={preset.id}
								type="button"
								onClick={() => onChange({ perspective: preset.config })}
								className={cn(
									"flex flex-col items-center gap-1 rounded-lg border py-1.5 text-[11px] transition-colors",
									matchesPreset(perspective, preset.config)
										? "border-accent-border-selected/60 bg-accent-solid/10 text-gray-12"
										: "border-transparent text-gray-11 hover:bg-gray-3",
								)}
							>
								<PresetSwatch config={preset.config} />
								{preset.label}
							</button>
						))}
					</div>
				</Field>

				<Slider
					label="Tilt X"
					value={display.tiltX}
					min={-45}
					max={45}
					format={(v) => `${Math.round(v)}°`}
					onChange={(tiltX) => set({ tiltX })}
				/>
				<Slider
					label="Tilt Y"
					value={display.tiltY}
					min={-45}
					max={45}
					format={(v) => `${Math.round(v)}°`}
					onChange={(tiltY) => set({ tiltY })}
				/>
				<Slider
					label="Rotate"
					value={display.rotate}
					min={-30}
					max={30}
					format={(v) => `${Math.round(v)}°`}
					onChange={(rotate) => set({ rotate })}
				/>
				<Slider
					label="Depth"
					value={display.depth}
					min={0}
					max={100}
					format={(v) => `${Math.round(v)}`}
					onChange={(depth) => set({ depth })}
				/>
			</PopoverContent>
		</Popover>
	);
}
