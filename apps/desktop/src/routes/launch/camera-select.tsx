/** biome-ignore-all lint/correctness/useExhaustiveDependencies: the effects
 * below intentionally re-run only on `value`; refreshCamWinState is a stable
 * local that would otherwise have to be memoised for no behavioural gain. */
import { cn } from "@quiro/ui";
import { useEffect, useState } from "react";
import { Show } from "@/components/Show";
import {
	type CameraInfo,
	commands,
	type DeviceOrModelID,
	type OSPermissionsCheck,
} from "@/utils/tauri";
import IconHeroiconsCog6Tooth from "~icons/heroicons/cog-6-tooth";
import IconLucideEyeOff from "~icons/lucide/eye-off";
import IconCamera from "~icons/quiro/camera";
import useRequestPermission from "./permission-request";
import {
	DEVICE_ROW_CLASS,
	DEVICE_ROW_ICON_CLASS,
	DEVICE_ROW_LABEL_CLASS,
	DEVICE_ROW_TRAILING_CLASS,
	DEVICE_SHORTCUT_BUTTON_CLASS,
	NO_CAMERA,
} from "./style-constants";

export default function CameraSelect({
	disabled,
	value,
	selectedLabel,
	isSelected,
	permissions,
	hidePreviewButton,
	onOpen,
	onOpenSettings,
}: {
	disabled?: boolean;
	options: CameraInfo[];
	value: CameraInfo | null;
	selectedLabel?: string | null;
	isSelected?: boolean;
	onChange: (camera: CameraInfo | null) => void;
	permissions?: OSPermissionsCheck;
	hidePreviewButton?: boolean;
	onOpen?: () => void;
	onOpenSettings?: () => void;
}) {
	const [menu, setMenu] = useState(false);
	const requestPermission = useRequestPermission();

	const refreshCamWinState = async () => {
		try {
			const camWinStateBool = await commands.isCameraWindowOpen();
			setMenu(camWinStateBool);
		} catch {
			setMenu(false);
		}
	};

	useEffect(() => {
		if (value) {
			refreshCamWinState();
		} else {
			setMenu(false);
		}
	}, [value]);

	useEffect(() => {
		if (!value) return;
		const interval = setInterval(() => {
			refreshCamWinState();
		}, 2000);
		return () => clearInterval(interval);
	}, [value]);

	const handleOpenCameraWindow = async (
		e: React.MouseEvent<HTMLButtonElement>,
	) => {
		e.stopPropagation();
		try {
			if (value) {
				const id: DeviceOrModelID = value.model_id
					? { ModelID: value.model_id }
					: { DeviceID: value.device_id };
				await commands.setCameraInput(id, false);
			} else {
				await commands.showWindow({ Camera: { centered: false } });
			}
		} catch (error) {
			console.error("Error opening camera window:", error);
		}

		await refreshCamWinState();
	};

	const permissionsGranted = () =>
		permissions === undefined ||
		permissions.camera === "granted" ||
		permissions.camera === "notNeeded";

	const hasSelection = () => isSelected ?? value !== null;
	const label = () =>
		value?.display_name ??
		(hasSelection() ? selectedLabel : null) ??
		(hasSelection() ? "Camera" : NO_CAMERA);

	const showHiddenIndicator = () =>
		value !== null && permissionsGranted() && !menu && !hidePreviewButton;

	const showSettingsButton = () =>
		hasSelection() && permissionsGranted() && !!onOpenSettings;

	const isDisabled = () => !!disabled;

	return (
		<div className="flex flex-col items-stretch text-gray-10">
			<button
				type="button"
				disabled={isDisabled()}
				onClick={() => {
					if (!permissionsGranted()) {
						requestPermission("camera", permissions?.camera);
						return;
					}

					onOpen?.();
				}}
				className={cn(DEVICE_ROW_CLASS, "KSelect")}
				aria-haspopup="menu"
			>
				<IconCamera className={DEVICE_ROW_ICON_CLASS} />
				<p className={DEVICE_ROW_LABEL_CLASS}>{label()}</p>
				<div className={DEVICE_ROW_TRAILING_CLASS}>
					<Show when={showHiddenIndicator()}>
						<button
							type="button"
							onClick={handleOpenCameraWindow}
							onPointerDown={(e) => e.stopPropagation()}
							className={DEVICE_SHORTCUT_BUTTON_CLASS}
							title="Show camera preview"
							aria-label="Show camera preview"
						>
							<IconLucideEyeOff className="size-3.5" />
						</button>
					</Show>
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
							title="Camera settings"
							aria-label="Camera settings"
						>
							<IconHeroiconsCog6Tooth className="size-3.5" />
						</button>
					</Show>
				</div>
			</button>
		</div>
	);
}
