import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "../utils/helpers";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
	className,
	align = "center",
	sideOffset = 8,
	...props
}: PopoverPrimitive.Popup.Props & PopoverPrimitive.Positioner.Props) {
	return (
		<PopoverPrimitive.Portal>
			{/* z-index goes on the Positioner (the positioned element). On the
			    Popup it's scoped inside the Positioner's own stacking context and
			    does nothing at the document root. `z-1000` (matching Select /
			    Dropdown) so a popover opened from inside a Dialog — which sits at
			    z-500/501 — still renders above it, not behind its backdrop. */}
			<PopoverPrimitive.Positioner
				align={align}
				sideOffset={sideOffset}
				className="z-1000"
			>
				<PopoverPrimitive.Popup
					className={cn(
						"ui-popover w-72 rounded-2xl border border-gray-3 bg-gray-1 p-4 text-gray-12 shadow-overlay outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring/50",
						className,
					)}
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

export const PopoverTitle = PopoverPrimitive.Title;
export const PopoverDescription = PopoverPrimitive.Description;
export const PopoverClose = PopoverPrimitive.Close;
