import { cn } from "@quiro/ui";
import {
	AnimatePresence,
	LayoutGroup,
	motion,
	useReducedMotion,
} from "motion/react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Tooltip } from "@/components/Tooltip";
import CameraIcon from "~icons/lucide/camera";
import CameraOffIcon from "~icons/lucide/camera-off";
import ChevronIcon from "~icons/lucide/chevron-down";
import MoreIcon from "~icons/lucide/ellipsis-vertical";
import MicIcon from "~icons/lucide/mic";
import MicOffIcon from "~icons/lucide/mic-off";
import MinusIcon from "~icons/lucide/minus";

import VolumeIcon from "~icons/lucide/volume-2";
import VolumeOffIcon from "~icons/lucide/volume-x";
import CloseIcon from "~icons/lucide/x";
import {
	AreaIcon,
	DisplayIcon,
	ImageIcon,
	VideoIcon,
	WindowIcon,
} from "./icons/image";

type TargetMode = "display" | "window" | "area";
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const targets = [
	{ kind: "display", label: "Display", Icon: DisplayIcon },
	{ kind: "window", label: "Window", Icon: WindowIcon },
	{ kind: "area", label: "Area", Icon: AreaIcon },
] as const;
const quickAction =
	"relative grid size-9 shrink-0 touch-manipulation place-items-center rounded-[9px] text-gray-10 transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-gray-3 hover:text-gray-12 active:bg-gray-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-gray-1 [&_svg]:size-[18px] [&_svg]:stroke-[1.75]";
const quickActionActive =
	"bg-accent-surface text-accent-text shadow-[inset_0_0_0_1px_var(--color-accent-border)] hover:bg-accent-surface-hover hover:text-accent-text";
const spring = { type: "spring", duration: 0.3, bounce: 0 } as const;

function Separator() {
	return (
		<div
			className="mx-0.75 h-6 w-1.25 rounded-sm shrink-0 bg-gray-5"
			aria-hidden="true"
		/>
	);
}

function MorphIcon({
	active,
	ActiveIcon,
	InactiveIcon,
}: {
	active: boolean;
	ActiveIcon: IconComponent;
	InactiveIcon: IconComponent;
}) {
	const reduceMotion = useReducedMotion();
	return (
		<span className="relative grid size-[18px] place-items-center">
			<AnimatePresence initial={false} mode="popLayout">
				<motion.span
					key={active ? "active" : "inactive"}
					className="absolute inset-0 grid place-items-center"
					initial={{
						opacity: 0,
						scale: reduceMotion ? 1 : 0.25,
						filter: reduceMotion ? "blur(0px)" : "blur(4px)",
					}}
					animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
					exit={{
						opacity: 0,
						scale: reduceMotion ? 1 : 0.25,
						filter: reduceMotion ? "blur(0px)" : "blur(4px)",
					}}
					transition={reduceMotion ? { duration: 0 } : spring}
				>
					{active ? (
						<ActiveIcon className="text-accent-400 brightness-105" />
					) : (
						<InactiveIcon />
					)}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}

function QuickAction({
	label,
	active = false,
	activeAppearance = "surface",
	children,
	onClick,
	className,
}: {
	label: string;
	active?: boolean;
	activeAppearance?: "surface" | "icon";
	children: ReactNode;
	onClick: () => void;
	className?: string;
}) {
	const reduceMotion = useReducedMotion();
	return (
		<motion.button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={active || undefined}
			className={cn(
				quickAction,
				active &&
					(activeAppearance === "icon"
						? "text-accent-400 hover:text-accent-400"
						: quickActionActive),
				className,
			)}
			onClick={onClick}
			whileTap={reduceMotion ? undefined : { scale: 0.96 }}
			transition={spring}
		>
			{children}
		</motion.button>
	);
}

export function LaunchToolbar({
	recording,
	targetMode,
	microphone,
	microphoneLabel,
	systemAudio,
	camera,
	cameraLabel,
	moreOpen,
	panel,
	panelKey,
	onMode,
	onTarget,
	onBrowse,
	onMicrophone,
	onSystemAudio,
	onCamera,
	onMore,
	onMinimize,
	onClose,
}: {
	recording: boolean;
	targetMode: TargetMode | null | undefined;
	microphone: boolean;
	microphoneLabel: string;
	systemAudio: boolean;
	camera: boolean;
	cameraLabel: string;
	moreOpen: boolean;
	panel: ReactNode;
	panelKey: string | null;
	onMode: (recording: boolean) => void;
	onTarget: (mode: TargetMode) => void;
	onBrowse: (mode: "display" | "window") => void;
	onMicrophone: () => void;
	onSystemAudio: () => void;
	onCamera: () => void;
	onMore: () => void;
	onMinimize: () => void;
	onClose: () => void;
}) {
	const reduceMotion = useReducedMotion();
	return (
		<div
			className="flex h-full w-full select-none overflow-hidden p-0.5"
			data-tauri-drag-region
		>
			<motion.div
				initial={false}
				animate={{ maxWidth: recording ? 636 : 556 }}
				transition={reduceMotion ? { duration: 0 } : spring}
				className="mx-auto flex h-full w-full flex-col overflow-hidden rounded-2xl bg-gray-1 text-gray-12 ring-1 ring-gray-5 shadow-[0_1px_2px_oklch(0_0_0/8%),0_14px_36px_-18px_oklch(0_0_0/35%)]"
				data-tauri-drag-region
			>
				<div
					className="flex h-14 w-full shrink-0 items-center gap-1.5 overflow-hidden px-1.5"
					data-tauri-drag-region
				>
					<LayoutGroup id="launch-toolbar-mode">
						<div className="flex shrink-0 items-center gap-0.5 rounded-[11px] bg-gray-3 p-0.5 ring-1 ring-inset ring-gray-5">
							{[
								{ value: false, label: "Screenshot", Icon: ImageIcon },
								{ value: true, label: "Recording", Icon: VideoIcon },
							].map(({ value, label, Icon }) => {
								const selected = recording === value;
								return (
									<motion.button
										key={label}
										type="button"
										title={label}
										aria-label={label}
										aria-pressed={selected}
										onClick={() => onMode(value)}
										whileTap={reduceMotion ? undefined : { scale: 0.96 }}
										transition={spring}
										className={cn(
											"relative grid size-10 shrink-0 touch-manipulation place-items-center rounded-[9px] text-gray-10 transition-colors duration-150 ease-out focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-focus-ring [&_svg]:relative [&_svg]:z-10 [&_svg]:size-5 [&_svg]:stroke-[1.75]",
											selected ? "text-orange-500" : "hover:text-gray-12",
										)}
									>
										{selected && (
											<motion.span
												layoutId="selected-mode"
												className="absolute inset-0 rounded-[9px] bg-gray-1 shadow-[0_1px_2px_oklch(0_0_0/12%),inset_0_0_0_1px_oklch(1_0_0/70%)] dark:shadow-[0_1px_2px_oklch(0.375_0_0/70%),inset_0_0_0_1px_oklch(0_0_0/12%)]"
												transition={reduceMotion ? { duration: 0 } : spring}
											/>
										)}
										<Icon />
									</motion.button>
								);
							})}
						</div>
					</LayoutGroup>
					<Separator />
					<div
						className="flex h-10 min-w-0 flex-1 gap-1.5"
						role="group"
						aria-label="Capture target"
					>
						{targets.map(({ kind, label, Icon }) => {
							const selected = targetMode === kind;
							return (
								<div
									key={kind}
									className={cn(
										"flex min-w-0 flex-1 overflow-hidden rounded-[10px] bg-gray-2 ring-1 ring-inset transition-[background-color,box-shadow,color] duration-150 ease-out focus-within:ring-2 focus-within:ring-accent-focus-ring",
										selected
											? "bg-accent-surface text-accent-text ring-accent-border"
											: "text-gray-11 ring-gray-5 hover:bg-gray-3 hover:text-gray-12 hover:ring-gray-7",
									)}
								>
									<motion.button
										type="button"
										aria-label={`Pick ${label.toLowerCase()} on screen`}
										aria-pressed={selected}
										onClick={() => onTarget(kind)}
										whileTap={reduceMotion ? undefined : { scale: 0.96 }}
										transition={spring}
										className="flex min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-[9px] focus-visible:outline-hidden [&_svg]:size-[18px] [&_svg]:stroke-[1.75]"
									>
										<Icon />
										<span className="max-w-full truncate text-[9px] font-medium leading-none">
											{label}
										</span>
									</motion.button>
									{kind !== "area" && (
										<button
											type="button"
											title={`Browse ${label.toLowerCase()} targets`}
											aria-label={`Browse ${label.toLowerCase()} targets`}
											onClick={() => onBrowse(kind)}
											className="grid w-5 shrink-0 touch-manipulation place-items-center border-l border-current/10 transition-colors duration-150 ease-out hover:bg-black/5 focus-visible:outline-hidden focus-visible:bg-black/5 [&_svg]:size-3"
										>
											<ChevronIcon />
										</button>
									)}
								</div>
							);
						})}
					</div>
					{recording && <Separator />}
					<motion.div
						initial={false}
						animate={{
							width: recording ? 116 : 0,
							opacity: recording ? 1 : 0,
							x: recording || reduceMotion ? 0 : -8,
							scale: recording || reduceMotion ? 1 : 0.96,
						}}
						transition={reduceMotion ? { duration: 0 } : spring}
						className="flex shrink-0 gap-1 overflow-hidden"
						aria-hidden={!recording}
						inert={!recording}
					>
						<Tooltip
							content={<span>{microphoneLabel}</span>}
							childClass="contents"
						>
							<QuickAction
								label="Choose microphone"
								active={microphone}
								activeAppearance="icon"
								onClick={onMicrophone}
							>
								<MorphIcon
									active={microphone}
									ActiveIcon={MicIcon}
									InactiveIcon={MicOffIcon}
								/>
							</QuickAction>
						</Tooltip>
						<QuickAction
							label="System audio"
							active={systemAudio}
							activeAppearance="icon"
							onClick={onSystemAudio}
						>
							<MorphIcon
								active={systemAudio}
								ActiveIcon={VolumeIcon}
								InactiveIcon={VolumeOffIcon}
							/>
						</QuickAction>
						<Tooltip content={<span>{cameraLabel}</span>} childClass="contents">
							<QuickAction
								label="Choose webcam"
								active={camera}
								activeAppearance="icon"
								onClick={onCamera}
							>
								<MorphIcon
									active={camera}
									ActiveIcon={CameraIcon}
									InactiveIcon={CameraOffIcon}
								/>
							</QuickAction>
						</Tooltip>
					</motion.div>
					<Separator />
					<div className="flex shrink-0 gap-0.5">
						<QuickAction
							label="More options"
							active={moreOpen}
							onClick={onMore}
						>
							<MoreIcon />
						</QuickAction>
						<QuickAction label="Hide launch window" onClick={onMinimize}>
							<MinusIcon />
						</QuickAction>
						<QuickAction
							label="Close launch window"
							onClick={onClose}
							className="hover:bg-red-3 hover:text-red-11 active:bg-red-4"
						>
							<CloseIcon />
						</QuickAction>
					</div>
				</div>
				{panel && (
					<motion.div
						key={panelKey}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={
							reduceMotion
								? { duration: 0 }
								: { duration: 0.15, ease: [0.22, 1, 0.36, 1] }
						}
						className="min-h-0 flex-1 overflow-hidden border-t border-gray-5"
					>
						<div className="h-full overflow-x-hidden overflow-y-auto px-3 pb-3">
							{panel}
						</div>
					</motion.div>
				)}
			</motion.div>
		</div>
	);
}
