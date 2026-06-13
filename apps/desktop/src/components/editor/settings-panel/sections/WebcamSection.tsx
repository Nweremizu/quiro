import React from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import Scrubber from "@/components/ui/scrubber";
import {
  Upload01Icon as Upload,
  Delete02Icon as Trash2,
  Camera01Icon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { WebcamCropControl } from "../../WebcamCropControl";
import type {
  WebcamOverlaySettings,
  CropRegion,
  WebcamPositionPreset,
  WebcamLayoutMode,
} from "@/types/editor";
import {
  DEFAULT_CROP_REGION,
  DEFAULT_WEBCAM_MARGIN,
  DEFAULT_WEBCAM_CORNER_RADIUS,
  DEFAULT_WEBCAM_SHADOW,
  DEFAULT_WEBCAM_SIZE,
  DEFAULT_WEBCAM_REACT_TO_ZOOM,
  DEFAULT_WEBCAM_LAYOUT_MODE,
} from "@/types/editor";

interface WebcamSectionProps {
  tSettings: (key: string, fallback?: string) => string;
  t: (key: string, fallback?: string) => string;
  resetWebcamSection: () => void;
  webcam?: WebcamOverlaySettings | null;
  webcamCrop: CropRegion;
  webcamPreviewSrc: string | null;
  webcamPreviewCurrentTime: number;
  webcamPreviewPlaying: boolean;
  updateWebcam: (patch: Partial<WebcamOverlaySettings>) => void;
  applyWebcamPositionPreset: (preset: WebcamPositionPreset) => void;
  webcamPositionPreset: WebcamPositionPreset | null;
  webcamPositionX: number;
  webcamPositionY: number;
  webcamFileName: string | null;
  onUploadWebcam?: () => void;
  onClearWebcam?: () => void;
  WEBCAM_POSITION_PRESETS: Array<{
    preset: Exclude<WebcamPositionPreset, "custom">;
    label: string;
  }>;
  renderExtensionPanelsForSections: (section: string) => React.ReactNode;
}

export function WebcamSection({
  tSettings,
  t,
  resetWebcamSection,
  webcam,
  webcamCrop,
  webcamPreviewSrc,
  webcamPreviewCurrentTime,
  webcamPreviewPlaying,
  updateWebcam,
  applyWebcamPositionPreset,
  webcamPositionPreset,
  webcamPositionX,
  webcamPositionY,
  webcamFileName,
  onUploadWebcam,
  onClearWebcam,
  WEBCAM_POSITION_PRESETS,
  renderExtensionPanelsForSections,
}: WebcamSectionProps) {
  const webcamLayoutMode: WebcamLayoutMode =
    webcam?.layoutMode ?? DEFAULT_WEBCAM_LAYOUT_MODE;
  const isSideBySide = webcamLayoutMode === "side-by-side";
  const WEBCAM_LAYOUT_MODES: Array<{ mode: WebcamLayoutMode; label: string }> = [
    { mode: "overlay", label: tSettings("effects.webcamLayoutOverlay", "Overlay") },
    {
      mode: "side-by-side",
      label: tSettings("effects.webcamLayoutSideBySide", "Side by side"),
    },
  ];

  if (!webcam?.sourcePath) {
    return (
      <section className="flex flex-col gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {tSettings("sections.webcam", "Webcam")}
        </div>
        <div className="flex flex-col items-center gap-3 rounded-xl bg-foreground/3 px-4 py-8 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-foreground/6 text-muted-foreground/60">
            <Camera01Icon className="size-5" />
          </div>
          <div className="flex flex-col gap-1 font-heading">
            <p className="text-sm font-medium text-foreground/80">
              No webcam in this recording
            </p>
            <p className="max-w-52 text-sm leading-normal text-muted-foreground/60 font-sans">
              This clip was captured without a webcam. Start a new recording
              with your camera on, or add footage manually.
            </p>
          </div>
          {onUploadWebcam && (
            <Button
              type="button"
              variant="outline"
              onClick={onUploadWebcam}
              className="mt-1 h-7 gap-1.5 border-foreground/10 bg-foreground/5 px-3 text-[10px] text-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <Upload className="h-3 w-3" />
              Add webcam footage
            </Button>
          )}

          <p className="mt-4 max-w-52 text-xs leading-normal text-primary/80">
            P.S. Don't forget to say cheese! 📸
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {tSettings("sections.webcam", "Webcam")}
          </div>
          <button
            type="button"
            onClick={resetWebcamSection}
            className="text-[10px] text-primary transition-opacity hover:opacity-80"
          >
            {t("common.actions.reset", "Reset")}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            {tSettings("effects.show", "Show")}
          </span>
          <Switch
            checked={webcam?.enabled ?? false}
            onCheckedChange={(enabled) => updateWebcam({ enabled })}
            className="data-[state=checked]:bg-primary scale-75"
          />
        </div>

        <div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2">
          <div className="mb-2 text-[10px] text-muted-foreground">
            {tSettings("effects.webcamLayout", "Layout")}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {WEBCAM_LAYOUT_MODES.map((option) => {
              const isActive = webcamLayoutMode === option.mode;
              return (
                <Button
                  key={option.mode}
                  type="button"
                  onClick={() => updateWebcam({ layoutMode: option.mode })}
                  className={cn(
                    "h-8 rounded-lg border px-0 text-[11px] font-semibold transition-all",
                    isActive
                      ? "border-primary bg-primary text-white"
                      : "border-foreground/10 bg-foreground/5 text-muted-foreground hover:border-foreground/20 hover:bg-foreground/10",
                  )}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>

        {!isSideBySide ? (
          <div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
            <span className="text-[10px] text-muted-foreground">
              {tSettings("effects.webcamReactToZoom")}
            </span>
            <Switch
              checked={webcam?.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM}
              onCheckedChange={(reactToZoom) => updateWebcam({ reactToZoom })}
              className="data-[state=checked]:bg-primary scale-75"
            />
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            {tSettings("effects.webcamMirror", "Mirror webcam")}
          </span>
          <Switch
            checked={webcam?.mirror ?? true}
            onCheckedChange={(mirror) => updateWebcam({ mirror })}
            className="data-[state=checked]:bg-primary scale-75"
          />
        </div>

        {!isSideBySide ? (
          <Scrubber
            size="sm"
            label={tSettings("effects.webcamSize")}
            value={webcam?.size ?? DEFAULT_WEBCAM_SIZE}
            defaultValue={DEFAULT_WEBCAM_SIZE}
            min={10}
            max={100}
            step={1}
            onValueChange={(v) => updateWebcam({ size: v })}
            decimals={0}
            suffix="%"
          />
        ) : null}

        <div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] text-muted-foreground">
              {tSettings("effects.webcamCrop", "Crop")}
            </div>
            <button
              type="button"
              onClick={() => updateWebcam({ cropRegion: DEFAULT_CROP_REGION })}
              className="text-[10px] text-primary transition-opacity hover:opacity-80"
            >
              {t("common.actions.reset", "Reset")}
            </button>
          </div>
          <WebcamCropControl
            cropRegion={webcamCrop}
            mirrored={webcam?.mirror ?? true}
            previewSrc={webcamPreviewSrc}
            previewCurrentTime={webcamPreviewCurrentTime}
            previewPlaying={webcamPreviewPlaying}
            previewTimeOffsetMs={webcam?.timeOffsetMs}
            onCropChange={(cropRegion) => updateWebcam({ cropRegion })}
          />
        </div>

        {!isSideBySide ? (
        <>
        <div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2">
          <div className="mb-2 text-[10px] text-muted-foreground">
            {tSettings("effects.webcamPosition", "Position")}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {WEBCAM_POSITION_PRESETS.map((option) => {
              const isActive = webcamPositionPreset === option.preset;
              return (
                <Button
                  key={option.preset}
                  type="button"
                  onClick={() => applyWebcamPositionPreset(option.preset)}
                  className={cn(
                    "h-8 rounded-lg border px-0 text-sm font-semibold transition-all",
                    isActive
                      ? "border-primary bg-primary text-white"
                      : "border-foreground/10 bg-foreground/5 text-muted-foreground hover:border-foreground/20 hover:bg-foreground/10",
                  )}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-black/10 px-2.5 py-1.5">
            <span className="text-[10px] text-muted-foreground">
              {tSettings("effects.webcamCustomPosition", "Custom position")}
            </span>
            <Switch
              checked={webcamPositionPreset === "custom"}
              onCheckedChange={(checked) =>
                applyWebcamPositionPreset(
                  checked
                    ? "custom"
                    : ((WEBCAM_POSITION_PRESETS[0]?.preset ??
                        "top-left") as WebcamPositionPreset),
                )
              }
              className="data-[state=checked]:bg-primary scale-75"
            />
          </div>
        </div>

        {webcamPositionPreset === "custom" ? (
          <>
            <Scrubber
              size="sm"
              label={tSettings("effects.webcamHorizontal", "Horizontal")}
              value={webcamPositionX * 100}
              defaultValue={0}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) =>
                updateWebcam({ positionPreset: "custom", positionX: v / 100 })
              }
              decimals={0}
              suffix="%"
            />
            <Scrubber
              size="sm"
              label={tSettings("effects.webcamVertical", "Vertical")}
              value={webcamPositionY * 100}
              defaultValue={0}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) =>
                updateWebcam({ positionPreset: "custom", positionY: v / 100 })
              }
              decimals={0}
              suffix="%"
            />
          </>
        ) : null}

        <Scrubber
          size="sm"
          label={tSettings("effects.webcamMargin", "Margin")}
          value={webcam?.margin ?? DEFAULT_WEBCAM_MARGIN}
          defaultValue={DEFAULT_WEBCAM_MARGIN}
          min={0}
          max={96}
          step={1}
          onValueChange={(v) => updateWebcam({ margin: v })}
          decimals={0}
          suffix="px"
        />
        </>
        ) : null}

        <Scrubber
          size="sm"
          label={tSettings("effects.webcamRoundness")}
          value={webcam?.cornerRadius ?? DEFAULT_WEBCAM_CORNER_RADIUS}
          defaultValue={DEFAULT_WEBCAM_CORNER_RADIUS}
          min={0}
          max={160}
          step={1}
          onValueChange={(v) => updateWebcam({ cornerRadius: v })}
          decimals={0}
          suffix="px"
        />

        <Scrubber
          size="sm"
          label={tSettings("effects.webcamShadow")}
          value={webcam?.shadow ?? DEFAULT_WEBCAM_SHADOW}
          defaultValue={DEFAULT_WEBCAM_SHADOW}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(v) => updateWebcam({ shadow: v })}
          valueFormatter={(v) => `${Math.round(v * 100)}%`}
        />

        <div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2">
          <div className="flex flex-col gap-2">
            <div className="min-w-0">
              <div className="text-[10px] text-muted-foreground">
                {tSettings("effects.webcamFootage")}
              </div>
              <div className="mt-0.5 break-all text-[10px] leading-4 text-muted-foreground/70">
                {webcamFileName ??
                  tSettings("effects.webcamFootageDescription")}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                onClick={onUploadWebcam}
                className="h-7 min-w-0 gap-1.5 border-foreground/10 bg-foreground/5 px-2 text-[10px] text-foreground hover:bg-foreground/10 hover:text-foreground"
              >
                <Upload className="h-3 w-3" />
                <span className="min-w-0 truncate">
                  {webcam?.sourcePath
                    ? tSettings("effects.replaceWebcamFootage")
                    : tSettings("effects.uploadWebcamFootage")}
                </span>
              </Button>
              {webcam?.sourcePath ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClearWebcam}
                  className="h-7 min-w-0 gap-1.5 border-foreground/10 bg-foreground/5 px-2 text-[10px] text-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  <Trash2 className="h-3 w-3" />
                  <span className="min-w-0 truncate">
                    {tSettings("effects.removeWebcamFootage")}
                  </span>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        {renderExtensionPanelsForSections("webcam")}
      </div>
    </section>
  );
}
export default WebcamSection;
