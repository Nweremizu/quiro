import minimalCursorUrl from "@/assets/cursors/custom/minimal-cursor.svg";
import type { CursorStyle } from "@/types/editor";
import { getCursorStyleSizeMultiplier } from "../videoPlayback/uploadedCursorAssets";
import {
  BUILTIN_CURSOR_PREVIEW_FRAME_SIZE,
  BUILTIN_CURSOR_PREVIEW_SIZE,
} from "./constants";
import { cn } from "@/lib/utils";

export function CursorStylePreview({
  style,
  previewUrls,
  fallbackUrl,
  imageOverrideClassName,
  macosClassName,
  size = BUILTIN_CURSOR_PREVIEW_SIZE,
}: {
  style: CursorStyle;
  previewUrls: Partial<Record<string, string>>;
  fallbackUrl: string;
  imageOverrideClassName?: string;
  macosClassName?: string;
  /** Override the rendered size (px). Scales frame + image proportionally. Defaults to BUILTIN_CURSOR_PREVIEW_SIZE. */
  size?: number;
}) {
  const scale = size / BUILTIN_CURSOR_PREVIEW_SIZE;
  const previewSrc =
    style === "macos"
      ? (previewUrls.macos ?? fallbackUrl)
      : style === "tahoe"
        ? (previewUrls.tahoe ?? fallbackUrl)
        : style === "figma"
          ? (previewUrls.figma ?? minimalCursorUrl)
          : style === "tahoe-inverted"
            ? (previewUrls["tahoe-inverted"] ?? fallbackUrl)
            : previewUrls[style];

  if (style === "macos" || style === "tahoe" || style === "tahoe-inverted") {
    const frameSize = BUILTIN_CURSOR_PREVIEW_FRAME_SIZE * scale;
    const imgSize =
      BUILTIN_CURSOR_PREVIEW_SIZE * getCursorStyleSizeMultiplier(style) * scale;
    return (
      <div
        className="flex items-center justify-center"
        style={{ width: `${frameSize}px`, height: `${frameSize}px` }}
      >
        <img
          src={previewSrc ?? fallbackUrl}
          alt=""
          className={cn(
            "max-w-none object-contain drop-shadow-[0_8px_12px_rgba(15,23,42,0.18)]",
            macosClassName && style === "macos"
              ? macosClassName
              : imageOverrideClassName,
          )}
          draggable={false}
          style={{ width: `${imgSize}px`, height: `${imgSize}px` }}
        />
      </div>
    );
  }

  // figma/dot/custom use size directly so they match the visual weight of the
  // arrow cursors at any given size value, instead of scaling from their
  // original small base sizes (which produced tiny icons at size=30).
  const smallSize = Math.round(size * 0.86);
  const dotSize = Math.round(size * 0.56);

  if (style === "figma") {
    return (
      <img
        src={previewSrc}
        alt=""
        className="object-contain"
        draggable={false}
        style={{ width: smallSize, height: smallSize }}
      />
    );
  }

  if (style === "dot") {
    return (
      <span
        className="rounded-full border-[2.5px] border-neutral-800 bg-white shadow-[0_8px_12px_rgba(15,23,42,0.16)]"
        style={{ width: dotSize, height: dotSize, display: "block" }}
      />
    );
  }

  return (
    <img
      src={previewSrc ?? fallbackUrl}
      alt=""
      className="object-contain"
      draggable={false}
      style={{ width: smallSize, height: smallSize }}
    />
  );
}
