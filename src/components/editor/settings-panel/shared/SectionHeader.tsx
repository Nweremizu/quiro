import { cn } from "@/lib/utils";
import { SectionLabel } from "../SectionLabel";
import { ResetButton } from "./ResetButton";
import type { SectionHeaderProps } from "./setting-section.types";

export function SectionHeader({
  title,
  onReset,
  resetLabel = "Reset",
  className,
  children,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex items-center gap-2">
        <SectionLabel>{title}</SectionLabel>
        {children}
      </div>
      {onReset && <ResetButton onClick={onReset} label={resetLabel} />}
    </div>
  );
}
