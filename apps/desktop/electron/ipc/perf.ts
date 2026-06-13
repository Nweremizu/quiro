import { app, ipcMain } from "electron";
import os from "node:os";
import { performance } from "node:perf_hooks";
import {
  analyzeGpuAdapters,
  type GpuAdapter,
  type GpuAdapterAnalysis,
} from "@electron/utils/gpu-preference";

interface ChannelStat {
  callCount: number;
  totalMs: number;
  maxMs: number;
  slowCount: number; // calls that took > 16 ms
}

const stats = new Map<string, ChannelStat>();

function record(channel: string, ms: number) {
  let s = stats.get(channel);
  if (!s) {
    s = { callCount: 0, totalMs: 0, maxMs: 0, slowCount: 0 };
    stats.set(channel, s);
  }
  s.callCount++;
  s.totalMs += ms;
  if (ms > s.maxMs) s.maxMs = ms;
  if (ms > 16) s.slowCount++;
}

/**
 * Patches ipcMain.handle so every registered handler is timed.
 * Must be called before any ipcMain.handle() registrations (i.e. before
 * registerIpcHandlers), ideally at module-load time in main.ts.
 */
export function installIpcPerfInterceptor() {
  const orig = ipcMain.handle.bind(ipcMain);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ipcMain as any).handle = (
    channel: string,
    handler: Parameters<typeof ipcMain.handle>[1],
  ) =>
    orig(channel, async (event, ...args) => {
      const t0 = performance.now();
      try {
        return await handler(event, ...args);
      } finally {
        record(channel, performance.now() - t0);
      }
    });
}

export function registerPerfHandlers() {
  ipcMain.handle("perf:snapshot", () => {
    const processes = app.getAppMetrics().map((m) => ({
      pid: m.pid,
      type: m.type,
      cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
      memMb: Math.round(m.memory.workingSetSize / 1024),
    }));

    const ipc = [...stats.entries()]
      .map(([channel, s]) => ({
        channel,
        calls: s.callCount,
        avgMs:
          s.callCount > 0
            ? Math.round((s.totalMs / s.callCount) * 10) / 10
            : 0,
        maxMs: Math.round(s.maxMs * 10) / 10,
        slowCount: s.slowCount,
      }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 14);

    return { processes, ipc };
  });

  ipcMain.handle("perf:ping", () => performance.now());

  ipcMain.handle("perf:system-health", async () => getSystemHealth());
}

// ── System health (GPU acceleration + CPU load) ────────────────────────────

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

/** System-wide CPU usage % sampled over ~300 ms. */
async function sampleSystemCpuPercent(): Promise<number> {
  const start = cpuTimes();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const end = cpuTimes();
  const totalDelta = end.total - start.total;
  const idleDelta = end.idle - start.idle;
  if (totalDelta <= 0) return 0;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
}

export interface SystemHealthReport {
  gpu: {
    /** Raw Chromium GPU feature status values, e.g. "enabled",
     *  "enabled_software", "disabled_software", "unavailable_off". */
    videoDecode: string;
    webgl: string;
    gpuCompositing: string;
    rasterization: string;
    /** True when any of the above indicates a software fallback. */
    hardwareAccelerated: boolean;
    /** A dedicated (non-integrated) GPU exists on this machine. */
    discreteGpuAvailable: boolean;
    /** The adapter currently driving the app is an integrated one. */
    activeIsIntegrated: boolean;
    activeVendor: "intel" | "nvidia" | "amd" | "unknown";
  };
  cpu: {
    systemLoadPercent: number;
    coreCount: number;
  };
}

function isSoftwareFeature(value: string | undefined): boolean {
  if (!value) return true;
  return /software|disabled|unavailable/i.test(value);
}

export async function getSystemHealth(): Promise<SystemHealthReport> {
  const status = app.getGPUFeatureStatus() as unknown as Record<
    string,
    string
  >;
  const videoDecode = status.video_decode ?? "unknown";
  const webgl = status.webgl ?? "unknown";
  const gpuCompositing = status.gpu_compositing ?? "unknown";
  const rasterization = status.rasterization ?? "unknown";

  const hardwareAccelerated =
    !isSoftwareFeature(gpuCompositing) && !isSoftwareFeature(webgl);

  let adapterAnalysis: GpuAdapterAnalysis = {
    hasDiscreteGpu: false,
    activeIsIntegrated: false,
    activeVendor: "unknown",
  };
  try {
    const info = (await app.getGPUInfo("basic")) as {
      gpuDevice?: GpuAdapter[];
    };
    adapterAnalysis = analyzeGpuAdapters(info.gpuDevice ?? []);
  } catch {
    // GPU info unavailable — leave defaults
  }

  return {
    gpu: {
      videoDecode,
      webgl,
      gpuCompositing,
      rasterization,
      hardwareAccelerated,
      discreteGpuAvailable: adapterAnalysis.hasDiscreteGpu,
      activeIsIntegrated: adapterAnalysis.activeIsIntegrated,
      activeVendor: adapterAnalysis.activeVendor,
    },
    cpu: {
      systemLoadPercent: await sampleSystemCpuPercent(),
      coreCount: os.cpus().length,
    },
  };
}
