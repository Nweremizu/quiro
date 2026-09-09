import { PreviewCard as HoverCard } from "@base-ui/react/preview-card";
import { cn } from "@quiro/ui";
import type { ComponentType } from "react";
import { commands, type RecordingMode } from "@/utils/tauri";
import IconHeroiconsCog6Tooth from "~icons/heroicons/cog-6-tooth";
import IconFlimSlate from "~icons/ph/film-slate";
import IconStreamlineFlexScreenshot from "~icons/ph/image-fill";
import IconLucideInfo from "~icons/solar/info-circle-bold";
import { useRecordingOptions } from "./options-context";

interface QuiroModeProps {
	onInfoClick?: () => void;
}

type QuiroModeButtonConfig = {
	mode: RecordingMode;
	label: string;
	description: string;
	icon: ComponentType<{ className?: string }>;
	settingsSection: "studio-quality" | null;
	iconClassName?: string;
};

const QUIRO_MODE_BUTTONS: QuiroModeButtonConfig[] = [
	{
		mode: "studio",
		label: "Studio Mode",
		description: "High-quality recording with advanced features.",
		icon: IconFlimSlate,
		settingsSection: "studio-quality",
		iconClassName: "size-[0.9rem] invert ",
	},
	{
		mode: "screenshot",
		label: "Screenshot Mode",
		description: "Capture high-resolution screenshots.",
		icon: IconStreamlineFlexScreenshot,
		settingsSection: null,
		iconClassName: "size-[0.9rem] invert",
	},
];

type QuiroModeControlProps = {
	mode: RecordingMode;
	onModeChange: (mode: RecordingMode) => void;
	onInfoClick?: () => void;
};

export function QuiroModeControl({
	mode,
	onModeChange,
	onInfoClick,
}: QuiroModeControlProps) {
	return (
		<div className="relative flex w-fit items-center gap-2 rounded-full border border-gray-5 bg-gray-3 p-1.5">
			{onInfoClick ? (
				<button
					type="button"
					onClick={onInfoClick}
					className="group absolute -left-1.5 -top-2 grid size-5 place-items-center rounded-full bg-gray-5 transition-transform duration-150 focus:outline-none active:scale-[0.96]"
					aria-label="Recording mode info"
				>
					<IconLucideInfo className="size-2.5 text-gray-11 transition-opacity duration-150 group-hover:opacity-60" />
				</button>
			) : null}
			{QUIRO_MODE_BUTTONS.map((buttonConfig) => {
				const isSelected = mode === buttonConfig.mode;
				const Icon = buttonConfig.icon;
				const settingsSection = buttonConfig.settingsSection;

				return (
					<HoverCard.Root key={buttonConfig.mode}>
						<HoverCard.Trigger delay={20} closeDelay={50}>
							<button
								type="button"
								onClick={() => onModeChange(buttonConfig.mode)}
								aria-label={buttonConfig.label}
								aria-pressed={isSelected}
								className={cn(
									"relative flex size-7 items-center justify-center rounded-full transition-[background-color,box-shadow,transform] duration-150 focus:outline-none active:scale-[0.96]",
									isSelected
										? "bg-gray-7 ring-2 ring-accent-border-selected ring-offset-1 ring-offset-gray-1 hover:bg-gray-7"
										: "bg-gray-3 hover:bg-gray-7",
								)}
							>
								<Icon className={buttonConfig.iconClassName} />
							</button>
						</HoverCard.Trigger>
						<HoverCard.Portal data-slot="hover-card-portal">
							<HoverCard.Positioner
								side="bottom"
								align="center"
								alignOffset={4}
								sideOffset={4}
								className="isolate z-50"
							>
								<HoverCard.Popup
									data-slot="hover-card-content"
									className="z-50 animate-in fade-in slide-in-from-top-1 outline-none duration-100"
								>
									<div className="flex min-w-[12rem] max-w-[15rem] flex-col gap-2 rounded-lg border border-gray-3 bg-gray-12 px-3 py-2.5 text-gray-1 shadow-lg">
										<div className="flex flex-col gap-0.5">
											<span className="text-xs font-medium">
												{buttonConfig.label}
											</span>
											<span className="text-[10px] leading-snug text-gray-4">
												{buttonConfig.description}
											</span>
										</div>
										{settingsSection ? (
											<div className="-mx-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-gray-4">
												<IconHeroiconsCog6Tooth className="size-3" />
												<span>Quality settings</span>
											</div>
										) : null}
									</div>
								</HoverCard.Popup>
							</HoverCard.Positioner>
						</HoverCard.Portal>
					</HoverCard.Root>
				);
			})}
		</div>
	);
}

export function QuiroMode({ onInfoClick }: QuiroModeProps) {
	const { rawOptions, setOptions } = useRecordingOptions();

	return (
		<QuiroModeControl
			mode={rawOptions.mode ?? "studio"}
			onInfoClick={onInfoClick ?? (() => commands.showWindow("ModeSelect"))}
			onModeChange={(mode) => {
				setOptions({ mode });
				commands.setRecordingMode(mode);
			}}
		/>
	);
}
