import { cn } from "@quiro/ui";
import { type ReactNode, useId, useState } from "react";
import IconLucideChevronDown from "~icons/lucide/chevron-down";

// A collapsible group header, shared by the screenshot editor's style panel and
// the video editor's config sidebar so both read as the same surface.

/** A collapsible section of the style panel: an icon + title header that
 * toggles a body of fields, matching the always-visible inspector pattern
 * (as opposed to the toolbar's floating popovers). Uncontrolled — each
 * section remembers its own open state for the life of the panel.
 *
 * Plain React state driving Tailwind classes directly, not Base UI's
 * Collapsible — `open` is already in scope here, so there is no need for a
 * CSS attribute selector (and the mismatch between `data-open` on one
 * element and `data-panel-open` on another that this file has hit twice is
 * a class of bug that only exists because of that indirection).
 *
 * The content is always mounted (never conditionally rendered), so opening
 * never competes with React building a fresh subtree of Sliders/Selects —
 * that first-mount cost, not the transition, was what made this feel
 * choppy. `inert` while closed keeps its controls out of the tab order and
 * the accessibility tree without unmounting them: `hidden`/`display:none`
 * would do that too, but would also drop the panel out of layout (undoing
 * the "always mounted" win) and cannot be transitioned. */
export function PanelSection({
	icon,
	title,
	trailing,
	defaultOpen = true,
	children,
}: {
	icon: ReactNode;
	title: string;
	/** Rendered before the chevron, e.g. an enable switch. */
	trailing?: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const panelId = useId();

	return (
		<div className="border-b border-gray-3">
			<div className="flex h-fit pt-2 pb-0 shrink-0 items-center gap-1.5 px-3">
				<button
					type="button"
					aria-expanded={open}
					aria-controls={panelId}
					onClick={() => setOpen((v) => !v)}
					className="flex flex-1 items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-400/50"
				>
					<span className="text-gray-11">{icon}</span>
					<span className="text-sm font-semibold text-gray-12">{title}</span>
					{/* scaleY(-1) rather than rotate-180: the path is a symmetric "v",
					 * so a vertical flip passes through a flat line at the midpoint
					 * instead of visibly spinning — reads like the chevron is
					 * morphing into a caret, not turning. non-scaling-stroke on the
					 * inner path keeps the stroke width constant through that flat
					 * point, where a plain scaleY would otherwise pinch it thin. */}
					<IconLucideChevronDown
						className={cn(
							"size-3.5 origin-center text-gray-9 transition-transform duration-200 ease-[var(--ease-snappy)] [&_path]:[vector-effect:non-scaling-stroke] motion-reduce:transition-none",
							open && "scale-y-[-1]",
						)}
					/>
				</button>
				{trailing}
			</div>

			{/* grid-template-rows 0fr -> 1fr, not a JS-measured height: the
			 * measure-then-swap-to-auto technique leaves a fractional-pixel snap
			 * at the moment the transition ends. grid-rows never takes an
			 * intermediate measured value — 1fr IS the content's natural size
			 * throughout — so there is nothing to snap to.
			 *
			 * contain-[layout]: a grid-rows change still has to relayout this
			 * panel's own contents every frame — unavoidable for an accordion
			 * whose siblings must shift as it grows. Containment stops that
			 * relayout rippling further than this element, the cheapest a
			 * layout-triggering property can be made. */}
			<div
				id={panelId}
				inert={!open}
				className={cn(
					"grid overflow-hidden contain-[layout] transition-[grid-template-rows, margin-top] duration-200 ease-[var(--ease-snappy)] motion-reduce:transition-none",
					open ? "grid-rows-[1fr] mt-2" : "grid-rows-[0fr] -mt-2",
				)}
			>
				{/* Fades and un-blurs in on top of the height reveal, so the content
				 * settles into place rather than just growing into view. */}
				<div
					className={cn(
						"flex min-h-0 flex-col gap-4 overflow-hidden px-3 pb-4 transition-[transform,opacity,filter] duration-200 ease-[var(--ease-snappy)] motion-reduce:transition-none",
						open
							? "translate-y-0 scale-100 opacity-100 blur-none"
							: "-translate-y-2 scale-[0.985] opacity-0 blur-[2px]",
					)}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
