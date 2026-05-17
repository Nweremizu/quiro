import React from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import Scrubber from "@/components/ui/scrubber";
import { useScopedT } from "@/contexts/I18nContext";
import type { AutoCaptionSettings, AutoCaptionAnimation } from "@/types/editor";
import {
  CAPTION_LANGUAGE_OPTIONS,
  CAPTION_ANIMATION_OPTIONS,
} from "./constants";

interface CaptionsSectionProps {
  autoCaptionSettings: AutoCaptionSettings;
  updateAutoCaptionSettings: (partial: Partial<AutoCaptionSettings>) => void;
  onPickWhisperModel: () => void;
  whisperModelDownloadStatus: string;
  whisperModelDownloadProgress: number;
  whisperModelPath?: string;
  onDeleteWhisperSmallModel: () => void;
  onDownloadWhisperSmallModel: () => void;
  onClearAutoCaptions: () => void;
  captionCueCount: number;
  onGenerateAutoCaptions: () => void;
  isGeneratingCaptions: boolean;
  renderExtensionPanelsForSections: (section: string) => React.ReactNode;
  onResetAutoCaptionSettings: () => void;
}

export function CaptionsSection({
  autoCaptionSettings,
  updateAutoCaptionSettings,
  onPickWhisperModel,
  whisperModelDownloadStatus,
  whisperModelDownloadProgress,
  whisperModelPath,
  onDeleteWhisperSmallModel,
  onDownloadWhisperSmallModel,
  onClearAutoCaptions,
  captionCueCount,
  onGenerateAutoCaptions,
  isGeneratingCaptions,
  renderExtensionPanelsForSections,
  onResetAutoCaptionSettings,
}: CaptionsSectionProps) {
  const tSettings = useScopedT("settings");

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium text-foreground">
            {tSettings("sections.captions", "Captions")}
          </div>
          <button
            type="button"
            onClick={onResetAutoCaptionSettings}
            className="text-[10px] text-primary transition-opacity hover:opacity-80"
          >
            {"Reset"}
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

      <div className="rounded-lg bg-foreground/3 px-2.5 py-2 space-y-3">
        <div>
          <Button type="button" variant="outline" onClick={onPickWhisperModel}>
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
            <SelectTrigger className="h-10 w-45 rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
              {CAPTION_LANGUAGE_OPTIONS.map((option) => (
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
        <div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/3 px-2.5 py-2">
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
            <SelectTrigger className="h-9 w-40 rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
              {CAPTION_ANIMATION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg bg-foreground/3 px-2.5 py-2 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-muted-foreground">
                {tSettings("captions.appearance.textColor", "Text Color")}
              </div>
              <input
                type="color"
                value={autoCaptionSettings.textColor}
                onChange={(e) =>
                  updateAutoCaptionSettings({ textColor: e.target.value })
                }
                className="w-12 h-8 rounded-md"
              />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">
                {tSettings("captions.appearance.fontSize", "Font Size")}
              </div>
              <Scrubber
                label=""
                size="sm"
                value={autoCaptionSettings.fontSize}
                min={8}
                max={48}
                step={1}
                onValueChange={(v) =>
                  updateAutoCaptionSettings({ fontSize: v })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-muted-foreground">
                {tSettings("captions.appearance.maxRows", "Max Rows")}
              </div>
              <Scrubber
                label=""
                size="sm"
                value={autoCaptionSettings.maxRows}
                min={1}
                max={5}
                step={1}
                onValueChange={(v) =>
                  updateAutoCaptionSettings({ maxRows: Math.round(v) })
                }
              />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">
                {tSettings("captions.appearance.bottomOffset", "Bottom Offset")}
              </div>
              <Scrubber
                label=""
                size="sm"
                value={autoCaptionSettings.bottomOffset}
                min={0}
                max={200}
                step={1}
                onValueChange={(v) =>
                  updateAutoCaptionSettings({ bottomOffset: v })
                }
              />
            </div>
          </div>
        </div>
      </div>

      {renderExtensionPanelsForSections("captions")}
    </section>
  );
}
