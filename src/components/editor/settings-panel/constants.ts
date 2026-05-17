import type { AppLocale } from "@/i18n/config";
import type {
  AutoCaptionAnimation,
  CursorStyle,
  WebcamPositionPreset,
  ZoomDepth,
} from "@/types/editor";

export const BUILTIN_CURSOR_PREVIEW_SIZE = 56;
export const BUILTIN_CURSOR_PREVIEW_FRAME_SIZE = 56;

export type BackgroundTab = "image" | "video" | "color" | "gradient";

export const GRADIENTS: string[] = [
  "linear-gradient(135deg, #fff7ee 0%, #f08030 100%)",
  "linear-gradient(135deg, #ffecd4 0%, #d4651a 100%)",
  "linear-gradient(135deg, #ffd4a0 0%, #b04c12 100%)",
  "linear-gradient(135deg, #ffb460 0%, #8e3a0d 100%)",
  "linear-gradient(135deg, #ff922a 0%, #3d1504 100%)",
  "linear-gradient(135deg, #fff7ee 0%, #ff922a 52%, #702d0a 100%)",
  "linear-gradient(135deg, #ffecd4 0%, #f08030 48%, #8e3a0d 100%)",
  "linear-gradient(135deg, #ffd4a0 0%, #d4651a 55%, #3d1504 100%)",
] as const;

export const CAPTION_ANIMATION_OPTIONS: Array<{
  value: AutoCaptionAnimation;
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "rise", label: "Rise" },
  { value: "pop", label: "Pop" },
];

export const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
  { depth: 1, label: "1.25×" },
  { depth: 2, label: "1.5×" },
  { depth: 3, label: "1.8×" },
  { depth: 4, label: "2.2×" },
  { depth: 5, label: "3.5×" },
  { depth: 6, label: "5×" },
];

export const WEBCAM_POSITION_PRESETS: Array<{
  preset: Exclude<WebcamPositionPreset, "custom">;
  label: string;
}> = [
  { preset: "top-left", label: "↖" },
  { preset: "top-center", label: "↑" },
  { preset: "top-right", label: "↗" },
  { preset: "center-left", label: "←" },
  { preset: "center", label: "•" },
  { preset: "center-right", label: "→" },
  { preset: "bottom-left", label: "↙" },
  { preset: "bottom-center", label: "↓" },
  { preset: "bottom-right", label: "↘" },
];

export type CursorStyleOption = { value: CursorStyle; label: string };

export type WallpaperTile = {
  key: string;
  label: string;
  value: string;
  previewUrl: string;
};

export const BUILTIN_CURSOR_STYLE_OPTIONS: CursorStyleOption[] = [
  { value: "macos", label: "macOS" },
  { value: "tahoe", label: "Tahoe" },
  { value: "tahoe-inverted", label: "Tahoe Inverted" },
  { value: "dot", label: "Dot" },
  { value: "figma", label: "Minimal" },
];

export const CAPTION_LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto Detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "zh", label: "Chinese (Simplified)" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
] as const;

export const APP_LANGUAGE_LABELS: Record<AppLocale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  nl: "Nederlands",
  ko: "한국어",
  "pt-BR": "Português",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
};
