import { Select } from "@quiro/ui";
import { useEffect, useState } from "react";
import IconLucideBox from "~icons/lucide/box";
import IconLucideCrop from "~icons/lucide/crop";
import IconLucideMinus from "~icons/lucide/minus";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideScan from "~icons/lucide/scan";
import IconLucideSlidersHorizontal from "~icons/lucide/sliders-horizontal";
import { AnnotationTools } from "./AnnotationTools";
import { CropDialog } from "./CropDialog";
import { ASPECT_RATIO_OPTIONS } from "./constants";
import { useScreenshotEditorContext } from "./context";
import { clampZoom, DEFAULT_VIEWPORT, type Viewport } from "./Preview";
import { EditorButton, ToolbarDivider } from "./ui";

// Structurally Cap's editor header — every control is its own always-visible
// button — anchored to the bottom of the canvas instead of the top of the
// window, and styled to match the app's other floating pill
// (ToolbarWindow.tsx). Background / Padding / Rounding / Shadow / Border,
// formerly their own popovers here, now live in the persistent StylePanel;
// Perspective stays a popover since it's an occasional adjustment, not
// something worth permanent screen space.

export function Toolbar({
	viewport,
	onViewportChange,
}: {
	viewport: Viewport;
	onViewportChange: (viewport: Viewport) => void;
}) {
	const { project, setProject, rightPanel, toggleRightPanel } =
		useScreenshotEditorContext();

	// Crop is a modal dialog rather than a popover: it needs the whole image at
	// a workable size, which does not fit in a toolbar bubble.
	const [cropOpen, setCropOpen] = useState(false);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key.toLowerCase() !== "s") return;

			// Never steal a keystroke going into a field.
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}

			event.preventDefault();
			toggleRightPanel("style");
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [toggleRightPanel]);

	if (!project) return null;

	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-11 z-30 flex justify-center">
			<div
				data-editor-toolbar
				className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-gray-a5 bg-transparent-window p-1.5 shadow-xl backdrop-blur-xl"
			>
				<AnnotationTools />
				<ToolbarDivider />
				<EditorButton
					icon={<IconLucideSlidersHorizontal className="size-4" />}
					tooltip="Style"
					kbd={["S"]}
					active={rightPanel === "style"}
					onClick={() => toggleRightPanel("style")}
				/>
				<EditorButton
					icon={<IconLucideBox className="size-4" />}
					tooltip="Transform"
					active={rightPanel === "transform"}
					onClick={() => toggleRightPanel("transform")}
				/>
				<EditorButton
					icon={<IconLucideCrop className="size-4" />}
					tooltip="Crop"
					active={cropOpen}
					onClick={() => setCropOpen(true)}
				/>
				<CropDialog open={cropOpen} onOpenChange={setCropOpen} />
				<ToolbarDivider />

				{/* Shape of the exported canvas — the screenshot keeps its size and
				    the background grows to fill (Cap's `get_base_size`). */}
				<Select
					variant="light"
					className="h-8! w-fit! text-xs"
					options={ASPECT_RATIO_OPTIONS.map(({ label }) => ({
						value: label,
						label,
					}))}
					value={
						ASPECT_RATIO_OPTIONS.find(
							(option) => option.value === (project.aspectRatio ?? null),
						)?.label ?? "Auto"
					}
					onValueChange={(label) => {
						const next = ASPECT_RATIO_OPTIONS.find(
							(option) => option.label === label,
						);
						if (next) setProject({ ...project, aspectRatio: next.value });
					}}
				/>

				<ToolbarDivider />
				<EditorButton
					icon={<IconLucideMinus className="size-4" />}
					tooltip="Zoom out"
					kbd={["meta", "-"]}
					onClick={() =>
						onViewportChange({
							...viewport,
							zoom: clampZoom(viewport.zoom - 0.1),
						})
					}
				/>
				<EditorButton
					icon={<IconLucideScan className="size-4" />}
					label={`${Math.round(viewport.zoom * 100)}%`}
					tooltip="Reset zoom and position"
					kbd={["meta", "0"]}
					onClick={() => onViewportChange(DEFAULT_VIEWPORT)}
				/>
				<EditorButton
					icon={<IconLucidePlus className="size-4" />}
					tooltip="Zoom in"
					kbd={["meta", "+"]}
					onClick={() =>
						onViewportChange({
							...viewport,
							zoom: clampZoom(viewport.zoom + 0.1),
						})
					}
				/>
			</div>
		</div>
	);
}
