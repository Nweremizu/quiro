import { cn } from "@quiro/ui";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { recordingSettingsStore } from "@/store";
import { useTauriEventListener } from "@/utils/createEventListner";
import { commands, events } from "@/utils/tauri";
import IconMic from "~icons/lucide/mic";
import IconMicOff from "~icons/lucide/mic-off";
import IconPause from "~icons/lucide/pause";
import IconPlay from "~icons/lucide/play";
import IconRestart from "~icons/lucide/rotate-ccw";
import IconTrash from "~icons/lucide/trash";
import IconWarning from "~icons/lucide/triangle-alert";

// The in-progress recording controls: a horizontal pill floating over
// whatever is being recorded. The window itself is transparent and larger
// than the pill (fake_window.rs's RECORDING_CONTROLS_WIDTH/HEIGHT) to leave
// room for the shadow; only the pill paints, and only the pill's rect is
// registered as interactive, so the rest of the window stays click-through.
//
// BAR_HEIGHT must match RECORDING_CONTROLS_BAR_HEIGHT, which fake_window.rs
// measures back from when placing this window against an area capture target.
// The width is left to the content so the timer can grow past a minute.
const INTERACTIVE_AREA = "recording-controls-interactive-area";
const BAR_HEIGHT = 44;

declare global {
	interface Window {
		COUNTDOWN: number;
	}
}

type State = "countdown" | "recording" | "paused" | "stopped";

type Timing = {
	startedAt: number;
	/** Total ms across completed pause spans. */
	pausedTotal: number;
	/** When the current pause span began, or null while running. */
	pausedAt: number | null;
};

const freshTiming = (): Timing => ({
	startedAt: Date.now(),
	pausedTotal: 0,
	pausedAt: null,
});

/** `0:06` while short, `12:06` past a minute, `1:02:06` past an hour. */
function formatElapsed(totalSeconds: number) {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = String(totalSeconds % 60).padStart(2, "0");
	if (hours > 0)
		return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
	return `${minutes}:${seconds}`;
}

function PillButton({
	onClick,
	disabled,
	label,
	children,
}: {
	onClick: () => void;
	disabled?: boolean;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={label}
			aria-label={label}
			className="flex size-6.5 shrink-0 items-center justify-center rounded-lg text-gray-10 outline-none transition-colors duration-150 hover:bg-gray-12/8 hover:text-gray-12 focus-visible:bg-gray-12/8 focus-visible:text-gray-12 disabled:pointer-events-none disabled:opacity-40"
		>
			{children}
		</button>
	);
}

export function ToolbarWindow() {
	const [state, setState] = useState<State>(
		window.COUNTDOWN > 0 ? "countdown" : "recording",
	);
	const [countdown, setCountdown] = useState(window.COUNTDOWN ?? 0);
	const [elapsed, setElapsed] = useState(0);
	const [issue, setIssue] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// Backend mute lives on the per-recording microphone lock, so it always
	// starts false for a new recording — see set_recording_mic_muted.
	const [micMuted, setMicMuted] = useState(false);
	const [hasMicrophone, setHasMicrophone] = useState(false);

	// Not state: the timer reads these every tick, and mutating them must never
	// itself trigger a render.
	const timingRef = useRef<Timing>(freshTiming());

	const barRef = useRef<HTMLDivElement>(null);
	const lastBoundsRef = useRef("");

	useEffect(() => {
		document.documentElement.setAttribute("data-transparent-window", "true");
		document.body.style.background = "transparent";
	}, []);

	// Same store the main window writes its device picks to — a recording with
	// no microphone selected should not show a mute button at all.
	useEffect(() => {
		let cancelled = false;
		recordingSettingsStore
			.get()
			.then((settings) => {
				if (!cancelled) setHasMicrophone(Boolean(settings?.micName));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	// This window is hidden and reused across recordings (recording.rs's
	// restore_main_window), so every "new recording" signal has to reset the
	// clock or the next session inherits the previous one's elapsed time. It
	// can also mount *after* Started already fired, since recording.rs spawns
	// the window right behind that emit — which is why the initial state above
	// is already "recording" rather than waiting for an event that has been
	// and gone.
	useTauriEventListener(events.recordingEvent, (event) => {
		switch (event.variant) {
			case "Countdown":
				timingRef.current = freshTiming();
				setIssue(null);
				setBusy(false);
				setCountdown(event.value);
				setElapsed(0);
				setState("countdown");
				break;
			case "Started":
				timingRef.current = freshTiming();
				setIssue(null);
				setBusy(false);
				setElapsed(0);
				setMicMuted(false);
				setState("recording");
				break;
			case "Paused":
				if (timingRef.current.pausedAt === null)
					timingRef.current.pausedAt = Date.now();
				setBusy(false);
				setState("paused");
				break;
			case "Resumed": {
				const { pausedAt } = timingRef.current;
				if (pausedAt !== null) {
					timingRef.current.pausedTotal += Date.now() - pausedAt;
					timingRef.current.pausedAt = null;
				}
				setBusy(false);
				setState("recording");
				break;
			}
			case "Stopped":
				setBusy(false);
				setState("stopped");
				break;
			case "Failed":
			case "StartFailed":
				setIssue(event.error);
				setBusy(false);
				setState("stopped");
				break;
			case "InputLost":
				setIssue(
					`${event.input === "microphone" ? "Microphone" : "Camera"} disconnected`,
				);
				break;
			case "InputRestored":
				setIssue(null);
				break;
		}
	});

	// 500ms rather than per-frame: the readout only has second resolution, and
	// setState with an unchanged number is a no-op in React, so this renders at
	// most once a second while recording and not at all while paused.
	useEffect(() => {
		if (state === "countdown" || state === "stopped") return;

		const tick = () => {
			const { startedAt, pausedTotal, pausedAt } = timingRef.current;
			const now = Date.now();
			const pausedNow = pausedAt === null ? 0 : now - pausedAt;
			setElapsed(
				Math.max(
					0,
					Math.floor((now - startedAt - pausedTotal - pausedNow) / 1000),
				),
			);
		};

		tick();
		const interval = window.setInterval(tick, 500);
		return () => window.clearInterval(interval);
	}, [state]);

	// The pill is the only part of this window that should catch the cursor.
	// Re-registered only when its rect actually changes (the timer widening
	// past a minute), so a running recording costs no IPC at all.
	useEffect(() => {
		const element = barRef.current;
		if (!element) return;

		const sync = () => {
			const rect = element.getBoundingClientRect();
			const bounds = {
				position: { x: Math.round(rect.left), y: Math.round(rect.top) },
				size: {
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				},
			};
			const key = `${bounds.position.x},${bounds.position.y},${bounds.size.width},${bounds.size.height}`;
			if (key === lastBoundsRef.current) return;
			lastBoundsRef.current = key;
			void commands
				.setFakeWindowBounds(INTERACTIVE_AREA, bounds)
				.catch(() => {});
		};

		const observer = new ResizeObserver(sync);
		observer.observe(element);
		sync();

		return () => {
			observer.disconnect();
			void commands.removeFakeWindow(INTERACTIVE_AREA).catch(() => {});
		};
	}, []);

	const run = async (
		action: () => Promise<
			{ status: "ok" } | { status: "error"; error: string }
		>,
	) => {
		setBusy(true);
		const result = await action();
		if (result.status === "error") {
			setIssue(result.error);
			setBusy(false);
		}
	};

	const discard = async () => {
		// Irreversible — the take is deleted, not saved. Same confirmation the
		// library's own delete uses (TargetCard.tsx).
		if (!(await ask("Discard this recording? It won't be saved."))) return;
		await run(() => commands.discardRecording());
	};

	const paused = state === "paused";
	const idle = state === "stopped";
	const controlsDisabled = busy || idle || state === "countdown";

	return (
		<div className="flex h-screen w-screen select-none items-center justify-center">
			<div
				ref={barRef}
				title={issue ?? undefined}
				style={{ height: BAR_HEIGHT }}
				data-tauri-drag-region
				className="flex items-center gap-1 rounded-2xl border border-gray-12/10 bg-gray-1/90 px-2.5 shadow-lg shadow-black/10"
			>
				<span
					className={cn(
						"pr-0.5 text-[13px] font-bold tabular-nums leading-none",
						state === "recording" && "text-red-9",
						paused && "text-accent-400",
						(state === "countdown" || idle) && "text-gray-10",
					)}
				>
					{state === "countdown" ? countdown : formatElapsed(elapsed)}
				</span>

				<div className="h-5 w-px shrink-0 rounded-full bg-gray-12/12" />

				<button
					type="button"
					onClick={() => void run(() => commands.stopRecording())}
					disabled={busy || idle}
					title="Stop recording"
					aria-label="Stop recording"
					className="relative flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-10 text-white outline-none transition-[background-color,transform] duration-150 hover:brightness-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-red-9/50 disabled:pointer-events-none disabled:opacity-45"
				>
					<div className="size-4.5 bg-white rounded-full flex items-center justify-center">
						<span className="size-2 rounded-[3px] bg-red-10" />
					</div>
					{issue && (
						<span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-gray-1 text-accent-400 shadow-sm">
							<IconWarning className="size-2.5" />
						</span>
					)}
				</button>

				<PillButton
					label={paused ? "Resume recording" : "Pause recording"}
					disabled={controlsDisabled}
					onClick={() =>
						void run(() =>
							paused ? commands.resumeRecording() : commands.pauseRecording(),
						)
					}
				>
					{paused ? (
						<IconPlay className="size-3.5 fill-gray-10" />
					) : (
						<IconPause className="size-3.5 fill-current" />
					)}
				</PillButton>

				{hasMicrophone && (
					<PillButton
						label={micMuted ? "Unmute microphone" : "Mute microphone"}
						disabled={controlsDisabled}
						onClick={() => {
							const next = !micMuted;
							setMicMuted(next);
							void commands.setRecordingMicMuted(next).then((result) => {
								// Trust the backend's answer over the optimistic flip.
								if (result.status === "ok") setMicMuted(result.data);
								else {
									setMicMuted(!next);
									setIssue(result.error);
								}
							});
						}}
					>
						{micMuted ? (
							<IconMicOff className="size-3.5" />
						) : (
							<IconMic className="size-3.5" />
						)}
					</PillButton>
				)}

				<PillButton
					label="Restart recording"
					disabled={controlsDisabled}
					onClick={() => void run(() => commands.restartRecording())}
				>
					<IconRestart className="size-3.5" />
				</PillButton>

				<PillButton
					label="Discard recording"
					disabled={busy || idle}
					onClick={() => void discard()}
				>
					<IconTrash className="size-3.5" />
				</PillButton>
			</div>
		</div>
	);
}
