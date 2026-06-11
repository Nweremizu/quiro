import {
  GITHUB_OWNER,
  GITHUB_REPO,
  findAssetForPlatform,
} from "@quiro/shared";
import type { GitHubRelease, ReleaseAsset } from "@quiro/shared";

const RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export interface LatestRelease {
  version: string;
  publishedAt: string;
  windows: ReleaseAsset | undefined;
  macosArm: ReleaseAsset | undefined;
  macosIntel: ReleaseAsset | undefined;
  releasesPageUrl: string;
}

export async function getLatestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
    });

    if (!res.ok) return null;

    const release = (await res.json()) as GitHubRelease;

    return {
      version: release.tag_name.replace(/^v/, ""),
      publishedAt: release.published_at,
      windows: findAssetForPlatform(release.assets, "windows"),
      macosArm: findAssetForPlatform(release.assets, "macos-arm"),
      macosIntel: findAssetForPlatform(release.assets, "macos-intel"),
      releasesPageUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    };
  } catch {
    return null;
  }
}
