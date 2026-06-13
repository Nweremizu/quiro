import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SectionLabel } from "./SectionLabel";
import { MotionPresetCards } from "./MotionPresetCards";
import { KeyboardShortcutsDialog } from "../help";
import Scrubber from "@/components/ui/scrubber";
import { InfoTooltip } from "./shared";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import type { ZoomMotionBlurTuning } from "@/types/editor";
import type { CursorMotionPresetId } from "../utils/cursor-motion-presets";
import { APP_LANGUAGE_LABELS } from "./constants";

interface SettingsSectionProps {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: string, fallback?: string) => string;
  tSettings: (key: string, fallback?: string) => string;
  themePreference: "light" | "dark" | "system";
  setThemePreference: (pref: "light" | "dark" | "system") => void;
  autoApplyFreshRecordingAutoZooms: boolean;
  onAutoApplyFreshRecordingAutoZoomsChange?: (value: boolean) => void;
  connectZooms: boolean;
  onConnectZoomsChange?: (value: boolean) => void;
  activeMotionPresetId: CursorMotionPresetId;
  onApplyMotionPreset: (presetId: CursorMotionPresetId) => void;
  showDevMotionControls: boolean;
  nativeCaptureUnavailableSession: boolean;
  onOpenNativeCaptureUnavailableModal?: () => void;
  zoomMotionBlurTuning: ZoomMotionBlurTuning;
  initialZoomMotionBlurTuning: ZoomMotionBlurTuning;
  onZoomMotionBlurTuningChange?: (tuning: ZoomMotionBlurTuning) => void;
  cameraSpringStiffnessMultiplier: number;
  onCameraSpringStiffnessMultiplierChange?: (value: number) => void;
  initialCameraSpringStiffnessMultiplier: number;
  cameraSpringDampingMultiplier: number;
  onCameraSpringDampingMultiplierChange?: (value: number) => void;
  initialCameraSpringDampingMultiplier: number;
  cameraSpringMassMultiplier: number;
  onCameraSpringMassMultiplierChange?: (value: number) => void;
  initialCameraSpringMassMultiplier: number;
  cursorSpringStiffnessMultiplier: number;
  onCursorSpringStiffnessMultiplierChange?: (value: number) => void;
  initialCursorSpringStiffnessMultiplier: number;
  cursorSpringDampingMultiplier: number;
  onCursorSpringDampingMultiplierChange?: (value: number) => void;
  initialCursorSpringDampingMultiplier: number;
  cursorSpringMassMultiplier: number;
  onCursorSpringMassMultiplierChange?: (value: number) => void;
  initialCursorSpringMassMultiplier: number;
}

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
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-1.5",
        className,
      )}
    >
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

function ScrubberStack({ children }: { children: ReactNode }) {
  return <div className="space-y-2.5 py-2">{children}</div>;
}

export function SettingsSection({
  locale,
  setLocale,
  t,
  tSettings,
  themePreference,
  setThemePreference,
  autoApplyFreshRecordingAutoZooms,
  onAutoApplyFreshRecordingAutoZoomsChange,
  connectZooms,
  onConnectZoomsChange,
  activeMotionPresetId,
  onApplyMotionPreset,
  showDevMotionControls,
  nativeCaptureUnavailableSession,
  onOpenNativeCaptureUnavailableModal,
  zoomMotionBlurTuning,
  initialZoomMotionBlurTuning,
  onZoomMotionBlurTuningChange,
  cameraSpringStiffnessMultiplier,
  onCameraSpringStiffnessMultiplierChange,
  initialCameraSpringStiffnessMultiplier,
  cameraSpringDampingMultiplier,
  onCameraSpringDampingMultiplierChange,
  initialCameraSpringDampingMultiplier,
  cameraSpringMassMultiplier,
  onCameraSpringMassMultiplierChange,
  initialCameraSpringMassMultiplier,
  cursorSpringStiffnessMultiplier,
  onCursorSpringStiffnessMultiplierChange,
  initialCursorSpringStiffnessMultiplier,
  cursorSpringDampingMultiplier,
  onCursorSpringDampingMultiplierChange,
  initialCursorSpringDampingMultiplier,
  cursorSpringMassMultiplier,
  onCursorSpringMassMultiplierChange,
  initialCursorSpringMassMultiplier,
}: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      <SettingsGroup
        title={t("editor.theme.appearance", "Appearance")}
        description={tSettings(
          "settings.appearanceHint",
          "Choose how the editor shell should render.",
        )}
      >
        <div className="flex rounded-lg border border-border bg-foreground/[0.04] p-0.5">
          {(
            [
              { value: "light", label: t("editor.theme.light", "Light") },
              { value: "dark", label: t("editor.theme.dark", "Dark") },
              { value: "system", label: t("editor.theme.system", "System") },
            ] as const
          ).map((option) => {
            const isActive = option.value === themePreference;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setThemePreference(option.value)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  "text-muted-foreground hover:text-foreground",
                  isActive &&
                    "bg-primary text-primary-foreground shadow-sm hover:text-primary-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("common.app.language", "Language")}>
        <SettingRow
          title={t("common.app.language", "Language")}
          description={tSettings(
            "settings.languageHint",
            "Use one language across editor labels and controls.",
          )}
        >
          <Select
            value={locale}
            onValueChange={(value) => setLocale(value as AppLocale)}
          >
            <SelectTrigger className="h-8 w-36 rounded-md border-border bg-transparent text-xs text-foreground hover:bg-foreground/[0.03]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-popover text-popover-foreground shadow-lg">
              {SUPPORTED_LOCALES.map((candidateLocale) => (
                <SelectItem key={candidateLocale} value={candidateLocale}>
                  {APP_LANGUAGE_LABELS[candidateLocale]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title={tSettings("settings.automation", "Automation")}
        description={tSettings(
          "settings.automationHint",
          "Decide which timeline behaviors should happen automatically.",
        )}
      >
        <SettingRow
          title={tSettings(
            "effects.autoApplyFreshRecordingZooms",
            "Auto-apply fresh recording zooms",
          )}
          description={tSettings(
            "effects.autoApplyFreshRecordingZoomsDescription",
            "Suggest cursor-follow zooms automatically when you open a new recording.",
          )}
        >
          <Switch
            checked={autoApplyFreshRecordingAutoZooms}
            onCheckedChange={onAutoApplyFreshRecordingAutoZoomsChange}
            className="data-[state=checked]:bg-primary scale-75"
          />
        </SettingRow>
        <SettingRow
          title={tSettings("effects.connectZooms", "Connect neighboring zooms")}
          description={tSettings(
            "effects.connectZoomsDescription",
            "Smooth consecutive zoom regions into a continuous camera move.",
          )}
        >
          <Switch
            checked={connectZooms}
            onCheckedChange={onConnectZoomsChange}
            className="data-[state=checked]:bg-primary scale-75"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title={tSettings("effects.motionPresetsTitle", "Motion Presets")}
        description={tSettings(
          "settings.motionPresetsHint",
          "Apply a cohesive motion feel to zoom and cursor behavior.",
        )}
      >
        <div className="py-1">
          <MotionPresetCards
            title={tSettings("effects.motionPresetsTitle", "Motion Presets")}
            activePresetId={activeMotionPresetId}
            onApply={onApplyMotionPreset}
            tSettings={tSettings}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("editor.keyboardShortcuts.title")}>
        <SettingRow
          title={t("editor.keyboardShortcuts.title")}
          description={tSettings(
            "settings.keyboardShortcutsHint",
            "Review and customize editor commands.",
          )}
        >
          <KeyboardShortcutsDialog
            triggerLabel={t("editor.keyboardShortcuts.customize")}
            triggerClassName="h-8 rounded-md border border-border bg-transparent px-3 text-xs text-foreground hover:bg-foreground/[0.04] hover:text-foreground"
          />
        </SettingRow>
      </SettingsGroup>

      {showDevMotionControls ? (
        <SettingsGroup
          title={tSettings("effects.devSection", "Dev")}
          description={tSettings(
            "effects.devSectionHint",
            "Temporary testing controls for native capture and motion tuning.",
          )}
        >
          <SettingRow
            title={tSettings(
              "effects.nativeCaptureWarningTester",
              "Native capture warning",
            )}
            description={
              nativeCaptureUnavailableSession
                ? tSettings(
                    "effects.nativeCaptureWarningTesterUnavailable",
                    "This project is currently marked as native capture unavailable.",
                  )
                : tSettings(
                    "effects.nativeCaptureWarningTesterAvailable",
                    "This project is not marked as unsupported, but you can still open the modal for UI testing.",
                  )
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenNativeCaptureUnavailableModal?.()}
              className="h-8 shrink-0 rounded-md border-primary/20 bg-transparent text-xs text-primary hover:bg-primary/10"
            >
              {tSettings("effects.openNativeCaptureWarning", "Open warning")}
            </Button>
          </SettingRow>

          <ScrubberStack>
            <div className="flex items-center gap-1.5">
              <SectionLabel>
                {tSettings("effects.motionBlurDebug", "Motion Blur Debug")}
              </SectionLabel>
              <InfoTooltip>
                {tSettings(
                  "effects.motionBlurDebugHint",
                  "Development-only tuning for the split move-vs-zoom blur path. Pan controls drive the streak filter, and zoom controls drive the focus-centered zoom filter.",
                )}
              </InfoTooltip>
            </div>
            <Scrubber
              label={tSettings(
                "effects.motionBlurPanThreshold",
                "Pan threshold",
              )}
              value={zoomMotionBlurTuning.panVelocityThreshold}
              defaultValue={initialZoomMotionBlurTuning.panVelocityThreshold}
              min={0}
              max={240}
              step={1}
              onValueChange={(value) =>
                onZoomMotionBlurTuningChange?.({
                  ...zoomMotionBlurTuning,
                  panVelocityThreshold: value,
                })
              }
              decimals={0}
              suffix=" px/s"
            />
            <Scrubber
              label={tSettings("effects.motionBlurPanStrength", "Pan max blur")}
              value={zoomMotionBlurTuning.maxDirectionalBlurPx}
              defaultValue={initialZoomMotionBlurTuning.maxDirectionalBlurPx}
              min={0}
              max={32}
              step={0.1}
              onValueChange={(value) =>
                onZoomMotionBlurTuningChange?.({
                  ...zoomMotionBlurTuning,
                  maxDirectionalBlurPx: value,
                })
              }
              decimals={1}
              suffix=" px"
            />
            <Scrubber
              label={tSettings(
                "effects.motionBlurZoomThreshold",
                "Zoom threshold",
              )}
              value={zoomMotionBlurTuning.zoomVelocityThreshold}
              defaultValue={initialZoomMotionBlurTuning.zoomVelocityThreshold}
              min={0}
              max={0.4}
              step={0.005}
              onValueChange={(value) =>
                onZoomMotionBlurTuningChange?.({
                  ...zoomMotionBlurTuning,
                  zoomVelocityThreshold: value,
                })
              }
              decimals={3}
            />
            <Scrubber
              label={tSettings(
                "effects.motionBlurZoomStrength",
                "Zoom blur strength",
              )}
              value={zoomMotionBlurTuning.maxRadialBlurStrength}
              defaultValue={initialZoomMotionBlurTuning.maxRadialBlurStrength}
              min={0}
              max={0.5}
              step={0.005}
              onValueChange={(value) =>
                onZoomMotionBlurTuningChange?.({
                  ...zoomMotionBlurTuning,
                  maxRadialBlurStrength: value,
                })
              }
              decimals={3}
            />
          </ScrubberStack>

          <ScrubberStack>
            <div className="flex items-center gap-1.5">
              <SectionLabel>
                {tSettings("effects.cameraSpringControls", "Camera Spring")}
              </SectionLabel>
              <InfoTooltip>
                {tSettings(
                  "effects.cameraSpringControlsHint",
                  "Tune camera movement physics.",
                )}
              </InfoTooltip>
            </div>
            <Scrubber
              label={tSettings(
                "effects.cameraSpringStiffnessMultiplier",
                "Camera stiffness",
              )}
              value={cameraSpringStiffnessMultiplier}
              defaultValue={initialCameraSpringStiffnessMultiplier}
              min={0.25}
              max={3}
              step={0.01}
              onValueChange={(value) =>
                onCameraSpringStiffnessMultiplierChange?.(value)
              }
              suffix="×"
            />
            <Scrubber
              label={tSettings(
                "effects.cameraSpringDampingMultiplier",
                "Camera damping",
              )}
              value={cameraSpringDampingMultiplier}
              defaultValue={initialCameraSpringDampingMultiplier}
              min={0.25}
              max={3}
              step={0.01}
              onValueChange={(value) =>
                onCameraSpringDampingMultiplierChange?.(value)
              }
              suffix="×"
            />
            <Scrubber
              label={tSettings(
                "effects.cameraSpringMassMultiplier",
                "Camera mass",
              )}
              value={cameraSpringMassMultiplier}
              defaultValue={initialCameraSpringMassMultiplier}
              min={0.25}
              max={3}
              step={0.01}
              onValueChange={(value) =>
                onCameraSpringMassMultiplierChange?.(value)
              }
              suffix="×"
            />
          </ScrubberStack>

          <ScrubberStack>
            <div className="flex items-center gap-1.5">
              <SectionLabel>
                {tSettings("effects.cursorSpringControls", "Cursor Spring")}
              </SectionLabel>
              <InfoTooltip>
                {tSettings(
                  "effects.cursorSpringControlsHint",
                  "Tune cursor movement physics.",
                )}
              </InfoTooltip>
            </div>
            <Scrubber
              label={tSettings(
                "effects.cursorSpringStiffnessMultiplier",
                "Spring stiffness",
              )}
              value={cursorSpringStiffnessMultiplier}
              defaultValue={initialCursorSpringStiffnessMultiplier}
              min={0.25}
              max={3}
              step={0.01}
              onValueChange={(value) =>
                onCursorSpringStiffnessMultiplierChange?.(value)
              }
              suffix="×"
            />
            <Scrubber
              label={tSettings(
                "effects.cursorSpringDampingMultiplier",
                "Spring damping",
              )}
              value={cursorSpringDampingMultiplier}
              defaultValue={initialCursorSpringDampingMultiplier}
              min={0.25}
              max={3}
              step={0.01}
              onValueChange={(value) =>
                onCursorSpringDampingMultiplierChange?.(value)
              }
              suffix="×"
            />
            <Scrubber
              label={tSettings(
                "effects.cursorSpringMassMultiplier",
                "Spring mass",
              )}
              value={cursorSpringMassMultiplier}
              defaultValue={initialCursorSpringMassMultiplier}
              min={0.25}
              max={3}
              step={0.01}
              onValueChange={(value) =>
                onCursorSpringMassMultiplierChange?.(value)
              }
              suffix="×"
            />
          </ScrubberStack>
        </SettingsGroup>
      ) : null}
    </div>
  );
}
