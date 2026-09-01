import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import CheckIcon from "~icons/lucide/check";
import ChevronDownIcon from "~icons/lucide/chevron-down";
import { cn } from "../utils/helpers";

const selectTriggerVariants = cva(
	"group/select-trigger flex w-full items-center justify-between gap-2 whitespace-nowrap border font-medium outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:border-gray-7",
	{
		variants: {
			variant: {
				default:
					"border-gray-5 bg-gray-2 text-gray-12 hover:border-gray-6 hover:bg-gray-3",
				light:
					"border-gray-5 bg-gray-1 text-gray-12 hover:border-gray-6 hover:bg-gray-3",
				dark: "border-gray-5 bg-gray-12 text-gray-1 hover:bg-gray-11",
				gray: "border-gray-5 bg-gray-5 text-gray-12 hover:border-gray-6 hover:bg-gray-7",
				transparent:
					"border-transparent bg-transparent text-gray-12 hover:bg-gray-3",
			},
			// "md" is the size the trigger always was — h-10, rounded-xl, px-3.5 —
			// so every existing call site (nobody passes `size` today) renders
			// identically after this change.
			size: {
				sm: "h-8 rounded-lg px-3 text-sm",
				md: "h-10 rounded-xl px-3.5 text-sm",
				lg: "h-11 rounded-xl px-4 text-base",
			},
		},
		defaultVariants: { variant: "default", size: "sm" },
	},
);

export interface SelectOption {
	value: string;
	label: string;
	icon?: ReactNode;
}

export interface SelectProps
	extends VariantProps<typeof selectTriggerVariants>,
		Omit<SelectPrimitive.Root.Props<string>, "children" | "items"> {
	options: SelectOption[];
	placeholder?: string;
	className?: string;
}

// Convenience wrapper matching most call sites — an options array in, a
// value out. For anything needing custom item rendering, group headers,
// etc., compose SelectRoot/SelectTrigger/SelectContent/SelectItem directly.
export function Select({
	options,
	placeholder,
	variant,
	size,
	className,
	...props
}: SelectProps) {
	return (
		<SelectPrimitive.Root
			items={options.map((o) => ({ label: o.label, value: o.value }))}
			{...props}
		>
			<SelectTrigger
				variant={variant}
				size={size}
				className={cn("w-fit!", className)}
			>
				<SelectPrimitive.Value placeholder={placeholder} />
				<SelectPrimitive.Icon>
					<ChevronDownIcon className="size-4 opacity-50 transition-transform duration-200 ease-(--ease-snappy) group-data-popup-open/select-trigger:rotate-180 motion-reduce:transition-none" />
				</SelectPrimitive.Icon>
			</SelectTrigger>
			<SelectPrimitive.Portal>
				<SelectPrimitive.Positioner
					sideOffset={4}
					align="start"
					className="z-1000 min-w-(--anchor-width)"
				>
					<SelectContent>
						<SelectPrimitive.List>
							{options.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.icon}
									{option.label}
								</SelectItem>
							))}
						</SelectPrimitive.List>
					</SelectContent>
				</SelectPrimitive.Positioner>
			</SelectPrimitive.Portal>
		</SelectPrimitive.Root>
	);
}

export const SelectRoot = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
	className,
	variant,
	size,
	...props
}: SelectPrimitive.Trigger.Props & VariantProps<typeof selectTriggerVariants>) {
	return (
		<SelectPrimitive.Trigger
			className={cn(selectTriggerVariants({ variant, size }), className)}
			{...props}
		/>
	);
}

export function SelectContent({
	className,
	...props
}: SelectPrimitive.Popup.Props) {
	return (
		<SelectPrimitive.Popup
			className={cn(
				"z-1000 max-h-80 min-w-(--anchor-width) isolate overflow-hidden rounded-xl border border-gray-5 bg-gray-2 p-1 text-gray-12 shadow-md",
				// Fade only, no scale. Base UI opens Select with the selected item
				// aligned over the trigger (not anchored to a trigger edge like a
				// normal popover), so --transform-origin usually lands somewhere
				// inside the box instead of at an edge. Scaling from a mid-box
				// point makes the popup's edges visibly slide relative to the
				// trigger, which never moves — that mismatch is what read as a
				// "shift". A plain fade has no directional edge motion, so it
				// reads as smooth regardless of where the origin falls.
				"transition-opacity duration-150 ease-[var(--ease-snappy)]",
				"data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
				"motion-reduce:transition-opacity",
				className,
			)}
			{...props}
		/>
	);
}

export function SelectItem({
	className,
	children,
	...props
}: SelectPrimitive.Item.Props) {
	return (
		<SelectPrimitive.Item
			className={cn(
				"relative flex w-full cursor-default select-none items-center gap-2 rounded-lg py-2 pl-3 pr-8 text-sm text-gray-12 outline-none data-[highlighted]:bg-gray-3 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemText className="flex flex-1 items-center gap-2">
				{children}
			</SelectPrimitive.ItemText>
			<SelectPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
				<CheckIcon className="size-4" />
			</SelectPrimitive.ItemIndicator>
		</SelectPrimitive.Item>
	);
}

export function SelectGroupLabel({
	className,
	...props
}: SelectPrimitive.GroupLabel.Props) {
	return (
		<SelectPrimitive.GroupLabel
			className={cn("px-3 py-1.5 text-xs font-medium text-gray-10", className)}
			{...props}
		/>
	);
}

export const SelectGroup = SelectPrimitive.Group;
export const SelectSeparator = SelectPrimitive.Separator;
