import type { ComponentType } from "react";
import { useEffect } from "react";
import IconLucideArrowUpRight from "~icons/lucide/arrow-up-right";
import IconLucideCircle from "~icons/lucide/circle";
import IconLucideEyeOff from "~icons/lucide/eye-off";
import IconLucideFocus from "~icons/lucide/focus";
import IconLucideLayers from "~icons/lucide/layers";
import IconLucideMousePointer2 from "~icons/lucide/mouse-pointer-2";
import IconLucideSquare from "~icons/lucide/square";
import IconLucideType from "~icons/lucide/type";
import {
	type ScreenshotEditorTool,
	useScreenshotEditorContext,
} from "./context";
import { EditorButton, ToolbarDivider } from "./ui";

// React port of Cap's `AnnotationTools.tsx`, with their keyboard shortcuts.

const TOOLS: Array<{
	tool: ScreenshotEditorTool;
	icon: ComponentType<{ className?: string }>;
	label: string;
	shortcut: string;
}> = [
	{
		tool: "select",
		icon: IconLucideMousePointer2,
		label: "Select",
		shortcut: "V",
	},
	{
		tool: "arrow",
		icon: IconLucideArrowUpRight,
		label: "Arrow",
		shortcut: "A",
	},
	{
		tool: "rectangle",
		icon: IconLucideSquare,
		label: "Rectangle",
		shortcut: "R",
	},
	{ tool: "mask", icon: IconLucideEyeOff, label: "Mask", shortcut: "M" },
	{ tool: "circle", icon: IconLucideCircle, label: "Circle", shortcut: "C" },
	{ tool: "text", icon: IconLucideType, label: "Text", shortcut: "T" },
	{ tool: "focus", icon: IconLucideFocus, label: "Focus", shortcut: "F" },
];

export function AnnotationTools() {
	const {
		activeTool,
		setActiveTool,
		setSelectedAnnotationId,
		layersPanelOpen,
		setLayersPanelOpen,
	} = useScreenshotEditorContext();

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;

			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}

			// Picking a tool by accident should not trap you in it.
			if (event.key === "Escape") {
				event.preventDefault();
				setActiveTool("select");
				setSelectedAnnotationId(null);
				return;
			}

			const key = event.key.toLowerCase();
			if (key === "l") {
				event.preventDefault();
				setLayersPanelOpen(!layersPanelOpen);
				return;
			}

			const match = TOOLS.find((entry) => entry.shortcut.toLowerCase() === key);
			if (!match) return;
			event.preventDefault();
			setActiveTool(match.tool);
			if (match.tool !== "select") setSelectedAnnotationId(null);
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		layersPanelOpen,
		setLayersPanelOpen,
		setActiveTool,
		setSelectedAnnotationId,
	]);

	// A tool is armed for the canvas, so clicking anywhere that is not the
	// canvas — the titlebar, a side panel, the surrounding chrome — means you
	// are done with it. Without this the only way out is Escape or a round trip
	// through the toolbar, and the crosshair follows you across the whole app.
	useEffect(() => {
		if (activeTool === "select") return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target?.closest) return;

			// The canvas is the tool's workspace, and the toolbar (plus anything it
			// portals out — popovers, dialogs) is how the tool is operated. Clicks
			// there are part of using it, not leaving it.
			if (
				target.closest(
					"[data-editor-canvas], [data-editor-toolbar], [role=dialog], .ui-popover",
				)
			)
				return;

			setActiveTool("select");
		};

		// Capture phase: this has to win even where a panel stops propagation.
		window.addEventListener("pointerdown", handlePointerDown, true);
		return () =>
			window.removeEventListener("pointerdown", handlePointerDown, true);
	}, [activeTool, setActiveTool]);

	return (
		<>
			<EditorButton
				icon={<IconLucideLayers className="size-4" />}
				tooltip="Layers"
				kbd={["L"]}
				active={layersPanelOpen}
				onClick={() => setLayersPanelOpen(!layersPanelOpen)}
			/>
			<ToolbarDivider />
			{TOOLS.map(({ tool, icon: Icon, label, shortcut }) => (
				<EditorButton
					key={tool}
					icon={<Icon className="size-4" />}
					tooltip={label}
					kbd={[shortcut]}
					active={activeTool === tool}
					onClick={() => {
						setActiveTool(tool);
						// Leaving the select tool with something still selected would
						// keep its resize handles on screen over the new drawing.
						if (tool !== "select") setSelectedAnnotationId(null);
					}}
				/>
			))}
		</>
	);
}
