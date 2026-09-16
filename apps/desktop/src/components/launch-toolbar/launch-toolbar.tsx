import {
	AnimatePresence,
	LayoutGroup,
	motion,
	useIsPresent,
	useReducedMotion,
} from "motion/react";
import { type ReactNode, type Ref, useId } from "react";
import ClockIcon from "~icons/lucide/clock-3";
import ExpandIcon from "~icons/lucide/expand";
import ImageIcon from "~icons/lucide/image";
import MicIcon from "~icons/lucide/mic";
import MicOffIcon from "~icons/lucide/mic-off";
import MinusIcon from "~icons/lucide/minus";
import SettingsIcon from "~icons/lucide/settings";
import VideoIcon from "~icons/lucide/video";
import VolumeIcon from "~icons/lucide/volume-2";
import VolumeOffIcon from "~icons/lucide/volume-x";
import CloseIcon from "~icons/lucide/x";
import "./launch-toolbar.css";
import { CaptureTargetSelector } from "./capture-source-picker";

export { CaptureTargetSelector } from "./capture-source-picker";

const shellSpring = {
	type: "spring",
	stiffness: 420,
	damping: 41,
	mass: 1,
} as const;
const detailSpring = {
	type: "spring",
	stiffness: 620,
	damping: 45,
	mass: 0.8,
} as const;

function MorphIcon({
	children,
	value,
}: {
	children: ReactNode;
	value: string;
}) {
	const reducedMotion = useReducedMotion();
	return (
		<span className="launch-toolbar-icon-slot">
			<AnimatePresence initial={false}>
				<motion.span
					key={value}
					className="launch-toolbar-icon-layer"
					initial={{
						opacity: 0,
						scale: reducedMotion ? 1 : 0.45,
						filter: reducedMotion ? "blur(0px)" : "blur(3px)",
					}}
					animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
					exit={{
						opacity: 0,
						scale: reducedMotion ? 1 : 0.45,
						filter: reducedMotion ? "blur(0px)" : "blur(3px)",
					}}
					transition={reducedMotion ? { duration: 0.1 } : detailSpring}
				>
					{children}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}

function RecordingControls({
	state,
	onChange,
	ref,
}: {
	state: LaunchToolbarState;
	onChange: (state: LaunchToolbarState) => void;
	ref?: Ref<HTMLDivElement>;
}) {
	const present = useIsPresent();
	const reducedMotion = useReducedMotion();
	return (
		<motion.div
			ref={ref}
			layout="position"
			className="launch-toolbar-recording-content"
			inert={!present}
			initial="hidden"
			animate="visible"
			exit="hidden"
			aria-hidden={!present}
			variants={{
				hidden: { opacity: 0 },
				visible: {
					opacity: 1,
					transition: { staggerChildren: reducedMotion ? 0 : 0.035 },
				},
			}}
		>
			{[
				{
					key: "microphone",
					label: "Microphone",
					active: state.microphone,
					icon: state.microphone ? <MicIcon /> : <MicOffIcon />,
				},
				{
					key: "systemAudio",
					label: "System audio",
					active: state.systemAudio,
					icon: state.systemAudio ? <VolumeIcon /> : <VolumeOffIcon />,
				},
			].map(({ key, label, active, icon }) => (
				<motion.div
					key={key}
					transition={reducedMotion ? { duration: 0.1 } : detailSpring}
					variants={{
						hidden: {
							opacity: 0,
							x: reducedMotion ? 0 : -14,
							y: reducedMotion ? 0 : 5,
							scale: reducedMotion ? 1 : 0.65,
							filter: reducedMotion ? "blur(0px)" : "blur(4px)",
						},
						visible: { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" },
					}}
				>
					<ToolbarButton
						label={label}
						active={active}
						disabled={!present}
						onClick={() => onChange({ ...state, [key]: !active })}
					>
						<MorphIcon value={String(active)}>{icon}</MorphIcon>
					</ToolbarButton>
				</motion.div>
			))}
			<Divider />
		</motion.div>
	);
}

export type LaunchToolbarState = {
	mode: "screenshot" | "recording";
	target: "display" | "window" | "area";
	microphone: boolean;
	systemAudio: boolean;
	delay: 0 | 3 | 5 | 10;
};

export const initialLaunchToolbarState: LaunchToolbarState = {
	mode: "screenshot",
	target: "display",
	microphone: false,
	systemAudio: true,
	delay: 0,
};

export function ToolbarButton({
	label,
	children,
	active,
	onClick,
	compact = false,
	disabled = false,
}: {
	label: string;
	children: ReactNode;
	active?: boolean;
	onClick: () => void;
	compact?: boolean;
	disabled?: boolean;
}) {
	const reducedMotion = useReducedMotion();
	return (
		<motion.button
			layout="position"
			whileTap={reducedMotion ? undefined : { scale: 0.92 }}
			transition={reducedMotion ? { duration: 0 } : detailSpring}
			type="button"
			className={`launch-toolbar-button${compact ? " launch-toolbar-button-compact" : ""}`}
			title={label}
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
			disabled={disabled}
		>
			{children}
		</motion.button>
	);
}

export function CaptureModeSwitch({
	mode,
	onChange,
}: {
	mode: LaunchToolbarState["mode"];
	onChange: (mode: LaunchToolbarState["mode"]) => void;
}) {
	const reducedMotion = useReducedMotion();
	return (
		<motion.div
			layout="position"
			transition={reducedMotion ? { duration: 0 } : shellSpring}
			className="launch-toolbar-modes"
			role="group"
			aria-label="Capture mode"
			data-mode={mode}
		>
			<motion.span
				className="launch-toolbar-mode-highlight"
				aria-hidden="true"
				initial={false}
				animate={{ x: mode === "recording" ? 36 : 0 }}
				transition={reducedMotion ? { duration: 0 } : shellSpring}
			/>
			<ToolbarButton
				label="Screenshot"
				active={mode === "screenshot"}
				onClick={() => onChange("screenshot")}
			>
				<ImageIcon />
			</ToolbarButton>
			<ToolbarButton
				label="Recording"
				active={mode === "recording"}
				onClick={() => onChange("recording")}
			>
				<VideoIcon />
			</ToolbarButton>
		</motion.div>
	);
}

function Divider() {
	const reducedMotion = useReducedMotion();
	return (
		<motion.span
			layout="position"
			transition={reducedMotion ? { duration: 0 } : shellSpring}
			className="launch-toolbar-divider"
			aria-hidden="true"
		/>
	);
}

export function LaunchToolbar({
	state,
	onChange,
	onAction,
	onPickerRequest,
	onTargetChoice,
}: {
	state: LaunchToolbarState;
	onChange: (state: LaunchToolbarState) => void;
	onAction: (action: "settings" | "expand" | "minimize" | "close") => void;
	onPickerRequest?: (target: LaunchToolbarState["target"]) => void;
	onTargetChoice?: (
		target: Extract<LaunchToolbarState["target"], "display" | "window">,
		label: string,
	) => void;
}) {
	const reducedMotion = useReducedMotion();
	const layoutId = useId();
	return (
		<LayoutGroup id={layoutId}>
			<motion.div
				layout={!reducedMotion}
				transition={reducedMotion ? { duration: 0 } : shellSpring}
				style={{ borderRadius: 13 }}
				className="launch-toolbar"
				role="group"
				aria-label={`${state.mode === "screenshot" ? "Screenshot" : "Recording"} launch toolbar`}
				data-mode={state.mode}
			>
				<CaptureModeSwitch
					mode={state.mode}
					onChange={(mode) => onChange({ ...state, mode })}
				/>
				<Divider />
				<CaptureTargetSelector
					target={state.target}
					onChange={(target) => onChange({ ...state, target })}
					onPickerRequest={onPickerRequest}
					onTargetChoice={onTargetChoice}
				/>
				<Divider />
				<AnimatePresence initial={false} mode="popLayout">
					{state.mode === "recording" && (
						<RecordingControls
							key="recording"
							state={state}
							onChange={onChange}
						/>
					)}
				</AnimatePresence>
				<ToolbarButton
					label={`Capture delay: ${state.delay} seconds. Click to cycle.`}
					active={state.delay > 0}
					onClick={() =>
						onChange({
							...state,
							delay:
								state.delay === 0
									? 3
									: state.delay === 3
										? 5
										: state.delay === 5
											? 10
											: 0,
						})
					}
				>
					<ClockIcon />
					{state.delay > 0 && <small>{state.delay}</small>}
				</ToolbarButton>
				<ToolbarButton label="Settings" onClick={() => onAction("settings")}>
					<SettingsIcon />
				</ToolbarButton>
				<Divider />
				<motion.div
					layout="position"
					transition={reducedMotion ? { duration: 0 } : shellSpring}
					className="launch-toolbar-window-actions"
				>
					<ToolbarButton
						compact
						label="Expand preview"
						onClick={() => onAction("expand")}
					>
						<ExpandIcon />
					</ToolbarButton>
					<ToolbarButton
						compact
						label="Minimize preview"
						onClick={() => onAction("minimize")}
					>
						<MinusIcon />
					</ToolbarButton>
					<ToolbarButton
						compact
						label="Close preview"
						onClick={() => onAction("close")}
					>
						<CloseIcon />
					</ToolbarButton>
				</motion.div>
			</motion.div>
		</LayoutGroup>
	);
}
