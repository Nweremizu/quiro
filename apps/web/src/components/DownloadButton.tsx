"use client";

import { useEffect, useState } from "react";
import type { LatestRelease } from "@/lib/releases";

interface Props {
  release: LatestRelease | null;
}

type ClientPlatform = "windows" | "macos-arm" | "macos-intel" | "unknown";

function detectClientPlatform(): ClientPlatform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("macintosh") || ua.includes("mac os x")) {
    // navigator.userAgentData is available in Chromium-based browsers
    const uaData = (navigator as { userAgentData?: { platform?: string } })
      .userAgentData;
    if (uaData?.platform?.toLowerCase().includes("arm")) return "macos-arm";
    return "macos-intel";
  }
  return "unknown";
}

export function DownloadButton({ release }: Props) {
  const [platform, setPlatform] = useState<ClientPlatform>("unknown");

  useEffect(() => {
    setPlatform(detectClientPlatform());
  }, []);

  const fallbackUrl = release?.releasesPageUrl ?? "/api/download";

  const primaryUrl = (() => {
    if (!release) return "/api/download";
    if (platform === "windows") return release.windows?.browser_download_url ?? fallbackUrl;
    if (platform === "macos-arm") return release.macosArm?.browser_download_url ?? release.macosIntel?.browser_download_url ?? fallbackUrl;
    if (platform === "macos-intel") return release.macosIntel?.browser_download_url ?? fallbackUrl;
    return "/api/download";
  })();

  const label = (() => {
    if (platform === "windows") return "Download for Windows";
    if (platform === "macos-arm" || platform === "macos-intel") return "Download for macOS";
    return "Download";
  })();

  return (
    <div className="flex flex-col items-center gap-3">
      <a
        href={primaryUrl}
        className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-semibold text-black shadow-lg transition hover:bg-gray-100 active:scale-95"
      >
        {label}
        {release && (
          <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-normal">
            v{release.version}
          </span>
        )}
      </a>
      {release && (
        <div className="flex gap-4 text-sm text-gray-400">
          {release.windows && (
            <a href={release.windows.browser_download_url} className="hover:text-white transition">
              Windows
            </a>
          )}
          {release.macosArm && (
            <a href={release.macosArm.browser_download_url} className="hover:text-white transition">
              macOS (Apple Silicon)
            </a>
          )}
          {release.macosIntel && (
            <a href={release.macosIntel.browser_download_url} className="hover:text-white transition">
              macOS (Intel)
            </a>
          )}
          <a href={release.releasesPageUrl} className="hover:text-white transition">
            All releases
          </a>
        </div>
      )}
    </div>
  );
}
