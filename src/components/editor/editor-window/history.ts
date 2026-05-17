import type { EditorHistoryEntry, EditorHistorySnapshot } from "./types";

const HISTORY_LIMIT = 100;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function countById<T extends { id: string }>(items: T[]) {
  return new Set(items.map((item) => item.id));
}

function hasMoved<T extends { id: string; startMs: number; endMs: number }>(
  previous: T[],
  next: T[],
) {
  const byId = new Map(previous.map((item) => [item.id, item]));
  return next.some((item) => {
    const before = byId.get(item.id);
    return (
      before &&
      (before.startMs !== item.startMs || before.endMs !== item.endMs)
    );
  });
}

function describeRegionChange<T extends { id: string; startMs: number; endMs: number }>(
  previous: T[],
  next: T[],
  singular: string,
) {
  const previousIds = countById(previous);
  const nextIds = countById(next);

  if (next.length > previous.length) {
    return `Added ${singular}`;
  }

  if (next.length < previous.length) {
    return `Deleted ${singular}`;
  }

  if (
    previous.some((item) => !nextIds.has(item.id)) ||
    next.some((item) => !previousIds.has(item.id))
  ) {
    return `Changed ${singular}`;
  }

  if (hasMoved(previous, next)) {
    return `Moved ${singular}`;
  }

  return null;
}

export function describeHistoryChange(
  previous: EditorHistorySnapshot,
  next: EditorHistorySnapshot,
) {
  return (
    describeRegionChange(previous.zoomRegions, next.zoomRegions, "zoom") ??
    describeRegionChange(previous.clipRegions, next.clipRegions, "clip") ??
    describeRegionChange(
      previous.annotationRegions,
      next.annotationRegions,
      "annotation",
    ) ??
    describeRegionChange(previous.audioRegions, next.audioRegions, "audio") ??
    (previous.autoCaptions.length !== next.autoCaptions.length
      ? "Changed captions"
      : null) ??
    (previous.selectedZoomId !== next.selectedZoomId ||
    previous.selectedClipId !== next.selectedClipId ||
    previous.selectedAnnotationId !== next.selectedAnnotationId ||
    previous.selectedAudioId !== next.selectedAudioId
      ? "Selection changed"
      : null) ??
    "Editor change"
  );
}

export function createHistoryEntry(
  snapshot: EditorHistorySnapshot,
  label = "Initial state",
): EditorHistoryEntry {
  return {
    id: createId(),
    label,
    createdAt: new Date().toISOString(),
    snapshot,
  };
}

export function appendHistoryEntry(
  entries: EditorHistoryEntry[],
  currentIndex: number,
  entry: EditorHistoryEntry,
  limit = HISTORY_LIMIT,
) {
  const nextEntries = [...entries.slice(0, currentIndex + 1), entry];
  const overflow = Math.max(0, nextEntries.length - limit);
  const cappedEntries = overflow > 0 ? nextEntries.slice(overflow) : nextEntries;
  const nextIndex = cappedEntries.length - 1;

  return { entries: cappedEntries, index: nextIndex };
}

export function findHistoryIndex(entries: EditorHistoryEntry[], entryId: string) {
  return entries.findIndex((entry) => entry.id === entryId);
}

