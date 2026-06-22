import type { BrowserWindow } from "electron";
import { registerAssetHandlers } from "./register/assets";
import { registerCaptionHandlers } from "./register/captions";
import { registerExportHandlers } from "./register/export";
import { registerPermissionHandlers } from "./register/permission";
import { registerProjectHandlers } from "./register/project";
import { registerRecordingHandlers } from "./register/recording";
import { registerRecordingStreamHandlers } from "./register/recording-stream";
import { registerSettingsHandlers } from "./register/settings";
import { registerSourceHandlers } from "./register/sources";
import { registerAiHandlers } from "./register/ai";
import { loadAiPreferences } from "../ai/aiSettings";
import { registerPerfHandlers } from "../ipc/perf";
import {
  selectedSource,
  setNativeScreenRecordingActive,
  setWindowsCapturePaused,
  setWindowsCaptureProcess,
  setWindowsCaptureStopRequested,
  setWindowsCaptureTargetPath,
  setWindowsMicAudioPath,
  setWindowsNativeCaptureActive,
  setWindowsOrphanedMicAudioPath,
  setWindowsPendingVideoPath,
  setWindowsSystemAudioPath,
  windowsCaptureProcess,
} from "./state";

export { cleanupAllExportStreamSessions } from "@electron/ipc/export/export-stream";
export { cleanupNativeVideoExportSessions } from "@electron/ipc/export/native";
export { cleanupRecordingStreamSessions } from "./register/recording-stream";

/** Returns the currently selected source ID for setDisplayMediaRequestHandler */
export function getSelectedSourceId(): string | null {
  return (selectedSource?.id as string | null) ?? null;
}

export function killWindowsCaptureProcess() {
  if (windowsCaptureProcess) {
    try {
      windowsCaptureProcess.kill();
    } catch {
      /* ignore */
    }
    setWindowsCaptureProcess(null);
    setWindowsCaptureTargetPath(null);
    setWindowsNativeCaptureActive(false);
    setNativeScreenRecordingActive(false);
    setWindowsCaptureStopRequested(false);
    setWindowsCapturePaused(false);
    setWindowsSystemAudioPath(null);
    setWindowsMicAudioPath(null);
    setWindowsOrphanedMicAudioPath(null);
    setWindowsPendingVideoPath(null);
  }
}

export function registerIpcHandlers(
  createEditorWindow: () => void,
  createSourceSelectorWindow: () => BrowserWindow,
  _getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
  registerSourceHandlers({
    createEditorWindow,
    createSourceSelectorWindow,
    getSourceSelectorWindow,
  });
  registerRecordingHandlers(onRecordingStateChange);
  registerRecordingStreamHandlers();
  registerPermissionHandlers();
  registerAssetHandlers();
  registerExportHandlers();
  registerCaptionHandlers();
  registerProjectHandlers();
  registerSettingsHandlers();
  registerPerfHandlers();
  registerAiHandlers();
  // Warm the AI preferences cache so providers can read stored keys synchronously.
  loadAiPreferences().catch(() => {});
}
