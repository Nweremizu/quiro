import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../utils/helpers";

export function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors",
        "bg-gray-5 data-[checked]:bg-accent-300",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:data-[checked]:bg-gray-5",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform",
          "data-[unchecked]:translate-x-0 data-[checked]:translate-x-full",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
