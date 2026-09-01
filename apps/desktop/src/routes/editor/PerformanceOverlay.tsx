import { useEffect, useRef, useState } from "react";
import { useEditorContext } from "./context";
import { useLatestFrame } from "./playback-store";

// Cap's performance overlay: preview frame rate and frame size, for telling
// "the renderer is slow" apart from "the preview socket is starved". Hidden
// until toggled with Ctrl+Shift+P, and never shown to normal users.

export function PerformanceOverlay() {
	const { playback, previewQuality } = useEditorContext();
	const latestFrame = useLatestFrame(playback);
	const [visible, setVisible] = useState(false);
	const [fps, setFps] = useState(0);

	const framesRef = useRef<number[]>([]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.ctrlKey && event.shiftKey && event.code === "KeyP") {
				event.preventDefault();
				setVisible((current) => !current);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		if (!latestFrame) return;

		// Timestamps of the frames from the last second, so the rate is a real
		// measurement rather than an average since the window opened.
		const now = performance.now();
		framesRef.current = [...framesRef.current, now].filter(
			(time) => now - time < 1000,
		);
		setFps(framesRef.current.length);
	}, [latestFrame]);

	if (!visible) return null;

	return (
		<div className="pointer-events-none absolute top-3 left-3 z-30 rounded-lg bg-black/70 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-white">
			<div>{fps} preview fps</div>
			<div>
				{latestFrame
					? `${latestFrame.width}×${latestFrame.height}`
					: "no frame"}
			</div>
			<div>quality: {previewQuality}</div>
		</div>
	);
}
