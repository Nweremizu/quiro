import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

// Window/Area recording only ever captures the target's own pixels — nothing
// outside it can leak into the recording no matter what's on screen there.
// This window exists purely as a visible-to-the-recorder aid: four black
// blinds dim everything on the display *outside* the recorded rect, so it's
// never ambiguous mid-recording what's actually being captured. It draws
// nothing of its own — recording.rs only creates this window at all for a
// Window/Area target, with the rect baked into the URL at creation.
export default function WindowCaptureOccluder() {
	const [searchParams] = useSearchParams();
	const x = Number(searchParams.get("x"));
	const y = Number(searchParams.get("y"));
	const width = Number(searchParams.get("width"));
	const height = Number(searchParams.get("height"));
	const hasBounds = [x, y, width, height].every(Number.isFinite);

	useEffect(() => {
		document.documentElement.setAttribute("data-transparent-window", "true");
		document.body.style.background = "transparent";
	}, []);

	if (!hasBounds) return null;

	return (
		<div className="pointer-events-none fixed inset-0">
			{/* Top */}
			<div
				className="absolute inset-x-0 top-0 bg-black/50"
				style={{ height: y }}
			/>
			{/* Bottom */}
			<div
				className="absolute inset-x-0 bottom-0 bg-black/50"
				style={{ top: y + height }}
			/>
			{/* Left */}
			<div
				className="absolute left-0 bg-black/50"
				style={{ top: y, width: x, height }}
			/>
			{/* Right */}
			<div
				className="absolute right-0 bg-black/50"
				style={{ top: y, left: x + width, height }}
			/>
		</div>
	);
}
