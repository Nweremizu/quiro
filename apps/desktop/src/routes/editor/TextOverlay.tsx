import { useState } from "react";
import { activeAt, BoxOverlay } from "./BoxOverlay";
import type { OverlaySize } from "./CanvasElementsOverlay";
import { useEditorContext } from "./context";
import { textContentString, withTextContentString } from "./text-content";

// A handle for the text the *renderer* draws, not a second copy of it.
// Drawing the content here as well put a small duplicate over the real one
// and, because that duplicate was a button, swallowed the drag handle
// underneath it. Double-click opens an editor in place; everything else is
// just the outline and its resize handles.

export function TextOverlay({ size }: { size: OverlaySize }) {
	const { project, setProject, playbackTime, selection, setSelection } =
		useEditorContext();
	const [editingIndex, setEditingIndex] = useState<number | null>(null);

	const texts = activeAt(project?.timeline?.textSegments, playbackTime);
	if (texts.length === 0) return null;

	const updateSegment = (
		index: number,
		patch: Partial<(typeof texts)[number]["segment"]>,
	) =>
		setProject((current) =>
			current.timeline
				? {
						...current,
						timeline: {
							...current.timeline,
							textSegments: (current.timeline.textSegments ?? []).map(
								(segment, i) =>
									i === index ? { ...segment, ...patch } : segment,
							),
						},
					}
				: current,
		);

	return (
		<div className="absolute inset-0 overflow-hidden">
			{texts.map(({ segment, index }) => {
				const center = segment.center ?? { x: 0.5, y: 0.5 };
				const boxSize = segment.size ?? { x: 0.4, y: 0.12 };
				const editing = editingIndex === index;

				return (
					<BoxOverlay
						key={`${segment.start}-${index}`}
						box={{ center, size: boxSize }}
						size={size}
						tint="border-cyan-9"
						selected={selection?.type === "text" && selection.index === index}
						onSelect={() => setSelection({ type: "text", index })}
						onChange={(box) => updateSegment(index, box)}
						onDoubleClick={() => setEditingIndex(index)}
					>
						{editing && (
							<input
								autoFocus
								value={textContentString(segment.textContent)}
								onChange={(event) =>
									updateSegment(index, {
										textContent: withTextContentString(
											segment.textContent,
											event.target.value,
										),
									})
								}
								onPointerDown={(event) => event.stopPropagation()}
								onBlur={() => setEditingIndex(null)}
								onKeyDown={(event) => {
									event.stopPropagation();
									if (event.key === "Enter" || event.key === "Escape")
										setEditingIndex(null);
								}}
								// Covers the rendered text while typing so the two aren't
								// visible at once.
								className="absolute inset-0 z-10 w-full bg-black/70 text-center text-sm text-white outline-none"
							/>
						)}
					</BoxOverlay>
				);
			})}
		</div>
	);
}
