import { useEditorContext } from "../context";
import { useTimeline } from "./context";
import { SegmentContent, SegmentRoot } from "./Track";

export function CaptionsTrack() {
	const { project, selection, setSelection } = useEditorContext();
	const timeline = useTimeline();

	const segments = project?.captions?.segments ?? [];

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
						color="var(--track-caption)"
						selected={
							selection?.type === "caption" && selection.index === index
						}
						left={timeline.xOf(segment.start)}
						width={width}
						title={segment.text}
						onPointerDown={(event) => {
							event.stopPropagation();
							setSelection({ type: "caption", index });
						}}
					>
						<SegmentContent width={width}>
							<span className="pointer-events-none truncate text-[0.625rem] font-medium text-white/90">
								{segment.text}
							</span>
						</SegmentContent>
					</SegmentRoot>
				);
			})}
		</>
	);
}
