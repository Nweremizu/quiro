import { cn } from "@quiro/ui";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import useRequestPermission from "@/routes/launch/permission-request";
import { useTauriEventListener } from "@/utils/createEventListner";
import {
	type CameraWithDetails,
	type MicrophoneWithDetails,
	useCameraFormats,
	useMicrophoneFormats,
} from "@/utils/devices";
import {
	type CameraDeviceSettings,
	type DeviceOrModelID,
	events,
	type MicrophoneDeviceSettings,
	type OSPermissionsCheck,
} from "@/utils/tauri";
import IconArrowLeft from "~icons/lucide/arrow-left";
import IconCheck from "~icons/lucide/check";
import IconChevronDown from "~icons/lucide/chevron-down";
import IconCamera from "~icons/quiro/camera";
import IconCameraOff from "~icons/quiro/camera-off";
import IconMic from "~icons/quiro/mic";
import IconMicOff from "~icons/quiro/mic-off";

// Rust's recording_settings.rs::camera_key — device_id is all we get from
// list_cameras (no model_id in this backend), so this is always the
// "device:" branch, but the format must match exactly for the saved
// settings to actually be read back by the recording pipeline.
export function cameraSettingsKey(deviceId: string) {
	return `device:${deviceId}`;
}

function formatCameraSetting(setting: CameraDeviceSettings) {
	const size =
		setting.width && setting.height
			? `${setting.width}×${setting.height}`
			: "Auto";
	const rate = setting.frameRate
		? `${Math.round(setting.frameRate)}fps`
		: "Auto";
	return `${size} @ ${rate}`;
}

function formatMicSetting(setting: MicrophoneDeviceSettings) {
	const rate = setting.sampleRate ? `${setting.sampleRate / 1000}kHz` : "Auto";
	const channels =
		setting.channels === 1
			? "Mono"
			: setting.channels === 2
				? "Stereo"
				: "Auto";
	return `${rate} ${channels}`;
}

// --- Home-view trigger rows -------------------------------------------

export function CameraRow({
	camera,
	disabled,
	onOpen,
}: {
	camera: CameraWithDetails | null;
	disabled?: boolean;
	onOpen: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onOpen}
			className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-gray-5 bg-gray-2 px-3 text-left text-sm text-gray-12 transition-colors hover:border-gray-6 hover:bg-gray-3 disabled:opacity-50"
		>
			<IconCamera className="size-4 shrink-0 text-gray-10" />
			<span className="flex-1 truncate">
				{camera?.display_name ?? "No Camera"}
			</span>
			<IconChevronDown className="size-3.5 shrink-0 text-gray-9" />
		</button>
	);
}

export function MicrophoneRow({
	mic,
	disabled,
	onOpen,
}: {
	mic: MicrophoneWithDetails | null;
	disabled?: boolean;
	onOpen: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onOpen}
			className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-gray-5 bg-gray-2 px-3 text-left text-sm text-gray-12 transition-colors hover:border-gray-6 hover:bg-gray-3 disabled:opacity-50"
		>
			<IconMic className="size-4 shrink-0 text-gray-10" />
			<span className="flex-1 truncate">{mic?.name ?? "No Microphone"}</span>
			<IconChevronDown className="size-3.5 shrink-0 text-gray-9" />
		</button>
	);
}

// --- Shared drill-down panel shell --------------------------------------

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
	return (
		<div className="flex items-center gap-2 pb-2">
			<button
				type="button"
				onClick={onBack}
				className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-gray-11 transition-colors hover:bg-gray-4 hover:text-gray-12"
			>
				<IconArrowLeft className="size-3" />
				Back
			</button>
			<span className="text-xs font-semibold text-gray-12">{title}</span>
		</div>
	);
}

// --- Camera panel --------------------------------------------------------

export function CameraPanel({
	cameras,
	isLoading,
	selectedId,
	onSelect,
	cameraDeviceSettings,
	onSettingsChange,
	permissions,
	onBack,
	searchQuery,
	showHeader = true,
	initialExpandedId = null,
}: {
	cameras: CameraWithDetails[];
	isLoading: boolean;
	selectedId: DeviceOrModelID | null;
	onSelect: (id: DeviceOrModelID | null) => void;
	cameraDeviceSettings: Record<string, CameraDeviceSettings>;
	onSettingsChange: (
		camera: CameraWithDetails,
		settings: CameraDeviceSettings,
	) => void;
	permissions?: OSPermissionsCheck;
	onBack: () => void;
	searchQuery?: string;
	showHeader?: boolean;
	initialExpandedId?: string | null;
}) {
	const [expanded, setExpanded] = useState<string | null>(initialExpandedId);
	const expandedFormats = useCameraFormats(expanded);
	const requestPermission = useRequestPermission();
	const granted =
		permissions === undefined ||
		permissions.camera === "granted" ||
		permissions.camera === "notNeeded";

	const filteredCameras = useMemo(() => {
		const query = searchQuery?.trim().toLowerCase();
		if (!query) return cameras;
		return cameras.filter((c) => c.display_name.toLowerCase().includes(query));
	}, [cameras, searchQuery]);

	const handleSelect = (id: DeviceOrModelID | null) => {
		if (!granted) {
			requestPermission("camera", permissions?.camera);
			return;
		}
		onSelect(id);
	};

	const totalItems = filteredCameras.length + 1;
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [focusedIndex, setFocusedIndex] = useState(() => {
		if (selectedId === null) return 0;
		const idx = filteredCameras.findIndex(
			(c) => "DeviceID" in selectedId && selectedId.DeviceID === c.device_id,
		);
		return idx >= 0 ? idx + 1 : 0;
	});

	useEffect(() => {
		const timeoutId = setTimeout(() => containerRef.current?.focus(), 50);
		return () => clearTimeout(timeoutId);
	}, []);

	useEffect(() => {
		itemRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest" });
	}, [focusedIndex]);

	const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (totalItems === 0) return;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setFocusedIndex((prev) => (prev + 1) % totalItems);
				break;
			case "ArrowUp":
				e.preventDefault();
				setFocusedIndex((prev) => (prev - 1 + totalItems) % totalItems);
				break;
			case "Enter": {
				e.preventDefault();
				if (focusedIndex === 0) handleSelect(null);
				else if (focusedIndex > 0 && focusedIndex <= filteredCameras.length) {
					const camera = filteredCameras[focusedIndex - 1];
					handleSelect({ DeviceID: camera.device_id });
				}
				break;
			}
			case "Home":
				e.preventDefault();
				setFocusedIndex(0);
				break;
			case "End":
				e.preventDefault();
				setFocusedIndex(totalItems - 1);
				break;
		}
	};

	return (
		<div className="flex h-full flex-col">
			{showHeader && <PanelHeader title="Camera" onBack={onBack} />}
			<div className="custom-scroll flex-1 overflow-y-auto">
				{!granted && (
					<p className="px-3 py-4 text-xs text-gray-10">
						Camera access is needed — click any option below to grant it.
					</p>
				)}
				<div
					ref={containerRef}
					className="flex flex-col gap-1 outline-hidden"
					tabIndex={0}
					onKeyDown={handleKeyDown}
				>
					<button
						ref={(el) => {
							itemRefs.current[0] = el;
						}}
						type="button"
						onClick={() => handleSelect(null)}
						className={cn(
							"flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm outline-hidden transition-colors",
							selectedId === null
								? "bg-accent-solid text-accent-on-solid"
								: focusedIndex === 0
									? "bg-gray-5 text-gray-12"
									: "hover:bg-gray-4 text-gray-12",
						)}
					>
						<IconCameraOff className="size-4 shrink-0" />
						<span className="flex-1 truncate">No Camera</span>
						{selectedId === null && <IconCheck className="size-4 shrink-0" />}
					</button>
					{isLoading && (
						<p className="px-3 py-4 text-xs text-gray-10">Loading…</p>
					)}
					{!isLoading && filteredCameras.length === 0 && (
						<p className="px-3 py-4 text-xs text-gray-10">No cameras found</p>
					)}
					{filteredCameras.map((camera, index) => {
						const key = cameraSettingsKey(camera.device_id);
						const selected =
							selectedId !== null &&
							"DeviceID" in selectedId &&
							selectedId.DeviceID === camera.device_id;
						const setting = cameraDeviceSettings[key];
						const isExpanded = expanded === camera.device_id;
						return (
							<div
								key={camera.device_id}
								className="flex flex-col overflow-hidden rounded-lg"
							>
								<div
									className={cn(
										"flex items-stretch text-sm outline-hidden transition-colors",
										selected
											? "bg-accent-solid text-accent-on-solid"
											: focusedIndex === index + 1
												? "bg-gray-5 text-gray-12"
												: "hover:bg-gray-4 text-gray-12",
									)}
								>
									<button
										ref={(el) => {
											itemRefs.current[index + 1] = el;
										}}
										type="button"
										onClick={() => handleSelect({ DeviceID: camera.device_id })}
										className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left"
									>
										<span className="flex items-center gap-2">
											<IconCamera className="size-4 shrink-0" />
											<span className="flex-1 truncate">
												{camera.display_name}
											</span>
											{selected && <IconCheck className="size-4 shrink-0" />}
										</span>
										<span
											className={cn(
												"truncate pl-6 text-[11px]",
												selected ? "text-white/70" : "text-gray-10",
											)}
										>
											{setting
												? formatCameraSetting(setting)
												: "Default format"}
										</span>
									</button>
									<button
										type="button"
										onClick={() =>
											setExpanded(isExpanded ? null : camera.device_id)
										}
										aria-label="Format settings"
										className={cn(
											"flex w-9 shrink-0 items-center justify-center transition-colors",
											selected
												? "text-white/80 hover:bg-white/10"
												: "text-gray-10 hover:bg-gray-5",
										)}
									>
										<IconChevronDown
											className={cn(
												"size-4 transition-transform",
												isExpanded && "rotate-180",
											)}
										/>
									</button>
								</div>
								{isExpanded && (
									<div className="flex flex-col gap-0.5 bg-gray-3 px-2 py-1.5">
										<button
											type="button"
											onClick={() =>
												onSettingsChange(camera, {
													width: null,
													height: null,
													frameRate: null,
												})
											}
											className={cn(
												"rounded-md px-2 py-1.5 text-left text-xs",
												!setting
													? "bg-gray-6 text-gray-12"
													: "text-gray-11 hover:bg-gray-5",
											)}
										>
											Default
										</button>
										{expandedFormats.isLoading && (
											<p className="px-2 py-1.5 text-xs text-gray-10">
												Loading…
											</p>
										)}
										{(expandedFormats.data?.formats ?? []).map((format) => {
											const active =
												setting?.width === format.width &&
												setting?.height === format.height &&
												Math.round(setting?.frameRate ?? 0) ===
													Math.round(format.frameRate);
											return (
												<button
													type="button"
													key={`${format.width}x${format.height}@${format.frameRate}`}
													onClick={() =>
														onSettingsChange(camera, {
															width: format.width,
															height: format.height,
															frameRate: format.frameRate,
														})
													}
													className={cn(
														"rounded-md px-2 py-1.5 text-left text-xs",
														active
															? "bg-gray-6 text-gray-12"
															: "text-gray-11 hover:bg-gray-5",
													)}
												>
													{formatCameraSetting({
														width: format.width,
														height: format.height,
														frameRate: format.frameRate,
													})}
												</button>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

// --- Microphone panel ------------------------------------------------

export function MicrophonePanel({
	microphones,
	isLoading,
	selectedName,
	onSelect,
	microphoneDeviceSettings,
	onSettingsChange,
	permissions,
	onBack,
	searchQuery,
	showHeader = true,
	initialExpandedId = null,
}: {
	microphones: MicrophoneWithDetails[];
	isLoading: boolean;
	selectedName: string | null;
	onSelect: (name: string | null) => void;
	microphoneDeviceSettings: Record<string, MicrophoneDeviceSettings>;
	onSettingsChange: (name: string, settings: MicrophoneDeviceSettings) => void;
	permissions?: OSPermissionsCheck;
	onBack: () => void;
	searchQuery?: string;
	showHeader?: boolean;
	initialExpandedId?: string | null;
}) {
	const [expanded, setExpanded] = useState<string | null>(initialExpandedId);
	const [dbs, setDbs] = useState<number | undefined>();
	const expandedFormats = useMicrophoneFormats(expanded);
	const requestPermission = useRequestPermission();
	const granted =
		permissions === undefined ||
		permissions.microphone === "granted" ||
		permissions.microphone === "notNeeded";

	const filteredMicrophones = useMemo(() => {
		const query = searchQuery?.trim().toLowerCase();
		if (!query) return microphones;
		return microphones.filter((m) => m.name.toLowerCase().includes(query));
	}, [microphones, searchQuery]);

	const handleSelect = (name: string | null) => {
		if (!granted) {
			requestPermission("microphone", permissions?.microphone);
			return;
		}
		onSelect(name);
	};

	useTauriEventListener(events.audioInputLevelChange, (value) => {
		setDbs(selectedName === null ? undefined : value);
	});
	// Rough dB-to-0..1 mapping for the level bar, not a calibrated meter.
	const level =
		dbs === undefined ? undefined : (1 - Math.max(dbs + 40, 0) / 40) ** 0.5;

	const totalItems = filteredMicrophones.length + 1;
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [focusedIndex, setFocusedIndex] = useState(() => {
		if (selectedName === null) return 0;
		const idx = filteredMicrophones.findIndex((m) => m.name === selectedName);
		return idx >= 0 ? idx + 1 : 0;
	});

	useEffect(() => {
		const timeoutId = setTimeout(() => containerRef.current?.focus(), 50);
		return () => clearTimeout(timeoutId);
	}, []);

	useEffect(() => {
		itemRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest" });
	}, [focusedIndex]);

	const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (totalItems === 0) return;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setFocusedIndex((prev) => (prev + 1) % totalItems);
				break;
			case "ArrowUp":
				e.preventDefault();
				setFocusedIndex((prev) => (prev - 1 + totalItems) % totalItems);
				break;
			case "Enter": {
				e.preventDefault();
				if (focusedIndex === 0) handleSelect(null);
				else if (
					focusedIndex > 0 &&
					focusedIndex <= filteredMicrophones.length
				) {
					handleSelect(filteredMicrophones[focusedIndex - 1].name);
				}
				break;
			}
			case "Home":
				e.preventDefault();
				setFocusedIndex(0);
				break;
			case "End":
				e.preventDefault();
				setFocusedIndex(totalItems - 1);
				break;
		}
	};

	return (
		<div className="flex h-full flex-col">
			{showHeader && <PanelHeader title="Microphone" onBack={onBack} />}
			<div className="custom-scroll flex-1 overflow-y-auto">
				{!granted && (
					<p className="px-3 py-4 text-xs text-gray-10">
						Microphone access is needed — click any option below to grant it.
					</p>
				)}
				<div
					ref={containerRef}
					className="flex flex-col gap-1 outline-hidden"
					tabIndex={0}
					onKeyDown={handleKeyDown}
				>
					<button
						ref={(el) => {
							itemRefs.current[0] = el;
						}}
						type="button"
						onClick={() => handleSelect(null)}
						className={cn(
							"flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm outline-hidden transition-colors",
							selectedName === null
								? "bg-accent-solid text-accent-on-solid"
								: focusedIndex === 0
									? "bg-gray-5 text-gray-12"
									: "hover:bg-gray-4 text-gray-12",
						)}
					>
						<IconMicOff className="size-4 shrink-0" />
						<span className="flex-1 truncate">No Microphone</span>
						{selectedName === null && <IconCheck className="size-4 shrink-0" />}
					</button>
					{isLoading && (
						<p className="px-3 py-4 text-xs text-gray-10">Loading…</p>
					)}
					{!isLoading && filteredMicrophones.length === 0 && (
						<p className="px-3 py-4 text-xs text-gray-10">
							No microphones found
						</p>
					)}
					{filteredMicrophones.map((mic, index) => {
						const selected = selectedName === mic.name;
						const setting = microphoneDeviceSettings[mic.name];
						const isExpanded = expanded === mic.name;
						return (
							<div
								key={mic.name}
								className="relative flex flex-col overflow-hidden rounded-lg"
							>
								<div
									className={cn(
										"relative flex items-stretch overflow-hidden text-sm outline-hidden transition-colors",
										selected
											? "bg-accent-solid text-accent-on-solid"
											: focusedIndex === index + 1
												? "bg-gray-5 text-gray-12"
												: "hover:bg-gray-4 text-gray-12",
									)}
								>
									{selected && level !== undefined && (
										<div
											className="absolute inset-y-0 left-0 rounded-lg bg-white/25 transition-[right] duration-100"
											style={{ right: `${level * 100}%` }}
										/>
									)}
									<button
										ref={(el) => {
											itemRefs.current[index + 1] = el;
										}}
										type="button"
										onClick={() => handleSelect(mic.name)}
										className="relative flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left"
									>
										<span className="flex items-center gap-2">
											<IconMic className="size-4 shrink-0" />
											<span className="flex-1 truncate">{mic.name}</span>
											{selected && <IconCheck className="size-4 shrink-0" />}
										</span>
										<span
											className={cn(
												"truncate pl-6 text-[11px]",
												selected ? "text-white/70" : "text-gray-10",
											)}
										>
											{setting ? formatMicSetting(setting) : "Default format"}
										</span>
									</button>
									<button
										type="button"
										onClick={() => setExpanded(isExpanded ? null : mic.name)}
										aria-label="Format settings"
										className={cn(
											"relative flex w-9 shrink-0 items-center justify-center transition-colors",
											selected
												? "text-white/80 hover:bg-white/10"
												: "text-gray-10 hover:bg-gray-5",
										)}
									>
										<IconChevronDown
											className={cn(
												"size-4 transition-transform",
												isExpanded && "rotate-180",
											)}
										/>
									</button>
								</div>
								{isExpanded && (
									<div className="flex flex-col gap-0.5 bg-gray-3 px-2 py-1.5">
										<button
											type="button"
											onClick={() =>
												onSettingsChange(mic.name, {
													sampleRate: null,
													channels: null,
												})
											}
											className={cn(
												"rounded-md px-2 py-1.5 text-left text-xs",
												!setting
													? "bg-gray-6 text-gray-12"
													: "text-gray-11 hover:bg-gray-5",
											)}
										>
											Default
										</button>
										{expandedFormats.isLoading && (
											<p className="px-2 py-1.5 text-xs text-gray-10">
												Loading…
											</p>
										)}
										{(expandedFormats.data?.formats ?? []).map((format) => {
											const active =
												setting?.sampleRate === format.sampleRate &&
												setting?.channels === format.channels;
											return (
												<button
													type="button"
													key={`${format.sampleRate}x${format.channels}`}
													onClick={() => onSettingsChange(mic.name, format)}
													className={cn(
														"rounded-md px-2 py-1.5 text-left text-xs",
														active
															? "bg-gray-6 text-gray-12"
															: "text-gray-11 hover:bg-gray-5",
													)}
												>
													{formatMicSetting(format)}
												</button>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
