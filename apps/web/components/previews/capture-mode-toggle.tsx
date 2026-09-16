"use client";

import { Image, Video } from "lucide-react";
import { useState } from "react";

type CaptureMode = "screenshot" | "recording";

export function CaptureModeToggle() {
	const [mode, setMode] = useState<CaptureMode>("recording");
	const recording = mode === "recording";

	return (
		<div className="capture-mode-demo">
			<fieldset className="capture-mode-toggle" aria-label="Capture mode">
				<span
					className="capture-mode-highlight"
					aria-hidden="true"
					style={{ transform: `translateX(${recording ? 36 : 0}px)` }}
				/>
				<button
					type="button"
					aria-label="Screenshot"
					aria-pressed={!recording}
					onClick={() => setMode("screenshot")}
				>
					<Image aria-hidden="true" />
				</button>
				<button
					type="button"
					aria-label="Recording"
					aria-pressed={recording}
					onClick={() => setMode("recording")}
				>
					<Video aria-hidden="true" />
				</button>
			</fieldset>
			<span className="capture-mode-caption" aria-live="polite">
				{recording ? "Recording mode" : "Screenshot mode"}
			</span>
		</div>
	);
}
