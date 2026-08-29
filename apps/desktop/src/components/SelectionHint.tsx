import { type as ostype } from "@tauri-apps/plugin-os";
import CrtFrame from "./CrtFrame";

// The area picker's empty state: the CRT playing the click-and-drag gesture
// on a loop. The animation itself lives in App.css.

/** Windows' arrow pointer; macOS' is narrower with a longer tail. */
function CursorGlyph({ macos }: { macos: boolean }) {
	return (
		<svg viewBox="0 0 18 26" className="h-full w-full" aria-hidden="true">
			<path
				d={
					macos
						? "M2 1.5 15.5 15H9.2l3.4 7.6-2.7 1.2L6.5 16 2 20.4Z"
						: "M2 1.5 15.5 14.2H8.6l3.9 8.3-2.6 1.2-3.9-8.3-4 4.1Z"
				}
				fill="white"
				stroke="rgba(0,0,0,0.55)"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export default function SelectionHint({
	show,
	message = "Click and drag to select an area",
}: {
	show: boolean;
	message?: string;
}) {
	if (!show) return null;

	const macos = ostype() === "macos";

	return (
		<div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center px-4">
			<div className="flex flex-col items-center gap-6 text-center">
				<CrtFrame>
					<div className="quiro-crt-hint__selection" />
					<div className="quiro-crt-hint__cursor">
						<CursorGlyph macos={macos} />
					</div>
				</CrtFrame>

				<p className="max-w-md font-sans text-2xl font-semibold text-white drop-shadow-lg">
					{message}
				</p>
			</div>
		</div>
	);
}
