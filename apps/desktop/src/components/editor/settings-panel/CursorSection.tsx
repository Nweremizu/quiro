// import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import Scrubber from "@/components/ui/scrubber";
import { SectionLabel } from "./SectionLabel";
import { CursorStylePreview } from "./CursorStylePreview";
import { cn } from "@/lib/utils";
import { InformationCircleIcon } from "@/components/icons";
import {
  fromCursorSwaySliderValue,
  toCursorSwaySliderValue,
} from "../videoPlayback/cursorSway";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CursorStyle } from "@/types/editor";

interface CursorSectionProps {
  showCursor: boolean;
  onShowCursorChange?: (value: boolean) => void;
  loopCursor: boolean;
  onLoopCursorChange?: (value: boolean) => void;
  cursorStyle: CursorStyle;
  cursorStyleOptions: Array<{ value: CursorStyle; label: string }>;
  cursorPreviewUrls: Partial<Record<string, string>>;
  tahoeCursorUrl: string;
  onCursorStyleChange?: (value: CursorStyle) => void;
  cursorMotionBlur: number;
  defaultCursorMotionBlur: number;
  onCursorMotionBlurChange?: (value: number) => void;
  cursorClickBounce: number;
  defaultCursorClickBounce: number;
  onCursorClickBounceChange?: (value: number) => void;
  cursorClickBounceDuration: number;
  defaultCursorClickBounceDuration: number;
  onCursorClickBounceDurationChange?: (value: number) => void;
  cursorSway: number;
  defaultCursorSway: number;
  onCursorSwayChange?: (value: number) => void;
  cursorSize: number;
  defaultCursorSize: number;
  onCursorSizeChange?: (value: number) => void;
  showDevMotionControls: boolean;
  t: (key: string, fallback?: string) => string;
  tSettings: (key: string, fallback?: string) => string;
  resetCursorSection: () => void;
  renderExtensionPanelsForSections: (...args: string[]) => React.ReactNode;
}

export function CursorSection({
  showCursor,
  onShowCursorChange,
  loopCursor,
  onLoopCursorChange,
  cursorStyle,
  cursorStyleOptions,
  cursorPreviewUrls,
  tahoeCursorUrl,
  onCursorStyleChange,
  cursorMotionBlur,
  defaultCursorMotionBlur,
  onCursorMotionBlurChange,
  cursorClickBounce,
  defaultCursorClickBounce,
  onCursorClickBounceChange,
  cursorClickBounceDuration,
  defaultCursorClickBounceDuration,
  onCursorClickBounceDurationChange,
  cursorSway,
  defaultCursorSway,
  onCursorSwayChange,
  cursorSize,
  defaultCursorSize,
  onCursorSizeChange,
  showDevMotionControls,
  t,
  tSettings,
  resetCursorSection,
  renderExtensionPanelsForSections,
}: CursorSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 justify-between w-full">
          <div className="flex items-center gap-1">
            <SectionLabel>
              {tSettings("sections.cursor", "Cursor")}
            </SectionLabel>
            <Tooltip>
              <TooltipTrigger>
                <InformationCircleIcon className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className={"max-w-xs"} align="center">
                {showDevMotionControls ? (
                  <div className="rounded-lg border border-foreground/10 bg-foreground/3 px-3 py-2">
                    <div className="text-xs">
                      {tSettings(
                        "effects.cursorDebugMovedToDev",
                        "Cursor spring tuning is available in Settings > Dev.",
                      )}
                    </div>
                  </div>
                ) : null}
              </TooltipContent>
            </Tooltip>
          </div>
          <button
            type="button"
            onClick={resetCursorSection}
            className="text-xs text-primary transition-opacity hover:opacity-80"
          >
            {t("common.actions.reset", "Reset")}
          </button>
        </div>
      </div>
      <div className="flex flex-col justify-center w-full gap-3 my-2 rounded-lg border border-foreground/10 bg-foreground/3 px-3 py-2">
        <label className="flex items-center justify-between gap-1.5 text-sm text-muted-foreground">
          <span>{tSettings("effects.showCursor")}</span>
          <Switch
            checked={showCursor}
            onCheckedChange={onShowCursorChange}
            className="data-[state=checked]:bg-primary scale-85"
          />
        </label>
        <label className="flex items-center justify-between gap-1.5 text-sm text-muted-foreground">
          <span>{tSettings("effects.loopCursor")}</span>
          <Switch
            checked={loopCursor}
            onCheckedChange={onLoopCursorChange}
            className="data-[state=checked]:bg-primary scale-85"
          />
        </label>
      </div>
      <div className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label={tSettings("effects.cursorStyle", "Cursor Style")}
          className="grid grid-cols-2 gap-2"
        >
          {cursorStyleOptions.map((option) => {
            const isSelected = cursorStyle === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                title={option.label}
                onClick={() => onCursorStyleChange?.(option.value)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  "border-foreground/8 bg-transparent hover:border-foreground/15",
                  isSelected &&
                    "border-primary/60 bg-primary/8 text-foreground",
                )}
              >
                <div className="flex shrink-0 items-center justify-center">
                  <CursorStylePreview
                    style={option.value}
                    previewUrls={cursorPreviewUrls}
                    fallbackUrl={tahoeCursorUrl}
                  />
                </div>
                <span className="text-xs font-500 text-foreground/90">
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
        <Scrubber
          label={tSettings("effects.cursorSize")}
          value={cursorSize}
          size="sm"
          defaultValue={defaultCursorSize}
          min={1}
          max={16}
          step={0.1}
          onValueChange={(v) => onCursorSizeChange?.(v)}
          decimals={1}
          suffix="×"
        />
        <Scrubber
          label={tSettings("effects.cursorMotionBlur")}
          value={cursorMotionBlur}
          size="sm"
          defaultValue={defaultCursorMotionBlur}
          min={0}
          max={2}
          step={0.05}
          onValueChange={(v) => onCursorMotionBlurChange?.(v)}
          suffix="×"
        />
        <Scrubber
          label={tSettings("effects.cursorClickBounce")}
          value={cursorClickBounce}
          size="sm"
          defaultValue={defaultCursorClickBounce}
          min={0}
          max={5}
          step={0.05}
          onValueChange={(v) => onCursorClickBounceChange?.(v)}
          suffix="×"
        />
        <Scrubber
          label={tSettings("effects.cursorClickBounceDuration", "Bounce Speed")}
          value={cursorClickBounceDuration}
          size="sm"
          defaultValue={defaultCursorClickBounceDuration}
          min={60}
          max={500}
          step={5}
          onValueChange={(v) => onCursorClickBounceDurationChange?.(v)}
          decimals={0}
          suffix=" ms"
        />
        <Scrubber
          label={tSettings("effects.cursorSway")}
          value={toCursorSwaySliderValue(cursorSway)}
          size="sm"
          defaultValue={toCursorSwaySliderValue(defaultCursorSway)}
          min={0}
          max={toCursorSwaySliderValue(2)}
          step={toCursorSwaySliderValue(0.05)}
          onValueChange={(v) =>
            onCursorSwayChange?.(fromCursorSwaySliderValue(v))
          }
          valueFormatter={(v) =>
            v <= 0 ? tSettings("effects.off") : `${v.toFixed(2)}×`
          }
        />
      </div>
      {renderExtensionPanelsForSections("cursor")}
    </section>
  );
}
