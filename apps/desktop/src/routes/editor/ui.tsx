import { cn } from "@quiro/ui";
import type { ComponentProps, ReactNode } from "react";
import { Tooltip } from "@/components/Tooltip";

// React port of Cap's `routes/editor/ui.tsx` — the editor's own primitives,
// which are visually distinct from the app's general @quiro/ui components
// (flatter, denser, icon-led) and are shared by the header, player, sidebar
// and timeline.

export function Field({
	name,
	icon,
	value,
	badge,
	className,
	disabled,
	children,
}: {
	name: string;
	icon?: ReactNode;
	value?: ReactNode;
	badge?: string;
	className?: string;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<div className={cn("flex flex-col gap-4", className)}>
			<span
				data-disabled={disabled}
				className="flex flex-row items-center gap-1.5 text-sm font-medium text-gray-12 data-[disabled='true']:text-gray-10"
			>
				{icon}
				{name}
				{badge && (
					<span className="rounded-full bg-gray-3 px-1.5 py-0.5 text-[10px] font-medium text-gray-11">
						{badge}
					</span>
				)}
				{value && <div className="ml-auto">{value}</div>}
			</span>
			{children}
		</div>
	);
}

/** A labelled row inside a `Field` — label left, control right. */
export function Subfield({
	name,
	className,
	children,
}: {
	name: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			className={cn("flex flex-row items-center justify-between", className)}
		>
			<span className="text-xs font-medium text-gray-12">{name}</span>
			{children}
		</div>
	);
}

// The config sidebar and timeline use the shared scrubber; re-exported here
// so the editor's primitives stay a single import.
export { Slider } from "@/components/Scrubber";

const EDITOR_BUTTON_BASE =
	"group flex flex-row items-center gap-[0.375rem] rounded-[0.5rem] px-[0.625rem] h-[2rem] text-[0.875rem] font-[500] outline-hidden transition-colors duration-100 disabled:opacity-50 disabled:text-gray-11";

/** The header/player button: quiet until hovered, and pressed-state aware so
 * toggles (split mode) read as engaged. */
export function EditorButton({
	leftIcon,
	rightIcon,
	children,
	tooltip,
	kbd,
	pressed,
	variant = "primary",
	className,
	...props
}: ComponentProps<"button"> & {
	leftIcon?: ReactNode;
	rightIcon?: ReactNode;
	tooltip?: string;
	kbd?: string[];
	pressed?: boolean;
	variant?: "primary" | "danger";
}) {
	const button = (
		<button
			type="button"
			data-pressed={pressed || undefined}
			className={cn(
				EDITOR_BUTTON_BASE,
				variant === "danger"
					? "text-gray-12 enabled:hover:not-data-pressed:bg-gray-3 data-pressed:bg-red-9 data-pressed:text-gray-1"
					: "text-gray-12 enabled:hover:not-data-pressed:bg-gray-3 data-pressed:bg-gray-3",
				className,
			)}
			{...props}
		>
			{leftIcon}
			{children && <span>{children}</span>}
			{rightIcon}
		</button>
	);

	if (!tooltip) return button;

	return (
		<Tooltip content={tooltip} kbd={kbd}>
			{button}
		</Tooltip>
	);
}

/** Panel container matching Cap's cards: the player, sidebar and timeline are
 * all the same raised surface. */
export function EditorCard({
	className,
	children,
	...props
}: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"flex flex-col overflow-hidden rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-2",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}
