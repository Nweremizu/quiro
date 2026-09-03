import { cn } from "@quiro/ui";
import { useState } from "react";
import { Show } from "@/components/Show";
import { useTauriEventListener } from "@/utils/createEventListner";
import { events, type OSPermissionsCheck } from "@/utils/tauri";
import IconHeroiconsCog6Tooth from "~icons/heroicons/cog-6-tooth";
import IconMic from "~icons/quiro/mic";
import useRequestPermission from "./permission-request";
import {
	DEVICE_ROW_CLASS,
	DEVICE_ROW_ICON_CLASS,
	DEVICE_ROW_LABEL_CLASS,
	DEVICE_ROW_TRAILING_CLASS,
	DEVICE_SHORTCUT_BUTTON_CLASS,
	NO_MICROPHONE,
} from "./style-constants";

const DB_SCALE = 40;

export default function MicrophoneSelect({
	disabled,
	value,
	permissions,
	onOpen,
	onOpenSettings,
}: {
	disabled?: boolean;
	value: string | null;
	permissions?: OSPermissionsCheck;
	onOpen?: () => void;
	onOpenSettings?: () => void;
}) {
	const requestPermission = useRequestPermission();
	const [dbs, setDbs] = useState<number | undefined>();

	useTauriEventListener(events.audioInputLevelChange, (payload) => {
		setDbs(value === null ? undefined : payload);
	});

	const permissionsGranted = () =>
		permissions === undefined ||
		permissions.microphone === "granted" ||
		permissions.microphone === "notNeeded";

	const audioLevel = () =>
		(1 - Math.max((dbs ?? 0) + DB_SCALE, 0) / DB_SCALE) ** 0.5;

	const showLevel = value !== null && dbs !== undefined;

	const showSettingsButton = () =>
		value !== null && permissionsGranted() && !!onOpenSettings;

	const isDisabled = () => !!disabled;

	return (
		<div className="flex flex-col items-stretch text-gray-10">
			<button
				type="button"
				disabled={isDisabled()}
				onClick={() => {
					if (!permissionsGranted()) {
						requestPermission("microphone", permissions?.microphone);
						return;
					}

					onOpen?.();
				}}
				className={cn(DEVICE_ROW_CLASS, "KSelect")}
				aria-haspopup="menu"
			>
				<Show when={showLevel}>
					<div
						className="absolute inset-y-0 left-0 -z-10 pointer-events-none bg-accent-solid/10 transition-[right] duration-100"
						style={{ right: `${audioLevel() * 100}%` }}
					/>
					<div
						className="absolute bottom-0 left-0 h-[2px] -z-10 pointer-events-none bg-accent-solid transition-[right] duration-100"
						style={{ right: `${audioLevel() * 100}%` }}
					/>
				</Show>
				<IconMic className={DEVICE_ROW_ICON_CLASS} />
				<p className={DEVICE_ROW_LABEL_CLASS}>{value ?? NO_MICROPHONE}</p>
				<div className={DEVICE_ROW_TRAILING_CLASS}>
					<Show when={showSettingsButton()}>
						<button
							type="button"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								onOpenSettings?.();
							}}
							onPointerDown={(e) => e.stopPropagation()}
							className={DEVICE_SHORTCUT_BUTTON_CLASS}
							title="Microphone settings"
							aria-label="Microphone settings"
						>
							<IconHeroiconsCog6Tooth className="size-3.5" />
						</button>
					</Show>
				</div>
			</button>
		</div>
	);
}
