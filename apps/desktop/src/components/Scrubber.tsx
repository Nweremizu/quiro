import { cn } from "@quiro/ui";
import { useCallback, useEffect, useRef, useState } from "react";

// The scrubber: a slider whose whole body is the track, with its label inside
// on the left and the live value on the right.
//
// Shared by both editors — the screenshot editor's style panel and the video
// editor's config sidebar — so it lives here rather than in either route.

export type SliderSize = "xxs" | "xs" | "sm" | "md" | "lg" | "xl";

const SLIDER_SIZES = {
	xxs: {
		height: 24,
		radius: 6,
		thumbWidth: 2,
		thumbHeight: 12,
		labelSize: 10,
		valueSize: 9,
		paddingX: 8,
	},
	xs: {
		height: 32,
		radius: 8,
		thumbWidth: 3,
		thumbHeight: 18,
		labelSize: 11,
		valueSize: 11,
		paddingX: 10,
	},
	sm: {
		height: 40,
		radius: 10,
		thumbWidth: 4,
		thumbHeight: 24,
		labelSize: 13,
		valueSize: 13,
		paddingX: 12,
	},
	md: {
		height: 52,
		radius: 12,
		thumbWidth: 5,
		thumbHeight: 34,
		labelSize: 17,
		valueSize: 17,
		paddingX: 14,
	},
	lg: {
		height: 64,
		radius: 16,
		thumbWidth: 6,
		thumbHeight: 42,
		labelSize: 19,
		valueSize: 17,
		paddingX: 18,
	},
	xl: {
		height: 76,
		radius: 20,
		thumbWidth: 7,
		thumbHeight: 52,
		labelSize: 22,
		valueSize: 22,
		paddingX: 22,
	},
} as const;

const clampValue = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

/** Number of decimals implied by the step, so snapping to it does not leave
 * float noise (0.1 + 0.2 style) in the value that gets written to the project
 * file. Display formatting hides it; the stored config would not. */
const decimalsForStep = (step: number) => {
	const text = String(step);
	const dot = text.indexOf(".");
	return dot === -1 ? 0 : text.length - dot - 1;
};

const snapToStep = (value: number, step: number, min: number) =>
	Number(
		(Math.round((value - min) / step) * step + min).toFixed(
			decimalsForStep(step),
		),
	);

/**
 * Scrubber-style slider: the whole control is the track, with the label sitting
 * inside it on the left and the live value on the right. Replaces the thin
 * rail + knob this used to be.
 *
 * Deliberately has no animation library behind it. The two moving parts — the
 * fill/thumb position and the thumb's grow-on-hover — are CSS transitions, and
 * `motion-reduce:` turns them off. Position transitions are also disabled
 * mid-drag: easing toward the pointer makes a scrub feel laggy rather than
 * smooth.
 *
 * `onDragEnd` is the seam that makes one drag produce one undo entry instead of
 * one per pixel: callers pause history on the first change and resume here.
 */
export function Slider({
	value,
	onChange,
	onDragEnd,
	min,
	max,
	step = 1,
	format = (v: number) => String(Math.round(v)),
	label,
	ariaLabel,
	disabled,
	size = "xs",
	ticks = 0,
	className,
}: {
	value: number;
	onChange: (value: number) => void;
	onDragEnd?: () => void;
	min: number;
	max: number;
	step?: number;
	format?: (value: number) => string;
	/** Shown inside the track. Omit to render the value alone. */
	label?: string;
	/** For controls that show the value alone: what a screen reader announces,
	 * since there is no visible label to borrow. */
	ariaLabel?: string;
	disabled?: boolean;
	size?: SliderSize;
	/** Tick marks drawn across the track; 0 hides them. */
	ticks?: number;
	className?: string;
}) {
	const trackRef = useRef<HTMLDivElement>(null);
	const [dragging, setDragging] = useState(false);
	const [hovering, setHovering] = useState(false);

	const styles = SLIDER_SIZES[size];
	const range = max - min;
	const percentage =
		range > 0 ? ((clampValue(value, min, max) - min) / range) * 100 : 0;
	const active = dragging || hovering;

	const commit = useCallback(
		(next: number) =>
			onChange(clampValue(snapToStep(next, step, min), min, max)),
		[onChange, step, min, max],
	);

	const valueFromPointer = useCallback(
		(clientX: number) => {
			const track = trackRef.current;
			if (!track) return value;
			const rect = track.getBoundingClientRect();
			return min + clampValue((clientX - rect.left) / rect.width, 0, 1) * range;
		},
		[min, range, value],
	);

	// A pointermove can fire faster than the display refreshes, and every commit
	// re-renders the editor and re-renders the frame. Coalescing to one update
	// per frame keeps a fast scrub from queueing work it cannot keep up with.
	const pendingX = useRef<number | null>(null);
	const dragFrame = useRef<number | null>(null);

	const flushPending = useCallback(() => {
		if (dragFrame.current !== null) {
			cancelAnimationFrame(dragFrame.current);
			dragFrame.current = null;
		}
		const clientX = pendingX.current;
		pendingX.current = null;
		if (clientX !== null) commit(valueFromPointer(clientX));
	}, [commit, valueFromPointer]);

	useEffect(
		() => () => {
			if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
		},
		[],
	);

	// `isolate` on the root: the thumb / label / value below use z-index to
	// stack within the scrubber. Without a stacking context here those escape to
	// the document root and paint over portalled overlays like popovers.
	return (
		<div
			className={cn(
				"relative isolate w-full select-none font-sans antialiased",
				className,
			)}
		>
			<div
				ref={trackRef}
				role="slider"
				tabIndex={disabled ? -1 : 0}
				aria-label={ariaLabel ?? label}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={value}
				aria-valuetext={format(value)}
				aria-disabled={disabled}
				className={cn(
					"relative overflow-hidden bg-gray-3 outline-none transition-shadow",
					"focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50",
					disabled ? "pointer-events-none opacity-45" : "cursor-pointer",
				)}
				style={{
					height: styles.height,
					borderRadius: styles.radius,
					touchAction: "none",
				}}
				onMouseEnter={() => setHovering(true)}
				onMouseLeave={() => setHovering(false)}
				onPointerDown={(event) => {
					if (disabled) return;
					event.preventDefault();
					trackRef.current?.setPointerCapture(event.pointerId);
					setDragging(true);
					commit(valueFromPointer(event.clientX));
				}}
				onPointerMove={(event) => {
					if (!dragging) return;
					pendingX.current = event.clientX;
					if (dragFrame.current !== null) return;
					dragFrame.current = requestAnimationFrame(() => {
						dragFrame.current = null;
						const clientX = pendingX.current;
						pendingX.current = null;
						if (clientX !== null) commit(valueFromPointer(clientX));
					});
				}}
				onPointerUp={() => {
					if (!dragging) return;
					flushPending();
					setDragging(false);
					onDragEnd?.();
				}}
				onPointerCancel={() => {
					if (!dragging) return;
					flushPending();
					setDragging(false);
					onDragEnd?.();
				}}
				onKeyDown={(event) => {
					let next: number | undefined;
					switch (event.key) {
						case "ArrowRight":
						case "ArrowUp":
							next = value + step;
							break;
						case "ArrowLeft":
						case "ArrowDown":
							next = value - step;
							break;
						case "Home":
							next = min;
							break;
						case "End":
							next = max;
							break;
						default:
							return;
					}
					event.preventDefault();
					commit(next);
				}}
				onKeyUp={(event) => {
					// Keyboard nudges are discrete, so each one closes its own undo
					// entry rather than waiting for a pointer release that never comes.
					if (
						[
							"ArrowRight",
							"ArrowUp",
							"ArrowLeft",
							"ArrowDown",
							"Home",
							"End",
						].includes(event.key)
					)
						onDragEnd?.();
				}}
			>
				<div
					className="pointer-events-none absolute inset-y-0 left-0 bg-gray-5 motion-reduce:transition-none"
					style={{
						width: `${percentage}%`,
						borderRadius: styles.radius,
						transition: dragging
							? "none"
							: "width 150ms cubic-bezier(0.23, 1, 0.32, 1)",
					}}
				/>

				{ticks > 0 && (
					<div className="pointer-events-none absolute inset-0">
						{Array.from({ length: ticks }, (_, index) => {
							const position = ((index + 1) / (ticks + 1)) * 100;
							return (
								<div
									key={position}
									className="absolute top-1/2 bg-gray-8 font-sans"
									style={{
										left: `${position}%`,
										width: 1,
										height: styles.thumbHeight * 0.24,
										borderRadius: 999,
										transform: "translateX(-50%) translateY(-50%)",
									}}
								/>
							);
						})}
					</div>
				)}

				<div
					className="pointer-events-none absolute z-[3] motion-reduce:transition-none"
					style={{
						top: "50%",
						left: `${percentage}%`,
						transform: "translateX(-50%) translateY(-50%)",
						marginLeft: -6,
						transition: dragging
							? "none"
							: "left 150ms cubic-bezier(0.23, 1, 0.32, 1)",
					}}
				>
					<div
						className="bg-gray-12 motion-reduce:transition-none"
						style={{
							width: styles.thumbWidth,
							height: styles.thumbHeight,
							borderRadius: 999,
							opacity: active ? 0.8 : 0.15,
							transform: active ? "scale(1)" : "scale(0.7)",
							transition:
								"opacity 250ms cubic-bezier(0.22, 1, 0.36, 1), transform 250ms cubic-bezier(0.22, 1, 0.36, 1)",
						}}
					/>
				</div>

				{label && (
					<div
						className="pointer-events-none absolute top-1/2 z-[4] max-w-[45%] -translate-y-1/2 truncate whitespace-nowrap text-gray-12"
						style={{ left: styles.paddingX, fontSize: styles.labelSize }}
					>
						{label}
					</div>
				)}

				<div
					className="pointer-events-none absolute top-1/2 z-[4] -translate-y-1/2 font-mono text-gray-11"
					style={{
						right: styles.paddingX,
						fontVariantNumeric: "tabular-nums",
						fontSize: styles.valueSize,
						fontWeight: 500,
					}}
				>
					{format(value)}
				</div>
			</div>
		</div>
	);
}
