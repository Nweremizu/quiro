import { activeAt, BoxOverlay } from "./BoxOverlay";
import type { OverlaySize } from "./CanvasElementsOverlay";
import { useEditorContext } from "./context";

// Outlines for the mask segments covering the playhead. The blur or
// highlight itself is drawn by the renderer, so this must not tint the box as
// well — doing so double-darkened the region and misrepresented the result.
export function MaskOverlay({ size }: { size: OverlaySize }) {
	const { project, setProject, playbackTime, selection, setSelection } =
		useEditorContext();

	const masks = activeAt(project?.timeline?.maskSegments, playbackTime);
	if (masks.length === 0) return null;

	return (
		<div className="absolute inset-0 overflow-hidden">
			{masks.map(({ segment, index }) => (
				<BoxOverlay
					key={`${segment.start}-${index}`}
					box={{ center: segment.center, size: segment.size }}
					size={size}
					tint={
						segment.maskType === "highlight" ? "border-amber-9" : "border-red-9"
					}
					selected={selection?.type === "mask" && selection.index === index}
					onSelect={() => setSelection({ type: "mask", index })}
					onChange={(box) =>
						setProject((current) =>
							current.timeline
								? {
										...current,
										timeline: {
											...current.timeline,
											maskSegments: (current.timeline.maskSegments ?? []).map(
												(mask, i) => (i === index ? { ...mask, ...box } : mask),
											),
										},
									}
								: current,
						)
					}
				/>
			))}
		</div>
	);
}
