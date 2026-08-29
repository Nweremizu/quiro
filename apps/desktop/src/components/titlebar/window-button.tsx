import { cn } from "@quiro/ui";
import { type ComponentProps, forwardRef } from "react";

export const WindowButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button">
>(function WindowControlButton({ className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex cursor-default items-center justify-center",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
