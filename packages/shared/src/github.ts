export const GITHUB_OWNER = "Nweremizu";
export const GITHUB_REPO = "quiro";

export const GITHUB_API_BASE = "https://api.github.com";
export const RELEASES_API_URL = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export type Platform = "windows" | "macos-intel" | "macos-arm" | "unknown";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  prerelease: boolean;
  published_at: string;
  assets: ReleaseAsset[];
}

/**
 * Patterns that identify downloadable installer assets per platform.
 * Order matters: first match wins.
 */
export const ASSET_PATTERNS: Record<Exclude<Platform, "unknown">, RegExp> = {
  windows: /Quiro-windows-x64\.exe$/,
  "macos-arm": /Quiro.*arm64\.dmg$/,
  "macos-intel": /Quiro.*\.dmg$/,
};

export function findAssetForPlatform(
  assets: ReleaseAsset[],
  platform: Exclude<Platform, "unknown">,
): ReleaseAsset | undefined {
  return assets.find((a) => ASSET_PATTERNS[platform].test(a.name));
}
