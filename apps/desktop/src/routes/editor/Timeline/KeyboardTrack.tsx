import { useEditorContext } from "../context";
import { useTimeline } from "./context";
import { SegmentContent, SegmentRoot } from "./Track";

/** Keystroke overlays are generated from the recording's keyboard events, so
 * they are shown and selectable but not draggable — regenerating replaces
 * them wholesale. */
export function KeyboardTrack() {
	const { project, selection, setSelection } = useEditorContext();
	const timeline = useTimeline();

	const segments = project?.timeline?.keyboardSegments ?? [];

	return (
		<>
			{segments.map((segment, index) => {
				const width = Math.max(
					(segment.end - segment.start) * timeline.pixelsPerSecond,
					8,
				);

				return (
					<SegmentRoot
						key={segment.id}
						color="var(--track-keyboard)"
						selected={
							selection?.type === "keyboard" && selection.index === index
						}
						left={timeline.xOf(segment.start)}
						width={width}
						title={segment.displayText}
						onPointerDown={(event) => {
							event.stopPropagation();
							setSelection({ type: "keyboard", index });
						}}
					>
						<SegmentContent width={width} className="justify-center">
							<span className="pointer-events-none truncate text-[0.625rem] font-semibold text-[var(--track-label)]">
								{segment.displayText}
							</span>
						</SegmentContent>
					</SegmentRoot>
				);
			})}
		</>
	);
}
