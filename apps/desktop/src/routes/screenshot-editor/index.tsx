import { useState } from "react";
import { AnnotationConfig } from "./AnnotationConfig";
import {
	ScreenshotEditorProvider,
	useScreenshotEditorContext,
} from "./context";
import { Header } from "./Header";
import { LayersPanel } from "./LayersPanel";
import { DEFAULT_VIEWPORT, Preview, type Viewport } from "./Preview";
import { StylePanel } from "./StylePanel";
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
		selectedAnnotationId,
		layersPanelOpen,
		stylePanelOpen,
	} = useScreenshotEditorContext();

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
		<div className="flex h-screen w-screen flex-col bg-gray-1">
			<Header
				prettyName={instance.prettyName}
				path={instance.path}
				onRename={renameInstance}
			/>

			<div className="flex min-h-0 flex-1">
				{/* Both panels are collapsed by default and squeeze the canvas
				    rather than floating over it, so neither can cover the part of
				    the screenshot being worked on. */}
				{layersPanelOpen && <LayersPanel />}

				<div className="relative min-h-0 flex-1 rounded-lg">
					<Preview viewport={viewport} onViewportChange={setViewport} />
					<Toolbar viewport={viewport} onViewportChange={setViewport} />
				</div>

				{/* Editing a selected shape takes priority over the general style
				    panel, since they'd otherwise fight for the same slot. */}
				{selectedAnnotationId ? (
					<AnnotationConfig />
				) : (
					stylePanelOpen && <StylePanel />
				)}
			</div>
		</div>
	);
}
