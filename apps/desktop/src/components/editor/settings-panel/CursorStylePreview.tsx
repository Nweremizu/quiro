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
}: {
  style: CursorStyle;
  previewUrls: Partial<Record<string, string>>;
  fallbackUrl: string;
  imageOverrideClassName?: string;
  macosClassName?: string;
}) {
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
    const previewSize =
      BUILTIN_CURSOR_PREVIEW_SIZE * getCursorStyleSizeMultiplier(style);
    return (
      <div
        className="flex items-center justify-center"
        style={{
          width: `${BUILTIN_CURSOR_PREVIEW_FRAME_SIZE}px`,
          height: `${BUILTIN_CURSOR_PREVIEW_FRAME_SIZE}px`,
        }}
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
          style={{
            width: `${previewSize}px`,
            height: `${previewSize}px`,
          }}
        />
      </div>
    );
  }

  if (style === "figma") {
    return (
      <img
        src={previewSrc}
        alt=""
        className="h-7 w-7 object-contain"
        draggable={false}
      />
    );
  }

  if (style === "dot") {
    return (
      <span className="size-5 rounded-full border-[2.5px] border-neutral-800 bg-white shadow-[0_8px_12px_rgba(15,23,42,0.16)]" />
    );
  }

  return (
    <img
      src={previewSrc ?? fallbackUrl}
      alt=""
      className="h-7 w-7 object-contain"
      draggable={false}
    />
  );
}
