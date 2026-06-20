import { Button } from "@/components/ui/button";
import { Delete02Icon as Trash2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { PlaybackSpeed } from "@/types/editor";
import { SectionLabel } from "./SectionLabel";

const SPEED_OPTIONS: { speed: PlaybackSpeed; label: string }[] = [
  { speed: 0.25, label: "0.25×" },
  { speed: 0.5, label: "0.5×" },
  { speed: 0.75, label: "0.75×" },
  { speed: 1.25, label: "1.25×" },
  { speed: 1.5, label: "1.5×" },
  { speed: 1.75, label: "1.75×" },
  { speed: 2, label: "2×" },
];

interface SpeedSectionProps {
  tSettings: (key: string, fallback?: string) => string;
  selectedSpeedId?: string | null;
  selectedSpeedValue?: PlaybackSpeed | null;
  onSpeedValueChange?: (speed: PlaybackSpeed) => void;
  onSpeedDelete?: (id: string) => void;
}

export function SpeedSection({
  tSettings,
  selectedSpeedId,
  selectedSpeedValue,
  onSpeedValueChange,
  onSpeedDelete,
}: SpeedSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>{tSettings("speed.title", "Speed Region")}</SectionLabel>
        {selectedSpeedValue != null ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
            {selectedSpeedValue}×
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <SectionLabel>{tSettings("speed.label", "Playback Speed")}</SectionLabel>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {SPEED_OPTIONS.map((option) => {
          const isActive = selectedSpeedValue === option.speed;
          return (
            <Button
              key={option.speed}
              type="button"
              onClick={() => onSpeedValueChange?.(option.speed)}
              className={cn(
                "h-auto w-full rounded-lg border px-0.5 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer",
                isActive
                  ? "border-amber-500/60 bg-amber-500/20 text-amber-300"
                  : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:border-foreground/10 hover:text-foreground",
              )}
            >
              <span className="text-[10px] font-semibold">{option.label}</span>
            </Button>
          );
        })}
      </div>

      {selectedSpeedId ? (
        <Button
          onClick={() => onSpeedDelete?.(selectedSpeedId)}
          variant="destructive"
          size="sm"
          className="mt-1 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
        >
          <Trash2 className="h-3 w-3" />
          {tSettings("speed.delete", "Delete Speed Region")}
        </Button>
      ) : null}
    </section>
  );
}
