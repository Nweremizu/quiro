import { cn } from "@quiro/ui";
import { useRef, useState } from "react";
import type { XY } from "@/utils/tauri";
import { useEditorContext } from "./context";
import { useFrameLayout } from "./playback-store";
import {
	buildSnapTargets,
	type NormRect,
	SNAP_PX,
	type SnapGuide,
	snapMovingRect,
} from "./snapping";

// Cap's direct-manipulation layer: the display card and the camera bubble can
// be dragged around the frame, with Figma-style guides when an edge or centre
// lines up with the frame or the other element.

export type OverlaySize = { width: number; height: number };

/** The renderer reports rects in output pixels; overlays work in normalized
 * [0,1] frame space so they stay correct at any preview scale. */
function toNormRect(
	rect: [number, number, number, number],
	outputWidth: number,
	outputHeight: number,
): NormRect {
	return {
		x: rect[0] / outputWidth,
		y: rect[1] / outputHeight,
		w: rect[2] / outputWidth,
		h: rect[3] / outputHeight,
	};
}

export function CanvasElementsOverlay({ size }: { size: OverlaySize }) {
	const { project, setProject, playback } = useEditorContext();
	const frameLayout = useFrameLayout(playback);
	const [guides, setGuides] = useState<SnapGuide[]>([]);
	const [dragging, setDragging] = useState<"display" | "camera" | null>(null);
	const draggingRef = useRef<{ startX: number; startY: number } | null>(null);

	if (!project || !frameLayout || size.width === 0) return null;

	const { output_width: outputWidth, output_height: outputHeight } =
		frameLayout;
	const display = toNormRect(frameLayout.display, outputWidth, outputHeight);
	const camera = frameLayout.camera
		? toNormRect(frameLayout.camera, outputWidth, outputHeight)
		: null;

	const startDrag = (
		which: "display" | "camera",
		rect: NormRect,
		event: React.PointerEvent,
	) => {
		event.preventDefault();
		event.stopPropagation();

		setDragging(which);
		draggingRef.current = { startX: event.clientX, startY: event.clientY };

		const others = which === "display" ? (camera ? [camera] : []) : [display];
		const targets = buildSnapTargets(others, {
			margin: {
				x: project.background.padding / 100,
				y: project.background.padding / 100,
			},
		});

		const move = (moveEvent: PointerEvent) => {
			const origin = draggingRef.current;
			if (!origin) return;

			const dx = (moveEvent.clientX - origin.startX) / size.width;
			const dy = (moveEvent.clientY - origin.startY) / size.height;

			const moved: NormRect = {
				...rect,
				x: Math.min(Math.max(rect.x + dx, -rect.w / 2), 1 - rect.w / 2),
				y: Math.min(Math.max(rect.y + dy, -rect.h / 2), 1 - rect.h / 2),
			};

			const {
				dx: snapX,
				dy: snapY,
				guides,
			} = snapMovingRect(
				moved,
				targets,
				SNAP_PX / size.width,
				SNAP_PX / size.height,
			);
			setGuides(guides);

			const center: XY<number> = {
				x: moved.x + snapX + moved.w / 2,
				y: moved.y + snapY + moved.h / 2,
			};

			setProject((current) =>
				which === "camera"
					? {
							...current,
							camera: { ...current.camera, manualPosition: center },
						}
					: {
							...current,
							background: { ...current.background, displayPosition: center },
						},
			);
		};

		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			draggingRef.current = null;
			setDragging(null);
			setGuides([]);
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const box = (rect: NormRect) => ({
		left: `${rect.x * size.width}px`,
		top: `${rect.y * size.height}px`,
		width: `${rect.w * size.width}px`,
		height: `${rect.h * size.height}px`,
	});

	return (
		<div className="absolute inset-0 overflow-hidden">
			<button
				type="button"
				aria-label="Move screen recording"
				style={box(display)}
				onPointerDown={(event) => startDrag("display", display, event)}
				className={cn(
					"absolute cursor-move rounded-lg border-2 border-transparent transition-colors",
					dragging === "display"
						? "border-accent-800"
						: "hover:border-accent-800/60",
				)}
			/>

			{camera && !project.camera.hide && (
				<button
					type="button"
					aria-label="Move camera"
					style={box(camera)}
					onPointerDown={(event) => startDrag("camera", camera, event)}
					className={cn(
						"absolute cursor-move rounded-full border-2 border-transparent transition-colors",
						dragging === "camera"
							? "border-accent-800"
							: "hover:border-accent-800/60",
					)}
				/>
			)}

			{guides.map((guide) => (
				<div
					key={`${guide.axis}-${guide.pos}-${guide.kind}`}
					className="pointer-events-none absolute bg-red-9"
					style={
						guide.axis === "v"
							? {
									left: `${guide.pos * size.width}px`,
									top: `${guide.start * size.height}px`,
									height: `${(guide.end - guide.start) * size.height}px`,
									width: "1px",
								}
							: {
									top: `${guide.pos * size.height}px`,
									left: `${guide.start * size.width}px`,
									width: `${(guide.end - guide.start) * size.width}px`,
									height: "1px",
								}
					}
				/>
			))}
		</div>
	);
}
