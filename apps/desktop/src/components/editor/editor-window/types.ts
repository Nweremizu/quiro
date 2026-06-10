import type {
  AnnotationRegion,
  AudioRegion,
  CaptionCue,
  ClipRegion,
  SpeedRegion,
  TrimRegion,
  ZoomRegion,
} from "@/types/editor";

export type EditorHistorySnapshot = {
  zoomRegions: ZoomRegion[];
  clipRegions: ClipRegion[];
  speedRegions: SpeedRegion[];
  annotationRegions: AnnotationRegion[];
  audioRegions: AudioRegion[];
  autoCaptions: CaptionCue[];
  selectedZoomId: string | null;
  selectedClipId: string | null;
  selectedAnnotationId: string | null;
  selectedAudioId: string | null;
};

export type EditorHistoryEntry = {
  id: string;
  label: string;
  createdAt: string;
  snapshot: EditorHistorySnapshot;
};

export type PendingExportSave = {
  fileName: string;
  // Exactly one of these is populated. `tempFilePath` is the preferred form
  // for MP4 exports because the main process holds the finished file on disk.
  arrayBuffer?: ArrayBuffer;
  tempFilePath?: string;
};

export type CancelableExporter = {
  cancel(): void;
};

export type TimelineTrackState = {
  trimRegions: TrimRegion[];
  clipRegions: ClipRegion[];
  speedRegions: SpeedRegion[];
};
