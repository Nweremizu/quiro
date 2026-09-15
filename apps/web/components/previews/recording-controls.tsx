"use client";

import { cn } from "cn";
import { Mic, MicOff, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

const BAR_HEIGHT = 44;
/** Demo-only cap — the real window has no such limit. Keeps the showcase
 * from sitting at a growing timer forever; loops back into the countdown
 * once a "take" hits 3:00. */
const MAX_ELAPSED_SECONDS = 180;

type State = "countdown" | "recording" | "paused" | "stopped";

type Timing = {
	startedAt: number;
	pausedTotal: number;
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
	children: ReactNode;
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

/**
 * Self-driving showcase of Quiro's floating recording-controls pill — the
 * real thing lives at apps/desktop/src/routes/ToolbarWindow.tsx, driven by
 * Tauri commands and recording events. This is a marketing-page stand-in:
 * same markup, same tokens, but the state machine drives itself (countdown
 * → recording → loops back after a stop) instead of talking to a backend.
 * Every button still does something real — this isn't a static screenshot.
 */
export function RecordingControls({ className }: { className?: string }) {
	const [state, setState] = useState<State>("countdown");
	const [countdown, setCountdown] = useState(3);
	const [elapsed, setElapsed] = useState(0);
	const [micMuted, setMicMuted] = useState(false);
	const [busy, setBusy] = useState(false);

	const timingRef = useRef<Timing>(freshTiming());

	const resetToCountdown = useCallback(() => {
		setMicMuted(false);
		setElapsed(0);
		setCountdown(3);
		setState("countdown");
	}, []);

	useEffect(() => {
		if (state !== "countdown") return;
		const timeout = setTimeout(() => {
			if (countdown <= 1) {
				timingRef.current = freshTiming();
				setElapsed(0);
				setState("recording");
				return;
			}
			setCountdown(countdown - 1);
		}, 700);
		return () => clearTimeout(timeout);
	}, [state, countdown]);

	// 500ms rather than per-frame: the readout only has second resolution.
	// Also where the 3:00 cap lives — hitting it resets straight back into
	// the countdown rather than passing through "stopped" first.
	useEffect(() => {
		if (state === "countdown" || state === "stopped") return;

		const tick = () => {
			const { startedAt, pausedTotal, pausedAt } = timingRef.current;
			const now = Date.now();
			const pausedNow = pausedAt === null ? 0 : now - pausedAt;
			const seconds = Math.max(
				0,
				Math.floor((now - startedAt - pausedTotal - pausedNow) / 1000),
			);
			if (seconds >= MAX_ELAPSED_SECONDS) {
				resetToCountdown();
				return;
			}
			setElapsed(seconds);
		};

		tick();
		const interval = window.setInterval(tick, 500);
		return () => window.clearInterval(interval);
	}, [state, resetToCountdown]);

	// Loops back into a fresh countdown after a beat, so the showcase stays
	// alive on the page instead of going permanently idle after Stop.
	useEffect(() => {
		if (state !== "stopped") return;
		const timeout = setTimeout(resetToCountdown, 1800);
		return () => clearTimeout(timeout);
	}, [state, resetToCountdown]);

	const run = (action: () => void) => {
		setBusy(true);
		action();
		window.setTimeout(() => setBusy(false), 200);
	};

	const paused = state === "paused";
	const idle = state === "stopped";
	const controlsDisabled = busy || idle || state === "countdown";

	return (
		<div
			style={{ height: BAR_HEIGHT }}
			className={cn(
				"flex items-center gap-1 rounded-2xl border border-gray-12/10 bg-gray-1/90 px-2.5 shadow-lg shadow-black/10",
				className,
			)}
		>
			<span
				className={cn(
					"pr-0.5 text-[13px] font-bold tabular-nums leading-none",
					state === "recording" && "text-red-9",
					paused && "text-accent-text",
					(state === "countdown" || idle) && "text-gray-10",
				)}
			>
				{state === "countdown" ? countdown : formatElapsed(elapsed)}
			</span>

			<div className="h-5 w-px shrink-0 rounded-full bg-gray-12/12" />

			<button
				type="button"
				onClick={() => run(() => setState("stopped"))}
				disabled={busy || idle}
				title="Stop recording"
				aria-label="Stop recording"
				className="relative flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-10 text-white outline-none transition-[background-color,transform] duration-150 hover:brightness-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-red-9/50 disabled:pointer-events-none disabled:opacity-45"
			>
				<div className="flex size-4.5 items-center justify-center rounded-full bg-white">
					<span className="size-2 rounded-[3px] bg-red-10" />
				</div>
			</button>

			<PillButton
				label={paused ? "Resume recording" : "Pause recording"}
				disabled={controlsDisabled}
				onClick={() =>
					run(() => {
						if (state === "paused") {
							const { pausedAt } = timingRef.current;
							if (pausedAt !== null) {
								timingRef.current.pausedTotal += Date.now() - pausedAt;
								timingRef.current.pausedAt = null;
							}
							setState("recording");
						} else if (state === "recording") {
							timingRef.current.pausedAt = Date.now();
							setState("paused");
						}
					})
				}
			>
				{paused ? (
					<Play className="size-3.5 fill-gray-10" />
				) : (
					<Pause className="size-3.5 fill-current" />
				)}
			</PillButton>

			<PillButton
				label={micMuted ? "Unmute microphone" : "Mute microphone"}
				disabled={controlsDisabled}
				onClick={() => setMicMuted((m) => !m)}
			>
				{micMuted ? (
					<MicOff className="size-3.5" />
				) : (
					<Mic className="size-3.5" />
				)}
			</PillButton>

			<PillButton
				label="Restart recording"
				disabled={controlsDisabled}
				onClick={() =>
					run(() => {
						timingRef.current = freshTiming();
						setElapsed(0);
						setState("recording");
					})
				}
			>
				<RotateCcw className="size-3.5" />
			</PillButton>

			<PillButton
				label="Discard recording"
				disabled={busy || idle}
				onClick={() => {
					if (!window.confirm("Discard this recording? It won't be saved."))
						return;
					run(() => setState("stopped"));
				}}
			>
				<Trash2 className="size-3.5" />
			</PillButton>
		</div>
	);
}
