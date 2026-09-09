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
		<div>
			<div
				className={cn(
					"relative  flex min-h-8 w-full min-w-[126px] max-w-[calc(100%-1rem)] shrink-0",
				)}
			>
				<div
					className={cn(
						"relative mx-0 mt-0 flex min-h-8 w-max min-w-[126px] contain-layout max-w-[calc(100%-1rem)] shrink-0 items-center gap-1.5 rounded-t-lg bg-gray-3 px-2.5 transition-width transition-colors duration-100 motion-reduce:transition-none",
						open ? "bg-gray-4" : "hover:bg-gray-4 min-w-full rounded-lg",
					)}
				>
					<button
						type="button"
						aria-expanded={open}
						aria-controls={panelId}
						onClick={() => setOpen((v) => !v)}
						className={cn(
							"flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-t-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50",
							!open && "w-full",
						)}
					>
						<span className="grid size-4 shrink-0 place-items-center text-gray-10">
							{icon}
						</span>
						<span className="min-w-0 truncate text-[11px] font-semibold text-gray-12">
							{title}
						</span>
						{/* scaleY(-1) rather than rotate-180: the path is a symmetric "v",
						 * so a vertical flip passes through a flat line at the midpoint
						 * instead of visibly spinning — reads like the chevron is
						 * morphing into a caret, not turning. non-scaling-stroke on the
						 * inner path keeps the stroke width constant through that flat
						 * point, where a plain scaleY would otherwise pinch it thin. */}
						<IconLucideChevronDown
							className={cn(
								"size-3 origin-center text-gray-9 transition-transform duration-200 ease-[var(--ease-snappy)] [&_path]:[vector-effect:non-scaling-stroke] motion-reduce:transition-none",
								open ? "scale-y-[-1] ml-auto" : "ml-auto",
							)}
						/>
					</button>
					{trailing}
				</div>
				<span
					aria-hidden="true"
					className={cn(
						"pointer-events-none absolute inset-x-0  bottom-0 h-px origin-left bg-gray-6 transition-transform duration-300 ease-[var(--ease-snappy)] motion-reduce:transition-none",
						open ? "scale-x-100" : "scale-x-0",
					)}
				/>
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
					"mx-1 grid overflow-hidden contain-[layout] transition-[grid-template-rows] duration-200 ease-[var(--ease-snappy)] motion-reduce:transition-none",
					open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				{/* Fades and un-blurs in on top of the height reveal, so the content
				 * settles into place rather than just growing into view. */}
				<div
					className={cn(
						"flex min-h-0 flex-col gap-4 overflow-hidden px-2 transition-[transform,opacity,filter,padding] duration-200 ease-[var(--ease-snappy)] motion-reduce:transition-none",
						open
							? "translate-y-0 scale-100 pt-3 pb-3 opacity-100 blur-none"
							: "-translate-y-2 scale-[0.985] py-0 opacity-0 blur-[2px]",
					)}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
