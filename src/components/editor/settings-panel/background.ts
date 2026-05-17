import type { Padding } from "@/types/editor";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import { GRADIENTS, type BackgroundTab } from "./constants";

export function isHexWallpaper(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value);
}

export function isZeroPadding(padding: Padding): boolean {
  return (
    padding.top === 0 &&
    padding.bottom === 0 &&
    padding.left === 0 &&
    padding.right === 0
  );
}

export function getBackgroundTabForWallpaper(value: string): BackgroundTab {
  if (isVideoWallpaperSource(value)) return "video";
  if (isHexWallpaper(value)) return "color";
  if (GRADIENTS.includes(value as (typeof GRADIENTS)[number])) return "gradient";
  return "image";
}
