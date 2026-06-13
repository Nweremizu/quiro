/**
 * System health checks for performance-sensitive flows (recording, playback,
 * editor). Detects whether the app is actually running on the GPU or has
 * silently fallen back to software rendering/decoding, and whether the
 * system CPU is already under heavy load — so the user can be told *why*
 * things may lag before they hit it.
 */

export type SystemHealthIssue =
  | "software-rendering"
  | "software-video-decode"
  | "integrated-gpu"
  | "high-cpu-load";

export interface SystemHealthWarning {
  issue: SystemHealthIssue;
  title: string;
  detail: string;
}

export interface SystemHealthAssessment {
  warnings: SystemHealthWarning[];
  /** Raw renderer string from WebGL, e.g. "ANGLE (NVIDIA GeForce RTX...)". */
  gpuRenderer: string | null;
  systemCpuPercent: number | null;
}

const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|software|microsoft basic render/i;

const HIGH_CPU_THRESHOLD_PERCENT = 80;

/**
 * Reads the WebGL renderer string from a throwaway context. If it names a
 * software rasterizer (SwiftShader etc.), GPU acceleration is NOT active in
 * this renderer process regardless of what the GPU process reports.
 */
export function detectWebglRenderer(): {
  renderer: string | null;
  isSoftware: boolean;
} {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) {
      return { renderer: null, isSoftware: true };
    }
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return {
      renderer,
      isSoftware: SOFTWARE_RENDERER_PATTERN.test(renderer),
    };
  } catch {
    return { renderer: null, isSoftware: false };
  }
}

/**
 * Combines main-process GPU feature status + CPU load with renderer-side
 * WebGL detection into a list of user-facing warnings. Returns an empty
 * warnings array when the system looks healthy.
 */
export async function assessSystemHealth(): Promise<SystemHealthAssessment> {
  const warnings: SystemHealthWarning[] = [];
  const webgl = detectWebglRenderer();

  interface MainProcessHealth {
    gpu: {
      videoDecode: string;
      webgl: string;
      gpuCompositing: string;
      rasterization: string;
      hardwareAccelerated: boolean;
      discreteGpuAvailable: boolean;
      activeIsIntegrated: boolean;
      activeVendor: "intel" | "nvidia" | "amd" | "unknown";
    };
    cpu: { systemLoadPercent: number; coreCount: number };
  }

  let health: MainProcessHealth | null = null;
  try {
    // systemHealth is added at runtime; cast to avoid ambient-type lag
    const healthFn = (
      window.electronAPI as unknown as {
        systemHealth?: () => Promise<MainProcessHealth>;
      }
    ).systemHealth;
    health = healthFn ? await healthFn() : null;
  } catch {
    // main process handler unavailable — fall back to renderer-only checks
  }

  const softwareRendering =
    webgl.isSoftware || health?.gpu.hardwareAccelerated === false;
  if (softwareRendering) {
    warnings.push({
      issue: "software-rendering",
      title: "GPU acceleration is not active",
      detail: webgl.renderer
        ? `Rendering is falling back to software (${webgl.renderer}). Playback and recording will be slow. Updating your graphics driver usually fixes this.`
        : "Rendering is falling back to software. Playback and recording will be slow. Updating your graphics driver usually fixes this.",
    });
  }

  if (
    health &&
    /software|disabled|unavailable/i.test(health.gpu.videoDecode) &&
    !softwareRendering
  ) {
    warnings.push({
      issue: "software-video-decode",
      title: "Hardware video decoding unavailable",
      detail:
        "Videos are being decoded on the CPU instead of the GPU, which can cause lag during playback of high-resolution recordings.",
    });
  }

  if (
    health?.gpu.discreteGpuAvailable &&
    health.gpu.activeIsIntegrated &&
    !softwareRendering
  ) {
    warnings.push({
      issue: "integrated-gpu",
      title: "Running on the integrated GPU",
      detail:
        "Your dedicated GPU is not being used. Quiro has requested the high-performance GPU — restart the app to apply it. If this keeps appearing, set it manually: Windows Settings → System → Display → Graphics → add Quiro → High performance.",
    });
  }

  if (
    health &&
    health.cpu.systemLoadPercent >= HIGH_CPU_THRESHOLD_PERCENT
  ) {
    warnings.push({
      issue: "high-cpu-load",
      title: `System CPU is at ${health.cpu.systemLoadPercent}%`,
      detail:
        "Other applications are using most of your CPU right now. Recording or playback may stutter — consider closing heavy apps (games, browsers with many tabs) first.",
    });
  }

  return {
    warnings,
    gpuRenderer: webgl.renderer,
    systemCpuPercent: health?.cpu.systemLoadPercent ?? null,
  };
}
