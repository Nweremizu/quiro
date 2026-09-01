import { cn } from "@quiro/ui";
import { type ReactNode, useId } from "react";
import IconLucideChevronDown from "~icons/lucide/chevron-down";

/** A quiet, inline "show me more" toggle for detail that belongs to the control
 * directly above it — not a section of its own.
 *
 * Controlled, because the disclosure state is usually the config: opening
 * "Customise" under Shadow is what swaps the renderer's default shadow
 * parameters for stored ones, so the panel cannot own that state privately.
 *
 * Same grid-rows reveal, fade/blur, chevron flip and `inert`-while-closed
 * as PanelSection — see its comment for why each is there. */
export function Disclosure({
	label,
	open,
	onOpenChange,
	children,
}: {
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
}) {
	const panelId = useId();

	return (
		<div>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => onOpenChange(!open)}
				className="flex items-center gap-1 rounded-md py-1 text-xs font-medium text-gray-11 outline-none transition-colors duration-100 hover:text-gray-12 focus-visible:ring-2 focus-visible:ring-accent-400/50 motion-reduce:transition-none"
			>
				<IconLucideChevronDown
					className={cn(
						"size-3 origin-center transition-transform duration-150 ease-[var(--ease-snappy)] [&_path]:[vector-effect:non-scaling-stroke] motion-reduce:transition-none",
						open && "scale-y-[-1]",
					)}
				/>
				{label}
			</button>
			<div
				id={panelId}
				inert={!open}
				className={cn(
					"grid overflow-hidden contain-[layout] transition-[grid-template-rows] duration-150 ease-[var(--ease-snappy)] motion-reduce:transition-none",
					open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div
					className={cn(
						"flex min-h-0 flex-col gap-4 overflow-hidden pt-3 transition-[transform,opacity,filter] duration-150 ease-[var(--ease-snappy)] motion-reduce:transition-none",
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
