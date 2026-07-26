import {
  ExportBackendPreference,
  ExportEncodingMode,
  ExportMp4FrameRate,
  ExportPipelineModel,
  ExportQuality,
  ExportRenderBackend,
  isValidMp4FrameRate,
} from "@/lib/exporter";
import {
  getAspectRatioValue,
  type AspectRatio,
} from "@electron/utils/aspectRatioUtils";
import { toast } from "sonner";

export type SmokeExportConfig = {
  enabled: boolean;
  inputPath: string | null;
  outputPath: string | null;
  useNativeExport: boolean;
  encodingMode?: ExportEncodingMode;
  shadowIntensity?: number;
  webcamInputPath?: string | null;
  webcamShadow?: number;
  webcamSize?: number;
  pipelineModel?: ExportPipelineModel;
  backendPreference?: ExportBackendPreference;
  renderBackend?: ExportRenderBackend;
  maxEncodeQueue?: number;
  maxDecodeQueue?: number;
  maxPendingFrames?: number;
  projectPath?: string | null;
  quality?: ExportQuality;
  fps?: ExportMp4FrameRate;
  format?: "mp4" | "gif";
};

export const EXPORT_BLOB_STREAM_CHUNK_BYTES = 16 * 1024 * 1024;
export const SMOKE_EXPORT_READY_TIMEOUT_MS = 30_000;
export const DEFAULT_MP4_EXPORT_FRAME_RATE: ExportMp4FrameRate = 30;
export const SOURCE_AUDIO_FALLBACK_TOAST_ID = "source-audio-fallback-error";
export const PROJECT_AUTOSAVE_DELAY_MS = 1000;
export const EXPORT_ERROR_TOAST_DURATION_MS = 20000;

export async function streamExportBlobToTempFile(
  blob: Blob,
  extension: string,
): Promise<string | null> {
  if (
    typeof window === "undefined" ||
    !window.electronAPI?.openExportStream ||
    !window.electronAPI?.writeExportStreamChunk ||
    !window.electronAPI?.closeExportStream
  ) {
    return null;
  }

  const openResult = await window.electronAPI.openExportStream({ extension });
  if (!openResult.success || !openResult.streamId || !openResult.tempPath) {
    throw new Error(openResult.error || "Failed to open export stream");
  }

  const { streamId } = openResult;
  let position = 0;

  try {
    while (position < blob.size) {
      const chunk = blob.slice(
        position,
        position + EXPORT_BLOB_STREAM_CHUNK_BYTES,
      );
      const chunkBuffer = await chunk.arrayBuffer();
      const writeResult = await window.electronAPI.writeExportStreamChunk(
        streamId,
        position,
        new Uint8Array(chunkBuffer),
      );
      if (!writeResult.success) {
        throw new Error(
          writeResult.error || "Failed to write export stream chunk",
        );
      }
      position += chunkBuffer.byteLength;
    }

    const closeResult = await window.electronAPI.closeExportStream(streamId);
    if (!closeResult.success || !closeResult.tempPath) {
      throw new Error(closeResult.error || "Failed to close export stream");
    }

    return closeResult.tempPath;
  } catch (error) {
    try {
      await window.electronAPI.closeExportStream(streamId, { abort: true });
    } catch {
      // Best-effort cleanup; preserve the original error below.
    }
    throw error;
  }
}

export type SaveProjectOptions = {
  silent?: boolean;
  remountPreviewAfterSave?: boolean;
  refreshLibraryAfterSave?: boolean;
  captureThumbnail?: boolean;
};

export type DevOpenRecordingConfig = {
  inputPath: string | null;
  webcamInputPath: string | null;
};

export async function writeSmokeExportReport(
  outputPath: string | null,
  report: Record<string, unknown>,
): Promise<void> {
  if (!outputPath || typeof window === "undefined") {
    return;
  }

  try {
    const reportBytes = new TextEncoder().encode(
      JSON.stringify(report, null, 2),
    );
    const reportBuffer = reportBytes.buffer.slice(
      reportBytes.byteOffset,
      reportBytes.byteOffset + reportBytes.byteLength,
    ) as ArrayBuffer;
    await window.electronAPI.writeExportedVideoToPath(
      reportBuffer,
      `${outputPath}.report.json`,
    );
  } catch (error) {
    console.error("[smoke-export] Failed to write report", error);
  }
}

export function summarizeErrorMessage(message: string): string {
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ?? message;
}

export function showExportErrorToast(message: string) {
  const summary = summarizeErrorMessage(message);
  toast.error(summary, {
    description: summary === message ? undefined : message,
    duration: EXPORT_ERROR_TOAST_DURATION_MS,
  });
}

export function cloneStructured<T>(value: T): T {
  return globalThis.structuredClone(value);
}

export function parseSmokeExportNumber(
  value: string | null,
): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseSmokeExportNonNegativeNumber(
  value: string | null,
): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseSmokeExportQuality(
  value: string | null,
): ExportQuality | undefined {
  if (
    value === "medium" ||
    value === "good" ||
    value === "high" ||
    value === "source"
  ) {
    return value;
  }
  return undefined;
}

export function parseSmokeExportFps(
  value: string | null,
): ExportMp4FrameRate | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return isValidMp4FrameRate(parsed) ? parsed : undefined;
}

export function parseSmokeRenderBackend(
  value: string | null,
): ExportRenderBackend | undefined {
  return value === "webgl" || value === "webgpu" ? value : undefined;
}

export function getSmokeExportConfig(search: string): SmokeExportConfig {
  const params = new URLSearchParams(search);
  const enabled = params.get("smokeExport") === "1";

  return {
    enabled,
    inputPath: enabled ? params.get("smokeInput") : null,
    outputPath: enabled ? params.get("smokeOutput") : null,
    useNativeExport: enabled
      ? params.get("smokeUseNativeExport") === "1"
      : false,
    encodingMode:
      enabled && params.get("smokeEncodingMode") === "fast"
        ? "fast"
        : enabled && params.get("smokeEncodingMode") === "balanced"
          ? "balanced"
          : enabled && params.get("smokeEncodingMode") === "quality"
            ? "quality"
            : undefined,
    shadowIntensity: enabled
      ? parseSmokeExportNonNegativeNumber(params.get("smokeShadowIntensity"))
      : undefined,
    webcamInputPath: enabled ? params.get("smokeWebcamInput") : null,
    webcamShadow: enabled
      ? parseSmokeExportNonNegativeNumber(params.get("smokeWebcamShadow"))
      : undefined,
    webcamSize: enabled
      ? parseSmokeExportNonNegativeNumber(params.get("smokeWebcamSize"))
      : undefined,
    pipelineModel:
      enabled && params.get("smokePipelineModel") === "modern"
        ? "modern"
        : enabled && params.get("smokePipelineModel") === "legacy"
          ? "legacy"
          : undefined,
    backendPreference:
      enabled && params.get("smokeBackendPreference") === "auto"
        ? "auto"
        : enabled && params.get("smokeBackendPreference") === "webcodecs"
          ? "webcodecs"
          : enabled && params.get("smokeBackendPreference") === "breeze"
            ? "breeze"
            : undefined,
    renderBackend: enabled
      ? parseSmokeRenderBackend(params.get("smokeRenderBackend"))
      : undefined,
    maxEncodeQueue: enabled
      ? parseSmokeExportNumber(params.get("smokeMaxEncodeQueue"))
      : undefined,
    maxDecodeQueue: enabled
      ? parseSmokeExportNumber(params.get("smokeMaxDecodeQueue"))
      : undefined,
    maxPendingFrames: enabled
      ? parseSmokeExportNumber(params.get("smokeMaxPendingFrames"))
      : undefined,
    projectPath: enabled ? params.get("smokeProject") : null,
    quality: enabled
      ? parseSmokeExportQuality(params.get("smokeQuality"))
      : undefined,
    fps: enabled ? parseSmokeExportFps(params.get("smokeFps")) : undefined,
    format: enabled && params.get("smokeFormat") === "gif" ? "gif" : "mp4",
  };
}

export function getDevOpenRecordingConfig(
  search: string,
): DevOpenRecordingConfig {
  const params = new URLSearchParams(search);
  return {
    inputPath: params.get("devOpenInput"),
    webcamInputPath: params.get("devOpenWebcam"),
  };
}

export function isComparableObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function areDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!areDeepEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (!isComparableObject(left) || !isComparableObject(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!(key in right) || !areDeepEqual(left[key], right[key])) {
      return false;
    }
  }

  return true;
}

export function calculateMp4SourceDimensions(
  sourceWidth: number,
  sourceHeight: number,
  aspectRatio: AspectRatio,
): { width: number; height: number } {
  const safeSourceWidth = Math.max(2, Math.floor(sourceWidth / 2) * 2);
  const safeSourceHeight = Math.max(2, Math.floor(sourceHeight / 2) * 2);
  const sourceAspectRatio =
    safeSourceHeight > 0 ? safeSourceWidth / safeSourceHeight : 16 / 9;
  const aspectRatioValue = getAspectRatioValue(aspectRatio, sourceAspectRatio);

  if (aspectRatio === "native") {
    return { width: safeSourceWidth, height: safeSourceHeight };
  }

  if (aspectRatioValue === 1) {
    const baseDimension = Math.max(
      2,
      Math.floor(Math.min(safeSourceWidth, safeSourceHeight) / 2) * 2,
    );
    return { width: baseDimension, height: baseDimension };
  }

  if (aspectRatioValue > 1) {
    const baseWidth = safeSourceWidth;
    for (let width = baseWidth; width >= 100; width -= 2) {
      const height = Math.round(width / aspectRatioValue);
      if (
        height % 2 === 0 &&
        Math.abs(width / height - aspectRatioValue) < 0.0001
      ) {
        return { width, height };
      }
    }

    return {
      width: baseWidth,
      height: Math.max(2, Math.floor(baseWidth / aspectRatioValue / 2) * 2),
    };
  }

  const baseHeight = safeSourceHeight;
  for (let height = baseHeight; height >= 100; height -= 2) {
    const width = Math.round(height * aspectRatioValue);
    if (
      width % 2 === 0 &&
      Math.abs(width / height - aspectRatioValue) < 0.0001
    ) {
      return { width, height };
    }
  }

  return {
    height: baseHeight,
    width: Math.max(2, Math.floor((baseHeight * aspectRatioValue) / 2) * 2),
  };
}

export function calculateMp4ExportDimensions(
  baseWidth: number,
  baseHeight: number,
  quality: ExportQuality,
): { width: number; height: number } {
  if (quality === "source") {
    return {
      width: Math.max(2, Math.floor(baseWidth / 2) * 2),
      height: Math.max(2, Math.floor(baseHeight / 2) * 2),
    };
  }

  const qualityScale =
    quality === "medium" ? 0.6 : quality === "good" ? 0.75 : 0.9;
  return {
    width: Math.max(2, Math.floor((baseWidth * qualityScale) / 2) * 2),
    height: Math.max(2, Math.floor((baseHeight * qualityScale) / 2) * 2),
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error.replace(/^Error:\s*/i, "");
  }

  return "Something went wrong";
}

export function formatTime(seconds: number) {
  if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
