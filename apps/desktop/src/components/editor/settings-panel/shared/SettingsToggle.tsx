import { Switch } from "@/components/ui/switch";
import type { SettingsToggleProps } from "./setting-section.types";

export function SettingsToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: SettingsToggleProps) {
  return (
    <div className="flex items-center justify-between gap-x-2">
      <div className="flex flex-col">
        <div className="text-[11px] font-medium text-foreground">{label}</div>
        {description && (
          <div className="text-[10px] text-muted-foreground/80 leading-snug">
            {description}
          </div>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
