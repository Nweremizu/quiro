import { NextRequest, NextResponse } from "next/server";
import {
  detectPlatformFromUA,
  findAssetForPlatform,
  GITHUB_OWNER,
  GITHUB_REPO,
} from "@quiro/shared";
import type { GitHubRelease, Platform } from "@quiro/shared";

const RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const res = await fetch(RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json" },
    next: { revalidate: 600 },
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }

  return res.json() as Promise<GitHubRelease>;
}

export async function GET(request: NextRequest) {
  const ua = request.headers.get("user-agent") ?? "";
  const platform = detectPlatformFromUA(ua);

  if (platform === "unknown") {
    return NextResponse.redirect(GITHUB_RELEASES_PAGE);
  }

  try {
    const release = await fetchLatestRelease();
    const asset = findAssetForPlatform(release.assets, platform as Exclude<Platform, "unknown">);

    if (!asset) {
      return NextResponse.redirect(GITHUB_RELEASES_PAGE);
    }

    return NextResponse.redirect(asset.browser_download_url);
  } catch {
    return NextResponse.redirect(GITHUB_RELEASES_PAGE);
  }
}
