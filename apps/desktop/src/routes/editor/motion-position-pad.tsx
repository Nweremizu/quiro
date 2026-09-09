import { motion, useReducedMotion } from "motion/react";
import { type PointerEvent, useEffect, useRef, useState } from "react";

type Position = { offsetX: number; offsetY: number };

const POINTS = [-0.5, 0, 0.5].flatMap((offsetY, row) =>
	[-0.5, 0, 0.5].map((offsetX, column) => ({
		offsetX,
		offsetY,
		label: `${["Top", "Middle", "Bottom"][row]} ${["left", "center", "right"][column]}`,
	})),
);
const percent = (value: number) => (0.08 + (value + 0.5) * 0.84) * 100;
const coordinate = (fraction: number) => {
	const value = Math.max(-0.5, Math.min(0.5, (fraction - 0.08) / 0.84 - 0.5));
	const nearest = Math.round(value * 2) / 2;
	return Math.abs(value - nearest) <= 0.08 ? nearest : value;
};

export function MotionPositionPad({
	value,
	onChange,
	onPreview,
	onCommit,
}: {
	value: Position;
	onChange: (value: Position) => void;
	onPreview: (value: Position) => void;
	onCommit: (value: Position) => void;
}) {
	const reduceMotion = useReducedMotion();
	const [draft, setDraft] = useState<Position | null>(null);
	const drag = useRef<{ pointerId: number; value: Position } | null>(null);
	const frame = useRef<number | null>(null);
	const callbacks = useRef({ onPreview, onCommit });
	callbacks.current = { onPreview, onCommit };
	const position = draft ?? value;

	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
			if (drag.current) callbacks.current.onCommit(drag.current.value);
		},
		[],
	);

	const read = (event: PointerEvent<HTMLDivElement>): Position => {
		const bounds = event.currentTarget.getBoundingClientRect();
		return {
			offsetX: coordinate((event.clientX - bounds.left) / bounds.width),
			offsetY: coordinate((event.clientY - bounds.top) / bounds.height),
		};
	};
	const finish = () => {
		if (!drag.current) return;
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
		const next = drag.current.value;
		drag.current = null;
		onCommit(next);
		setDraft(null);
	};

	return (
		<div className="flex flex-col gap-2">
			<div
				className="relative aspect-video cursor-crosshair touch-none select-none overflow-hidden rounded-xl bg-gray-3"
				onKeyDown={(event) => {
					const step = event.shiftKey ? 0.1 : 0.01;
					const delta = {
						ArrowLeft: [-step, 0],
						ArrowRight: [step, 0],
						ArrowUp: [0, -step],
						ArrowDown: [0, step],
					}[event.key];
					if (!delta || drag.current) return;
					event.preventDefault();
					onChange({
						offsetX: Math.max(-0.5, Math.min(0.5, position.offsetX + delta[0])),
						offsetY: Math.max(-0.5, Math.min(0.5, position.offsetY + delta[1])),
					});
				}}
				onPointerDown={(event) => {
					if (event.button !== 0 || drag.current) return;
					const next = read(event);
					event.currentTarget.setPointerCapture(event.pointerId);
					drag.current = { pointerId: event.pointerId, value: next };
					setDraft(next);
					onChange(next);
				}}
				onPointerMove={(event) => {
					if (drag.current?.pointerId !== event.pointerId) return;
					drag.current.value = read(event);
					if (frame.current !== null) return;
					frame.current = requestAnimationFrame(() => {
						frame.current = null;
						if (!drag.current) return;
						setDraft(drag.current.value);
						callbacks.current.onPreview(drag.current.value);
					});
				}}
				onPointerUp={(event) => {
					if (drag.current?.pointerId !== event.pointerId) return;
					drag.current.value = read(event);
					finish();
				}}
				onPointerCancel={finish}
				onLostPointerCapture={finish}
			>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-[8%] top-1/2 h-px bg-gray-5"
				/>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-[8%] left-1/2 w-px bg-gray-5"
				/>
				{POINTS.map((point) => (
					<button
						key={point.label}
						type="button"
						aria-label={`Position ${point.label.toLowerCase()}`}
						aria-pressed={
							position.offsetX === point.offsetX &&
							position.offsetY === point.offsetY
						}
						onClick={(event) => {
							if (event.detail === 0)
								onChange({ offsetX: point.offsetX, offsetY: point.offsetY });
						}}
						className="group absolute z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring/60"
						style={{
							left: `${percent(point.offsetX)}%`,
							top: `${percent(point.offsetY)}%`,
						}}
					>
						<span
							aria-hidden="true"
							className="size-1.5 rounded-full bg-gray-8 transition-transform duration-100 group-hover:scale-150 motion-reduce:transition-none"
						/>
					</button>
				))}
				<motion.div
					aria-hidden="true"
					initial={false}
					animate={{
						left: `${percent(position.offsetX)}%`,
						top: `${percent(position.offsetY)}%`,
					}}
					transition={
						reduceMotion || draft !== null
							? { duration: 0 }
							: { type: "spring", duration: 0.55, bounce: 0 }
					}
					className="pointer-events-none absolute z-20 size-0 transition-opacity duration-100 motion-reduce:transition-none"
				>
					<div className="dark-button-shadow absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-gray-5 shadow-sm">
						<span className="dark-button-shadow size-5 rounded-full border border-accent-border-selected bg-accent-solid shadow-sm" />
					</div>
				</motion.div>
			</div>
			<div className="flex justify-between text-[11px] tabular-nums text-gray-10">
				<span>Horizontal {Math.round(position.offsetX * 100)}%</span>
				<span>Vertical {Math.round(position.offsetY * 100)}%</span>
			</div>
		</div>
	);
}
