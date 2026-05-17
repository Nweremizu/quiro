import { Download01Icon } from "@/components/icons";
import { ExportSettingsMenu } from "@/components/editor/ExportSettingsMenu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/contexts/I18nContext";
import type {
  ExportEncodingMode,
  ExportFormat,
  ExportMp4FrameRate,
  ExportPipelineModel,
  ExportProgress,
  ExportQuality,
  GifFrameRate,
  GifSizePreset,
} from "@/lib/exporter";

interface EditorExportDropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isExporting: boolean;
  isLightningExportInProgress: boolean;
  isLegacyExportInProgress: boolean;
  isExportPreparing: boolean;
  isExportSaving: boolean;
  isExportFinalSaveIndeterminate: boolean;
  isRenderingAudio: boolean;
  exportProgress: ExportProgress | null;
  exportFinalizingProgress: number | null;
  exportPercentLabel: string;
  exportRenderSpeedLabel: string | null;
  exportRuntimeLabel: string | null;
  exportNativeSkipLabel: string | null;
  exportError: string | null;
  exportedFilePath: string | null | undefined;
  hasPendingExportSave: boolean;
  onOpenLightningIssues: () => void | Promise<void>;
  onCancelExport: () => void;
  onRetrySaveExport: () => void;
  onCloseExportDropdown: () => void;
  onRevealExportedFile: () => void | Promise<void>;
  exportFormat: ExportFormat;
  onExportFormatChange: (format: ExportFormat) => void;
  exportEncodingMode: ExportEncodingMode;
  onExportEncodingModeChange: (encodingMode: ExportEncodingMode) => void;
  mp4FrameRate: ExportMp4FrameRate;
  onMp4FrameRateChange: (frameRate: ExportMp4FrameRate) => void;
  exportPipelineModel: ExportPipelineModel;
  onExportPipelineModelChange: (pipelineModel: ExportPipelineModel) => void;
  exportQuality: ExportQuality;
  onExportQualityChange: (quality: ExportQuality) => void;
  gifFrameRate: GifFrameRate;
  onGifFrameRateChange: (rate: GifFrameRate) => void;
  gifLoop: boolean;
  onGifLoopChange: (loop: boolean) => void;
  gifSizePreset: GifSizePreset;
  onGifSizePresetChange: (preset: GifSizePreset) => void;
  mp4OutputDimensions?: Record<
    ExportQuality,
    { width: number; height: number }
  >;
  gifOutputDimensions: { width: number; height: number };
  onStartExport: () => void;
}

export function EditorExportDropdown({
  open,
  onOpenChange,
  isExporting,
  isLightningExportInProgress,
  isLegacyExportInProgress,
  isExportPreparing,
  isExportSaving,
  isExportFinalSaveIndeterminate,
  isRenderingAudio,
  exportProgress,
  exportFinalizingProgress,
  exportPercentLabel,
  exportRenderSpeedLabel,
  exportRuntimeLabel,
  exportNativeSkipLabel,
  exportError,
  exportedFilePath,
  hasPendingExportSave,
  onOpenLightningIssues,
  onCancelExport,
  onRetrySaveExport,
  onCloseExportDropdown,
  onRevealExportedFile,
  exportFormat,
  onExportFormatChange,
  exportEncodingMode,
  onExportEncodingModeChange,
  mp4FrameRate,
  onMp4FrameRateChange,
  exportPipelineModel,
  onExportPipelineModelChange,
  exportQuality,
  onExportQualityChange,
  gifFrameRate,
  onGifFrameRateChange,
  gifLoop,
  onGifLoopChange,
  gifSizePreset,
  onGifSizePresetChange,
  mp4OutputDimensions,
  gifOutputDimensions,
  onStartExport,
}: EditorExportDropdownProps) {
  const { t } = useI18n();

  const progressWidth = Math.min(
    isRenderingAudio
      ? (exportProgress?.audioProgress ?? 0) * 100
      : (exportFinalizingProgress ?? exportProgress?.percentage ?? 8),
    100,
  );

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger className="inline-flex h-8 min-w-28 items-center justify-center gap-2 rounded-[5px] bg-primary px-4.5 text-white transition-colors hover:bg-primary/92">
        <Download01Icon className="h-4 w-4" />
        <span className="text-sm font-semibold tracking-tight">
          {t("common.actions.export", "Export")}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="w-80">
        {isExporting ? (
          <div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-glow-brand">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("editor.exportStatus.exporting", "Exporting")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "editor.exportStatus.renderingFile",
                    "Rendering your file.",
                  )}
                </p>
                {isLightningExportInProgress ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/70">
                    PLEASE
                    <button
                      type="button"
                      onClick={() => void onOpenLightningIssues()}
                      className="underline decoration-slate-500/70 underline-offset-2 transition-colors hover:text-foreground"
                    >
                      report bugs
                    </button>
                    with Lightning export
                    <span aria-hidden="true">{"\u{1F64F}"}</span>
                  </p>
                ) : null}
                {isLegacyExportInProgress ? (
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    Export too slow? Cancel and try Lightning export!
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={onCancelExport}
                className="h-8 border-red-500/20 bg-red-500/10 px-3 text-xs text-red-400 hover:bg-red-500/20"
              >
                {t("common.actions.cancel")}
              </Button>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-foreground/5 bg-foreground/5">
              {isExportPreparing ||
              isExportSaving ||
              isExportFinalSaveIndeterminate ? (
                <div className="indeterminate-progress h-full rounded-full bg-transparent" />
              ) : (
                <div
                  className="h-full bg-[linear-gradient(90deg,var(--bg-brand),#FFB460)] rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progressWidth}%` }}
                />
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {exportPercentLabel}
            </p>
            {isRenderingAudio ? (
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                {t(
                  "editor.export.processingAudioEdits",
                  "Processing audio with speed/overlay edits",
                )}
              </p>
            ) : exportRenderSpeedLabel ? (
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                {exportRenderSpeedLabel}
              </p>
            ) : null}
            {exportRuntimeLabel ? (
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                Path: {exportRuntimeLabel}
              </p>
            ) : null}
            {exportNativeSkipLabel ? (
              <p className="mt-1 text-[11px] text-amber-500/80">
                {exportNativeSkipLabel}
              </p>
            ) : null}
          </div>
        ) : exportError ? (
          <div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
            <p className="text-sm font-semibold text-foreground">
              {t("editor.exportStatus.issue", "Export issue")}
            </p>
            {exportRuntimeLabel ? (
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                Path: {exportRuntimeLabel}
              </p>
            ) : null}
            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {exportError}
            </p>
            <div className="mt-4 flex gap-2">
              {hasPendingExportSave ? (
                <Button
                  type="button"
                  onClick={onRetrySaveExport}
                  className="h-8 flex-1 rounded-[5px] bg-primary text-xs font-semibold text-white hover:bg-primary/92"
                >
                  {t("editor.actions.saveAgain", "Save Again")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={onCloseExportDropdown}
                className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
              >
                {t("common.actions.close", "Close")}
              </Button>
            </div>
          </div>
        ) : exportedFilePath ? (
          <div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
            <p className="text-sm font-semibold text-foreground">
              {t("editor.exportStatus.complete", "Export complete")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "editor.exportStatus.savedSuccessfully",
                "Your file was saved successfully.",
              )}
            </p>
            {exportRuntimeLabel ? (
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                Path: {exportRuntimeLabel}
              </p>
            ) : null}
            <p className="mt-3 truncate text-xs text-muted-foreground/70">
              <p className="mt-3 truncate text-xs text-muted-foreground/70">
                {exportedFilePath.split(/[\\/]/).pop()}
              </p>
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                onClick={() => void onRevealExportedFile()}
                className="h-8 flex-1 rounded-[5px] bg-primary text-xs font-semibold text-white hover:bg-primary/92"
              >
                {t("editor.actions.showInFolder", "Show In Folder")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onCloseExportDropdown}
                className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <ExportSettingsMenu
            exportFormat={exportFormat}
            onExportFormatChange={onExportFormatChange}
            exportEncodingMode={exportEncodingMode}
            onExportEncodingModeChange={onExportEncodingModeChange}
            mp4FrameRate={mp4FrameRate}
            onMp4FrameRateChange={onMp4FrameRateChange}
            exportPipelineModel={exportPipelineModel}
            onExportPipelineModelChange={onExportPipelineModelChange}
            exportQuality={exportQuality}
            onExportQualityChange={onExportQualityChange}
            gifFrameRate={gifFrameRate}
            onGifFrameRateChange={onGifFrameRateChange}
            gifLoop={gifLoop}
            onGifLoopChange={onGifLoopChange}
            gifSizePreset={gifSizePreset}
            onGifSizePresetChange={onGifSizePresetChange}
            mp4OutputDimensions={mp4OutputDimensions}
            gifOutputDimensions={gifOutputDimensions}
            onExport={onStartExport}
            className="shadow-2xl"
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
