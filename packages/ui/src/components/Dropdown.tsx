import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { HTMLAttributes } from "react";
import CheckIcon from "~icons/lucide/check";
import ChevronRightIcon from "~icons/lucide/chevron-right";
import CircleIcon from "~icons/lucide/circle";
import { cn } from "../utils/helpers";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuPortal = MenuPrimitive.Portal;
export const DropdownMenuSub = MenuPrimitive.SubmenuRoot;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuSubTrigger({
	className,
	inset,
	children,
	...props
}: MenuPrimitive.SubmenuTrigger.Props & { inset?: boolean }) {
	return (
		<MenuPrimitive.SubmenuTrigger
			className={cn(
				"flex cursor-default select-none items-center justify-between rounded-lg px-2 py-1.5 text-sm text-gray-10 outline-none data-[popup-open]:bg-gray-3 data-[popup-open]:text-gray-12",
				inset && "pl-8",
				className,
			)}
			{...props}
		>
			{children}
			<ChevronRightIcon className="ml-auto size-4" />
		</MenuPrimitive.SubmenuTrigger>
	);
}

export function DropdownMenuContent({
	className,
	sideOffset = 4,
	...props
}: MenuPrimitive.Popup.Props & MenuPrimitive.Positioner.Props) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner sideOffset={sideOffset}>
				<MenuPrimitive.Popup
					className={cn(
						"z-1000 min-w-32 overflow-hidden rounded-xl border border-gray-3 bg-gray-1 p-1 shadow-md",
						className,
					)}
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}
export const DropdownMenuSubContent = DropdownMenuContent;

export function DropdownMenuItem({
	className,
	inset,
	...props
}: MenuPrimitive.Item.Props & { inset?: boolean }) {
	return (
		<MenuPrimitive.Item
			className={cn(
				// `data-[highlighted]` is what keyboard arrowing sets — hover alone
				// left keyboard users with no visible position in the menu, unlike
				// the checkbox and radio items below which already handled it.
				"relative flex cursor-pointer select-none items-center rounded-xl px-2 py-1.5 text-sm text-gray-10 outline-none transition-colors hover:bg-gray-3 hover:text-gray-12 data-[highlighted]:bg-gray-3 data-[highlighted]:text-gray-12 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				inset && "pl-8",
				className,
			)}
			{...props}
		/>
	);
}

export function DropdownMenuCheckboxItem({
	className,
	children,
	...props
}: MenuPrimitive.CheckboxItem.Props) {
	return (
		<MenuPrimitive.CheckboxItem
			className={cn(
				"relative flex cursor-default select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[highlighted]:bg-gray-3 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			<span className="absolute left-2 flex size-3.5 items-center justify-center">
				<MenuPrimitive.CheckboxItemIndicator>
					<CheckIcon className="size-4" />
				</MenuPrimitive.CheckboxItemIndicator>
			</span>
			{children}
		</MenuPrimitive.CheckboxItem>
	);
}

export function DropdownMenuRadioItem({
	className,
	children,
	...props
}: MenuPrimitive.RadioItem.Props) {
	return (
		<MenuPrimitive.RadioItem
			className={cn(
				"relative flex cursor-default select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[highlighted]:bg-gray-3 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			<span className="absolute left-2 flex size-3.5 items-center justify-center">
				<MenuPrimitive.RadioItemIndicator>
					<CircleIcon className="size-2 fill-current" />
				</MenuPrimitive.RadioItemIndicator>
			</span>
			{children}
		</MenuPrimitive.RadioItem>
	);
}

export function DropdownMenuLabel({
	className,
	inset,
	...props
}: MenuPrimitive.GroupLabel.Props & { inset?: boolean }) {
	return (
		<MenuPrimitive.GroupLabel
			className={cn(
				"px-2 py-1.5 text-sm font-semibold text-gray-11",
				inset && "pl-8",
				className,
			)}
			{...props}
		/>
	);
}

export function DropdownMenuSeparator({
	className,
	...props
}: MenuPrimitive.Separator.Props) {
	return (
		<MenuPrimitive.Separator
			className={cn("-mx-1 my-1 h-px bg-gray-4", className)}
			{...props}
		/>
	);
}

export function DropdownMenuShortcut({
	className,
	...props
}: HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			className={cn("ml-auto text-xs tracking-widest text-gray-9", className)}
			{...props}
		/>
	);
}
