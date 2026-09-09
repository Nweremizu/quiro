import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { listCaptureDisplaysQuery } from "@/utils/queries";
import { commands } from "@/utils/tauri";

// React port of Cap's routes/debug.tsx, trimmed to what Quiro actually has:
// no Onboarding window, no fail-point injection commands (listFails/setFail).
// Update checking lives in Settings > General, not here. Just the one
// section that maps to something real: force-opening each window Quiro can
// show.
export default function Debug() {
	const [version, setVersion] = useState("");
	const displays = useQuery(listCaptureDisplaysQuery);
	const primaryDisplayId = displays.data?.[0]?.id;

	useEffect(() => {
		getVersion()
			.then(setVersion)
			.catch((error) => console.error("Failed to load app version:", error));
	}, []);

	const buttons: { label: string; disabled?: boolean; onClick: () => void }[] =
		[
			{
				label: "Show Main",
				onClick: () =>
					void commands.showWindow({ Main: { init_target_mode: null } }),
			},
			{
				label: "Show Settings",
				onClick: () => void commands.showWindow({ Settings: { page: null } }),
			},
			{
				label: "Show Mode Select",
				onClick: () => void commands.showWindow("ModeSelect"),
			},
			{
				label: "Show Camera (centered)",
				onClick: () => void commands.showWindow({ Camera: { centered: true } }),
			},
			{
				label: "Show Recordings Overlay",
				onClick: () => void commands.showWindow("RecordingsOverlay"),
			},
			{
				label: "Show Recording Controls (3s countdown)",
				onClick: () =>
					void commands.showWindow({
						InProgressRecording: { countdown: 3, capture_target: null },
					}),
			},
			{
				label: "Show Capture Area (primary display)",
				disabled: !primaryDisplayId,
				onClick: () =>
					primaryDisplayId &&
					void commands.showWindow({
						CaptureArea: { screen_id: primaryDisplayId },
					}),
			},
			{
				label: "Show Target Select Overlay (primary display)",
				disabled: !primaryDisplayId,
				onClick: () =>
					primaryDisplayId &&
					void commands.showWindow({
						TargetSelectOverlay: {
							display_id: primaryDisplayId,
							target_mode: "display",
						},
					}),
			},
		];

	// Studio recording has no UI trigger yet (the picker only wires up
	// Screenshot mode so far) — this is the only way to exercise the actual
	// pipeline (mic/camera feeds, system audio, quality, cursor/keyboard
	// capture) until that lands. Remove once it does.
	const recordingButtons: {
		label: string;
		disabled?: boolean;
		onClick: () => void;
	}[] = [
		{
			label: "Start Test Recording (primary display)",
			disabled: !primaryDisplayId,
			onClick: () =>
				primaryDisplayId &&
				void commands
					.startRecording({ variant: "display", id: primaryDisplayId })
					.then((result) => {
						if (result.status === "error")
							console.error("Start recording failed:", result.error);
					}),
		},
		{
			label: "Pause Recording",
			onClick: () =>
				void commands.pauseRecording().then((result) => {
					if (result.status === "error")
						console.error("Pause recording failed:", result.error);
				}),
		},
		{
			label: "Resume Recording",
			onClick: () =>
				void commands.resumeRecording().then((result) => {
					if (result.status === "error")
						console.error("Resume recording failed:", result.error);
				}),
		},
		{
			label: "Stop Recording",
			onClick: () =>
				void commands.stopRecording().then((result) => {
					if (result.status === "error")
						console.error("Stop recording failed:", result.error);
					else console.log("Recording saved to:", result.data);
				}),
		},
	];

	return (
		<main className="custom-scroll h-full w-full overflow-y-auto bg-gray-2 p-4 text-gray-12">
			<h2 className="text-xl font-bold">Debug Windows</h2>
			<p className="mb-4 text-xs text-gray-10">Quiro v{version}</p>
			<div className="flex max-w-sm flex-col gap-2">
				{buttons.map((b) => (
					<button
						key={b.label}
						type="button"
						disabled={b.disabled}
						onClick={b.onClick}
						className="rounded-md bg-gray-4 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-5 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{b.label}
					</button>
				))}
			</div>

			<h2 className="mt-6 text-xl font-bold">Recording Pipeline</h2>
			<p className="mb-4 text-xs text-gray-10">
				No UI trigger yet — this is the studio_recording actor directly.
			</p>
			<div className="flex max-w-sm flex-col gap-2">
				{recordingButtons.map((b) => (
					<button
						key={b.label}
						type="button"
						disabled={b.disabled}
						onClick={b.onClick}
						className="rounded-md bg-gray-4 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-5 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{b.label}
					</button>
				))}
			</div>
		</main>
	);
}
