import { cn } from "@quiro/ui";
import type { ComponentType } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@/utils/tauri";
import IconLucideArrowUpRight from "~icons/lucide/arrow-up-right";
import IconLucideCircle from "~icons/lucide/circle";
import IconLucideEyeOff from "~icons/lucide/eye-off";
import IconLucideFocus from "~icons/lucide/focus";
import IconLucideGripVertical from "~icons/lucide/grip-vertical";
import IconLucideImage from "~icons/lucide/image";
import IconLucideLayers from "~icons/lucide/layers";
import IconLucideSquare from "~icons/lucide/square";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideType from "~icons/lucide/type";
import IconLucideX from "~icons/lucide/x";
import { useScreenshotEditorContext } from "./context";
import { textContentString } from "./text-content";

// React port of Cap's `LayersPanel.tsx`.

const TYPE_ICONS: Record<
	Annotation["type"],
	ComponentType<{ className?: string }>
> = {
	arrow: IconLucideArrowUpRight,
	rectangle: IconLucideSquare,
	circle: IconLucideCircle,
	mask: IconLucideEyeOff,
	text: IconLucideType,
	focus: IconLucideFocus,
};

const TYPE_LABELS: Record<Annotation["type"], string> = {
	arrow: "Arrow",
	rectangle: "Rectangle",
	circle: "Circle",
	mask: "Mask",
	text: "Text",
	focus: "Focus",
};

function labelFor(annotation: Annotation) {
	if (annotation.type === "text") {
		const text = textContentString(annotation.textContent);
		if (text) return text;
	}
	return TYPE_LABELS[annotation.type];
}

export function LayersPanel() {
	const {
		annotations,
		setAnnotations,
		selectedAnnotationId,
		setSelectedAnnotationId,
		captureSelected,
		setCaptureSelected,
		setLayersPanelOpen,
		setActiveTool,
	} = useScreenshotEditorContext();

	const [draggedId, setDraggedId] = useState<string | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Focus is an image treatment, not a layer: it always composites first and
	// has no meaningful position in the stack, so it is held out of the
	// reorderable list and pinned below it.
	const focusAnnotation = annotations.find((a) => a.type === "focus") ?? null;
	const reorderable = annotations.filter((a) => a.type !== "focus");

	// Topmost annotation first, matching how they stack on the canvas — the
	// array itself is painted back-to-front.
	const ordered = [...reorderable].reverse();
	const toActualIndex = useCallback(
		(reversedIndex: number) => reorderable.length - 1 - reversedIndex,
		[reorderable.length],
	);

	useEffect(() => {
		if (!draggedId) return;

		const handleMove = (event: MouseEvent) => {
			const list = listRef.current;
			if (!list) return;
			const items = list.querySelectorAll("[data-layer-item]");
			let target = 0;
			for (let i = 0; i < items.length; i++) {
				const rect = (items[i] as HTMLElement).getBoundingClientRect();
				if (event.clientY < rect.top + rect.height / 2) {
					target = i;
					break;
				}
				target = i + 1;
			}
			setDropIndex(target);
		};

		const handleUp = () => {
			setDropIndex((target) => {
				const from = ordered.findIndex((a) => a.id === draggedId);
				if (target !== null && from !== -1 && from !== target) {
					const fromActual = toActualIndex(from);
					// Dropping below the dragged row shifts every later index up
					// by one once the row is lifted out.
					const toActual = toActualIndex(target > from ? target - 1 : target);
					if (fromActual !== toActual) {
						const next = [...reorderable];
						const [moved] = next.splice(fromActual, 1);
						next.splice(toActual, 0, moved);
						// Focus goes back at the head so it stays the first thing
						// painted, whatever the user did to the rest of the stack.
						setAnnotations(focusAnnotation ? [focusAnnotation, ...next] : next);
					}
				}
				return null;
			});
			setDraggedId(null);
		};

		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
		return () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
		};
	}, [
		draggedId,
		ordered,
		reorderable,
		focusAnnotation,
		setAnnotations,
		toActualIndex,
	]);

	return (
		<div className="flex h-full w-56 shrink-0 flex-col border-r border-gray-3 bg-gray-1">
			<div className="flex h-11 shrink-0 items-center justify-between px-3">
				<span className="flex items-center gap-1.5 text-xs font-medium text-gray-12">
					<IconLucideLayers className="size-3.5 text-gray-11" />
					Layers
				</span>
				<button
					type="button"
					onClick={() => setLayersPanelOpen(false)}
					aria-label="Close layers panel"
					className="flex size-6 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
				>
					<IconLucideX className="size-3.5" />
				</button>
			</div>

			<div
				ref={listRef}
				data-layers-list
				className="custom-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2"
			>
				{ordered.length === 0 && !focusAnnotation && (
					<p className="text-pretty px-2 py-4 text-center text-xs text-gray-10">
						No annotations yet. Pick a tool in the toolbar to add one.
					</p>
				)}

				{/* The capture is an object like any other and belongs in the list
				    that says so — it is also the only place the panel can tell you
				    it is selectable at all, now that there is no tool for it.
				    Pinned to the bottom because it is behind everything else, and
				    not draggable for the same reason: nothing goes under it. */}
				<button
					type="button"
					onClick={() => setCaptureSelected(!captureSelected)}
					className={cn(
						"order-last flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
						captureSelected
							? "bg-blue-3 text-blue-11"
							: "text-gray-11 hover:bg-gray-3 hover:text-gray-12",
					)}
				>
					<IconLucideImage className="size-3.5 shrink-0" />
					<span className="truncate">Screenshot</span>
				</button>

				{ordered.map((annotation, index) => {
					const Icon = TYPE_ICONS[annotation.type];
					const isSelected = selectedAnnotationId === annotation.id;
					return (
						<div key={annotation.id} data-layer-item>
							{dropIndex === index && (
								<div className="mx-1 h-0.5 rounded-full bg-accent-border-selected" />
							)}
							<div
								className={cn(
									"group flex items-center gap-1.5 rounded-lg px-1.5 py-1.5",
									isSelected ? "bg-gray-4" : "hover:bg-gray-3",
									draggedId === annotation.id && "opacity-50",
								)}
							>
								{/* Only the grip starts a reorder, so clicking the row
								    itself still selects rather than dragging. */}
								<button
									type="button"
									aria-label={`Reorder ${labelFor(annotation)}`}
									onMouseDown={() => setDraggedId(annotation.id)}
									className="cursor-grab text-gray-9 hover:text-gray-11"
								>
									<IconLucideGripVertical className="size-3.5" />
								</button>

								<button
									type="button"
									onClick={() => {
										setActiveTool("select");
										setSelectedAnnotationId(annotation.id);
									}}
									className="flex min-w-0 flex-1 items-center gap-2 text-left"
								>
									<Icon className="size-3.5 shrink-0 text-gray-11" />
									<span
										title={labelFor(annotation)}
										className="truncate text-xs text-gray-12"
									>
										{labelFor(annotation)}
									</span>
								</button>

								<button
									type="button"
									aria-label={`Delete ${labelFor(annotation)}`}
									onClick={() => {
										setAnnotations(
											annotations.filter((a) => a.id !== annotation.id),
										);
										if (isSelected) setSelectedAnnotationId(null);
									}}
									className="flex size-6 shrink-0 items-center justify-center rounded text-gray-10 opacity-0 transition-opacity hover:bg-red-3 hover:text-red-9 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 group-hover:opacity-100"
								>
									<IconLucideTrash2 className="size-3.5" />
								</button>
							</div>
						</div>
					);
				})}

				{dropIndex === ordered.length && ordered.length > 0 && (
					<div className="mx-1 h-0.5 rounded-full bg-accent-border-selected" />
				)}
			</div>

			{focusAnnotation && (
				<div className="shrink-0 border-t border-gray-3 px-2 py-2">
					<div
						className={cn(
							"group flex items-center gap-1.5 rounded-lg px-1.5 py-1.5",
							selectedAnnotationId === focusAnnotation.id
								? "bg-gray-4"
								: "hover:bg-gray-3",
						)}
					>
						<button
							type="button"
							onClick={() => {
								setActiveTool("select");
								setSelectedAnnotationId(focusAnnotation.id);
							}}
							className="flex min-w-0 flex-1 items-center gap-2 text-left"
						>
							<IconLucideFocus className="size-3.5 shrink-0 text-gray-11" />
							<span className="truncate text-xs text-gray-12">Focus</span>
						</button>

						<button
							type="button"
							aria-label="Delete Focus"
							onClick={() => {
								setAnnotations(
									annotations.filter((a) => a.id !== focusAnnotation.id),
								);
								if (selectedAnnotationId === focusAnnotation.id)
									setSelectedAnnotationId(null);
							}}
							className="flex size-6 shrink-0 items-center justify-center rounded text-gray-10 opacity-0 transition-opacity hover:bg-red-3 hover:text-red-9 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50 group-hover:opacity-100"
						>
							<IconLucideTrash2 className="size-3.5" />
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
