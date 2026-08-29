import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@quiro/ui";
import { type as ostype, type Platform } from "@tauri-apps/plugin-os";
import type { ReactNode } from "react";

interface Props extends TooltipPrimitive.Root.Props {
	children: ReactNode;
	content?: ReactNode;
	childClass?: string;
	kbd?: string[];
	delay?: number;
	sideOffset?: number;
}

const kbdSymbolModifier = (key: string, platform: Platform) => {
	if (platform === "macos") {
		const symbols: Record<string, string> = {
			meta: "⌘",
			ctrl: "⌃",
			shift: "⇧",
			alt: "⌥",
		};
		return symbols[key] || key;
	}
	const labels: Record<string, string> = {
		meta: "Ctrl",
		ctrl: "Ctrl",
		shift: "Shift",
		alt: "Alt",
	};
	return labels[key] || key;
};

export function Tooltip({
	children,
	content,
	childClass,
	kbd,
	delay = 200,
	sideOffset = 8,
	...props
}: Props) {
	const platform = ostype();
	return (
		<TooltipPrimitive.Root {...props}>
			<TooltipPrimitive.Trigger
				render={<span />}
				delay={delay}
				className={cn(childClass)}
			>
				{children}
			</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Positioner sideOffset={sideOffset}>
					<TooltipPrimitive.Popup className="z-50 flex min-w-6 items-center gap-1.5 text-center rounded-md border border-gray-3 bg-gray-12 px-1.5 py-1 text-xs text-gray-1 shadow-lg duration-100 animate-in fade-in slide-in-from-top-1">
						<span>{content}</span>
						{kbd && kbd.length > 0 && (
							<div className="space-x-1">
								{kbd.map((key, i) => (
									<kbd
										// biome-ignore lint/suspicious/noArrayIndexKey: static list, never reordered
										key={i}
										className="rounded-md bg-gray-1 px-[5px] py-0.5 text-[10px] text-gray-12"
									>
										{kbdSymbolModifier(key, platform)}
									</kbd>
								))}
							</div>
						)}
						<TooltipPrimitive.Arrow className="size-2 rotate-45 rounded-[2px] bg-gray-12 data-[side=top]:-bottom-1 data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1" />
					</TooltipPrimitive.Popup>
				</TooltipPrimitive.Positioner>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}
