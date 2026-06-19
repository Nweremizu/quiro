import { describe, expect, it } from "vitest";
import { buildBrain, summarizeBrain } from "./brain";
import type { BrainInputs, Moment, MomentKind } from "./contract";
import type { CaptionCue, CursorTelemetryPoint } from "@/types/editor";

const DURATION = 8000;

const CUES: CaptionCue[] = [
  {
    id: "c1",
    startMs: 1000,
    endMs: 2000,
    text: "hello um world",
    words: [
      { text: "hello", startMs: 1000, endMs: 1300 },
      { text: "um", startMs: 1300, endMs: 1450 },
      { text: "world", startMs: 1500, endMs: 2000 },
    ],
  },
  {
    id: "c2",
    startMs: 5000,
    endMs: 6000,
    text: "next part",
    words: [
      { text: "next", startMs: 5000, endMs: 5400 },
      { text: "part", startMs: 5400, endMs: 6000 },
    ],
  },
];

// Clicks at 1100 (during speech) and 3000 (inside the 2000–5000 gap);
// 4000 is a move, not a click.
const TELEMETRY: CursorTelemetryPoint[] = [
  { timeMs: 1100, cx: 0.3, cy: 0.3, interactionType: "click" },
  { timeMs: 3000, cx: 0.5, cy: 0.5, interactionType: "click" },
  { timeMs: 4000, cx: 0.6, cy: 0.6, interactionType: "move" },
];

function countByKind(moments: Moment[]): Record<MomentKind, number> {
  const counts = {
    speech: 0,
    silence: 0,
    filler: 0,
    click: 0,
    idle: 0,
    scene: 0,
  } satisfies Record<MomentKind, number>;
  for (const moment of moments) counts[moment.kind] += 1;
  return counts;
}

function inputs(over: Partial<BrainInputs>): BrainInputs {
  return {
    sourcePath: "/tmp/clip.webm",
    durationMs: DURATION,
    transcript: CUES,
    cursorTelemetry: TELEMETRY,
    ...over,
  };
}

describe("buildBrain", () => {
  it("fuses transcript + telemetry (both signals present)", () => {
    const brain = buildBrain(inputs({}));
    const counts = countByKind(brain.moments);

    expect(brain.hasTranscript).toBe(true);
    expect(brain.hasTelemetry).toBe(true);
    expect(counts.speech).toBe(2);
    expect(counts.filler).toBe(1); // "um"
    expect(counts.silence).toBe(3); // gaps 0–1000, 2000–5000, 6000–8000
    expect(counts.click).toBe(2); // 1100, 3000 (not the move)
    expect(counts.idle).toBe(1); // only 6000–8000 (2000–5000 has a click; 0–1000 too short)
    // sorted by startMs
    const starts = brain.moments.map((m) => m.startMs);
    expect([...starts]).toEqual([...starts].sort((a, b) => a - b));
  });

  it("transcript only (no telemetry)", () => {
    const brain = buildBrain(inputs({ cursorTelemetry: [] }));
    const counts = countByKind(brain.moments);

    expect(brain.hasTelemetry).toBe(false);
    expect(counts.click).toBe(0);
    expect(counts.speech).toBe(2);
    expect(counts.silence).toBe(3);
    expect(counts.idle).toBe(2); // both long gaps now idle (no clicks to exclude)
    expect(counts.filler).toBe(1);
  });

  it("telemetry only (no transcript)", () => {
    const brain = buildBrain(inputs({ transcript: [] }));
    const counts = countByKind(brain.moments);

    expect(brain.hasTranscript).toBe(false);
    expect(counts.click).toBe(2);
    expect(counts.speech).toBe(0);
    expect(counts.silence).toBe(0);
    expect(counts.idle).toBe(0);
    expect(counts.filler).toBe(0);
  });

  it("neither signal → empty moments, flags false", () => {
    const brain = buildBrain(inputs({ transcript: [], cursorTelemetry: [] }));
    expect(brain.moments).toHaveLength(0);
    expect(brain.hasTranscript).toBe(false);
    expect(brain.hasTelemetry).toBe(false);
  });

  it("derives duration from data when not provided", () => {
    const brain = buildBrain(inputs({ durationMs: 0 }));
    expect(brain.durationMs).toBe(6000); // last cue end
  });
});

describe("summarizeBrain", () => {
  it("produces counts and a human-readable line", () => {
    const summary = summarizeBrain(buildBrain(inputs({})));
    expect(summary.speechCount).toBe(2);
    expect(summary.clickCount).toBe(2);
    expect(summary.silenceCount).toBe(3);
    expect(summary.idleCount).toBe(1);
    expect(summary.fillerCount).toBe(1);
    expect(summary.text).toContain("click");
    expect(summary.text).toContain("recording");
  });

  it("describes missing signals gracefully", () => {
    const summary = summarizeBrain(
      buildBrain(inputs({ transcript: [], cursorTelemetry: [] })),
    );
    expect(summary.text).toContain("no transcript");
    expect(summary.text).toContain("no click telemetry");
  });
});
