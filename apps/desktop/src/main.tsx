import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./App.css";
import { Toaster } from "@quiro/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { message } from "@tauri-apps/plugin-dialog";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import Camera from "./routes/camera";
import Debug from "./routes/debug";
import CameraSettingsBreak from "./routes/dev/camera-settings-break";
import CameraSettingsVariants from "./routes/dev/camera-settings-variants";
import ZoomSegmentSettingsBreak from "./routes/dev/zoom-segment-settings-break";
import ZoomSegmentSettingsVariants from "./routes/dev/zoom-segment-settings-variants";
import Editor from "./routes/editor";
import MainWindow from "./routes/launch";
import Onboarding from "./routes/onboarding";
import ScreenshotEditor from "./routes/screenshot-editor";
import Settings from "./routes/settings";
import ChangelogSettings from "./routes/settings/changelog";
import FeedbackSettings from "./routes/settings/feedback";
import GeneralSettings from "./routes/settings/general";
import RecordingsSettings from "./routes/settings/recordings";
import ScreenshotsSettings from "./routes/settings/screenshots";
import ShortcutsSettings from "./routes/settings/shortcuts";
import { ToolbarWindow } from "./routes/ToolbarWindow";
import TargetSelectOverlay from "./routes/target-select-overlay";
import WindowCaptureOccluder from "./routes/window-capture-occluder";
import WindowLayout from "./routes/window-layout";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
		mutations: {
			onError: (error) => {
				message(`An error occurred: ${error}`, {
					title: "Error",
				});
			},
		},
	},
});

// One index.html for every Tauri window — each window's WebviewUrl just
// points at a different route (see src-tauri/src/windows.rs), and Vite's
// dev server + Tauri's asset protocol both fall back to index.html for
// unmatched paths, so this needs no hash routing.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<AppErrorBoundary>
				<Suspense>
					<BrowserRouter>
						<Inner />
					</BrowserRouter>
				</Suspense>
			</AppErrorBoundary>
			<Toaster />
		</QueryClientProvider>
	</React.StrictMode>,
);

function Inner() {
	return (
		<Routes>
			{/* Outside WindowLayout on purpose: the target-select overlays and
          the camera bubble are transparent, chrome-less windows, so they
          must not inherit the opaque window chrome (header, background,
          rounded shell). */}
			<Route path="/target-select-overlay" element={<TargetSelectOverlay />} />
			<Route path="/camera" element={<Camera />} />
			<Route path="/toolbar" element={<ToolbarWindow />} />
			<Route
				path="/window-capture-occluder"
				element={<WindowCaptureOccluder />}
			/>
			<Route path="/onboarding" element={<Onboarding />} />
			<Route path="/" element={<WindowLayout />}>
				<Route index element={<MainWindow />} />

				<Route path="/debug" element={<Debug />} />
				<Route
					path="/debug/camera-settings-break"
					element={<CameraSettingsBreak />}
				/>
				<Route
					path="/debug/camera-settings-variants"
					element={<CameraSettingsVariants />}
				/>
				<Route
					path="/debug/zoom-segment-settings-break"
					element={<ZoomSegmentSettingsBreak />}
				/>
				<Route
					path="/debug/zoom-segment-settings-variants"
					element={<ZoomSegmentSettingsVariants />}
				/>
				<Route path="/screenshot-editor" element={<ScreenshotEditor />} />
				<Route path="/editor" element={<Editor />} />
				{/* Rust's show_settings builds the URL as `/settings/{page}`,
				    with an empty `page` (→ trailing slash) when none is given —
				    the index route below covers that same "no page" case. */}
				<Route path="/settings" element={<Settings />}>
					<Route index element={<GeneralSettings />} />
					<Route path="general" element={<GeneralSettings />} />
					<Route path="shortcuts" element={<ShortcutsSettings />} />
					<Route path="recordings" element={<RecordingsSettings />} />
					<Route path="screenshots" element={<ScreenshotsSettings />} />
					<Route path="feedback" element={<FeedbackSettings />} />
					<Route path="changelog" element={<ChangelogSettings />} />
				</Route>
			</Route>
		</Routes>
	);
}
