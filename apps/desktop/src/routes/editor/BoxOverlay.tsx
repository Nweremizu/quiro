import { cn } from "@quiro/ui";
import type { ReactNode } from "react";
import type { XY } from "@/utils/tauri";
import type { OverlaySize } from "./CanvasElementsOverlay";

// Masks and text boxes are both "a normalized rect on the frame you can move
// and resize", so they share this control. Coordinates are centre + size in
// [0,1] frame space, matching how the renderer stores them.

export type Box = { center: XY<number>; size: XY<number> };

const HANDLES = [
	{ id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
	{ id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
	{ id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
	{ id: "se", x: 1, y: 1, cursor: "nwse-resize" },
] as const;

const MIN_SIZE = 0.02;

export function BoxOverlay({
	box,
	size,
	selected,
	tint,
	children,
	onSelect,
	onChange,
	onDoubleClick,
}: {
	box: Box;
	size: OverlaySize;
	selected: boolean;
	/** Tailwind border colour for the outline. */
	tint: string;
	children?: ReactNode;
	onSelect: () => void;
	onChange: (box: Box) => void;
	onDoubleClick?: () => void;
}) {
	const left = (box.center.x - box.size.x / 2) * size.width;
	const top = (box.center.y - box.size.y / 2) * size.height;

	const drag = (
		event: React.PointerEvent,
		apply: (dx: number, dy: number) => Box,
	) => {
		event.preventDefault();
		event.stopPropagation();
		onSelect();

		const startX = event.clientX;
		const startY = event.clientY;

		const move = (moveEvent: PointerEvent) =>
			onChange(
				apply(
					(moveEvent.clientX - startX) / size.width,
					(moveEvent.clientY - startY) / size.height,
				),
			);

		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	return (
		<div
			className={cn(
				"absolute rounded-md border-2",
				selected ? tint : "border-transparent hover:border-white/40",
			)}
			style={{
				left: `${left}px`,
				top: `${top}px`,
				width: `${box.size.x * size.width}px`,
				height: `${box.size.y * size.height}px`,
			}}
		>
			{/* The frame content is drawn by the renderer, not here — this is only
			    the handle for moving it, so it must stay hit-testable. Anything
			    a caller adds as a child sits above it and has to opt out of
			    pointer events unless it is meant to take them (an editor). */}
			<button
				type="button"
				aria-label="Move"
				className="absolute inset-0 cursor-move"
				onDoubleClick={onDoubleClick}
				onPointerDown={(event) =>
					drag(event, (dx, dy) => ({
						...box,
						center: {
							x: Math.min(Math.max(box.center.x + dx, 0), 1),
							y: Math.min(Math.max(box.center.y + dy, 0), 1),
						},
					}))
				}
			/>

			{children}

			{selected &&
				HANDLES.map((handle) => (
					<button
						key={handle.id}
						type="button"
						aria-label={`Resize ${handle.id}`}
						style={{
							cursor: handle.cursor,
							left: `${handle.x * 100}%`,
							top: `${handle.y * 100}%`,
						}}
						className="absolute -ml-1.5 -mt-1.5 size-3 rounded-full border border-gray-1 bg-accent-border-selected"
						onPointerDown={(event) =>
							drag(event, (dx, dy) => {
								// Dragging a corner moves that edge only, so the opposite
								// corner stays pinned.
								const signX = handle.x === 0 ? -1 : 1;
								const signY = handle.y === 0 ? -1 : 1;

								const width = Math.max(box.size.x + dx * signX, MIN_SIZE);
								const height = Math.max(box.size.y + dy * signY, MIN_SIZE);

								return {
									center: {
										x: box.center.x + ((width - box.size.x) / 2) * signX,
										y: box.center.y + ((height - box.size.y) / 2) * signY,
									},
									size: { x: width, y: height },
								};
							})
						}
					/>
				))}
		</div>
	);
}

/** Segments whose span contains the playhead, with their real indices so
 * edits can be written back. */
export function activeAt<T extends { start: number; end: number }>(
	segments: T[] | undefined,
	time: number,
) {
	return (segments ?? [])
		.map((segment, index) => ({ segment, index }))
		.filter(({ segment }) => time >= segment.start && time <= segment.end);
}
