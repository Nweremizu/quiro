import { useRef, useState } from "react";
import { DevDials } from "@/dev/DevDials";
import { ClipsSidebar } from "./ClipsSidebar";
import { ConfigSidebar } from "./ConfigSidebar";
import { EditorProvider, useEditorContext } from "./context";
import { EditorErrorScreen } from "./EditorErrorScreen";
import { EditorSkeleton } from "./editor-skeleton";
import { Header } from "./Header";
import { Player } from "./Player";
import { ThreeSpike } from "./spike/ThreeSpike";
import { Timeline } from "./Timeline";
import { EditorCard } from "./ui";
import { useEditorShortcuts } from "./useEditorShortcuts";

// Cap's editor layout: a chrome-less header, then a row of cards — the player
// on the left, the config sidebar on the right — with the timeline docked
// underneath behind a drag-to-resize grip.

const MIN_TIMELINE_HEIGHT = 140;
const MAX_TIMELINE_HEIGHT = 480;
const DEFAULT_TIMELINE_HEIGHT = 240;
const RESIZE_HANDLE_HEIGHT = 12;
const TIMELINE_RESIZE_GRIP_MARKS = [0, 1, 2];

export default function EditorRoute() {
	return (
		<EditorProvider>
			<Editor />
			{/* Dev-only spring tuning; compiles to nothing in production. */}
			<DevDials />
		</EditorProvider>
	);
}

function Editor() {
	const {
		instance,
		loadError,
		undo,
		redo,
		clipsOpen,
		setClipsOpen,
		selection,
		setSelection,
		togglePlay,
		splitMode,
		setSplitMode,
	} = useEditorContext();

	const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE_HEIGHT);
	// Dev-only prototype surface (Ctrl+Shift+3). Nothing ships behind it and
	// the normal player is untouched when it is closed.
	const [spikeOpen, setSpikeOpen] = useState(false);
	const [resizing, setResizing] = useState(false);
	const resizeRef = useRef({ startY: 0, startHeight: 0 });

	// One table for the editor's shortcuts, so nothing shadows anything else.
	useEditorShortcuts([
		{
			combo: "Mod+Shift+Digit3",
			handler: () => setSpikeOpen((open) => !open),
			when: () => import.meta.env.DEV,
		},
		{ combo: "Mod+KeyZ", handler: undo },
		{ combo: "Mod+Shift+KeyZ", handler: redo },
		{ combo: "Mod+KeyY", handler: redo },
		{ combo: "Space", handler: togglePlay },
		{ combo: "KeyS", handler: () => setSplitMode(!splitMode) },
		{
			combo: "Escape",
			handler: () => setSelection(null),
			when: () => selection !== null,
		},
	]);

	// Dragging the grip upwards grows the timeline, so the delta is inverted.
	const startResize = (event: React.PointerEvent) => {
		event.preventDefault();
		setResizing(true);
		resizeRef.current = { startY: event.clientY, startHeight: timelineHeight };

		const move = (moveEvent: PointerEvent) => {
			const delta = resizeRef.current.startY - moveEvent.clientY;
			setTimelineHeight(
				Math.min(
					Math.max(resizeRef.current.startHeight + delta, MIN_TIMELINE_HEIGHT),
					MAX_TIMELINE_HEIGHT,
				),
			);
		};

		const up = () => {
			setResizing(false);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	if (loadError) return <EditorErrorScreen error={loadError} />;

	// Until the instance is built there is nothing to draw into any of the
	// panels, so the whole editor renders as its own skeleton.
	if (!instance) return <EditorSkeleton />;

	return (
		<div className="flex h-full min-h-0 max-h-full w-full flex-col overflow-hidden bg-gray-1 dark:bg-gray-1">
			<Header />

			<div
				data-tauri-drag-region
				className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-hidden leading-5"
			>
				<div className="flex min-h-0 basis-0 flex-1 flex-col overflow-hidden">
					<div className="flex min-h-0 basis-0 flex-1 flex-row overflow-hidden px-2">
						<div className="mr-2 flex h-full min-h-0 max-h-full w-104 min-w-104 flex-none overflow-hidden">
							{clipsOpen ? (
								<ClipsSidebar onClose={() => setClipsOpen(false)} />
							) : (
								<ConfigSidebar />
							)}
						</div>
						<EditorCard className="min-w-0 flex-1">
							{spikeOpen ? (
								<ThreeSpike onClose={() => setSpikeOpen(false)} />
							) : (
								<Player />
							)}

							<div
								role="separator"
								aria-orientation="horizontal"
								aria-label="Resize timeline height"
								onPointerDown={startResize}
								style={{ height: `${RESIZE_HANDLE_HEIGHT}px` }}
								className="group flex shrink-0 cursor-row-resize select-none flex-col items-center justify-center gap-0.5 border-t border-gray-4 bg-gray-2/95 transition-colors hover:bg-gray-3/70 dark:border-gray-5 dark:bg-gray-3/55"
							>
								{TIMELINE_RESIZE_GRIP_MARKS.map((mark) => (
									<div
										key={mark}
										className={
											resizing
												? "h-0.5 w-20 max-w-[85%] rounded-full bg-gray-9 dark:bg-gray-11"
												: "h-0.5 w-20 max-w-[85%] rounded-full bg-gray-6 transition-colors group-hover:bg-gray-9 dark:bg-gray-7 dark:group-hover:bg-gray-11"
										}
									/>
								))}
							</div>
						</EditorCard>
					</div>

					<div
						className="relative min-h-0 flex-none overflow-hidden px-2 pb-2"
						style={{
							height: `${timelineHeight}px`,
							flexBasis: `${timelineHeight}px`,
						}}
					>
						<Timeline />
					</div>
				</div>
			</div>
		</div>
	);
}
