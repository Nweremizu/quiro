import type { Platform } from "./github";

/**
 * Detects the visitor's OS from a User-Agent string.
 * Used server-side in the Next.js route handler for /api/download.
 */
export function detectPlatformFromUA(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();

  if (ua.includes("windows")) return "windows";

  if (ua.includes("macintosh") || ua.includes("mac os x")) {
    // Apple Silicon Macs report arm64 in the UA starting with macOS 11+
    if (ua.includes("arm") || ua.includes("apple m")) return "macos-arm";
    return "macos-intel";
  }

  return "unknown";
}
