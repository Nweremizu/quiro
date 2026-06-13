import {
  ArtboardIcon as IconPresentation,
  Cursor01Icon as IconClick,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import type { CursorMotionPresetId } from "../utils/cursor-motion-presets";

const MOTION_PRESET_ORDER: CursorMotionPresetId[] = ["focused", "smooth"];

export function MotionPresetCards({
  activePresetId,
  onApply,
  tSettings,
}: {
  title: string;
  activePresetId: CursorMotionPresetId | null;
  onApply: (presetId: CursorMotionPresetId) => void;
  tSettings: (key: string, fallback?: string) => string;
}) {
  const activePreset = activePresetId ?? MOTION_PRESET_ORDER[0];

  return (
    <div className="space-y-2">
      <div className="flex rounded-lg border border-border bg-foreground/[0.04] p-0.5">
        {MOTION_PRESET_ORDER.map((presetId) => {
          const Icon = presetId === "focused" ? IconClick : IconPresentation;
          const isActive = activePreset === presetId;

          return (
            <button
              key={presetId}
              type="button"
              onClick={() => onApply(presetId)}
              className={cn(
                "group flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                "text-muted-foreground hover:text-foreground",
                isActive &&
                  "bg-primary text-primary-foreground shadow-sm hover:text-primary-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tSettings(`effects.motionPresets.${presetId}.label`)}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] leading-4 text-muted-foreground/70">
        {tSettings(`effects.motionPresets.${activePreset}.description`)}
      </p>
    </div>
  );
}
