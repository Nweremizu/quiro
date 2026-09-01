import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { HTMLAttributes, JSX } from "react";
import XIcon from "~icons/lucide/x";
import { cn } from "../utils/helpers";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
	className,
	children,
	...props
}: DialogPrimitive.Popup.Props) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Backdrop className="fixed inset-0 z-500 bg-black/50" />
			<DialogPrimitive.Popup
				className={cn(
					"fixed top-1/2 left-1/2 z-501 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-3 bg-gray-1 p-0",
					className,
				)}
				{...props}
			>
				{children}
				<DialogPrimitive.Close className="absolute right-4 top-4 text-gray-9 hover:text-gray-12">
					<XIcon className="size-5" />
					<span className="sr-only">Close</span>
				</DialogPrimitive.Close>
			</DialogPrimitive.Popup>
		</DialogPrimitive.Portal>
	);
}

export function DialogHeader({
	className,
	icon,
	description,
	children,
	...props
}: HTMLAttributes<HTMLDivElement> & {
	icon?: JSX.Element;
	description?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-start gap-3 border-b border-gray-4 p-5 md:flex-row md:items-center",
				className,
			)}
			{...props}
		>
			{icon && (
				<div className="flex size-10 min-w-10 items-center justify-center rounded-full border border-gray-5 bg-gray-3 text-gray-12">
					{icon}
				</div>
			)}
			<div className="flex flex-col">
				{children}
				{description && <p className="text-sm text-gray-10">{description}</p>}
			</div>
		</div>
	);
}

export function DialogFooter({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				"flex flex-col-reverse gap-1 border-t border-gray-4 p-5 sm:flex-row sm:justify-end sm:gap-2",
				className,
			)}
			{...props}
		/>
	);
}

export function DialogTitle({
	className,
	...props
}: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			className={cn("text-lg font-medium text-gray-12", className)}
			{...props}
		/>
	);
}

export function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			className={cn("p-5 text-sm text-gray-11", className)}
			{...props}
		/>
	);
}
