import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";

export type UpdateToastPayload = {
  version: string;
  detail: string;
  phase: "available" | "downloading" | "ready" | "error";
  delayMs: number;
  isPreview?: boolean;
  progressPercent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  remainingBytes?: number;
  bytesPerSecond?: number;
  primaryAction?: "install-and-restart" | "retry-check";
};

export type UpdateStatusSummary = {
  status:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "ready"
    | "error";
  currentVersion: string;
  availableVersion: string | null;
  detail?: string;
};

type SendUpdateToast = (
  channel: "update-toast-state" | "update-ready-toast",
  payload: UpdateToastPayload | null,
) => boolean;

type GetDialogWindow = () => BrowserWindow | null;

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_UPDATE_CHECK_DELAY_MS = 12_000;
const DEFAULT_DEFER_DELAY_MS = 60 * 60 * 1000;
const UPDATE_PREFS_FILE = path.join(app.getPath("userData"), "updates.json");

let initialized = false;
let currentToastPayload: UpdateToastPayload | null = null;
let status: UpdateStatusSummary["status"] = "idle";
let availableVersion: string | null = null;
let latestDetail: string | undefined;
let lastUpdateInfo: UpdateInfo | null = null;
let skippedVersion: string | null = null;
let checkTimer: NodeJS.Timeout | null = null;
let reminderTimer: NodeJS.Timeout | null = null;
let installAfterDownload = false;
// Tracks whether the most recent check was triggered by the user. Background
// checks must never pop an error toast (a 404/network blip is not actionable
// and the toast would otherwise appear on every launch — see updater error
// handler below).
let lastCheckWasManual = false;

const logger = {
  info: (...args: unknown[]) => console.info("[updater]", ...args),
  warn: (...args: unknown[]) => console.warn("[updater]", ...args),
  error: (...args: unknown[]) => console.error("[updater]", ...args),
  debug: (...args: unknown[]) => console.debug("[updater]", ...args),
};

function getUpdaterEnabled() {
  return app.isPackaged || process.env.QUIRO_ENABLE_DEV_UPDATES === "1";
}

async function loadPreferences() {
  try {
    const content = await fs.readFile(UPDATE_PREFS_FILE, "utf8");
    const parsed = JSON.parse(content) as { skippedVersion?: unknown };
    skippedVersion =
      typeof parsed.skippedVersion === "string" ? parsed.skippedVersion : null;
  } catch {
    skippedVersion = null;
  }
}

async function savePreferences() {
  try {
    await fs.mkdir(path.dirname(UPDATE_PREFS_FILE), { recursive: true });
    await fs.writeFile(
      UPDATE_PREFS_FILE,
      JSON.stringify({ skippedVersion }, null, 2),
      "utf8",
    );
  } catch (error) {
    logger.warn("Failed to save update preferences:", error);
  }
}

function emitToast(
  sendUpdateToast: SendUpdateToast,
  payload: UpdateToastPayload | null,
) {
  currentToastPayload = payload;
  sendUpdateToast("update-toast-state", payload);
  if (payload?.phase === "ready") {
    sendUpdateToast("update-ready-toast", payload);
  }
}

function summarizeUpdate(info: UpdateInfo | null) {
  if (!info) {
    return "A new Quiro update is available.";
  }

  if (typeof info.releaseName === "string" && info.releaseName.trim()) {
    return info.releaseName.trim();
  }

  if (typeof info.releaseNotes === "string") {
    const firstLine = info.releaseNotes
      .replace(/<[^>]*>/g, " ")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine) {
      return firstLine;
    }
  }

  return "A new Quiro update is available.";
}

function buildPayload(
  phase: UpdateToastPayload["phase"],
  version: string,
  detail: string,
  extra: Partial<UpdateToastPayload> = {},
): UpdateToastPayload {
  return {
    version,
    detail,
    phase,
    delayMs: 0,
    ...extra,
  };
}

function getFriendlyError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Quiro could not check for updates. Please try again later.";
}

function showMessageBox(
  window: BrowserWindow | null,
  options: Electron.MessageBoxOptions,
) {
  return window
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options);
}

function setError(
  sendUpdateToast: SendUpdateToast,
  error: unknown,
  primaryAction: UpdateToastPayload["primaryAction"] = "retry-check",
) {
  const detail = getFriendlyError(error);
  status = "error";
  latestDetail = detail;
  emitToast(
    sendUpdateToast,
    buildPayload("error", availableVersion ?? app.getVersion(), detail, {
      primaryAction,
    }),
  );
}

function showNoUpdateDialog(getDialogWindow: GetDialogWindow) {
  const window = getDialogWindow();
  void showMessageBox(window, {
    type: "info",
    buttons: ["OK"],
    defaultId: 0,
    title: "Quiro is up to date",
    message: "Quiro is up to date.",
    detail: `You are running Quiro ${app.getVersion()}.`,
  });
}

function showUpdaterUnavailableDialog(getDialogWindow: GetDialogWindow) {
  const window = getDialogWindow();
  void showMessageBox(window, {
    type: "info",
    buttons: ["OK"],
    defaultId: 0,
    title: "Updates are unavailable",
    message: "Updates are available in packaged builds.",
    detail:
      "Create a signed release build to test GitHub update installation end to end.",
  });
}

function handleUpdateAvailable(
  info: UpdateInfo,
  sendUpdateToast: SendUpdateToast,
) {
  lastUpdateInfo = info;
  availableVersion = info.version;
  latestDetail = summarizeUpdate(info);

  if (skippedVersion === info.version) {
    status = "idle";
    logger.info(`Skipping ignored update ${info.version}.`);
    return;
  }

  status = "available";
  emitToast(
    sendUpdateToast,
    buildPayload("available", info.version, latestDetail),
  );
}

function handleDownloadProgress(
  progress: ProgressInfo,
  sendUpdateToast: SendUpdateToast,
) {
  const total = Number.isFinite(progress.total) ? progress.total : undefined;
  const transferred = Number.isFinite(progress.transferred)
    ? progress.transferred
    : undefined;
  const remaining =
    typeof total === "number" && typeof transferred === "number"
      ? Math.max(0, total - transferred)
      : undefined;

  status = "downloading";
  emitToast(
    sendUpdateToast,
    buildPayload(
      "downloading",
      availableVersion ?? lastUpdateInfo?.version ?? app.getVersion(),
      "Downloading the update.",
      {
        progressPercent: Math.max(0, Math.min(100, progress.percent || 0)),
        transferredBytes: transferred,
        totalBytes: total,
        remainingBytes: remaining,
        bytesPerSecond: Number.isFinite(progress.bytesPerSecond)
          ? progress.bytesPerSecond
          : undefined,
      },
    ),
  );
}

function handleUpdateDownloaded(sendUpdateToast: SendUpdateToast) {
  const version = availableVersion ?? lastUpdateInfo?.version ?? app.getVersion();
  status = "ready";
  emitToast(
    sendUpdateToast,
    buildPayload("ready", version, "Restart Quiro to finish installing.", {
      primaryAction: "install-and-restart",
    }),
  );

  if (installAfterDownload) {
    installAfterDownload = false;
    installDownloadedUpdateNow(sendUpdateToast);
  }
}

export async function setupAutoUpdates(
  getDialogWindow: GetDialogWindow,
  sendUpdateToast: SendUpdateToast,
) {
  if (initialized) {
    return;
  }

  initialized = true;
  await loadPreferences();

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = app.getVersion().includes("-");
  autoUpdater.logger = logger;

  autoUpdater.on("checking-for-update", () => {
    status = "checking";
    latestDetail = "Checking for updates.";
  });
  autoUpdater.on("update-not-available", () => {
    status = "up-to-date";
    availableVersion = null;
    lastUpdateInfo = null;
    latestDetail = "Quiro is up to date.";
  });
  autoUpdater.on("update-available", (info) => {
    handleUpdateAvailable(info, sendUpdateToast);
  });
  autoUpdater.on("download-progress", (progress) => {
    handleDownloadProgress(progress, sendUpdateToast);
  });
  autoUpdater.on("update-downloaded", () => {
    handleUpdateDownloaded(sendUpdateToast);
  });
  autoUpdater.on("error", (error) => {
    // Only surface an error toast when the user is actively engaged with the
    // updater: a manual check, an in-progress download, or an update already
    // being advertised. A failed *background* check (e.g. the release feed has
    // no latest.yml yet, or the network is down) must stay silent — otherwise
    // it pops a window on every launch and, before this guard, leaked an
    // unhandled rejection that took the whole app down.
    const shouldSurface =
      lastCheckWasManual ||
      status === "downloading" ||
      currentToastPayload !== null;

    if (shouldSurface) {
      setError(sendUpdateToast, error);
      return;
    }

    status = "error";
    latestDetail = getFriendlyError(error);
    logger.warn("Background update check failed:", latestDetail);
  });

  if (!getUpdaterEnabled()) {
    logger.info("Automatic updates disabled in development.");
    return;
  }

  const runBackgroundCheck = () => {
    checkForAppUpdates(getDialogWindow, { manual: false }).catch((error) => {
      logger.warn("Background update check rejected:", getFriendlyError(error));
    });
  };

  checkTimer = setTimeout(() => {
    runBackgroundCheck();
    checkTimer = setInterval(runBackgroundCheck, UPDATE_CHECK_INTERVAL_MS);
  }, INITIAL_UPDATE_CHECK_DELAY_MS);
}

export async function checkForAppUpdates(
  getDialogWindow: GetDialogWindow,
  options: { manual?: boolean } = {},
) {
  lastCheckWasManual = Boolean(options.manual);

  if (!getUpdaterEnabled()) {
    status = "idle";
    latestDetail = "Updates are only available in packaged builds.";
    if (options.manual) {
      showUpdaterUnavailableDialog(getDialogWindow);
    }
    return;
  }

  try {
    await autoUpdater.checkForUpdates();
    if (options.manual && status === "up-to-date") {
      showNoUpdateDialog(getDialogWindow);
    }
  } catch (error) {
    // The "error" event handler above already records status/detail and (for
    // manual checks) surfaces a toast. Manual checks additionally get a modal
    // here. We intentionally do NOT re-throw: callers fire this as a detached
    // promise, so a throw would become an unhandled rejection and crash main.
    status = "error";
    latestDetail = getFriendlyError(error);
    if (options.manual) {
      const window = getDialogWindow();
      void showMessageBox(window, {
        type: "error",
        buttons: ["OK"],
        defaultId: 0,
        title: "Update check failed",
        message: "Quiro could not check for updates.",
        detail: latestDetail,
      });
    }
  }
}

export async function downloadAvailableUpdate(
  sendUpdateToast: SendUpdateToast,
  options: { installAfterDownload?: boolean } = {},
) {
  if (status === "ready") {
    if (options.installAfterDownload) {
      installDownloadedUpdateNow(sendUpdateToast);
    }
    return { success: true, message: "Update is already downloaded." };
  }

  if (!lastUpdateInfo || !availableVersion) {
    return { success: false, message: "No update is available to download." };
  }

  installAfterDownload = Boolean(options.installAfterDownload);
  try {
    status = "downloading";
    emitToast(
      sendUpdateToast,
      buildPayload(
        "downloading",
        availableVersion,
        "Starting update download.",
        {
          progressPercent: 0,
        },
      ),
    );
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    installAfterDownload = false;
    setError(sendUpdateToast, error);
    return { success: false, message: getFriendlyError(error) };
  }
}

export function installDownloadedUpdateNow(sendUpdateToast: SendUpdateToast) {
  if (status !== "ready") {
    setError(
      sendUpdateToast,
      new Error("The update has not finished downloading yet."),
      "install-and-restart",
    );
    return;
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });
}

export function deferUpdateReminder(
  _getDialogWindow: GetDialogWindow,
  sendUpdateToast: SendUpdateToast,
  delayMs = DEFAULT_DEFER_DELAY_MS,
) {
  const deferredPayload = currentToastPayload
    ? { ...currentToastPayload, delayMs }
    : null;

  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimer = null;
  }

  emitToast(sendUpdateToast, null);

  reminderTimer = setTimeout(() => {
    if (deferredPayload && (status === "available" || status === "ready")) {
      emitToast(sendUpdateToast, deferredPayload);
    }
  }, delayMs);

  return { success: true };
}

export function dismissUpdateToast(
  _getDialogWindow: GetDialogWindow,
  sendUpdateToast: SendUpdateToast,
) {
  emitToast(sendUpdateToast, null);
  return { success: true };
}

export function skipAvailableUpdateVersion(sendUpdateToast: SendUpdateToast) {
  if (!availableVersion) {
    return { success: false, message: "No update is available to skip." };
  }

  skippedVersion = availableVersion;
  void savePreferences();
  emitToast(sendUpdateToast, null);
  return { success: true };
}

export function getCurrentUpdateToastPayload() {
  return currentToastPayload;
}

export function getUpdateStatusSummary(): UpdateStatusSummary {
  return {
    status,
    currentVersion: app.getVersion(),
    availableVersion,
    detail: latestDetail,
  };
}

export function previewUpdateToast(sendUpdateToast: SendUpdateToast) {
  emitToast(
    sendUpdateToast,
    buildPayload("available", "9.9.9", "Previewing the update prompt.", {
      isPreview: true,
    }),
  );
  return true;
}

export function getUpdaterLogPath() {
  return path.join(app.getPath("userData"), "logs", "updater.log");
}

export function disposeAutoUpdates() {
  if (checkTimer) {
    clearTimeout(checkTimer);
    clearInterval(checkTimer);
    checkTimer = null;
  }
  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimer = null;
  }
}
