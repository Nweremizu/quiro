import React from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Delete02Icon as Trash2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { ZoomDepth, ZoomMode, ZoomPresetId } from "@/types/editor";
import {
  TEMPORAL_MOTION_BLUR_DEFAULT_SAMPLE_COUNT,
  TEMPORAL_MOTION_BLUR_DEFAULT_SHUTTER_FRACTION,
} from "@/lib/exporter/temporal-motion-blur";

interface ZoomSectionProps {
  tSettings: (key: string, fallback?: string) => string;
  t: (key: string, fallback?: string) => string;
  selectedZoomId: string | null | undefined;
  selectedZoomDepth: ZoomDepth | null | undefined;
  selectedZoomMode: ZoomMode | null | undefined;
  selectedZoomPresetId?: ZoomPresetId | null;
  onZoomModeChange?: (mode: ZoomMode) => void;
  onZoomDepthChange?: (depth: ZoomDepth) => void;
  onZoomPresetChange?: (presetId: ZoomPresetId) => void;
  resetZoomSection: () => void;
  zoomClassicMode: boolean;
  onZoomClassicModeChange?: (v: boolean) => void;
  onZoomDelete?: (id: string) => void;
  ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }>;
  renderExtensionPanelsForSections: (
    section: string,
    ...rest: string[]
  ) => React.ReactNode;
}

export function ZoomSection({
  tSettings,
  t,
  selectedZoomId,
  selectedZoomDepth,
  selectedZoomMode,
  selectedZoomPresetId,
  onZoomModeChange,
  onZoomDepthChange,
  onZoomPresetChange,
  resetZoomSection,
  zoomClassicMode,
  onZoomClassicModeChange,
  onZoomDelete,
  ZOOM_DEPTH_OPTIONS,
  renderExtensionPanelsForSections,
}: ZoomSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      {selectedZoomId && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-foreground">
              {tSettings("sections.zoom", "Zoom")}
            </div>
            {selectedZoomDepth && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                {
                  ZOOM_DEPTH_OPTIONS.find((o) => o.depth === selectedZoomDepth)
                    ?.label
                }
              </span>
            )}
          </div>
          <div className="mb-1">
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {(
                [
                  ["focus", "Focus"],
                  ["follow-cursor", "Follow"],
                  ["punch-in", "Punch"],
                  ["pan-and-zoom", "Pan"],
                ] as Array<[ZoomPresetId, string]>
              ).map(([presetId, label]) => (
                <button
                  key={presetId}
                  type="button"
                  onClick={() => onZoomPresetChange?.(presetId)}
                  className={cn(
                    "h-8 rounded-lg border px-2 text-[10px] font-medium transition-colors",
                    selectedZoomPresetId === presetId
                      ? "border-primary/55 bg-primary/[0.08] text-primary"
                      : "border-border/70 text-muted-foreground hover:border-border hover:bg-foreground/[0.03] hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-foreground/10 bg-foreground/5 p-0.5">
              <button
                type="button"
                onClick={() => onZoomModeChange?.("auto")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  selectedZoomMode === "auto"
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tSettings("zoom.modeAuto", "Auto")}
              </button>
              <button
                type="button"
                onClick={() => onZoomModeChange?.("manual")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  selectedZoomMode === "manual"
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tSettings("zoom.modeManual", "Manual")}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground/70">
              {selectedZoomMode === "manual"
                ? tSettings(
                    "zoom.modeManualDescription",
                    "Set a fixed focus point for this zoom",
                  )
                : tSettings(
                    "zoom.modeAutoDescription",
                    "Camera recenters when the cursor nears the edge of the zoomed view",
                  )}
            </p>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {ZOOM_DEPTH_OPTIONS.map((option) => {
              const isActive = selectedZoomDepth === option.depth;
              return (
                <Button
                  key={option.depth}
                  type="button"
                  onClick={() => onZoomDepthChange?.(option.depth)}
                  className={cn(
                    "h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer",
                    isActive
                      ? "border-primary bg-primary text-white"
                      : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:border-foreground/10 hover:text-foreground",
                  )}
                >
                  <span className="text-xs font-semibold">{option.label}</span>
                </Button>
              );
            })}
          </div>
          <div className="h-px bg-foreground/[0.06] my-1" />
        </>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground">
          {tSettings("zoom.globalSettings", "Animation")}
        </div>
        <button
          type="button"
          onClick={resetZoomSection}
          className="text-[10px] text-primary transition-opacity hover:opacity-80"
        >
          {t("common.actions.reset", "Reset")}
        </button>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
        <span className="text-[10px] text-muted-foreground">
          {tSettings("effects.classicZoom", "Classic Animation")}
        </span>
        <Switch
          checked={zoomClassicMode}
          onCheckedChange={(v) => onZoomClassicModeChange?.(v)}
          className="data-[state=checked]:bg-primary scale-75"
        />
      </div>

      {!zoomClassicMode && (
        <div className="text-[10px] text-muted-foreground">
          {tSettings(
            "effects.motionPresetsZoomHint",
            "Zoom motion presets are available in Settings.",
          )}
        </div>
      )}

      <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2">
        <div className="text-[10px] text-muted-foreground">
          {tSettings(
            "effects.exportBlurLocked",
            "Export blur is fixed for this build.",
          )}
        </div>
        <div className="mt-1 text-[12px] font-medium text-foreground">{`${TEMPORAL_MOTION_BLUR_DEFAULT_SAMPLE_COUNT} samples · ${Math.round(TEMPORAL_MOTION_BLUR_DEFAULT_SHUTTER_FRACTION * 100)}% shutter`}</div>
      </div>

      {selectedZoomId && (
        <Button
          onClick={() => {
            if (selectedZoomId && onZoomDelete) onZoomDelete(selectedZoomId);
          }}
          variant="destructive"
          size="sm"
          className="mt-1 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
        >
          <Trash2 className="h-3 w-3" />
          {tSettings("zoom.deleteZoom")}
        </Button>
      )}

      {renderExtensionPanelsForSections("zoom", "appearance", "frame", "crop")}
    </section>
  );
}
export default ZoomSection;
