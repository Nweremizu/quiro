import { cn } from "@quiro/ui";
import type { ComponentProps, ReactNode } from "react";

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
	children,
	...props
}: Omit<ComponentProps<"div">, "color"> & {
	color: string;
	selected?: boolean;
	left: number;
	width: number;
}) {
	return (
		<div
			className={cn(
				"absolute inset-y-0 overflow-visible rounded-xl border border-transparent",
				selected && "ring-2 ring-accent-700",
				className,
			)}
			style={{ transform: `translateX(${left}px)`, width: `${width}px` }}
			{...props}
		>
			<div
				className="track-segment-fill group relative flex h-full flex-row overflow-hidden rounded-xl"
				style={{ "--seg-color": color } as React.CSSProperties}
			>
				{children}
			</div>
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

/** Drag handle at a segment edge. Fades in on hover, but stays partly visible
 * on narrow segments where there is no room to discover it. */
export function SegmentHandle({
	position,
	width,
	onPointerDown,
	label,
}: {
	position: "start" | "end";
	width: number;
	onPointerDown: (event: React.PointerEvent) => void;
	label: string;
}) {
	const compact = width < 40;

	return (
		<button
			type="button"
			aria-label={label}
			onPointerDown={onPointerDown}
			className={cn(
				"absolute inset-y-0 z-10 flex w-5 cursor-col-resize items-center justify-center transition-opacity",
				position === "start"
					? "left-0 -translate-x-1/2"
					: "right-0 translate-x-1/2",
				compact ? "opacity-55" : "opacity-35 group-hover:opacity-100",
			)}
		>
			<div className="h-8 w-[3px] rounded-full bg-white" />
		</button>
	);
}
