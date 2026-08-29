import { cn } from "@quiro/ui";
import type { RecordingMode } from "@/utils/tauri";

// Only Studio/Instant — Screenshot is a one-shot action (its own button in
// MainWindow), not a continuous-recording mode to toggle into. Two options
// don't warrant a whole drill-down page (see DeviceMenu's panels); a native
// `title` tooltip on each option covers the "what does this mean" need.
export function ModeToggle({
	mode,
	disabled,
	onChange,
}: {
	mode: RecordingMode;
	disabled?: boolean;
	onChange: (mode: "studio" | "instant") => void;
}) {
	return (
		<div className="flex overflow-hidden rounded-xl border border-gray-5 bg-gray-2">
			<button
				type="button"
				disabled={disabled}
				onClick={() => onChange("studio")}
				title="Studio: higher quality, saved to your recordings library"
				className={cn(
					"flex-1 px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50",
					mode === "studio"
						? "bg-accent-400 text-white"
						: "text-gray-11 hover:bg-gray-3",
				)}
			>
				Studio
			</button>
			<button
				type="button"
				disabled={disabled}
				onClick={() => onChange("instant")}
				title="Instant: quick capture, saved to your recordings library"
				className={cn(
					"flex-1 border-l border-gray-5 px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50",
					mode === "instant"
						? "bg-accent-300 text-white"
						: "text-gray-11 hover:bg-gray-3",
				)}
			>
				Instant
			</button>
		</div>
	);
}
