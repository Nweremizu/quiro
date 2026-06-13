import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Scrubber from "@/components/ui/scrubber";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_AUTO_CAPTION_SETTINGS,
  type AutoCaptionSettings,
  type AutoCaptionAnimation,
} from "@/types/editor";

interface Option {
  value: string;
  label: string;
}

interface CaptionsSectionProps {
  tSettings: (key: string, fallback?: string) => string;
  t: (key: string, fallback?: string) => string;
  autoCaptionSettings: AutoCaptionSettings;
  updateAutoCaptionSettings: (partial: Partial<AutoCaptionSettings>) => void;
  whisperModelPath?: string | null;
  whisperModelDownloadStatus: string;
  whisperModelDownloadProgress: number;
  onPickWhisperModel?: () => void;
  onDeleteWhisperSmallModel?: () => void;
  onDownloadWhisperSmallModel?: () => void;
  onClearAutoCaptions?: () => void;
  onGenerateAutoCaptions?: () => void;
  isGeneratingCaptions: boolean;
  captionCueCount: number;
  renderExtensionPanelsForSections: (
    ...sections: string[]
  ) => ReactNode[];
  captionLanguageOptions: ReadonlyArray<Option>;
  captionAnimationOptions: ReadonlyArray<{
    value: AutoCaptionAnimation;
    label: string;
  }>;
}

export function CaptionsSection({
  tSettings,
  t,
  autoCaptionSettings,
  updateAutoCaptionSettings,
  whisperModelPath,
  whisperModelDownloadStatus,
  whisperModelDownloadProgress,
  onPickWhisperModel,
  onDeleteWhisperSmallModel,
  onDownloadWhisperSmallModel,
  onClearAutoCaptions,
  onGenerateAutoCaptions,
  isGeneratingCaptions,
  captionCueCount,
  renderExtensionPanelsForSections,
  captionLanguageOptions,
  captionAnimationOptions,
}: CaptionsSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {tSettings("sections.captions", "Captions")}
          </div>
          <button
            type="button"
            onClick={() =>
              updateAutoCaptionSettings(DEFAULT_AUTO_CAPTION_SETTINGS)
            }
            className="text-[10px] text-primary transition-opacity hover:opacity-80"
          >
            {t("common.actions.reset", "Reset")}
          </button>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{tSettings("captions.enabled", "Show")}</span>
          <Switch
            checked={autoCaptionSettings.enabled}
            onCheckedChange={(enabled) =>
              updateAutoCaptionSettings({ enabled })
            }
            className="data-[state=checked]:bg-primary scale-75"
          />
        </div>
      </div>

      <div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2 space-y-3">
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={onPickWhisperModel}
            className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 px-4 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            {tSettings("captions.selectModel", "Select Model")}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-foreground">
            {tSettings("captions.language", "Language")}
          </div>
          <Select
            value={autoCaptionSettings.language || "auto"}
            onValueChange={(value) =>
              updateAutoCaptionSettings({ language: value ?? undefined })
            }
          >
            <SelectTrigger className="h-10 w-[180px] rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
              {captionLanguageOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="grid w-full grid-cols-2 gap-2">
            {whisperModelDownloadStatus === "downloading" ? (
              <Button
                type="button"
                disabled
                className="h-10 w-full rounded-xl bg-foreground/10 px-4 text-sm font-medium text-foreground hover:bg-foreground/10"
              >
                {tSettings("captions.downloading", "Downloading...")}{" "}
                {Math.round(whisperModelDownloadProgress)}%
              </Button>
            ) : whisperModelPath ? (
              <Button
                type="button"
                variant="outline"
                onClick={onDeleteWhisperSmallModel}
                className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 px-4 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground"
              >
                {tSettings("captions.deleteModel", "Delete Model")}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onDownloadWhisperSmallModel}
                className="h-10 w-full rounded-xl bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90"
              >
                {tSettings("captions.downloadModel", "Download Model")}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onClearAutoCaptions}
              disabled={captionCueCount === 0}
              className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 px-4 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
            >
              {tSettings("captions.clearFull", "Clear Captions")}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            onClick={onGenerateAutoCaptions}
            disabled={isGeneratingCaptions || !whisperModelPath}
            className="h-10 w-full rounded-xl bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {isGeneratingCaptions
              ? tSettings("captions.generating", "Generating...")
              : captionCueCount > 0
                ? tSettings("captions.regenerateFull", "Regenerate Captions")
                : tSettings("captions.generateFull", "Generate Captions")}
          </Button>
          {isGeneratingCaptions ? (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                {tSettings(
                  "captions.generatingStatus",
                  "Generating captions. This can take a moment.",
                )}
              </div>
              <div className="indeterminate-progress h-2 rounded-full bg-foreground/5" />
            </div>
          ) : null}
        </div>
        {whisperModelDownloadStatus === "downloading" ? (
          <div className="h-2 overflow-hidden rounded-full bg-foreground/5">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${whisperModelDownloadProgress}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2">
          <div className="text-[10px] text-muted-foreground">
            {tSettings("captions.animation", "Animation")}
          </div>
          <Select
            value={autoCaptionSettings.animationStyle}
            onValueChange={(value) =>
              updateAutoCaptionSettings({
                animationStyle: value as AutoCaptionAnimation,
              })
            }
          >
            <SelectTrigger className="h-9 w-[160px] rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
              {captionAnimationOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-2">
          <span className="text-[10px] text-muted-foreground">
            {tSettings("captions.textColor", "Text color")}
          </span>
          <input
            type="color"
            value={autoCaptionSettings.textColor}
            onChange={(event) =>
              updateAutoCaptionSettings({ textColor: event.target.value })
            }
            className="h-7 w-10 rounded border border-foreground/10 bg-transparent"
          />
        </label>
        <div className="mb-1 text-sm font-medium text-foreground">
          {tSettings("captions.fontSettings", "Font Settings")}
        </div>
        <Scrubber
          label={tSettings("captions.fontSize", "Font size")}
          value={autoCaptionSettings.fontSize}
          defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.fontSize}
          min={16}
          max={72}
          step={1}
          onValueChange={(value) =>
            updateAutoCaptionSettings({ fontSize: value })
          }
          decimals={0}
          suffix="px"
        />
        <Scrubber
          label={tSettings("captions.rowCount", "Rows")}
          value={autoCaptionSettings.maxRows}
          defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.maxRows}
          min={1}
          max={4}
          step={1}
          onValueChange={(value) =>
            updateAutoCaptionSettings({ maxRows: Math.round(value) })
          }
          decimals={0}
        />
        <Scrubber
          label={tSettings("captions.bottomOffset", "Bottom offset")}
          value={autoCaptionSettings.bottomOffset}
          defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.bottomOffset}
          min={0}
          max={30}
          step={1}
          onValueChange={(value) =>
            updateAutoCaptionSettings({ bottomOffset: value })
          }
          decimals={0}
          suffix="%"
        />
        <Scrubber
          label={tSettings("captions.maxWidth", "Max width")}
          value={autoCaptionSettings.maxWidth}
          defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.maxWidth}
          min={40}
          max={95}
          step={1}
          onValueChange={(value) =>
            updateAutoCaptionSettings({ maxWidth: value })
          }
          decimals={0}
          suffix="%"
        />
        <Scrubber
          label={tSettings("captions.boxRadius", "Box radius")}
          value={autoCaptionSettings.boxRadius}
          defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.boxRadius}
          min={0}
          max={40}
          step={0.5}
          onValueChange={(value) =>
            updateAutoCaptionSettings({ boxRadius: value })
          }
          decimals={1}
          suffix="px"
        />
        <Scrubber
          label={tSettings("captions.backgroundOpacity", "Background opacity")}
          value={autoCaptionSettings.backgroundOpacity}
          defaultValue={DEFAULT_AUTO_CAPTION_SETTINGS.backgroundOpacity}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(value) =>
            updateAutoCaptionSettings({ backgroundOpacity: value })
          }
          valueFormatter={(value) => `${Math.round(value * 100)}%`}
        />
        {renderExtensionPanelsForSections("captions")}
      </div>
    </section>
  );
}
