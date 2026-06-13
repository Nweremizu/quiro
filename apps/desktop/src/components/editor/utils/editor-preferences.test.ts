import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_PREFERENCES,
  normalizeEditorPreferences,
} from "./editor-preferences";

describe("normalizeEditorPreferences", () => {
  it("defaults timeline density to comfortable", () => {
    expect(normalizeEditorPreferences({}).timelineDensityMode).toBe(
      "comfortable",
    );
  });

  it("accepts valid timeline density modes", () => {
    expect(
      normalizeEditorPreferences({ timelineDensityMode: "compact" })
        .timelineDensityMode,
    ).toBe("compact");
    expect(
      normalizeEditorPreferences({ timelineDensityMode: "detailed" })
        .timelineDensityMode,
    ).toBe("detailed");
  });

  it("falls back for invalid timeline density modes", () => {
    expect(
      normalizeEditorPreferences({
        timelineDensityMode: "dense",
      }).timelineDensityMode,
    ).toBe(DEFAULT_EDITOR_PREFERENCES.timelineDensityMode);
  });
});

