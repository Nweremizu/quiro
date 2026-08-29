import { cn } from "@quiro/ui";
import type { ComponentType, SVGProps } from "react";

type MenuSelectionButtonProps = {
	selected: boolean;
	Component: ComponentType<SVGProps<SVGSVGElement>>;
	name: string;
	description?: string;
	disabled?: boolean;
} & React.ComponentProps<"button">;

function MenuSelectionButton({
	selected,
	Component,
	name,
	description,
	disabled,
	className,
	...rest
}: MenuSelectionButtonProps) {
	return (
		<button
			{...rest}
			type="button"
			disabled={disabled}
			aria-pressed={selected}
			className={cn(
				"flex flex-1 flex-col items-center gap-1 rounded-lg border py-2 text-center transition-[background-color,border-color,color] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-1",
				description &&
					"min-h-14 flex-row items-center justify-start gap-2.5 px-3 text-left",
				!description && "justify-end",
				selected
					? "border-accent-400-8 bg-accent-200 text-accent-500 hover:border-accent-400 hover:bg-accent-300 active:bg-accent-200 dark:bg-accent-100/30 dark:hover:bg-accent-200/40"
					: "border-gray-6 bg-gray-2 text-gray-12 hover:border-gray-8 hover:bg-gray-4 active:bg-gray-5",
				disabled && "pointer-events-none opacity-60",
				className,
			)}
		>
			<Component
				className={cn(
					"size-5 shrink-0 transition-colors",
					selected ? "text-accent-500" : "text-gray-10",
				)}
			/>

			<div className="min-w-0">
				<p className={cn("text-xs", description && "font-medium leading-4")}>
					{name}
				</p>

				{description && (
					<p
						className={cn(
							"text-[10px] leading-3",
							selected ? "text-accent-400" : "text-gray-10",
						)}
					>
						{description}
					</p>
				)}
			</div>
		</button>
	);
}

export default MenuSelectionButton;
