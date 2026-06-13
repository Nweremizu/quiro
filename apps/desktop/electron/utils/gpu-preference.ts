import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Windows decides which GPU a process runs on (integrated vs dedicated) at
 * the OS level — Chromium switches and WebGL powerPreference cannot override
 * it. The official per-app override lives in this registry key (it backs the
 * Windows Settings → Display → Graphics → "High performance" picker).
 */
const GPU_PREFERENCE_REG_KEY =
  "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";

/** GpuPreference=2 → "High performance" (dedicated GPU). 1 → power saving. */
const HIGH_PERFORMANCE_VALUE = "GpuPreference=2;";

const VENDOR_INTEL = 0x8086;
const VENDOR_NVIDIA = 0x10de;
const VENDOR_AMD = 0x1002;

export interface GpuAdapter {
  vendorId: number;
  deviceId: number;
  active: boolean;
}

export interface GpuAdapterAnalysis {
  /** A dedicated (non-integrated) GPU exists on this machine. */
  hasDiscreteGpu: boolean;
  /** The adapter currently driving the app is an integrated one. */
  activeIsIntegrated: boolean;
  activeVendor: "intel" | "nvidia" | "amd" | "unknown";
}

function vendorName(id: number): GpuAdapterAnalysis["activeVendor"] {
  if (id === VENDOR_INTEL) return "intel";
  if (id === VENDOR_NVIDIA) return "nvidia";
  if (id === VENDOR_AMD) return "amd";
  return "unknown";
}

export function analyzeGpuAdapters(adapters: GpuAdapter[]): GpuAdapterAnalysis {
  const active = adapters.find((a) => a.active) ?? adapters[0];
  const hasIntel = adapters.some((a) => a.vendorId === VENDOR_INTEL);
  // NVIDIA is always discrete. AMD counts as discrete only alongside an
  // Intel iGPU (a lone AMD adapter could be an APU).
  const hasDiscreteGpu = adapters.some(
    (a) =>
      a.vendorId === VENDOR_NVIDIA || (a.vendorId === VENDOR_AMD && hasIntel),
  );

  return {
    hasDiscreteGpu,
    activeIsIntegrated: active ? active.vendorId === VENDOR_INTEL : false,
    activeVendor: active ? vendorName(active.vendorId) : "unknown",
  };
}

/** Reads the current per-app GPU preference for the given exe, if any. */
export async function readWindowsGpuPreference(
  exePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("reg.exe", [
      "query",
      GPU_PREFERENCE_REG_KEY,
      "/v",
      exePath,
    ]);
    const match = stdout.match(/REG_SZ\s+(.+)/);
    return match ? match[1].trim() : null;
  } catch {
    // Key or value does not exist
    return null;
  }
}

/** Registers this exe for the high-performance (dedicated) GPU. Takes effect
 *  on the next process launch. */
export async function setWindowsGpuPreferenceHighPerformance(
  exePath: string,
): Promise<boolean> {
  try {
    await execFileAsync("reg.exe", [
      "add",
      GPU_PREFERENCE_REG_KEY,
      "/v",
      exePath,
      "/t",
      "REG_SZ",
      "/d",
      HIGH_PERFORMANCE_VALUE,
      "/f",
    ]);
    return true;
  } catch (error) {
    console.warn("[gpu] Failed to write GPU preference registry value:", error);
    return false;
  }
}
