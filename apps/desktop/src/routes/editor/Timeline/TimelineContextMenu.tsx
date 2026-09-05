import { ContextMenu } from "@base-ui/react/context-menu";
import { cn } from "@quiro/ui";
import type { ReactNode } from "react";

// Right-click actions for a timeline segment — clips, zooms and overlays all
// use this one menu.
//
// Styling deliberately mirrors `packages/ui/src/components/Dropdown.tsx` rather
// than inventing a second menu look — same radius, border, padding and item
// treatment — because a context menu and a dropdown are the same object to the
// reader. It cannot reuse those components directly: they render
// `Menu.Positioner`, which anchors to a trigger element, whereas a context menu
// has to anchor to the pointer, which `ContextMenu.Positioner` handles.
//
// Unavailable items stay visible but disabled rather than disappearing. A menu
// whose shape changes per segment forces the user to re-read it every time, and
// hiding an action teaches nothing about when it applies.

const POPUP_CLASS =
	"z-1000 min-w-44 origin-[var(--transform-origin)] overflow-hidden rounded-xl border border-gray-3 bg-gray-1 p-1 shadow-md " +
	// Enter/exit are opacity + a small scale, both cheap and interruptible.
	"transition-[transform,opacity] duration-150 ease-out " +
	"data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 " +
	"data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 " +
	"motion-reduce:transition-none motion-reduce:data-[starting-style]:scale-100";

/** `data-[highlighted]` is what keyboard arrowing sets; hover alone would leave
 * keyboard users with no visible position in the menu. */
const ITEM_CLASS =
	"relative flex w-full cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm " +
	"text-gray-11 outline-none transition-colors " +
	"hover:bg-gray-3 hover:text-gray-12 data-[highlighted]:bg-gray-3 data-[highlighted]:text-gray-12 " +
	"data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

/** Destructive items read red on hover rather than at rest, so the menu is not
 * dominated by a warning colour before the user has aimed at anything. */
const DESTRUCTIVE_ITEM_CLASS =
	"text-red-500 hover:bg-red-500/10 hover:text-red-500 " +
	"data-[highlighted]:bg-red-500/10 data-[highlighted]:text-red-500";

function Item({
	icon,
	label,
	disabled,
	destructive,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	disabled?: boolean;
	destructive?: boolean;
	onClick: () => void;
}) {
	return (
		<ContextMenu.Item
			disabled={disabled}
			onClick={onClick}
			className={cn(ITEM_CLASS, destructive && DESTRUCTIVE_ITEM_CLASS)}
		>
			<span className="flex size-4 shrink-0 items-center justify-center">
				{icon}
			</span>
			{label}
		</ContextMenu.Item>
	);
}

/** One row. `separator` draws a divider instead of an action. */
export type TimelineMenuItem =
	| { separator: true }
	| {
			separator?: false;
			icon: ReactNode;
			label: string;
			disabled?: boolean;
			destructive?: boolean;
			onClick: () => void;
	  };

/** Right-click actions for one timeline segment.
 *
 * Generic over the items so clips, zooms and overlay segments share one menu
 * implementation — the alternative was a second component per track, which is
 * how two menus that look almost alike start to drift apart. */
export function TimelineContextMenu({
	children,
	items,
}: {
	children: ReactNode;
	items: TimelineMenuItem[];
}) {
	return (
		<ContextMenu.Root>
			{/* `render` rather than a wrapper element: segment cards are absolutely
			    positioned by transform, so an extra box would break their layout. */}
			<ContextMenu.Trigger render={<div className="contents" />}>
				{children}
			</ContextMenu.Trigger>

			<ContextMenu.Portal>
				<ContextMenu.Positioner className="outline-none">
					<ContextMenu.Popup className={POPUP_CLASS}>
						{items.map((item, index) =>
							item.separator ? (
								<ContextMenu.Separator
									// biome-ignore lint/suspicious/noArrayIndexKey: separators carry no identity
									key={`separator-${index}`}
									className="my-1 h-px bg-gray-3"
								/>
							) : (
								<Item
									key={item.label}
									icon={item.icon}
									label={item.label}
									disabled={item.disabled}
									destructive={item.destructive}
									onClick={item.onClick}
								/>
							),
						)}
					</ContextMenu.Popup>
				</ContextMenu.Positioner>
			</ContextMenu.Portal>
		</ContextMenu.Root>
	);
}
