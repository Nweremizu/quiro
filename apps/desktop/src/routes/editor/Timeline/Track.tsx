import { cn } from "@quiro/ui";
import type { ComponentProps, ReactNode } from "react";
import { handleWidthFor, startTimeDrag, useTimeline } from "./context";

// Cap's timeline building blocks: a fixed-height row, and segments drawn as
// absolutely-positioned cards filled with their track's colour.

export const TRACK_HEIGHT = "3.25rem";

export function TrackRoot({
	label,
	icon,
	height = TRACK_HEIGHT,
	children,
}: {
	label: string;
	icon: ReactNode;
	height?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-stretch gap-2">
			<div
				title={label}
				aria-label={label}
				className="flex w-8 shrink-0 items-center justify-center rounded-lg bg-gray-3 text-gray-11"
				style={{ height }}
			>
				{icon}
			</div>
			<div className="relative min-w-0 flex-1" style={{ height }}>
				{children}
			</div>
		</div>
	);
}

/** One segment. `color` is a CSS custom property value — the fill and its
 * darker border are both derived from it by `.track-segment-fill`. */
export function SegmentRoot({
	color,
	selected,
	left,
	width,
	className,
	handles,
	children,
	...props
}: Omit<ComponentProps<"div">, "color"> & {
	color: string;
	selected?: boolean;
	left: number;
	width: number;
	/** Trim handles. They sit outside the fill because the fill clips to its
	 * radius, and a handle straddling the segment edge would lose the half
	 * that hangs outside — its hit area with it. */
	handles?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"group absolute inset-y-0 overflow-visible rounded-xl border border-transparent",
				// Neutral rather than the accent: clip is now the brand orange, so
				// an accent-coloured ring would be invisible on the primary track.
				selected && "track-segment-selected",
				className,
			)}
			style={{ transform: `translateX(${left}px)`, width: `${width}px` }}
			{...props}
		>
			<div
				className="track-segment-fill relative flex h-full flex-row overflow-hidden rounded-xl"
				style={{ "--seg-color": color } as React.CSSProperties}
			>
				{children}
			</div>
			{handles}
		</div>
	);
}

export function SegmentContent({
	width,
	className,
	children,
}: {
	width: number;
	className?: string;
	children?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"relative flex h-full w-full flex-row items-center py-1",
				width < 100 ? "px-0" : "px-2",
				className,
			)}
		>
			{children}
		</div>
	);
}

/** Seconds one arrow key moves an edge. Shift takes the coarse step. */
const KEY_STEP = 0.1;
const KEY_STEP_COARSE = 1;
/** How far inside the segment edge the visible grip sits. The hit area still
 * straddles the edge; this moves only the bar, far enough in to clear the
 * fill's rounded corner and no further. */
const BAR_INSET = 3;

/** Drag handle at a segment edge — an ARIA slider, because that is what it is:
 * one value, adjustable by pointer or by arrow key. A `<button>` here took
 * focus and announced itself while doing nothing on Enter or Space, which left
 * trimming reachable by pointer alone. */
export function SegmentHandle({
	position,
	width,
	label,
	value,
	min,
	max,
	onAdjust,
}: {
	position: "start" | "end";
	/** Rendered width of the whole segment, in pixels. */
	width: number;
	label: string;
	/** Current edge time in seconds — announced, and what the step applies to. */
	value: number;
	min: number;
	max: number;
	/** Seconds to move the edge by: cumulative while dragging, one step per key. */
	onAdjust: (deltaSeconds: number) => void;
}) {
	const timeline = useTimeline();
	// Two handles must fit side by side. Below ~48px they share the segment
	// rather than overlap; pointer precision is poor there either way, which is
	// what the keyboard path is for.
	const handleWidth = handleWidthFor(width);
	const barPadding = Math.min(BAR_INSET * 2, handleWidth / 2);

	return (
		<div
			role="slider"
			tabIndex={0}
			aria-label={label}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			aria-valuetext={`${value.toFixed(2)} seconds`}
			onPointerDown={(event) => startTimeDrag(event, timeline, onAdjust)}
			onKeyDown={(event) => {
				const step = event.shiftKey ? KEY_STEP_COARSE : KEY_STEP;
				if (event.key === "ArrowLeft") onAdjust(-step);
				else if (event.key === "ArrowRight") onAdjust(step);
				else return;
				event.preventDefault();
				event.stopPropagation();
			}}
			className={cn(
				"absolute inset-y-0 z-10 flex cursor-col-resize items-center justify-center",
				// The box straddles the segment edge so the edge stays grabbable
				// from just outside it. The padding below then keeps the *bar* in
				// the half that lies over the segment — without it the bar sits on
				// the boundary and half of it hangs outside the fill, past the
				// rounded corner, which reads as the handle falling off.
				position === "start"
					? "left-0 -translate-x-1/2"
					: "right-0 translate-x-1/2",
			)}
			// Pixels, not a percentage: percentage padding resolves against the
			// containing block — the whole segment — which would push the bar in
			// by half the clip's width rather than half the handle's. The bar
			// centres at half the padding, hence the doubling; the clamp keeps it
			// inside the box on a segment too narrow for a full-size handle.
			style={{
				width: `${handleWidth}px`,
				paddingLeft: position === "start" ? barPadding : undefined,
				paddingRight: position === "end" ? barPadding : undefined,
			}}
		>
			{/* Half height, so the bar clears the fill's rounded corners on every
			    track height. Opacity rides the bar, not the slider, so it never
			    dims the focus ring; 75% is the floor at which --track-label clears
			    3:1 against every track fill, in both themes and at both gradient
			    stops. */}
			<div className="h-1/2 w-0.75 shrink-0 rounded-full bg-gray-1 opacity-75 transition-opacity group-hover:opacity-100" />
		</div>
	);
}
