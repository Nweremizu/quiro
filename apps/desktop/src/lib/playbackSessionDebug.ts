/**
 * Per-session video playback instrumentation.
 *
 * Records every presented video frame (via requestVideoFrameCallback
 * metadata) and every Pixi render tick while the preview is playing, then
 * prints a summary when playback pauses so stutter can be attributed to
 * decode drops, presentation stalls, or slow render ticks.
 *
 * Enabled automatically in dev builds; force on/off at runtime with
 * `window.__PLAYBACK_DEBUG = true | false` in the devtools console.
 */

import { detectWebglRenderer } from "@/lib/systemHealth";

export interface PresentedFrameDebugMetadata {
  mediaTime?: number;
  presentedFrames?: number;
  processingDuration?: number;
  expectedDisplayTime?: number;
}

interface StallRecord {
  gapMs: number;
  mediaTimeSec: number;
  wallTimeSec: number;
  counterSkips: number;
}

interface PlaybackQualitySnapshot {
  totalVideoFrames: number;
  droppedVideoFrames: number;
}

interface PhaseStat {
  count: number;
  totalMs: number;
  maxMs: number;
}

type VideoWithQuality = HTMLVideoElement & {
  getVideoPlaybackQuality?: () => PlaybackQualitySnapshot;
};

declare global {
  interface Window {
    __PLAYBACK_DEBUG?: boolean;
  }
}

const TAG = "[playback-debug]";
const LIVE_LOG_INTERVAL_MS = 2000;
const STALL_THRESHOLD_MS = 80;
const LONG_RENDER_TICK_MS = 25;
const MAX_STALLS_KEPT = 12;

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__PLAYBACK_DEBUG === false) return false;
  return window.__PLAYBACK_DEBUG === true || Boolean(import.meta.env.DEV);
}

function readPlaybackQuality(
  video: HTMLVideoElement | null,
): PlaybackQualitySnapshot | null {
  const fn = (video as VideoWithQuality | null)?.getVideoPlaybackQuality;
  if (typeof fn !== "function") return null;
  const q = fn.call(video);
  return {
    totalVideoFrames: q.totalVideoFrames,
    droppedVideoFrames: q.droppedVideoFrames,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index];
}

function fmtMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function fmtSec(value: number): string {
  return `${value.toFixed(2)}s`;
}

function readHeapMb(): number | null {
  const memory = (
    performance as unknown as { memory?: { usedJSHeapSize: number } }
  ).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null;
}

let cachedGpu: { renderer: string | null; isSoftware: boolean } | undefined;

function getGpuRendererOnce(): { renderer: string | null; isSoftware: boolean } {
  if (cachedGpu === undefined) {
    cachedGpu = detectWebglRenderer();
  }
  return cachedGpu;
}

class PlaybackSessionDebug {
  private active = false;
  private video: HTMLVideoElement | null = null;
  private sessionStart = 0;
  private startQuality: PlaybackQualitySnapshot | null = null;
  private startMediaTimeSec = 0;

  // Presented video frames (requestVideoFrameCallback)
  private lastFrameNow: number | null = null;
  private lastPresentedFrames: number | null = null;
  private frameGaps: number[] = [];
  private counterSkips = 0;
  private stalls: StallRecord[] = [];
  private seekCount = 0;
  private lastMediaTimeSec = 0;

  // Render loop (Pixi ticker)
  private lastTickNow: number | null = null;
  private tickGaps: number[] = [];
  private longTicks = 0;
  private worstTickMs = 0;

  // Named per-frame work phases (zoom math, cursor overlay, pixi render, …)
  private phases = new Map<string, PhaseStat>();

  // Main-thread long tasks (>50ms) observed while playing
  private longTaskObserver: PerformanceObserver | null = null;
  private longTaskCount = 0;
  private longTaskTotalMs = 0;
  private longTaskMaxMs = 0;

  // Rolling 2s live-log window
  private liveWindowStart = 0;
  private liveFrames = 0;
  private liveTicks = 0;
  private liveWorstGap = 0;
  private liveWorstGapMediaSec = 0;
  private liveQualityStart: PlaybackQualitySnapshot | null = null;

  beginSession(video: HTMLVideoElement): void {
    if (!isEnabled()) return;
    if (this.active) this.endSession("restart");

    this.active = true;
    this.video = video;
    this.sessionStart = performance.now();
    this.startQuality = readPlaybackQuality(video);
    this.startMediaTimeSec = video.currentTime;
    this.lastMediaTimeSec = video.currentTime;

    this.lastFrameNow = null;
    this.lastPresentedFrames = null;
    this.frameGaps = [];
    this.counterSkips = 0;
    this.stalls = [];
    this.seekCount = 0;

    this.lastTickNow = null;
    this.tickGaps = [];
    this.longTicks = 0;
    this.worstTickMs = 0;
    this.phases = new Map();

    this.longTaskCount = 0;
    this.longTaskTotalMs = 0;
    this.longTaskMaxMs = 0;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTaskCount++;
          this.longTaskTotalMs += entry.duration;
          if (entry.duration > this.longTaskMaxMs) {
            this.longTaskMaxMs = entry.duration;
          }
        }
      });
      this.longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      this.longTaskObserver = null;
    }

    this.liveWindowStart = this.sessionStart;
    this.liveFrames = 0;
    this.liveTicks = 0;
    this.liveWorstGap = 0;
    this.liveWorstGapMediaSec = 0;
    this.liveQualityStart = this.startQuality;

    const gpu = getGpuRendererOnce();
    console.info(
      `${TAG} ▶ session start @ media ${fmtSec(video.currentTime)} (rate ${video.playbackRate}x) | source ${video.videoWidth}x${video.videoHeight} | gpu ${gpu.isSoftware ? "⚠ SOFTWARE " : ""}${gpu.renderer ?? "unknown"}`,
    );
  }

  /** Accumulate the cost of one named chunk of per-frame work. */
  recordPhase(name: string, durationMs: number): void {
    if (!this.active) return;
    const stat = this.phases.get(name);
    if (stat) {
      stat.count++;
      stat.totalMs += durationMs;
      if (durationMs > stat.maxMs) stat.maxMs = durationMs;
    } else {
      this.phases.set(name, { count: 1, totalMs: durationMs, maxMs: durationMs });
    }
  }

  /** Seeks (incl. trim skips) legitimately interrupt presentation — don't
   * count the gap across one as a stall. */
  markSeek(): void {
    if (!this.active) return;
    this.seekCount++;
    this.lastFrameNow = null;
  }

  recordPresentedFrame(
    now: number,
    metadata?: PresentedFrameDebugMetadata,
  ): void {
    if (!this.active) return;

    const mediaTimeSec = metadata?.mediaTime ?? this.video?.currentTime ?? 0;
    this.lastMediaTimeSec = mediaTimeSec;

    let skips = 0;
    if (
      typeof metadata?.presentedFrames === "number" &&
      this.lastPresentedFrames !== null
    ) {
      skips = Math.max(0, metadata.presentedFrames - this.lastPresentedFrames - 1);
      this.counterSkips += skips;
    }
    if (typeof metadata?.presentedFrames === "number") {
      this.lastPresentedFrames = metadata.presentedFrames;
    }

    if (this.lastFrameNow !== null) {
      const gap = now - this.lastFrameNow;
      this.frameGaps.push(gap);
      if (gap >= STALL_THRESHOLD_MS) {
        this.stalls.push({
          gapMs: gap,
          mediaTimeSec,
          wallTimeSec: (now - this.sessionStart) / 1000,
          counterSkips: skips,
        });
        if (this.stalls.length > MAX_STALLS_KEPT * 4) {
          this.stalls.sort((a, b) => b.gapMs - a.gapMs);
          this.stalls.length = MAX_STALLS_KEPT;
        }
      }
      if (gap > this.liveWorstGap) {
        this.liveWorstGap = gap;
        this.liveWorstGapMediaSec = mediaTimeSec;
      }
    }
    this.lastFrameNow = now;
    this.liveFrames++;

    this.maybeLogLiveWindow(now);
  }

  recordRenderTick(now: number): void {
    if (!this.active) return;

    if (this.lastTickNow !== null) {
      const gap = now - this.lastTickNow;
      this.tickGaps.push(gap);
      if (gap >= LONG_RENDER_TICK_MS) this.longTicks++;
      if (gap > this.worstTickMs) this.worstTickMs = gap;
    }
    this.lastTickNow = now;
    this.liveTicks++;
  }

  endSession(reason: string): void {
    if (!this.active) return;
    this.active = false;

    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;

    const wallSec = (performance.now() - this.sessionStart) / 1000;
    const mediaSec = this.lastMediaTimeSec - this.startMediaTimeSec;
    const endQuality = readPlaybackQuality(this.video);
    this.video = null;

    const gaps = [...this.frameGaps].sort((a, b) => a - b);
    const ticks = [...this.tickGaps].sort((a, b) => a - b);
    const videoFps = wallSec > 0 ? this.frameGaps.length / wallSec : 0;
    const renderFps = wallSec > 0 ? this.tickGaps.length / wallSec : 0;

    const lines: string[] = [
      `${TAG} ⏹ session end (${reason})`,
      `  wall ${fmtSec(wallSec)}, media advanced ${fmtSec(mediaSec)}, seeks/trim-skips: ${this.seekCount}`,
      `  presented frames: ${this.frameGaps.length + 1} → ~${videoFps.toFixed(1)} fps | gap p50 ${fmtMs(percentile(gaps, 50))}, p95 ${fmtMs(percentile(gaps, 95))}, max ${fmtMs(gaps[gaps.length - 1] ?? 0)}`,
      `  presentation callbacks missed (counter skips): ${this.counterSkips}`,
      `  render ticks: ~${renderFps.toFixed(1)} fps | p50 ${fmtMs(percentile(ticks, 50))}, p95 ${fmtMs(percentile(ticks, 95))}, max ${fmtMs(this.worstTickMs)} | >${LONG_RENDER_TICK_MS}ms: ${this.longTicks}`,
    ];

    if (this.startQuality && endQuality) {
      const dropped =
        endQuality.droppedVideoFrames - this.startQuality.droppedVideoFrames;
      const total =
        endQuality.totalVideoFrames - this.startQuality.totalVideoFrames;
      const pct = total > 0 ? ((dropped / total) * 100).toFixed(1) : "0.0";
      lines.push(`  decoder: ${total} frames, ${dropped} dropped (${pct}%)`);
    }

    if (this.longTaskCount > 0) {
      lines.push(
        `  main-thread long tasks (>50ms): ${this.longTaskCount}, total ${fmtMs(this.longTaskTotalMs)} (${((this.longTaskTotalMs / (wallSec * 1000)) * 100).toFixed(1)}% of session), max ${fmtMs(this.longTaskMaxMs)}`,
      );
    } else {
      lines.push("  main-thread long tasks (>50ms): none observed");
    }

    if (this.phases.size > 0) {
      lines.push("  per-frame phases (total | avg | max):");
      const sorted = [...this.phases.entries()].sort(
        (a, b) => b[1].totalMs - a[1].totalMs,
      );
      for (const [name, stat] of sorted) {
        lines.push(
          `    ${name}: ${fmtMs(stat.totalMs)} | ${fmtMs(stat.totalMs / stat.count)} | ${fmtMs(stat.maxMs)} (×${stat.count})`,
        );
      }
    }

    const worstStalls = [...this.stalls]
      .sort((a, b) => b.gapMs - a.gapMs)
      .slice(0, MAX_STALLS_KEPT);
    if (worstStalls.length > 0) {
      lines.push(
        `  stalls ≥${STALL_THRESHOLD_MS}ms: ${this.stalls.length} (worst ${worstStalls.length} below)`,
      );
      for (const stall of worstStalls) {
        lines.push(
          `    +${fmtSec(stall.wallTimeSec)} @ media ${fmtSec(stall.mediaTimeSec)}: gap ${fmtMs(stall.gapMs)}${stall.counterSkips > 0 ? ` (missed ${stall.counterSkips} presented frames)` : ""}`,
        );
      }
    } else {
      lines.push(`  stalls ≥${STALL_THRESHOLD_MS}ms: none`);
    }

    console.info(lines.join("\n"));
  }

  private maybeLogLiveWindow(now: number): void {
    const elapsed = now - this.liveWindowStart;
    if (elapsed < LIVE_LOG_INTERVAL_MS) return;

    const windowSec = elapsed / 1000;
    const quality = readPlaybackQuality(this.video);
    const droppedDelta =
      quality && this.liveQualityStart
        ? quality.droppedVideoFrames - this.liveQualityStart.droppedVideoFrames
        : null;

    const heapMb = readHeapMb();
    console.info(
      `${TAG} +${fmtSec((now - this.sessionStart) / 1000)} | video ${(this.liveFrames / windowSec).toFixed(1)}fps | render ${(this.liveTicks / windowSec).toFixed(1)}fps | worst gap ${fmtMs(this.liveWorstGap)} @ media ${fmtSec(this.liveWorstGapMediaSec)}${droppedDelta !== null ? ` | dropped +${droppedDelta}` : ""}${heapMb !== null ? ` | heap ${heapMb}MB` : ""}`,
    );

    this.liveWindowStart = now;
    this.liveFrames = 0;
    this.liveTicks = 0;
    this.liveWorstGap = 0;
    this.liveWorstGapMediaSec = 0;
    this.liveQualityStart = quality;
  }
}

export const playbackSessionDebug = new PlaybackSessionDebug();
