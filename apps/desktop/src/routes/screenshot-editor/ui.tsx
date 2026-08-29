import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@quiro/ui";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Tooltip } from "@/components/Tooltip";
import IconLucideChevronDown from "~icons/lucide/chevron-down";

// React ports of Cap's screenshot-editor `ui.tsx` primitives. Kept as their
// own module for the same reason Cap does: every popover in the toolbar is
// built from these three, so they have to look and behave identically or the
// toolbar stops reading as one coherent control surface.

/** Cap's `EditorButton`: icon (+ optional label) in a compact 32px pill that
 * highlights while its popover is open (`active`). */
export function EditorButton({
	icon,
	label,
	tooltip,
	kbd,
	active,
	disabled,
	onClick,
	children,
}: {
	icon: ReactNode;
	label?: string;
	tooltip: string;
	kbd?: string[];
	active?: boolean;
	disabled?: boolean;
	onClick?: () => void;
	children?: ReactNode;
}) {
	return (
		<Tooltip content={tooltip} kbd={kbd}>
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				aria-label={tooltip}
				className={cn(
					"flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] outline-none transition-colors duration-100",
					"focus-visible:ring-2 focus-visible:ring-accent-400/50 disabled:pointer-events-none disabled:opacity-45",
					active
						? "bg-accent-300 text-gray-1"
						: "text-gray-11 hover:bg-gray-3 hover:text-gray-12",
				)}
			>
				{icon}
				{/* The only caller passes a live zoom percentage here, so the
				    digits must not reflow the pill as they change. */}
				{label && <span className="tabular-nums">{label}</span>}
				{children}
			</button>
		</Tooltip>
	);
}

/** Section heading inside a popover, matching Cap's `Field`. */
export function Field({
	name,
	icon,
	value,
	children,
}: {
	name: string;
	icon?: ReactNode;
	value?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="flex flex-row items-center gap-1.5 text-xs font-medium text-gray-11">
				{icon}
				{name}
				{value && <span className="ml-auto text-gray-10">{value}</span>}
			</span>
			{children}
		</div>
	);
}

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
		<div className={cn("relative isolate w-full select-none", className)}>
			<div
				ref={trackRef}
				role="slider"
				tabIndex={disabled ? -1 : 0}
				aria-label={label}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={value}
				aria-valuetext={format(value)}
				aria-disabled={disabled}
				className={cn(
					"relative overflow-hidden bg-gray-3 outline-none transition-shadow",
					"focus-visible:ring-2 focus-visible:ring-accent-400/50",
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
									className="absolute top-1/2 bg-gray-8"
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

export function rgbToHex(rgb: [number, number, number]) {
	return `#${rgb
		.map((c) => c.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase()}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
	const cleaned = hex.trim().replace(/^#/, "");
	if (!/^[0-9a-f]{6}$/i.test(cleaned)) return null;
	const value = Number.parseInt(cleaned, 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Cap's `RgbInput`: a swatch that opens the native colour picker, paired with
 * an editable hex field. The hex field commits on Enter/blur and reverts to
 * the last good value if what was typed isn't a colour, so a half-typed hex
 * never propagates into the project as garbage.
 */
export function RgbInput({
	value,
	onChange,
}: {
	value: [number, number, number];
	onChange: (value: [number, number, number]) => void;
}) {
	const [text, setText] = useState(() => rgbToHex(value));
	const [editing, setEditing] = useState(false);

	// While not being edited the field mirrors the project; during editing it
	// holds whatever's typed, so a partial hex isn't overwritten mid-keystroke.
	const displayed = editing ? text : rgbToHex(value);

	const commit = (raw: string) => {
		const parsed = hexToRgb(raw);
		if (parsed) onChange(parsed);
		setEditing(false);
	};

	return (
		<div className="flex flex-row items-center gap-2">
			<label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-gray-5">
				<span
					className="block size-full"
					style={{ backgroundColor: rgbToHex(value) }}
				/>
				<input
					type="color"
					value={rgbToHex(value)}
					onChange={(e) => {
						const parsed = hexToRgb(e.target.value);
						if (parsed) onChange(parsed);
					}}
					className="absolute inset-0 cursor-pointer opacity-0"
				/>
			</label>
			<input
				type="text"
				value={displayed}
				spellCheck={false}
				onFocus={() => {
					setText(rgbToHex(value));
					setEditing(true);
				}}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						commit(e.currentTarget.value);
						e.currentTarget.blur();
					}
				}}
				onBlur={(e) => commit(e.target.value)}
				className="h-8 w-24 rounded-lg border border-gray-5 bg-gray-1 px-2 text-[13px] text-gray-12 outline-none transition-shadow focus:ring-1 focus:ring-accent-400"
			/>
		</div>
	);
}

export function ToolbarDivider() {
	return <div className="mx-0.5 h-5 w-px shrink-0 bg-gray-12/10" />;
}

/** A collapsible section of the style panel: an icon + title header that
 * toggles a body of fields, matching the always-visible inspector pattern
 * (as opposed to the toolbar's floating popovers). Uncontrolled — each
 * section remembers its own open state for the life of the panel. */
export function PanelSection({
	icon,
	title,
	trailing,
	defaultOpen = true,
	children,
}: {
	icon: ReactNode;
	title: string;
	/** Rendered before the chevron, e.g. an enable switch. */
	trailing?: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	return (
		<Collapsible.Root
			defaultOpen={defaultOpen}
			className="border-b border-gray-3"
		>
			<div className="flex h-10 shrink-0 items-center gap-1.5 px-3">
				<Collapsible.Trigger className="group flex flex-1 items-center gap-1.5 text-left outline-none">
					<span className="text-gray-11">{icon}</span>
					<span className="text-xs font-medium text-gray-12">{title}</span>
					<IconLucideChevronDown className="size-3.5 text-gray-9 transition-transform duration-150 group-data-[panel-open]:rotate-180" />
				</Collapsible.Trigger>
				{trailing}
			</div>
			<Collapsible.Panel className="overflow-hidden transition-[height] duration-150 ease-out">
				<div className="flex flex-col gap-4 px-3 pb-4">{children}</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}
