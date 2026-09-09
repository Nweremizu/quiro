import { cn } from "@quiro/ui";
import type { CSSProperties } from "react";

export function SplitCursor({
	position,
}: {
	position: { x: number; y: number };
}) {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none fixed z-[100] rotate-270 -translate-x-0.5 -translate-y-0.5"
			style={{ left: position.x, top: position.y }}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="32"
				height="32"
				fill="currentColor"
				viewBox="0 0 256 256"
				className="invert!"
			>
				<path d="M236.52,187.09l-143-97.87a36,36,0,1,0-14.38,17.27l21.39,21.69L79.15,149.54l0,0a35.91,35.91,0,1,0,14.38,17.27l26.91-18.41L170,198.64a32.26,32.26,0,0,0,22.7,9.37,31.52,31.52,0,0,0,4.11-.27l.28,0,36.27-6.11a8,8,0,0,0,3.19-14.5Zm-162.38-97A20,20,0,1,1,80,76,20,20,0,0,1,74.14,90.13Zm0,104A20,20,0,1,1,80,180,20,20,0,0,1,74.14,194.15Zm61-101.5L169.94,57.4a32.19,32.19,0,0,1,26.84-9.14l.28,0,36,6.07a8.21,8.21,0,0,1,6.09,4.42,8,8,0,0,1-2.67,10.12l-69.93,47.85a4,4,0,0,1-4.51,0l-26.31-18A4,4,0,0,1,135.18,92.65Z"></path>
			</svg>
		</div>
	);
}

export function MergeOverlay({
	left,
	frozen = false,
}: {
	left: number;
	frozen?: boolean;
}) {
	const style = { left: `${left}px` } satisfies CSSProperties;
	return (
		<div
			aria-hidden="true"
			className={cn(
				"timeline-merge-overlay pointer-events-none absolute inset-y-0 z-30",
				frozen && "timeline-merge-overlay-frozen",
			)}
			style={style}
		>
			<div className="timeline-merge-pill absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-gray-12 text-gray-1 shadow-lg">
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
					<path
						d="m8 6 4-4 4 4M12 2v10.3a4 4 0 0 1-1.172 2.872C9.9 16.1 8.1 18.2 4 22M20 22c-2.1-2.2-3.8-3.9-5-5"
						stroke="#ff7a1a"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</div>
		</div>
	);
}
