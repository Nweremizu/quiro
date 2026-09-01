import { cn, toast } from "@quiro/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
	currentMonitor,
	getCurrentWindow,
	LogicalSize,
	PhysicalPosition,
} from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cameraSettingsKey } from "@/components/DeviceMenu";
import {
	mergeRecentMedia,
	openMediaFile,
	Recents,
} from "@/components/LibraryMenu";
import { Show } from "@/components/Show";
import { Tooltip } from "@/components/Tooltip";
import { mainWindowUIStore, recordingSettingsStore } from "@/store";
import { useTauriEventListener } from "@/utils/createEventListner";
import {
	type CameraWithDetails,
	type MicrophoneWithDetails,
	useStableDevicesQuery,
} from "@/utils/devices";
import {
	createCameraMutation,
	listDisplaysWithThumbnails,
	listRecordingsQuery,
	listScreens,
	listScreenshotsQuery,
	listWindows,
	listWindowsWithThumbnails,
	permissionsQuery,
} from "@/utils/queries";
import {
	type CameraDeviceSettings,
	type CaptureDisplay,
	type CaptureWindow,
	commands,
	type DeviceOrModelID,
	events,
	type MicrophoneDeviceSettings,
	type ScreenCaptureTarget,
} from "@/utils/tauri";
import IconLucideBug from "~icons/lucide/bug";
import IconLucideCircleHelp from "~icons/lucide/circle-help";
import IconLucideMaximize2 from "~icons/lucide/maximize-2";
import IconLucideMinimize2 from "~icons/lucide/minimize-2";
import IconLucideSettings from "~icons/lucide/settings";
import IconQuiroLogo from "~icons/quiro/logo";
import IconMonitor from "~icons/quiro/monitor";
import IconWindow from "~icons/quiro/window";
import CaptureSourcePanel from "./CaptureSourcePanel";
import { WindowChromeHeader } from "./Context";
import CameraSelect from "./camera-select";
import MenuDropdownButton from "./menu-dropdown-button";
import MenuSelectionButton from "./menu-selection-button";
import MicrophoneSelect from "./microphone-select";
import {
	RecordingOptionsProvider,
	useRecordingOptions,
} from "./options-context";
import { QuiroMode } from "./quiro-mode";
import SystemAudio from "./system-audio";

// `new WebviewWindow(label, ...)` throws if a window with that label
// already exists — e.g. a leftover from a previous click whose window never
// got destroyed properly. Reuse it instead of failing silently on every
// click after the first.
async function openDebugWindow() {
	try {
		const existing = await WebviewWindow.getByLabel("debug");
		if (existing) {
			await existing.show();
			await existing.setFocus();
			return;
		}

		const win = new WebviewWindow("debug", {
			url: "/debug",
			title: "Quiro Debug",
		});
		win.once("tauri://error", (event) => {
			console.error("Failed to create debug window:", event);
			toast.error("Failed to open debug window");
		});
	} catch (error) {
		console.error("Failed to open debug window:", error);
		toast.error("Failed to open debug window");
	}
}

const MAIN_WINDOW_SIZE = {
	compact: { width: 330, height: 395 },
	expanded: { width: 600, height: 660 },
} as const;
const MAIN_WINDOW_SCREEN_PADDING = 16;
const MAIN_WINDOW_RESIZE_DURATION = 200; // ms
const CAPTURE_LIST_STALE_TIME = 5_000; // this is the time after which the capture list is considered stale and will be refreshed - 5 seconds
const CAPTURE_LIST_GC_TIME = 60_000; // this is the time after which the capture list will be garbage collected and removed from memory - 60 seconds
const CAPTURE_THUMBNAIL_STALE_TIME = 10_000; // this is the time after which the capture thumbnail is considered stale and will be refreshed - 10 seconds
const CAPTURE_THUMBNAIL_GC_TIME = 60_000; // this is the time after which the capture thumbnail will be garbage collected and removed from memory - 60 seconds

const findCamera = (cameras: CameraWithDetails[], id: DeviceOrModelID) => {
	return cameras.find((c) => {
		if (!id) return false;
		return "DeviceID" in id
			? id.DeviceID === c.device_id
			: id.ModelID === c.model_id;
	});
};

type RecordingsDeviceSettingsStore = {
	cameraDeviceSettings?: Record<string, CameraDeviceSettings>;
	microphoneDeviceSettings?: Record<string, MicrophoneDeviceSettings>;
};

const recordingDeviceSettingsStore = recordingSettingsStore as unknown as {
	get: () => Promise<RecordingsDeviceSettingsStore | undefined>;
	set: (value?: Partial<RecordingsDeviceSettingsStore>) => Promise<void>;
	useQuery: () => { data: RecordingsDeviceSettingsStore | undefined };
};

const nextAnimationFrame = () =>
	new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const clamp = (value: number, minimum: number, maximum: number) =>
	Math.min(Math.max(value, minimum), maximum);

async function resizeMainWindow(expanded: boolean, animate: boolean) {
	const currentWindow = getCurrentWindow();
	const [physicalSize, outerSize, scaleFactor, physicalPosition, monitor] =
		await Promise.all([
			currentWindow.innerSize(),
			currentWindow.outerSize(),
			currentWindow.scaleFactor(),
			currentWindow.outerPosition().catch(() => null),
			currentMonitor().catch(() => null),
		]);
	const frameWidth = Math.max(
		0,
		(outerSize.width - physicalSize.width) / scaleFactor,
	);
	const frameHeight = Math.max(
		0,
		(outerSize.height - physicalSize.height) / scaleFactor,
	);
	const preferredSize = expanded
		? MAIN_WINDOW_SIZE.expanded
		: MAIN_WINDOW_SIZE.compact;
	const availableWidth = monitor
		? monitor.workArea.size.width / scaleFactor -
			frameWidth -
			MAIN_WINDOW_SCREEN_PADDING * 2
		: preferredSize.width;
	const availableHeight = monitor
		? monitor.workArea.size.height / scaleFactor -
			frameHeight -
			MAIN_WINDOW_SCREEN_PADDING * 2
		: preferredSize.height;
	const targetWidth = Math.max(
		MAIN_WINDOW_SIZE.compact.width,
		Math.min(preferredSize.width, availableWidth),
	);
	const targetHeight = Math.max(
		MAIN_WINDOW_SIZE.compact.height,
		Math.min(preferredSize.height, availableHeight),
	);
	const startWidth = physicalSize.width / scaleFactor;
	const startHeight = physicalSize.height / scaleFactor;
	const widthDelta = targetWidth - startWidth;
	const heightDelta = targetHeight - startHeight;
	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	if (monitor && physicalPosition) {
		const padding = MAIN_WINDOW_SCREEN_PADDING * scaleFactor;
		const workArea = monitor.workArea;
		const targetPhysicalWidth = (targetWidth + frameWidth) * scaleFactor;
		const targetPhysicalHeight = (targetHeight + frameHeight) * scaleFactor;
		const minimumX = workArea.position.x + padding;
		const minimumY = workArea.position.y + padding;
		const maximumX = Math.max(
			minimumX,
			workArea.position.x + workArea.size.width - targetPhysicalWidth - padding,
		);
		const maximumY = Math.max(
			minimumY,
			workArea.position.y +
				workArea.size.height -
				targetPhysicalHeight -
				padding,
		);
		const targetX = clamp(physicalPosition.x, minimumX, maximumX);
		const targetY = clamp(physicalPosition.y, minimumY, maximumY);
		if (targetX !== physicalPosition.x || targetY !== physicalPosition.y) {
			await currentWindow
				.setPosition(
					new PhysicalPosition(Math.round(targetX), Math.round(targetY)),
				)
				.catch(() => undefined);
		}
	}
	if (Math.abs(widthDelta) > 0.5 || Math.abs(heightDelta) > 0.5) {
		if (!animate || reduceMotion) {
			await currentWindow.setSize(new LogicalSize(targetWidth, targetHeight));
		} else {
			let pendingSize: LogicalSize | undefined;
			let resizeWorker: Promise<void> | undefined;
			let resizeError: unknown;
			let resizeFailed = false;
			const scheduleResize = (size: LogicalSize) => {
				if (resizeFailed) return;
				pendingSize = size;
				if (resizeWorker) return;
				resizeWorker = (async () => {
					while (pendingSize) {
						const nextSize = pendingSize;
						pendingSize = undefined;
						await currentWindow.setSize(nextSize);
					}
				})()
					.catch((error) => {
						resizeFailed = true;
						resizeError = error;
						pendingSize = undefined;
					})
					.finally(() => {
						resizeWorker = undefined;
					});
			};
			const startedAt = performance.now();
			let progress = 0;
			while (progress < 1) {
				await nextAnimationFrame();
				progress = Math.min(
					1,
					(performance.now() - startedAt) / MAIN_WINDOW_RESIZE_DURATION,
				);
				const eased = 1 - (1 - progress) ** 3;
				scheduleResize(
					new LogicalSize(
						startWidth + widthDelta * eased,
						startHeight + heightDelta * eased,
					),
				);
			}
			await resizeWorker;
			if (resizeFailed) throw resizeError;
		}
	}
}

type IdleWindow = typeof window & {
	requestIdleCallback?: (
		callback: IdleRequestCallback,
		options?: IdleRequestOptions,
	) => number;
	cancelIdleCallback?: (handle: number) => void;
};

function MainWindowHelpButton() {
	return (
		<Tooltip content={<span>Help</span>}>
			<button
				type="button"
				// onClick={() => {
				// 	commands.showWindow("Onboarding");
				// }}
				className="flex shrink-0 justify-center items-center size-5 focus:outline-hidden"
			>
				<IconLucideCircleHelp className="transition-colors text-gray-11 size-4 hover:text-gray-12" />
			</button>
		</Tooltip>
	);
}

export default function LaunchRoute() {
	return (
		<RecordingOptionsProvider>
			<LaunchRoutePage />
		</RecordingOptionsProvider>
	);
}

export function LaunchRoutePage() {
	const queryClient = useQueryClient();
	const [isExpanded, setIsExpanded] = useState(false);
	const { rawOptions, setOptions } = useRecordingOptions();

	const [isWindowResizing, setIsWindowResizing] = useState(false);

	const isExpandedRef = useRef(isExpanded); // Ref to track the current value of isExpanded
	isExpandedRef.current = isExpanded;
	const isWindowResizingRef = useRef(isWindowResizing); // Ref to track the current value of isWindowResizing
	isWindowResizingRef.current = isWindowResizing;

	const recordingSettingsQuery = recordingDeviceSettingsStore.useQuery();

	const toggleMainWindowExpanded = async () => {
		if (isWindowResizing) return;
		const previousExpanded = isExpanded;
		const expanded = !previousExpanded;
		setIsWindowResizing(true);
		if (!expanded) setIsExpanded(false);
		try {
			await resizeMainWindow(expanded, true);
			if (expanded) setIsExpanded(true);
			void mainWindowUIStore.set({ expanded }).catch((error) => {
				console.error("Failed to save main window size:", error);
			});
		} catch (error) {
			setIsExpanded(previousExpanded);
			console.error("Failed to resize main window:", error);
		} finally {
			setIsWindowResizing(false);
		}
	};

	const cancelScheduledTargetListPrewarmRef = useRef<(() => void) | undefined>(
		undefined,
	);
	useEffect(() => {
		return () => cancelScheduledTargetListPrewarmRef.current?.();
	}, []);

	const handleMouseEnter = () => {
		// Only actually call setFocus() when the window isn't already focused —
		// this fires on every hover of the window edge, and repeated native
		// focus/activation calls on this undecorated, always-on-top popup
		// window are what was causing the cursor to visibly flicker.
		const window = getCurrentWindow();
		window.isFocused().then((focused) => {
			if (!focused) window.setFocus();
		});
		scheduleTargetListPrewarm();
	};

	// to prefetch the target list when the user hovers over the main window,
	// we can use a timeout to delay the prefetching so that it doesn't happen immediately on mouse enter
	const scheduleTargetListPrewarm = () => {
		cancelScheduledTargetListPrewarmRef.current?.();
		let cancelled = false;
		let timeoutId: number | undefined;
		let idleId: number | undefined;
		const idleWindow = window as IdleWindow;
		const prewarm = async () => {
			await Promise.all([
				queryClient.query({
					...listScreens,
					staleTime: CAPTURE_LIST_STALE_TIME,
					gcTime: CAPTURE_LIST_GC_TIME,
				}),
				queryClient.query({
					...listWindows,
					staleTime: CAPTURE_LIST_STALE_TIME,
					gcTime: CAPTURE_LIST_GC_TIME,
				}),
			]).catch((error) => {
				console.error("Failed to prewarm capture lists:", error);
			});
			if (cancelled) return;
			await queryClient
				.query({
					...listDisplaysWithThumbnails,
					staleTime: CAPTURE_THUMBNAIL_STALE_TIME,
					gcTime: CAPTURE_THUMBNAIL_GC_TIME,
				})
				.catch((error) => {
					console.error("Failed to prewarm display thumbnails:", error);
				});
			if (cancelled) return;
			await queryClient
				.query({
					...listWindowsWithThumbnails,
					staleTime: CAPTURE_THUMBNAIL_STALE_TIME,
					gcTime: CAPTURE_THUMBNAIL_GC_TIME,
				})
				.catch((error) => {
					console.error("Failed to prewarm window thumbnails:", error);
				});
		};

		const run = () => {
			timeoutId = undefined;
			idleId = undefined;
			cancelScheduledTargetListPrewarmRef.current = undefined;
			if (cancelled) return;
			void prewarm();
		};
		if (idleWindow.requestIdleCallback) {
			idleId = idleWindow.requestIdleCallback(run, { timeout: 2000 });
		} else {
			timeoutId = window.setTimeout(run, 250);
		}
		cancelScheduledTargetListPrewarmRef.current = () => {
			cancelled = true;
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
			if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
		};
	};

	const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
	const [windowMenuOpen, setWindowMenuOpen] = useState(false);
	const [recordingsMenuOpen, setRecordingsMenuOpen] = useState(false);
	const [screenshotsMenuOpen, setScreenshotsMenuOpen] = useState(false);
	const [modeInfoMenuOpen, setModeInfoMenuOpen] = useState(false);
	const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
	const [microphoneMenuOpen, setMicrophoneMenuOpen] = useState(false);
	const [cameraInitialSettings, setCameraInitialSettings] =
		useState<CameraWithDetails | null>(null);
	const [openCameraSettingsWhenReady, setOpenCameraSettingsWhenReady] =
		useState(false);
	const [microphoneInitialSettings, setMicrophoneInitialSettings] =
		useState<MicrophoneWithDetails | null>(null);
	const [openMicSettingsWhenReady, setOpenMicSettingsWhenReady] =
		useState(false);
	const [enableDeviceQueries, setEnableDeviceQueries] = useState(false);
	const enableCaptureLists = displayMenuOpen || windowMenuOpen;

	const activeMenu:
		| "display"
		| "window"
		| "recording"
		| "screenshot"
		| "modeInfo"
		| "camera"
		| "microphone"
		| null = displayMenuOpen
		? "display"
		: windowMenuOpen
			? "window"
			: recordingsMenuOpen
				? "recording"
				: screenshotsMenuOpen
					? "screenshot"
					: modeInfoMenuOpen
						? "modeInfo"
						: cameraMenuOpen
							? "camera"
							: microphoneMenuOpen
								? "microphone"
								: null;

	const showRecents = isExpanded && activeMenu === null;

	const setCamera = createCameraMutation();
	const devices = useStableDevicesQuery(enableDeviceQueries);
	const permissions = useQuery(permissionsQuery);
	const currentPermissions = devices.permissions ?? permissions.data;

	const screens = useQuery({
		...listScreens,
		enabled: enableCaptureLists,
		refetchInterval: enableCaptureLists ? listScreens.refetchInterval : false,
		staleTime: CAPTURE_LIST_STALE_TIME,
		gcTime: CAPTURE_LIST_GC_TIME,
	});
	const windows = useQuery({
		...listWindows,
		enabled: enableCaptureLists,
		staleTime: CAPTURE_LIST_STALE_TIME,
		gcTime: CAPTURE_LIST_GC_TIME,
	});
	// Separate from `screens`/`windows` above: the picker grid shows a thumbnail
	// per display/window, which listScreens/listWindows don't fetch.
	const displaysWithThumbnails = useQuery({
		...listDisplaysWithThumbnails,
		enabled: displayMenuOpen,
		staleTime: CAPTURE_THUMBNAIL_STALE_TIME,
		gcTime: CAPTURE_THUMBNAIL_GC_TIME,
	});
	const windowsWithThumbnails = useQuery({
		...listWindowsWithThumbnails,
		enabled: windowMenuOpen,
		staleTime: CAPTURE_THUMBNAIL_STALE_TIME,
		gcTime: CAPTURE_THUMBNAIL_GC_TIME,
	});
	const recordings = useQuery({
		...listRecordingsQuery,
		enabled: recordingsMenuOpen || showRecents,
	});
	const screenshots = useQuery({
		...listScreenshotsQuery,
		enabled: screenshotsMenuOpen || showRecents,
	});
	const recentMedia = useMemo(
		() => mergeRecentMedia(recordings.data, screenshots.data),
		[recordings.data, screenshots.data],
	);

	// A screenshot taken from the target picker lands while this window is
	// already open, so the library list would otherwise show stale contents
	// until it happened to refetch.
	useTauriEventListener(events.newScreenshotAdded, () => {
		void queryClient.invalidateQueries({
			queryKey: listScreenshotsQuery.queryKey,
		});
	});

	// Recording start/stop happens from the picker overlay, a different
	// window — this is hidden while a recording runs (see recording.rs), so
	// it can't show its own toast at the moment of failure. It's the one
	// still around to show it once shown again, and the one place stale
	// after a recording actually finishes.
	useTauriEventListener(events.recordingEvent, (event) => {
		switch (event.variant) {
			case "StartFailed":
			case "Failed":
				toast.error(`Recording failed: ${event.error}`);
				break;
			case "Stopped":
				void queryClient.invalidateQueries({
					queryKey: listRecordingsQuery.queryKey,
				});
				break;
			default:
				break;
		}
	});

	const options = {
		screen: () => {
			let screen: CaptureDisplay | undefined;

			if (rawOptions.captureTarget.variant === "display") {
				const screenId = rawOptions.captureTarget.id;
				screen =
					screens.data?.find((s) => s.id === screenId) ?? screens.data?.[0];
			} else if (rawOptions.captureTarget.variant === "area") {
				const screenId = rawOptions.captureTarget.screen;
				screen =
					screens.data?.find((s) => s.id === screenId) ?? screens.data?.[0];
			}

			return screen;
		},
		window: () => {
			let win: CaptureWindow | undefined;

			if (rawOptions.captureTarget.variant === "window") {
				const windowId = rawOptions.captureTarget.id;
				win = windows.data?.find((s) => s.id === windowId) ?? windows.data?.[0];
			}

			return win;
		},
		camera: () => {
			if (!rawOptions.cameraID) return undefined;
			return findCamera(devices.cameras, rawOptions.cameraID);
		},
		micName: () =>
			devices.microphones.find((m) => m.name === rawOptions.micName),
		target: (): ScreenCaptureTarget | undefined => {
			switch (rawOptions.captureTarget.variant) {
				case "display": {
					const screen = options.screen();
					if (!screen) return;
					return { variant: "display", id: screen.id };
				}
				case "window": {
					const window = options.window();
					if (!window) return;
					return { variant: "window", id: window.id };
				}
				case "area": {
					const screen = options.screen();
					if (!screen) return;
					return {
						variant: "area",
						bounds: rawOptions.captureTarget.bounds,
						screen: screen.id,
					};
				}
				case "cameraOnly":
					return rawOptions.captureTarget as ScreenCaptureTarget;
			}
		},
	};

	const closeAllMenus = () => {
		setDisplayMenuOpen(false);
		setWindowMenuOpen(false);
		setRecordingsMenuOpen(false);
		setScreenshotsMenuOpen(false);
		setModeInfoMenuOpen(false);
		setCameraMenuOpen(false);
		setMicrophoneMenuOpen(false);
	};

	// The main Display/Window/Area buttons enter an on-screen picker: Rust
	// spawns a transparent overlay per display (see target_select_overlay.rs)
	// and the user points at what they want. That's separate from the chevron
	// dropdowns beside them, which open the in-app thumbnail grid instead.
	// Clicking the already-active mode toggles the picker back off.
	const toggleTargetMode = async (mode: "display" | "window" | "area") => {
		const nextMode = rawOptions.targetMode === mode ? null : mode;

		if (!nextMode) {
			setOptions({ targetMode: null, targetModeDismissal: "cancelled" });
			await commands.closeTargetSelectOverlays();
			return;
		}

		closeAllMenus();

		// Overlay windows are keyed by display id, not by mode — Rust reuses
		// an already-open one by just showing it again rather than updating
		// what mode it renders (openTargetSelectOverlays never re-navigates
		// it). Switching directly from e.g. Display to Window without
		// closing first would leave it stuck showing the Display picker's
		// UI, so close whatever's open before asking for a different mode;
		// the fresh windows that creates always get the right mode baked
		// into their URL.
		if (rawOptions.targetMode) {
			await commands.closeTargetSelectOverlays();
		}

		await commands.openTargetSelectOverlays(null, null, nextMode);
		setOptions({ targetMode: nextMode, targetModeSource: "main" });
	};

	const openCameraMenu = (
		initialSettings: CameraWithDetails | null,
		openSettingsWhenReady = false,
	) => {
		setEnableDeviceQueries(true);
		setCameraInitialSettings(initialSettings);
		setOpenCameraSettingsWhenReady(
			openSettingsWhenReady && initialSettings === null,
		);
		closeAllMenus();
		setCameraMenuOpen(true);
	};

	const openMicrophoneMenu = (
		initialSettings: MicrophoneWithDetails | null,
		openSettingsWhenReady = false,
	) => {
		setEnableDeviceQueries(true);
		setMicrophoneInitialSettings(initialSettings);
		setOpenMicSettingsWhenReady(
			openSettingsWhenReady && initialSettings === null,
		);
		closeAllMenus();
		setMicrophoneMenuOpen(true);
	};

	// Handles the case in openCameraMenu where the gear icon is clicked before
	// devices have ever loaded (enableDeviceQueries just flipped true on this
	// same click): jump into that camera's settings once its details resolve.
	// biome-ignore lint/correctness/useExhaustiveDependencies: options.camera is a plain closure rebuilt every render, not a stable dependency — devices.cameras/rawOptions.cameraID are what it actually reads.
	useEffect(() => {
		if (!openCameraSettingsWhenReady) return;
		const camera = options.camera();
		if (camera) {
			setCameraInitialSettings(camera);
			setOpenCameraSettingsWhenReady(false);
		}
	}, [openCameraSettingsWhenReady, devices.cameras, rawOptions.cameraID]);

	// Mirrors the camera-settings effect above, for the microphone gear icon.
	// biome-ignore lint/correctness/useExhaustiveDependencies: options.micName is a plain closure rebuilt every render, not a stable dependency — devices.microphones/rawOptions.micName are what it actually reads.
	useEffect(() => {
		if (!openMicSettingsWhenReady) return;
		const mic = options.micName();
		if (mic) {
			setMicrophoneInitialSettings(mic);
			setOpenMicSettingsWhenReady(false);
		}
	}, [openMicSettingsWhenReady, devices.microphones, rawOptions.micName]);

	const handleCameraSelect = (id: DeviceOrModelID | null) => {
		const camera =
			id && "DeviceID" in id
				? devices.cameras.find((c) => c.device_id === id.DeviceID)
				: id && "ModelID" in id
					? devices.cameras.find((c) => c.model_id === id.ModelID)
					: undefined;
		setOptions({ cameraLabel: camera?.display_name ?? null });
		setCamera.mutate({ model: id });
	};

	const handleMicrophoneSelect = (name: string | null) => {
		setOptions({ micName: name });
		commands.setMicInput(name).catch((error) => {
			console.error("Failed to set microphone input:", error);
		});
	};

	const handleCameraSettingsChange = (
		camera: CameraWithDetails,
		settings: CameraDeviceSettings,
	) => {
		const key = cameraSettingsKey(camera.device_id);
		const current = recordingSettingsQuery.data?.cameraDeviceSettings ?? {};
		void recordingDeviceSettingsStore.set({
			cameraDeviceSettings: { ...current, [key]: settings },
		});
	};

	const handleMicrophoneSettingsChange = (
		name: string,
		settings: MicrophoneDeviceSettings,
	) => {
		const current = recordingSettingsQuery.data?.microphoneDeviceSettings ?? {};
		void recordingDeviceSettingsStore.set({
			microphoneDeviceSettings: { ...current, [name]: settings },
		});
	};

	function ExpandedControlLabel({ title }: { title: string }) {
		return (
			<Show when={isExpanded}>
				<span className="text-xs text-gray-11 font-sans">{title}</span>
			</Show>
		);
	}

	function Controls() {
		return (
			<section
				className={cn(
					"space-y-2 transition-all duration-200",
					isExpanded && "space-y-2.5",
				)}
			>
				<div>
					<ExpandedControlLabel title="Camera" />
					<CameraSelect
						disabled={enableDeviceQueries && devices.isPending}
						options={devices.cameras}
						value={options.camera() ?? null}
						selectedLabel={rawOptions.cameraLabel}
						isSelected={rawOptions.cameraID !== null}
						onChange={(camera) => {
							if (!camera) {
								setOptions({ cameraLabel: null });
								setCamera.mutate({ model: null });
							} else if (camera.model_id) {
								setOptions({ cameraLabel: camera.display_name });
								setCamera.mutate({ model: { ModelID: camera.model_id } });
							} else {
								setOptions({ cameraLabel: camera.display_name });
								setCamera.mutate({ model: { DeviceID: camera.device_id } });
							}
						}}
						permissions={currentPermissions}
						onOpen={() => openCameraMenu(null)}
						onOpenSettings={() =>
							openCameraMenu(
								options.camera() ?? null,
								rawOptions.cameraID != null,
							)
						}
					/>
				</div>
				<div>
					<ExpandedControlLabel title="Microphone" />
					<MicrophoneSelect
						disabled={enableDeviceQueries && devices.isPending}
						value={rawOptions.micName}
						permissions={currentPermissions}
						onOpen={() => openMicrophoneMenu(null)}
						onOpenSettings={() =>
							openMicrophoneMenu(
								options.micName() ?? null,
								rawOptions.micName != null,
							)
						}
					/>
				</div>
				<div>
					<ExpandedControlLabel title="System Audio" />
					<SystemAudio
						enabled={rawOptions.captureSystemAudio ?? false}
						onChange={(enabled) => setOptions({ captureSystemAudio: enabled })}
					/>
				</div>
			</section>
		);
	}

	const HomeNodeRef = useRef<HTMLDivElement>(null);
	const Home = (
		<AnimatePresence>
			<motion.div
				initial={{ scale: 0.95 }}
				animate={{ scale: 1 }}
				exit={{ scale: 0.95 }}
				transition={{
					duration: 0.2,
					ease: "easeOut",
				}}
			>
				<div
					ref={HomeNodeRef}
					className="flex-1 min-h-0 w-full flex flex-col gap-2 overflow-auto pb-1"
				>
					{isExpanded && (
						<div className="px-1">
							<h2 className="text-xs font-semibold text-gray-11 font-sans">
								Capture
							</h2>
						</div>
					)}

					<div className="flex flex-col gap-2 w-full text-xs text-gray-11 pt-1 px-1">
						<div className="flex flex-row gap-2 items-stretch w-full">
							<div
								className={cn(
									"flex flex-1 overflow-hidden rounded-lg border border-gray-6 bg-gray-2 ring-1 ring-transparent ring-offset-1 ring-offset-gray-1 transition-[background-color,border-color] focus-within:ring-accent-500 focus-within:ring-offset-1 focus-within:ring-offset-gray-1",
									rawOptions.targetMode === "display" || displayMenuOpen
										? "border-accent-400 bg-accent-300 ring-accent-400 hover:border-accent-500 hover:bg-accent-400 dark:bg-accent-300/30 dark:hover:bg-accent-400/40"
										: "hover:border-gray-8 hover:bg-gray-3",
								)}
							>
								<MenuSelectionButton
									selected={rawOptions.targetMode === "display"}
									Component={IconMonitor}
									description={isExpanded ? "Entire screen" : undefined}
									name="Display"
									onClick={() => void toggleTargetMode("display")}
									className={cn(
										"flex-1 rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
										isExpanded ? "pl-3" : "pl-5",
									)}
								/>
								<MenuDropdownButton
									className={cn(
										"rounded-none border-l border-gray-6 focus-visible:ring-0 focus-visible:ring-offset-0",
										displayMenuOpen && "bg-gray-5",
									)}
									// ref={displayTriggerRef}
									// disabled={isRecording}
									expanded={displayMenuOpen}
									onClick={() => {
										setDisplayMenuOpen((prev) => {
											const next = !prev;
											if (next) {
												setWindowMenuOpen(false);
											}
											return next;
										});
									}}
									aria-haspopup="menu"
									aria-label="Choose display"
								/>
							</div>

							{/* Window Selection */}
							<div
								className={cn(
									"flex flex-1 overflow-hidden rounded-lg border border-gray-6 bg-gray-2 ring-1 ring-transparent ring-offset-1 ring-offset-gray-1 transition-[background-color,border-color] focus-within:ring-accent-300 focus-within:ring-offset-1 focus-within:ring-offset-gray-1",
									rawOptions.targetMode === "window" || windowMenuOpen
										? "border-accent-400 bg-accent-300 ring-accent-400 hover:border-accent-500 hover:bg-accent-400 dark:bg-accent-300/30 dark:hover:bg-accent-400/40"
										: "hover:border-gray-8 hover:bg-gray-3",
								)}
							>
								<MenuSelectionButton
									selected={rawOptions.targetMode === "window"}
									Component={IconWindow}
									description={isExpanded ? "Single window" : undefined}
									name="Window"
									onClick={() => void toggleTargetMode("window")}
									className={cn(
										"flex-1 rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
										isExpanded ? "pl-3" : "pl-5",
									)}
								/>
								<MenuDropdownButton
									className={cn(
										"rounded-none border-l border-gray-6 focus-visible:ring-0 focus-visible:ring-offset-0",
										windowMenuOpen && "bg-gray-5",
									)}
									// ref={windowTriggerRef}
									// disabled={isRecording}
									expanded={windowMenuOpen}
									onClick={() => {
										setWindowMenuOpen((prev) => {
											const next = !prev;
											if (next) {
												setDisplayMenuOpen(false);
											}
											return next;
										});
									}}
									aria-haspopup="menu"
									aria-label="Choose window"
								/>
							</div>
							<MenuSelectionButton
								selected={rawOptions.targetMode === "area"}
								Component={IconMonitor}
								description={isExpanded ? "Custom area" : undefined}
								name="Area"
								onClick={() => void toggleTargetMode("area")}
								className={cn("flex-1", !isExpanded ? "hidden" : "block")}
							/>
						</div>
						<div className="flex flex-row gap-2 items-stretch w-full">
							<MenuSelectionButton
								selected={rawOptions.targetMode === "area"}
								Component={IconMonitor}
								description={isExpanded ? "Custom area" : undefined}
								name="Area"
								onClick={() => void toggleTargetMode("area")}
								className={cn("flex-1", isExpanded ? "hidden" : "block")}
							/>
						</div>
						<Controls />
						{isExpanded && (
							<Recents
								items={recentMedia}
								isLoading={recordings.isLoading || screenshots.isLoading}
								errorMessage={
									(recordings.error || screenshots.error) &&
									recentMedia.length === 0
										? "Unable to load recent captures"
										: undefined
								}
							/>
						)}
					</div>
				</div>
			</motion.div>
		</AnimatePresence>
	);

	const renderActiveMenu = () => {
		switch (activeMenu) {
			case "display":
				return (
					<CaptureSourcePanel
						variant="display"
						targets={displaysWithThumbnails.data}
						isLoading={displaysWithThumbnails.isLoading}
						errorMessage={displaysWithThumbnails.error?.message}
						disabled={false}
						onBack={closeAllMenus}
						onSelect={(target) => {
							const captureTarget: ScreenCaptureTarget = {
								variant: "display",
								id: target.id,
							};
							setOptions({ captureTarget, targetMode: "display" });
							closeAllMenus();
							// Picking straight from this grid, rather than the Display
							// button's point-at-the-screen picker, skipped opening any
							// overlay at all — targetMode changed with nothing on screen
							// to show it. Passing the already-known target scopes the
							// overlay to just that one display instead of spawning one
							// per monitor (see open_target_select_overlays' focused_target
							// handling), so this lands on the same confirm-and-shoot
							// screen the point-and-click flow does.
							void commands.openTargetSelectOverlays(
								captureTarget,
								null,
								"display",
							);
						}}
					/>
				);
			case "window":
				return (
					<CaptureSourcePanel
						variant="window"
						targets={windowsWithThumbnails.data}
						isLoading={windowsWithThumbnails.isLoading}
						errorMessage={windowsWithThumbnails.error?.message}
						disabled={false}
						onBack={closeAllMenus}
						onSelect={(target) => {
							const captureTarget: ScreenCaptureTarget = {
								variant: "window",
								id: target.id,
							};
							setOptions({ captureTarget, targetMode: "window" });
							closeAllMenus();
							void commands.openTargetSelectOverlays(
								captureTarget,
								null,
								"window",
							);
							// Best-effort: brings the target to the foreground so it's
							// what's actually on screen behind the overlay. A failure
							// here (window closed mid-pick, permission denied) shouldn't
							// block opening the overlay itself.
							commands.focusWindow(target.id).catch((error) => {
								console.error("Failed to focus selected window:", error);
							});
						}}
					/>
				);
			case "recording":
				return (
					<CaptureSourcePanel
						variant="recording"
						targets={recordings.data}
						isLoading={recordings.isLoading}
						errorMessage={recordings.error?.message}
						disabled={false}
						onBack={closeAllMenus}
						onSelect={(target) => void openMediaFile(target.path)}
						onRefetch={() => recordings.refetch()}
					/>
				);
			case "screenshot":
				return (
					<CaptureSourcePanel
						variant="screenshot"
						targets={screenshots.data}
						isLoading={screenshots.isLoading}
						errorMessage={screenshots.error?.message}
						disabled={false}
						onBack={closeAllMenus}
						onSelect={(target) => void openMediaFile(target.path)}
					/>
				);
			case "camera":
				return (
					<CaptureSourcePanel
						variant="camera"
						targets={devices.cameras}
						isLoading={enableDeviceQueries && devices.isPending}
						disabled={false}
						onBack={closeAllMenus}
						selectedId={rawOptions.cameraID ?? null}
						onSelect={handleCameraSelect}
						permissions={currentPermissions}
						cameraDeviceSettings={
							recordingSettingsQuery.data?.cameraDeviceSettings ?? {}
						}
						onCameraSettingsChange={handleCameraSettingsChange}
						initialSettingsTarget={cameraInitialSettings}
					/>
				);
			case "microphone":
				return (
					<CaptureSourcePanel
						variant="microphone"
						targets={devices.microphones}
						isLoading={enableDeviceQueries && devices.isPending}
						disabled={false}
						onBack={closeAllMenus}
						selectedName={rawOptions.micName}
						onSelect={handleMicrophoneSelect}
						permissions={currentPermissions}
						microphoneDeviceSettings={
							recordingSettingsQuery.data?.microphoneDeviceSettings ?? {}
						}
						onMicrophoneSettingsChange={handleMicrophoneSettingsChange}
						initialSettingsTarget={microphoneInitialSettings}
					/>
				);
			default:
				return null;
		}
	};

	return (
		<RecordingOptionsProvider>
			<div
				onMouseEnter={handleMouseEnter}
				className="flex relative flex-col px-3.25 gap-2 pb-2 h-full min-h-0 text-gray-8"
			>
				<WindowChromeHeader
					maximized={isExpanded}
					onMaximize={() => void toggleMainWindowExpanded()}
				>
					<div
						className="flex flex-1 gap-1 items-center mx-2 min-w-0"
						data-tauri-drag-region
					>
						<MainWindowHelpButton />
						<div className="flex-1 min-h-9 min-w-0" data-tauri-drag-region />
						<div
							className="flex gap-1 items-center shrink-0"
							data-tauri-drag-region
						>
							<Tooltip content={<span>Settings</span>}>
								<button
									type="button"
									onClick={() =>
										void commands.showWindow({ Settings: { page: null } })
									}
									aria-label="Open settings"
									className="flex shrink-0 justify-center items-center size-5 focus:outline-hidden"
								>
									<IconLucideSettings className="transition-colors text-gray-11 size-3.5 hover:text-gray-12" />
								</button>
							</Tooltip>
							<Tooltip
								content={<span>{isExpanded ? "Collapse" : "Expand"}</span>}
							>
								<button
									type="button"
									disabled={isWindowResizing}
									onClick={() => void toggleMainWindowExpanded()}
									aria-label={isExpanded ? "Collapse window" : "Expand window"}
									className={cn(
										"flex shrink-0 justify-center items-center size-5 focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed",
										isWindowResizing && "opacity-50 cursor-not-allowed",
									)}
								>
									<Show
										when={isExpanded}
										fallback={
											<IconLucideMaximize2 className="transition-colors text-gray-11 size-3.5 hover:text-gray-12" />
										}
									>
										<IconLucideMinimize2 className="transition-colors text-gray-11 size-3.5 hover:text-gray-12" />
									</Show>
								</button>
							</Tooltip>
							{import.meta.env.DEV && (
								<button
									type="button"
									onClick={() => void openDebugWindow()}
									className="flex justify-center items-center focus:outline-hidden"
								>
									<IconLucideBug className="transition-colors text-gray-11 size-4 hover:text-gray-12" />
								</button>
							)}
						</div>
					</div>
				</WindowChromeHeader>
				<Show when={!activeMenu}>
					<div className="flex items-center justify-between mt-4 mb-1.5">
						<div className="flex items-center space-x-1">
							<a
								className="*:w-23 *:h-auto text-gray-11"
								target="_blank"
								rel="noreferrer"
								href="#"
							>
								<div className="flex items-center gap-2">
									<div className="flex items-center justify-center gap-1 rounded-lg bg-accent-400 dark:bg-accent-500 w-fit! p-1.5 transition-colors hover:bg-accent-400">
										<IconQuiroLogo className="size-8.5 text-white" />
									</div>
									<span className="text-4xl font-sans font-medium">Quiro</span>
								</div>
							</a>
						</div>
						<QuiroMode
							onInfoClick={() => {
								setModeInfoMenuOpen(true);
								setDisplayMenuOpen(false);
								setWindowMenuOpen(false);
								setRecordingsMenuOpen(false);
								setScreenshotsMenuOpen(false);
								setCameraMenuOpen(false);
								setMicrophoneMenuOpen(false);
							}}
						/>
					</div>
				</Show>
				<div className="flex-1 min-h-0 w-full flex flex-col">
					{!activeMenu ? Home : renderActiveMenu()}
				</div>
			</div>
		</RecordingOptionsProvider>
	);
}
