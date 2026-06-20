import { describe, expect, it, vi } from "vitest";
import { runFirstDraft } from "./firstDraft";
import type { EditorActions } from "./contract";
import type { CaptionCue, CursorTelemetryPoint } from "@/types/editor";

const CLICK_TELEMETRY: CursorTelemetryPoint[] = [
  {
    timeMs: 2000,
    cx: 0.5,
    cy: 0.5,
    interactionType: "click",
  },
];

const AUTO_CAPTION: CaptionCue[] = [
  {
    id: "c1",
    startMs: 0,
    endMs: 1200,
    text: "hello world",
    words: [],
  },
];

function createActions(overrides: Partial<EditorActions> = {}): EditorActions {
  const actions: EditorActions = {
    snapshot: () => ({
      durationMs: 10000,
      zoomRegions: [],
      clipRegions: [],
      speedRegions: [],
      annotationCount: 0,
      captionsEnabled: false,
      captionCueCount: 0,
      hasTelemetry: false,
      hasTranscript: false,
    }),
    getBrainInputs: () => ({
      sourcePath: "/tmp/video.mp4",
      durationMs: 10000,
      transcript: [],
      cursorTelemetry: CLICK_TELEMETRY,
    }),
    applyZoomSuggestions: () => {},
    addZoomRegion: () => {},
    setKeptClips: () => {},
    applyCaptions: () => {},
    generateCaptions: async () => ({ ok: true, cues: AUTO_CAPTION, message: "mock captions" }),
    addAnnotation: () => {},
    setSpeedRegion: () => {},
    beginAiBatch: () => {},
    endAiBatch: () => {},
    ...overrides,
  };
  return actions;
}

describe("runFirstDraft", () => {
  it("returns an error if no source video is loaded", async () => {
    const actions = createActions({
      getBrainInputs: () => ({
        sourcePath: "",
        durationMs: 10000,
        transcript: [],
        cursorTelemetry: [],
      }),
    });

    const result = await runFirstDraft(actions);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-source");
  });

  it("generates captions when missing and returns a successful draft summary", async () => {
    const applyCaptions = vi.fn();
    const actions = createActions({
      applyCaptions,
      generateCaptions: async () => ({ ok: true, cues: AUTO_CAPTION, message: "mock captions" }),
    });

    const result = await runFirstDraft(actions);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Generated captions");
    expect(applyCaptions).toHaveBeenCalled();
  });
});
