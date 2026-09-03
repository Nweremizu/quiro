import { cn } from "@quiro/ui";
import { useQuery } from "@tanstack/react-query";
import { isSystemAudioSupported } from "@/utils/queries";
import IconMonitor from "~icons/quiro/monitor";
import {
	DEVICE_ROW_CLASS,
	DEVICE_ROW_ICON_CLASS,
	DEVICE_ROW_LABEL_CLASS,
	DEVICE_ROW_TRAILING_CLASS,
} from "./style-constants";

export default function SystemAudio({
	enabled,
	onChange,
	disabled,
}: {
	enabled: boolean;
	onChange: (enabled: boolean) => void;
	disabled?: boolean;
}) {
	const supported = useQuery(isSystemAudioSupported);
	const isDisabled = !!disabled || supported.data === false;

	return (
		<button
			type="button"
			disabled={isDisabled}
			title={
				supported.data === false
					? "System audio capture isn't supported on this device"
					: undefined
			}
			onClick={() => onChange(!enabled)}
			className={cn(DEVICE_ROW_CLASS, "KSelect")}
			aria-pressed={enabled}
		>
			<IconMonitor className={DEVICE_ROW_ICON_CLASS} />
			<p className={DEVICE_ROW_LABEL_CLASS}>
				{enabled ? "Record System Audio" : "No System Audio"}
			</p>
			<div className={DEVICE_ROW_TRAILING_CLASS}>
				<span
					className={cn(
						"flex h-5 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide",
						enabled
							? "bg-accent-solid text-accent-on-solid"
							: "bg-gray-5 text-gray-10",
					)}
				>
					{enabled ? "On" : "Off"}
				</span>
			</div>
		</button>
	);
}
