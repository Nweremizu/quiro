import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Switch } from "@/components/ui/switch";
import Scrubber from "@/components/ui/scrubber";
import { cn } from "@/lib/utils";
import { CursorStylePreview } from "../CursorStylePreview";
import { SectionLabel } from "../SectionLabel";
import { InfoTooltip } from "../shared";
import type {
  CursorClickEffectId,
  CursorClickEffectSettings,
  CursorStyle,
} from "@/types/editor";
import {
  DEFAULT_CURSOR_CLICK_BOUNCE,
  DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
  DEFAULT_CURSOR_CLICK_EFFECT,
  DEFAULT_CURSOR_MOTION_BLUR,
  DEFAULT_CURSOR_SWAY,
} from "@/types/editor";
import {
  toCursorSwaySliderValue,
  fromCursorSwaySliderValue,
} from "../../videoPlayback/cursorSway";

interface CursorSectionProps {
  tSettings: (key: string, fallback?: string) => string;
  t: (key: string, fallback?: string) => string;
  resetCursorSection: () => void;
  showCursor: boolean;
  onShowCursorChange?: (v: boolean) => void;
  loopCursor: boolean;
  onLoopCursorChange?: (v: boolean) => void;
  cursorStyle: CursorStyle;
  onCursorStyleChange?: (v: CursorStyle) => void;
  cursorStyleOptions: Array<{ value: string; label: string }>;
  cursorPreviewUrls: Partial<Record<string, string>>;
  cursorMotionBlur: number;
  onCursorMotionBlurChange?: (v: number) => void;
  cursorClickBounce: number;
  onCursorClickBounceChange?: (v: number) => void;
  cursorClickBounceDuration: number;
  onCursorClickBounceDurationChange?: (v: number) => void;
  cursorClickEffect: CursorClickEffectSettings;
  onCursorClickEffectChange?: (v: CursorClickEffectSettings) => void;
  cursorSway: number;
  onCursorSwayChange?: (v: number) => void;
  showDevMotionControls: boolean;
  renderExtensionPanelsForSections: (
    section: string,
    ...rest: string[]
  ) => ReactNode;
}

const cursorSurfaceClass: Record<string, string> = {
  macos: "bg-gradient-to-br from-white to-stone-100 dark:from-stone-200 dark:to-stone-400",
  tahoe: "bg-gradient-to-br from-brand-100/80 to-brand-300/70 dark:from-brand-500/20 dark:to-brand-400/30",
  "tahoe-inverted": "bg-gradient-to-br from-stone-900 to-stone-700",
  dot: "bg-gradient-to-br from-stone-50 to-stone-200 dark:from-stone-800 dark:to-stone-700",
  figma: "bg-gradient-to-br from-brand-50 to-stone-100 dark:from-brand-500/20 dark:to-stone-700",
};

const cursorClickEffectOptions: Array<{
  id: CursorClickEffectId;
  label: string;
}> = [
  { id: "none", label: "None" },
  { id: "ring", label: "Ring" },
  { id: "pulse", label: "Pulse" },
  { id: "ripple", label: "Ripple" },
  { id: "spotlight", label: "Spot" },
  { id: "label", label: "Label" },
];

function SettingsGroup({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="mb-3 flex items-center gap-1.5">
        <SectionLabel>{title}</SectionLabel>
        <InfoTooltip>{description}</InfoTooltip>
      </div>
      {children}
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] font-medium leading-4 text-foreground">
          <span className="min-w-0 truncate">{title}</span>
          <InfoTooltip>{description}</InfoTooltip>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CursorStyleButton({
  value,
  label,
  isSelected,
  previewUrls,
  onSelect,
}: {
  value: CursorStyle;
  label: string;
  isSelected: boolean;
  previewUrls: Partial<Record<string, string>>;
  onSelect: (value: CursorStyle) => void;
}) {
  const surfaceClass =
    cursorSurfaceClass[value] ??
    "bg-gradient-to-br from-stone-100 to-stone-200 dark:from-stone-800 dark:to-stone-700";

  return (
    <motion.button
      type="button"
      layout
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(value)}
      aria-pressed={isSelected}
      className={cn(
        "group relative min-h-[82px] overflow-hidden rounded-xl border p-2.5 text-left transition-colors",
        "border-border/70 bg-transparent hover:border-border hover:bg-foreground/[0.03]",
        isSelected && "border-primary/50 bg-primary/[0.06]",
      )}
    >
      {isSelected ? (
        <motion.span
          layoutId="cursor-style-active"
          className="absolute inset-0 rounded-xl ring-1 ring-primary/55"
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        />
      ) : null}

      <div className="relative z-10 flex h-full flex-col justify-between gap-2">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg border border-white/40 shadow-sm",
            surfaceClass,
          )}
        >
          <CursorStylePreview
            style={value}
            previewUrls={previewUrls}
            fallbackUrl="/"
            imageOverrideClassName="drop-shadow-none"
            macosClassName="drop-shadow-none"
            size={30}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[10px] font-medium leading-3 text-foreground">
            {label}
          </span>
          {isSelected ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          ) : null}
        </div>
      </div>
    </motion.button>
  );
}

export function CursorSection({
  tSettings,
  t,
  resetCursorSection,
  showCursor,
  onShowCursorChange,
  loopCursor,
  onLoopCursorChange,
  cursorStyle,
  onCursorStyleChange,
  cursorStyleOptions,
  cursorPreviewUrls,
  cursorMotionBlur,
  onCursorMotionBlurChange,
  cursorClickBounce,
  onCursorClickBounceChange,
  cursorClickBounceDuration,
  onCursorClickBounceDurationChange,
  cursorClickEffect,
  onCursorClickEffectChange,
  cursorSway,
  onCursorSwayChange,
  showDevMotionControls,
  renderExtensionPanelsForSections,
}: CursorSectionProps) {
  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>{tSettings("sections.cursor", "Cursor")}</SectionLabel>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground/70">
            {tSettings(
              "effects.cursorSectionHint",
              "Choose the pointer style and tune how it moves through the recording.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={resetCursorSection}
          className="shrink-0 text-[10px] text-primary transition-opacity hover:opacity-80"
        >
          {t("common.actions.reset", "Reset")}
        </button>
      </div>

      <SettingsGroup title={tSettings("effects.cursorBehavior", "Behavior")}>
        <div className="space-y-1">
          <SettingRow
            title={tSettings("effects.showCursor")}
            description={tSettings(
              "effects.showCursorHint",
              "Display the pointer on top of the recording.",
            )}
          >
            <Switch
              checked={showCursor}
              onCheckedChange={onShowCursorChange}
              className="data-[state=checked]:bg-primary scale-75"
            />
          </SettingRow>
          <SettingRow
            title={tSettings("effects.loopCursor")}
            description={tSettings(
              "effects.loopCursorHint",
              "Keep cursor motion available across looped playback.",
            )}
          >
            <Switch
              checked={loopCursor}
              onCheckedChange={onLoopCursorChange}
              className="data-[state=checked]:bg-primary scale-75"
            />
          </SettingRow>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={tSettings("effects.cursorStyle", "Cursor Style")}
        description={tSettings(
          "effects.cursorStyleHint",
          "Pick a cursor treatment that matches the visual tone of the edit.",
        )}
      >
        <div className="grid grid-cols-3 gap-2">
          {cursorStyleOptions.map((option) => (
            <CursorStyleButton
              key={option.value}
              value={option.value as CursorStyle}
              label={option.label}
              isSelected={cursorStyle === option.value}
              previewUrls={cursorPreviewUrls}
              onSelect={(value) => onCursorStyleChange?.(value)}
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={tSettings("effects.cursorClickEffects", "Click Effects")}
        description={tSettings(
          "effects.cursorClickEffectsHint",
          "Add a visual response when click telemetry is present.",
        )}
      >
        <div className="grid grid-cols-3 gap-2">
          {cursorClickEffectOptions.map((option) => (
            <motion.button
              key={option.id}
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() =>
                onCursorClickEffectChange?.({
                  ...cursorClickEffect,
                  id: option.id,
                })
              }
              className={cn(
                "h-9 rounded-lg border px-2 text-[10px] font-medium transition-colors",
                "border-border/70 hover:border-border hover:bg-foreground/[0.03]",
                cursorClickEffect.id === option.id &&
                  "border-primary/55 bg-primary/[0.07] text-primary",
              )}
            >
              {option.label}
            </motion.button>
          ))}
        </div>
        <div className="mt-3 space-y-2.5">
          <Scrubber
            size="sm"
            label={tSettings("effects.clickEffectDuration", "Duration")}
            value={cursorClickEffect.durationMs}
            defaultValue={DEFAULT_CURSOR_CLICK_EFFECT.durationMs}
            min={120}
            max={2000}
            step={10}
            onValueChange={(durationMs) =>
              onCursorClickEffectChange?.({ ...cursorClickEffect, durationMs })
            }
            decimals={0}
            suffix=" ms"
          />
          <Scrubber
            size="sm"
            label={tSettings("effects.clickEffectIntensity", "Intensity")}
            value={cursorClickEffect.intensity}
            defaultValue={DEFAULT_CURSOR_CLICK_EFFECT.intensity}
            min={0}
            max={1.5}
            step={0.05}
            onValueChange={(intensity) =>
              onCursorClickEffectChange?.({ ...cursorClickEffect, intensity })
            }
            suffix="×"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={tSettings("effects.cursorMotion", "Motion")}
        description={tSettings(
          "effects.cursorMotionHint",
          "Adjust blur, bounce, and sway without changing the selected style.",
        )}
      >
        <div className="space-y-2.5">
          <Scrubber
            size="sm"
            label={tSettings("effects.cursorMotionBlur")}
            value={cursorMotionBlur}
            defaultValue={DEFAULT_CURSOR_MOTION_BLUR}
            min={0}
            max={2}
            step={0.05}
            onValueChange={(v) => onCursorMotionBlurChange?.(v)}
            suffix="×"
          />

          <Scrubber
            size="sm"
            label={tSettings("effects.cursorClickBounce")}
            value={cursorClickBounce}
            defaultValue={DEFAULT_CURSOR_CLICK_BOUNCE}
            min={0}
            max={5}
            step={0.05}
            onValueChange={(v) => onCursorClickBounceChange?.(v)}
            suffix="×"
          />

          <Scrubber
            size="sm"
            label={tSettings(
              "effects.cursorClickBounceDuration",
              "Bounce Speed",
            )}
            value={cursorClickBounceDuration}
            defaultValue={DEFAULT_CURSOR_CLICK_BOUNCE_DURATION}
            min={60}
            max={500}
            step={5}
            onValueChange={(v) => onCursorClickBounceDurationChange?.(v)}
            decimals={0}
            suffix=" ms"
          />

          <Scrubber
            size="sm"
            label={tSettings("effects.cursorSway")}
            value={toCursorSwaySliderValue(cursorSway)}
            defaultValue={toCursorSwaySliderValue(DEFAULT_CURSOR_SWAY)}
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
      </SettingsGroup>

      {showDevMotionControls ? (
        <div className="text-[10px] leading-4 text-muted-foreground/70">
          {tSettings(
            "effects.cursorDebugMovedToDev",
            "Cursor spring tuning is available in Settings > Dev.",
          )}
        </div>
      ) : null}

      {renderExtensionPanelsForSections("cursor")}
    </section>
  );
}

export default CursorSection;
