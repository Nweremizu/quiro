import { describe, expect, it } from "vitest";
import type { EditorHistorySnapshot } from "./types";
import {
  appendHistoryEntry,
  createHistoryEntry,
  describeHistoryChange,
  findHistoryIndex,
} from "./history";

function snapshot(
  overrides: Partial<EditorHistorySnapshot> = {},
): EditorHistorySnapshot {
  return {
    zoomRegions: [],
    clipRegions: [],
    speedRegions: [],
    annotationRegions: [],
    audioRegions: [],
    autoCaptions: [],
    selectedZoomId: null,
    selectedClipId: null,
    selectedAnnotationId: null,
    selectedAudioId: null,
    ...overrides,
  };
}

describe("editor history helpers", () => {
  it("labels added, deleted, and moved timeline regions", () => {
    const empty = snapshot();
    const withZoom = snapshot({
      zoomRegions: [
        {
          id: "zoom-1",
          startMs: 0,
          endMs: 1000,
          depth: 1,
          focus: { cx: 0.5, cy: 0.5 },
        },
      ],
    });
    const movedZoom = snapshot({
      zoomRegions: [
        {
          id: "zoom-1",
          startMs: 500,
          endMs: 1500,
          depth: 1,
          focus: { cx: 0.5, cy: 0.5 },
        },
      ],
    });

    expect(describeHistoryChange(empty, withZoom)).toBe("Added zoom");
    expect(describeHistoryChange(withZoom, empty)).toBe("Deleted zoom");
    expect(describeHistoryChange(withZoom, movedZoom)).toBe("Moved zoom");
  });

  it("preserves forward history when finding a jump target", () => {
    const first = createHistoryEntry(snapshot(), "Initial state");
    const second = createHistoryEntry(
      snapshot({ selectedClipId: "clip-1" }),
      "Selection changed",
    );
    const third = createHistoryEntry(
      snapshot({ selectedAnnotationId: "annotation-1" }),
      "Selection changed",
    );
    const entries = [first, second, third];

    expect(findHistoryIndex(entries, first.id)).toBe(0);
    expect(entries[2]).toBe(third);
  });

  it("drops redo entries on append and caps history", () => {
    const first = createHistoryEntry(snapshot(), "Initial state");
    const second = createHistoryEntry(
      snapshot({ selectedClipId: "clip-1" }),
      "Selection changed",
    );
    const redo = createHistoryEntry(
      snapshot({ selectedAudioId: "audio-1" }),
      "Selection changed",
    );
    const appended = appendHistoryEntry(
      [first, second, redo],
      1,
      createHistoryEntry(snapshot({ selectedZoomId: "zoom-1" }), "Selection changed"),
      3,
    );

    expect(appended.entries).toHaveLength(3);
    expect(appended.entries.some((entry) => entry.id === redo.id)).toBe(false);
    expect(appended.index).toBe(2);

    const capped = appendHistoryEntry(
      appended.entries,
      appended.index,
      createHistoryEntry(snapshot({ selectedAnnotationId: "a" }), "Selection changed"),
      3,
    );

    expect(capped.entries).toHaveLength(3);
    expect(capped.entries.some((entry) => entry.id === first.id)).toBe(false);
    expect(capped.index).toBe(2);
  });
});

