import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentTurn } from "./agent";
import type {
  AiCompleteRequest,
  AiCompleteResult,
  AiToolDefinition,
  EditorActions,
} from "./contract";

function createActions(overrides: Partial<EditorActions> = {}): EditorActions {
  return {
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
      cursorTelemetry: [],
    }),
    applyZoomSuggestions: () => {},
    addZoomRegion: () => {},
    updateZoomRegion: () => {},
    setKeptClips: () => {},
    applyCaptions: () => {},
    generateCaptions: async () => ({
      ok: false,
      message: "No audio was found to transcribe in the saved recording file.",
      reason: "generate-captions-failed",
    }),
    addAnnotation: () => {},
    setSpeedRegion: () => {},
    beginAiBatch: () => {},
    endAiBatch: () => {},
    ...overrides,
  };
}

function toolNames(request: AiCompleteRequest): string[] {
  return (request.tools ?? []).map((tool: AiToolDefinition) => tool.name);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runAgentTurn — non-retryable tool guard", () => {
  it("stops offering generate_captions after it fails, instead of letting the model retry it", async () => {
    const complete = vi.fn<
      (request: AiCompleteRequest) => Promise<AiCompleteResult>
    >();

    // Iteration 1: model calls generate_captions.
    complete.mockImplementationOnce(async (request) => {
      expect(toolNames(request)).toContain("generate_captions");
      return {
        requestId: request.requestId,
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "call-1",
            name: "generate_captions",
            input: {},
          },
        ],
      };
    });

    // Iteration 2: generate_captions must no longer be offered — the model
    // cannot retry it even if it wanted to.
    complete.mockImplementationOnce(async (request) => {
      expect(toolNames(request)).not.toContain("generate_captions");
      return {
        requestId: request.requestId,
        stopReason: "end_turn",
        content: [
          {
            type: "text",
            text: "This recording has no audio track, so I couldn't add captions.",
          },
        ],
      };
    });

    vi.stubGlobal("window", {
      electronAPI: {
        ai: {
          complete,
          getAiPreferences: async () => null,
        },
      },
    });

    const actions = createActions();
    const result = await runAgentTurn({
      userMessage: "Add captions",
      previousMessages: [],
      actions,
    });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.toolsApplied).toHaveLength(1);
    expect(result.toolsApplied[0]?.result.ok).toBe(false);
    expect(result.assistantText).toContain("no audio track");
    expect(result.error).toBeUndefined();
  });

  it("disables any other tool once the identical (tool, reason) failure repeats", async () => {
    const complete = vi.fn<
      (request: AiCompleteRequest) => Promise<AiCompleteResult>
    >();

    const callAddZoom = (id: string) => ({
      requestId: id,
      stopReason: "tool_use" as const,
      content: [
        {
          type: "tool_use" as const,
          id,
          name: "add_zoom" as const,
          // Missing required fields — dispatchToolCall will reject this the
          // same way every time, so it is a stand-in for a truly stuck retry.
          input: {},
        },
      ],
    });

    complete.mockImplementationOnce(async (request) => {
      expect(toolNames(request)).toContain("add_zoom");
      return callAddZoom(request.requestId);
    });
    complete.mockImplementationOnce(async (request) => {
      // First failure alone isn't enough to disable a normal tool.
      expect(toolNames(request)).toContain("add_zoom");
      return callAddZoom(request.requestId);
    });
    complete.mockImplementationOnce(async (request) => {
      // Second identical failure disables it.
      expect(toolNames(request)).not.toContain("add_zoom");
      return {
        requestId: request.requestId,
        stopReason: "end_turn",
        content: [{ type: "text", text: "I couldn't add that zoom." }],
      };
    });

    vi.stubGlobal("window", {
      electronAPI: {
        ai: {
          complete,
          getAiPreferences: async () => null,
        },
      },
    });

    const actions = createActions();
    const result = await runAgentTurn({
      userMessage: "Zoom into something",
      previousMessages: [],
      actions,
    });

    expect(complete).toHaveBeenCalledTimes(3);
    expect(result.toolsApplied).toHaveLength(2);
    expect(result.toolsApplied.every((t) => !t.result.ok)).toBe(true);
  });
});
