import GIF from "gif.js";
import type {
  AnnotationRegion,
  AutoCaptionSettings,
  CaptionCue,
  CropRegion,
  CursorClickEffectSettings,
  CursorStyle,
  CursorTelemetryPoint,
  Padding,
  SpeedRegion,
  TrimRegion,
  WebcamOverlaySettings,
  ZoomMotionBlurTuning,
  ZoomRegion,
  ZoomTransitionEasing,
} from "@/types/editor";
import { FrameRenderer } from "./frame-renderer";
import { StreamingVideoDecoder } from "./streaming-decoder";
import type {
  ExportProgress,
  ExportResult,
  GIF_SIZE_PRESETS,
  GifFrameRate,
  GifSizePreset,
} from "./types";

const GIF_WORKER_URL = new URL(
  "gif.js/dist/gif.worker.js",
  import.meta.url,
).toString();

const PROGRESS_SAMPLE_WINDOW_MS = 1_000;

interface GifExporterConfig {
  videoUrl: string;
  width: number;
  height: number;
  frameRate: GifFrameRate;
  loop: boolean;
  sizePreset: GifSizePreset;
  wallpaper: string;
  zoomRegions: ZoomRegion[];
  trimRegions?: TrimRegion[];
  speedRegions?: SpeedRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  backgroundBlur: number;
  zoomMotionBlur?: number;
  zoomMotionBlurTuning?: ZoomMotionBlurTuning;
  zoomTemporalMotionBlur?: number;
  zoomMotionBlurSampleCount?: number | null;
  zoomMotionBlurShutterFraction?: number | null;
  connectZooms?: boolean;
  zoomInDurationMs?: number;
  zoomInOverlapMs?: number;
  zoomOutDurationMs?: number;
  connectedZoomGapMs?: number;
  connectedZoomDurationMs?: number;
  zoomInEasing?: ZoomTransitionEasing;
  zoomOutEasing?: ZoomTransitionEasing;
  connectedZoomEasing?: ZoomTransitionEasing;
  borderRadius?: number;
  padding?: Padding | number;
  videoPadding?: Padding | number;
  cropRegion: CropRegion;
  webcam?: WebcamOverlaySettings;
  webcamUrl?: string | null;
  annotationRegions?: AnnotationRegion[];
  autoCaptions?: CaptionCue[];
  autoCaptionSettings?: AutoCaptionSettings;
  cursorTelemetry?: CursorTelemetryPoint[];
  showCursor?: boolean;
  cursorStyle?: CursorStyle;
  cursorSize?: number;
  cursorSmoothing?: number;
  cursorSpringStiffnessMultiplier?: number;
  cursorSpringDampingMultiplier?: number;
  cursorSpringMassMultiplier?: number;
  cameraSpringStiffnessMultiplier?: number;
  cameraSpringDampingMultiplier?: number;
  cameraSpringMassMultiplier?: number;
  zoomSmoothness?: number;
  zoomClassicMode?: boolean;
  cursorMotionBlur?: number;
  cursorClickBounce?: number;
  cursorClickBounceDuration?: number;
  cursorClickEffect?: CursorClickEffectSettings;
  cursorSway?: number;
  frame?: string | null;
  previewWidth?: number;
  previewHeight?: number;
  maxDecodeQueue?: number;
  maxPendingFrames?: number;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * Calculate output dimensions based on size preset and source dimensions while preserving aspect ratio.
 * @param sourceWidth - Original video width
 * @param sourceHeight - Original video height
 * @param sizePreset - The size preset to use
 * @param sizePresets - The size presets configuration
 * @returns The calculated output dimensions
 */
export function calculateOutputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  sizePreset: GifSizePreset,
  sizePresets: typeof GIF_SIZE_PRESETS,
): { width: number; height: number } {
  const preset = sizePresets[sizePreset];
  const maxHeight = preset.maxHeight;

  // If original is smaller than max height or preset is 'original', use source dimensions
  if (sourceHeight <= maxHeight || sizePreset === "original") {
    return { width: sourceWidth, height: sourceHeight };
  }

  // Calculate scaled dimensions preserving aspect ratio
  const aspectRatio = sourceWidth / sourceHeight;
  const newHeight = maxHeight;
  const newWidth = Math.round(newHeight * aspectRatio);

  // Ensure dimensions are even (required for some encoders)
  return {
    width: newWidth % 2 === 0 ? newWidth : newWidth + 1,
    height: newHeight % 2 === 0 ? newHeight : newHeight + 1,
  };
}

export function getGifRepeat(loop: boolean): 0 | 1 {
  return loop ? 0 : 1;
}

export class GifExporter {
  private config: GifExporterConfig;
  private streamingDecoder: StreamingVideoDecoder | null = null;
  private renderer: FrameRenderer | null = null;
  private gif: GIF | null = null;
  private nativeSessionId: string | null = null;
  private cancelled = false;
  private exportStartTimeMs = 0;
  private progressSampleStartTimeMs = 0;
  private progressSampleStartFrame = 0;
  private lastRenderFps: number | undefined;

  constructor(config: GifExporterConfig) {
    this.config = config;
  }

  async export(): Promise<ExportResult> {
    try {
      this.cleanup();
      this.cancelled = false;
      this.exportStartTimeMs = this.getNowMs();
      this.progressSampleStartTimeMs = this.exportStartTimeMs;
      this.progressSampleStartFrame = 0;
      this.lastRenderFps = undefined;

      // Initialize streaming decoder and load video metadata
      this.streamingDecoder = new StreamingVideoDecoder({
        maxDecodeQueue: this.config.maxDecodeQueue,
        maxPendingFrames: this.config.maxPendingFrames,
      });
      const videoInfo = await this.streamingDecoder.loadMetadata(
        this.config.videoUrl,
      );

      // Initialize frame renderer
      this.renderer = new FrameRenderer({
        width: this.config.width,
        height: this.config.height,
        wallpaper: this.config.wallpaper,
        zoomRegions: this.config.zoomRegions,
        showShadow: this.config.showShadow,
        shadowIntensity: this.config.shadowIntensity,
        backgroundBlur: this.config.backgroundBlur,
        zoomMotionBlur: this.config.zoomMotionBlur,
        zoomMotionBlurTuning: this.config.zoomMotionBlurTuning,
        zoomTemporalMotionBlur: this.config.zoomTemporalMotionBlur,
        zoomMotionBlurSampleCount: this.config.zoomMotionBlurSampleCount,
        zoomMotionBlurShutterFraction:
          this.config.zoomMotionBlurShutterFraction,
        connectZooms: this.config.connectZooms,
        zoomInDurationMs: this.config.zoomInDurationMs,
        zoomInOverlapMs: this.config.zoomInOverlapMs,
        zoomOutDurationMs: this.config.zoomOutDurationMs,
        connectedZoomGapMs: this.config.connectedZoomGapMs,
        connectedZoomDurationMs: this.config.connectedZoomDurationMs,
        zoomInEasing: this.config.zoomInEasing,
        zoomOutEasing: this.config.zoomOutEasing,
        connectedZoomEasing: this.config.connectedZoomEasing,
        borderRadius: this.config.borderRadius,
        padding: this.config.padding,
        cropRegion: this.config.cropRegion,
        webcam: this.config.webcam,
        webcamUrl: this.config.webcamUrl,
        videoWidth: videoInfo.width,
        videoHeight: videoInfo.height,
        annotationRegions: this.config.annotationRegions,
        autoCaptions: this.config.autoCaptions,
        autoCaptionSettings: this.config.autoCaptionSettings,
        speedRegions: this.config.speedRegions,
        previewWidth: this.config.previewWidth,
        previewHeight: this.config.previewHeight,
        cursorTelemetry: this.config.cursorTelemetry,
        showCursor: this.config.showCursor,
        cursorStyle: this.config.cursorStyle,
        cursorSize: this.config.cursorSize,
        cursorSmoothing: this.config.cursorSmoothing,
        cursorSpringStiffnessMultiplier:
          this.config.cursorSpringStiffnessMultiplier,
        cursorSpringDampingMultiplier:
          this.config.cursorSpringDampingMultiplier,
        cursorSpringMassMultiplier: this.config.cursorSpringMassMultiplier,
        cameraSpringStiffnessMultiplier:
          this.config.cameraSpringStiffnessMultiplier,
        cameraSpringDampingMultiplier:
          this.config.cameraSpringDampingMultiplier,
        cameraSpringMassMultiplier: this.config.cameraSpringMassMultiplier,
        zoomSmoothness: this.config.zoomSmoothness,
        zoomClassicMode: this.config.zoomClassicMode,
        cursorMotionBlur: this.config.cursorMotionBlur,
        cursorClickBounce: this.config.cursorClickBounce,
        cursorClickBounceDuration: this.config.cursorClickBounceDuration,
        cursorClickEffect: this.config.cursorClickEffect,
        cursorSway: this.config.cursorSway,
        frame: this.config.frame,
      });
      await this.renderer.initialize();

      // Calculate effective duration and frame count (excluding trim regions)
      const effectiveDuration = this.streamingDecoder.getEffectiveDuration(
        this.config.trimRegions,
        this.config.speedRegions,
      );
      const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);
      const frameDurationUs = 1_000_000 / this.config.frameRate;

      console.log("[GifExporter] Original duration:", videoInfo.duration, "s");
      console.log("[GifExporter] Effective duration:", effectiveDuration, "s");
      console.log("[GifExporter] Total frames to export:", totalFrames);
      console.log("[GifExporter] Frame rate:", this.config.frameRate, "FPS");
      console.log(
        "[GifExporter] Loop:",
        this.config.loop ? "infinite" : "once",
      );

      // Primary path: stream rendered frames to bundled FFmpeg (palettegen/
      // paletteuse) — hardware-agnostic C encode, far faster and higher quality
      // than the pure-JS gif.js fallback. Falls back to gif.js only when the
      // native session can't start (e.g. FFmpeg unavailable).
      if (this.canUseNativeGifEncode()) {
        const nativeResult = await this.exportViaFfmpeg(
          totalFrames,
          frameDurationUs,
        );
        if (nativeResult) {
          return nativeResult;
        }
        console.warn(
          "[GifExporter] Native FFmpeg GIF path unavailable — falling back to gif.js",
        );
      }

      return await this.exportViaGifJs(totalFrames, frameDurationUs);
    } catch (error) {
      console.error("GIF Export error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.cleanup();
    }
  }

  private canUseNativeGifEncode(): boolean {
    return (
      typeof window !== "undefined" &&
      !!window.electronAPI?.nativeVideoExportStart &&
      !!window.electronAPI?.nativeVideoExportWriteFrame &&
      !!window.electronAPI?.nativeVideoExportFinish
    );
  }

  /**
   * Streams rendered RGBA frames to the main-process FFmpeg GIF session.
   * Returns an ExportResult on success or hard failure, or `null` if the
   * session could not be started so the caller can fall back to gif.js.
   */
  private async exportViaFfmpeg(
    totalFrames: number,
    frameDurationUs: number,
  ): Promise<ExportResult | null> {
    console.log("[GifExporter] Encoding via native FFmpeg (palettegen)");
    const start = await window.electronAPI.nativeVideoExportStart({
      width: this.config.width,
      height: this.config.height,
      frameRate: this.config.frameRate,
      bitrate: 0,
      encodingMode: "balanced",
      format: "gif",
      loop: this.config.loop,
    });

    if (!start.success || !start.sessionId) {
      return null;
    }
    this.nativeSessionId = start.sessionId;
    const sessionId = start.sessionId;

    let frameIndex = 0;
    await this.streamingDecoder!.decodeAll(
      this.config.frameRate,
      this.config.trimRegions,
      this.config.speedRegions,
      async (videoFrame, _exportTimestampUs, sourceTimestampMs, cursorTimestampMs) => {
        if (this.cancelled) {
          return;
        }

        await this.renderer!.renderFrame(
          videoFrame,
          sourceTimestampMs * 1000,
          cursorTimestampMs * 1000,
          frameDurationUs,
          frameIndex * frameDurationUs,
        );

        const frameBytes = this.readRenderedFrameBytes();
        const writeResult = await window.electronAPI.nativeVideoExportWriteFrame(
          sessionId,
          frameBytes,
        );
        if (!writeResult.success) {
          throw new Error(writeResult.error || "Failed to write GIF frame");
        }

        frameIndex++;
        this.reportProgress(frameIndex, totalFrames);
      },
    );

    if (this.cancelled) {
      await window.electronAPI.nativeVideoExportCancel?.(sessionId);
      this.nativeSessionId = null;
      return { success: false, error: "Export cancelled" };
    }

    this.reportFinalizing(totalFrames);

    const finish = await window.electronAPI.nativeVideoExportFinish(sessionId, {
      audioMode: "none",
    });
    this.nativeSessionId = null;

    if (!finish.success || !finish.tempPath) {
      return {
        success: false,
        error: finish.error || "GIF finalization failed",
      };
    }

    return { success: true, tempFilePath: finish.tempPath };
  }

  /** Reads the composite canvas as top-down RGBA bytes (w*h*4). */
  private readRenderedFrameBytes(): Uint8Array {
    const canvas = this.renderer!.getCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Composite canvas 2D context unavailable");
    }
    const imageData = ctx.getImageData(
      0,
      0,
      this.config.width,
      this.config.height,
    );
    return new Uint8Array(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength,
    );
  }

  private reportFinalizing(totalFrames: number): void {
    if (this.config.onProgress) {
      this.config.onProgress({
        currentFrame: totalFrames,
        totalFrames,
        percentage: 100,
        estimatedTimeRemaining: 0,
        phase: "finalizing",
        renderFps: this.lastRenderFps,
      });
    }
  }

  /** Pure-JS fallback used only when FFmpeg is unavailable. */
  private async exportViaGifJs(
    totalFrames: number,
    frameDurationUs: number,
  ): Promise<ExportResult> {
    // Loop: 0 = infinite loop, 1 = play once (no loop)
    const repeat = getGifRepeat(this.config.loop);
    const cores = navigator.hardwareConcurrency || 4;
    const WORKER_COUNT = Math.max(1, Math.min(8, cores - 1));
    const frameDelay = Math.round(1000 / this.config.frameRate);

    this.gif = new GIF({
      workers: WORKER_COUNT,
      quality: 10,
      width: this.config.width,
      height: this.config.height,
      workerScript: GIF_WORKER_URL,
      repeat,
      background: "#000000",
      transparent: null,
      dither: "FloydSteinberg",
    });

    let frameIndex = 0;
    await this.streamingDecoder!.decodeAll(
      this.config.frameRate,
      this.config.trimRegions,
      this.config.speedRegions,
      async (videoFrame, _exportTimestampUs, sourceTimestampMs, cursorTimestampMs) => {
        if (this.cancelled) {
          return;
        }

        await this.renderer!.renderFrame(
          videoFrame,
          sourceTimestampMs * 1000,
          cursorTimestampMs * 1000,
          frameDurationUs,
          frameIndex * frameDurationUs,
        );

        this.gif!.addFrame(this.renderer!.getCanvas(), {
          delay: frameDelay,
          copy: true,
        });
        frameIndex++;
        this.reportProgress(frameIndex, totalFrames);
      },
    );

    if (this.cancelled) {
      return { success: false, error: "Export cancelled" };
    }

    this.reportFinalizing(totalFrames);

    const blob = await new Promise<Blob>((resolve) => {
      this.gif!.on("finished", (blob: Blob) => {
        resolve(blob);
      });

      this.gif!.on("progress", (progress: number) => {
        if (this.config.onProgress) {
          this.config.onProgress({
            currentFrame: totalFrames,
            totalFrames,
            percentage: 100,
            estimatedTimeRemaining: 0,
            phase: "finalizing",
            renderFps: this.lastRenderFps,
            renderProgress: Math.round(progress * 100),
          });
        }
      });

      this.gif!.render();
    });

    return { success: true, blob };
  }

  private reportProgress(currentFrame: number, totalFrames: number) {
    const nowMs = this.getNowMs();
    const elapsedSeconds = Math.max(
      (nowMs - this.exportStartTimeMs) / 1000,
      0.001,
    );
    const averageRenderFps = currentFrame / elapsedSeconds;
    const sampleElapsedMs = Math.max(nowMs - this.progressSampleStartTimeMs, 1);
    const sampleFrameDelta = Math.max(
      currentFrame - this.progressSampleStartFrame,
      0,
    );
    const renderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
    const remainingFrames = Math.max(totalFrames - currentFrame, 0);
    const estimatedTimeRemaining =
      averageRenderFps > 0 ? remainingFrames / averageRenderFps : 0;
    this.lastRenderFps = renderFps;

    if (sampleElapsedMs >= PROGRESS_SAMPLE_WINDOW_MS) {
      this.progressSampleStartTimeMs = nowMs;
      this.progressSampleStartFrame = currentFrame;
    }

    if (this.config.onProgress) {
      this.config.onProgress({
        currentFrame,
        totalFrames,
        percentage: totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 100,
        estimatedTimeRemaining,
        renderFps,
      });
    }
  }

  private getNowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  cancel(): void {
    this.cancelled = true;
    if (this.streamingDecoder) {
      this.streamingDecoder.cancel();
    }
    if (this.gif) {
      this.gif.abort();
    }
    if (this.nativeSessionId && typeof window !== "undefined") {
      void window.electronAPI?.nativeVideoExportCancel?.(this.nativeSessionId);
      this.nativeSessionId = null;
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.streamingDecoder) {
      try {
        this.streamingDecoder.destroy();
      } catch (e) {
        console.warn("Error destroying streaming decoder:", e);
      }
      this.streamingDecoder = null;
    }

    if (this.renderer) {
      try {
        this.renderer.destroy();
      } catch (e) {
        console.warn("Error destroying renderer:", e);
      }
      this.renderer = null;
    }

    // gif.js never terminates its web workers on a successful render — it only
    // does so on abort() — so a completed export would otherwise leak up to
    // WORKER_COUNT live workers per run, eventually exhausting the renderer and
    // forcing an app restart. Terminate them explicitly here.
    if (this.gif) {
      const workers = this.gif as unknown as {
        freeWorkers?: Worker[];
        activeWorkers?: Worker[];
      };
      for (const worker of [
        ...(workers.freeWorkers ?? []),
        ...(workers.activeWorkers ?? []),
      ]) {
        try {
          worker.terminate();
        } catch {
          // Worker may already be gone.
        }
      }
    }
    this.gif = null;
  }
}
