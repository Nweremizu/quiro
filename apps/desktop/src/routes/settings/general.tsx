import { Button, cn, Select } from "@quiro/ui";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { open } from "@tauri-apps/plugin-dialog";
import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";
import { useState } from "react";
import { generalSettingsStore } from "@/store";
import {
	type AppTheme,
	commands,
	type StudioRecordingQuality,
	type WindowExclusion,
} from "@/utils/tauri";
import IconLucideMonitor from "~icons/lucide/monitor";
import IconLucideMoon from "~icons/lucide/moon";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideSun from "~icons/lucide/sun";
import IconLucideX from "~icons/lucide/x";
import {
	Section,
	SectionCard,
	SettingItem,
	ToggleSettingItem,
} from "./Setting";

const THEME_OPTIONS = [
	{ id: "system" as const, name: "System", icon: IconLucideMonitor },
	{ id: "light" as const, name: "Light", icon: IconLucideSun },
	{ id: "dark" as const, name: "Dark", icon: IconLucideMoon },
];

const QUALITY_OPTIONS = [
	{ value: "compatibility", label: "Compatibility" },
	{ value: "balanced", label: "Balanced" },
	{ value: "ultra", label: "Ultra" },
];

const COUNTDOWN_OPTIONS = [
	{ value: "0", label: "Off" },
	{ value: "3", label: "3 seconds" },
	{ value: "5", label: "5 seconds" },
	{ value: "10", label: "10 seconds" },
];

const MAX_FPS_OPTIONS = [
	{ value: "24", label: "24 FPS" },
	{ value: "25", label: "25 FPS" },
	{ value: "30", label: "30 FPS" },
	{ value: "60", label: "60 FPS (Recommended)" },
	{ value: "120", label: "120 FPS" },
];

const getExclusionPrimaryLabel = (entry: WindowExclusion) =>
	entry.ownerName ?? entry.windowTitle ?? entry.bundleIdentifier ?? "Unknown";

const getExclusionSecondaryLabel = (entry: WindowExclusion) => {
	if (entry.ownerName && entry.windowTitle) return entry.windowTitle;
	if (entry.bundleIdentifier && (entry.ownerName || entry.windowTitle)) {
		return entry.bundleIdentifier;
	}
	return entry.bundleIdentifier ?? null;
};

export default function GeneralSettings() {
	const query = generalSettingsStore.useQuery();
	const settings = query.data;
	const [excludedWindowsBusy, setExcludedWindowsBusy] = useState(false);

	const update = (patch: Parameters<typeof generalSettingsStore.set>[0]) =>
		void generalSettingsStore.set(patch);

	const handleThemeChange = async (theme: AppTheme) => {
		await generalSettingsStore.set({ theme });
		await commands.setTheme(theme).catch((error) => {
			console.error("Failed to apply theme to this window:", error);
		});
	};

	const handleChooseFolder = async () => {
		const selected = await open({ directory: true, multiple: false });
		if (typeof selected === "string") {
			update({ recordingsPath: selected });
		}
	};

	const handleAddExcludedWindow = async (event: React.MouseEvent) => {
		event.preventDefault();
		if (excludedWindowsBusy) return;

		setExcludedWindowsBusy(true);
		try {
			const windows = await commands.listCaptureWindows();
			if (windows.length === 0) return;

			const items = await Promise.all(
				windows.map((win) =>
					MenuItem.new({
						text: [
							win.owner_name,
							win.name !== win.owner_name ? win.name : null,
						]
							.filter(Boolean)
							.join(" • "),
						action: () => {
							const current = settings?.excludedWindows ?? [];
							update({
								excludedWindows: [
									...current,
									{
										ownerName: win.owner_name,
										windowTitle: win.name,
										bundleIdentifier: win.bundle_identifier,
									},
								],
							});
						},
					}),
				),
			);
			const menu = await Menu.new({ items });
			await menu.popup();
		} catch (error) {
			console.error("Failed to list windows to exclude:", error);
		} finally {
			setExcludedWindowsBusy(false);
		}
	};

	const handleRemoveExcludedWindow = (index: number) => {
		const current = settings?.excludedWindows ?? [];
		update({ excludedWindows: current.filter((_, i) => i !== index) });
	};

	const handleResetExcludedWindows = async () => {
		const defaults = await commands.getDefaultExcludedWindows();
		update({ excludedWindows: defaults });
	};

	const excludedWindows = settings?.excludedWindows ?? [];

	return (
		<div className="custom-scroll h-full flex-1 overflow-y-auto">
			<div className="max-w-[42rem] space-y-7 px-6 py-6">
				<Section
					title="Appearance"
					description="Match Quiro to your system theme or pick a fixed look."
				>
					<SectionCard padded>
						<div className="grid grid-cols-3 gap-3">
							{THEME_OPTIONS.map((theme) => {
								const isSelected = (settings?.theme ?? "system") === theme.id;
								return (
									<button
										key={theme.id}
										type="button"
										aria-pressed={isSelected}
										onClick={() => void handleThemeChange(theme.id)}
										className={cn(
											"flex flex-col items-center gap-2 rounded-lg border-2 py-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-1",
											isSelected
												? "border-accent-300 bg-accent-100/40"
												: "border-gray-4 hover:border-gray-6",
										)}
									>
										<theme.icon
											className={cn(
												"size-5",
												isSelected ? "text-accent-400" : "text-gray-10",
											)}
										/>
										<span
											className={cn(
												"text-xs font-medium",
												isSelected ? "text-gray-12" : "text-gray-10",
											)}
										>
											{theme.name}
										</span>
									</button>
								);
							})}
						</div>
					</SectionCard>
				</Section>

				<Section
					title="Notifications"
					description="Get notified about screenshots, recording issues, and reconnected devices — even while Quiro's window is hidden."
				>
					<SectionCard className="divide-y divide-gray-3">
						<ToggleSettingItem
							label="System notifications"
							description="Shown through your OS, not Quiro. You may need to allow Quiro in your system's notification settings."
							value={settings?.enableNotifications ?? true}
							onChange={async (value) => {
								if (value && !(await isPermissionGranted())) {
									if ((await requestPermission()) !== "granted") return;
								}
								update({ enableNotifications: value });
							}}
						/>
					</SectionCard>
				</Section>

				<Section title="Recording">
					<SectionCard className="divide-y divide-gray-3">
						<SettingItem
							label="Countdown before recording"
							description="Wait before capture starts, so you have a moment to get ready."
						>
							<Select
								variant="light"
								className="w-40"
								options={COUNTDOWN_OPTIONS}
								value={String(settings?.recordingCountdown ?? 3)}
								onValueChange={(value) =>
									update({ recordingCountdown: Number(value) })
								}
							/>
						</SettingItem>
						<ToggleSettingItem
							label="Custom cursor capture"
							description="Render the cursor as a separate, editable layer instead of baking it into the video."
							value={settings?.custom_cursor_capture2 ?? true}
							onChange={(v) => update({ custom_cursor_capture2: v })}
						/>
						<ToggleSettingItem
							label="Capture keyboard events"
							description="Record key presses alongside the video, for a teleprompter-style keystroke overlay."
							value={settings?.captureKeyboardEvents ?? true}
							onChange={(v) => update({ captureKeyboardEvents: v })}
						/>
						<ToggleSettingItem
							label="Out-of-process muxer"
							description="Encode in a separate helper process instead of inline. Steadier under load; only turn off if recordings are failing to start."
							value={settings?.outOfProcessMuxer ?? false}
							onChange={(v) => update({ outOfProcessMuxer: v })}
						/>
						<ToggleSettingItem
							label="Window transparency"
							description="Allow Quiro's own windows to use a translucent background."
							value={settings?.windowTransparency ?? false}
							onChange={(v) => update({ windowTransparency: v })}
						/>
					</SectionCard>
				</Section>

				<Section
					title="Quality"
					description="Higher quality and frame rate produce larger recordings."
				>
					<SectionCard className="divide-y divide-gray-3">
						<SettingItem label="Studio recording quality">
							<Select
								variant="light"
								className="w-40"
								options={QUALITY_OPTIONS}
								value={settings?.studioRecordingQuality ?? "balanced"}
								onValueChange={(value) =>
									update({
										studioRecordingQuality: value as StudioRecordingQuality,
									})
								}
							/>
						</SettingItem>
						<SettingItem label="Max frame rate">
							<Select
								variant="light"
								className="w-48"
								options={MAX_FPS_OPTIONS}
								value={String(settings?.maxFps ?? 60)}
								onValueChange={(value) => update({ maxFps: Number(value) })}
							/>
						</SettingItem>
					</SectionCard>
				</Section>

				<Section
					title="Storage"
					description="Where Quiro saves your recordings."
				>
					<SectionCard padded>
						<div className="flex items-center justify-between gap-3">
							<p className="min-w-0 flex-1 truncate text-xs text-gray-11">
								{settings?.recordingsPath ?? "Default location"}
							</p>
							<div className="flex shrink-0 gap-2">
								{settings?.recordingsPath && (
									<Button
										variant="gray"
										size="sm"
										onClick={() => update({ recordingsPath: null })}
									>
										Reset
									</Button>
								)}
								<Button
									variant="dark"
									size="sm"
									onClick={() => void handleChooseFolder()}
								>
									Choose Folder
								</Button>
							</div>
						</div>
					</SectionCard>
				</Section>

				<Section
					title="Excluded windows"
					description="Hide windows from your recordings — Quiro's own windows are excluded by default."
					right={
						<>
							<Button
								variant="gray"
								size="sm"
								disabled={excludedWindowsBusy}
								onClick={() => void handleResetExcludedWindows()}
							>
								Reset
							</Button>
							<Button
								variant="dark"
								size="sm"
								disabled={excludedWindowsBusy}
								onClick={(e) => void handleAddExcludedWindow(e)}
								className="flex items-center gap-1.5"
							>
								<IconLucidePlus className="size-3.5" />
								Add
							</Button>
						</>
					}
				>
					<SectionCard padded>
						{excludedWindows.length === 0 ? (
							<p className="text-xs text-gray-10">
								No windows are currently excluded.
							</p>
						) : (
							<div className="flex flex-wrap gap-2">
								{excludedWindows.map((entry, index) => {
									const secondary = getExclusionSecondaryLabel(entry);
									return (
										<div
											key={`${entry.ownerName ?? ""}-${entry.windowTitle ?? ""}-${entry.bundleIdentifier ?? ""}`}
											className="flex items-center gap-2 rounded-full border border-gray-4 bg-gray-3 py-1.5 pl-3 pr-1"
										>
											<div className="flex flex-col leading-tight">
												<span className="text-xs text-gray-12">
													{getExclusionPrimaryLabel(entry)}
												</span>
												{secondary && (
													<span className="text-[10px] text-gray-9">
														{secondary}
													</span>
												)}
											</div>
											<button
												type="button"
												onClick={() => handleRemoveExcludedWindow(index)}
												aria-label="Remove excluded window"
												className="flex size-5 items-center justify-center rounded-full text-gray-10 transition-colors hover:bg-gray-5 hover:text-gray-12"
											>
												<IconLucideX className="size-3" />
											</button>
										</div>
									);
								})}
							</div>
						)}
					</SectionCard>
				</Section>
			</div>
		</div>
	);
}
