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

export function QuiroMode({ onInfoClick }: QuiroModeProps) {
	const { rawOptions, setOptions } = useRecordingOptions();

	const handleInfoClick = () => {
		if (onInfoClick) {
			onInfoClick();
		} else {
			commands.showWindow("ModeSelect");
		}
	};

	return (
		<div className="flex relative gap-2 items-center p-1.5 rounded-full border border-gray-5 bg-gray-3 w-fit">
			{/* <button
				type="button"
				onClick={handleInfoClick}
				className="absolute -left-1.5 -top-2 p-1 rounded-full w-fit bg-gray-5 group focus:outline-none"
				aria-label="Recording mode info"
			>
				<IconLucideInfo className="invert transition-opacity duration-200 size-2.5 dark:invert-0 group-hover:opacity-50" />
			</button> */}
			{QUIRO_MODE_BUTTONS.map((buttonConfig) => {
				const isSelected = rawOptions.mode === buttonConfig.mode;
				const Icon = buttonConfig.icon;
				const settingsSection = buttonConfig.settingsSection;

				return (
					<HoverCard.Root key={buttonConfig.mode}>
						<HoverCard.Trigger
							delay={20}
							closeDelay={50}
							// render={() => (

							// )}
						>
							<button
								type="button"
								onClick={() => {
									setOptions({ mode: buttonConfig.mode });
									commands.setRecordingMode(buttonConfig.mode);
								}}
								className={cn(
									"relative flex justify-center items-center rounded-full transition-all duration-200 size-7 focus:outline-none",
									isSelected
										? "ring-2 ring-offset-1 ring-offset-gray-1 bg-gray-7 hover:bg-gray-7 ring-accent-border-selected"
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
								className="isolate z-50 "
							>
								<HoverCard.Popup
									data-slot="hover-card-content"
									className={cn(
										"z-50 outline-none animate-in fade-in slide-in-from-top-1 duration-100",
									)}
								>
									<div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg border shadow-lg bg-gray-12 text-gray-1 border-gray-3 min-w-[12rem] max-w-[15rem]">
										<div className="flex flex-col gap-0.5">
											<span className="text-xs font-medium">
												{buttonConfig.label}
											</span>
											<span className="text-[10px] text-gray-4 leading-snug">
												{buttonConfig.description}
											</span>
										</div>
										{settingsSection && (
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													// void openQualitySettings(settingsSection);
												}}
												className="flex gap-1.5 items-center px-2 py-1 -mx-1 text-[11px] rounded-md transition-colors text-gray-4 hover:bg-gray-11 hover:text-gray-1"
											>
												{/* <IconCapSettings className="size-3" /> */}
												<IconHeroiconsCog6Tooth className="size-3" />
												<span>Quality settings</span>
											</button>
										)}
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
