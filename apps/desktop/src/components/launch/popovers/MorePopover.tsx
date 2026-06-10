import {
  ViewIcon,
  ViewOffIcon,
  FolderOpenIcon,
  TranslateIcon,
  VideoReplayIcon,
  Refresh01Icon as RefreshCcw01Icon,
  Sun03Icon,
  Moon02Icon,
  ComputerIcon,
} from "@/components/icons/generated";
import type { ReactElement } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useScopedT } from "@/contexts/I18nContext";
import { useTheme } from "@/contexts/theme-provider";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "more";

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  nl: "Nederlands",
  ko: "한국어",
  "pt-BR": "Português",
  "zh-CN": "簡體中文",
  "zh-TW": "繁體中文",
};

export function MorePopover({
  trigger,
  supportsHudCaptureProtection,
  hideHudFromCapture,
  onToggleHudCaptureProtection,
  onChooseRecordingsDirectory,
  onOpenVideoFile,
  onOpenProjectBrowser,
  showDevUpdatePreview,
  onCheckForUpdates,
  onPreviewUpdateUi,
  appVersion,
}: {
  trigger: ReactElement;
  supportsHudCaptureProtection: boolean;
  hideHudFromCapture: boolean;
  onToggleHudCaptureProtection: () => void;
  onChooseRecordingsDirectory: () => void;
  onOpenVideoFile: () => void;
  onOpenProjectBrowser: () => void;
  showDevUpdatePreview: boolean;
  onCheckForUpdates: () => void;
  onPreviewUpdateUi: () => void;
  appVersion: string | null;
}) {
  const t = useScopedT("launch");
  const { locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();
  const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
  const open = isOpen(POPOVER_ID);

  return (
    <HudPopover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose(POPOVER_ID);
          return;
        }
        requestOpen(POPOVER_ID);
      }}
      trigger={trigger}
      align="end"
    >
      {supportsHudCaptureProtection && (
        <DropdownItem
          icon={
            hideHudFromCapture ? (
              <ViewOffIcon size={16} />
            ) : (
              <ViewIcon size={16} />
            )
          }
          selected={hideHudFromCapture}
          onClick={onToggleHudCaptureProtection}
        >
          {hideHudFromCapture
            ? t("recording.hideHudFromVideo")
            : t("recording.showHudInVideo")}
        </DropdownItem>
      )}
      <DropdownItem
        icon={<FolderOpenIcon size={16} />}
        onClick={() => {
          requestClose(POPOVER_ID);
          onChooseRecordingsDirectory();
        }}
      >
        {t("recording.recordingsFolder")}
      </DropdownItem>
      <DropdownItem
        icon={<VideoReplayIcon size={16} />}
        onClick={() => {
          requestClose(POPOVER_ID);
          onOpenVideoFile();
        }}
      >
        {t("recording.openVideoFile")}
      </DropdownItem>
      <DropdownItem
        icon={<FolderOpenIcon size={16} />}
        onClick={() => {
          requestClose(POPOVER_ID);
          onOpenProjectBrowser();
        }}
      >
        {t("recording.openProject")}
      </DropdownItem>
      <DropdownItem
        icon={<RefreshCcw01Icon size={16} />}
        onClick={() => {
          requestClose(POPOVER_ID);
          onCheckForUpdates();
        }}
      >
        {t("recording.checkForUpdates", "Check for updates")}
      </DropdownItem>
      {showDevUpdatePreview ? (
        <DropdownItem
          icon={<RefreshCcw01Icon size={16} />}
          onClick={() => {
            requestClose(POPOVER_ID);
            onPreviewUpdateUi();
          }}
        >
          {t("recording.previewUpdateUi", "Preview Update UI")}
        </DropdownItem>
      ) : null}
      <div
        className="px-2.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400"
        style={{ marginTop: 4 }}
      >
        {t("recording.appearance", "Appearance")}
      </div>
      <DropdownItem
        icon={<Sun03Icon size={16} />}
        selected={preference === "light"}
        onClick={() => {
          setPreference("light");
          requestClose(POPOVER_ID);
        }}
      >
        {t("common.light", "Light")}
      </DropdownItem>
      <DropdownItem
        icon={<Moon02Icon size={16} />}
        selected={preference === "dark"}
        onClick={() => {
          setPreference("dark");
          requestClose(POPOVER_ID);
        }}
      >
        {t("common.dark", "Dark")}
      </DropdownItem>
      <DropdownItem
        icon={<ComputerIcon size={16} />}
        selected={preference === "system"}
        onClick={() => {
          setPreference("system");
          requestClose(POPOVER_ID);
        }}
      >
        {t("common.system", "System")}
      </DropdownItem>
      <div
        className="px-2.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400"
        style={{ marginTop: 4 }}
      >
        {t("recording.language")}
      </div>
      {SUPPORTED_LOCALES.map((code) => (
        <DropdownItem
          key={code}
          icon={<TranslateIcon size={16} />}
          selected={locale === code}
          onClick={() => {
            setLocale(code as AppLocale);
            requestClose(POPOVER_ID);
          }}
        >
          {LOCALE_LABELS[code] ?? code}
        </DropdownItem>
      ))}
      {appVersion && (
        <div
          style={{
            marginTop: 8,
            padding: "4px 12px",
            fontSize: 11,
            color: "var(--text-tertiary)",
            textAlign: "center",
            userSelect: "text",
          }}
        >
          v{appVersion}
        </div>
      )}
    </HudPopover>
  );
}
