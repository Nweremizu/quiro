import { useEffect, useMemo, useState } from "react";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  Refresh01Icon,
} from "@/components/icons/generated";

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getTitle(payload: UpdateToastState) {
  switch (payload.phase) {
    case "available":
      return `Quiro ${payload.version} is available`;
    case "downloading":
      return `Downloading Quiro ${payload.version}`;
    case "ready":
      return `Quiro ${payload.version} is ready`;
    case "error":
      return "Update needs attention";
  }
}

function getPrimaryLabel(payload: UpdateToastState) {
  switch (payload.phase) {
    case "available":
      return "Download update";
    case "downloading":
      return "Downloading";
    case "ready":
      return "Restart and install";
    case "error":
      return payload.primaryAction === "install-and-restart"
        ? "Try install again"
        : "Retry";
  }
}

function getProgressDetail(payload: UpdateToastState) {
  if (payload.phase !== "downloading") {
    return payload.detail;
  }

  const transferred = formatBytes(payload.transferredBytes);
  const total = formatBytes(payload.totalBytes);
  const speed = formatBytes(payload.bytesPerSecond);

  if (transferred && total && speed) {
    return `${transferred} of ${total} at ${speed}/s`;
  }

  if (transferred && total) {
    return `${transferred} of ${total}`;
  }

  return payload.detail;
}

export function UpdateToastWindow() {
  const [payload, setPayload] = useState<UpdateToastState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    window.electronAPI
      .getCurrentUpdateToastPayload()
      .then((currentPayload) => {
        if (mounted) {
          setPayload(currentPayload);
        }
      })
      .catch((error) => {
        console.warn("Failed to load current update state:", error);
      });

    const unsubscribe =
      window.electronAPI.onUpdateToastStateChanged(setPayload);

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const progressPercent = useMemo(() => {
    if (payload?.phase !== "downloading") {
      return 0;
    }
    return Math.max(0, Math.min(100, payload.progressPercent ?? 0));
  }, [payload]);

  async function handlePrimaryAction() {
    if (!payload || payload.phase === "downloading") {
      return;
    }

    setBusy(true);
    try {
      if (payload.phase === "available") {
        await window.electronAPI.downloadAvailableUpdate(false);
      } else if (payload.phase === "ready") {
        await window.electronAPI.installDownloadedUpdate();
      } else if (payload.primaryAction === "install-and-restart") {
        await window.electronAPI.downloadAvailableUpdate(true);
      } else {
        await window.electronAPI.checkForAppUpdates();
      }
    } catch (error) {
      console.warn("Update action failed:", error);
    } finally {
      setBusy(false);
    }
  }

  async function handleLater() {
    await window.electronAPI.deferDownloadedUpdate();
  }

  async function handleSkip() {
    await window.electronAPI.skipUpdateVersion();
  }

  async function handleDismiss() {
    await window.electronAPI.dismissUpdateToast();
  }

  if (!payload) {
    return null;
  }

  const primaryDisabled = busy || payload.phase === "downloading";

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent p-3 font-sans! text-white">
      <div className="w-full rounded-lg border border-white/10 bg-[#11161d] p-4 shadow-2xl shadow-black/35">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-white/10 text-white">
            {payload.phase === "ready" ? (
              <CheckmarkCircle02Icon size={20} />
            ) : payload.phase === "downloading" ? (
              <Download04Icon size={20} />
            ) : (
              <Refresh01Icon size={20} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-sm font-semibold leading-5">
                  {getTitle(payload)}
                </h1>
                <p className="mt-1 text-xs leading-5 text-white/68">
                  {getProgressDetail(payload)}
                </p>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
                onClick={() => void handleDismiss()}
                aria-label="Dismiss update prompt"
              >
                <Cancel01Icon size={16} />
              </button>
            </div>

            {payload.phase === "downloading" ? (
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={() => void handleLater()}
              >
                Later
              </button>
              <div className="flex items-center gap-2">
                {payload.phase === "available" ? (
                  <button
                    type="button"
                    className="rounded-md px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
                    onClick={() => void handleSkip()}
                  >
                    Skip
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={primaryDisabled}
                  className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-[#11161d] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void handlePrimaryAction()}
                >
                  {busy ? "Working..." : getPrimaryLabel(payload)}
                </button>
              </div>
            </div>
          </div>
        </div>
        {payload.isPreview ? (
          <div className="mt-3 rounded-md bg-white/8 px-3 py-2 text-[11px] text-white/60">
            Preview mode. No update will be installed.
          </div>
        ) : null}
      </div>
    </div>
  );
}
