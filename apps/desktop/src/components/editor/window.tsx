/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CropIcon,
  FolderOpenIcon,
  RedoIcon,
  Scissor01Icon,
  VolumeLowIcon,
  VolumeOffIcon,
  VolumeHighIcon,
  MagicWand01Icon,
  AiMagicIcon,
  SearchAddIcon,
  Tick02Icon,
  TimelineListIcon,
  UndoIcon,
} from "@/components/icons";
import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerTrackNextFilled,
  IconPlayerTrackPrevFilled,
} from "@tabler/icons-react";
import type { Span } from "dnd-timeline";
import { motion } from "motion/react";
import {
  Profiler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/shortcut-context";
import { useSystemHealthWarning } from "@/hooks/useSystemHealthWarning";
import { playbackSessionDebug } from "@/lib/playbackSessionDebug";
import { playbackTimeStore } from "@/lib/playbackTimeStore";
import { runFirstDraft } from "@/lib/ai/firstDraft";
import {
  calculateOutputDimensions,
  DEFAULT_MP4_CODEC,
  type ExportBackendPreference,
  type ExportEncodingMode,
  type ExportFormat,
  type ExportMp4FrameRate,
  type ExportPipelineModel,
  type ExportProgress,
  type ExportQuality,
  type ExportSettings,
  FrameRenderer,
  GIF_SIZE_PRESETS,
  GifExporter,
  type GifFrameRate,
  type GifSizePreset,
  ModernVideoExporter,
  probeSupportedMp4Dimensions,
  type SupportedMp4Dimensions,
  VideoExporter,
} from "@/lib/exporter";
import {
  getMp4ExportBitrate,
  getSourceQualityBitrate,
} from "@/lib/exporter/export-bitrate";
import { resolveMediaElementSource } from "@/lib/exporter/local-media-source";
import { resolveSourceAudioFallbackPaths } from "@/lib/exporter/source-audio-fallback";
import {
  clampMediaTimeToDuration,
  enablePitchPreservingPlayback,
  estimateCompanionAudioStartDelaySeconds,
  getMediaSyncPlaybackRate,
} from "@/lib/mediaTiming";
import { matchesShortcut } from "@/lib/shortcuts";
import {
  type AspectRatio,
  getAspectRatioValue,
} from "@electron/utils/aspectRatioUtils";
// import { ExtensionIcon } from "./ExtensionIcon";
import { extensionHost } from "@/lib/extensions";
import {
  type AnnotationRegion,
  type AudioRegion,
  type AutoCaptionSettings,
  type CaptionCue,
  type ClipRegion,
  type CropRegion,
  type CursorStyle,
  type CursorClickEffectSettings,
  type CursorTelemetryPoint,
  type AnnotationKeyframe,
  type AnnotationAnimationSettings,
  clampFocusToDepth,
  clipsToTrims,
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_ANNOTATION_ANIMATION,
  DEFAULT_AUTO_CAPTION_SETTINGS,
  DEFAULT_AUTO_ZOOM_DEPTH,
  DEFAULT_CONNECTED_ZOOM_DURATION_MS,
  DEFAULT_CONNECTED_ZOOM_EASING,
  DEFAULT_CONNECTED_ZOOM_GAP_MS,
  DEFAULT_CROP_REGION,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_CURSOR_CLICK_EFFECT,
  DEFAULT_FIGURE_DATA,
  DEFAULT_OVERLAY_LAYER_ORDER,
  DEFAULT_WEBCAM_OVERLAY,
  DEFAULT_WEBCAM_TIME_OFFSET_MS,
  DEFAULT_ZOOM_IN_DURATION_MS,
  DEFAULT_ZOOM_IN_EASING,
  DEFAULT_ZOOM_IN_OVERLAP_MS,
  DEFAULT_ZOOM_MOTION_BLUR_TUNING,
  DEFAULT_ZOOM_OUT_DURATION_MS,
  DEFAULT_ZOOM_OUT_EASING,
  type EditorEffectSection,
  extendAutoFullTrackClip,
  type FigureData,
  getClipSourceEndMs,
  type Padding,
  type OverlayLayerOrder,
  mapSourceTimeToTimelineTime as resolveSourceTimeToTimelineTime,
  mapTimelineTimeToSourceTime as resolveTimelineTimeToSourceTime,
  type PlaybackSpeed,
  type SpeedRegion,
  type TrimRegion,
  trimsToClips,
  type WebcamOverlaySettings,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomMode,
  type ZoomMotionBlurTuning,
  type ZoomPresetId,
  type ZoomRegion,
  type ZoomTransitionEasing,
} from "@/types/editor";
import {
  areDeepEqual,
  calculateMp4ExportDimensions,
  calculateMp4SourceDimensions,
  cloneStructured,
  DEFAULT_MP4_EXPORT_FRAME_RATE,
  formatTime,
  getDevOpenRecordingConfig,
  getErrorMessage,
  getSmokeExportConfig,
  PROJECT_AUTOSAVE_DELAY_MS,
  SaveProjectOptions,
  showExportErrorToast,
  SMOKE_EXPORT_READY_TIMEOUT_MS,
  SOURCE_AUDIO_FALLBACK_TOAST_ID,
  streamExportBlobToTempFile,
  summarizeErrorMessage,
  writeSmokeExportReport,
} from "@/components/editor/windows-utils";
import {
  EditorPreset,
  EditorPresetSnapshot,
  loadEditorPreferences,
  loadEditorPresets,
  saveEditorPreferences,
  saveEditorPresets,
  serializeEditorPresetSnapshot,
} from "@/components/editor/utils/editor-preferences";
import type { ProjectLibraryEntry } from "@/types";
import {
  createProjectData,
  deriveNextId,
  EditorProjectData,
  type ProjectSnapshot,
  fromFileUrl,
  normalizeProjectEditor,
  normalizeProjectSnapshots,
  resolveVideoUrl,
  toFileUrl,
  validateProjectData,
} from "@/components/editor/utils/project-persistance";
import { normalizeCursorTelemetrySamples } from "@/lib/cursorTelemetry";
import TimelineEditor, {
  type TimelineEditorHandle,
} from "@/components/editor/timeline/TimelineEditor";
import {
  getTimelinePanelSizing,
  TIMELINE_DENSITY_OPTIONS,
  type TimelineDensityMode,
} from "@/components/editor/timeline/timelineLayout";
import { resolveAutoCaptionSourcePath } from "@/components/editor/utils/auto-caption-source";
import {
  buildLoopedCursorTelemetry,
  getDisplayedTimelineWindowMs,
} from "@/components/editor/videoPlayback/cursorLoopTelemetry";
import VideoPlayback, { VideoPlaybackRef } from "@/components/editor/playback";
import {
  APP_HEADER_ICON_BUTTON_CLASS,
  FeedbackDialog,
  openExternalLink,
  QUIRO_ISSUES_URL,
} from "@/components/editor/help";
import { Button } from "@/components/ui/button";
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip";
import Scrubber from "@/components/ui/scrubber";
import ProjectBrowserDialog from "@/components/editor/dialog/ProjectBrowserDialog";
import { Spinner } from "@/components/ui/spinner";
import { SettingsPanel } from "@/components/editor/SettingsPanel";
import { AiChatPanel } from "@/components/editor/ai/AiChatPanel";
import type { BrainInputs, EditorActions, EditorStateForAI } from "@/lib/ai/contract";
import { ProjectNameEditor } from "@/components/editor/ProjectNameEditor";
import { AddLayerDropdown } from "@/components/editor/editor-window/AddLayerDropdown";
import { AspectRatioDropdown } from "@/components/editor/editor-window/AspectRatioDropdown";
import { CropEditorDialog } from "@/components/editor/editor-window/CropEditorDialog";
import { EditorSectionRail } from "@/components/editor/editor-window/EditorSectionRail";
import { EditorExportDropdown } from "@/components/editor/editor-window/EditorExportDropdown";
import { EditorPresetPopover } from "@/components/editor/editor-window/EditorPresetPopover";
import { EditorHistoryPopover } from "@/components/editor/editor-window/EditorHistoryPopover";
import { NativeCaptureUnavailableDialog } from "@/components/editor/editor-window/NativeCaptureUnavailableDialog";
import { useEditorSectionButtons } from "@/components/editor/editor-window/useEditorSectionButtons";
import type {
  CancelableExporter,
  EditorHistoryEntry,
  EditorHistorySnapshot,
  PendingExportSave,
} from "@/components/editor/editor-window/types";
import {
  appendHistoryEntry,
  createHistoryEntry,
  describeHistoryChange,
  findHistoryIndex,
} from "@/components/editor/editor-window/history";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

declare global {
  interface Window {
    __QUIRO_E2E__?: {
      state: {
        duration: number;
        sourceTime: number;
        timelineTime: number;
        isPlaying: boolean;
        videoPaused: boolean | null;
        videoCurrentTime: number | null;
        clipRegions: ClipRegion[];
        videoPath: string | null;
      };
      actions: {
        playPause: () => void;
        playMuted: () => Promise<void>;
        pause: () => void;
        advanceTimelineMs: (deltaMs: number) => void;
        seekTimelineMs: (timeMs: number) => void;
        splitAtTimelineMs: (timeMs: number) => void;
      };
    };
  }
}

/**
 * Header playhead clock. Subscribes to the per-frame time store so it keeps
 * ticking during playback (when the editor-wide React time state is frozen)
 * while only re-rendering this tiny component.
 */
function LiveTimecode({ fallbackSec }: { fallbackSec: number }) {
  const live = useSyncExternalStore(
    playbackTimeStore.subscribe,
    playbackTimeStore.get,
  );
  return <>{formatTime(live ? live.timelineMs / 1000 : fallbackSec)}</>;
}

/**
 * Merge an incoming zoom into the existing set instead of stacking.
 * If the new region overlaps any existing zooms they are unioned into one;
 * the first overlapping zoom's id and settings (depth, focus) are kept so
 * the user's prior intent is preserved. Non-overlapping regions are untouched.
 */
function mergeZoomIntoExisting(
  existing: ZoomRegion[],
  incoming: ZoomRegion,
): ZoomRegion[] {
  const overlapping = existing.filter(
    (r) => r.startMs < incoming.endMs && r.endMs > incoming.startMs,
  );
  if (overlapping.length === 0) {
    return [...existing, incoming];
  }
  const mergedStart = Math.min(incoming.startMs, ...overlapping.map((r) => r.startMs));
  const mergedEnd = Math.max(incoming.endMs, ...overlapping.map((r) => r.endMs));
  const base = overlapping[0];
  const merged: ZoomRegion = { ...base, startMs: mergedStart, endMs: mergedEnd };
  const overlappingIds = new Set(overlapping.map((r) => r.id));
  return [
    ...existing.filter((r) => !overlappingIds.has(r.id)),
    merged,
  ].sort((a, b) => a.startMs - b.startMs);
}

export default function EditorWindow() {
  const { t } = useI18n();
  // Tell the user up front if GPU acceleration is unavailable or the CPU is
  // saturated — the editor's playback pipeline depends heavily on both.
  useSystemHealthWarning();
  const smokeExportConfig = useMemo(
    () =>
      getSmokeExportConfig(
        typeof window === "undefined" ? "" : window.location.search,
      ),
    [],
  );

  // This is used by the smoke test to determine whether to open the recording
  // config dialog on load, and if so, with what parameters.
  const devOpenRecordingConfig = useMemo(
    () =>
      getDevOpenRecordingConfig(
        typeof window === "undefined" ? "" : window.location.search,
      ),
    [],
  );

  const [appPlatform, setAppPlatform] = useState<string>(
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
      ? "darwin"
      : "",
  );

  const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(
    null,
  );
  const [projectLibraryEntries, setProjectLibraryEntries] = useState<
    ProjectLibraryEntry[]
  >([]);
  const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [wallpaper, setWallpaper] = useState<string>(
    initialEditorPreferences.wallpaper,
  );
  const currentTimeRef = useRef(0);
  const [shadowIntensity, setShadowIntensity] = useState(
    initialEditorPreferences.shadowIntensity,
  );
  const [backgroundBlur, setBackgroundBlur] = useState(
    initialEditorPreferences.backgroundBlur,
  );
  const [zoomMotionBlur, setZoomMotionBlur] = useState(
    initialEditorPreferences.zoomMotionBlur,
  );
  const [zoomMotionBlurTuning, setZoomMotionBlurTuning] =
    useState<ZoomMotionBlurTuning>(
      initialEditorPreferences.zoomMotionBlurTuning ??
        DEFAULT_ZOOM_MOTION_BLUR_TUNING,
    );
  const [zoomTemporalMotionBlur, setZoomTemporalMotionBlur] = useState(
    initialEditorPreferences.zoomTemporalMotionBlur,
  );
  const [zoomMotionBlurSampleCount, setZoomMotionBlurSampleCount] = useState<
    number | null
  >(initialEditorPreferences.zoomMotionBlurSampleCount);
  const [zoomMotionBlurShutterFraction, setZoomMotionBlurShutterFraction] =
    useState<number | null>(
      initialEditorPreferences.zoomMotionBlurShutterFraction,
    );
  const [
    autoApplyFreshRecordingAutoZooms,
    setAutoApplyFreshRecordingAutoZooms,
  ] = useState(initialEditorPreferences.autoApplyFreshRecordingAutoZooms);
  const [timelineDensityMode, setTimelineDensityMode] =
    useState<TimelineDensityMode>(initialEditorPreferences.timelineDensityMode);
  const [connectZooms, setConnectZooms] = useState(
    initialEditorPreferences.connectZooms,
  );
  const [zoomInDurationMs, setZoomInDurationMs] = useState(
    initialEditorPreferences.zoomInDurationMs ?? DEFAULT_ZOOM_IN_DURATION_MS,
  );
  const [zoomInOverlapMs, setZoomInOverlapMs] = useState(
    initialEditorPreferences.zoomInOverlapMs ?? DEFAULT_ZOOM_IN_OVERLAP_MS,
  );
  const [zoomOutDurationMs, setZoomOutDurationMs] = useState(
    initialEditorPreferences.zoomOutDurationMs ?? DEFAULT_ZOOM_OUT_DURATION_MS,
  );
  const [connectedZoomGapMs, setConnectedZoomGapMs] = useState(
    initialEditorPreferences.connectedZoomGapMs ??
      DEFAULT_CONNECTED_ZOOM_GAP_MS,
  );
  const [connectedZoomDurationMs, setConnectedZoomDurationMs] = useState(
    initialEditorPreferences.connectedZoomDurationMs ??
      DEFAULT_CONNECTED_ZOOM_DURATION_MS,
  );
  const [zoomInEasing, setZoomInEasing] = useState<ZoomTransitionEasing>(
    initialEditorPreferences.zoomInEasing ?? DEFAULT_ZOOM_IN_EASING,
  );
  const [zoomOutEasing, setZoomOutEasing] = useState<ZoomTransitionEasing>(
    initialEditorPreferences.zoomOutEasing ?? DEFAULT_ZOOM_OUT_EASING,
  );
  const [connectedZoomEasing, setConnectedZoomEasing] =
    useState<ZoomTransitionEasing>(
      initialEditorPreferences.connectedZoomEasing ??
        DEFAULT_CONNECTED_ZOOM_EASING,
    );
  const [showCursor, setShowCursor] = useState(
    initialEditorPreferences.showCursor,
  );
  const [loopCursor, setLoopCursor] = useState(
    initialEditorPreferences.loopCursor,
  );
  const [cursorStyle, setCursorStyle] = useState<CursorStyle>(
    initialEditorPreferences.cursorStyle ?? DEFAULT_CURSOR_STYLE,
  );
  const [cursorSize, setCursorSize] = useState(
    initialEditorPreferences.cursorSize,
  );
  const [cursorSmoothing, setCursorSmoothing] = useState(
    initialEditorPreferences.cursorSmoothing,
  );
  const [cursorSpringStiffnessMultiplier, setCursorSpringStiffnessMultiplier] =
    useState(initialEditorPreferences.cursorSpringStiffnessMultiplier);
  const [cursorSpringDampingMultiplier, setCursorSpringDampingMultiplier] =
    useState(initialEditorPreferences.cursorSpringDampingMultiplier);
  const [cursorSpringMassMultiplier, setCursorSpringMassMultiplier] = useState(
    initialEditorPreferences.cursorSpringMassMultiplier,
  );
  const [cameraSpringStiffnessMultiplier, setCameraSpringStiffnessMultiplier] =
    useState(initialEditorPreferences.cameraSpringStiffnessMultiplier);
  const [cameraSpringDampingMultiplier, setCameraSpringDampingMultiplier] =
    useState(initialEditorPreferences.cameraSpringDampingMultiplier);
  const [cameraSpringMassMultiplier, setCameraSpringMassMultiplier] = useState(
    initialEditorPreferences.cameraSpringMassMultiplier,
  );
  const [sessionShowCursorOverride, setSessionShowCursorOverride] = useState<
    boolean | null
  >(null);
  const [sessionNativeCaptureUnavailable, setSessionNativeCaptureUnavailable] =
    useState(false);
  const [
    nativeCaptureUnavailableModalOpen,
    setNativeCaptureUnavailableModalOpen,
  ] = useState(false);
  const [zoomSmoothness, setZoomSmoothness] = useState(0.5);
  const [zoomClassicMode, setZoomClassicMode] = useState(false);
  const [cursorMotionBlur, setCursorMotionBlur] = useState(
    initialEditorPreferences.cursorMotionBlur,
  );
  const [cursorClickBounce, setCursorClickBounce] = useState(
    initialEditorPreferences.cursorClickBounce,
  );
  const [cursorClickBounceDuration, setCursorClickBounceDuration] = useState(
    initialEditorPreferences.cursorClickBounceDuration,
  );
  const [cursorClickEffect, setCursorClickEffect] =
    useState<CursorClickEffectSettings>(DEFAULT_CURSOR_CLICK_EFFECT);
  const [cursorSway, setCursorSway] = useState(
    initialEditorPreferences.cursorSway,
  );
  const [overlayLayerOrder, setOverlayLayerOrder] = useState<OverlayLayerOrder>(
    DEFAULT_OVERLAY_LAYER_ORDER,
  );
  const [projectSnapshots, setProjectSnapshots] = useState<ProjectSnapshot[]>(
    [],
  );
  const [borderRadius, setBorderRadius] = useState(
    initialEditorPreferences.borderRadius,
  );
  const [padding, setPadding] = useState(initialEditorPreferences.padding);
  const [frame, setFrame] = useState<string | null>(
    initialEditorPreferences.frame,
  );
  const [cropRegion, setCropRegion] = useState<CropRegion>(DEFAULT_CROP_REGION);
  const [webcam, setWebcam] = useState<WebcamOverlaySettings>(
    initialEditorPreferences.webcam ?? DEFAULT_WEBCAM_OVERLAY,
  );
  const [resolvedWebcamVideoUrl, setResolvedWebcamVideoUrl] = useState<
    string | null
  >(null);
  const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
  const [cursorTelemetry, setCursorTelemetry] = useState<
    CursorTelemetryPoint[]
  >([]);
  // Tracks the videoSourcePath for which the cursor telemetry IPC has already
  // resolved. The smoke-export auto-trigger waits on this so long recordings
  // still bake cursor/zoom animations into the output — without it, the
  // auto-export fires as soon as the video loads and the telemetry arrives
  // after encoding has started.
  const [cursorTelemetrySourcePath, setCursorTelemetrySourcePath] = useState<
    string | null
  >(null);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
  const [clipRegions, setClipRegions] = useState<ClipRegion[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [speedRegions, setSpeedRegions] = useState<SpeedRegion[]>([]);
  const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
  const [annotationRegions, setAnnotationRegions] = useState<
    AnnotationRegion[]
  >([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<
    string | null
  >(null);
  const [audioRegions, setAudioRegions] = useState<AudioRegion[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [autoCaptions, setAutoCaptions] = useState<CaptionCue[]>([]);
  const [autoCaptionSettings, setAutoCaptionSettings] =
    useState<AutoCaptionSettings>(DEFAULT_AUTO_CAPTION_SETTINGS);
  const [whisperExecutablePath, setWhisperExecutablePath] = useState<
    string | null
  >(initialEditorPreferences.whisperExecutablePath);
  const [whisperModelPath, setWhisperModelPath] = useState<string | null>(
    initialEditorPreferences.whisperModelPath,
  );
  const [downloadedWhisperModelPath, setDownloadedWhisperModelPath] = useState<
    string | null
  >(null);
  const [whisperModelDownloadStatus, setWhisperModelDownloadStatus] = useState<
    "idle" | "downloading" | "downloaded" | "error"
  >(initialEditorPreferences.whisperModelPath ? "downloaded" : "idle");
  const [whisperModelDownloadProgress, setWhisperModelDownloadProgress] =
    useState(0);
  const [whisperTinyModelDownloadStatus, setWhisperTinyModelDownloadStatus] =
    useState<"idle" | "downloading" | "downloaded" | "error">("idle");
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [previewVolume, setPreviewVolume] = useState(1);
  const [sourceAudioFallbackPaths, setSourceAudioFallbackPaths] = useState<
    string[]
  >([]);

  const [
    sourceAudioFallbackStartDelayMsByPath,
    setSourceAudioFallbackStartDelayMsByPath,
  ] = useState<Record<string, number>>({});
  const applySessionPresentation = useCallback(
    (
      session:
        | {
            hideOverlayCursorByDefault?: boolean;
            nativeCaptureUnavailable?: boolean;
          }
        | null
        | undefined,
    ) => {
      setSessionShowCursorOverride(
        session?.hideOverlayCursorByDefault ? false : null,
      );
      setSessionNativeCaptureUnavailable(
        Boolean(session?.nativeCaptureUnavailable),
      );
      setNativeCaptureUnavailableModalOpen(
        Boolean(session?.nativeCaptureUnavailable),
      );
    },
    [],
  );
  const effectiveShowCursor = sessionShowCursorOverride ?? showCursor;
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(
    initialEditorPreferences.aspectRatio,
  );
  const [activeEffectSection, setActiveEffectSection] =
    useState<EditorEffectSection>("scene");
  const [exportQuality, setExportQuality] = useState<ExportQuality>(
    initialEditorPreferences.exportQuality,
  );
  const [exportEncodingMode, setExportEncodingMode] =
    useState<ExportEncodingMode>(initialEditorPreferences.exportEncodingMode);
  const [exportBackendPreference, setExportBackendPreference] =
    useState<ExportBackendPreference>(
      initialEditorPreferences.exportBackendPreference,
    );
  const [exportPipelineModel, setExportPipelineModel] =
    useState<ExportPipelineModel>(initialEditorPreferences.exportPipelineModel);
  const [mp4FrameRate, setMp4FrameRate] = useState<ExportMp4FrameRate>(
    initialEditorPreferences.mp4FrameRate ?? DEFAULT_MP4_EXPORT_FRAME_RATE,
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>(
    initialEditorPreferences.exportFormat,
  );
  const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(
    initialEditorPreferences.gifFrameRate,
  );
  const [gifLoop, setGifLoop] = useState(initialEditorPreferences.gifLoop);
  const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(
    initialEditorPreferences.gifSizePreset,
  );
  const [exportedFilePath, setExportedFilePath] = useState<string | undefined>(
    undefined,
  );
  const [hasPendingExportSave, setHasPendingExportSave] = useState(false);
  const [lastSavedSnapshot, setLastSavedSnapshot] =
    useState<EditorProjectData | null>(null);
  const [editorPresets, setEditorPresets] = useState<EditorPreset[]>(() =>
    loadEditorPresets(),
  );
  const [activeEditorPresetId, setActiveEditorPresetId] = useState<
    string | null
  >(null);
  const [presetPopoverOpen, setPresetPopoverOpen] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [showCropModal, setShowCropModal] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [workspaceReloadVersion, setWorkspaceReloadVersion] = useState(0);
  const [isPreviewReady, setIsPreviewReady] = useState(false);
  const [autoSuggestZoomsTrigger, setAutoSuggestZoomsTrigger] = useState(0);
  const headerLeftControlsPaddingClass =
    appPlatform === "darwin" ? "pl-[76px]" : "";

  const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
  const e2ePlaybackRafRef = useRef<number | null>(null);
  const e2ePlaybackLastFrameRef = useRef<number | null>(null);
  const projectBrowserTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectBrowserFallbackTriggerRef = useRef<HTMLButtonElement | null>(
    null,
  );
  const nextZoomIdRef = useRef(1);
  const nextClipIdRef = useRef(1);
  const nextSpeedIdRef = useRef(1);
  const nextAudioIdRef = useRef(1);

  const { shortcuts, isMac } = useShortcuts();
  const nextAnnotationIdRef = useRef(1);
  const nextAnnotationZIndexRef = useRef(1); // Track z-index for stacking order
  const exporterRef = useRef<CancelableExporter | null>(null);
  const autoSuggestedVideoPathRef = useRef<string | null>(null);
  const pendingFreshRecordingAutoZoomPathRef = useRef<string | null>(null);
  const historyEntriesRef = useRef<EditorHistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const applyingHistoryRef = useRef(false);
  const historyBatchDepthRef = useRef(0);
  const historyBatchStartSnapshotRef = useRef<EditorHistorySnapshot | null>(null);
  const historyBatchLabelRef = useRef<string | undefined>(undefined);
  const pendingExportSaveRef = useRef<PendingExportSave | null>(null);
  const pendingTelemetryRetryTimeoutRef = useRef<number | null>(null);
  const pendingFreshRecordingAutoSuggestTimeoutRef = useRef<number | null>(
    null,
  );
  const pendingFreshRecordingAutoSuggestTelemetryCountRef = useRef(0);
  const cropSnapshotRef = useRef<CropRegion | null>(null);
  const mp4SupportRequestRef = useRef(0);
  const smokeExportStartedRef = useRef(false);
  const projectAutosaveTimeoutRef = useRef<number | null>(null);
  const projectSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const smokeExportReadyStateRef = useRef<Record<string, unknown>>({});
  const [historyVersion, setHistoryVersion] = useState(0);
  const timelineRef = useRef<TimelineEditorHandle>(null);

  const [timelineCollapsed, setTimelineCollapsed] = useState(false);

  // ── AI (Quiro Director) — S0-4 ────────────────────────────────────────────
  // Stable handle the chat agent uses to read/edit the editor. snapshot() reads
  // the latest state via a ref (kept fresh below) so the object identity stays
  // stable for React.memo. Mutators are thin wrappers over existing setters;
  // the dispatcher (S1-4) and undo batching (S3-4) build on these.
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [isFirstDraftRunning, setIsFirstDraftRunning] = useState(false);
  const handleToggleAiPanel = useCallback(() => {
    setAiPanelOpen((value) => !value);
  }, []);

  const aiEditorStateRef = useRef<EditorStateForAI>({
    durationMs: 0,
    zoomRegions: [],
    clipRegions: [],
    speedRegions: [],
    annotationCount: 0,
    captionsEnabled: false,
    captionCueCount: 0,
    hasTelemetry: false,
    hasTranscript: false,
  });
  aiEditorStateRef.current = {
    durationMs: duration,
    zoomRegions,
    clipRegions,
    speedRegions,
    annotationCount: annotationRegions.length,
    captionsEnabled: autoCaptionSettings.enabled,
    captionCueCount: autoCaptions.length,
    hasTelemetry: cursorTelemetry.length > 0,
    hasTranscript: autoCaptions.length > 0,
  };

  // brainInputsRef is refreshed later (after normalizedCursorTelemetry is computed).
  const brainInputsRef = useRef<BrainInputs>({
    sourcePath: "",
    durationMs: 0,
    transcript: [],
    cursorTelemetry: [],
  });

  // captionCtxRef holds live values read by generateCaptions at call time.
  // Refreshed after syncActiveVideoSource is declared (similar to brainInputsRef).
  const captionCtxRef = useRef<{
    language: string;
    videoPath: string | null | undefined;
    videoSourcePath: string | null | undefined;
    webcamSourcePath: string | null;
    whisperExecutablePath: string | null;
    whisperModelPath: string | null;
    syncActiveVideoSource: ((sourcePath: string, webcamPath?: string | null) => Promise<void>) | null;
  }>({
    language: "",
    videoPath: undefined,
    videoSourcePath: undefined,
    webcamSourcePath: null,
    whisperExecutablePath: null,
    whisperModelPath: null,
    syncActiveVideoSource: null,
  });

  const editorActions = useMemo<EditorActions>(
    () => ({
      snapshot: () => aiEditorStateRef.current,
      getBrainInputs: () => brainInputsRef.current,
      applyZoomSuggestions: (suggestions, depth) =>
        setZoomRegions((prev) => {
          let result = [...prev];
          suggestions.forEach((suggestion, index) => {
            const incoming: ZoomRegion = {
              id: `ai-zoom-${Date.now()}-${index}`,
              startMs: suggestion.start,
              endMs: suggestion.end,
              depth: depth ?? 2,
              focus: suggestion.focus,
            };
            result = mergeZoomIntoExisting(result, incoming);
          });
          return result;
        }),
      addZoomRegion: (region) =>
        setZoomRegions((prev) => mergeZoomIntoExisting(prev, region)),
      updateZoomRegion: (id, updates) =>
        setZoomRegions((prev) =>
          prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        ),
      setKeptClips: (clips) => setClipRegions(clips),
      applyCaptions: (cues, options) => {
        setAutoCaptions(cues);
        if (options?.enable) {
          setAutoCaptionSettings((prev) => ({
            ...prev,
            enabled: true,
            ...(options.language ? { language: options.language } : {}),
          }));
        }
      },
      generateCaptions: async (language) => {
        const ctx = captionCtxRef.current;
        const requestedLanguage =
          typeof language === "string" && language.trim()
            ? language
            : ctx.language || "auto";

        if (!ctx.whisperModelPath) {
          return {
            ok: false,
            message: "Select or download a Whisper model before generating captions.",
            reason: "missing-model",
          };
        }

        let sourcePath = resolveAutoCaptionSourcePath({
          videoSourcePath: ctx.videoSourcePath,
          videoPath: ctx.videoPath,
        });

        if (!sourcePath) {
          const sessionResult =
            await window.electronAPI.getCurrentRecordingSession?.();
          const currentVideoResult = await window.electronAPI.getCurrentVideoPath();
          sourcePath = resolveAutoCaptionSourcePath({
            recordingSessionVideoPath:
              sessionResult?.success && sessionResult.session?.videoPath
                ? sessionResult.session.videoPath
                : null,
            currentVideoPath: currentVideoResult.success
              ? currentVideoResult.path ?? null
              : null,
          });
        }

        if (!sourcePath) {
          return {
            ok: false,
            message: "No source video is loaded.",
            reason: "no-source",
          };
        }

        if (sourcePath !== ctx.videoSourcePath) {
          setVideoSourcePath(sourcePath);
          setVideoPath(await resolveVideoUrl(sourcePath));
        }

        await ctx.syncActiveVideoSource?.(sourcePath, ctx.webcamSourcePath);

        const result = await window.electronAPI.generateAutoCaptions({
          videoPath: sourcePath,
          whisperExecutablePath: ctx.whisperExecutablePath ?? undefined,
          whisperModelPath: ctx.whisperModelPath,
          language: requestedLanguage,
        });

        if (!result.success || !result.cues) {
          return {
            ok: false,
            message:
              result.message ||
              getErrorMessage(result.error) ||
              "Failed to generate captions.",
            reason: "generate-captions-failed",
          };
        }

        setAutoCaptions(result.cues);
        // Update the ref immediately so getBrainInputs() sees the new transcript
        // before React re-renders (the agent loop runs in the same async chain).
        brainInputsRef.current = { ...brainInputsRef.current, transcript: result.cues };
        setAutoCaptionSettings((prev) => ({
          ...prev,
          enabled: true,
          language: requestedLanguage,
        }));

        return {
          ok: true,
          cues: result.cues,
          message:
            result.message || `Generated ${result.cues.length} captions.`,
        };
      },
      addAnnotation: (region) =>
        setAnnotationRegions((prev) => [...prev, region]),
      setSpeedRegion: (region) => setSpeedRegions((prev) => [...prev, region]),
      beginAiBatch: (label) => {
        if (historyBatchDepthRef.current === 0) {
          historyBatchStartSnapshotRef.current = cloneSnapshot(buildHistorySnapshot());
          historyBatchLabelRef.current = label;
        }
        historyBatchDepthRef.current += 1;
      },
      endAiBatch: () => {
        if (historyBatchDepthRef.current <= 0) {
          return;
        }

        historyBatchDepthRef.current -= 1;
        if (historyBatchDepthRef.current > 0) {
          return;
        }

        const startSnapshot = historyBatchStartSnapshotRef.current;
        historyBatchStartSnapshotRef.current = null;
        const label = historyBatchLabelRef.current ?? "AI edit";
        historyBatchLabelRef.current = undefined;

        if (!startSnapshot) {
          return;
        }

        const currentSnapshot = buildHistorySnapshot();
        if (areDeepEqual(startSnapshot, currentSnapshot)) {
          return;
        }

        if (historyIndexRef.current < 0) {
          historyEntriesRef.current = [
            createHistoryEntry(cloneSnapshot(currentSnapshot), "Initial state"),
          ];
          historyIndexRef.current = 0;
          syncHistoryButtons();
          return;
        }

        const entry = createHistoryEntry(cloneSnapshot(currentSnapshot), label);
        const next = appendHistoryEntry(
          historyEntriesRef.current,
          historyIndexRef.current,
          entry,
        );
        historyEntriesRef.current = next.entries;
        historyIndexRef.current = next.index;
        syncHistoryButtons();
      },
    }),
    [],
  );

  const handleRunFirstDraft = useCallback(async () => {
    if (isFirstDraftRunning) {
      return;
    }

    setIsFirstDraftRunning(true);
    editorActions.beginAiBatch?.("Magic first draft");
    try {
      const result = await runFirstDraft(editorActions);
      if (!result.ok) {
        toast.error(result.summary);
        return;
      }
      toast.success(result.summary);
    } catch (error) {
      toast.error(`Magic draft failed: ${String(error)}`);
    } finally {
      editorActions.endAiBatch?.();
      setIsFirstDraftRunning(false);
    }
  }, [editorActions, isFirstDraftRunning]);

  useEffect(() => {
    void window.electronAPI?.getPlatform?.()?.then((platform) => {
      setAppPlatform(platform);
    });
  }, []);

  useEffect(() => {
    // Reset the timeline collapse state whenever a new video is loaded
    autoSuggestedVideoPathRef.current = null;
    pendingFreshRecordingAutoSuggestTelemetryCountRef.current = 0;
    if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
      window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
      pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
    }
  }, []);

  // Auto-activate builtin extensions at editor startup (idempotent)
  useEffect(() => {
    extensionHost.autoActivateBuiltins();
  }, []);

  // Probe supported MP4 export dimensions on startup so that we can warn users if their system is likely to struggle with their chosen export settings
  // (e.g. 1080p or 4K exports on low-end hardware with a CPU-based encoder).
  const [supportedMp4SourceDimensions, setSupportedMp4SourceDimensions] =
    useState<SupportedMp4Dimensions>({
      width: 1920,
      height: 1080,
      capped: false,
      encoderPath: null,
    });

  const syncHistoryButtons = useCallback(() => {
    setHistoryVersion((version) => version + 1);
  }, []);

  const captureEditorPresetSnapshot = useCallback(
    (): EditorPresetSnapshot => ({
      wallpaper,
      shadowIntensity,
      backgroundBlur,
      zoomMotionBlur,
      zoomMotionBlurTuning: { ...zoomMotionBlurTuning },
      zoomTemporalMotionBlur,
      zoomMotionBlurSampleCount,
      zoomMotionBlurShutterFraction,
      connectZooms,
      zoomInDurationMs,
      zoomInOverlapMs,
      zoomOutDurationMs,
      connectedZoomGapMs,
      connectedZoomDurationMs,
      zoomInEasing,
      zoomOutEasing,
      connectedZoomEasing,
      showCursor,
      loopCursor,
      cursorStyle,
      cursorSize,
      cursorSmoothing,
      cursorSpringStiffnessMultiplier,
      cursorSpringDampingMultiplier,
      cursorSpringMassMultiplier,
      cameraSpringStiffnessMultiplier,
      cameraSpringDampingMultiplier,
      cameraSpringMassMultiplier,
      cursorMotionBlur,
      cursorClickBounce,
      cursorClickBounceDuration,
      cursorClickEffect,
      cursorSway,
      borderRadius,
      padding: { ...padding },
      frame,
      webcam: { ...webcam },
      aspectRatio,
      exportEncodingMode,
      exportBackendPreference,
      exportPipelineModel,
      exportQuality,
      mp4FrameRate,
      exportFormat,
      gifFrameRate,
      gifLoop,
      gifSizePreset,
      autoCaptionSettings: { ...autoCaptionSettings },
      whisperExecutablePath,
      whisperModelPath,
    }),
    [
      wallpaper,
      shadowIntensity,
      backgroundBlur,
      zoomMotionBlur,
      zoomMotionBlurTuning,
      zoomTemporalMotionBlur,
      zoomMotionBlurSampleCount,
      zoomMotionBlurShutterFraction,
      connectZooms,
      zoomInDurationMs,
      zoomInOverlapMs,
      zoomOutDurationMs,
      connectedZoomGapMs,
      connectedZoomDurationMs,
      zoomInEasing,
      zoomOutEasing,
      connectedZoomEasing,
      showCursor,
      loopCursor,
      cursorStyle,
      cursorSize,
      cursorSmoothing,
      cursorSpringStiffnessMultiplier,
      cursorSpringDampingMultiplier,
      cursorSpringMassMultiplier,
      cameraSpringStiffnessMultiplier,
      cameraSpringDampingMultiplier,
      cameraSpringMassMultiplier,
      cursorMotionBlur,
      cursorClickBounce,
      cursorClickBounceDuration,
      cursorClickEffect,
      cursorSway,
      borderRadius,
      padding,
      frame,
      webcam,
      aspectRatio,
      exportEncodingMode,
      exportBackendPreference,
      exportPipelineModel,
      exportQuality,
      mp4FrameRate,
      exportFormat,
      gifFrameRate,
      gifLoop,
      gifSizePreset,
      autoCaptionSettings,
      whisperExecutablePath,
      whisperModelPath,
    ],
  );

  const currentPresetSnapshot = useMemo(
    () => captureEditorPresetSnapshot(),
    [captureEditorPresetSnapshot],
  );
  const currentPresetSignature = useMemo(
    () => serializeEditorPresetSnapshot(currentPresetSnapshot),
    [currentPresetSnapshot],
  );
  const currentEditorPreset = useMemo(
    () =>
      editorPresets.find((preset) => preset.id === activeEditorPresetId) ??
      null,
    [activeEditorPresetId, editorPresets],
  );

  useEffect(() => {
    const activePreset = currentEditorPreset;
    if (
      activePreset &&
      serializeEditorPresetSnapshot(activePreset.snapshot) ===
        currentPresetSignature
    ) {
      return;
    }

    const matchingPreset =
      editorPresets.find(
        (preset) =>
          serializeEditorPresetSnapshot(preset.snapshot) ===
          currentPresetSignature,
      ) ?? null;
    const nextActivePresetId = matchingPreset?.id ?? null;
    if (nextActivePresetId !== activeEditorPresetId) {
      setActiveEditorPresetId(nextActivePresetId);
    }
  }, [
    activeEditorPresetId,
    currentEditorPreset,
    currentPresetSignature,
    editorPresets,
  ]);

  useEffect(() => {
    if (!presetPopoverOpen) {
      setPresetNameDraft("");
    }
  }, [presetPopoverOpen]);

  const applyEditorPresetSnapshot = useCallback(
    (snapshot: EditorPresetSnapshot) => {
      setWallpaper(snapshot.wallpaper);
      setShadowIntensity(snapshot.shadowIntensity);
      setBackgroundBlur(snapshot.backgroundBlur);
      setZoomMotionBlur(snapshot.zoomMotionBlur);
      setZoomMotionBlurTuning({ ...snapshot.zoomMotionBlurTuning });
      setZoomTemporalMotionBlur(snapshot.zoomTemporalMotionBlur);
      setZoomMotionBlurSampleCount(snapshot.zoomMotionBlurSampleCount);
      setZoomMotionBlurShutterFraction(snapshot.zoomMotionBlurShutterFraction);
      setConnectZooms(snapshot.connectZooms);
      setZoomInDurationMs(snapshot.zoomInDurationMs);
      setZoomInOverlapMs(snapshot.zoomInOverlapMs);
      setZoomOutDurationMs(snapshot.zoomOutDurationMs);
      setConnectedZoomGapMs(snapshot.connectedZoomGapMs);
      setConnectedZoomDurationMs(snapshot.connectedZoomDurationMs);
      setZoomInEasing(snapshot.zoomInEasing);
      setZoomOutEasing(snapshot.zoomOutEasing);
      setConnectedZoomEasing(snapshot.connectedZoomEasing);
      setShowCursor(snapshot.showCursor);
      setLoopCursor(snapshot.loopCursor);
      setCursorStyle(snapshot.cursorStyle);
      setCursorSize(snapshot.cursorSize);
      setCursorSmoothing(snapshot.cursorSmoothing);
      setCursorSpringStiffnessMultiplier(
        snapshot.cursorSpringStiffnessMultiplier,
      );
      setCursorSpringDampingMultiplier(snapshot.cursorSpringDampingMultiplier);
      setCursorSpringMassMultiplier(snapshot.cursorSpringMassMultiplier);
      setCameraSpringStiffnessMultiplier(
        snapshot.cameraSpringStiffnessMultiplier,
      );
      setCameraSpringDampingMultiplier(snapshot.cameraSpringDampingMultiplier);
      setCameraSpringMassMultiplier(snapshot.cameraSpringMassMultiplier);
      setCursorMotionBlur(snapshot.cursorMotionBlur);
      setCursorClickBounce(snapshot.cursorClickBounce);
      setCursorClickBounceDuration(snapshot.cursorClickBounceDuration);
      setCursorClickEffect(snapshot.cursorClickEffect);
      setCursorSway(snapshot.cursorSway);
      setBorderRadius(snapshot.borderRadius);
      setPadding({ ...snapshot.padding });
      setFrame(snapshot.frame);
      setWebcam({ ...snapshot.webcam });
      setAspectRatio(snapshot.aspectRatio);
      setExportEncodingMode(snapshot.exportEncodingMode);
      setExportBackendPreference(snapshot.exportBackendPreference);
      setExportPipelineModel(snapshot.exportPipelineModel);
      setExportQuality(snapshot.exportQuality);
      setMp4FrameRate(snapshot.mp4FrameRate);
      setExportFormat(snapshot.exportFormat);
      setGifFrameRate(snapshot.gifFrameRate);
      setGifLoop(snapshot.gifLoop);
      setGifSizePreset(snapshot.gifSizePreset);
      setAutoCaptionSettings({ ...snapshot.autoCaptionSettings });
      setWhisperExecutablePath(snapshot.whisperExecutablePath);
      setWhisperModelPath(snapshot.whisperModelPath);
    },
    [],
  );

  const handleApplyEditorPreset = useCallback(
    (presetId: string) => {
      const preset = editorPresets.find((item) => item.id === presetId);
      if (!preset) {
        return;
      }

      setActiveEditorPresetId(preset.id);
      applyEditorPresetSnapshot(preset.snapshot);
      toast.success(
        t("editor.presets.toasts.applied", 'Applied preset "{{name}}"', {
          name: preset.name,
        }),
      );
    },
    [applyEditorPresetSnapshot, editorPresets, t],
  );

  const handleSaveEditorPreset = useCallback(
    (name: string) => {
      const normalizedName = name.trim().replace(/\s+/g, " ");
      if (normalizedName.length === 0) {
        toast.error(
          t("editor.presets.errors.nameRequired", "Enter a preset name."),
        );
        return false;
      }

      const hasDuplicateName = editorPresets.some(
        (preset) =>
          preset.name.toLocaleLowerCase() ===
          normalizedName.toLocaleLowerCase(),
      );
      if (hasDuplicateName) {
        toast.error(
          t(
            "editor.presets.errors.duplicateName",
            "A preset with that name already exists.",
          ),
        );
        return false;
      }

      const snapshot = captureEditorPresetSnapshot();
      const timestamp = new Date().toISOString();
      const nextPreset: EditorPreset = {
        id: crypto.randomUUID(),
        name: normalizedName,
        createdAt: timestamp,
        updatedAt: timestamp,
        snapshot,
      };
      const nextPresets: EditorPreset[] = [nextPreset, ...editorPresets];

      if (!saveEditorPresets(nextPresets)) {
        toast.error(
          t(
            "editor.presets.errors.saveFailed",
            "Could not save that preset. Check your browser storage settings and try again.",
          ),
        );
        return false;
      }

      setEditorPresets(nextPresets);
      setActiveEditorPresetId(nextPreset.id);
      toast.success(
        t("editor.presets.toasts.saved", 'Saved preset "{{name}}"', {
          name: normalizedName,
        }),
      );
      return true;
    },
    [captureEditorPresetSnapshot, editorPresets, t],
  );

  const handleDeleteEditorPreset = useCallback(
    (presetId: string) => {
      const preset = editorPresets.find((item) => item.id === presetId);
      if (!preset) {
        return;
      }

      const nextPresets = editorPresets.filter((item) => item.id !== presetId);
      if (!saveEditorPresets(nextPresets)) {
        toast.error(
          t(
            "editor.presets.errors.deleteFailed",
            "Could not delete that preset. Check your browser storage settings and try again.",
          ),
        );
        return;
      }

      setEditorPresets(nextPresets);
      if (preset.id === activeEditorPresetId) {
        setActiveEditorPresetId(null);
      }
      toast.success(
        t("editor.presets.toasts.deleted", 'Deleted preset "{{name}}"', {
          name: preset.name,
        }),
      );
    },
    [activeEditorPresetId, editorPresets, t],
  );

  const handleSavePresetSubmit = useCallback(() => {
    const didSave = handleSaveEditorPreset(presetNameDraft);
    if (didSave) {
      setPresetNameDraft("");
    }
  }, [handleSaveEditorPreset, presetNameDraft]);

  const clearPendingExportSave = useCallback(() => {
    const pending = pendingExportSaveRef.current;
    pendingExportSaveRef.current = null;
    setHasPendingExportSave(false);
    if (pending?.tempFilePath && typeof window !== "undefined") {
      // Best-effort cleanup — main-process also reaps stale temp files on
      // before-quit, so we ignore failures here.
      void window.electronAPI.discardExportedTemp?.(pending.tempFilePath);
    }
  }, []);

  const refreshProjectLibrary = useCallback(async () => {
    try {
      const result = await window.electronAPI.listProjectFiles();
      if (!result.success) {
        throw new Error(result.error || "Failed to load project library");
      }

      setProjectLibraryEntries(result.entries);
    } catch (projectLibraryError) {
      console.warn("Unable to refresh project library:", projectLibraryError);
    }
  }, []);

  const captureProjectThumbnail = useCallback(async () => {
    const previewHandle = videoPlaybackRef.current;
    const previewVideo = previewHandle?.video ?? null;
    const previewCanvas = previewHandle?.app?.canvas ?? null;

    if (previewHandle && previewVideo && previewVideo.paused) {
      try {
        await previewHandle.refreshFrame();
        await new Promise((resolve) =>
          requestAnimationFrame(() => resolve(undefined)),
        );
      } catch (thumbnailRefreshError) {
        console.warn(
          "Unable to refresh preview frame before thumbnail capture:",
          thumbnailRefreshError,
        );
      }
    }

    const canvas = document.createElement("canvas");
    const targetWidth = 320;
    const targetHeight = 180;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const editorBgHsl = getComputedStyle(document.documentElement)
      .getPropertyValue("-- background")
      .trim();
    context.fillStyle = editorBgHsl ? `hsl(${editorBgHsl})` : "#111113";
    context.fillRect(0, 0, targetWidth, targetHeight);

    const previewWidth =
      previewHandle?.containerRef.current?.clientWidth || 1920;
    const previewHeight =
      previewHandle?.containerRef.current?.clientHeight || 1080;
    const frameTimestampUs = Math.max(0, Math.round(currentTime * 1_000_000));

    if (
      previewVideo &&
      previewVideo.videoWidth > 0 &&
      previewVideo.videoHeight > 0
    ) {
      let videoFrame: VideoFrame | null = null;
      let frameRenderer: FrameRenderer | null = null;

      try {
        videoFrame = new VideoFrame(previewVideo, {
          timestamp: frameTimestampUs,
        });
        frameRenderer = new FrameRenderer({
          width: targetWidth,
          height: targetHeight,
          wallpaper,
          zoomRegions,
          showShadow: shadowIntensity > 0,
          shadowIntensity,
          backgroundBlur,
          zoomMotionBlur,
          zoomMotionBlurTuning,
          zoomTemporalMotionBlur,
          zoomMotionBlurSampleCount,
          zoomMotionBlurShutterFraction,
          connectZooms,
          zoomInDurationMs,
          zoomInOverlapMs,
          zoomOutDurationMs,
          connectedZoomGapMs,
          connectedZoomDurationMs,
          zoomInEasing,
          zoomOutEasing,
          connectedZoomEasing,
          borderRadius,
          padding,
          cropRegion,
          webcam,
          webcamUrl:
            resolvedWebcamVideoUrl ??
            (webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null),
          videoWidth: previewVideo.videoWidth,
          videoHeight: previewVideo.videoHeight,
          annotationRegions,
          autoCaptions,
          autoCaptionSettings,
          speedRegions: (() => {
            const clipDerived: SpeedRegion[] = clipRegions
              .filter((clip) => clip.speed !== 1)
              .map((clip) => ({
                id: `clip-speed-${clip.id}`,
                startMs: clip.startMs,
                endMs: getClipSourceEndMs(clip),
                speed: clip.speed as SpeedRegion["speed"],
              }));
            if (clipDerived.length === 0) return speedRegions;
            const result = [...speedRegions];
            for (const cs of clipDerived) {
              const overlaps = speedRegions.some(
                (sr) => sr.endMs > cs.startMs && sr.startMs < cs.endMs,
              );
              if (!overlaps) {
                result.push(cs);
              }
            }
            return result;
          })(),
          previewWidth,
          previewHeight,
          cursorTelemetry,
          showCursor: effectiveShowCursor,
          cursorStyle,
          cursorSize,
          cursorSmoothing,
          cursorSpringStiffnessMultiplier,
          cursorSpringDampingMultiplier,
          cursorSpringMassMultiplier,
          cameraSpringStiffnessMultiplier,
          cameraSpringDampingMultiplier,
          cameraSpringMassMultiplier,
          zoomSmoothness,
          zoomClassicMode,
          cursorMotionBlur,
          cursorClickBounce,
          cursorClickBounceDuration,
          cursorSway,
        });
        await frameRenderer.initialize();
        await frameRenderer.renderFrame(videoFrame, frameTimestampUs);
        return frameRenderer.getCanvas().toDataURL("image/png");
      } catch (thumbnailRenderError) {
        console.warn(
          "Unable to render thumbnail from composed frame:",
          thumbnailRenderError,
        );
      } finally {
        videoFrame?.close();
        frameRenderer?.destroy();
      }
    }

    const drawableSource =
      previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0
        ? previewCanvas
        : previewVideo &&
            previewVideo.videoWidth > 0 &&
            previewVideo.videoHeight > 0
          ? previewVideo
          : null;

    if (!drawableSource) {
      return null;
    }

    const sourceWidth =
      drawableSource instanceof HTMLVideoElement
        ? drawableSource.videoWidth
        : drawableSource.width;
    const sourceHeight =
      drawableSource instanceof HTMLVideoElement
        ? drawableSource.videoHeight
        : drawableSource.height;

    if (sourceWidth <= 0 || sourceHeight <= 0) {
      return null;
    }

    const scale = Math.min(
      targetWidth / sourceWidth,
      targetHeight / sourceHeight,
    );
    const drawWidth = Math.round(sourceWidth * scale);
    const drawHeight = Math.round(sourceHeight * scale);
    const offsetX = Math.round((targetWidth - drawWidth) / 2);
    const offsetY = Math.round((targetHeight - drawHeight) / 2);

    try {
      context.drawImage(
        drawableSource,
        offsetX,
        offsetY,
        drawWidth,
        drawHeight,
      );
      return canvas.toDataURL("image/png");
    } catch (thumbnailError) {
      console.warn("Unable to capture project thumbnail:", thumbnailError);
      return null;
    }
  }, [
    annotationRegions,
    autoCaptionSettings,
    autoCaptions,
    backgroundBlur,
    borderRadius,
    connectZooms,
    connectedZoomDurationMs,
    connectedZoomEasing,
    connectedZoomGapMs,
    cropRegion,
    currentTime,
    cursorClickBounce,
    cursorClickBounceDuration,
    cursorMotionBlur,
    cursorSize,
    cursorSmoothing,
    cursorSpringDampingMultiplier,
    cursorSpringMassMultiplier,
    cursorSpringStiffnessMultiplier,
    cameraSpringStiffnessMultiplier,
    cameraSpringDampingMultiplier,
    cameraSpringMassMultiplier,
    zoomSmoothness,
    cursorStyle,
    cursorSway,
    cursorTelemetry,
    clipRegions,
    padding,
    resolvedWebcamVideoUrl,
    shadowIntensity,
    effectiveShowCursor,
    speedRegions,
    wallpaper,
    webcam,
    zoomInDurationMs,
    zoomInEasing,
    zoomInOverlapMs,
    zoomMotionBlur,
    zoomMotionBlurTuning,
    zoomTemporalMotionBlur,
    zoomMotionBlurSampleCount,
    zoomMotionBlurShutterFraction,
    zoomOutDurationMs,
    zoomOutEasing,
    zoomRegions,
    zoomClassicMode,
  ]);

  const markExportAsSaving = useCallback(() => {
    setExportProgress((previous) => ({
      currentFrame: previous?.totalFrames ?? previous?.currentFrame ?? 1,
      totalFrames: previous?.totalFrames ?? previous?.currentFrame ?? 1,
      percentage: 100,
      estimatedTimeRemaining: 0,
      renderFps: previous?.renderFps,
      renderBackend: previous?.renderBackend,
      encodeBackend: previous?.encodeBackend,
      encoderName: previous?.encoderName,
      phase: "saving",
    }));
  }, []);

  const handleShowCursorChange = useCallback((nextShowCursor: boolean) => {
    setSessionShowCursorOverride(null);
    setShowCursor(nextShowCursor);
  }, []);

  const remountPreview = useCallback(() => {
    setIsPreviewReady(false);
    setPreviewVersion((version) => version + 1);
  }, []);

  const remountProjectWorkspace = useCallback(() => {
    setIsPreviewReady(false);
    setPreviewVersion((version) => version + 1);
    setWorkspaceReloadVersion((version) => version + 1);
  }, []);

  const clearPendingProjectAutosave = useCallback(() => {
    if (projectAutosaveTimeoutRef.current !== null) {
      window.clearTimeout(projectAutosaveTimeoutRef.current);
      projectAutosaveTimeoutRef.current = null;
    }
  }, []);

  const queueProjectSave = useCallback((task: () => Promise<boolean>) => {
    const run = projectSaveQueueRef.current.catch(() => undefined).then(task);
    projectSaveQueueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const saveBlobExport = useCallback(
    async (blob: Blob, fileName: string, outputPath: string | null = null) => {
      const extension = fileName.split(".").pop()?.toLowerCase() || "bin";

      try {
        const tempFilePath = await streamExportBlobToTempFile(blob, extension);
        if (tempFilePath) {
          return {
            saveResult: await window.electronAPI.finalizeExportedVideo({
              tempPath: tempFilePath,
              fileName,
              outputPath,
            }),
            pendingSave: {
              fileName,
              tempFilePath,
            } satisfies PendingExportSave,
          };
        }
      } catch (error) {
        console.warn("[export] Falling back to in-memory blob save", error);
      }

      const arrayBuffer = await blob.arrayBuffer();
      return {
        saveResult: outputPath
          ? await window.electronAPI.writeExportedVideoToPath(
              arrayBuffer,
              outputPath,
            )
          : await window.electronAPI.saveExportedVideo(arrayBuffer, fileName),
        pendingSave: {
          fileName,
          arrayBuffer,
        } satisfies PendingExportSave,
      };
    },
    [],
  );

  useEffect(() => {
    return () => {
      exporterRef.current?.cancel();
      exporterRef.current = null;
      const pending = pendingExportSaveRef.current;
      pendingExportSaveRef.current = null;
      if (pending?.tempFilePath && typeof window !== "undefined") {
        void window.electronAPI.discardExportedTemp?.(pending.tempFilePath);
      }
      if (pendingTelemetryRetryTimeoutRef.current !== null) {
        window.clearTimeout(pendingTelemetryRetryTimeoutRef.current);
        pendingTelemetryRetryTimeoutRef.current = null;
      }
      if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
        window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
        pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
      }
      if (projectAutosaveTimeoutRef.current !== null) {
        window.clearTimeout(projectAutosaveTimeoutRef.current);
        projectAutosaveTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    void refreshProjectLibrary();
  }, [refreshProjectLibrary]);

  const historyEntries = historyEntriesRef.current;
  const historyIndex = historyIndexRef.current;
  const currentHistoryEntry =
    historyIndex >= 0 ? historyEntries[historyIndex] : null;
  const canUndo = historyIndex > 0;
  const canRedo =
    historyEntries.length > 0 && historyIndex < historyEntries.length - 1;

  void historyVersion;

  const cloneSnapshot = useCallback(
    (snapshot: EditorHistorySnapshot): EditorHistorySnapshot => {
      return cloneStructured(snapshot);
    },
    [],
  );

  const gifOutputDimensions = useMemo(
    () =>
      calculateOutputDimensions(
        videoPlaybackRef.current?.video?.videoWidth || 1920,
        videoPlaybackRef.current?.video?.videoHeight || 1080,
        gifSizePreset,
        GIF_SIZE_PRESETS,
      ),
    [gifSizePreset],
  );

  const desiredMp4SourceDimensions = useMemo(
    () =>
      calculateMp4SourceDimensions(
        videoPlaybackRef.current?.video?.videoWidth || 1920,
        videoPlaybackRef.current?.video?.videoHeight || 1080,
        aspectRatio,
      ),
    [aspectRatio],
  );

  const mp4OutputDimensions = useMemo(() => {
    const baseWidth = supportedMp4SourceDimensions.encoderPath
      ? supportedMp4SourceDimensions.width
      : desiredMp4SourceDimensions.width;
    const baseHeight = supportedMp4SourceDimensions.encoderPath
      ? supportedMp4SourceDimensions.height
      : desiredMp4SourceDimensions.height;

    return {
      medium: calculateMp4ExportDimensions(baseWidth, baseHeight, "medium"),
      good: calculateMp4ExportDimensions(baseWidth, baseHeight, "good"),
      high: calculateMp4ExportDimensions(baseWidth, baseHeight, "high"),
      source: calculateMp4ExportDimensions(baseWidth, baseHeight, "source"),
    };
  }, [
    desiredMp4SourceDimensions.height,
    desiredMp4SourceDimensions.width,
    supportedMp4SourceDimensions.encoderPath,
    supportedMp4SourceDimensions.height,
    supportedMp4SourceDimensions.width,
  ]);

  const ensureSupportedMp4SourceDimensions = useCallback(
    async (frameRate: ExportMp4FrameRate) => {
      const result = await probeSupportedMp4Dimensions({
        width: desiredMp4SourceDimensions.width,
        height: desiredMp4SourceDimensions.height,
        frameRate,
        codec: DEFAULT_MP4_CODEC,
        getBitrate: getSourceQualityBitrate,
      });

      if (!result.encoderPath) {
        throw new Error(
          `Video encoding not supported on this system. Tried codec ${DEFAULT_MP4_CODEC} at ${frameRate} FPS up to ${desiredMp4SourceDimensions.width}x${desiredMp4SourceDimensions.height}.`,
        );
      }

      setSupportedMp4SourceDimensions((current) => {
        if (
          current.width === result.width &&
          current.height === result.height &&
          current.capped === result.capped &&
          current.encoderPath?.codec === result.encoderPath?.codec &&
          current.encoderPath?.hardwareAcceleration ===
            result.encoderPath?.hardwareAcceleration
        ) {
          return current;
        }

        return result;
      });

      return result;
    },
    [desiredMp4SourceDimensions.height, desiredMp4SourceDimensions.width],
  );

  useEffect(() => {
    let cancelled = false;
    const requestId = mp4SupportRequestRef.current + 1;
    mp4SupportRequestRef.current = requestId;
    setSupportedMp4SourceDimensions({
      width: desiredMp4SourceDimensions.width,
      height: desiredMp4SourceDimensions.height,
      capped: false,
      encoderPath: null,
    });

    void ensureSupportedMp4SourceDimensions(mp4FrameRate)
      .then((result) => {
        if (cancelled || requestId !== mp4SupportRequestRef.current) {
          return;
        }
        setSupportedMp4SourceDimensions(result);
      })
      .catch(() => {
        if (cancelled || requestId !== mp4SupportRequestRef.current) {
          return;
        }
        setSupportedMp4SourceDimensions({
          width: desiredMp4SourceDimensions.width,
          height: desiredMp4SourceDimensions.height,
          capped: false,
          encoderPath: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    desiredMp4SourceDimensions.height,
    desiredMp4SourceDimensions.width,
    ensureSupportedMp4SourceDimensions,
    mp4FrameRate,
  ]);

  const editorSectionButtons = useEditorSectionButtons(t);

  useEffect(() => {
    if (activeEffectSection === "frame" || activeEffectSection === "crop") {
      setActiveEffectSection("scene");
    }
  }, [activeEffectSection]);

  const buildPersistedEditorState = useCallback(
    (
      editor: Partial<{
        wallpaper: string;
        shadowIntensity: number;
        backgroundBlur: number;
        zoomMotionBlur: number;
        zoomMotionBlurTuning: ZoomMotionBlurTuning;
        zoomTemporalMotionBlur: number;
        zoomMotionBlurSampleCount: number | null;
        zoomMotionBlurShutterFraction: number | null;
        connectZooms: boolean;
        zoomInDurationMs: number;
        zoomInOverlapMs: number;
        zoomOutDurationMs: number;
        connectedZoomGapMs: number;
        connectedZoomDurationMs: number;
        zoomInEasing: ZoomTransitionEasing;
        zoomOutEasing: ZoomTransitionEasing;
        connectedZoomEasing: ZoomTransitionEasing;
        showCursor: boolean;
        loopCursor: boolean;
        cursorStyle: CursorStyle;
        cursorSize: number;
        cursorSmoothing: number;
        cursorSpringStiffnessMultiplier: number;
        cursorSpringDampingMultiplier: number;
        cursorSpringMassMultiplier: number;
        cameraSpringStiffnessMultiplier: number;
        cameraSpringDampingMultiplier: number;
        cameraSpringMassMultiplier: number;
        zoomSmoothness: number;
        zoomClassicMode: boolean;
        cursorMotionBlur: number;
        cursorClickBounce: number;
        cursorClickBounceDuration: number;
        cursorClickEffect: CursorClickEffectSettings;
        cursorSway: number;
        overlayLayerOrder: OverlayLayerOrder;
        borderRadius: number;
        padding: Padding;
        frame: string | null;
        cropRegion: CropRegion;
        webcam: WebcamOverlaySettings;
        zoomRegions: ZoomRegion[];
        trimRegions: TrimRegion[];
        clipRegions: ClipRegion[];
        speedRegions: SpeedRegion[];
        annotationRegions: AnnotationRegion[];
        audioRegions: AudioRegion[];
        autoCaptions: CaptionCue[];
        autoCaptionSettings: AutoCaptionSettings;
        aspectRatio: AspectRatio;
        exportEncodingMode: ExportEncodingMode;
        exportBackendPreference: ExportBackendPreference;
        exportPipelineModel: ExportPipelineModel;
        exportQuality: ExportQuality;
        mp4FrameRate: ExportMp4FrameRate;
        exportFormat: ExportFormat;
        gifFrameRate: GifFrameRate;
        gifLoop: boolean;
        gifSizePreset: GifSizePreset;
      }>,
    ) => {
      return editor;
    },
    [],
  );

  const currentSourcePath = useMemo(
    () => videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null),
    [videoPath, videoSourcePath],
  );
  const {
    hasEmbeddedSourceAudio,
    externalAudioPaths: previewSourceAudioFallbackPaths,
  } = useMemo(
    () =>
      resolveSourceAudioFallbackPaths(
        currentSourcePath,
        sourceAudioFallbackPaths,
      ),
    [currentSourcePath, sourceAudioFallbackPaths],
  );
  const shouldMutePreviewVideo =
    !hasEmbeddedSourceAudio && previewSourceAudioFallbackPaths.length > 0;

  useEffect(() => {
    let cancelled = false;
    setSourceAudioFallbackPaths([]);
    setSourceAudioFallbackStartDelayMsByPath({});

    if (!currentSourcePath) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const result =
          await window.electronAPI.getVideoAudioFallbackPaths(
            currentSourcePath,
          );
        if (cancelled) {
          return;
        }
        if (!result.success) {
          setSourceAudioFallbackPaths([]);
          setSourceAudioFallbackStartDelayMsByPath({});
          toast.warning(
            result.error
              ? `Could not load companion audio sources: ${summarizeErrorMessage(result.error)}`
              : "Could not load companion audio sources. Playback and export may miss microphone audio.",
            { id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
          );
          return;
        }

        toast.dismiss(SOURCE_AUDIO_FALLBACK_TOAST_ID);
        setSourceAudioFallbackPaths(result.paths ?? []);
        setSourceAudioFallbackStartDelayMsByPath(
          result.startDelayMsByPath ?? {},
        );
      } catch (error) {
        if (!cancelled) {
          setSourceAudioFallbackPaths([]);
          setSourceAudioFallbackStartDelayMsByPath({});
          toast.warning(
            `Could not load companion audio sources: ${summarizeErrorMessage(String(error))}`,
            { id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentSourcePath, workspaceReloadVersion]);

  const projectDisplayName = useMemo(() => {
    const fileName =
      currentProjectPath?.split(/[\\/]/).pop() ??
      currentSourcePath?.split(/[\\/]/).pop() ??
      "";
    const withoutExtension = fileName
      .replace(/\.quiro$/i, "")
      .replace(/\.[^.]+$/, "");
    return withoutExtension || t("editor.project.untitled", "Untitled");
  }, [currentProjectPath, currentSourcePath, t]);

  const currentPersistedEditorState = useMemo(
    () =>
      buildPersistedEditorState({
        wallpaper,
        shadowIntensity,
        backgroundBlur,
        zoomMotionBlur,
        zoomMotionBlurTuning,
        zoomTemporalMotionBlur,
        zoomMotionBlurSampleCount,
        zoomMotionBlurShutterFraction,
        connectZooms,
        zoomInDurationMs,
        zoomInOverlapMs,
        zoomOutDurationMs,
        connectedZoomGapMs,
        connectedZoomDurationMs,
        zoomInEasing,
        zoomOutEasing,
        connectedZoomEasing,
        showCursor,
        loopCursor,
        cursorStyle,
        cursorSize,
        cursorSmoothing,
        cursorSpringStiffnessMultiplier,
        cursorSpringDampingMultiplier,
        cursorSpringMassMultiplier,
        cameraSpringStiffnessMultiplier,
        cameraSpringDampingMultiplier,
        cameraSpringMassMultiplier,
        zoomSmoothness,
        zoomClassicMode,
        cursorMotionBlur,
        cursorClickBounce,
        cursorClickBounceDuration,
        cursorClickEffect,
        cursorSway,
        overlayLayerOrder,
        borderRadius,
        padding,
        frame,
        cropRegion,
        webcam,
        zoomRegions,
        trimRegions,
        clipRegions,
        speedRegions,
        annotationRegions,
        audioRegions,
        autoCaptions,
        autoCaptionSettings,
        aspectRatio,
        exportEncodingMode,
        exportBackendPreference,
        exportPipelineModel,
        exportQuality,
        mp4FrameRate,
        exportFormat,
        gifFrameRate,
        gifLoop,
        gifSizePreset,
      }),
    [
      buildPersistedEditorState,
      wallpaper,
      shadowIntensity,
      backgroundBlur,
      zoomMotionBlur,
      zoomMotionBlurTuning,
      zoomTemporalMotionBlur,
      zoomMotionBlurSampleCount,
      zoomMotionBlurShutterFraction,
      connectZooms,
      zoomInDurationMs,
      zoomInOverlapMs,
      zoomOutDurationMs,
      connectedZoomGapMs,
      connectedZoomDurationMs,
      zoomInEasing,
      zoomOutEasing,
      connectedZoomEasing,
      showCursor,
      loopCursor,
      cursorStyle,
      cursorSize,
      cursorSmoothing,
      cursorSpringStiffnessMultiplier,
      cursorSpringDampingMultiplier,
      cursorSpringMassMultiplier,
      cameraSpringStiffnessMultiplier,
      cameraSpringDampingMultiplier,
      cameraSpringMassMultiplier,
      zoomSmoothness,
      zoomClassicMode,
      cursorMotionBlur,
      cursorClickBounce,
      cursorClickBounceDuration,
      cursorClickEffect,
      cursorSway,
      overlayLayerOrder,
      borderRadius,
      padding,
      cropRegion,
      webcam,
      zoomRegions,
      trimRegions,
      clipRegions,
      speedRegions,
      annotationRegions,
      audioRegions,
      autoCaptions,
      autoCaptionSettings,
      aspectRatio,
      exportEncodingMode,
      exportBackendPreference,
      exportPipelineModel,
      exportQuality,
      mp4FrameRate,
      exportFormat,
      gifFrameRate,
      gifLoop,
      gifSizePreset,
      frame,
    ],
  );

  const buildHistorySnapshot = useCallback((): EditorHistorySnapshot => {
    return {
      zoomRegions,
      clipRegions,
      speedRegions,
      annotationRegions,
      audioRegions,
      autoCaptions,
      selectedZoomId,
      selectedClipId,
      selectedAnnotationId,
      selectedAudioId,
    };
  }, [
    zoomRegions,
    clipRegions,
    speedRegions,
    annotationRegions,
    audioRegions,
    autoCaptions,
    selectedZoomId,
    selectedClipId,
    selectedAnnotationId,
    selectedAudioId,
  ]);

  const applyHistorySnapshot = useCallback(
    (snapshot: EditorHistorySnapshot) => {
      applyingHistoryRef.current = true;
      const cloned = cloneSnapshot(snapshot);
      setZoomRegions(cloned.zoomRegions);
      setClipRegions(cloned.clipRegions);
      setSpeedRegions(cloned.speedRegions);
      setAnnotationRegions(cloned.annotationRegions);
      setAudioRegions(cloned.audioRegions);
      setAutoCaptions(cloned.autoCaptions);
      setSelectedZoomId(cloned.selectedZoomId);
      setSelectedClipId(cloned.selectedClipId);
      setSelectedAnnotationId(cloned.selectedAnnotationId);
      setSelectedAudioId(cloned.selectedAudioId);

      nextZoomIdRef.current = deriveNextId(
        "zoom",
        cloned.zoomRegions.map((region) => region.id),
      );
      nextClipIdRef.current = deriveNextId(
        "clip",
        cloned.clipRegions.map((region) => region.id),
      );
      nextAnnotationIdRef.current = deriveNextId(
        "annotation",
        cloned.annotationRegions.map((region) => region.id),
      );
      nextAudioIdRef.current = deriveNextId(
        "audio",
        cloned.audioRegions.map((region) => region.id),
      );
      nextAnnotationZIndexRef.current =
        cloned.annotationRegions.reduce(
          (max, region) => Math.max(max, region.zIndex),
          0,
        ) + 1;
    },
    [cloneSnapshot],
  );

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;

    const nextIndex = historyIndexRef.current - 1;
    const entry = historyEntriesRef.current[nextIndex];
    if (!entry) return;

    historyIndexRef.current = nextIndex;
    applyHistorySnapshot(entry.snapshot);
    syncHistoryButtons();
  }, [applyHistorySnapshot, syncHistoryButtons]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyEntriesRef.current.length - 1) {
      return;
    }

    const nextIndex = historyIndexRef.current + 1;
    const entry = historyEntriesRef.current[nextIndex];
    if (!entry) return;

    historyIndexRef.current = nextIndex;
    applyHistorySnapshot(entry.snapshot);
    syncHistoryButtons();
  }, [applyHistorySnapshot, syncHistoryButtons]);

  const jumpHistoryTo = useCallback(
    (entryId: string) => {
      const nextIndex = findHistoryIndex(historyEntriesRef.current, entryId);
      if (nextIndex < 0 || nextIndex === historyIndexRef.current) {
        return;
      }

      const entry = historyEntriesRef.current[nextIndex];
      if (!entry) return;

      historyIndexRef.current = nextIndex;
      applyHistorySnapshot(entry.snapshot);
      syncHistoryButtons();
    },
    [applyHistorySnapshot, syncHistoryButtons],
  );

  const applyLoadedProject = useCallback(
    async (candidate: unknown, path?: string | null) => {
      if (!validateProjectData(candidate)) {
        return false;
      }

      const project = candidate;
      const sourcePath = fromFileUrl(project.videoPath);
      const normalizedEditor = normalizeProjectEditor(project.editor);

      try {
        videoPlaybackRef.current?.pause();
      } catch {
        // no-op
      }
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setCursorTelemetry([]);
      setCursorTelemetrySourcePath(null);
      setResolvedWebcamVideoUrl(null);
      setSourceAudioFallbackPaths([]);
      setSourceAudioFallbackStartDelayMsByPath({});
      autoSuggestedVideoPathRef.current = null;
      pendingFreshRecordingAutoZoomPathRef.current = null;
      if (pendingTelemetryRetryTimeoutRef.current !== null) {
        window.clearTimeout(pendingTelemetryRetryTimeoutRef.current);
        pendingTelemetryRetryTimeoutRef.current = null;
      }

      setError(null);
      setVideoSourcePath(sourcePath);
      setVideoPath(await resolveVideoUrl(sourcePath));
      setCurrentProjectPath(path ?? null);
      if (normalizedEditor.webcam.sourcePath) {
        await window.electronAPI.setCurrentRecordingSession?.(
          {
            videoPath: sourcePath,
            webcamPath: normalizedEditor.webcam.sourcePath,
            timeOffsetMs: normalizedEditor.webcam.timeOffsetMs,
          },
          {
            preserveProjectPath: Boolean(path),
          },
        );
      } else {
        await window.electronAPI.setCurrentVideoPath(sourcePath, {
          preserveProjectPath: Boolean(path),
        });
      }
      const sessionResult =
        await window.electronAPI.getCurrentRecordingSession?.();
      applySessionPresentation(
        sessionResult?.success ? sessionResult.session : null,
      );

      setWallpaper(normalizedEditor.wallpaper);
      setShadowIntensity(normalizedEditor.shadowIntensity);
      setBackgroundBlur(normalizedEditor.backgroundBlur);
      setZoomMotionBlur(normalizedEditor.zoomMotionBlur);
      setZoomMotionBlurTuning({ ...normalizedEditor.zoomMotionBlurTuning });
      setZoomTemporalMotionBlur(normalizedEditor.zoomTemporalMotionBlur);
      setZoomMotionBlurSampleCount(normalizedEditor.zoomMotionBlurSampleCount);
      setZoomMotionBlurShutterFraction(
        normalizedEditor.zoomMotionBlurShutterFraction,
      );
      setConnectZooms(normalizedEditor.connectZooms);
      setZoomInDurationMs(normalizedEditor.zoomInDurationMs);
      setZoomInOverlapMs(normalizedEditor.zoomInOverlapMs);
      setZoomOutDurationMs(normalizedEditor.zoomOutDurationMs);
      setConnectedZoomGapMs(normalizedEditor.connectedZoomGapMs);
      setConnectedZoomDurationMs(normalizedEditor.connectedZoomDurationMs);
      setZoomInEasing(normalizedEditor.zoomInEasing);
      setZoomOutEasing(normalizedEditor.zoomOutEasing);
      setConnectedZoomEasing(normalizedEditor.connectedZoomEasing);
      setShowCursor(normalizedEditor.showCursor);
      setLoopCursor(normalizedEditor.loopCursor);
      setCursorStyle(normalizedEditor.cursorStyle);
      setCursorSize(normalizedEditor.cursorSize);
      setCursorSmoothing(normalizedEditor.cursorSmoothing);
      setCursorSpringStiffnessMultiplier(
        normalizedEditor.cursorSpringStiffnessMultiplier,
      );
      setCursorSpringDampingMultiplier(
        normalizedEditor.cursorSpringDampingMultiplier,
      );
      setCursorSpringMassMultiplier(
        normalizedEditor.cursorSpringMassMultiplier,
      );
      setCameraSpringStiffnessMultiplier(
        normalizedEditor.cameraSpringStiffnessMultiplier,
      );
      setCameraSpringDampingMultiplier(
        normalizedEditor.cameraSpringDampingMultiplier,
      );
      setCameraSpringMassMultiplier(
        normalizedEditor.cameraSpringMassMultiplier,
      );
      setZoomSmoothness(normalizedEditor.zoomSmoothness);
      setZoomClassicMode(normalizedEditor.zoomClassicMode);
      setCursorMotionBlur(normalizedEditor.cursorMotionBlur);
      setCursorClickBounce(normalizedEditor.cursorClickBounce);
      setCursorClickBounceDuration(normalizedEditor.cursorClickBounceDuration);
      setCursorClickEffect(normalizedEditor.cursorClickEffect);
      setCursorSway(normalizedEditor.cursorSway);
      setOverlayLayerOrder(normalizedEditor.overlayLayerOrder);
      setProjectSnapshots(normalizeProjectSnapshots(project.snapshots));
      setBorderRadius(normalizedEditor.borderRadius);
      setPadding(normalizedEditor.padding);
      setFrame(normalizedEditor.frame);
      setCropRegion(normalizedEditor.cropRegion);
      setWebcam(normalizedEditor.webcam);
      setZoomRegions(normalizedEditor.zoomRegions);
      setTrimRegions(normalizedEditor.trimRegions);
      setClipRegions(normalizedEditor.clipRegions);
      clipInitializedRef.current = normalizedEditor.clipRegions.length > 0;
      autoFullTrackClipIdRef.current = null;
      autoFullTrackClipEndMsRef.current = null;
      setSpeedRegions(normalizedEditor.speedRegions);
      setAnnotationRegions(normalizedEditor.annotationRegions);
      setAudioRegions(normalizedEditor.audioRegions);
      setAutoCaptions(normalizedEditor.autoCaptions);
      setAutoCaptionSettings(normalizedEditor.autoCaptionSettings);
      setAspectRatio(normalizedEditor.aspectRatio);
      setExportEncodingMode(normalizedEditor.exportEncodingMode);
      setExportBackendPreference(normalizedEditor.exportBackendPreference);
      setExportPipelineModel(normalizedEditor.exportPipelineModel);
      setExportQuality(normalizedEditor.exportQuality);
      setMp4FrameRate(normalizedEditor.mp4FrameRate);
      setExportFormat(normalizedEditor.exportFormat);
      setGifFrameRate(normalizedEditor.gifFrameRate);
      setGifLoop(normalizedEditor.gifLoop);
      setGifSizePreset(normalizedEditor.gifSizePreset);

      setSelectedZoomId(null);
      setSelectedClipId(null);
      setSelectedAnnotationId(null);
      setSelectedAudioId(null);

      nextZoomIdRef.current = deriveNextId(
        "zoom",
        normalizedEditor.zoomRegions.map((region) => region.id),
      );
      nextClipIdRef.current = deriveNextId(
        "clip",
        normalizedEditor.clipRegions.map((region: ClipRegion) => region.id),
      );
      nextAudioIdRef.current = deriveNextId(
        "audio",
        normalizedEditor.audioRegions.map((region) => region.id),
      );
      nextAnnotationIdRef.current = deriveNextId(
        "annotation",
        normalizedEditor.annotationRegions.map((region) => region.id),
      );
      nextAnnotationZIndexRef.current =
        normalizedEditor.annotationRegions.reduce(
          (max, region) => Math.max(max, region.zIndex),
          0,
        ) + 1;

      historyEntriesRef.current = [];
      historyIndexRef.current = -1;
      applyingHistoryRef.current = false;
      syncHistoryButtons();

      setLastSavedSnapshot(
        cloneStructured(
          createProjectData(
            sourcePath,
            buildPersistedEditorState(normalizedEditor),
            project.projectId ?? null,
            normalizeProjectSnapshots(project.snapshots),
          ),
        ),
      );
      remountProjectWorkspace();
      await refreshProjectLibrary();
      return true;
    },
    [
      buildPersistedEditorState,
      refreshProjectLibrary,
      remountProjectWorkspace,
      syncHistoryButtons,
    ],
  );

  const currentProjectSnapshot = useMemo(() => {
    if (!currentSourcePath) {
      return null;
    }
    return createProjectData(
      currentSourcePath,
      currentPersistedEditorState,
      lastSavedSnapshot?.projectId ?? null,
      projectSnapshots,
    );
  }, [
    currentPersistedEditorState,
    currentSourcePath,
    lastSavedSnapshot?.projectId,
    projectSnapshots,
  ]);

  const createProjectSnapshot = useCallback(
    (reason: ProjectSnapshot["reason"] = "manual", name?: string) => {
      const snapshot: ProjectSnapshot = {
        id: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name:
          name ??
          (reason === "manual"
            ? `Snapshot ${new Date().toLocaleTimeString()}`
            : "Auto snapshot"),
        createdAt: new Date().toISOString(),
        reason,
        editor: cloneStructured(currentPersistedEditorState),
      };
      setProjectSnapshots((prev) => [snapshot, ...prev].slice(0, 20));
      if (reason === "manual") {
        toast.success("Snapshot created");
      }
      return snapshot;
    },
    [currentPersistedEditorState],
  );

  const handleCreateManualSnapshot = useCallback(() => {
    createProjectSnapshot("manual");
  }, [createProjectSnapshot]);

  const handleOpenNativeCaptureUnavailableModal = useCallback(() => {
    setNativeCaptureUnavailableModalOpen(true);
  }, []);

  const restoreProjectSnapshot = useCallback(
    (snapshotId: string) => {
      const snapshot = projectSnapshots.find((item) => item.id === snapshotId);
      if (!snapshot) return;
      createProjectSnapshot("auto", "Before snapshot restore");
      const normalizedEditor = normalizeProjectEditor(snapshot.editor);
      setWallpaper(normalizedEditor.wallpaper);
      setShadowIntensity(normalizedEditor.shadowIntensity);
      setBackgroundBlur(normalizedEditor.backgroundBlur);
      setZoomMotionBlur(normalizedEditor.zoomMotionBlur);
      setZoomMotionBlurTuning(normalizedEditor.zoomMotionBlurTuning);
      setZoomTemporalMotionBlur(normalizedEditor.zoomTemporalMotionBlur);
      setZoomMotionBlurSampleCount(normalizedEditor.zoomMotionBlurSampleCount);
      setZoomMotionBlurShutterFraction(
        normalizedEditor.zoomMotionBlurShutterFraction,
      );
      setConnectZooms(normalizedEditor.connectZooms);
      setZoomInDurationMs(normalizedEditor.zoomInDurationMs);
      setZoomInOverlapMs(normalizedEditor.zoomInOverlapMs);
      setZoomOutDurationMs(normalizedEditor.zoomOutDurationMs);
      setConnectedZoomGapMs(normalizedEditor.connectedZoomGapMs);
      setConnectedZoomDurationMs(normalizedEditor.connectedZoomDurationMs);
      setZoomInEasing(normalizedEditor.zoomInEasing);
      setZoomOutEasing(normalizedEditor.zoomOutEasing);
      setConnectedZoomEasing(normalizedEditor.connectedZoomEasing);
      setShowCursor(normalizedEditor.showCursor);
      setLoopCursor(normalizedEditor.loopCursor);
      setCursorStyle(normalizedEditor.cursorStyle);
      setCursorSize(normalizedEditor.cursorSize);
      setCursorSmoothing(normalizedEditor.cursorSmoothing);
      setCursorSpringStiffnessMultiplier(
        normalizedEditor.cursorSpringStiffnessMultiplier,
      );
      setCursorSpringDampingMultiplier(
        normalizedEditor.cursorSpringDampingMultiplier,
      );
      setCursorSpringMassMultiplier(
        normalizedEditor.cursorSpringMassMultiplier,
      );
      setCameraSpringStiffnessMultiplier(
        normalizedEditor.cameraSpringStiffnessMultiplier,
      );
      setCameraSpringDampingMultiplier(
        normalizedEditor.cameraSpringDampingMultiplier,
      );
      setCameraSpringMassMultiplier(
        normalizedEditor.cameraSpringMassMultiplier,
      );
      setZoomSmoothness(normalizedEditor.zoomSmoothness);
      setZoomClassicMode(normalizedEditor.zoomClassicMode);
      setCursorMotionBlur(normalizedEditor.cursorMotionBlur);
      setCursorClickBounce(normalizedEditor.cursorClickBounce);
      setCursorClickBounceDuration(normalizedEditor.cursorClickBounceDuration);
      setCursorClickEffect(normalizedEditor.cursorClickEffect);
      setCursorSway(normalizedEditor.cursorSway);
      setOverlayLayerOrder(normalizedEditor.overlayLayerOrder);
      setBorderRadius(normalizedEditor.borderRadius);
      setPadding(normalizedEditor.padding);
      setFrame(normalizedEditor.frame);
      setCropRegion(normalizedEditor.cropRegion);
      setWebcam(normalizedEditor.webcam);
      setZoomRegions(normalizedEditor.zoomRegions);
      setTrimRegions(normalizedEditor.trimRegions);
      setClipRegions(normalizedEditor.clipRegions);
      setSpeedRegions(normalizedEditor.speedRegions);
      setAnnotationRegions(normalizedEditor.annotationRegions);
      setAudioRegions(normalizedEditor.audioRegions);
      setAutoCaptions(normalizedEditor.autoCaptions);
      setAutoCaptionSettings(normalizedEditor.autoCaptionSettings);
      setAspectRatio(normalizedEditor.aspectRatio);
      setExportEncodingMode(normalizedEditor.exportEncodingMode);
      setExportBackendPreference(normalizedEditor.exportBackendPreference);
      setExportPipelineModel(normalizedEditor.exportPipelineModel);
      setExportQuality(normalizedEditor.exportQuality);
      setMp4FrameRate(normalizedEditor.mp4FrameRate);
      setExportFormat(normalizedEditor.exportFormat);
      setGifFrameRate(normalizedEditor.gifFrameRate);
      setGifLoop(normalizedEditor.gifLoop);
      setGifSizePreset(normalizedEditor.gifSizePreset);
      toast.success("Snapshot restored");
    },
    [createProjectSnapshot, projectSnapshots],
  );

  const syncRecordingSessionWebcam = useCallback(
    async (webcamPath: string | null, timeOffsetMs?: number) => {
      if (
        !currentSourcePath ||
        !window.electronAPI.setCurrentRecordingSession
      ) {
        return;
      }

      await window.electronAPI.setCurrentRecordingSession(
        {
          videoPath: currentSourcePath,
          webcamPath,
          timeOffsetMs:
            webcamPath && Number.isFinite(timeOffsetMs)
              ? (timeOffsetMs ?? DEFAULT_WEBCAM_TIME_OFFSET_MS)
              : webcamPath
                ? webcam.timeOffsetMs
                : DEFAULT_WEBCAM_TIME_OFFSET_MS,
        },
        {
          preserveProjectPath: Boolean(currentProjectPath),
        },
      );
    },
    [currentProjectPath, currentSourcePath, webcam.timeOffsetMs],
  );

  const syncActiveVideoSource = useCallback(
    async (sourcePath: string, webcamPath?: string | null) => {
      if (webcamPath) {
        await window.electronAPI.setCurrentRecordingSession?.(
          {
            videoPath: sourcePath,
            webcamPath,
            timeOffsetMs: webcam.timeOffsetMs,
          },
          {
            preserveProjectPath: Boolean(currentProjectPath),
          },
        );
        return;
      }

      await window.electronAPI.setCurrentVideoPath(sourcePath, {
        preserveProjectPath: Boolean(currentProjectPath),
      });
    },
    [currentProjectPath, webcam.timeOffsetMs],
  );

  const handleUploadWebcam = useCallback(async () => {
    const result = await window.electronAPI.openVideoFilePicker();
    if (!result.success || !result.path) {
      return;
    }

    createProjectSnapshot("auto", "Before replacing webcam");
    setWebcam((prev) => ({
      ...prev,
      enabled: true,
      sourcePath: result.path ?? null,
      timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
    }));

    await syncRecordingSessionWebcam(
      result.path,
      DEFAULT_WEBCAM_TIME_OFFSET_MS,
    );
    toast.success(t("settings.effects.webcamFootageAdded"));
  }, [createProjectSnapshot, syncRecordingSessionWebcam, t]);

  const handleClearWebcam = useCallback(async () => {
    createProjectSnapshot("auto", "Before clearing webcam");
    setWebcam((prev) => ({
      ...prev,
      enabled: false,
      sourcePath: null,
      timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
    }));

    await syncRecordingSessionWebcam(null);
    toast.success(t("settings.effects.webcamFootageRemoved"));
  }, [createProjectSnapshot, syncRecordingSessionWebcam, t]);

  useEffect(() => {
    if (historyBatchDepthRef.current > 0) {
      return;
    }

    const snapshot = buildHistorySnapshot();
    const currentEntry =
      historyIndexRef.current >= 0
        ? historyEntriesRef.current[historyIndexRef.current]
        : null;

    if (!currentEntry) {
      historyEntriesRef.current = [
        createHistoryEntry(cloneSnapshot(snapshot), "Initial state"),
      ];
      historyIndexRef.current = 0;
      syncHistoryButtons();
      return;
    }

    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      syncHistoryButtons();
      return;
    }

    if (areDeepEqual(currentEntry.snapshot, snapshot)) {
      return;
    }

    const label = describeHistoryChange(currentEntry.snapshot, snapshot);
    const next = appendHistoryEntry(
      historyEntriesRef.current,
      historyIndexRef.current,
      createHistoryEntry(cloneSnapshot(snapshot), label),
    );
    historyEntriesRef.current = next.entries;
    historyIndexRef.current = next.index;
    syncHistoryButtons();
  }, [buildHistorySnapshot, cloneSnapshot, syncHistoryButtons]);

  const hasUnsavedChanges = useMemo(
    () =>
      Boolean(
        currentProjectSnapshot &&
        (!lastSavedSnapshot ||
          !areDeepEqual(currentProjectSnapshot, lastSavedSnapshot)),
      ),
    [currentProjectSnapshot, lastSavedSnapshot],
  );

  useEffect(() => {
    async function loadInitialData() {
      try {
        if (smokeExportConfig.enabled && smokeExportConfig.projectPath) {
          const projectResult = await window.electronAPI.openProjectFileAtPath(
            smokeExportConfig.projectPath,
          );
          if (!projectResult.success || !projectResult.project) {
            setError(
              `Smoke export failed to load project ${smokeExportConfig.projectPath}: ${
                projectResult.error || projectResult.message || "unknown error"
              }`,
            );
            return;
          }
          const restored = await applyLoadedProject(
            projectResult.project,
            projectResult.path ?? smokeExportConfig.projectPath,
          );
          if (!restored) {
            setError(
              `Smoke export could not apply project ${smokeExportConfig.projectPath}`,
            );
            return;
          }
          setError(null);
          return;
        }

        if (!smokeExportConfig.enabled && devOpenRecordingConfig.inputPath) {
          const sourcePath = fromFileUrl(devOpenRecordingConfig.inputPath);
          const sourceVideoUrl = await resolveVideoUrl(sourcePath);
          const webcamSourcePath = devOpenRecordingConfig.webcamInputPath
            ? fromFileUrl(devOpenRecordingConfig.webcamInputPath)
            : null;
          setVideoSourcePath(sourcePath);
          setVideoPath(sourceVideoUrl);
          setCurrentProjectPath(null);
          setLastSavedSnapshot(null);
          pendingFreshRecordingAutoZoomPathRef.current =
            autoApplyFreshRecordingAutoZooms ? sourceVideoUrl : null;
          setWebcam((prev) => ({
            ...prev,
            enabled: Boolean(webcamSourcePath),
            sourcePath: webcamSourcePath,
            timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
          }));
          setError(null);
          return;
        }

        if (smokeExportConfig.enabled) {
          if (!smokeExportConfig.inputPath) {
            setError("Smoke export input path is missing.");
            return;
          }

          const sourcePath = fromFileUrl(smokeExportConfig.inputPath);
          const sourceVideoUrl = await resolveVideoUrl(sourcePath);
          const smokeWebcamSourcePath = smokeExportConfig.webcamInputPath
            ? fromFileUrl(smokeExportConfig.webcamInputPath)
            : null;
          setVideoSourcePath(sourcePath);
          setVideoPath(sourceVideoUrl);
          setCurrentProjectPath(null);
          setLastSavedSnapshot(null);
          pendingFreshRecordingAutoZoomPathRef.current = null;
          setWebcam((prev) => ({
            ...prev,
            enabled: !!smokeWebcamSourcePath,
            sourcePath: smokeWebcamSourcePath,
            timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
            shadow:
              smokeExportConfig.webcamShadow === undefined
                ? prev.shadow
                : smokeExportConfig.webcamShadow,
            size:
              smokeExportConfig.webcamSize === undefined
                ? prev.size
                : smokeExportConfig.webcamSize,
          }));
          setError(null);
          return;
        }

        const currentProjectResult =
          await window.electronAPI.loadCurrentProjectFile();
        if (currentProjectResult.success && currentProjectResult.project) {
          const restored = await applyLoadedProject(
            currentProjectResult.project,
            currentProjectResult.path ?? null,
          );
          if (restored) {
            // Re-apply user preferences so stale project data does not
            // overwrite the last-used padding, aspect ratio, export
            // settings, etc. that were saved to localStorage.
            setPadding(initialEditorPreferences.padding);
            setBorderRadius(initialEditorPreferences.borderRadius);
            setAspectRatio(initialEditorPreferences.aspectRatio);
            setExportFormat(initialEditorPreferences.exportFormat);
            setMp4FrameRate(
              initialEditorPreferences.mp4FrameRate ??
                DEFAULT_MP4_EXPORT_FRAME_RATE,
            );
            setExportQuality(initialEditorPreferences.exportQuality);
            setExportEncodingMode(initialEditorPreferences.exportEncodingMode);
            setExportBackendPreference(
              initialEditorPreferences.exportBackendPreference,
            );
            setExportPipelineModel(
              initialEditorPreferences.exportPipelineModel,
            );
            setGifFrameRate(initialEditorPreferences.gifFrameRate);
            setGifLoop(initialEditorPreferences.gifLoop);
            setGifSizePreset(initialEditorPreferences.gifSizePreset);
            return;
          }
        }

        const sessionResult =
          await window.electronAPI.getCurrentRecordingSession?.();
        if (sessionResult?.success && sessionResult.session?.videoPath) {
          const sourcePath = fromFileUrl(sessionResult.session.videoPath);
          const sourceVideoUrl = await resolveVideoUrl(sourcePath);
          setVideoSourcePath(sourcePath);
          setVideoPath(sourceVideoUrl);
          setCurrentProjectPath(null);
          setLastSavedSnapshot(null);
          pendingFreshRecordingAutoZoomPathRef.current =
            autoApplyFreshRecordingAutoZooms ? sourceVideoUrl : null;
          applySessionPresentation(sessionResult.session);
          setWebcam((prev) => ({
            ...prev,
            enabled: Boolean(sessionResult.session?.webcamPath),
            sourcePath: sessionResult.session?.webcamPath ?? null,
            timeOffsetMs:
              sessionResult.session?.timeOffsetMs ??
              DEFAULT_WEBCAM_TIME_OFFSET_MS,
          }));
          return;
        }

        const result = await window.electronAPI.getCurrentVideoPath();
        if (result.success && result.path) {
          const sourcePath = fromFileUrl(result.path);
          const sourceVideoUrl = await resolveVideoUrl(sourcePath);
          setVideoSourcePath(sourcePath);
          setVideoPath(sourceVideoUrl);
          setCurrentProjectPath(null);
          setLastSavedSnapshot(null);
          pendingFreshRecordingAutoZoomPathRef.current = null;
          applySessionPresentation(null);
          setWebcam((prev) => ({
            ...prev,
            enabled: false,
            sourcePath: null,
            timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
          }));
        } else {
          setError("No video to load. Please record or select a video.");
        }
      } catch (err) {
        setError("Error loading video: " + String(err));
      } finally {
        setLoading(false);
      }
    }

    loadInitialData();
  }, [
    applyLoadedProject,
    applySessionPresentation,
    autoApplyFreshRecordingAutoZooms,
    devOpenRecordingConfig.inputPath,
    devOpenRecordingConfig.webcamInputPath,
    initialEditorPreferences,
    smokeExportConfig.enabled,
    smokeExportConfig.inputPath,
    smokeExportConfig.projectPath,
    smokeExportConfig.webcamInputPath,
    smokeExportConfig.webcamShadow,
    smokeExportConfig.webcamSize,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!webcam.sourcePath) {
      setResolvedWebcamVideoUrl(null);
      return;
    }
    void resolveVideoUrl(webcam.sourcePath).then((url) => {
      if (!cancelled) setResolvedWebcamVideoUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [webcam.sourcePath, workspaceReloadVersion]);

  useEffect(() => {
    if (!autoApplyFreshRecordingAutoZooms) {
      pendingFreshRecordingAutoZoomPathRef.current = null;
    }
  }, [autoApplyFreshRecordingAutoZooms]);

  useEffect(() => {
    saveEditorPreferences({
      wallpaper,
      shadowIntensity,
      backgroundBlur,
      zoomMotionBlur,
      zoomMotionBlurTuning,
      zoomTemporalMotionBlur,
      zoomMotionBlurSampleCount,
      zoomMotionBlurShutterFraction,
      autoApplyFreshRecordingAutoZooms,
      connectZooms,
      zoomInDurationMs,
      zoomInOverlapMs,
      zoomOutDurationMs,
      connectedZoomGapMs,
      connectedZoomDurationMs,
      zoomInEasing,
      zoomOutEasing,
      connectedZoomEasing,
      showCursor,
      loopCursor,
      cursorStyle,
      cursorSize,
      cursorSmoothing,
      cursorSpringStiffnessMultiplier,
      cursorSpringDampingMultiplier,
      cursorSpringMassMultiplier,
      cameraSpringStiffnessMultiplier,
      cameraSpringDampingMultiplier,
      cameraSpringMassMultiplier,
      cursorMotionBlur,
      cursorClickBounce,
      cursorClickBounceDuration,
      cursorSway,
      borderRadius,
      padding,
      frame,
      webcam,
      aspectRatio,
      exportEncodingMode,
      exportBackendPreference,
      exportPipelineModel,
      exportQuality,
      mp4FrameRate,
      exportFormat,
      gifFrameRate,
      gifLoop,
      gifSizePreset,
      timelineDensityMode,
      whisperExecutablePath,
      whisperModelPath,
    });
  }, [
    wallpaper,
    shadowIntensity,
    backgroundBlur,
    zoomMotionBlur,
    zoomMotionBlurTuning,
    zoomTemporalMotionBlur,
    zoomMotionBlurSampleCount,
    zoomMotionBlurShutterFraction,
    autoApplyFreshRecordingAutoZooms,
    connectZooms,
    zoomInDurationMs,
    zoomInOverlapMs,
    zoomOutDurationMs,
    connectedZoomGapMs,
    connectedZoomDurationMs,
    zoomInEasing,
    zoomOutEasing,
    connectedZoomEasing,
    showCursor,
    loopCursor,
    cursorStyle,
    cursorSize,
    cursorSmoothing,
    cursorSpringStiffnessMultiplier,
    cursorSpringDampingMultiplier,
    cursorSpringMassMultiplier,
    cameraSpringStiffnessMultiplier,
    cameraSpringDampingMultiplier,
    cameraSpringMassMultiplier,
    cursorMotionBlur,
    cursorClickBounce,
    cursorClickBounceDuration,
    cursorClickEffect,
    cursorSway,
    borderRadius,
    padding,
    frame,
    webcam,
    aspectRatio,
    exportEncodingMode,
    exportBackendPreference,
    exportPipelineModel,
    exportQuality,
    mp4FrameRate,
    exportFormat,
    gifFrameRate,
    gifLoop,
    gifSizePreset,
    timelineDensityMode,
    whisperExecutablePath,
    whisperModelPath,
  ]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onWhisperSmallModelDownloadProgress(
      (state) => {
        setWhisperModelDownloadStatus(state.status);
        setWhisperModelDownloadProgress(state.progress);
        if (state.status === "downloaded") {
          setDownloadedWhisperModelPath(state.path ?? null);
          setWhisperModelPath(
            (currentPath) => currentPath ?? state.path ?? null,
          );
        }
        if (state.status === "idle") {
          setDownloadedWhisperModelPath(null);
        }
        if (state.status === "error" && state.error) {
          toast.error(state.error);
        }
      },
    );

    void (async () => {
      const result = await window.electronAPI.getWhisperSmallModelStatus();
      if (!result.success) {
        return;
      }

      if (result.exists && result.path) {
        setDownloadedWhisperModelPath(result.path);
        setWhisperModelPath(
          (currentPath) => currentPath ?? result.path ?? null,
        );
        setWhisperModelDownloadStatus("downloaded");
        setWhisperModelDownloadProgress(100);
        return;
      }

      setDownloadedWhisperModelPath(null);
      setWhisperModelDownloadStatus("idle");
      setWhisperModelDownloadProgress(0);
    })();

    return () => unsubscribe?.();
  }, []);

  const handlePickWhisperExecutable = useCallback(async () => {
    const result = await window.electronAPI.openWhisperExecutablePicker();
    if (!result.success || !result.path) {
      return;
    }

    setWhisperExecutablePath(result.path);
    toast.success("Whisper executable selected");
  }, []);

  const handleDownloadWhisperSmallModel = useCallback(async () => {
    if (whisperModelDownloadStatus === "downloading") {
      return;
    }

    setWhisperModelDownloadStatus("downloading");
    setWhisperModelDownloadProgress(0);
    const result = await window.electronAPI.downloadWhisperSmallModel();
    if (!result.success) {
      setWhisperModelDownloadStatus("error");
      toast.error(result.error || "Failed to download Whisper small model");
      return;
    }

    if (result.path) {
      setDownloadedWhisperModelPath(result.path);
      setWhisperModelPath(result.path);
    }
  }, [whisperModelDownloadStatus]);

  const handlePickWhisperModel = useCallback(async () => {
    const result = await window.electronAPI.openWhisperModelPicker();
    if (!result.success || !result.path) {
      return;
    }

    setWhisperModelPath(result.path);
    toast.success("Whisper model selected");
  }, []);

  const handleDeleteWhisperSmallModel = useCallback(async () => {
    const result = await window.electronAPI.deleteWhisperSmallModel();
    if (!result.success) {
      toast.error(result.error || "Failed to delete Whisper small model");
      // Reset download state so re-download is not blocked
      setWhisperModelDownloadStatus("idle");
      setWhisperModelDownloadProgress(0);
      return;
    }

    setWhisperModelPath((currentPath) =>
      currentPath === downloadedWhisperModelPath ? null : currentPath,
    );
    setDownloadedWhisperModelPath(null);
    setWhisperModelDownloadStatus("idle");
    setWhisperModelDownloadProgress(0);
    toast.success("Whisper small model deleted");
  }, [downloadedWhisperModelPath]);

  // Tiny model — check on mount, subscribe to progress, auto-select as default.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onWhisperTinyModelDownloadProgress(
      (state: { status: "idle" | "downloading" | "downloaded" | "error"; progress: number; path?: string | null; error?: string }) => {
        setWhisperTinyModelDownloadStatus(state.status);
        if (state.status === "downloaded" && state.path) {
          setWhisperModelPath((current) => current ?? state.path ?? null);
        }
        if (state.status === "error" && state.error) {
          toast.error(`Speech model download failed: ${state.error}`);
        }
      },
    );

    void (async () => {
      const result = await window.electronAPI.getWhisperTinyModelStatus();
      if (result.exists && result.path) {
        setWhisperTinyModelDownloadStatus("downloaded");
        setWhisperModelPath((current) => current ?? result.path ?? null);
      } else {
        setWhisperTinyModelDownloadStatus("idle");
      }
    })();

    return () => unsubscribe?.();
  }, []);

  const handleDownloadWhisperTinyModel = useCallback(async () => {
    if (whisperTinyModelDownloadStatus === "downloading") return;
    setWhisperTinyModelDownloadStatus("downloading");
    const result = await window.electronAPI.downloadWhisperTinyModel();
    if (!result.success) {
      setWhisperTinyModelDownloadStatus("error");
      toast.error(result.error || "Failed to download speech model");
      return;
    }
    if (result.path) {
      setWhisperModelPath((current) => current ?? result.path ?? null);
    }
  }, [whisperTinyModelDownloadStatus]);

  const handleGenerateAutoCaptions = useCallback(async () => {
    if (isGeneratingCaptions) {
      return;
    }

    let sourcePath = resolveAutoCaptionSourcePath({
      videoSourcePath,
      videoPath,
    });

    if (!sourcePath) {
      const sessionResult =
        await window.electronAPI.getCurrentRecordingSession?.();
      const currentVideoResult = await window.electronAPI.getCurrentVideoPath();
      sourcePath = resolveAutoCaptionSourcePath({
        recordingSessionVideoPath:
          sessionResult?.success && sessionResult.session?.videoPath
            ? sessionResult.session.videoPath
            : null,
        currentVideoPath: currentVideoResult.success
          ? (currentVideoResult.path ?? null)
          : null,
      });
    }

    if (!sourcePath) {
      toast.error("No source video is loaded");
      return;
    }

    if (sourcePath !== videoSourcePath) {
      setVideoSourcePath(sourcePath);
      setVideoPath(await resolveVideoUrl(sourcePath));
    }

    await syncActiveVideoSource(sourcePath, webcam.sourcePath ?? null);

    if (!whisperModelPath) {
      toast.error("Select a Whisper model or download the small model first");
      return;
    }

    setIsGeneratingCaptions(true);
    try {
      const result = await window.electronAPI.generateAutoCaptions({
        videoPath: sourcePath,
        whisperExecutablePath: whisperExecutablePath ?? undefined,
        whisperModelPath,
        language: autoCaptionSettings.language,
      });

      if (!result.success || !result.cues) {
        toast.error(
          result.message ||
            getErrorMessage(result.error) ||
            "Failed to generate captions",
        );
        return;
      }

      setAutoCaptions(result.cues);
      setAutoCaptionSettings((prev) => ({ ...prev, enabled: true }));
      toast.success(
        result.message || `Generated ${result.cues.length} captions`,
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsGeneratingCaptions(false);
    }
  }, [
    autoCaptionSettings.language,
    isGeneratingCaptions,
    webcam.sourcePath,
    syncActiveVideoSource,
    videoPath,
    videoSourcePath,
    whisperExecutablePath,
    whisperModelPath,
  ]);

  const handleClearAutoCaptions = useCallback(() => {
    createProjectSnapshot("auto", "Before clearing captions");
    setAutoCaptions([]);
    setAutoCaptionSettings((prev) => ({ ...prev, enabled: false }));
  }, [createProjectSnapshot]);

  const saveProject = useCallback(
    async (forceSaveAs: boolean, options?: SaveProjectOptions) => {
      clearPendingProjectAutosave();
      return queueProjectSave(async () => {
        if (!currentSourcePath) {
          if (!options?.silent) {
            toast.error("No video loaded");
          }
          return false;
        }

        const shouldCaptureThumbnail = options?.captureThumbnail ?? true;
        const shouldRefreshLibrary = options?.refreshLibraryAfterSave ?? true;
        const shouldRemountPreview = options?.remountPreviewAfterSave ?? true;

        try {
          const projectData =
            currentProjectSnapshot?.videoPath === currentSourcePath
              ? currentProjectSnapshot
              : createProjectData(
                  currentSourcePath,
                  currentPersistedEditorState,
                  lastSavedSnapshot?.projectId ?? null,
                  projectSnapshots,
                );

          const fileNameBase =
            currentSourcePath
              .split(/[\\/]/)
              .pop()
              ?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
          let targetProjectPath = forceSaveAs
            ? undefined
            : (currentProjectPath ?? undefined);

          if (!forceSaveAs && !targetProjectPath) {
            const activeProjectResult =
              await window.electronAPI.loadCurrentProjectFile();
            if (activeProjectResult.success && activeProjectResult.path) {
              targetProjectPath = activeProjectResult.path;
              setCurrentProjectPath(activeProjectResult.path);
            }
          }

          const thumbnailDataUrl = shouldCaptureThumbnail
            ? await captureProjectThumbnail()
            : undefined;

          const result = await window.electronAPI.saveProjectFile(
            projectData,
            fileNameBase,
            targetProjectPath,
            thumbnailDataUrl,
          );

          if (result.canceled) {
            if (!options?.silent) {
              toast.info("Project save canceled");
            }
            return false;
          }

          if (!result.success) {
            if (!options?.silent) {
              toast.error(result.message || "Failed to save project");
            }
            return false;
          }

          if (result.path) {
            setCurrentProjectPath(result.path);
          }
          setLastSavedSnapshot(
            cloneStructured(
              createProjectData(
                projectData.videoPath,
                projectData.editor,
                result.projectId ?? projectData.projectId ?? null,
                projectData.snapshots,
              ),
            ),
          );
          if (shouldRefreshLibrary) {
            await refreshProjectLibrary();
          }

          if (!options?.silent) {
            toast.success(`Project saved to ${result.path}`);
          }
          return true;
        } finally {
          if (shouldRemountPreview) {
            remountPreview();
          }
        }
      });
    },
    [
      captureProjectThumbnail,
      clearPendingProjectAutosave,
      currentSourcePath,
      currentProjectPath,
      currentProjectSnapshot,
      currentPersistedEditorState,
      lastSavedSnapshot?.projectId,
      queueProjectSave,
      refreshProjectLibrary,
      remountPreview,
    ],
  );

  useEffect(() => {
    window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const cleanup = window.electronAPI.onRequestSaveBeforeClose(async () => {
      return saveProject(false);
    });

    return () => cleanup?.();
  }, [saveProject]);

  const handleSaveProject = useCallback(async () => {
    await saveProject(false);
  }, [saveProject]);

  const handleSaveProjectAs = useCallback(async () => {
    const saved = await saveProject(true);
    if (saved) {
      setProjectBrowserOpen(false);
    }
  }, [saveProject]);

  useEffect(() => {
    if (!currentProjectPath || !hasUnsavedChanges) {
      clearPendingProjectAutosave();
      return;
    }

    projectAutosaveTimeoutRef.current = window.setTimeout(() => {
      projectAutosaveTimeoutRef.current = null;
      void saveProject(false, {
        silent: true,
        remountPreviewAfterSave: false,
        refreshLibraryAfterSave: false,
        captureThumbnail: false,
      });
    }, PROJECT_AUTOSAVE_DELAY_MS);

    return () => {
      clearPendingProjectAutosave();
    };
  }, [
    clearPendingProjectAutosave,
    currentProjectPath,
    hasUnsavedChanges,
    saveProject,
  ]);

  /**
   * Saves the current project directly into the projects library under a chosen name.
   */
  const saveProjectWithName = useCallback(
    async (projectName: string) => {
      const trimmedProjectName = projectName.trim();
      if (!trimmedProjectName) {
        toast.error("Project name is required");
        return false;
      }

      if (!currentSourcePath) {
        toast.error("No video loaded");
        return false;
      }

      try {
        const projectData =
          currentProjectSnapshot?.videoPath === currentSourcePath
            ? currentProjectSnapshot
            : createProjectData(
                currentSourcePath,
                currentPersistedEditorState,
                lastSavedSnapshot?.projectId ?? null,
                projectSnapshots,
              );
        const thumbnailDataUrl = await captureProjectThumbnail();
        const result = await window.electronAPI.saveProjectFileNamed(
          projectData,
          trimmedProjectName,
          thumbnailDataUrl,
        );

        if (result.canceled) {
          toast.info("Project save canceled");
          return false;
        }

        if (!result.success) {
          toast.error(result.message || "Failed to save project");
          return false;
        }

        if (result.path) {
          setCurrentProjectPath(result.path);
        }
        setLastSavedSnapshot(
          cloneStructured(
            createProjectData(
              projectData.videoPath,
              projectData.editor,
              result.projectId ?? projectData.projectId ?? null,
              projectData.snapshots,
            ),
          ),
        );
        await refreshProjectLibrary();
        toast.success(
          result.path ? `Project saved to ${result.path}` : "Project saved",
        );
        return true;
      } finally {
        remountPreview();
      }
    },
    [
      captureProjectThumbnail,
      currentPersistedEditorState,
      currentProjectSnapshot,
      currentSourcePath,
      lastSavedSnapshot?.projectId,
      refreshProjectLibrary,
      remountPreview,
    ],
  );

  const handleOpenProjectFromLibrary = useCallback(
    async (projectPath: string) => {
      const normalizeForCompare = (value: string | null | undefined) =>
        value?.replace(/\\/g, "/").toLowerCase() ?? null;
      const isReloadingCurrentProject =
        normalizeForCompare(projectPath) ===
        normalizeForCompare(currentProjectPath);

      const result =
        await window.electronAPI.openProjectFileAtPath(projectPath);

      if (result.canceled) {
        return;
      }

      if (!result.success) {
        toast.error(result.message || "Failed to load project");
        return;
      }

      const restored = await applyLoadedProject(
        result.project,
        result.path ?? null,
      );
      if (!restored) {
        toast.error("Invalid project file format");
        return;
      }

      setProjectBrowserOpen(false);
      await refreshProjectLibrary();
      toast.success(
        isReloadingCurrentProject
          ? "Project repaired and reloaded"
          : `Project loaded from ${result.path}`,
      );
    },
    [applyLoadedProject, currentProjectPath, refreshProjectLibrary],
  );

  const repairCurrentProject = useCallback(
    async (
      _options: { rebuildEditorCaches: boolean } = {
        rebuildEditorCaches: true,
      },
    ) => {
      if (!currentProjectPath) {
        toast.error("No saved project to repair");
        return;
      }

      await handleOpenProjectFromLibrary(currentProjectPath);
    },
    [currentProjectPath, handleOpenProjectFromLibrary],
  );

  const handleOpenProjectBrowser = useCallback(async () => {
    if (projectBrowserOpen) {
      setProjectBrowserOpen(false);
      return;
    }

    await refreshProjectLibrary();
    setProjectBrowserOpen(true);
  }, [projectBrowserOpen, refreshProjectLibrary]);

  useEffect(() => {
    const removeLoadListener = window.electronAPI.onMenuLoadProject(() => {
      void handleOpenProjectBrowser();
    });
    const removeSaveListener =
      window.electronAPI.onMenuSaveProject(handleSaveProject);
    const removeSaveAsListener =
      window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);

    return () => {
      removeLoadListener?.();
      removeSaveListener?.();
      removeSaveAsListener?.();
    };
  }, [handleOpenProjectBrowser, handleSaveProject, handleSaveProjectAs]);

  useEffect(() => {
    let mounted = true;
    let retryAttempts = 0;

    async function loadCursorTelemetry() {
      if (!videoPath || !videoSourcePath) {
        if (mounted) {
          setCursorTelemetry([]);
          setCursorTelemetrySourcePath(null);
        }
        return;
      }

      try {
        const result =
          await window.electronAPI.getCursorTelemetry(videoSourcePath);
        if (mounted) {
          const samples = result.success ? result.samples : [];
          setCursorTelemetry(samples);
          setCursorTelemetrySourcePath(videoSourcePath);

          const shouldRetryFreshRecordingTelemetry =
            pendingFreshRecordingAutoZoomPathRef.current === videoPath &&
            autoSuggestedVideoPathRef.current !== videoPath &&
            retryAttempts < 12;

          if (shouldRetryFreshRecordingTelemetry) {
            retryAttempts += 1;
            pendingTelemetryRetryTimeoutRef.current = window.setTimeout(() => {
              pendingTelemetryRetryTimeoutRef.current = null;
              if (mounted) {
                void loadCursorTelemetry();
              }
            }, 350);
          }
        }
      } catch (telemetryError) {
        console.warn("Unable to load cursor telemetry:", telemetryError);
        if (mounted) {
          setCursorTelemetry([]);
          setCursorTelemetrySourcePath(videoSourcePath);
          if (
            pendingFreshRecordingAutoZoomPathRef.current === videoPath &&
            autoSuggestedVideoPathRef.current !== videoPath &&
            retryAttempts < 12
          ) {
            retryAttempts += 1;
            pendingTelemetryRetryTimeoutRef.current = window.setTimeout(() => {
              pendingTelemetryRetryTimeoutRef.current = null;
              if (mounted) {
                void loadCursorTelemetry();
              }
            }, 350);
          }
        }
      }
    }

    if (pendingTelemetryRetryTimeoutRef.current !== null) {
      window.clearTimeout(pendingTelemetryRetryTimeoutRef.current);
      pendingTelemetryRetryTimeoutRef.current = null;
    }

    loadCursorTelemetry();

    return () => {
      mounted = false;
      if (pendingTelemetryRetryTimeoutRef.current !== null) {
        window.clearTimeout(pendingTelemetryRetryTimeoutRef.current);
        pendingTelemetryRetryTimeoutRef.current = null;
      }
    };
  }, [videoPath, videoSourcePath, workspaceReloadVersion]);

  const normalizedCursorTelemetry = useMemo(() => {
    if (cursorTelemetry.length === 0) {
      return [] as CursorTelemetryPoint[];
    }

    const totalMs = Math.max(0, Math.round(duration * 1000));
    return normalizeCursorTelemetrySamples(
      cursorTelemetry,
      totalMs > 0 ? totalMs : undefined,
    );
  }, [cursorTelemetry, duration]);

  // Refresh brainInputsRef so getBrainInputs() always returns the latest values.
  brainInputsRef.current = {
    sourcePath: videoSourcePath ?? "",
    durationMs: Math.max(0, Math.round(duration * 1000)),
    transcript: autoCaptions,
    cursorTelemetry: normalizedCursorTelemetry,
  };

  // Refresh captionCtxRef so generateCaptions() reads current values at call time.
  captionCtxRef.current = {
    language: autoCaptionSettings.language,
    videoPath,
    videoSourcePath,
    webcamSourcePath: webcam.sourcePath ?? null,
    whisperExecutablePath: whisperExecutablePath ?? null,
    whisperModelPath: whisperModelPath ?? null,
    syncActiveVideoSource,
  };

  const displayedTimelineWindow = useMemo(() => {
    const totalMs = Math.max(0, Math.round(duration * 1000));
    return getDisplayedTimelineWindowMs(totalMs, trimRegions);
  }, [duration, trimRegions]);

  const effectiveCursorTelemetry = useMemo(() => {
    if (!loopCursor) {
      return normalizedCursorTelemetry;
    }

    if (
      normalizedCursorTelemetry.length < 2 ||
      displayedTimelineWindow.endMs <= displayedTimelineWindow.startMs
    ) {
      return normalizedCursorTelemetry;
    }

    return buildLoopedCursorTelemetry(
      normalizedCursorTelemetry,
      displayedTimelineWindow.endMs,
      displayedTimelineWindow.startMs,
    );
  }, [loopCursor, normalizedCursorTelemetry, displayedTimelineWindow]);

  // Initialize a full-track clip when duration is first known
  const clipInitializedRef = useRef(false);
  const autoFullTrackClipIdRef = useRef<string | null>(null);
  const autoFullTrackClipEndMsRef = useRef<number | null>(null);
  useEffect(() => {
    const totalMs = Math.round(duration * 1000);
    if (totalMs <= 0) return;
    if (!clipInitializedRef.current) {
      if (clipRegions.length === 0) {
        const nextClipRegions =
          trimRegions.length > 0
            ? trimsToClips(trimRegions, totalMs)
            : (() => {
                const id = `clip-${nextClipIdRef.current++}`;
                autoFullTrackClipIdRef.current = id;
                autoFullTrackClipEndMsRef.current = totalMs;
                return [{ id, startMs: 0, endMs: totalMs, speed: 1 }];
              })();

        if (trimRegions.length > 0) {
          nextClipIdRef.current = deriveNextId(
            "clip",
            nextClipRegions.map((region) => region.id),
          );
        }

        setClipRegions(nextClipRegions);
      }
      clipInitializedRef.current = true;
      return;
    }

    const extendedClipRegions = extendAutoFullTrackClip(
      clipRegions,
      autoFullTrackClipIdRef.current,
      autoFullTrackClipEndMsRef.current,
      totalMs,
    );
    if (!extendedClipRegions) return;

    autoFullTrackClipEndMsRef.current = totalMs;
    setClipRegions(extendedClipRegions);
  }, [duration, clipRegions, trimRegions, speedRegions]);

  // Derive trimRegions from clipRegions so export/playback pipelines stay unchanged
  useEffect(() => {
    const totalMs = Math.round(duration * 1000);
    if (totalMs <= 0 || clipRegions.length === 0) return;
    setTrimRegions(clipsToTrims(clipRegions, totalMs));
  }, [clipRegions, duration]);

  const mapTimelineTimeToSourceTime = useCallback(
    (timeMs: number) => resolveTimelineTimeToSourceTime(timeMs, clipRegions),
    [clipRegions],
  );

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const mapSourceTimeToTimelineTime = useCallback(
    (timeMs: number) => resolveSourceTimeToTimelineTime(timeMs, clipRegions),
    [clipRegions],
  );

  // Per-frame time updates go to playbackTimeStore (read by the playhead,
  // the preview, and media-sync logic). The React state is NOT committed at
  // all while playing: even a throttled commit re-renders this whole tree at
  // 100ms+ a pass, which freezes video presentation (the playback stutter).
  // State is flushed from the store on pause/seek instead.
  const isPlayingLiveRef = useRef(false);

  const handlePlaybackTimeUpdate = useCallback(
    (time: number) => {
      if (isPlayingLiveRef.current) {
        playbackTimeStore.set({
          sourceSec: time,
          timelineMs: mapSourceTimeToTimelineTime(time * 1000),
        });
        return;
      }
      setCurrentTime(time);
    },
    [mapSourceTimeToTimelineTime],
  );

  // Feeds React commit costs into the playback debug session, so re-render
  // work can be lined up against playback stalls. recordPhase no-ops while
  // no session is active (i.e. whenever the preview is paused).
  const handleProfilerRender = useCallback(
    (id: string, _phase: string, actualDuration: number) => {
      playbackSessionDebug.recordPhase(`react:${id}`, actualDuration);
    },
    [],
  );

  const handlePlayStateChange = useCallback((playing: boolean) => {
    isPlayingLiveRef.current = playing;
    setIsPlaying(playing);
    if (!playing) {
      // Flush the freshest frame time into React state, then clear the live
      // store so paused consumers fall back to state.
      const live = playbackTimeStore.get();
      if (live !== null) {
        setCurrentTime(live.sourceSec);
      }
      playbackTimeStore.set(null);
    }
  }, []);

  const effectiveZoomRegions = useMemo<ZoomRegion[]>(
    () =>
      zoomRegions
        .filter((region) => region.enabled !== false)
        .map((region) => ({
          ...region,
          startMs: mapTimelineTimeToSourceTime(region.startMs),
          endMs: mapTimelineTimeToSourceTime(region.endMs),
        })),
    [zoomRegions, mapTimelineTimeToSourceTime],
  );

  const timelinePlayheadTime = useMemo(
    () => mapSourceTimeToTimelineTime(currentTime * 1000) / 1000,
    [currentTime, mapSourceTimeToTimelineTime],
  );

  // Merge clip speeds into speed regions so playback + export respect per-clip speed
  const effectiveSpeedRegions = useMemo<SpeedRegion[]>(() => {
    const clipDerived: SpeedRegion[] = clipRegions
      .filter((clip) => clip.speed !== 1)
      .map((clip) => ({
        id: `clip-speed-${clip.id}`,
        startMs: clip.startMs,
        endMs: getClipSourceEndMs(clip),
        speed: clip.speed as SpeedRegion["speed"],
      }));
    if (clipDerived.length === 0) return speedRegions;
    const result = [...speedRegions];
    for (const cs of clipDerived) {
      const overlaps = speedRegions.some(
        (sr) => sr.endMs > cs.startMs && sr.startMs < cs.endMs,
      );
      if (!overlaps) {
        result.push(cs);
      }
    }
    return result;
  }, [clipRegions, speedRegions]);

  function togglePlayPause() {
    const playback = videoPlaybackRef.current;
    const video = playback?.video;
    if (!playback || !video) return;

    if (!video.paused && !video.ended) {
      playback.pause();
    } else {
      playback
        .play()
        .catch((err: any) => console.error("Video play failed:", err));
    }
  }

  const handleAutoSuggestZoomsConsumed = useCallback(() => {
    setAutoSuggestZoomsTrigger(0);
  }, []);

  const handleSeek = useCallback(
    (time: number) => {
      const video = videoPlaybackRef.current?.video;
      if (!video) return;
      const nextSourceTime = mapTimelineTimeToSourceTime(time * 1000) / 1000;
      currentTimeRef.current = nextSourceTime;
      setCurrentTime(nextSourceTime);
      video.currentTime = nextSourceTime;
    },
    [mapTimelineTimeToSourceTime],
  );

  // useEffect(() => {
  //   if (timelineClockRafRef.current !== null) {
  //     cancelAnimationFrame(timelineClockRafRef.current);
  //     timelineClockRafRef.current = null;
  //   }
  //   timelineClockLastFrameRef.current = null;

  //   if (!isPlaying || !isTimelineClipGap) {
  //     return;
  //   }

  //   const tick = (timestamp: number) => {
  //     const previousTimestamp = timelineClockLastFrameRef.current ?? timestamp;
  //     timelineClockLastFrameRef.current = timestamp;
  //     const elapsedSeconds = Math.max(
  //       0,
  //       (timestamp - previousTimestamp) / 1000,
  //     );
  //     const nextTime = Math.min(
  //       duration,
  //       currentTimeRef.current + elapsedSeconds,
  //     );
  //     currentTimeRef.current = nextTime;
  //     setCurrentTime(nextTime);

  //     if (nextTime >= duration) {
  //       setIsPlaying(false);
  //       timelineClockRafRef.current = null;
  //       return;
  //     }

  //     timelineClockRafRef.current = requestAnimationFrame(tick);
  //   };

  //   timelineClockRafRef.current = requestAnimationFrame(tick);

  //   return () => {
  //     if (timelineClockRafRef.current !== null) {
  //       cancelAnimationFrame(timelineClockRafRef.current);
  //       timelineClockRafRef.current = null;
  //     }
  //     timelineClockLastFrameRef.current = null;
  //   };
  // }, [duration, isPlaying, isTimelineClipGap]);

  // useEffect(() => {
  //   const video = videoPlaybackRef.current?.video;
  //   if (!video) return;

  //   if (sourceTimeForTimeline === null) {
  //   if (!video.paused) {
  //     video.pause();
  //   }
  //   return;
  // }

  //   const driftThreshold = isPlaying ? 0.2 : 0.01;
  //   if (Math.abs(video.currentTime - sourceTimeForTimeline) > driftThreshold) {
  //     video.currentTime = sourceTimeForTimeline;
  //   }

  //   if (isPlaying && video.paused) {
  //     video
  //       .play()
  //       .catch((err: any) => console.error("Video play failed:", err));
  //   }
  // }, [isPlaying, sourceTimeForTimeline]);

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id);
    if (id) {
      setActiveEffectSection("zoom");
      setSelectedAnnotationId(null);
      setSelectedAudioId(null);
    } else {
      setActiveEffectSection((s) => (s === "zoom" ? "scene" : s));
    }
  }, []);

  const handleSelectAnnotation = useCallback((id: string | null) => {
    setSelectedAnnotationId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedAudioId(null);
    }
  }, []);

  const handleZoomAdded = useCallback(
    (span: Span) => {
      const id = `zoom-${nextZoomIdRef.current++}`;
      const defaultDepth: ZoomDepth = 2;
      const newRegion: ZoomRegion = {
        id,
        startMs: Math.round(span.start),
        endMs: Math.round(span.end),
        depth: defaultDepth,
        focus: clampFocusToDepth({ cx: 0.5, cy: 0.5 }, defaultDepth),
        mode: "auto",
      };
      if (
        videoPath &&
        pendingFreshRecordingAutoZoomPathRef.current === videoPath
      ) {
        autoSuggestedVideoPathRef.current = videoPath;
        pendingFreshRecordingAutoZoomPathRef.current = null;
      }
      setZoomRegions((prev) => [...prev, newRegion]);
      setSelectedZoomId(id);
      setSelectedAnnotationId(null);
      extensionHost.emitEvent({
        type: "timeline:region-added",
        data: { id, startMs: newRegion.startMs, endMs: newRegion.endMs },
      });
    },
    [videoPath],
  );

  const handleZoomSuggested = useCallback(
    (span: Span, focus: ZoomFocus) => {
      const id = `zoom-${nextZoomIdRef.current++}`;
      const newRegion: ZoomRegion = {
        id,
        startMs: Math.round(span.start),
        endMs: Math.round(span.end),
        depth: DEFAULT_AUTO_ZOOM_DEPTH,
        focus: clampFocusToDepth(focus, DEFAULT_AUTO_ZOOM_DEPTH),
        mode: "auto",
      };
      if (
        videoPath &&
        pendingFreshRecordingAutoZoomPathRef.current === videoPath
      ) {
        autoSuggestedVideoPathRef.current = videoPath;
        pendingFreshRecordingAutoZoomPathRef.current = null;
      }
      setZoomRegions((prev) => [...prev, newRegion]);
      // Don't auto-select suggested zooms — they follow cursor and don't need user interaction
      extensionHost.emitEvent({
        type: "timeline:region-added",
        data: { id, startMs: newRegion.startMs, endMs: newRegion.endMs },
      });
    },
    [videoPath],
  );

  useEffect(() => {
    if (
      !videoPath ||
      loading ||
      !isPreviewReady ||
      duration <= 0 ||
      zoomRegions.length > 0 ||
      normalizedCursorTelemetry.length < 2
    ) {
      if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
        window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
        pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
      }
      return;
    }

    if (pendingFreshRecordingAutoZoomPathRef.current !== videoPath) {
      return;
    }

    if (autoSuggestedVideoPathRef.current === videoPath) {
      pendingFreshRecordingAutoZoomPathRef.current = null;
      return;
    }

    const telemetryPointCount = cursorTelemetry.length;
    if (
      pendingFreshRecordingAutoSuggestTelemetryCountRef.current ===
      telemetryPointCount
    ) {
      return;
    }

    pendingFreshRecordingAutoSuggestTelemetryCountRef.current =
      telemetryPointCount;

    if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
      window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
      pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
    }

    pendingFreshRecordingAutoSuggestTimeoutRef.current = window.setTimeout(
      () => {
        pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
        if (
          pendingFreshRecordingAutoZoomPathRef.current !== videoPath ||
          autoSuggestedVideoPathRef.current === videoPath ||
          zoomRegions.length > 0
        ) {
          return;
        }

        setAutoSuggestZoomsTrigger((value) => value + 1);
      },
      500,
    );
  }, [
    videoPath,
    loading,
    isPreviewReady,
    duration,
    cursorTelemetry.length,
    normalizedCursorTelemetry,
    zoomRegions,
  ]);

  const handleZoomSpanChange = useCallback((id: string, span: Span) => {
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleZoomFocusChange = useCallback((id: string, focus: ZoomFocus) => {
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              focus: clampFocusToDepth(focus, region.depth),
            }
          : region,
      ),
    );
  }, []);

  const handleZoomDepthChange = useCallback(
    (depth: ZoomDepth) => {
      if (!selectedZoomId) return;
      setZoomRegions((prev) =>
        prev.map((region) =>
          region.id === selectedZoomId
            ? {
                ...region,
                depth,
                focus: clampFocusToDepth(region.focus, depth),
              }
            : region,
        ),
      );
    },
    [selectedZoomId],
  );

  const handleZoomModeChange = useCallback(
    (mode: ZoomMode) => {
      if (!selectedZoomId) return;
      setZoomRegions((prev) =>
        prev.map((region) =>
          region.id === selectedZoomId ? { ...region, mode } : region,
        ),
      );
    },
    [selectedZoomId],
  );

  const handleZoomPresetChange = useCallback(
    (presetId: ZoomPresetId) => {
      if (!selectedZoomId) return;
      setZoomRegions((prev) =>
        prev.map((region) => {
          if (region.id !== selectedZoomId) return region;
          if (presetId === "follow-cursor") {
            return { ...region, presetId, mode: "auto", depth: 2 };
          }
          if (presetId === "punch-in") {
            return {
              ...region,
              presetId,
              mode: "manual",
              depth: 4,
              focus: clampFocusToDepth(region.focus, 4),
            };
          }
          if (presetId === "pan-and-zoom") {
            return {
              ...region,
              presetId,
              mode: "manual",
              depth: region.depth || 2,
              endFocus: region.endFocus ?? region.focus,
            };
          }
          return { ...region, presetId, mode: "manual", depth: 2 };
        }),
      );
    },
    [selectedZoomId],
  );

  const handleZoomVisibilityChange = useCallback(
    (id: string, enabled: boolean) => {
      setZoomRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, enabled } : region,
        ),
      );
    },
    [],
  );

  const handleZoomDelete = useCallback(
    (id: string) => {
      createProjectSnapshot("auto", "Before deleting zoom");
      setZoomRegions((prev) => prev.filter((region) => region.id !== id));
      if (selectedZoomId === id) {
        setSelectedZoomId(null);
      }
      extensionHost.emitEvent({
        type: "timeline:region-removed",
        data: { id },
      });
    },
    [createProjectSnapshot, selectedZoomId],
  );

  const handleSelectSpeed = useCallback((id: string | null) => {
    setSelectedSpeedId(id);
    if (id) {
      setActiveEffectSection("speed");
    } else {
      setActiveEffectSection((s) => (s === "speed" ? "scene" : s));
    }
  }, []);

  const handleSpeedAdded = useCallback((span: Span) => {
    const id = `speed-${nextSpeedIdRef.current++}`;
    const newRegion: SpeedRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      speed: 2,
    };
    setSpeedRegions((prev) => [...prev, newRegion]);
    setSelectedSpeedId(id);
  }, []);

  const handleSpeedSpanChange = useCallback((id: string, span: Span) => {
    setSpeedRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
          : region,
      ),
    );
  }, []);

  const handleSpeedDelete = useCallback((id: string) => {
    setSpeedRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedSpeedId === id) setSelectedSpeedId(null);
  }, [selectedSpeedId]);

  const handleSpeedValueChange = useCallback((speed: PlaybackSpeed) => {
    if (!selectedSpeedId) return;
    setSpeedRegions((prev) =>
      prev.map((region) =>
        region.id === selectedSpeedId ? { ...region, speed } : region,
      ),
    );
  }, [selectedSpeedId]);

  const handleSelectClip = useCallback((id: string | null) => {
    setSelectedClipId(id);
    if (id) {
      setActiveEffectSection("clip");
      setSelectedZoomId(null);
      setSelectedAnnotationId(null);
      setSelectedAudioId(null);
    } else {
      setActiveEffectSection((s) => (s === "clip" ? "scene" : s));
    }
  }, []);

  const handleClipSplit = useCallback(
    (splitMs: number) => {
      setClipRegions((prev) => {
        const target = prev.find(
          (c) => splitMs > c.startMs && splitMs < c.endMs,
        );
        if (!target) return prev;
        const leftId = `clip-${nextClipIdRef.current++}`;
        const rightId = `clip-${nextClipIdRef.current++}`;
        const left: ClipRegion = {
          id: leftId,
          startMs: target.startMs,
          endMs: Math.round(splitMs),
          speed: target.speed,
          muted: target.muted,
        };
        const right: ClipRegion = {
          id: rightId,
          startMs: Math.round(splitMs),
          endMs: target.endMs,
          speed: target.speed,
          muted: target.muted,
        };
        if (selectedClipId === target.id) {
          setSelectedClipId(leftId);
        }
        return prev.flatMap((c) => (c.id === target.id ? [left, right] : [c]));
      });
    },
    [selectedClipId],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("e2e") !== "1") {
      return;
    }

    const video = videoPlaybackRef.current?.video ?? null;
    const e2eSourceTime = video?.currentTime ?? currentTime;
    const e2eTimelineTime =
      resolveSourceTimeToTimelineTime(e2eSourceTime * 1000, clipRegions) / 1000;
    const stopSyntheticPlayback = () => {
      if (e2ePlaybackRafRef.current !== null) {
        window.cancelAnimationFrame(e2ePlaybackRafRef.current);
        e2ePlaybackRafRef.current = null;
      }
      e2ePlaybackLastFrameRef.current = null;
    };
    const startSyntheticPlayback = () => {
      stopSyntheticPlayback();
      setIsPlaying(true);
      const tick = (timestamp: number) => {
        const lastFrame = e2ePlaybackLastFrameRef.current ?? timestamp;
        e2ePlaybackLastFrameRef.current = timestamp;
        const elapsedMs = Math.max(0, timestamp - lastFrame);
        const timelineMs = resolveSourceTimeToTimelineTime(
          currentTimeRef.current * 1000,
          clipRegions,
        );
        const nextTimelineMs = Math.min(
          duration * 1000,
          timelineMs + elapsedMs,
        );
        const nextSourceSeconds =
          resolveTimelineTimeToSourceTime(nextTimelineMs, clipRegions) / 1000;
        currentTimeRef.current = nextSourceSeconds;
        setCurrentTime(nextSourceSeconds);
        const targetVideo = videoPlaybackRef.current?.video;
        if (targetVideo) {
          targetVideo.currentTime = nextSourceSeconds;
        }
        if (nextTimelineMs >= duration * 1000) {
          setIsPlaying(false);
          e2ePlaybackRafRef.current = null;
          e2ePlaybackLastFrameRef.current = null;
          return;
        }
        e2ePlaybackRafRef.current = window.requestAnimationFrame(tick);
      };
      e2ePlaybackRafRef.current = window.requestAnimationFrame(tick);
    };
    window.__QUIRO_E2E__ = {
      state: {
        duration,
        sourceTime: e2eSourceTime,
        timelineTime: e2eTimelineTime,
        isPlaying,
        videoPaused: video?.paused ?? null,
        videoCurrentTime: video?.currentTime ?? null,
        clipRegions,
        videoPath,
      },
      actions: {
        playPause: togglePlayPause,
        playMuted: async () => {
          const playback = videoPlaybackRef.current;
          const targetVideo = playback?.video;
          if (!playback || !targetVideo) return;
          targetVideo.muted = true;
          void playback.play().catch(() => undefined);
          if (window.__QUIRO_E2E__) {
            window.__QUIRO_E2E__.state = {
              ...window.__QUIRO_E2E__.state,
              isPlaying: true,
              videoPaused: false,
            };
          }
          startSyntheticPlayback();
        },
        pause: () => {
          stopSyntheticPlayback();
          videoPlaybackRef.current?.pause();
          setIsPlaying(false);
          if (window.__QUIRO_E2E__) {
            window.__QUIRO_E2E__.state = {
              ...window.__QUIRO_E2E__.state,
              isPlaying: false,
              videoPaused: true,
            };
          }
        },
        advanceTimelineMs: (deltaMs: number) => {
          const timelineMs = resolveSourceTimeToTimelineTime(
            currentTimeRef.current * 1000,
            clipRegions,
          );
          const nextTimelineMs = Math.min(
            duration * 1000,
            timelineMs + Math.max(0, deltaMs),
          );
          const nextSourceSeconds =
            resolveTimelineTimeToSourceTime(nextTimelineMs, clipRegions) / 1000;
          currentTimeRef.current = nextSourceSeconds;
          setCurrentTime(nextSourceSeconds);
          const targetVideo = videoPlaybackRef.current?.video;
          if (targetVideo) {
            targetVideo.currentTime = nextSourceSeconds;
          }
          if (window.__QUIRO_E2E__) {
            window.__QUIRO_E2E__.state = {
              ...window.__QUIRO_E2E__.state,
              sourceTime: nextSourceSeconds,
              timelineTime: nextTimelineMs / 1000,
              videoCurrentTime: nextSourceSeconds,
            };
          }
        },
        seekTimelineMs: (timeMs: number) => {
          handleSeek(timeMs / 1000);
          const nextSourceSeconds =
            resolveTimelineTimeToSourceTime(timeMs, clipRegions) / 1000;
          if (window.__QUIRO_E2E__) {
            window.__QUIRO_E2E__.state = {
              ...window.__QUIRO_E2E__.state,
              sourceTime: nextSourceSeconds,
              timelineTime: timeMs / 1000,
              videoCurrentTime: nextSourceSeconds,
            };
          }
        },
        splitAtTimelineMs: (timeMs: number) => handleClipSplit(timeMs),
      },
    };
  }, [
    clipRegions,
    currentTime,
    duration,
    handleClipSplit,
    isPlaying,
    timelinePlayheadTime,
    videoPath,
  ]);

  const handleClipSpanChange = useCallback(
    (id: string, span: Span) => {
      const oldClip = clipRegions.find((c) => c.id === id);
      const newStart = Math.round(span.start);
      const newEnd = Math.round(span.end);
      const removedSegments = oldClip
        ? [
            ...(newStart > oldClip.startMs
              ? [{ startMs: oldClip.startMs, endMs: newStart }]
              : []),
            ...(newEnd < oldClip.endMs
              ? [{ startMs: newEnd, endMs: oldClip.endMs }]
              : []),
          ]
        : [];

      if (oldClip) {
        const startDelta = newStart - oldClip.startMs;
        const endDelta = newEnd - oldClip.endMs;
        const isMove =
          Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0;

        if (isMove) {
          const delta = startDelta;
          setZoomRegions((prev) =>
            prev.map((zoom) => {
              const overlaps =
                zoom.startMs < oldClip.endMs && zoom.endMs > oldClip.startMs;
              if (overlaps) {
                return {
                  ...zoom,
                  startMs: zoom.startMs + delta,
                  endMs: zoom.endMs + delta,
                };
              }
              return zoom;
            }),
          );
        }
      }

      if (removedSegments.length > 0) {
        const removeTrimmedRegions = <
          T extends { startMs: number; endMs: number },
        >(
          regions: T[],
        ): T[] =>
          regions.filter(
            (region) =>
              !removedSegments.some(
                (segment) =>
                  region.startMs < segment.endMs &&
                  region.endMs > segment.startMs,
              ),
          );
        setZoomRegions((prev) => removeTrimmedRegions(prev));
        setAnnotationRegions((prev) => removeTrimmedRegions(prev));
        setSpeedRegions((prev) => removeTrimmedRegions(prev));
        setAudioRegions((prev) => removeTrimmedRegions(prev));
      }

      setClipRegions((prev) =>
        prev.map((clip) =>
          clip.id === id ? { ...clip, startMs: newStart, endMs: newEnd } : clip,
        ),
      );
    },
    [clipRegions],
  );

  const handleClipSpeedChange = useCallback(
    (speed: number) => {
      if (!selectedClipId) return;
      if (!Number.isFinite(speed) || speed <= 0) {
        return;
      }
      const clip = clipRegions.find((c) => c.id === selectedClipId);
      if (!clip) return;
      const oldSpeed =
        Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
      const sourceDurationMs = (clip.endMs - clip.startMs) * oldSpeed;
      const newEndMs = Math.round(clip.startMs + sourceDurationMs / speed);
      const scaleFactor = oldSpeed / speed;

      setClipRegions((prev) =>
        prev.map((c) =>
          c.id === selectedClipId ? { ...c, speed, endMs: newEndMs } : c,
        ),
      );
      // Scale zoom regions that lie within this clip proportionally
      setZoomRegions((prev) =>
        prev.map((zoom) => {
          if (zoom.startMs < clip.startMs || zoom.startMs >= clip.endMs)
            return zoom;
          return {
            ...zoom,
            startMs: Math.round(
              clip.startMs + (zoom.startMs - clip.startMs) * scaleFactor,
            ),
            endMs: Math.round(
              clip.startMs + (zoom.endMs - clip.startMs) * scaleFactor,
            ),
          };
        }),
      );
    },
    [selectedClipId, clipRegions],
  );

  const handleClipMutedChange = useCallback(
    (muted: boolean) => {
      if (!selectedClipId) return;
      setClipRegions((prev) =>
        prev.map((clip) =>
          clip.id === selectedClipId ? { ...clip, muted } : clip,
        ),
      );
    },
    [selectedClipId],
  );

  const handleClipDelete = useCallback(
    (id: string) => {
      const deletedClip = clipRegions.find((clip) => clip.id === id);
      setClipRegions((prev) => prev.filter((clip) => clip.id !== id));
      if (deletedClip) {
        const { startMs, endMs } = deletedClip;
        setZoomRegions((prev) =>
          prev.filter(
            (region) => region.endMs <= startMs || region.startMs >= endMs,
          ),
        );
        setAnnotationRegions((prev) =>
          prev.filter(
            (region) => region.endMs <= startMs || region.startMs >= endMs,
          ),
        );
        setSpeedRegions((prev) =>
          prev.filter(
            (region) => region.endMs <= startMs || region.startMs >= endMs,
          ),
        );
        setAudioRegions((prev) =>
          prev.filter(
            (region) => region.endMs <= startMs || region.startMs >= endMs,
          ),
        );
      }
      if (selectedClipId === id) {
        setSelectedClipId(null);
      }
    },
    [clipRegions, selectedClipId],
  );

  const handleSelectAudio = useCallback((id: string | null) => {
    setSelectedAudioId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedAnnotationId(null);
    }
  }, []);

  const handleAudioAdded = useCallback(
    (span: Span, audioPath: string, trackIndex?: number) => {
      const id = `audio-${nextAudioIdRef.current++}`;
      const newRegion: AudioRegion = {
        id,
        startMs: Math.round(span.start),
        endMs: Math.round(span.end),
        audioPath,
        volume: 1,
        trackIndex,
      };
      setAudioRegions((prev) => [...prev, newRegion]);
      setSelectedAudioId(id);
      setSelectedZoomId(null);
      setSelectedAnnotationId(null);
    },
    [],
  );

  const handleAudioSpanChange = useCallback(
    (id: string, span: Span, trackIndex?: number) => {
      const normalizedTrackIndex =
        typeof trackIndex === "number" && Number.isFinite(trackIndex)
          ? Math.max(0, Math.floor(trackIndex))
          : undefined;

      setAudioRegions((prev) =>
        prev.map((region) =>
          region.id === id
            ? {
                ...region,
                startMs: Math.round(span.start),
                endMs: Math.round(span.end),
                ...(normalizedTrackIndex === undefined
                  ? {}
                  : { trackIndex: normalizedTrackIndex }),
              }
            : region,
        ),
      );
    },
    [],
  );

  const handleAudioVolumeChange = useCallback(
    (volume: number) => {
      if (!selectedAudioId) {
        return;
      }

      if (!Number.isFinite(volume)) {
        return;
      }

      const nextVolume = Math.max(0, Math.min(1, volume));
      setAudioRegions((prev) =>
        prev.map((region) =>
          region.id === selectedAudioId
            ? { ...region, volume: nextVolume }
            : region,
        ),
      );
    },
    [selectedAudioId],
  );

  const handleAudioDelete = useCallback(
    (id: string) => {
      setAudioRegions((prev) => prev.filter((region) => region.id !== id));
      if (selectedAudioId === id) {
        setSelectedAudioId(null);
      }
    },
    [selectedAudioId],
  );

  const handleAnnotationAdded = useCallback((span: Span, trackIndex = 0) => {
    const id = `annotation-${nextAnnotationIdRef.current++}`;
    const zIndex = nextAnnotationZIndexRef.current++; // Assign z-index based on creation order
    const newRegion: AnnotationRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      type: "text",
      content: "Enter text...",
      position: { ...DEFAULT_ANNOTATION_POSITION },
      size: { ...DEFAULT_ANNOTATION_SIZE },
      style: { ...DEFAULT_ANNOTATION_STYLE },
      animation: { ...DEFAULT_ANNOTATION_ANIMATION },
      zIndex,
      trackIndex,
    };
    setAnnotationRegions((prev) => [...prev, newRegion]);
    setSelectedAnnotationId(id);
    setSelectedZoomId(null);
  }, []);

  const handleAnnotationSpanChange = useCallback(
    (id: string, span: Span, trackIndex?: number) => {
      const normalizedTrackIndex =
        typeof trackIndex === "number" && Number.isFinite(trackIndex)
          ? Math.max(0, Math.floor(trackIndex))
          : undefined;

      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id
            ? {
                ...region,
                startMs: Math.round(span.start),
                endMs: Math.round(span.end),
                ...(normalizedTrackIndex === undefined
                  ? {}
                  : { trackIndex: normalizedTrackIndex }),
              }
            : region,
        ),
      );
    },
    [applySessionPresentation],
  );

  const handleAnnotationDelete = useCallback(
    (id: string) => {
      createProjectSnapshot("auto", "Before deleting annotation");
      setAnnotationRegions((prev) => prev.filter((region) => region.id !== id));
      if (selectedAnnotationId === id) {
        setSelectedAnnotationId(null);
      }
    },
    [createProjectSnapshot, selectedAnnotationId],
  );

  const handleAnnotationVisibilityChange = useCallback(
    (id: string, visible: boolean) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, visible } : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationReorder = useCallback(
    (id: string, direction: "up" | "down") => {
      createProjectSnapshot("auto", "Before reordering layers");
      setAnnotationRegions((prev) => {
        const sorted = [...prev].sort((a, b) => a.zIndex - b.zIndex);
        const index = sorted.findIndex((region) => region.id === id);
        const targetIndex = direction === "up" ? index + 1 : index - 1;
        if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
          return prev;
        }
        const current = sorted[index];
        const target = sorted[targetIndex];
        return prev.map((region) => {
          if (region.id === current.id) {
            return { ...region, zIndex: target.zIndex };
          }
          if (region.id === target.id) {
            return { ...region, zIndex: current.zIndex };
          }
          return region;
        });
      });
    },
    [createProjectSnapshot],
  );

  const handleAnnotationBaseOpacityChange = useCallback(
    (id: string, opacity: number) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, opacity } : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationBaseScaleChange = useCallback(
    (id: string, scale: number) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, scale } : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationAnimationChange = useCallback(
    (id: string, animation: AnnotationAnimationSettings) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, animation } : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationAddKeyframe = useCallback(
    (id: string) => {
      const timeMs = Math.round(currentTime * 1000);
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id
            ? {
                ...region,
                keyframes: [
                  ...(region.keyframes ?? []).filter(
                    (keyframe) => keyframe.timeMs !== timeMs,
                  ),
                  {
                    id: `keyframe-${Date.now()}`,
                    timeMs,
                    easing: "ease-in-out",
                    position: region.position,
                    opacity: region.opacity ?? 1,
                    scale: region.scale ?? 1,
                    blurIntensity: region.blurIntensity,
                    arrowDirection: region.figureData?.arrowDirection,
                  } satisfies AnnotationKeyframe,
                ].sort((left, right) => left.timeMs - right.timeMs),
              }
            : region,
        ),
      );
    },
    [currentTime],
  );

  const handleAnnotationDeleteKeyframe = useCallback(
    (id: string, keyframeId: string) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id
            ? {
                ...region,
                keyframes: (region.keyframes ?? []).filter(
                  (keyframe) => keyframe.id !== keyframeId,
                ),
              }
            : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationContentChange = useCallback(
    (id: string, content: string) => {
      setAnnotationRegions((prev) => {
        const updated = prev.map((region) => {
          if (region.id !== id) return region;

          // Store content in type-specific fields
          if (region.type === "text") {
            return { ...region, content, textContent: content };
          } else if (region.type === "image") {
            return { ...region, content, imageContent: content };
          } else {
            return { ...region, content };
          }
        });
        return updated;
      });
    },
    [],
  );

  const handleAnnotationTypeChange = useCallback(
    (id: string, type: AnnotationRegion["type"]) => {
      setAnnotationRegions((prev) => {
        const updated = prev.map((region) => {
          if (region.id !== id) return region;

          const updatedRegion = { ...region, type };

          // Restore content from type-specific storage
          if (type === "text") {
            updatedRegion.content = region.textContent || "Enter text...";
          } else if (type === "image") {
            updatedRegion.content = region.imageContent || "";
          } else if (type === "figure") {
            updatedRegion.content = "";
            if (!region.figureData) {
              updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
            }
          } else if (type === "blur") {
            updatedRegion.content = "";
            if (region.blurIntensity === undefined) {
              updatedRegion.blurIntensity = 20;
            }
          }

          return updatedRegion;
        });
        return updated;
      });
    },
    [],
  );

  const handleAnnotationStyleChange = useCallback(
    (id: string, style: Partial<AnnotationRegion["style"]>) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id
            ? { ...region, style: { ...region.style, ...style } }
            : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationFigureDataChange = useCallback(
    (id: string, figureData: FigureData) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, figureData } : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationBlurIntensityChange = useCallback(
    (id: string, blurIntensity: number) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, blurIntensity } : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationBlurColorChange = useCallback(
    (id: string, blurColor: string) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, blurColor } : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationPositionChange = useCallback(
    (id: string, position: { x: number; y: number }) => {
      setAnnotationRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, position } : region,
        ),
      );
    },
    [],
  );

  const handleAnnotationSizeChange = useCallback(
    (id: string, size: { width: number; height: number }) => {
      setAnnotationRegions((prev) =>
        prev.map((region) => (region.id === id ? { ...region, size } : region)),
      );
    },
    [],
  );

  // Global Tab prevention
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      const usesPrimaryModifier = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();

      if (usesPrimaryModifier && !e.altKey && key === "z") {
        if (!isEditableTarget) {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        }
        return;
      }

      if (!isMac && e.ctrlKey && !e.metaKey && !e.altKey && key === "y") {
        if (!isEditableTarget) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      if (e.key === "Tab") {
        // Allow tab only in inputs/textareas
        if (isEditableTarget) {
          return;
        }
        e.preventDefault();
      }

      if (matchesShortcut(e, shortcuts.playPause, isMac)) {
        // Allow space only in inputs/textareas
        if (isEditableTarget) {
          return;
        }
        e.preventDefault();

        const playback = videoPlaybackRef.current;
        if (playback?.video) {
          if (playback.video.paused) {
            playback.play().catch(console.error);
          } else {
            playback.pause();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [shortcuts, isMac, handleUndo, handleRedo]);

  useEffect(() => {
    if (
      selectedZoomId &&
      !zoomRegions.some((region) => region.id === selectedZoomId)
    ) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId, zoomRegions]);

  useEffect(() => {
    if (
      selectedAnnotationId &&
      !annotationRegions.some((region) => region.id === selectedAnnotationId)
    ) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId, annotationRegions]);

  useEffect(() => {
    if (
      selectedAudioId &&
      !audioRegions.some((region) => region.id === selectedAudioId)
    ) {
      setSelectedAudioId(null);
    }
  }, [selectedAudioId, audioRegions]);

  // Audio playback sync: manage Audio elements that play in sync with video
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
  const audioElementResourcesRef = useRef<Map<string, string>>(new Map());
  const sourceAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(
    new Map(),
  );
  const sourceAudioElementRevokersRef = useRef<Map<string, () => void>>(
    new Map(),
  );
  const sourceAudioElementResourcesRef = useRef<Map<string, string>>(new Map());
  const lastSourceAudioSyncTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const existing = audioElementsRef.current;
    const currentIds = new Set(audioRegions.map((r) => r.id));

    // Remove old audio elements
    for (const [id, audio] of existing) {
      if (!currentIds.has(id)) {
        audio.pause();
        audio.src = "";
        audioElementRevokersRef.current.get(id)?.();
        audioElementRevokersRef.current.delete(id);
        audioElementResourcesRef.current.delete(id);
        existing.delete(id);
      }
    }

    // Create/update audio elements
    for (const region of audioRegions) {
      let audio = existing.get(region.id);
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        existing.set(region.id, audio);
      }

      if (
        audioElementResourcesRef.current.get(region.id) !== region.audioPath
      ) {
        audio.pause();
        audio.src = "";
        audioElementRevokersRef.current.get(region.id)?.();
        audioElementRevokersRef.current.delete(region.id);
        audioElementResourcesRef.current.set(region.id, region.audioPath);

        void (async () => {
          const resolved = await resolveMediaElementSource(region.audioPath);
          const latestAudio = existing.get(region.id);

          if (
            cancelled ||
            latestAudio !== audio ||
            audioElementResourcesRef.current.get(region.id) !== region.audioPath
          ) {
            resolved.revoke();
            return;
          }

          audioElementRevokersRef.current.set(region.id, resolved.revoke);
          latestAudio.src = resolved.src;
        })();
      }

      audio.volume = Math.max(0, Math.min(1, region.volume * previewVolume));
    }

    return () => {
      cancelled = true;
    };
  }, [audioRegions, previewVolume]);

  useEffect(() => {
    let cancelled = false;
    const existing = sourceAudioElementsRef.current;
    const currentIds = new Set(previewSourceAudioFallbackPaths);

    for (const [id, audio] of existing) {
      if (!currentIds.has(id)) {
        audio.pause();
        audio.src = "";
        sourceAudioElementRevokersRef.current.get(id)?.();
        sourceAudioElementRevokersRef.current.delete(id);
        sourceAudioElementResourcesRef.current.delete(id);
        existing.delete(id);
      }
    }

    for (const audioPath of previewSourceAudioFallbackPaths) {
      let audio = existing.get(audioPath);
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        existing.set(audioPath, audio);
      }
      audio.dataset.sourceAudioPath = audioPath;

      if (sourceAudioElementResourcesRef.current.get(audioPath) !== audioPath) {
        audio.pause();
        audio.src = "";
        sourceAudioElementRevokersRef.current.get(audioPath)?.();
        sourceAudioElementRevokersRef.current.delete(audioPath);
        sourceAudioElementResourcesRef.current.set(audioPath, audioPath);

        void (async () => {
          try {
            const resolved = await resolveMediaElementSource(audioPath);
            const latestAudio = existing.get(audioPath);

            if (
              cancelled ||
              latestAudio !== audio ||
              sourceAudioElementResourcesRef.current.get(audioPath) !==
                audioPath
            ) {
              resolved.revoke();
              return;
            }

            sourceAudioElementRevokersRef.current.set(
              audioPath,
              resolved.revoke,
            );
            latestAudio.src = resolved.src;
          } catch (error) {
            if (cancelled) {
              return;
            }

            sourceAudioElementRevokersRef.current.get(audioPath)?.();
            sourceAudioElementRevokersRef.current.delete(audioPath);
            sourceAudioElementResourcesRef.current.delete(audioPath);
            const latestAudio = existing.get(audioPath);
            if (latestAudio === audio) {
              latestAudio.pause();
              latestAudio.src = "";
            }
            toast.warning(
              `Could not load companion audio source: ${summarizeErrorMessage(getErrorMessage(error))}`,
              { id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
            );
          }
        })();
      }

      audio.volume = Math.max(0, Math.min(1, previewVolume));
    }

    if (previewSourceAudioFallbackPaths.length === 0) {
      lastSourceAudioSyncTimeRef.current = null;
    }

    return () => {
      cancelled = true;
    };
  }, [previewSourceAudioFallbackPaths, previewVolume]);

  useEffect(() => {
    return () => {
      for (const audio of audioElementsRef.current.values()) {
        audio.pause();
        audio.src = "";
      }
      for (const revoke of audioElementRevokersRef.current.values()) {
        revoke();
      }
      audioElementsRef.current.clear();
      audioElementRevokersRef.current.clear();
      audioElementResourcesRef.current.clear();
      for (const audio of sourceAudioElementsRef.current.values()) {
        audio.pause();
        audio.src = "";
      }
      for (const revoke of sourceAudioElementRevokersRef.current.values()) {
        revoke();
      }
      sourceAudioElementsRef.current.clear();
      sourceAudioElementRevokersRef.current.clear();
      sourceAudioElementResourcesRef.current.clear();
      lastSourceAudioSyncTimeRef.current = null;
    };
  }, []);

  // Sync audio playback with video currentTime and isPlaying state
  const syncOverlayAudio = useCallback(() => {
    // React time state is frozen while playing; use the live frame time so
    // the drift correction doesn't chase a stale target.
    const liveTime = playbackTimeStore.get()?.sourceSec ?? currentTime;
    const currentTimeMs = liveTime * 1000;
    const activeSpeedRegion = effectiveSpeedRegions.find(
      (region) =>
        currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
    );
    const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;

    for (const region of audioRegions) {
      const audio = audioElementsRef.current.get(region.id);
      if (!audio) continue;

      const isInRegion =
        currentTimeMs >= region.startMs && currentTimeMs < region.endMs;

      if (isPlaying && isInRegion) {
        enablePitchPreservingPlayback(audio);
        const audioOffset = (currentTimeMs - region.startMs) / 1000;
        // Only seek if significantly out of sync (> 200ms)
        if (Math.abs(audio.currentTime - audioOffset) > 0.2) {
          audio.currentTime = audioOffset;
        }
        const syncedPlaybackRate = getMediaSyncPlaybackRate({
          basePlaybackRate: targetPlaybackRate,
          currentTime: audio.currentTime,
          targetTime: audioOffset,
        });
        if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
          audio.playbackRate = syncedPlaybackRate;
        }
        if (audio.paused) {
          audio.play().catch(() => undefined);
        }
      } else {
        if (!audio.paused) {
          audio.pause();
        }
      }
    }
  }, [isPlaying, currentTime, audioRegions, effectiveSpeedRegions]);

  useEffect(() => {
    syncOverlayAudio();
  }, [syncOverlayAudio]);

  const syncSourceAudioFallback = useCallback(() => {
    if (previewSourceAudioFallbackPaths.length === 0) {
      lastSourceAudioSyncTimeRef.current = null;
      return;
    }

    // React time state is frozen while playing; use the live frame time so
    // the drift correction doesn't chase a stale target.
    const liveCurrentTime = playbackTimeStore.get()?.sourceSec ?? currentTime;
    const activeSpeedRegion = effectiveSpeedRegions.find(
      (region) =>
        liveCurrentTime * 1000 >= region.startMs &&
        liveCurrentTime * 1000 < region.endMs,
    );
    const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
    const previousTimelineTime = lastSourceAudioSyncTimeRef.current;
    const timelineJumped =
      previousTimelineTime === null ||
      Math.abs(liveCurrentTime - previousTimelineTime) > 0.25;
    const driftThreshold = isPlaying ? 0.35 : 0.01;

    for (const audio of sourceAudioElementsRef.current.values()) {
      enablePitchPreservingPlayback(audio);
      const audioDuration = Number.isFinite(audio.duration)
        ? audio.duration
        : null;
      const startDelaySeconds = estimateCompanionAudioStartDelaySeconds(
        duration,
        audioDuration,
        sourceAudioFallbackStartDelayMsByPath[
          audio.dataset.sourceAudioPath ?? ""
        ],
      );
      const beforeAudioStart = liveCurrentTime + 0.001 < startDelaySeconds;
      const targetTime = clampMediaTimeToDuration(
        liveCurrentTime - startDelaySeconds,
        audioDuration,
      );

      if (
        timelineJumped ||
        Math.abs(audio.currentTime - targetTime) > driftThreshold
      ) {
        try {
          audio.currentTime = targetTime;
        } catch {
          // no-op
        }
      }

      const syncedPlaybackRate = getMediaSyncPlaybackRate({
        basePlaybackRate: targetPlaybackRate,
        currentTime: audio.currentTime,
        targetTime,
      });
      if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
        audio.playbackRate = syncedPlaybackRate;
      }

      const atEnd = audioDuration !== null && targetTime >= audioDuration;
      if (isPlaying && !beforeAudioStart && !atEnd) {
        audio.play().catch(() => undefined);
      } else if (!audio.paused) {
        audio.pause();
      }
    }

    lastSourceAudioSyncTimeRef.current = liveCurrentTime;
  }, [
    currentTime,
    duration,
    isPlaying,
    previewSourceAudioFallbackPaths,
    sourceAudioFallbackStartDelayMsByPath,
    effectiveSpeedRegions,
  ]);

  useEffect(() => {
    syncSourceAudioFallback();
  }, [syncSourceAudioFallback]);

  // While playing, React time state is frozen, so the audio drift correction
  // above would only run once per play. Tick it on a timer instead; both
  // callbacks read the live frame time from playbackTimeStore.
  useEffect(() => {
    if (!isPlaying) return;
    const intervalId = window.setInterval(() => {
      syncOverlayAudio();
      syncSourceAudioFallback();
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [isPlaying, syncOverlayAudio, syncSourceAudioFallback]);

  const showExportSuccessToast = useCallback((filePath: string) => {
    toast.success(`Exported successfully to ${filePath}`, {
      action: {
        label: "Show in Folder",
        onClick: async () => {
          try {
            const result = await window.electronAPI.revealInFolder(filePath);
            if (!result.success) {
              const errorMessage =
                result.error ||
                result.message ||
                "Failed to reveal item in folder.";
              toast.error(errorMessage);
            }
          } catch (err) {
            toast.error(`Error revealing in folder: ${String(err)}`);
          }
        },
      },
    });
  }, []);

  const handleExport = useCallback(
    async (settings: ExportSettings) => {
      if (!videoPath) {
        toast.error("No video loaded");
        return;
      }

      const video = videoPlaybackRef.current?.video;
      if (!video) {
        toast.error("Video not ready");
        return;
      }

      setIsExporting(true);
      setExportProgress(null);
      setExportError(null);
      clearPendingExportSave();
      extensionHost.emitEvent({ type: "export:start" });
      const smokeExportStartedAt = smokeExportConfig.enabled
        ? performance.now()
        : null;

      let keepExportDialogOpen = false;

      try {
        const wasPlaying = isPlaying;
        const restoreTime = video.currentTime;
        if (wasPlaying) {
          videoPlaybackRef.current?.pause();
        }

        // Get preview CONTAINER dimensions for scaling
        const playbackRef = videoPlaybackRef.current;
        const containerElement = playbackRef?.containerRef?.current;
        const previewWidth = containerElement?.clientWidth || 1920;
        const previewHeight = containerElement?.clientHeight || 1080;
        const effectiveShadowIntensity =
          smokeExportConfig.enabled &&
          smokeExportConfig.shadowIntensity !== undefined
            ? smokeExportConfig.shadowIntensity
            : shadowIntensity;
        const smokeProgressSamples: Array<Record<string, unknown>> = [];
        let lastSmokeProgressSampleAt = 0;
        let lastSmokeProgressPhase: ExportProgress["phase"] | undefined;
        const recordSmokeProgress = (progress: ExportProgress) => {
          if (!smokeExportConfig.enabled || smokeExportStartedAt === null) {
            return;
          }

          const now = performance.now();
          const phase = progress.phase ?? "extracting";
          const shouldSample =
            smokeProgressSamples.length === 0 ||
            phase !== lastSmokeProgressPhase ||
            now - lastSmokeProgressSampleAt >= 1000 ||
            progress.currentFrame >= progress.totalFrames;

          if (!shouldSample) {
            return;
          }

          smokeProgressSamples.push({
            elapsedMs: Math.round(now - smokeExportStartedAt),
            phase,
            currentFrame: progress.currentFrame,
            totalFrames: progress.totalFrames,
            percentage: progress.percentage,
            estimatedTimeRemaining: progress.estimatedTimeRemaining,
            renderFps: progress.renderFps,
            renderBackend: progress.renderBackend,
            encodeBackend: progress.encodeBackend,
            encoderName: progress.encoderName,
          });
          lastSmokeProgressSampleAt = now;
          lastSmokeProgressPhase = phase;
        };

        if (settings.format === "gif" && settings.gifConfig) {
          // GIF Export
          const gifExporter = new GifExporter({
            videoUrl: videoPath,
            width: settings.gifConfig.width,
            height: settings.gifConfig.height,
            frameRate: settings.gifConfig.frameRate,
            loop: settings.gifConfig.loop,
            sizePreset: settings.gifConfig.sizePreset,
            wallpaper,
            trimRegions,
            speedRegions: effectiveSpeedRegions,
            showShadow: effectiveShadowIntensity > 0,
            shadowIntensity: effectiveShadowIntensity,
            backgroundBlur,
            zoomMotionBlur,
            zoomMotionBlurTuning,
            zoomTemporalMotionBlur,
            zoomMotionBlurSampleCount,
            zoomMotionBlurShutterFraction,
            connectZooms,
            zoomInDurationMs,
            zoomInOverlapMs,
            zoomOutDurationMs,
            connectedZoomGapMs,
            connectedZoomDurationMs,
            zoomInEasing,
            zoomOutEasing,
            connectedZoomEasing,
            borderRadius,
            padding,
            videoPadding: padding,
            cropRegion,
            webcam,
            webcamUrl:
              resolvedWebcamVideoUrl ??
              (webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null),
            annotationRegions,
            autoCaptions,
            autoCaptionSettings,
            zoomRegions: effectiveZoomRegions,
            cursorTelemetry: effectiveCursorTelemetry,
            showCursor: effectiveShowCursor,
            cursorStyle,
            cursorSize,
            cursorSmoothing,
            cursorSpringStiffnessMultiplier,
            cursorSpringDampingMultiplier,
            cursorSpringMassMultiplier,
            cameraSpringStiffnessMultiplier,
            cameraSpringDampingMultiplier,
            cameraSpringMassMultiplier,
            zoomSmoothness,
            zoomClassicMode,
            cursorMotionBlur,
            cursorClickBounce,
            cursorClickBounceDuration,
            cursorClickEffect,
            cursorSway,
            frame,
            previewWidth,
            previewHeight,
            maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
            maxPendingFrames: smokeExportConfig.maxPendingFrames,
            onProgress: (progress: ExportProgress) => {
              recordSmokeProgress(progress);
              setExportProgress(progress);
            },
          });

          exporterRef.current = gifExporter as unknown as VideoExporter;
          const result = await gifExporter.export();

          if (result.success && result.blob) {
            const timestamp = Date.now();
            const fileName = `export-${timestamp}.gif`;
            markExportAsSaving();

            const { saveResult, pendingSave } = await saveBlobExport(
              result.blob,
              fileName,
              smokeExportConfig.enabled ? smokeExportConfig.outputPath : null,
            );

            if (saveResult.canceled) {
              pendingExportSaveRef.current = pendingSave;
              setHasPendingExportSave(true);
              setExportError(
                "Save dialog canceled. Click Save Again to save without re-rendering.",
              );
              toast.info(
                "Save canceled. You can save again without re-exporting.",
              );
              keepExportDialogOpen = true;
            } else if (saveResult.success && saveResult.path) {
              if (smokeExportStartedAt !== null) {
                console.log(
                  `[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
                );
              }
              showExportSuccessToast(saveResult.path);
              setExportedFilePath(saveResult.path);
              if (smokeExportConfig.enabled) {
                window.close();
                return;
              }
            } else {
              setExportError(saveResult.message || "Failed to save GIF");
              toast.error(saveResult.message || "Failed to save GIF");
              if (smokeExportConfig.enabled) {
                window.close();
                return;
              }
            }
          } else {
            setExportError(result.error || "GIF export failed");
            toast.error(result.error || "GIF export failed");
            if (smokeExportConfig.enabled) {
              window.close();
              return;
            }
          }
        } else {
          // MP4 Export
          const quality = smokeExportConfig.enabled
            ? (smokeExportConfig.quality ?? settings.quality ?? exportQuality)
            : (settings.quality ?? exportQuality);
          const encodingMode = smokeExportConfig.enabled
            ? (smokeExportConfig.encodingMode ??
              settings.encodingMode ??
              exportEncodingMode)
            : (settings.encodingMode ?? exportEncodingMode);
          const selectedMp4FrameRate = smokeExportConfig.enabled
            ? (smokeExportConfig.fps ?? settings.mp4FrameRate ?? mp4FrameRate)
            : (settings.mp4FrameRate ?? mp4FrameRate);
          const pipelineModel = smokeExportConfig.enabled
            ? (smokeExportConfig.pipelineModel ?? "modern")
            : (settings.pipelineModel ?? exportPipelineModel);
          const useExperimentalNativeExport =
            pipelineModel === "modern" &&
            (smokeExportConfig.enabled
              ? smokeExportConfig.useNativeExport
              : true);
          const backendPreference =
            pipelineModel === "legacy"
              ? "webcodecs"
              : useExperimentalNativeExport
                ? "auto"
                : smokeExportConfig.enabled
                  ? (smokeExportConfig.backendPreference ??
                    (smokeExportConfig.useNativeExport
                      ? "breeze"
                      : "webcodecs"))
                  : (settings.backendPreference ?? exportBackendPreference);
          const supportedSourceDimensions =
            await ensureSupportedMp4SourceDimensions(selectedMp4FrameRate);
          const { width: exportWidth, height: exportHeight } =
            calculateMp4ExportDimensions(
              supportedSourceDimensions.width,
              supportedSourceDimensions.height,
              quality,
            );
          const bitrate = getMp4ExportBitrate({
            width: exportWidth,
            height: exportHeight,
            frameRate: selectedMp4FrameRate,
            quality,
            encodingMode,
            useModernNativeStaticLayout: useExperimentalNativeExport,
          });

          const exporterConfig = {
            videoUrl: videoPath,
            width: exportWidth,
            height: exportHeight,
            frameRate: selectedMp4FrameRate,
            bitrate,
            codec: DEFAULT_MP4_CODEC,
            encodingMode,
            preferredEncoderPath: supportedSourceDimensions.encoderPath,
            preferredRenderBackend: smokeExportConfig.renderBackend,
            experimentalNativeExport: useExperimentalNativeExport,
            maxEncodeQueue: smokeExportConfig.maxEncodeQueue,
            maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
            maxPendingFrames: smokeExportConfig.maxPendingFrames,
            wallpaper,
            trimRegions,
            speedRegions: effectiveSpeedRegions,
            showShadow: effectiveShadowIntensity > 0,
            shadowIntensity: effectiveShadowIntensity,
            backgroundBlur,
            zoomMotionBlur,
            zoomMotionBlurTuning,
            zoomTemporalMotionBlur,
            zoomMotionBlurSampleCount,
            zoomMotionBlurShutterFraction,
            connectZooms,
            zoomInDurationMs,
            zoomInOverlapMs,
            zoomOutDurationMs,
            connectedZoomGapMs,
            connectedZoomDurationMs,
            zoomInEasing,
            zoomOutEasing,
            connectedZoomEasing,
            borderRadius,
            padding,
            cropRegion,
            webcam,
            webcamUrl:
              resolvedWebcamVideoUrl ??
              (webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null),
            annotationRegions,
            autoCaptions,
            autoCaptionSettings,
            zoomRegions: effectiveZoomRegions,
            cursorTelemetry: effectiveCursorTelemetry,
            showCursor: effectiveShowCursor,
            cursorStyle,
            cursorSize,
            cursorSmoothing,
            cursorSpringStiffnessMultiplier,
            cursorSpringDampingMultiplier,
            cursorSpringMassMultiplier,
            cameraSpringStiffnessMultiplier,
            cameraSpringDampingMultiplier,
            cameraSpringMassMultiplier,
            zoomSmoothness,
            zoomClassicMode,
            cursorMotionBlur,
            cursorClickBounce,
            cursorClickBounceDuration,
            cursorClickEffect,
            cursorSway,
            frame,
            audioRegions,
            sourceAudioFallbackPaths,
            sourceAudioFallbackStartDelayMsByPath,
            previewWidth,
            previewHeight,
            onProgress: (progress: ExportProgress) => {
              recordSmokeProgress(progress);
              setExportProgress(progress);
            },
          };

          const exporter =
            pipelineModel === "modern"
              ? new ModernVideoExporter({
                  ...exporterConfig,
                  backendPreference,
                })
              : new VideoExporter(exporterConfig);

          exporterRef.current = exporter;
          const result = await exporter.export();
          const smokeExportElapsedMs =
            smokeExportStartedAt !== null
              ? Math.round(performance.now() - smokeExportStartedAt)
              : undefined;

          if (result.success && (result.blob || result.tempFilePath)) {
            const timestamp = Date.now();
            const fileName = `export-${timestamp}.mp4`;
            markExportAsSaving();

            let saveResult: {
              success: boolean;
              path?: string;
              message?: string;
              canceled?: boolean;
            };
            let pendingOnCancel: PendingExportSave;

            if (result.tempFilePath) {
              // Preferred path: main process already holds the finished MP4 on
              // disk, so we just ask it to move the temp file into place. This
              // avoids ever allocating a multi-GiB ArrayBuffer in the renderer.
              saveResult = await window.electronAPI.finalizeExportedVideo({
                tempPath: result.tempFilePath,
                fileName,
                outputPath:
                  smokeExportConfig.enabled && smokeExportConfig.outputPath
                    ? smokeExportConfig.outputPath
                    : null,
              });
              pendingOnCancel = { fileName, tempFilePath: result.tempFilePath };
            } else if (result.blob) {
              // Legacy fallback: some export paths still surface a Blob, but in
              // Electron we stream it into a temp file first so save/finalize
              // never requires a giant renderer ArrayBuffer.
              const blobSave = await saveBlobExport(
                result.blob,
                fileName,
                smokeExportConfig.enabled ? smokeExportConfig.outputPath : null,
              );
              saveResult = blobSave.saveResult;
              pendingOnCancel = blobSave.pendingSave;
            } else {
              saveResult = {
                success: false,
                message: "Export produced no output",
              };
              pendingOnCancel = { fileName };
            }

            if (saveResult.canceled) {
              if (smokeExportConfig.enabled) {
                await writeSmokeExportReport(smokeExportConfig.outputPath, {
                  success: false,
                  phase: "save",
                  format: "mp4",
                  pipelineModel,
                  backendPreference,
                  encodingMode,
                  shadowIntensity: effectiveShadowIntensity,
                  elapsedMs: smokeExportElapsedMs,
                  error: "Save canceled",
                  progressSamples: smokeProgressSamples,
                  metrics: result.metrics,
                });
              }
              pendingExportSaveRef.current = pendingOnCancel;
              setHasPendingExportSave(true);
              setExportError(
                "Save dialog canceled. Click Save Again to save without re-rendering.",
              );
              toast.info(
                "Save canceled. You can save again without re-exporting.",
              );
              keepExportDialogOpen = true;
            } else if (saveResult.success && saveResult.path) {
              if (smokeExportConfig.enabled) {
                await writeSmokeExportReport(smokeExportConfig.outputPath, {
                  success: true,
                  phase: "saved",
                  format: "mp4",
                  pipelineModel,
                  backendPreference,
                  encodingMode,
                  shadowIntensity: effectiveShadowIntensity,
                  elapsedMs: smokeExportElapsedMs,
                  outputPath: saveResult.path,
                  progressSamples: smokeProgressSamples,
                  metrics: result.metrics,
                });
              }
              if (smokeExportStartedAt !== null) {
                console.log(
                  `[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
                );
              }
              showExportSuccessToast(saveResult.path);
              setExportedFilePath(saveResult.path);
              if (smokeExportConfig.enabled) {
                window.close();
                return;
              }
            } else {
              if (smokeExportConfig.enabled) {
                await writeSmokeExportReport(smokeExportConfig.outputPath, {
                  success: false,
                  phase: "save",
                  format: "mp4",
                  pipelineModel,
                  backendPreference,
                  encodingMode,
                  shadowIntensity: effectiveShadowIntensity,
                  elapsedMs: smokeExportElapsedMs,
                  error: saveResult.message || "Failed to save video",
                  progressSamples: smokeProgressSamples,
                  metrics: result.metrics,
                });
              }
              setExportError(saveResult.message || "Failed to save video");
              showExportErrorToast(
                saveResult.message || "Failed to save video",
              );
              // Keep the pending-save entry so the user can retry without
              // re-rendering. The temp file is still on disk (the main
              // process only moves/deletes it on success) and the
              // ArrayBuffer fallback still references its in-memory blob.
              if (pendingOnCancel.tempFilePath || pendingOnCancel.arrayBuffer) {
                pendingExportSaveRef.current = pendingOnCancel;
                setHasPendingExportSave(true);
                keepExportDialogOpen = true;
              }
              if (smokeExportConfig.enabled) {
                window.close();
                return;
              }
            }
          } else {
            if (smokeExportConfig.enabled) {
              await writeSmokeExportReport(smokeExportConfig.outputPath, {
                success: false,
                phase: "export",
                format: "mp4",
                pipelineModel,
                backendPreference,
                encodingMode,
                shadowIntensity: effectiveShadowIntensity,
                elapsedMs: smokeExportElapsedMs,
                error: result.error || "Export failed",
                progressSamples: smokeProgressSamples,
                metrics: result.metrics,
              });
            }
            setExportError(result.error || "Export failed");
            showExportErrorToast(result.error || "Export failed");
            keepExportDialogOpen = true;
            if (smokeExportConfig.enabled) {
              window.close();
              return;
            }
          }
        }

        if (wasPlaying) {
          videoPlaybackRef.current?.play();
        } else {
          video.currentTime = restoreTime;
        }
      } catch (error) {
        console.error("Export error:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (smokeExportConfig.enabled) {
          await writeSmokeExportReport(smokeExportConfig.outputPath, {
            success: false,
            phase: "exception",
            format: settings.format,
            elapsedMs:
              smokeExportStartedAt !== null
                ? Math.round(performance.now() - smokeExportStartedAt)
                : undefined,
            error: errorMessage,
          });
        }
        setExportError(errorMessage);
        showExportErrorToast(`Export failed: ${errorMessage}`);
        keepExportDialogOpen = true;
        if (smokeExportConfig.enabled) {
          window.close();
        }
      } finally {
        extensionHost.emitEvent({ type: "export:complete" });
        setIsExporting(false);
        exporterRef.current = null;
        setShowExportDropdown(keepExportDialogOpen);
        remountPreview();
      }
    },
    [
      clearPendingExportSave,
      videoPath,
      wallpaper,
      trimRegions,
      shadowIntensity,
      backgroundBlur,
      zoomMotionBlur,
      zoomMotionBlurTuning,
      zoomTemporalMotionBlur,
      zoomMotionBlurSampleCount,
      zoomMotionBlurShutterFraction,
      connectZooms,
      zoomInDurationMs,
      zoomInOverlapMs,
      zoomOutDurationMs,
      connectedZoomGapMs,
      connectedZoomDurationMs,
      zoomInEasing,
      zoomOutEasing,
      connectedZoomEasing,
      effectiveShowCursor,
      cursorStyle,
      effectiveCursorTelemetry,
      cursorSize,
      cursorSmoothing,
      cursorSpringStiffnessMultiplier,
      cursorSpringDampingMultiplier,
      cursorSpringMassMultiplier,
      cameraSpringStiffnessMultiplier,
      cameraSpringDampingMultiplier,
      cameraSpringMassMultiplier,
      zoomSmoothness,
      zoomClassicMode,
      cursorMotionBlur,
      cursorClickBounce,
      cursorClickBounceDuration,
      cursorSway,
      audioRegions,
      sourceAudioFallbackPaths,
      sourceAudioFallbackStartDelayMsByPath,
      exportEncodingMode,
      exportBackendPreference,
      exportPipelineModel,
      borderRadius,
      padding,
      cropRegion,
      webcam,
      resolvedWebcamVideoUrl,
      annotationRegions,
      autoCaptions,
      autoCaptionSettings,
      isPlaying,
      exportQuality,
      effectiveZoomRegions,
      ensureSupportedMp4SourceDimensions,
      markExportAsSaving,
      mp4FrameRate,
      remountPreview,
      showExportSuccessToast,
      smokeExportConfig.backendPreference,
      smokeExportConfig.renderBackend,
      smokeExportConfig.enabled,
      smokeExportConfig.useNativeExport,
      smokeExportConfig.maxDecodeQueue,
      smokeExportConfig.maxEncodeQueue,
      smokeExportConfig.maxPendingFrames,
      smokeExportConfig.outputPath,
      smokeExportConfig.pipelineModel,
      smokeExportConfig.shadowIntensity,
      effectiveSpeedRegions,
      frame,
      smokeExportConfig.encodingMode,
      smokeExportConfig.fps,
      smokeExportConfig.quality,
      saveBlobExport,
    ],
  );

  useEffect(() => {
    smokeExportReadyStateRef.current = {
      cursorTelemetrySourcePath,
      duration,
      hasVideoPath: Boolean(videoPath),
      isPreviewReady,
      loading,
      projectPath: smokeExportConfig.projectPath ?? null,
      videoSourcePath,
    };
  }, [
    cursorTelemetrySourcePath,
    duration,
    isPreviewReady,
    loading,
    smokeExportConfig.projectPath,
    videoPath,
    videoSourcePath,
  ]);

  useEffect(() => {
    if (!smokeExportConfig.enabled) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (smokeExportStartedRef.current) {
        return;
      }

      smokeExportStartedRef.current = true;
      void writeSmokeExportReport(smokeExportConfig.outputPath, {
        success: false,
        phase: "ready",
        error: `Smoke export did not become ready within ${SMOKE_EXPORT_READY_TIMEOUT_MS}ms.`,
        readyState: smokeExportReadyStateRef.current,
      }).finally(() => window.close());
    }, SMOKE_EXPORT_READY_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [smokeExportConfig.enabled, smokeExportConfig.outputPath]);

  useEffect(() => {
    if (!smokeExportConfig.enabled || smokeExportStartedRef.current) {
      return;
    }

    if (error) {
      smokeExportStartedRef.current = true;
      console.error(`[smoke-export] ${error}`);
      void writeSmokeExportReport(smokeExportConfig.outputPath, {
        success: false,
        phase: "load",
        error,
        readyState: smokeExportReadyStateRef.current,
      }).finally(() => window.close());
      return;
    }

    if (!videoPath || loading || !isPreviewReady || duration <= 0) {
      return;
    }

    // When smoke-export opens a .quiro project, the cursor telemetry
    // sidecar is loaded asynchronously after the editor state applies.
    // Without this gate the auto-export fires before telemetry arrives and
    // produces a video with no cursor/zoom animations.
    if (
      smokeExportConfig.projectPath &&
      videoSourcePath &&
      cursorTelemetrySourcePath !== videoSourcePath
    ) {
      return;
    }

    smokeExportStartedRef.current = true;
    void handleExport({
      format: "mp4",
      quality: "good",
      encodingMode: smokeExportConfig.encodingMode ?? "balanced",
    });
  }, [
    cursorTelemetrySourcePath,
    error,
    handleExport,
    isPreviewReady,
    loading,
    duration,
    smokeExportConfig.enabled,
    smokeExportConfig.encodingMode,
    smokeExportConfig.outputPath,
    smokeExportConfig.projectPath,
    videoPath,
    videoSourcePath,
  ]);

  const handleOpenExportDropdown = useCallback(() => {
    if (!videoPath) {
      toast.error("No video loaded");
      return;
    }

    if (hasPendingExportSave) {
      setShowExportDropdown(true);
      setExportError(
        "Save dialog canceled. Click Save Again to save without re-rendering.",
      );
      return;
    }
    setShowExportDropdown(true);
    setExportProgress(null);
    setExportError(null);
  }, [videoPath, hasPendingExportSave]);

  const handleStartExportFromDropdown = useCallback(() => {
    const video = videoPlaybackRef.current?.video;
    if (!videoPath) {
      toast.error("No video loaded");
      return;
    }
    if (!video) {
      toast.error("Video not ready");
      return;
    }

    const sourceWidth = video.videoWidth || 1920;
    const sourceHeight = video.videoHeight || 1080;
    const gifDimensions = calculateOutputDimensions(
      sourceWidth,
      sourceHeight,
      gifSizePreset,
      GIF_SIZE_PRESETS,
    );

    const settings: ExportSettings = {
      format: exportFormat,
      encodingMode: exportFormat === "mp4" ? exportEncodingMode : undefined,
      mp4FrameRate: exportFormat === "mp4" ? mp4FrameRate : undefined,
      backendPreference:
        exportFormat === "mp4" ? exportBackendPreference : undefined,
      pipelineModel: exportFormat === "mp4" ? exportPipelineModel : undefined,
      quality: exportFormat === "mp4" ? exportQuality : undefined,
      gifConfig:
        exportFormat === "gif"
          ? {
              frameRate: gifFrameRate,
              loop: gifLoop,
              sizePreset: gifSizePreset,
              width: gifDimensions.width,
              height: gifDimensions.height,
            }
          : undefined,
    };

    setExportError(null);
    setExportedFilePath(undefined);
    setShowExportDropdown(true);
    handleExport(settings);
  }, [
    videoPath,
    exportFormat,
    exportEncodingMode,
    exportQuality,
    mp4FrameRate,
    gifFrameRate,
    gifLoop,
    gifSizePreset,
    exportBackendPreference,
    exportPipelineModel,
    handleExport,
  ]);

  const handleCancelExport = useCallback(() => {
    if (exporterRef.current) {
      exporterRef.current.cancel();
      toast.info("Export canceled");
      clearPendingExportSave();
      setShowExportDropdown(false);
      setIsExporting(false);
      setExportProgress(null);
      setExportError(null);
      setExportedFilePath(undefined);
    }
  }, [clearPendingExportSave]);

  const handleExportDropdownClose = useCallback(() => {
    clearPendingExportSave();
    setShowExportDropdown(false);
    setExportProgress(null);
    setExportError(null);
    setExportedFilePath(undefined);
  }, [clearPendingExportSave]);

  const handleRetrySaveExport = useCallback(async () => {
    const pendingSave = pendingExportSaveRef.current;
    if (!pendingSave) {
      return;
    }

    let saveResult: {
      success: boolean;
      path?: string;
      message?: string;
      canceled?: boolean;
    };

    if (pendingSave.tempFilePath) {
      saveResult = await window.electronAPI.finalizeExportedVideo({
        tempPath: pendingSave.tempFilePath,
        fileName: pendingSave.fileName,
        outputPath: null,
      });
    } else if (pendingSave.arrayBuffer) {
      saveResult = await window.electronAPI.saveExportedVideo(
        pendingSave.arrayBuffer,
        pendingSave.fileName,
      );
    } else {
      saveResult = { success: false, message: "No pending export to save" };
    }

    if (saveResult.canceled) {
      setExportError(
        "Save dialog canceled. Click Save Again to save without re-rendering.",
      );
      toast.info("Save canceled. You can try again.");
      return;
    }

    if (saveResult.success && saveResult.path) {
      // finalizeExportedVideo already moved the temp file into place, so the
      // pending-save entry no longer refers to a file on disk. Flip the flag
      // directly to avoid clearPendingExportSave issuing a spurious discard.
      pendingExportSaveRef.current = null;
      setHasPendingExportSave(false);
      setExportError(null);
      setExportedFilePath(saveResult.path);
      showExportSuccessToast(saveResult.path);
      setShowExportDropdown(true);
      return;
    }

    const errorMessage = saveResult.message || "Failed to save video";
    setExportError(errorMessage);
    toast.error(errorMessage);
  }, [showExportSuccessToast]);

  const handleOpenCropEditor = useCallback(() => {
    cropSnapshotRef.current = { ...cropRegion };
    setShowCropModal(true);
  }, [cropRegion]);

  const handleCloseCropEditor = useCallback(() => {
    setShowCropModal(false);
  }, []);

  const handleCancelCropEditor = useCallback(() => {
    if (cropSnapshotRef.current) {
      setCropRegion(cropSnapshotRef.current);
    }
    setShowCropModal(false);
  }, []);

  const isCropped = useMemo(() => {
    const top = Math.round(cropRegion.y * 100);
    const left = Math.round(cropRegion.x * 100);
    const bottom = Math.round((1 - cropRegion.y - cropRegion.height) * 100);
    const right = Math.round((1 - cropRegion.x - cropRegion.width) * 100);
    return top > 0 || left > 0 || bottom > 0 || right > 0;
  }, [cropRegion]);

  const revealExportedFile = useCallback(async () => {
    if (!exportedFilePath) return;

    try {
      const result = await window.electronAPI.revealInFolder(exportedFilePath);
      if (!result.success) {
        toast.error(
          result.error || result.message || "Failed to reveal item in folder.",
        );
      }
    } catch (error) {
      toast.error(`Failed to reveal item in folder: ${String(error)}`);
    }
  }, [exportedFilePath]);

  const openLightningIssues = useCallback(async () => {
    await openExternalLink(
      QUIRO_ISSUES_URL,
      t("editor.feedback.openFailed", "Failed to open link."),
    );
  }, [t]);

  const isExportSaving = exportProgress?.phase === "saving";
  const isExportPreparing =
    isExporting && (!exportProgress || exportProgress.phase === "preparing");
  const isExportFinalizing = exportProgress?.phase === "finalizing";
  const isRenderingAudio =
    isExportFinalizing && typeof exportProgress?.audioProgress === "number";
  const exportFinalizingProgress = isExportFinalizing
    ? Math.min(
        typeof exportProgress?.renderProgress === "number"
          ? exportProgress.renderProgress
          : (exportProgress?.percentage ?? 100),
        100,
      )
    : null;
  const exportFinalizingPercent = isExportFinalizing
    ? Math.round(exportFinalizingProgress ?? 100)
    : null;
  const isExportMuxingAndSaving =
    isExportFinalizing &&
    exportFormat === "mp4" &&
    exportPipelineModel === "modern" &&
    !isRenderingAudio;
  const isExportFinalSaveIndeterminate =
    isExportMuxingAndSaving && (exportFinalizingPercent ?? 0) >= 98;
  const isLightningExportInProgress =
    exportFormat === "mp4" &&
    exportPipelineModel === "modern" &&
    (isExporting || exportProgress !== null);
  const shouldSuspendPreviewRendering =
    isExporting && exportFormat === "mp4" && exportPipelineModel === "modern";
  const isLegacyExportInProgress =
    exportFormat === "mp4" &&
    exportPipelineModel === "legacy" &&
    (isExporting || exportProgress !== null);
  const exportRenderSpeedLabel =
    !isExportPreparing &&
    !isExportFinalizing &&
    !isExportSaving &&
    typeof exportProgress?.renderFps === "number" &&
    Number.isFinite(exportProgress.renderFps) &&
    exportProgress.renderFps > 0
      ? t("editor.exportStatus.renderSpeed", "Render speed {{fps}} FPS", {
          fps: exportProgress.renderFps.toFixed(1),
        })
      : null;
  const exportRuntimeLabel = useMemo(() => {
    const renderBackend = exportProgress?.renderBackend;
    const encodeBackend = exportProgress?.encodeBackend;
    const encoderName = exportProgress?.encoderName;

    if (!renderBackend && !encodeBackend && !encoderName) {
      return null;
    }

    const rendererLabel =
      renderBackend === "webgpu"
        ? "WebGPU"
        : renderBackend === "webgl"
          ? "WebGL"
          : null;
    const encoderLabel =
      encodeBackend === "ffmpeg"
        ? "Breeze"
        : encodeBackend === "webcodecs"
          ? "WebCodecs"
          : null;
    const pathLabel =
      rendererLabel && encoderLabel
        ? `${rendererLabel} + ${encoderLabel}`
        : (rendererLabel ?? encoderLabel);

    if (!pathLabel) {
      return encoderName ?? null;
    }

    return encoderName ? `${pathLabel} (${encoderName})` : pathLabel;
  }, [exportProgress]);
  const exportNativeSkipReasons =
    exportProgress?.nativeStaticLayoutSkipReasons &&
    exportProgress.nativeStaticLayoutSkipReasons.length > 0
      ? exportProgress.nativeStaticLayoutSkipReasons
      : exportProgress?.nativeStaticLayoutSkipReason
        ? [exportProgress.nativeStaticLayoutSkipReason]
        : [];
  const exportNativeSkipLabel =
    exportNativeSkipReasons.length > 0
      ? `Native skipped: ${exportNativeSkipReasons[0]}${
          exportNativeSkipReasons.length > 1
            ? ` (+${exportNativeSkipReasons.length - 1} more)`
            : ""
        }`
      : null;
  const exportPercentLabel = exportProgress
    ? isExportPreparing
      ? t("editor.exportStatus.preparing", "Preparing export...")
      : isExportSaving
        ? t("editor.exportStatus.saving", "Opening save dialog...")
        : isRenderingAudio
          ? t(
              "editor.exportStatus.renderingAudio",
              "Rendering audio {{percent}}%",
              {
                percent: Math.round((exportProgress.audioProgress ?? 0) * 100),
              },
            )
          : isExportFinalizing
            ? exportFormat === "mp4" && exportPipelineModel === "modern"
              ? isExportFinalSaveIndeterminate
                ? t(
                    "editor.exportStatus.muxingAndSaving",
                    "Muxing audio and saving file...",
                  )
                : t(
                    "editor.exportStatus.muxingAndSavingPercent",
                    "Muxing and saving {{percent}}%",
                    {
                      percent: exportFinalizingPercent ?? 100,
                    },
                  )
              : t(
                  "editor.exportStatus.finalizingPercent",
                  "Finalizing {{percent}}%",
                  {
                    percent: exportFinalizingPercent ?? 100,
                  },
                )
            : t(
                "editor.exportStatus.completePercent",
                "{{percent}}% complete",
                {
                  percent: Math.round(exportProgress.percentage),
                },
              )
    : t("editor.exportStatus.preparing", "Preparing export...");

  const handleAddAnnotationLayer = useCallback(() => {
    const nextTrackIndex =
      annotationRegions.length > 0
        ? Math.max(...annotationRegions.map((r) => r.trackIndex ?? 0)) + 1
        : 0;

    timelineRef.current?.addAnnotation(nextTrackIndex);
  }, [annotationRegions]);

  const handleAddAudioLayer = useCallback(() => {
    const nextTrackIndex =
      audioRegions.length > 0
        ? Math.max(...audioRegions.map((region) => region.trackIndex ?? 0)) + 1
        : 0;

    timelineRef.current?.addAudio(nextTrackIndex);
  }, [audioRegions]);

  const projectBrowser = (
    <ProjectBrowserDialog
      open={projectBrowserOpen}
      onOpenChange={setProjectBrowserOpen}
      entries={projectLibraryEntries}
      anchorRef={
        error ? projectBrowserFallbackTriggerRef : projectBrowserTriggerRef
      }
      onOpenProject={(projectPath) => {
        const normalizeForCompare = (value: string | null | undefined) =>
          value?.replace(/\\/g, "/").toLowerCase() ?? null;
        if (
          normalizeForCompare(projectPath) ===
          normalizeForCompare(currentProjectPath)
        ) {
          void repairCurrentProject({ rebuildEditorCaches: true });
          return;
        }

        void handleOpenProjectFromLibrary(projectPath);
      }}
    />
  );
  const nativeCaptureUnavailableDialog = (
    <NativeCaptureUnavailableDialog
      open={nativeCaptureUnavailableModalOpen}
      onOpenChange={setNativeCaptureUnavailableModalOpen}
    />
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-foreground flex items-center gap-2">
          <Spinner className="size-20" />
          <p className="text-sm">{t("editor.loading", "Loading...")}</p>
        </div>
        {projectBrowser}
        {nativeCaptureUnavailableDialog}
        <Toaster className="pointer-events-auto" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="text-destructive">{error}</div>
          <Button
            ref={projectBrowserFallbackTriggerRef}
            type="button"
            onClick={handleOpenProjectBrowser}
          >
            Open Projects
          </Button>
        </div>
        {projectBrowser}
        {nativeCaptureUnavailableDialog}
        <Toaster className="pointer-events-auto" />
      </div>
    );
  }

  return (
    <Profiler id="editor-root" onRender={handleProfilerRender}>
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden selection:bg-primary/30 selection:text-primary">
      <div
        className="relative flex h-11 shrink-0 items-center justify-between bg-editor-header/88 px-5 backdrop-blur-md border-b border-foreground/10 z-50"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div
          className={`flex items-center gap-1.5 justify-self-start ${headerLeftControlsPaddingClass} no-drag`}
        >
          <Button
            ref={projectBrowserTriggerRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleOpenProjectBrowser}
            className={APP_HEADER_ICON_BUTTON_CLASS}
            title={t("editor.project.projects", "Open projects")}
            aria-label={t("editor.project.projects", "Open projects")}
          >
            <FolderOpenIcon className="size-4" />
          </Button>
          <FeedbackDialog />
          <Separator orientation="vertical" className="h-5 my-auto" />
          <Button
            type="button"
            variant={"ghost"}
            onClick={handleUndo}
            disabled={!canUndo}
            className={APP_HEADER_ICON_BUTTON_CLASS}
            title={t("common.actions.undo", "Undo")}
            aria-label={t("common.actions.undo", "Undo")}
          >
            <UndoIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant={"ghost"}
            onClick={handleRedo}
            disabled={!canRedo}
            className={APP_HEADER_ICON_BUTTON_CLASS}
            title={t("common.actions.redo", "Redo")}
            aria-label={t("common.actions.redo", "Redo")}
          >
            <RedoIcon className="size-4" />
          </Button>
          <EditorHistoryPopover
            entries={historyEntries}
            currentEntryId={currentHistoryEntry?.id ?? null}
            onJumpTo={jumpHistoryTo}
          />
        </div>
        <div className="absolute left-1/2 flex min-w-0 -translate-x-1/2 items-center justify-center no-drag">
          <ProjectNameEditor
            displayValue={projectDisplayName}
            hasUnsavedChanges={hasUnsavedChanges}
            onSave={saveProjectWithName}
          />
        </div>
        <div className="flex items-center justify-self-end pr-3 no-drag pl-3">
          <EditorPresetPopover
            open={presetPopoverOpen}
            onOpenChange={setPresetPopoverOpen}
            presets={editorPresets}
            currentPresetId={currentEditorPreset?.id}
            currentPresetName={currentEditorPreset?.name}
            presetNameDraft={presetNameDraft}
            onPresetNameDraftChange={setPresetNameDraft}
            onSavePreset={handleSavePresetSubmit}
            onApplyPreset={handleApplyEditorPreset}
            onDeletePreset={handleDeleteEditorPreset}
          />
          <Separator orientation="vertical" className="h-5 my-auto" />
          <EditorExportDropdown
            open={showExportDropdown}
            onOpenChange={(nextOpen) => {
              if (nextOpen) {
                handleOpenExportDropdown();
                return;
              }

              setShowExportDropdown(false);
            }}
            isExporting={isExporting}
            isLightningExportInProgress={isLightningExportInProgress}
            isLegacyExportInProgress={isLegacyExportInProgress}
            isExportPreparing={isExportPreparing}
            isExportSaving={isExportSaving}
            isExportFinalSaveIndeterminate={isExportFinalSaveIndeterminate}
            isRenderingAudio={isRenderingAudio}
            exportProgress={exportProgress}
            exportFinalizingProgress={exportFinalizingProgress}
            exportPercentLabel={exportPercentLabel}
            exportRenderSpeedLabel={exportRenderSpeedLabel}
            exportRuntimeLabel={exportRuntimeLabel}
            exportNativeSkipLabel={exportNativeSkipLabel}
            exportError={exportError}
            exportedFilePath={exportedFilePath}
            hasPendingExportSave={hasPendingExportSave}
            onOpenLightningIssues={openLightningIssues}
            onCancelExport={handleCancelExport}
            onRetrySaveExport={handleRetrySaveExport}
            onCloseExportDropdown={handleExportDropdownClose}
            onRevealExportedFile={revealExportedFile}
            exportFormat={exportFormat}
            onExportFormatChange={setExportFormat}
            exportEncodingMode={exportEncodingMode}
            onExportEncodingModeChange={setExportEncodingMode}
            mp4FrameRate={mp4FrameRate}
            onMp4FrameRateChange={setMp4FrameRate}
            exportPipelineModel={exportPipelineModel}
            onExportPipelineModelChange={setExportPipelineModel}
            exportQuality={exportQuality}
            onExportQualityChange={setExportQuality}
            gifFrameRate={gifFrameRate}
            onGifFrameRateChange={setGifFrameRate}
            gifLoop={gifLoop}
            onGifLoopChange={setGifLoop}
            gifSizePreset={gifSizePreset}
            onGifSizePresetChange={setGifSizePreset}
            mp4OutputDimensions={mp4OutputDimensions}
            gifOutputDimensions={gifOutputDimensions}
            onStartExport={handleStartExportFromDropdown}
          />
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-h-0 flex-1 gap-3 relative z-10">
          {/* Sidebar */}
          <div className="flex shrink-0  gap-1-5">
            <EditorSectionRail
              activeSection={activeEffectSection}
              sections={editorSectionButtons}
              onSectionChange={setActiveEffectSection}
              onAccountClick={() => toast.info("Account coming soon")}
            />
            {activeEffectSection === "extensions" ? null : (
              <Profiler id="settings-panel" onRender={handleProfilerRender}>
              <SettingsPanel
                panelMode="editor"
                activeEffectSection={activeEffectSection}
                selected={wallpaper}
                onWallpaperChange={setWallpaper}
                selectedZoomDepth={
                  selectedZoomId
                    ? zoomRegions.find((z) => z.id === selectedZoomId)?.depth
                    : null
                }
                onZoomDepthChange={handleZoomDepthChange}
                selectedZoomId={selectedZoomId}
                selectedZoomMode={
                  selectedZoomId
                    ? (zoomRegions.find((z) => z.id === selectedZoomId)?.mode ??
                      "auto")
                    : null
                }
                selectedZoomPresetId={
                  selectedZoomId
                    ? (zoomRegions.find((z) => z.id === selectedZoomId)
                        ?.presetId ?? null)
                    : null
                }
                onZoomModeChange={handleZoomModeChange}
                onZoomPresetChange={handleZoomPresetChange}
                onZoomVisibilityChange={handleZoomVisibilityChange}
                onZoomDelete={handleZoomDelete}
                selectedClipId={selectedClipId}
                selectedClipSpeed={
                  selectedClipId
                    ? (clipRegions.find((c) => c.id === selectedClipId)
                        ?.speed ?? 1)
                    : null
                }
                selectedClipMuted={
                  selectedClipId
                    ? (clipRegions.find((c) => c.id === selectedClipId)
                        ?.muted ?? false)
                    : null
                }
                onClipSpeedChange={handleClipSpeedChange}
                onClipMutedChange={handleClipMutedChange}
                onClipDelete={handleClipDelete}
                selectedSpeedId={selectedSpeedId}
                selectedSpeedValue={
                  selectedSpeedId
                    ? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null)
                    : null
                }
                onSpeedValueChange={handleSpeedValueChange}
                onSpeedDelete={handleSpeedDelete}
                selectedAudioId={selectedAudioId}
                selectedAudioVolume={
                  selectedAudioId
                    ? (audioRegions.find((r) => r.id === selectedAudioId)
                        ?.volume ?? null)
                    : null
                }
                onAudioVolumeChange={handleAudioVolumeChange}
                onAudioDelete={handleAudioDelete}
                shadowIntensity={shadowIntensity}
                onShadowChange={setShadowIntensity}
                backgroundBlur={backgroundBlur}
                onBackgroundBlurChange={setBackgroundBlur}
                zoomMotionBlurTuning={zoomMotionBlurTuning}
                onZoomMotionBlurTuningChange={setZoomMotionBlurTuning}
                zoomTemporalMotionBlur={zoomTemporalMotionBlur}
                onZoomTemporalMotionBlurChange={setZoomTemporalMotionBlur}
                zoomMotionBlurSampleCount={zoomMotionBlurSampleCount}
                onZoomMotionBlurSampleCountChange={setZoomMotionBlurSampleCount}
                zoomMotionBlurShutterFraction={zoomMotionBlurShutterFraction}
                onZoomMotionBlurShutterFractionChange={
                  setZoomMotionBlurShutterFraction
                }
                autoApplyFreshRecordingAutoZooms={
                  autoApplyFreshRecordingAutoZooms
                }
                onAutoApplyFreshRecordingAutoZoomsChange={
                  setAutoApplyFreshRecordingAutoZooms
                }
                connectZooms={connectZooms}
                onConnectZoomsChange={setConnectZooms}
                zoomInDurationMs={zoomInDurationMs}
                onZoomInDurationMsChange={setZoomInDurationMs}
                zoomInOverlapMs={zoomInOverlapMs}
                onZoomInOverlapMsChange={setZoomInOverlapMs}
                zoomOutDurationMs={zoomOutDurationMs}
                onZoomOutDurationMsChange={setZoomOutDurationMs}
                connectedZoomGapMs={connectedZoomGapMs}
                onConnectedZoomGapMsChange={setConnectedZoomGapMs}
                connectedZoomDurationMs={connectedZoomDurationMs}
                onConnectedZoomDurationMsChange={setConnectedZoomDurationMs}
                zoomInEasing={zoomInEasing}
                onZoomInEasingChange={setZoomInEasing}
                zoomOutEasing={zoomOutEasing}
                onZoomOutEasingChange={setZoomOutEasing}
                connectedZoomEasing={connectedZoomEasing}
                onConnectedZoomEasingChange={setConnectedZoomEasing}
                showCursor={effectiveShowCursor}
                onShowCursorChange={handleShowCursorChange}
                loopCursor={loopCursor}
                onLoopCursorChange={setLoopCursor}
                cursorStyle={cursorStyle}
                onCursorStyleChange={setCursorStyle}
                cursorSize={cursorSize}
                onCursorSizeChange={setCursorSize}
                cursorSmoothing={cursorSmoothing}
                onCursorSmoothingChange={setCursorSmoothing}
                cursorSpringStiffnessMultiplier={
                  cursorSpringStiffnessMultiplier
                }
                onCursorSpringStiffnessMultiplierChange={
                  setCursorSpringStiffnessMultiplier
                }
                cursorSpringDampingMultiplier={cursorSpringDampingMultiplier}
                onCursorSpringDampingMultiplierChange={
                  setCursorSpringDampingMultiplier
                }
                cursorSpringMassMultiplier={cursorSpringMassMultiplier}
                onCursorSpringMassMultiplierChange={
                  setCursorSpringMassMultiplier
                }
                cameraSpringStiffnessMultiplier={
                  cameraSpringStiffnessMultiplier
                }
                onCameraSpringStiffnessMultiplierChange={
                  setCameraSpringStiffnessMultiplier
                }
                cameraSpringDampingMultiplier={cameraSpringDampingMultiplier}
                onCameraSpringDampingMultiplierChange={
                  setCameraSpringDampingMultiplier
                }
                cameraSpringMassMultiplier={cameraSpringMassMultiplier}
                onCameraSpringMassMultiplierChange={
                  setCameraSpringMassMultiplier
                }
                zoomClassicMode={zoomClassicMode}
                onZoomClassicModeChange={setZoomClassicMode}
                cursorMotionBlur={cursorMotionBlur}
                onCursorMotionBlurChange={setCursorMotionBlur}
                cursorClickBounce={cursorClickBounce}
                onCursorClickBounceChange={setCursorClickBounce}
                cursorClickBounceDuration={cursorClickBounceDuration}
                onCursorClickBounceDurationChange={setCursorClickBounceDuration}
                cursorClickEffect={cursorClickEffect}
                onCursorClickEffectChange={setCursorClickEffect}
                cursorSway={cursorSway}
                onCursorSwayChange={setCursorSway}
                borderRadius={borderRadius}
                onBorderRadiusChange={setBorderRadius}
                webcam={webcam}
                webcamPreviewSrc={
                  webcam.sourcePath ? resolvedWebcamVideoUrl : null
                }
                webcamPreviewCurrentTime={currentTime}
                webcamPreviewPlaying={isPlaying}
                onWebcamChange={setWebcam}
                onUploadWebcam={handleUploadWebcam}
                onClearWebcam={handleClearWebcam}
                padding={padding}
                onPaddingChange={setPadding}
                frame={frame}
                onFrameChange={setFrame}
                cropRegion={cropRegion}
                onCropChange={setCropRegion}
                aspectRatio={aspectRatio}
                onAspectRatioChange={setAspectRatio}
                selectedAnnotationId={selectedAnnotationId}
                zoomRegions={zoomRegions}
                annotationRegions={annotationRegions}
                projectSnapshots={projectSnapshots}
                onCreateProjectSnapshot={handleCreateManualSnapshot}
                onRestoreProjectSnapshot={restoreProjectSnapshot}
                onAnnotationVisibilityChange={handleAnnotationVisibilityChange}
                onAnnotationReorder={handleAnnotationReorder}
                onAnnotationOpacityChange={handleAnnotationBaseOpacityChange}
                onAnnotationScaleChange={handleAnnotationBaseScaleChange}
                onAnnotationAnimationChange={handleAnnotationAnimationChange}
                onAnnotationAddKeyframe={handleAnnotationAddKeyframe}
                onAnnotationDeleteKeyframe={handleAnnotationDeleteKeyframe}
                autoCaptions={autoCaptions}
                autoCaptionSettings={autoCaptionSettings}
                whisperExecutablePath={whisperExecutablePath}
                whisperModelPath={whisperModelPath}
                whisperModelDownloadStatus={whisperModelDownloadStatus}
                whisperModelDownloadProgress={whisperModelDownloadProgress}
                isGeneratingCaptions={isGeneratingCaptions}
                onAutoCaptionSettingsChange={setAutoCaptionSettings}
                onPickWhisperExecutable={handlePickWhisperExecutable}
                onPickWhisperModel={handlePickWhisperModel}
                onGenerateAutoCaptions={handleGenerateAutoCaptions}
                onClearAutoCaptions={handleClearAutoCaptions}
                onDownloadWhisperSmallModel={handleDownloadWhisperSmallModel}
                onDeleteWhisperSmallModel={handleDeleteWhisperSmallModel}
                nativeCaptureUnavailableSession={
                  sessionNativeCaptureUnavailable
                }
                onOpenNativeCaptureUnavailableModal={
                  handleOpenNativeCaptureUnavailableModal
                }
                onAnnotationContentChange={handleAnnotationContentChange}
                onAnnotationTypeChange={handleAnnotationTypeChange}
                onAnnotationStyleChange={handleAnnotationStyleChange}
                onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
                onAnnotationBlurIntensityChange={
                  handleAnnotationBlurIntensityChange
                }
                onAnnotationBlurColorChange={handleAnnotationBlurColorChange}
                onAnnotationDelete={handleAnnotationDelete}
              />
              </Profiler>
            )}
          </div>

          {/* Main content */}
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
                <div className="flex items-center justify-center gap-2 py-1.5 shrink-0">
                  <AspectRatioDropdown
                    aspectRatio={aspectRatio}
                    onAspectRatioChange={setAspectRatio}
                  />
                  <div className="w-px h-4 bg-foreground/20" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenCropEditor}
                    disabled={!videoPath}
                  >
                    <CropIcon className="w-3.5 h-3.5" />
                    <span className="font-medium">
                      {t("settings.crop.title")}
                    </span>
                    {isCropped ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    ) : null}
                  </Button>
                </div>

                {/* Video Preview */}
                <div
                  className="flex w-full min-h-0 flex-1 items-stretch"
                  style={{ flex: "1 1 auto", margin: "6px 0 0" }}
                >
                  <div className="flex min-w-0 flex-1 items-center justify-center px-1">
                    <div
                      className="relative overflow-hidden rounded-2xl w-auto h-full max-w-full box-border my-0 mx-auto"
                      style={{
                        aspectRatio: getAspectRatioValue(
                          aspectRatio,
                          (() => {
                            const previewVideo =
                              videoPlaybackRef.current?.video;
                            if (previewVideo && previewVideo.videoHeight > 0) {
                              return (
                                previewVideo.videoWidth /
                                previewVideo.videoHeight
                              );
                            }
                            return 16 / 9;
                          })(),
                        ),
                      }}
                    >
                      <Profiler id="preview" onRender={handleProfilerRender}>
                      <VideoPlayback
                        key={`${videoPath || "no-video"}:${workspaceReloadVersion}:${previewVersion}`}
                        aspectRatio={aspectRatio}
                        ref={videoPlaybackRef}
                        videoPath={videoPath || ""}
                        onDurationChange={setDuration}
                        onPreviewReadyChange={setIsPreviewReady}
                        onTimeUpdate={handlePlaybackTimeUpdate}
                        currentTime={currentTime}
                        onPlayStateChange={handlePlayStateChange}
                        onError={setError}
                        wallpaper={wallpaper}
                        zoomRegions={effectiveZoomRegions}
                        selectedZoomId={selectedZoomId}
                        onSelectZoom={handleSelectZoom}
                        onZoomFocusChange={handleZoomFocusChange}
                        isPlaying={isPlaying}
                        showShadow={shadowIntensity > 0}
                        shadowIntensity={shadowIntensity}
                        backgroundBlur={backgroundBlur}
                        connectZooms={connectZooms}
                        zoomInDurationMs={zoomInDurationMs}
                        zoomInOverlapMs={zoomInOverlapMs}
                        zoomOutDurationMs={zoomOutDurationMs}
                        connectedZoomGapMs={connectedZoomGapMs}
                        connectedZoomDurationMs={connectedZoomDurationMs}
                        zoomInEasing={zoomInEasing}
                        zoomOutEasing={zoomOutEasing}
                        connectedZoomEasing={connectedZoomEasing}
                        borderRadius={borderRadius}
                        padding={padding}
                        frame={frame}
                        cropRegion={cropRegion}
                        webcam={webcam}
                        webcamVideoPath={
                          webcam.sourcePath ? resolvedWebcamVideoUrl : null
                        }
                        trimRegions={trimRegions}
                        speedRegions={effectiveSpeedRegions}
                        annotationRegions={annotationRegions}
                        autoCaptions={autoCaptions}
                        autoCaptionSettings={autoCaptionSettings}
                        selectedAnnotationId={selectedAnnotationId}
                        onSelectAnnotation={handleSelectAnnotation}
                        onAnnotationPositionChange={
                          handleAnnotationPositionChange
                        }
                        onAnnotationSizeChange={handleAnnotationSizeChange}
                        cursorTelemetry={effectiveCursorTelemetry}
                        showCursor={effectiveShowCursor}
                        cursorStyle={cursorStyle}
                        cursorSize={cursorSize}
                        cursorSmoothing={cursorSmoothing}
                        cursorSpringStiffnessMultiplier={
                          cursorSpringStiffnessMultiplier
                        }
                        cursorSpringDampingMultiplier={
                          cursorSpringDampingMultiplier
                        }
                        cursorSpringMassMultiplier={cursorSpringMassMultiplier}
                        cameraSpringStiffnessMultiplier={
                          cameraSpringStiffnessMultiplier
                        }
                        cameraSpringDampingMultiplier={
                          cameraSpringDampingMultiplier
                        }
                        cameraSpringMassMultiplier={cameraSpringMassMultiplier}
                        zoomSmoothness={zoomSmoothness}
                        zoomClassicMode={zoomClassicMode}
                        zoomMotionBlur={zoomMotionBlur}
                        zoomMotionBlurTuning={zoomMotionBlurTuning}
                        cursorMotionBlur={cursorMotionBlur}
                        cursorClickBounce={cursorClickBounce}
                        cursorClickBounceDuration={cursorClickBounceDuration}
                        cursorClickEffect={cursorClickEffect}
                        cursorSway={cursorSway}
                        volume={shouldMutePreviewVideo ? 0 : previewVolume}
                        suspendRendering={shouldSuspendPreviewRendering}
                      />
                      </Profiler>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="relative flex shrink-0 items-center p-1">
              <div className="z-10 flex min-w-0 flex-1 items-center gap-1.5">
                <AddLayerDropdown
                  onAddAnnotation={handleAddAnnotationLayer}
                  onAddAudio={handleAddAudioLayer}
                />
                <div className="w-px h-4 bg-foreground/20" />
                <ShortcutTooltip
                  label={t("timeline.zoom.addZoom")}
                  action="addZoom"
                  side="top"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => timelineRef.current?.addZoom()}
                  >
                    <SearchAddIcon className="w-3.5 h-3.5" />
                  </Button>
                </ShortcutTooltip>
                <ShortcutTooltip
                  label={t("timeline.zoom.suggestZooms")}
                  side="top"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => timelineRef.current?.suggestZooms()}
                  >
                    <MagicWand01Icon className="w-3.5 h-3.5" />
                  </Button>
                </ShortcutTooltip>
                <ShortcutTooltip
                  label="Magic first draft"
                  side="top"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleRunFirstDraft}
                    disabled={isFirstDraftRunning}
                  >
                    <AiMagicIcon className="w-3.5 h-3.5" />
                  </Button>
                </ShortcutTooltip>
                <ShortcutTooltip
                  label={t("editor.toolbar.splitClip")}
                  action="splitClip"
                  side="top"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => timelineRef.current?.splitClip()}
                  >
                    <Scissor01Icon className="w-4 h-4" />
                  </Button>
                </ShortcutTooltip>
              </div>
              <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-1.5 pointer-events-auto">
                  <span className="mr-1 text-xs font-medium tabular-nums text-muted-foreground">
                    <LiveTimecode fallbackSec={timelinePlayheadTime} />
                  </span>
                  <ShortcutTooltip
                    label={t("editor.playback.skipBack")}
                    side="top"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        // Read live time: React state is frozen during playback.
                        const currentMs =
                          playbackTimeStore.get()?.timelineMs ??
                          timelinePlayheadTime * 1000;
                        const kfs = timelineRef.current?.keyframes ?? [];
                        const prev = [...kfs]
                          .reverse()
                          .find((k) => k.time < currentMs - 50);
                        handleSeek(
                          prev
                            ? prev.time / 1000
                            : Math.max(0, currentMs / 1000 - 5),
                        );
                      }}
                    >
                      <IconPlayerTrackPrevFilled className="w-3.5 h-3.5" />
                    </Button>
                  </ShortcutTooltip>
                  <ShortcutTooltip
                    label={isPlaying ? t("editor.playback.pause", "Pause") : t("editor.playback.play", "Play")}
                    action="playPause"
                    side="top"
                  >
                    <Button
                      variant={"ghost"}
                      size={"icon"}
                      className={
                        "bg-primary hover:bg-app-700! shadow-soft-md transition-colors duration-500"
                      }
                      onClick={togglePlayPause}
                    >
                      {isPlaying ? (
                        <IconPlayerPauseFilled className="w-3.5 h-3.5" />
                      ) : (
                        <IconPlayerPlayFilled className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </ShortcutTooltip>
                  <ShortcutTooltip
                    label={t("editor.playback.skipForward")}
                    side="top"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        // Read live time: React state is frozen during playback.
                        const currentMs =
                          playbackTimeStore.get()?.timelineMs ??
                          timelinePlayheadTime * 1000;
                        const kfs = timelineRef.current?.keyframes ?? [];
                        const next = kfs.find((k) => k.time > currentMs + 50);
                        handleSeek(
                          next
                            ? next.time / 1000
                            : Math.min(duration, currentMs / 1000 + 5),
                        );
                      }}
                    >
                      <IconPlayerTrackNextFilled className="w-3.5 h-3.5" />
                    </Button>
                  </ShortcutTooltip>
                  <span className="text-xs font-medium text-muted-foreground/70 tabular-nums ml-1">
                    {formatTime(duration)}
                  </span>
                </div>
              </div>

              {/* Right: collapse + volume */}
              <div className="z-10 ml-auto flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none"
                    title="Timeline density"
                  >
                    <TimelineListIcon className="w-3.5 h-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={8}
                    className="w-52"
                  >
                    {TIMELINE_DENSITY_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.mode}
                        onClick={() => setTimelineDensityMode(option.mode)}
                        className="items-start gap-2"
                      >
                        <span
                          className="mt-1 size-1.5 rounded-full bg-muted-foreground/35 data-[active=true]:bg-primary"
                          data-active={timelineDensityMode === option.mode}
                        />
                        <span className="min-w-0">
                          <span className="block text-[12px] font-medium">
                            {option.label}
                          </span>
                          <span className="block text-[10px] leading-3 text-muted-foreground/70">
                            {option.description}
                          </span>
                        </span>
                        {timelineDensityMode === option.mode ? (
                          <Tick02Icon className="ml-auto mt-0.5 size-3 text-primary" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="icon"
                  title={
                    timelineCollapsed
                      ? t("editor.timeline.expand")
                      : t("editor.timeline.collapse")
                  }
                  className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
                  onClick={() => {
                    setTimelineCollapsed((p) => !p);
                  }}
                >
                  <motion.span
                    key={timelineCollapsed ? "collapsed" : "expanded"}
                    initial={{
                      rotate: timelineCollapsed ? -140 : 140,
                      scale: 0.88,
                    }}
                    animate={{ rotate: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 520, damping: 22 }}
                    className="flex"
                  >
                    {timelineCollapsed ? (
                      <ArrowUp01Icon className="w-3.5 h-3.5" />
                    ) : (
                      <ArrowDown01Icon className="w-3.5 h-3.5" />
                    )}
                  </motion.span>
                </Button>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant={"ghost"}
                    size={"icon"}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={t("editor.playback.muteUnmute")}
                    onClick={() =>
                      setPreviewVolume(previewVolume <= 0.001 ? 1 : 0)
                    }
                  >
                    {previewVolume <= 0.001 ? (
                      <VolumeOffIcon className="w-3.5 h-3.5" />
                    ) : previewVolume < 0.5 ? (
                      <VolumeLowIcon className="w-3.5 h-3.5" />
                    ) : (
                      <VolumeHighIcon className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Scrubber
                    className="h-7 w-24"
                    decimals={2}
                    // fillWidth={
                    //   previewVolume > 0
                    //     ? `max(calc(${previewVolume * 100}% - 6px), 1.2rem)`
                    //     : "0"
                    // }
                    label={`${Math.round(previewVolume * 100)}%`}
                    max={1}
                    min={0}
                    onValueChange={setPreviewVolume}
                    showValue={false}
                    size="sm"
                    step={0.01}
                    ticks={0}
                    // thumbClassName="bg-foreground/95 shadow-[0_0_10px_rgba(240,128,48,0.28)]"
                    // trackClassName="rounded-full border border-border bg-background shadow-soft-lg"
                    value={previewVolume}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right-hand AI panel — flex sibling mirroring the left SettingsPanel
              so the timeline below stays full-width and is never overlapped. */}
          <AiChatPanel
            open={aiPanelOpen}
            onToggle={handleToggleAiPanel}
            actions={editorActions}
            videoPath={videoPath}
            durationMs={duration}
            whisperTinyModelDownloadStatus={whisperTinyModelDownloadStatus}
            onDownloadWhisperModel={handleDownloadWhisperTinyModel}
          />
        </div>
        <motion.div
          initial={false}
          animate={{
            height: timelineCollapsed
              ? "0%"
              : `${getTimelinePanelSizing(timelineDensityMode).heightPercent}%`,
            minHeight: timelineCollapsed
              ? 0
              : getTimelinePanelSizing(timelineDensityMode).minHeightPx,
          }}
          // snappy spring for collapsing/expanding timeline + density changes
          transition={{
            type: "spring",
            stiffness: 550,
            damping: 40,
            mass: 0.5,
          }}
          className="flex shrink-0 flex-col"
        >
          <Profiler id="timeline" onRender={handleProfilerRender}>
          <TimelineEditor
            key={`${videoPath || "no-video"}:${workspaceReloadVersion}`}
            ref={timelineRef}
            hideToolbar
            videoDuration={duration}
            currentTime={currentTime}
            playheadTime={timelinePlayheadTime}
            densityMode={timelineDensityMode}
            onSeek={handleSeek}
            videoPath={videoPath}
            cursorTelemetry={normalizedCursorTelemetry}
            autoSuggestZoomsTrigger={autoSuggestZoomsTrigger}
            onAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
            zoomRegions={zoomRegions}
            onZoomAdded={handleZoomAdded}
            onZoomSuggested={handleZoomSuggested}
            onZoomSpanChange={handleZoomSpanChange}
            onZoomDelete={handleZoomDelete}
            selectedZoomId={selectedZoomId}
            onSelectZoom={handleSelectZoom}
            trimRegions={trimRegions}
            clipRegions={clipRegions}
            onClipSplit={handleClipSplit}
            onClipSpanChange={handleClipSpanChange}
            selectedClipId={selectedClipId}
            onSelectClip={handleSelectClip}
            audioRegions={audioRegions}
            onAudioAdded={handleAudioAdded}
            onAudioSpanChange={handleAudioSpanChange}
            onAudioDelete={handleAudioDelete}
            selectedAudioId={selectedAudioId}
            onSelectAudio={handleSelectAudio}
            speedRegions={speedRegions}
            onSpeedAdded={handleSpeedAdded}
            onSpeedSpanChange={handleSpeedSpanChange}
            onSpeedDelete={handleSpeedDelete}
            selectedSpeedId={selectedSpeedId}
            onSelectSpeed={handleSelectSpeed}
            annotationRegions={annotationRegions}
            onAnnotationAdded={handleAnnotationAdded}
            onAnnotationSpanChange={handleAnnotationSpanChange}
            onAnnotationDelete={handleAnnotationDelete}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={handleSelectAnnotation}
            aspectRatio={aspectRatio}
          />
          </Profiler>
        </motion.div>
      </div>

      <CropEditorDialog
        open={showCropModal}
        videoElement={videoPlaybackRef.current?.video || null}
        cropRegion={cropRegion}
        onCropChange={setCropRegion}
        aspectRatio={aspectRatio}
        onCancel={handleCancelCropEditor}
        onDone={handleCloseCropEditor}
      />

      {projectBrowser}
      {nativeCaptureUnavailableDialog}

      <Toaster  className="pointer-events-auto" />
    </div>
    </Profiler>
  );
}
