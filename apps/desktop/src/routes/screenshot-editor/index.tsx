import { useState } from "react";
import { useEditorShortcuts } from "../editor/useEditorShortcuts";
import {
	ScreenshotEditorProvider,
	useScreenshotEditorContext,
} from "./context";
import { Header } from "./Header";
import { LayersPanel } from "./LayersPanel";
import { DEFAULT_VIEWPORT, Preview, type Viewport } from "./Preview";
import { RightPanel } from "./RightPanel";
import { SidePanel } from "./SidePanel";
import { ScreenshotEditorSkeleton } from "./screenshot-editor-skeleton";
import { Toolbar } from "./Toolbar";

export default function ScreenshotEditorRoute() {
	return (
		<ScreenshotEditorProvider>
			<Editor />
		</ScreenshotEditorProvider>
	);
}

function Editor() {
	const {
		instance,
		loadError,
		renameInstance,
		project,
		layersPanelOpen,
		history,
	} = useScreenshotEditorContext();
	useEditorShortcuts([
		{ combo: "Mod+KeyZ", handler: history.undo, when: () => history.canUndo },
		{
			combo: "Mod+Shift+KeyZ",
			handler: history.redo,
			when: () => history.canRedo,
		},
		{ combo: "Mod+KeyY", handler: history.redo, when: () => history.canRedo },
	]);

	const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);

	if (loadError) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-gray-1 px-8">
				<p
					role="alert"
					className="max-w-sm text-pretty text-center text-sm text-red-9"
				>
					{loadError}
				</p>
			</div>
		);
	}

	if (!instance || !project) return <ScreenshotEditorSkeleton />;

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-gray-1">
			<Header
				prettyName={instance.prettyName}
				path={instance.path}
				onRename={renameInstance}
			/>

			<div className="flex min-h-0 flex-1">
				{/* Both panels are collapsed by default and squeeze the canvas
				    rather than floating over it, so neither can cover the part of
				    the screenshot being worked on. `SidePanel` animates that
				    squeeze open and closed; the widths it is given have to match
				    the ones the panels render at (`w-56`/`w-60`/`w-72`), since it
				    clips them rather than reflowing them. */}
				<SidePanel open={layersPanelOpen} side="left" width="14rem">
					<LayersPanel />
				</SidePanel>

				<div className="relative min-h-0 flex-1 rounded-lg">
					<Preview viewport={viewport} onViewportChange={setViewport} />
					<Toolbar viewport={viewport} onViewportChange={setViewport} />
				</div>

				{/* One container, one width, whatever is inside it — see
				    RightPanel.tsx. */}
				<RightPanel />
			</div>
		</div>
	);
}
