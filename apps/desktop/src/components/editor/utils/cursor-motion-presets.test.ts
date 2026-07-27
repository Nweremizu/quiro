import { describe, expect, it, vi } from "vitest";
import {
  applyCursorMotionPreset,
  CURSOR_MOTION_PRESET_IDS,
  CURSOR_MOTION_PRESET_KEYS,
  CURSOR_MOTION_PRESETS,
  type CursorMotionPresetHandlers,
  type CursorMotionPresetValues,
  getMatchingCursorMotionPresetId,
  resolveCursorMotionPresetId,
} from "./cursor-motion-presets";

function makeHandlers() {
  const calls: Partial<Record<keyof CursorMotionPresetValues, unknown>> = {};
  const handlers = Object.fromEntries(
    CURSOR_MOTION_PRESET_KEYS.map((key) => [
      key,
      vi.fn((value: unknown) => {
        calls[key] = value;
      }),
    ]),
  ) as unknown as CursorMotionPresetHandlers;
  return { handlers, calls };
}

describe("CURSOR_MOTION_PRESETS", () => {
  it("ships exactly two presets", () => {
    // Curated multi-value looks are Phase 2 and must not be pre-empted here.
    expect(CURSOR_MOTION_PRESET_IDS).toEqual(["focused", "smooth"]);
  });

  it("covers the camera, not just the cursor", () => {
    for (const key of [
      "zoomSmoothness",
      "cameraSpringStiffnessMultiplier",
      "cameraSpringDampingMultiplier",
      "cameraSpringMassMultiplier",
      "zoomInEasing",
      "zoomOutEasing",
      "connectedZoomEasing",
    ] as const) {
      expect(CURSOR_MOTION_PRESET_KEYS).toContain(key);
    }
  });

  it("gives the two presets genuinely different camera feels", () => {
    // Before this, both presets shipped an identical camera and differed only
    // in cursor behaviour, so the picker changed nothing about the camera.
    const focused = CURSOR_MOTION_PRESETS.focused.values;
    const smooth = CURSOR_MOTION_PRESETS.smooth.values;

    for (const key of [
      "zoomSmoothness",
      "cameraSpringStiffnessMultiplier",
      "cameraSpringDampingMultiplier",
      "cameraSpringMassMultiplier",
    ] as const) {
      expect(focused[key]).not.toBe(smooth[key]);
    }
  });
});

describe("applyCursorMotionPreset", () => {
  it.each(CURSOR_MOTION_PRESET_IDS)(
    "writes every declared field for %s",
    (presetId) => {
      const { handlers, calls } = makeHandlers();
      applyCursorMotionPreset(presetId, handlers);

      // Not a subset check: every key the preset declares must be written, or
      // a preset silently leaves part of the previous look in place.
      expect(Object.keys(calls).sort()).toEqual(
        [...CURSOR_MOTION_PRESET_KEYS].sort(),
      );
      expect(calls).toEqual(CURSOR_MOTION_PRESETS[presetId].values);
    },
  );

  it("writes the zoom smoothness that the old apply path silently dropped", () => {
    const { handlers } = makeHandlers();
    applyCursorMotionPreset("smooth", handlers);
    expect(handlers.zoomSmoothness).toHaveBeenCalledWith(
      CURSOR_MOTION_PRESETS.smooth.values.zoomSmoothness,
    );
  });
});

describe("getMatchingCursorMotionPresetId", () => {
  it.each(CURSOR_MOTION_PRESET_IDS)("recognises %s exactly", (presetId) => {
    expect(
      getMatchingCursorMotionPresetId(CURSOR_MOTION_PRESETS[presetId].values),
    ).toBe(presetId);
  });

  // This is the guard that matters: if a field is added to the preset shape
  // but the matcher does not compare it, the panel keeps showing a preset as
  // active after the user has edited that field away from it.
  it.each(CURSOR_MOTION_PRESET_KEYS)(
    "stops matching when %s alone is changed",
    (key) => {
      const values: CursorMotionPresetValues = {
        ...CURSOR_MOTION_PRESETS.focused.values,
      };
      const current = values[key];
      // Perturb whichever kind of value this key holds.
      (values as unknown as Record<string, unknown>)[key] =
        typeof current === "number" ? current + 0.123 : "linear";

      expect(getMatchingCursorMotionPresetId(values)).toBeNull();
    },
  );

  it("returns null for values that are not a preset", () => {
    expect(
      getMatchingCursorMotionPresetId({
        ...CURSOR_MOTION_PRESETS.focused.values,
        cursorSize: 9.9,
      }),
    ).toBeNull();
  });
});

describe("resolveCursorMotionPresetId", () => {
  it("falls back when nothing matches", () => {
    expect(
      resolveCursorMotionPresetId({
        ...CURSOR_MOTION_PRESETS.smooth.values,
        cursorSize: 9.9,
      }),
    ).toBe("focused");
  });

  it("prefers an exact match over the fallback", () => {
    expect(resolveCursorMotionPresetId(CURSOR_MOTION_PRESETS.smooth.values)).toBe(
      "smooth",
    );
  });
});
