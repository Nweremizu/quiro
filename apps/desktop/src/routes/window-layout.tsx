import { cn } from "@quiro/ui";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type as ostype } from "@tauri-apps/plugin-os";
import { type ReactNode, Suspense, useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { FullPageLoader } from "@/components/loader";
import MACOSTitlebarControls from "@/components/titlebar/macos-titlebar-control";

import WindowControlsWindows from "@/components/titlebar/windows11-titlebar-control";
import { generalSettingsStore } from "@/store";
import { applyMacOSWindowMaterial } from "@/utils/macos-window-material";
import { commands } from "@/utils/tauri";
import { initializeTitlebar } from "@/utils/titlebar-state";
import { useWindowContext, WindowProvider } from "./launch/Context";

// The only place that turns the `theme` general setting into the `.dark`
// class tokens.css's `:root.dark` selectors key off — every window routes
// through WindowLayout, so this is where it belongs (not each settings/
// route reimplementing it). `setTheme` (see settings/general.tsx) only
// updates the *current* window's native title-bar theme; this store
// subscription is what keeps the web content itself in sync, here and in
// every other already-open window, live.
function useAppliedTheme() {
	const generalSettings = generalSettingsStore.useQuery();
	const theme = generalSettings.data?.theme ?? "system";

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const isDark = theme === "dark" || (theme === "system" && media.matches);
			document.documentElement.classList.toggle("dark", isDark);
		};
		apply();

		if (theme !== "system") return;
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [theme]);
}

export default function WindowLayout() {
	const location = useLocation();
	const unlistenResizeRef = useRef<UnlistenFn | undefined>(undefined);
	const isMacOS = ostype() === "macos";

	useAppliedTheme();

	useEffect(() => {
		console.log("window chrome mounted");
		let cancelled = false;

		initializeTitlebar().then((unlisten) => {
			if (cancelled) {
				unlisten?.();
			} else {
				unlistenResizeRef.current = unlisten;
			}
		});

		const handleKeyDown = (e: KeyboardEvent) => {
			const isMac = ostype() === "macos";
			const accel = isMac ? e.metaKey : e.ctrlKey;

			if (accel && e.key === "w") {
				e.preventDefault();
				getCurrentWindow().close();
				return;
			}

			// The conventional settings shortcut. Deliberately window-local rather
			// than a global shortcut: registering it with the OS would take Cmd+,
			// away from every other app for as long as Quiro is running, and Quiro
			// runs in the tray all day. This way it only fires when one of our own
			// windows has focus, which is what the convention actually means.
			if (accel && e.key === ",") {
				e.preventDefault();
				void commands.showWindow({ Settings: { page: null } });
			}
		};
		window.addEventListener("keydown", handleKeyDown);

		return () => {
			cancelled = true;
			unlistenResizeRef.current?.();
			window.removeEventListener("keydown", handleKeyDown);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		applyMacOSWindowMaterial(
			location.pathname.startsWith("/settings") ? "settings" : "panel",
		).catch((error) => {
			console.error("Failed to apply macOS window material:", error);
		});
	}, [location.pathname]);

	return (
		<WindowProvider>
			<div
				className={cn(
					"cap-window-shell flex overflow-hidden flex-col w-screen h-screen max-h-screen divide-y divide-gray-5 bg-gray-1",
					isMacOS && "rounded-[16px]",
				)}
			>
				<Header />
				<Suspense fallback={<FullPageLoader />}>
					<Inner>
						<Suspense fallback={null}>
							<Outlet />
						</Suspense>
					</Inner>
				</Suspense>
			</div>
		</WindowProvider>
	);
}

function Header() {
	const ctx = useWindowContext();
	const location = useLocation();

	if (!ctx) {
		throw new Error(
			"useWindowChrome must be used within a WindowChromeContext",
		);
	}

	const isWindows = ostype() === "windows";
	const isMacOS = ostype() === "macos";
	const isLinux = ostype() === "linux";
	const isSettings = location.pathname.startsWith("/settings");
	// Screenshot editor draws its own top strip (Header.tsx) with its own
	// reserved traffic-light space — same reason Settings suppresses this
	// generic header on macOS, so the two don't stack into a double bar.
	const isScreenshotEditor = location.pathname.startsWith("/screenshot-editor");

	if (isMacOS && (isSettings || isScreenshotEditor)) return null;

	return (
		<header
			className={cn(
				"cap-window-header flex items-center min-w-0 w-full h-9 select-none shrink-0 bg-gray-2",
				isWindows ? "flex-row" : "flex-row-reverse",
			)}
			data-tauri-drag-region
		>
			{ctx.state?.items}
			{isWindows && (
				<WindowControlsWindows
					className="ml-auto!"
					maximizable={ctx.state?.onMaximize ? true : undefined}
					maximized={ctx.state?.maximized}
					onMaximize={ctx.state?.onMaximize}
				/>
			)}
			{((isMacOS && !isSettings) || isLinux) && (
				<MACOSTitlebarControls
					className="mr-auto! ml-3"
					showMinimize={false}
					showZoom={ctx.state?.onMaximize !== undefined}
					onZoom={ctx.state?.onMaximize}
				/>
			)}
		</header>
	);
}

function Inner({ children }: { children: ReactNode }) {
	const location = useLocation();

	useEffect(() => {
		if (location.pathname !== "/") void getCurrentWindow().show();
		// Runs once on mount against the initial location, matching the
		// original Solid onMount (not re-run on subsequent navigation).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [location.pathname]);

	return (
		<div
			data-tauri-drag-region="false"
			className="cap-window-body flex overflow-hidden flex-col flex-1"
		>
			{children}
		</div>
	);
}
