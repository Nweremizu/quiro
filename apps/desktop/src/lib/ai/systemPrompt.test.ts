import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./systemPrompt";
import type { BrainSummary } from "./contract";

const SUMMARY: BrainSummary = {
  durationMs: 10000,
  clickCount: 3,
  silenceCount: 2,
  silenceTotalMs: 4200,
  fillerCount: 1,
  idleCount: 0,
  idleTotalMs: 0,
  speechCount: 4,
  hasTelemetry: true,
  hasTranscript: true,
  text: "10s recording — 4 spoken segment(s), 2 silence(s) (4s), 1 filler word(s), 3 click(s).",
};

describe("buildAgentSystemPrompt", () => {
  it("contains the base prompt without a summary", () => {
    const prompt = buildAgentSystemPrompt(null);
    expect(prompt).toContain("Quiro Director");
    expect(prompt).toContain("source-media milliseconds");
    expect(prompt).not.toContain("Recording context");
  });

  it("appends the summary text when provided", () => {
    const prompt = buildAgentSystemPrompt(SUMMARY);
    expect(prompt).toContain("Recording context");
    expect(prompt).toContain(SUMMARY.text);
    expect(prompt).toContain("Quiro Director");
  });

  it("summary section appears after the base rules", () => {
    const prompt = buildAgentSystemPrompt(SUMMARY);
    const baseEnd = prompt.indexOf("make a sensible default choice");
    const contextStart = prompt.indexOf("## Recording context");
    expect(baseEnd).toBeGreaterThan(0);
    expect(contextStart).toBeGreaterThan(baseEnd);
  });
});
