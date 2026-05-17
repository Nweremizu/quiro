import { cn } from "@/lib/utils";
import type { ResetButtonProps } from "./setting-section.types";

export function ResetButton({
  onClick,
  label = "Reset",
  className,
}: ResetButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[10px] text-primary transition-opacity hover:opacity-80",
        className,
      )}
    >
      {label}
    </button>
  );
}
