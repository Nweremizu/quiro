import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu";
import ChevronDownIcon from "~icons/lucide/chevron-down";
import { cn } from "../utils/helpers";

export function NavigationMenu({
  className,
  children,
  ...props
}: NavigationMenuPrimitive.Root.Props) {
  return (
    <NavigationMenuPrimitive.Root
      className={cn("relative z-10 flex max-w-max flex-1 items-center justify-center", className)}
      {...props}
    >
      {children}
      <NavigationMenuPrimitive.Portal>
        <NavigationMenuPrimitive.Positioner>
          <NavigationMenuPrimitive.Popup className="rounded-lg border border-gray-5 bg-gray-1 shadow-lg">
            <NavigationMenuPrimitive.Viewport />
          </NavigationMenuPrimitive.Popup>
        </NavigationMenuPrimitive.Positioner>
      </NavigationMenuPrimitive.Portal>
    </NavigationMenuPrimitive.Root>
  );
}

export function NavigationMenuList({ className, ...props }: NavigationMenuPrimitive.List.Props) {
  return (
    <NavigationMenuPrimitive.List
      className={cn("group flex flex-1 list-none items-center justify-center gap-1", className)}
      {...props}
    />
  );
}

export const NavigationMenuItem = NavigationMenuPrimitive.Item;
export const NavigationMenuLink = NavigationMenuPrimitive.Link;

export function NavigationMenuTrigger({
  className,
  children,
  caret = true,
  ...props
}: NavigationMenuPrimitive.Trigger.Props & { caret?: boolean }) {
  return (
    <NavigationMenuPrimitive.Trigger
      className={cn(
        "group flex h-10 w-max items-center justify-center gap-1 rounded-md px-4 text-sm font-medium text-gray-12 outline-none transition-colors hover:bg-gray-3 data-[popup-open]:bg-gray-3 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      {caret && (
        <ChevronDownIcon className="size-4 transition-transform duration-200 group-data-[popup-open]:rotate-180" />
      )}
    </NavigationMenuPrimitive.Trigger>
  );
}

export function NavigationMenuContent({ className, ...props }: NavigationMenuPrimitive.Content.Props) {
  return <NavigationMenuPrimitive.Content className={cn("p-4", className)} {...props} />;
}
