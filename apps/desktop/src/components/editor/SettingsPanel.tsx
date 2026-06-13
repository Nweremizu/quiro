import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ColorPickerIcon as IconPalette,
  Delete02Icon as Trash2,
} from "@/components/icons";
import { useTheme } from "@/contexts/theme-provider";
import { cn } from "@/lib/utils";
import {
  getAssetPath,
  getRenderableAssetUrl,
  getRenderableVideoUrl,
  getWallpaperThumbnailUrl,
} from "@/lib/assetPath";
import {
  BUILT_IN_WALLPAPERS,
  type BuiltInWallpaper,
  getAvailableWallpapers,
  isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { extensionHost } from "@/lib/extensions/extensionHost";
import { cursorSetAssets } from "./videoPlayback/uploadedCursorAssets";
import {
  getWebcamPositionForPreset,
  normalizeWebcamCropRegion,
  resolveWebcamCorner,
} from "./utils/webcam-overlay";
import type { FrameInstance } from "@/lib/extensions/types";
import { type AspectRatio } from "@electron/utils/aspectRatioUtils";
import minimalCursorUrl from "@/assets/cursors/custom/minimal-cursor.svg";
import { useI18n, useScopedT } from "../../contexts/I18nContext";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import {
  CURSOR_MOTION_PRESETS,
  type CursorMotionPresetId,
  getMatchingCursorMotionPresetId,
} from "./utils/cursor-motion-presets";
import {
  loadEditorPreferences,
  saveEditorPreferences,
} from "./utils/editor-preferences";
import Scrubber from "@/components/ui/scrubber";
import { SectionLabel } from "@/components/editor/settings-panel/SectionLabel";
import type {
  AnnotationRegion,
  AnnotationAnimationSettings,
  AnnotationType,
  AutoCaptionSettings,
  CaptionCue,
  CropRegion,
  CursorClickEffectSettings,
  CursorStyle,
  EditorEffectSection,
  FigureData,
  Padding,
  WebcamOverlaySettings,
  WebcamPositionPreset,
  ZoomDepth,
  ZoomMode,
  ZoomMotionBlurTuning,
  ZoomPresetId,
  ZoomRegion,
  ZoomTransitionEasing,
} from "@/types/editor";
import {
  DEFAULT_AUTO_CAPTION_SETTINGS,
  DEFAULT_CROP_REGION,
  DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
  DEFAULT_CURSOR_CLICK_EFFECT,
  DEFAULT_CURSOR_MOTION_BLUR,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_CURSOR_SWAY,
  DEFAULT_PADDING,
  DEFAULT_WEBCAM_POSITION_PRESET,
  DEFAULT_WEBCAM_POSITION_X,
  DEFAULT_WEBCAM_POSITION_Y,
  DEFAULT_ZOOM_IN_DURATION_MS,
  DEFAULT_ZOOM_OUT_DURATION_MS,
  DEFAULT_ZOOM_MOTION_BLUR_TUNING,
} from "@/types/editor";
import type { ProjectSnapshot } from "@/components/editor/utils/project-persistance";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_LANGUAGE_OPTIONS,
} from "@/components/editor/settings-panel/constants";
import { ExtensionSettingsSection } from "@/components/editor/settings-panel/ExtensionSettingsSection";
import { SettingsSection as PanelSettingsSection } from "@/components/editor/settings-panel/SettingsSection";
import { ClipSection as PanelClipSection } from "@/components/editor/settings-panel/ClipSection";
import { BackgroundSection as PanelBackgroundSection } from "@/components/editor/settings-panel/background/BackgroundSection";
import { FrameSection as PanelFrameSection } from "@/components/editor/settings-panel/sections/FrameSection";
import { CropSection as PanelCropSection } from "@/components/editor/settings-panel/sections/CropSection";
import { CaptionsSection as PanelCaptionsSection } from "@/components/editor/settings-panel/sections/CaptionsSection";
import { ZoomSection as PanelZoomSection } from "@/components/editor/settings-panel/sections/ZoomSection";
import { CursorSection as PanelCursorSection } from "@/components/editor/settings-panel/sections/CursorSection";
import { WebcamSection as PanelWebcamSection } from "@/components/editor/settings-panel/sections/WebcamSection";
import { LayersSection as PanelLayersSection } from "@/components/editor/settings-panel/sections/LayersSection";
import { isZeroPadding } from "@/components/editor/settings-panel/background";

const tahoeCursorUrl = cursorSetAssets.tahoe.arrow.url;

interface SettingsPanelProps {
  panelMode?: "editor" | "background";
  activeEffectSection?: EditorEffectSection;
  selected: string;
  onWallpaperChange: (path: string) => void;
  selectedZoomDepth?: ZoomDepth | null;
  onZoomDepthChange?: (depth: ZoomDepth) => void;
  selectedZoomId?: string | null;
  selectedZoomMode?: ZoomMode | null;
  selectedZoomPresetId?: ZoomPresetId | null;
  onZoomModeChange?: (mode: ZoomMode) => void;
  onZoomPresetChange?: (presetId: ZoomPresetId) => void;
  onZoomVisibilityChange?: (id: string, enabled: boolean) => void;
  onZoomDelete?: (id: string) => void;
  selectedClipId?: string | null;
  selectedClipSpeed?: number | null;
  selectedClipMuted?: boolean | null;
  onClipSpeedChange?: (speed: number) => void;
  onClipMutedChange?: (muted: boolean) => void;
  onClipDelete?: (id: string) => void;
  selectedAudioId?: string | null;
  selectedAudioVolume?: number | null;
  onAudioVolumeChange?: (volume: number) => void;
  onAudioDelete?: (id: string) => void;
  shadowIntensity?: number;
  onShadowChange?: (intensity: number) => void;
  backgroundBlur?: number;
  onBackgroundBlurChange?: (amount: number) => void;
  zoomMotionBlurTuning?: ZoomMotionBlurTuning;
  onZoomMotionBlurTuningChange?: (tuning: ZoomMotionBlurTuning) => void;
  zoomTemporalMotionBlur?: number;
  onZoomTemporalMotionBlurChange?: (amount: number) => void;
  zoomMotionBlurSampleCount?: number | null;
  onZoomMotionBlurSampleCountChange?: (count: number | null) => void;
  zoomMotionBlurShutterFraction?: number | null;
  onZoomMotionBlurShutterFractionChange?: (fraction: number | null) => void;
  connectZooms?: boolean;
  onConnectZoomsChange?: (enabled: boolean) => void;
  autoApplyFreshRecordingAutoZooms?: boolean;
  onAutoApplyFreshRecordingAutoZoomsChange?: (enabled: boolean) => void;
  zoomInDurationMs?: number;
  onZoomInDurationMsChange?: (duration: number) => void;
  zoomInOverlapMs?: number;
  onZoomInOverlapMsChange?: (duration: number) => void;
  zoomOutDurationMs?: number;
  onZoomOutDurationMsChange?: (duration: number) => void;
  connectedZoomGapMs?: number;
  onConnectedZoomGapMsChange?: (duration: number) => void;
  connectedZoomDurationMs?: number;
  onConnectedZoomDurationMsChange?: (duration: number) => void;
  zoomInEasing?: ZoomTransitionEasing;
  onZoomInEasingChange?: (easing: ZoomTransitionEasing) => void;
  zoomOutEasing?: ZoomTransitionEasing;
  onZoomOutEasingChange?: (easing: ZoomTransitionEasing) => void;
  connectedZoomEasing?: ZoomTransitionEasing;
  onConnectedZoomEasingChange?: (easing: ZoomTransitionEasing) => void;
  showCursor?: boolean;
  onShowCursorChange?: (enabled: boolean) => void;
  loopCursor?: boolean;
  onLoopCursorChange?: (enabled: boolean) => void;
  cursorStyle?: CursorStyle;
  onCursorStyleChange?: (style: CursorStyle) => void;
  cursorSize?: number;
  onCursorSizeChange?: (size: number) => void;
  cursorSmoothing?: number;
  onCursorSmoothingChange?: (smoothing: number) => void;
  cursorSpringStiffnessMultiplier?: number;
  onCursorSpringStiffnessMultiplierChange?: (multiplier: number) => void;
  cursorSpringDampingMultiplier?: number;
  onCursorSpringDampingMultiplierChange?: (multiplier: number) => void;
  cursorSpringMassMultiplier?: number;
  onCursorSpringMassMultiplierChange?: (multiplier: number) => void;
  cameraSpringStiffnessMultiplier?: number;
  onCameraSpringStiffnessMultiplierChange?: (multiplier: number) => void;
  cameraSpringDampingMultiplier?: number;
  onCameraSpringDampingMultiplierChange?: (multiplier: number) => void;
  cameraSpringMassMultiplier?: number;
  onCameraSpringMassMultiplierChange?: (multiplier: number) => void;
  zoomClassicMode?: boolean;
  onZoomClassicModeChange?: (enabled: boolean) => void;
  cursorMotionBlur?: number;
  onCursorMotionBlurChange?: (amount: number) => void;
  cursorClickBounce?: number;
  onCursorClickBounceChange?: (amount: number) => void;
  cursorClickBounceDuration?: number;
  onCursorClickBounceDurationChange?: (duration: number) => void;
  cursorClickEffect?: CursorClickEffectSettings;
  onCursorClickEffectChange?: (effect: CursorClickEffectSettings) => void;
  cursorSway?: number;
  onCursorSwayChange?: (amount: number) => void;
  borderRadius?: number;
  onBorderRadiusChange?: (radius: number) => void;
  webcam?: WebcamOverlaySettings;
  webcamPreviewSrc?: string | null;
  webcamPreviewCurrentTime?: number;
  webcamPreviewPlaying?: boolean;
  onWebcamChange?: (webcam: WebcamOverlaySettings) => void;
  onUploadWebcam?: () => void;
  onClearWebcam?: () => void;
  padding?: Padding;
  onPaddingChange?: (padding: Padding) => void;
  frame?: string | null;
  onFrameChange?: (frameId: string | null) => void;
  cropRegion?: CropRegion;
  onCropChange?: (region: CropRegion) => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange?: (ratio: AspectRatio) => void;
  selectedAnnotationId?: string | null;
  zoomRegions?: ZoomRegion[];
  annotationRegions?: AnnotationRegion[];
  projectSnapshots?: ProjectSnapshot[];
  onCreateProjectSnapshot?: () => void;
  onRestoreProjectSnapshot?: (id: string) => void;
  onAnnotationVisibilityChange?: (id: string, visible: boolean) => void;
  onAnnotationReorder?: (id: string, direction: "up" | "down") => void;
  onAnnotationOpacityChange?: (id: string, opacity: number) => void;
  onAnnotationScaleChange?: (id: string, scale: number) => void;
  onAnnotationAnimationChange?: (
    id: string,
    animation: AnnotationAnimationSettings,
  ) => void;
  onAnnotationAddKeyframe?: (id: string) => void;
  onAnnotationDeleteKeyframe?: (id: string, keyframeId: string) => void;
  onAnnotationContentChange?: (id: string, content: string) => void;
  onAnnotationTypeChange?: (id: string, type: AnnotationType) => void;
  onAnnotationStyleChange?: (
    id: string,
    style: Partial<AnnotationRegion["style"]>,
  ) => void;
  onAnnotationFigureDataChange?: (id: string, figureData: FigureData) => void;
  onAnnotationBlurIntensityChange?: (id: string, intensity: number) => void;
  onAnnotationBlurColorChange?: (id: string, color: string) => void;
  onAnnotationDelete?: (id: string) => void;
  autoCaptions?: CaptionCue[];
  autoCaptionSettings?: AutoCaptionSettings;
  whisperExecutablePath?: string | null;
  whisperModelPath?: string | null;
  whisperModelDownloadStatus?: "idle" | "downloading" | "downloaded" | "error";
  whisperModelDownloadProgress?: number;
  isGeneratingCaptions?: boolean;
  onAutoCaptionSettingsChange?: (settings: AutoCaptionSettings) => void;
  onPickWhisperExecutable?: () => void;
  onPickWhisperModel?: () => void;
  onGenerateAutoCaptions?: () => void;
  onClearAutoCaptions?: () => void;
  onDownloadWhisperSmallModel?: () => void;
  onDeleteWhisperSmallModel?: () => void;
  nativeCaptureUnavailableSession?: boolean;
  onOpenNativeCaptureUnavailableModal?: () => void;
}

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
  { depth: 1, label: "1.25×" },
  { depth: 2, label: "1.5×" },
  { depth: 3, label: "1.8×" },
  { depth: 4, label: "2.2×" },
  { depth: 5, label: "3.5×" },
  { depth: 6, label: "5×" },
];

const WEBCAM_POSITION_PRESETS: Array<{
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

type CursorStyleOption = { value: CursorStyle; label: string };

type WallpaperTile = {
  key: string;
  label: string;
  value: string;
  previewUrl: string;
};

const BUILTIN_CURSOR_STYLE_OPTIONS: CursorStyleOption[] = [
  { value: "macos", label: "macOS" },
  { value: "tahoe", label: "Tahoe" },
  { value: "tahoe-inverted", label: "Tahoe Inverted" },
  { value: "dot", label: "Dot" },
  { value: "figma", label: "Minimal" },
];

function loadPreviewImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Failed to load preview asset: ${url}`));
    image.src = url;
  });
}

function trimCanvasToAlpha(
  canvas: HTMLCanvasElement,
  hotspot?: { x: number; y: number },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      hotspot,
    };
  }

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha === 0) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width,
      height,
      hotspot,
    };
  }

  const croppedWidth = maxX - minX + 1;
  const croppedHeight = maxY - minY + 1;
  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = croppedWidth;
  croppedCanvas.height = croppedHeight;
  const croppedCtx = croppedCanvas.getContext("2d")!;
  croppedCtx.drawImage(
    canvas,
    minX,
    minY,
    croppedWidth,
    croppedHeight,
    0,
    0,
    croppedWidth,
    croppedHeight,
  );

  return {
    dataUrl: croppedCanvas.toDataURL("image/png"),
    width: croppedWidth,
    height: croppedHeight,
    hotspot: hotspot
      ? {
          x: hotspot.x - minX,
          y: hotspot.y - minY,
        }
      : undefined,
  };
}

async function createTrimmedSvgPreview(
  url: string,
  sampleSize: number,
  trim?: { x: number; y: number; width: number; height: number },
) {
  const image = await loadPreviewImage(url);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sampleSize;
  sourceCanvas.height = sampleSize;
  const sourceCtx = sourceCanvas.getContext("2d")!;
  sourceCtx.drawImage(image, 0, 0, sampleSize, sampleSize);

  if (trim) {
    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = trim.width;
    croppedCanvas.height = trim.height;
    const croppedCtx = croppedCanvas.getContext("2d")!;
    croppedCtx.drawImage(
      sourceCanvas,
      trim.x,
      trim.y,
      trim.width,
      trim.height,
      0,
      0,
      trim.width,
      trim.height,
    );
    return croppedCanvas.toDataURL("image/png");
  }

  return trimCanvasToAlpha(sourceCanvas).dataUrl;
}

async function createInvertedPreview(url: string) {
  const image = await loadPreviewImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) {
      continue;
    }
    data[index] = 255 - data[index];
    data[index + 1] = 255 - data[index + 1];
    data[index + 2] = 255 - data[index + 2];
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function SettingsPanelImpl({
  panelMode = "editor",
  activeEffectSection: activeEffectSectionProp,
  selected,
  onWallpaperChange,
  selectedZoomDepth,
  onZoomDepthChange,
  selectedZoomId,
  selectedZoomMode,
  selectedZoomPresetId,
  onZoomModeChange,
  onZoomPresetChange,
  onZoomVisibilityChange,
  onZoomDelete,
  selectedClipId,
  selectedClipSpeed,
  selectedClipMuted,
  onClipSpeedChange,
  onClipMutedChange,
  onClipDelete,
  selectedAudioId,
  selectedAudioVolume,
  onAudioVolumeChange,
  onAudioDelete,
  shadowIntensity = 0.67,
  onShadowChange,
  backgroundBlur = 0,
  onBackgroundBlurChange,
  zoomMotionBlurTuning = DEFAULT_ZOOM_MOTION_BLUR_TUNING,
  onZoomMotionBlurTuningChange,
  connectZooms = true,
  onConnectZoomsChange,
  autoApplyFreshRecordingAutoZooms = true,
  onAutoApplyFreshRecordingAutoZoomsChange,
  zoomInDurationMs = DEFAULT_ZOOM_IN_DURATION_MS,
  onZoomInDurationMsChange,
  zoomOutDurationMs = DEFAULT_ZOOM_OUT_DURATION_MS,
  onZoomOutDurationMsChange,
  showCursor = false,
  onShowCursorChange,
  loopCursor = false,
  onLoopCursorChange,
  cursorStyle = DEFAULT_CURSOR_STYLE,
  onCursorStyleChange,
  cursorSize = 5,
  onCursorSizeChange,
  cursorSmoothing = 2,
  onCursorSmoothingChange,
  cursorSpringStiffnessMultiplier = 1,
  onCursorSpringStiffnessMultiplierChange,
  cursorSpringDampingMultiplier = 1,
  onCursorSpringDampingMultiplierChange,
  cursorSpringMassMultiplier = 1,
  onCursorSpringMassMultiplierChange,
  cameraSpringStiffnessMultiplier = 1,
  onCameraSpringStiffnessMultiplierChange,
  cameraSpringDampingMultiplier = 1.13,
  onCameraSpringDampingMultiplierChange,
  cameraSpringMassMultiplier = 1.12,
  onCameraSpringMassMultiplierChange,
  zoomClassicMode = false,
  onZoomClassicModeChange,
  cursorMotionBlur = DEFAULT_CURSOR_MOTION_BLUR,
  onCursorMotionBlurChange,
  cursorClickBounce = 1,
  onCursorClickBounceChange,
  cursorClickBounceDuration = DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
  onCursorClickBounceDurationChange,
  cursorClickEffect = DEFAULT_CURSOR_CLICK_EFFECT,
  onCursorClickEffectChange,
  cursorSway = DEFAULT_CURSOR_SWAY,
  onCursorSwayChange,
  borderRadius = 12.5,
  onBorderRadiusChange,
  webcam,
  webcamPreviewSrc = null,
  webcamPreviewCurrentTime = 0,
  webcamPreviewPlaying = false,
  onWebcamChange,
  onUploadWebcam,
  onClearWebcam,
  padding = DEFAULT_PADDING,
  onPaddingChange,
  frame = null,
  onFrameChange,
  cropRegion,
  onCropChange,
  aspectRatio,
  onAspectRatioChange,
  selectedAnnotationId,
  zoomRegions = [],
  annotationRegions = [],
  projectSnapshots = [],
  onCreateProjectSnapshot,
  onRestoreProjectSnapshot,
  onAnnotationVisibilityChange,
  onAnnotationReorder,
  onAnnotationOpacityChange,
  onAnnotationScaleChange,
  onAnnotationAnimationChange,
  onAnnotationAddKeyframe,
  onAnnotationDeleteKeyframe,
  onAnnotationContentChange,
  onAnnotationTypeChange,
  onAnnotationStyleChange,
  onAnnotationFigureDataChange,
  onAnnotationBlurIntensityChange,
  onAnnotationBlurColorChange,
  onAnnotationDelete,
  autoCaptions = [],
  autoCaptionSettings = DEFAULT_AUTO_CAPTION_SETTINGS,
  whisperModelPath,
  whisperModelDownloadStatus = "idle",
  whisperModelDownloadProgress = 0,
  isGeneratingCaptions = false,
  onAutoCaptionSettingsChange,
  onPickWhisperModel,
  onGenerateAutoCaptions,
  onClearAutoCaptions,
  onDownloadWhisperSmallModel,
  onDeleteWhisperSmallModel,
  nativeCaptureUnavailableSession = false,
  onOpenNativeCaptureUnavailableModal,
}: SettingsPanelProps) {
  const tSettings = useScopedT("settings");
  const { locale, setLocale, t } = useI18n();
  const { preference: themePreference, setPreference: setThemePreference } =
    useTheme();
  const isBackgroundPanel = panelMode === "background";
  const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
  const [builtInWallpapers, setBuiltInWallpapers] =
    useState<BuiltInWallpaper[]>(BUILT_IN_WALLPAPERS);
  const [extensionWallpapers, setExtensionWallpapers] = useState<
    ReturnType<typeof extensionHost.getContributedWallpapers>
  >([]);
  const [wallpaperPreviewPaths, setWallpaperPreviewPaths] = useState<string[]>(
    [],
  );
  const [extensionWallpaperPreviewUrls, setExtensionWallpaperPreviewUrls] =
    useState<Record<string, string>>({});
  const [customImages, setCustomImages] = useState<string[]>(
    initialEditorPreferences.customWallpapers,
  );
  const removeBackgroundStateRef = useRef<{
    aspectRatio: AspectRatio;
    padding: Padding;
  } | null>(null);
  const builtInWallpaperPaths = useMemo(
    () => builtInWallpapers.map((wallpaper) => wallpaper.publicPath),
    [builtInWallpapers],
  );
  const extensionWallpaperPaths = useMemo(
    () => extensionWallpapers.map((wallpaper) => wallpaper.resolvedUrl),
    [extensionWallpapers],
  );
  const captionCueCount = autoCaptions.length;
  const updateAutoCaptionSettings = (partial: Partial<AutoCaptionSettings>) => {
    onAutoCaptionSettingsChange?.({
      ...autoCaptionSettings,
      ...partial,
    });
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const availableWallpapers = await getAvailableWallpapers();
        const resolved = await Promise.all(
          availableWallpapers.map(async (wallpaper) => {
            const assetUrl = await getAssetPath(wallpaper.relativePath);
            // Use tiny thumbnails for the grid; full-res loads on selection
            if (isVideoWallpaperSource(wallpaper.publicPath)) {
              return getRenderableVideoUrl(assetUrl);
            }
            return getWallpaperThumbnailUrl(assetUrl);
          }),
        );
        if (mounted) {
          setBuiltInWallpapers(availableWallpapers);
          setWallpaperPreviewPaths(resolved);
        }
      } catch {
        if (mounted) {
          setBuiltInWallpapers(BUILT_IN_WALLPAPERS);
          setWallpaperPreviewPaths(
            BUILT_IN_WALLPAPERS.map((wallpaper) => wallpaper.publicPath),
          );
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const updateExtensionAssets = async () => {
      const wallpapers = extensionHost.getContributedWallpapers();
      const cursorStyles = extensionHost.getContributedCursorStyles();
      const [wallpaperPreviewEntries, cursorPreviewEntries] = await Promise.all(
        [
          Promise.all(
            wallpapers.map(
              async (wallpaper) =>
                [
                  wallpaper.id,
                  isVideoWallpaperSource(wallpaper.resolvedThumbnailUrl)
                    ? wallpaper.resolvedThumbnailUrl
                    : await getWallpaperThumbnailUrl(
                        wallpaper.resolvedThumbnailUrl,
                      ),
                ] as const,
            ),
          ),
          Promise.all(
            cursorStyles.map(
              async (cursorStyle) =>
                [
                  cursorStyle.id,
                  await getRenderableAssetUrl(cursorStyle.resolvedDefaultUrl),
                ] as const,
            ),
          ),
        ],
      );

      if (cancelled) {
        return;
      }

      setExtensionWallpapers(wallpapers);
      setExtensionWallpaperPreviewUrls(
        Object.fromEntries(wallpaperPreviewEntries),
      );
      setExtensionCursorStyles(cursorStyles);
      setExtensionCursorPreviewUrls(Object.fromEntries(cursorPreviewEntries));
    };

    void extensionHost.autoActivateBuiltins().then(updateExtensionAssets);
    const unsubscribe = extensionHost.onChange(() => {
      void updateExtensionAssets();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  const removeBackgroundEnabled =
    aspectRatio === "native" && isZeroPadding(padding);

  // Device frames from extension system
  const [availableFrames, setAvailableFrames] = useState<FrameInstance[]>([]);
  useEffect(() => {
    const update = () => setAvailableFrames(extensionHost.getFrames());
    update();
    return extensionHost.onChange(update);
  }, []);

  // Extension-contributed settings panels
  const [extensionPanels, setExtensionPanels] = useState<
    ReturnType<typeof extensionHost.getSettingsPanels>
  >([]);
  useEffect(() => {
    const update = () => setExtensionPanels(extensionHost.getSettingsPanels());
    update();
    return extensionHost.onChange(update);
  }, []);

  const renderExtensionPanelsForSections = (...sections: string[]) =>
    extensionPanels
      .filter((panel) => {
        const parentSection = panel.panel.parentSection;
        return parentSection ? sections.includes(parentSection) : false;
      })
      .map((panel) => (
        <ExtensionSettingsSection
          key={`${panel.extensionId}/${panel.panel.id}`}
          extensionId={panel.extensionId}
          label={panel.panel.label}
          fields={panel.panel.fields}
        />
      ));

  const defaultWebcam = initialEditorPreferences.webcam;
  const [internalActiveEffectSection] = useState<EditorEffectSection>("scene");
  const activeEffectSection =
    activeEffectSectionProp ?? internalActiveEffectSection;
  const [extensionCursorStyles, setExtensionCursorStyles] = useState<
    ReturnType<typeof extensionHost.getContributedCursorStyles>
  >([]);
  const [builtInCursorPreviewUrls, setBuiltInCursorPreviewUrls] = useState<
    Partial<Record<string, string>>
  >({});
  const [extensionCursorPreviewUrls, setExtensionCursorPreviewUrls] = useState<
    Partial<Record<string, string>>
  >({});
  const cursorPreviewUrls = useMemo(
    () => ({ ...builtInCursorPreviewUrls, ...extensionCursorPreviewUrls }),
    [builtInCursorPreviewUrls, extensionCursorPreviewUrls],
  );
  const showDevMotionControls = import.meta.env.DEV;
  const cursorStyleOptions = useMemo<CursorStyleOption[]>(
    () => [
      ...BUILTIN_CURSOR_STYLE_OPTIONS,
      ...extensionCursorStyles.map((cursorStyle) => ({
        value: cursorStyle.id as CursorStyle,
        label: cursorStyle.cursorStyle.label,
      })),
    ],
    [extensionCursorStyles],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const macosPreview = cursorSetAssets.macos.arrow.url;
        const tahoePreview = cursorSetAssets.tahoe.arrow.url;
        const minimalPreview = await createTrimmedSvgPreview(
          minimalCursorUrl,
          512,
        );
        const invertedPreview = await createInvertedPreview(tahoePreview);

        if (!cancelled) {
          setBuiltInCursorPreviewUrls({
            macos: macosPreview,
            tahoe: tahoePreview,
            figma: minimalPreview,
            "tahoe-inverted": invertedPreview,
          });
        }
      } catch {
        if (!cancelled) {
          setBuiltInCursorPreviewUrls({
            macos: tahoeCursorUrl,
            tahoe: tahoeCursorUrl,
            figma: minimalCursorUrl,
            "tahoe-inverted": tahoeCursorUrl,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selected.startsWith("data:image") && !customImages.includes(selected)) {
      setCustomImages((prev) => [selected, ...prev]);
    }

    const isKnownWallpaper =
      builtInWallpaperPaths.includes(selected) ||
      wallpaperPreviewPaths.includes(selected) ||
      extensionWallpaperPaths.includes(selected);

    if (
      !isKnownWallpaper &&
      isVideoWallpaperSource(selected) &&
      !customImages.includes(selected)
    ) {
      setCustomImages((prev) => [selected, ...prev]);
    }
  }, [
    builtInWallpaperPaths,
    customImages,
    extensionWallpaperPaths,
    selected,
    wallpaperPreviewPaths,
  ]);

  const imageWallpaperTiles = useMemo<WallpaperTile[]>(() => {
    const imageWallpapers = builtInWallpapers.filter(
      (wallpaper) => !isVideoWallpaperSource(wallpaper.publicPath),
    );
    const builtInTiles = (
      wallpaperPreviewPaths.length > 0
        ? wallpaperPreviewPaths
        : builtInWallpaperPaths
    )
      .filter((path) => !isVideoWallpaperSource(path))
      .map((previewPath, index) => {
        const wallpaper = imageWallpapers[index];
        return {
          key: wallpaper ? `builtin/${wallpaper.id}` : previewPath,
          label: wallpaper?.label ?? `Wallpaper ${index + 1}`,
          value: wallpaper?.publicPath ?? previewPath,
          previewUrl: previewPath,
        };
      });

    const extensionTiles = extensionWallpapers
      .filter((wallpaper) => !isVideoWallpaperSource(wallpaper.resolvedUrl))
      .map((wallpaper) => ({
        key: wallpaper.id,
        label: wallpaper.wallpaper.label,
        value: wallpaper.resolvedUrl,
        previewUrl:
          extensionWallpaperPreviewUrls[wallpaper.id] ??
          wallpaper.resolvedThumbnailUrl,
      }));

    return [...builtInTiles, ...extensionTiles];
  }, [
    builtInWallpaperPaths,
    builtInWallpapers,
    extensionWallpaperPreviewUrls,
    extensionWallpapers,
    wallpaperPreviewPaths,
  ]);

  const videoWallpaperTiles = useMemo<WallpaperTile[]>(() => {
    const builtInTiles = builtInWallpapers
      .filter((wallpaper) => isVideoWallpaperSource(wallpaper.publicPath))
      .map((wallpaper) => ({
        key: `builtin/${wallpaper.id}`,
        label: wallpaper.label,
        value: wallpaper.publicPath,
        previewUrl: wallpaper.publicPath,
      }));

    const extensionTiles = extensionWallpapers
      .filter((wallpaper) => isVideoWallpaperSource(wallpaper.resolvedUrl))
      .map((wallpaper) => ({
        key: wallpaper.id,
        label: wallpaper.wallpaper.label,
        value: wallpaper.resolvedUrl,
        previewUrl:
          extensionWallpaperPreviewUrls[wallpaper.id] ??
          wallpaper.resolvedThumbnailUrl,
      }));

    return [...builtInTiles, ...extensionTiles];
  }, [builtInWallpapers, extensionWallpaperPreviewUrls, extensionWallpapers]);

  useEffect(() => {
    saveEditorPreferences({ customWallpapers: customImages });
  }, [customImages]);

  const handleRemoveBackgroundToggle = (checked: boolean) => {
    if (checked) {
      removeBackgroundStateRef.current = {
        aspectRatio,
        padding,
      };
      onAspectRatioChange?.("native");
      onPaddingChange?.({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        linked: padding.linked,
      });
      return;
    }

    const previousState = removeBackgroundStateRef.current;
    if (previousState) {
      onAspectRatioChange?.(previousState.aspectRatio);
      onPaddingChange?.(previousState.padding);
      removeBackgroundStateRef.current = null;
      return;
    }

    // Fallback if the project loaded in a "background removed" state already
    onAspectRatioChange?.(initialEditorPreferences.aspectRatio);
    onPaddingChange?.({ ...DEFAULT_PADDING });
  };

  const togglePaddingLink = () => {
    const isLinked = padding.linked !== false;
    const nextLinked = !isLinked;
    if (nextLinked) {
      // Compute average for relinking to avoid sudden shifts
      const avg = Math.round(
        (padding.top + padding.bottom + padding.left + padding.right) / 4,
      );
      onPaddingChange?.({
        top: avg,
        bottom: avg,
        left: avg,
        right: avg,
        linked: true,
      });
    } else {
      onPaddingChange?.({
        ...padding,
        linked: false,
      });
    }
  };

  const handlePaddingSideChange = (side: keyof Padding, value: number) => {
    if (padding.linked !== false) {
      onPaddingChange?.({
        top: value,
        bottom: value,
        left: value,
        right: value,
        linked: true,
      });
    } else {
      onPaddingChange?.({
        ...padding,
        [side]: value,
      });
    }
  };

  const webcamFileName = webcam?.sourcePath?.split(/[\\/]/).pop() ?? null;
  const webcamPositionPreset =
    webcam?.positionPreset ?? DEFAULT_WEBCAM_POSITION_PRESET;
  const webcamPositionX = webcam?.positionX ?? DEFAULT_WEBCAM_POSITION_X;
  const webcamPositionY = webcam?.positionY ?? DEFAULT_WEBCAM_POSITION_Y;
  const webcamCrop = normalizeWebcamCropRegion(webcam?.cropRegion);

  const crop = cropRegion ?? {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };
  const cropTop = Math.round(crop.y * 100);
  const cropLeft = Math.round(crop.x * 100);
  const cropBottom = Math.round((1 - crop.y - crop.height) * 100);
  const cropRight = Math.round((1 - crop.x - crop.width) * 100);
  const isCropped =
    cropTop > 0 || cropLeft > 0 || cropBottom > 0 || cropRight > 0;

  const setCropInset = (
    side: "top" | "bottom" | "left" | "right",
    pct: number,
  ) => {
    if (!onCropChange) return;

    const v = pct / 100;
    let { x, y, width, height } = crop;

    if (side === "top") {
      const nextY = Math.min(v, 1 - y - height + v);
      y = nextY;
      height = Math.max(0.05, height - (nextY - crop.y));
    }

    if (side === "left") {
      const nextX = Math.min(v, 1 - x - width + v);
      x = nextX;
      width = Math.max(0.05, width - (nextX - crop.x));
    }

    if (side === "bottom") {
      height = Math.max(0.05, 1 - crop.y - v);
    }

    if (side === "right") {
      width = Math.max(0.05, 1 - crop.x - v);
    }

    onCropChange({ x, y, width, height });
  };

  const resetZoomSection = () => {
    onZoomMotionBlurTuningChange?.(
      initialEditorPreferences.zoomMotionBlurTuning,
    );
    onCameraSpringStiffnessMultiplierChange?.(
      initialEditorPreferences.cameraSpringStiffnessMultiplier,
    );
    onCameraSpringDampingMultiplierChange?.(
      initialEditorPreferences.cameraSpringDampingMultiplier,
    );
    onCameraSpringMassMultiplierChange?.(
      initialEditorPreferences.cameraSpringMassMultiplier,
    );
    onZoomInDurationMsChange?.(initialEditorPreferences.zoomInDurationMs);
    onZoomOutDurationMsChange?.(initialEditorPreferences.zoomOutDurationMs);
    onZoomClassicModeChange?.(false);
  };

  const resetCursorSection = () => {
    onShowCursorChange?.(initialEditorPreferences.showCursor);
    onLoopCursorChange?.(initialEditorPreferences.loopCursor);
    onCursorStyleChange?.(initialEditorPreferences.cursorStyle);
    onCursorSizeChange?.(initialEditorPreferences.cursorSize);
    onCursorSmoothingChange?.(initialEditorPreferences.cursorSmoothing);
    onCursorSpringStiffnessMultiplierChange?.(
      initialEditorPreferences.cursorSpringStiffnessMultiplier,
    );
    onCursorSpringDampingMultiplierChange?.(
      initialEditorPreferences.cursorSpringDampingMultiplier,
    );
    onCursorSpringMassMultiplierChange?.(
      initialEditorPreferences.cursorSpringMassMultiplier,
    );
    onCursorMotionBlurChange?.(initialEditorPreferences.cursorMotionBlur);
    onCursorClickBounceChange?.(initialEditorPreferences.cursorClickBounce);
    onCursorClickBounceDurationChange?.(DEFAULT_CURSOR_CLICK_BOUNCE_DURATION);
    onCursorSwayChange?.(initialEditorPreferences.cursorSway);
  };

  const activeMotionPresetId = useMemo(() => {
    return (
      getMatchingCursorMotionPresetId({
        zoomInDurationMs,
        zoomOutDurationMs,
        cursorSize,
        cursorSmoothing,
        cursorSpringStiffnessMultiplier,
        cursorSpringDampingMultiplier,
        cursorSpringMassMultiplier,
        cursorMotionBlur,
        cursorClickBounce,
        cursorClickBounceDuration,
      }) ?? "focused"
    );
  }, [
    cursorClickBounce,
    cursorClickBounceDuration,
    cursorMotionBlur,
    cursorSize,
    cursorSmoothing,
    cursorSpringDampingMultiplier,
    cursorSpringMassMultiplier,
    cursorSpringStiffnessMultiplier,
    zoomInDurationMs,
    zoomOutDurationMs,
  ]);

  const applyMotionPreset = (presetId: CursorMotionPresetId) => {
    const preset = CURSOR_MOTION_PRESETS[presetId];
    onZoomInDurationMsChange?.(preset.zoomInDurationMs);
    onZoomOutDurationMsChange?.(preset.zoomOutDurationMs);
    onCursorSizeChange?.(preset.cursorSize);
    onCursorSmoothingChange?.(preset.cursorSmoothing);
    onCursorSpringStiffnessMultiplierChange?.(
      preset.cursorSpringStiffnessMultiplier,
    );
    onCursorSpringDampingMultiplierChange?.(
      preset.cursorSpringDampingMultiplier,
    );
    onCursorSpringMassMultiplierChange?.(preset.cursorSpringMassMultiplier);
    onCursorMotionBlurChange?.(preset.cursorMotionBlur);
    onCursorClickBounceChange?.(preset.cursorClickBounce);
    onCursorClickBounceDurationChange?.(preset.cursorClickBounceDuration);
  };

  const resetFrameSection = () => {
    onAspectRatioChange?.(initialEditorPreferences.aspectRatio);
    removeBackgroundStateRef.current = null;
  };

  const resetWebcamSection = () => {
    if (!onWebcamChange) return;
    onWebcamChange({ ...defaultWebcam });
  };

  const resetCropSection = () => {
    onCropChange?.(DEFAULT_CROP_REGION);
  };

  const updateWebcam = (patch: Partial<WebcamOverlaySettings>) => {
    if (!webcam || !onWebcamChange) return;
    onWebcamChange({ ...webcam, ...patch });
  };

  const applyWebcamPositionPreset = (preset: WebcamPositionPreset) => {
    if (!webcam) return;

    if (preset === "custom") {
      updateWebcam({ positionPreset: "custom" });
      return;
    }

    const position = getWebcamPositionForPreset(preset);
    updateWebcam({
      positionPreset: preset,
      positionX: position.x,
      positionY: position.y,
      corner: resolveWebcamCorner(preset, webcam.corner),
    });
  };

  // Find selected annotation
  const selectedAnnotation = selectedAnnotationId
    ? annotationRegions.find((a) => a.id === selectedAnnotationId)
    : null;

  const backgroundSettingsContent = (
    <PanelBackgroundSection
      selected={selected}
      onWallpaperChange={onWallpaperChange}
      backgroundBlur={backgroundBlur}
      initialBackgroundBlur={initialEditorPreferences.backgroundBlur}
      onBackgroundBlurChange={onBackgroundBlurChange}
      customImages={customImages}
      setCustomImages={setCustomImages}
      imageWallpaperTiles={imageWallpaperTiles}
      videoWallpaperTiles={videoWallpaperTiles}
    />
  );

  // If an annotation is selected, show annotation settings instead
  if (
    !isBackgroundPanel &&
    selectedAnnotation &&
    onAnnotationContentChange &&
    onAnnotationTypeChange &&
    onAnnotationStyleChange &&
    onAnnotationDelete
  ) {
    return (
      <AnnotationSettingsPanel
        annotation={selectedAnnotation}
        onContentChange={(content) =>
          onAnnotationContentChange(selectedAnnotation.id, content)
        }
        onTypeChange={(type) =>
          onAnnotationTypeChange(selectedAnnotation.id, type)
        }
        onStyleChange={(style) =>
          onAnnotationStyleChange(selectedAnnotation.id, style)
        }
        onFigureDataChange={
          onAnnotationFigureDataChange
            ? (figureData) =>
                onAnnotationFigureDataChange(selectedAnnotation.id, figureData)
            : undefined
        }
        onBlurIntensityChange={
          onAnnotationBlurIntensityChange
            ? (intensity) =>
                onAnnotationBlurIntensityChange(
                  selectedAnnotation.id,
                  intensity,
                )
            : undefined
        }
        onBlurColorChange={
          onAnnotationBlurColorChange
            ? (color) =>
                onAnnotationBlurColorChange(selectedAnnotation.id, color)
            : undefined
        }
        onOpacityChange={
          onAnnotationOpacityChange
            ? (opacity) =>
                onAnnotationOpacityChange(selectedAnnotation.id, opacity)
            : undefined
        }
        onScaleChange={
          onAnnotationScaleChange
            ? (scale) => onAnnotationScaleChange(selectedAnnotation.id, scale)
            : undefined
        }
        onAnimationChange={
          onAnnotationAnimationChange
            ? (animation) =>
                onAnnotationAnimationChange(selectedAnnotation.id, animation)
            : undefined
        }
        onAddKeyframe={
          onAnnotationAddKeyframe
            ? () => onAnnotationAddKeyframe(selectedAnnotation.id)
            : undefined
        }
        onDeleteKeyframe={
          onAnnotationDeleteKeyframe
            ? (keyframeId) =>
                onAnnotationDeleteKeyframe(selectedAnnotation.id, keyframeId)
            : undefined
        }
        onDelete={() => onAnnotationDelete(selectedAnnotation.id)}
      />
    );
  }

  if (isBackgroundPanel) {
    return (
      <div className="flex-[2] w-[332px] min-w-[280px] max-w-[332px] bg-editor-panel rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
        <div
          className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 pb-0"
          style={{ scrollbarGutter: "stable" }}
        >
          <div className="mb-4 flex items-center gap-2">
            <IconPalette className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              {tSettings("background.title")}
            </span>
          </div>
          {backgroundSettingsContent}
        </div>
      </div>
    );
  }

  const frameSectionContent = (
    <PanelFrameSection
      tSettings={tSettings}
      t={t}
      resetFrameSection={resetFrameSection}
      shadowIntensity={shadowIntensity}
      initialShadowDefault={initialEditorPreferences.shadowIntensity}
      onShadowChange={onShadowChange}
      borderRadius={borderRadius}
      initialBorderRadiusDefault={initialEditorPreferences.borderRadius}
      onBorderRadiusChange={onBorderRadiusChange}
      padding={padding}
      togglePaddingLink={togglePaddingLink}
      handlePaddingSideChange={handlePaddingSideChange}
      removeBackgroundEnabled={removeBackgroundEnabled}
      handleRemoveBackgroundToggle={handleRemoveBackgroundToggle}
      availableFrames={availableFrames}
      frame={frame}
      onFrameChange={onFrameChange}
      showDevMotionControls={showDevMotionControls}
    />
  );
  const cropSectionContent = (
    <PanelCropSection
      tSettings={tSettings}
      t={t}
      isCropped={isCropped}
      resetCropSection={resetCropSection}
      cropTop={cropTop}
      cropBottom={cropBottom}
      cropLeft={cropLeft}
      cropRight={cropRight}
      setCropInset={setCropInset}
    />
  );
  const captionsSectionContent = (
    <PanelCaptionsSection
      tSettings={tSettings}
      t={t}
      autoCaptionSettings={autoCaptionSettings}
      updateAutoCaptionSettings={updateAutoCaptionSettings}
      whisperModelPath={whisperModelPath}
      whisperModelDownloadStatus={whisperModelDownloadStatus}
      whisperModelDownloadProgress={whisperModelDownloadProgress}
      onPickWhisperModel={onPickWhisperModel}
      onDeleteWhisperSmallModel={onDeleteWhisperSmallModel}
      onDownloadWhisperSmallModel={onDownloadWhisperSmallModel}
      onClearAutoCaptions={onClearAutoCaptions}
      onGenerateAutoCaptions={onGenerateAutoCaptions}
      isGeneratingCaptions={isGeneratingCaptions}
      captionCueCount={captionCueCount}
      renderExtensionPanelsForSections={renderExtensionPanelsForSections}
      captionLanguageOptions={CAPTION_LANGUAGE_OPTIONS}
      captionAnimationOptions={CAPTION_ANIMATION_OPTIONS}
    />
  );

  const effectSectionContent = (() => {
    const settingsSectionContent = (
      <PanelSettingsSection
        locale={locale}
        setLocale={setLocale}
        t={t}
        tSettings={tSettings}
        themePreference={themePreference}
        setThemePreference={setThemePreference}
        autoApplyFreshRecordingAutoZooms={autoApplyFreshRecordingAutoZooms}
        onAutoApplyFreshRecordingAutoZoomsChange={
          onAutoApplyFreshRecordingAutoZoomsChange
        }
        connectZooms={connectZooms}
        onConnectZoomsChange={onConnectZoomsChange}
        activeMotionPresetId={activeMotionPresetId}
        onApplyMotionPreset={applyMotionPreset}
        showDevMotionControls={showDevMotionControls}
        nativeCaptureUnavailableSession={nativeCaptureUnavailableSession}
        onOpenNativeCaptureUnavailableModal={
          onOpenNativeCaptureUnavailableModal
        }
        zoomMotionBlurTuning={zoomMotionBlurTuning}
        initialZoomMotionBlurTuning={
          initialEditorPreferences.zoomMotionBlurTuning
        }
        onZoomMotionBlurTuningChange={onZoomMotionBlurTuningChange}
        cameraSpringStiffnessMultiplier={cameraSpringStiffnessMultiplier}
        onCameraSpringStiffnessMultiplierChange={
          onCameraSpringStiffnessMultiplierChange
        }
        initialCameraSpringStiffnessMultiplier={
          initialEditorPreferences.cameraSpringStiffnessMultiplier
        }
        cameraSpringDampingMultiplier={cameraSpringDampingMultiplier}
        onCameraSpringDampingMultiplierChange={
          onCameraSpringDampingMultiplierChange
        }
        initialCameraSpringDampingMultiplier={
          initialEditorPreferences.cameraSpringDampingMultiplier
        }
        cameraSpringMassMultiplier={cameraSpringMassMultiplier}
        onCameraSpringMassMultiplierChange={onCameraSpringMassMultiplierChange}
        initialCameraSpringMassMultiplier={
          initialEditorPreferences.cameraSpringMassMultiplier
        }
        cursorSpringStiffnessMultiplier={cursorSpringStiffnessMultiplier}
        onCursorSpringStiffnessMultiplierChange={
          onCursorSpringStiffnessMultiplierChange
        }
        initialCursorSpringStiffnessMultiplier={
          initialEditorPreferences.cursorSpringStiffnessMultiplier
        }
        cursorSpringDampingMultiplier={cursorSpringDampingMultiplier}
        onCursorSpringDampingMultiplierChange={
          onCursorSpringDampingMultiplierChange
        }
        initialCursorSpringDampingMultiplier={
          initialEditorPreferences.cursorSpringDampingMultiplier
        }
        cursorSpringMassMultiplier={cursorSpringMassMultiplier}
        onCursorSpringMassMultiplierChange={onCursorSpringMassMultiplierChange}
        initialCursorSpringMassMultiplier={
          initialEditorPreferences.cursorSpringMassMultiplier
        }
      />
    );

    const sceneSectionContent = (
      <div className="space-y-4">
        {backgroundSettingsContent}
        {frameSectionContent}
        {cropSectionContent}
        {renderExtensionPanelsForSections(
          "scene",
          "appearance",
          "frame",
          "crop",
        )}
      </div>
    );

    const clipSectionContent = (
      <PanelClipSection
        tSettings={tSettings}
        selectedClipId={selectedClipId}
        selectedClipSpeed={selectedClipSpeed}
        selectedClipMuted={selectedClipMuted}
        onClipMutedChange={onClipMutedChange}
        onClipSpeedChange={onClipSpeedChange}
        onClipDelete={onClipDelete}
      />
    );

    if (activeEffectSection === "frame") {
      return frameSectionContent;
    }

    if (activeEffectSection === "crop") {
      return cropSectionContent;
    }

    if (activeEffectSection === "zoom") {
      return (
        <PanelZoomSection
          tSettings={tSettings}
          t={t}
          selectedZoomId={selectedZoomId}
          selectedZoomDepth={selectedZoomDepth}
          selectedZoomMode={selectedZoomMode}
          selectedZoomPresetId={selectedZoomPresetId}
          onZoomModeChange={onZoomModeChange}
          onZoomDepthChange={onZoomDepthChange}
          onZoomPresetChange={onZoomPresetChange}
          resetZoomSection={resetZoomSection}
          zoomClassicMode={zoomClassicMode}
          onZoomClassicModeChange={onZoomClassicModeChange}
          onZoomDelete={onZoomDelete}
          ZOOM_DEPTH_OPTIONS={ZOOM_DEPTH_OPTIONS}
          renderExtensionPanelsForSections={renderExtensionPanelsForSections}
        />
      );
    }

    if (activeEffectSection === "cursor") {
      return (
        <PanelCursorSection
          tSettings={tSettings}
          t={t}
          resetCursorSection={resetCursorSection}
          showCursor={showCursor}
          onShowCursorChange={onShowCursorChange}
          loopCursor={loopCursor}
          onLoopCursorChange={onLoopCursorChange}
          cursorStyle={cursorStyle}
          onCursorStyleChange={onCursorStyleChange}
          cursorStyleOptions={cursorStyleOptions}
          cursorPreviewUrls={cursorPreviewUrls}
          cursorMotionBlur={cursorMotionBlur}
          onCursorMotionBlurChange={onCursorMotionBlurChange}
          cursorClickBounce={cursorClickBounce}
          onCursorClickBounceChange={onCursorClickBounceChange}
          cursorClickBounceDuration={cursorClickBounceDuration}
          onCursorClickBounceDurationChange={onCursorClickBounceDurationChange}
          cursorClickEffect={cursorClickEffect}
          onCursorClickEffectChange={onCursorClickEffectChange}
          cursorSway={cursorSway}
          onCursorSwayChange={onCursorSwayChange}
          showDevMotionControls={showDevMotionControls}
          renderExtensionPanelsForSections={renderExtensionPanelsForSections}
        />
      );
    }

    if (activeEffectSection === "webcam") {
      return (
        <PanelWebcamSection
          tSettings={tSettings}
          t={t}
          resetWebcamSection={resetWebcamSection}
          webcam={webcam}
          webcamCrop={webcamCrop}
          webcamPreviewSrc={webcamPreviewSrc}
          webcamPreviewCurrentTime={webcamPreviewCurrentTime}
          webcamPreviewPlaying={webcamPreviewPlaying}
          updateWebcam={updateWebcam}
          applyWebcamPositionPreset={applyWebcamPositionPreset}
          webcamPositionPreset={webcamPositionPreset}
          webcamPositionX={webcamPositionX}
          webcamPositionY={webcamPositionY}
          webcamFileName={webcamFileName}
          onUploadWebcam={onUploadWebcam}
          onClearWebcam={onClearWebcam}
          WEBCAM_POSITION_PRESETS={WEBCAM_POSITION_PRESETS}
          renderExtensionPanelsForSections={renderExtensionPanelsForSections}
        />
      );
    }

    if (activeEffectSection === "layers") {
      return (
        <PanelLayersSection
          tSettings={tSettings}
          zoomRegions={zoomRegions}
          annotationRegions={annotationRegions}
          autoCaptionSettings={autoCaptionSettings}
          showCursor={showCursor}
          webcam={webcam}
          projectSnapshots={projectSnapshots}
          selectedZoomId={selectedZoomId}
          selectedAnnotationId={selectedAnnotationId}
          onZoomVisibilityChange={onZoomVisibilityChange}
          onAnnotationVisibilityChange={onAnnotationVisibilityChange}
          onAnnotationReorder={onAnnotationReorder}
          onAutoCaptionSettingsChange={onAutoCaptionSettingsChange}
          onShowCursorChange={onShowCursorChange}
          onWebcamChange={onWebcamChange}
          onCreateProjectSnapshot={onCreateProjectSnapshot}
          onRestoreProjectSnapshot={onRestoreProjectSnapshot}
        />
      );
    }

    switch (activeEffectSection as EditorEffectSection) {
      case "settings":
        return settingsSectionContent;
      case "scene":
        return sceneSectionContent;
      case "clip":
        return clipSectionContent;
      case "captions":
        return captionsSectionContent;
      default: {
        // Handle extension-contributed standalone section pages (ext:extensionId/panelId)
        if (activeEffectSection?.startsWith("ext:")) {
          const panels = extensionPanels.filter(
            (p) =>
              !p.panel.parentSection &&
              `ext:${p.extensionId}/${p.panel.id}` === activeEffectSection,
          );
          if (panels.length > 0) {
            const p = panels[0];
            return (
              <section className="flex flex-col gap-2">
                <SectionLabel>{p.panel.label}</SectionLabel>
                <ExtensionSettingsSection
                  extensionId={p.extensionId}
                  label={p.panel.label}
                  fields={p.panel.fields}
                />
              </section>
            );
          }
        }
        return sceneSectionContent;
      }
    }
  })();

  return (
    <div className="scroll flex-2 w-83 min-w-70 max-w-83 bg-editor-panel rounded-2xl flex flex-col  h-full overflow-hidden">
      <div
        className="flex-1 min-h-0 overflow-y-auto scroll p-4 pb-0"
        style={{ scrollbarGutter: "stable" }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeEffectSection}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {effectSectionContent}
          </motion.div>
        </AnimatePresence>
      </div>

      <div
        className={cn(
          "flex-shrink-0 border-t border-foreground/10 bg-editor-header p-4 pt-3",
          !selectedAudioId && "hidden",
        )}
      >
        {selectedAudioId && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {tSettings("audio.volumeTitle", "Audio Volume")}
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                {Math.round((selectedAudioVolume ?? 1) * 100)}%
              </span>
            </div>
            <Scrubber
              label={tSettings("audio.volume", "Volume")}
              value={selectedAudioVolume ?? 1}
              defaultValue={1}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(v) => onAudioVolumeChange?.(v)}
              valueFormatter={(v) => `${Math.round(v * 100)}%`}
            />
            <Button
              onClick={() =>
                selectedAudioId && onAudioDelete?.(selectedAudioId)
              }
              variant="destructive"
              size="sm"
              className="mt-2 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
            >
              <Trash2 className="h-3 w-3" />
              {tSettings("audio.deleteRegion", "Delete Audio")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// The editor passes ~100 props but re-renders far more often than they
// change (selection, undo, region edits all commit the whole window tree).
// Memoizing skips the ~8ms panel render whenever no prop actually changed —
// callers must keep callback props referentially stable.
export const SettingsPanel = memo(SettingsPanelImpl);
