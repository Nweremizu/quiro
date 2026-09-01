import { activeAt } from "./BoxOverlay";
import type { OverlaySize } from "./CanvasElementsOverlay";
import { useEditorContext } from "./context";

const DEFAULT_SPLIT_LAYOUT = {
	screenZoom: 1,
	screenPosition: { x: 0.5, y: 0.5 },
	cameraZoom: 1,
	cameraPosition: { x: 0.5, y: 0.5 },
};

/** In split-screen scenes each half is framed independently, so dragging
 * inside a half pans that source rather than moving a card around. */
export function SplitScreenOverlay({ size }: { size: OverlaySize }) {
	const { project, setProject, playbackTime } = useEditorContext();

	const scene = activeAt(project?.timeline?.sceneSegments, playbackTime).find(
		({ segment }) => segment.mode === "splitScreen",
	);
	if (!scene || size.width === 0) return null;

	const layout = scene.segment.splitLayout ?? DEFAULT_SPLIT_LAYOUT;

	const pan = (half: "screen" | "camera", event: React.PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();

		const startX = event.clientX;
		const startY = event.clientY;
		const origin =
			half === "screen" ? layout.screenPosition : layout.cameraPosition;

		const move = (moveEvent: PointerEvent) => {
			const position = {
				x: Math.min(
					Math.max(origin.x + (moveEvent.clientX - startX) / size.width, 0),
					1,
				),
				y: Math.min(
					Math.max(origin.y + (moveEvent.clientY - startY) / size.height, 0),
					1,
				),
			};

			setProject((current) =>
				current.timeline
					? {
							...current,
							timeline: {
								...current.timeline,
								sceneSegments: (current.timeline.sceneSegments ?? []).map(
									(segment, index) =>
										index === scene.index
											? {
													...segment,
													splitLayout: {
														...(segment.splitLayout ?? DEFAULT_SPLIT_LAYOUT),
														...(half === "screen"
															? { screenPosition: position }
															: { cameraPosition: position }),
													},
												}
											: segment,
								),
							},
						}
					: current,
			);
		};

		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	return (
		<div className="absolute inset-0 flex overflow-hidden">
			<button
				type="button"
				aria-label="Pan screen half"
				onPointerDown={(event) => pan("screen", event)}
				className="h-full flex-1 cursor-move border-r border-white/20 hover:bg-white/5"
			/>
			<button
				type="button"
				aria-label="Pan camera half"
				onPointerDown={(event) => pan("camera", event)}
				className="h-full flex-1 cursor-move hover:bg-white/5"
			/>
		</div>
	);
}
