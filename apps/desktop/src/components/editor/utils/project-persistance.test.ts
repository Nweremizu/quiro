import { describe, expect, it, vi } from "vitest";
import type { ZoomRegion } from "@/types/editor";
import {
  normalizeProjectEditor,
  normalizeProjectSnapshots,
  toFileUrl,
  validateProjectData,
} from "./project-persistance";

vi.mock("@/lib/wallpapers", () => ({
  DEFAULT_WALLPAPER_PATH: "wallpapers/default.png",
}));

describe("project persistence normalization", () => {
  it("accepts valid saved project envelopes and rejects malformed data", () => {
    expect(
      validateProjectData({
        version: 1,
        videoPath: "C:/recording.mp4",
        editor: {},
      }),
    ).toBe(true);

    expect(validateProjectData({ version: 1, editor: {} })).toBe(false);
    expect(validateProjectData({ version: 1, videoPath: "", editor: {} })).toBe(
      false,
    );
  });

  it("normalizes legacy clip source fields into the current clip shape", () => {
    const editor = normalizeProjectEditor({
      clipRegions: [
        {
          id: "legacy-clip",
          startMs: 0,
          endMs: 1000,
          sourceStartMs: 250,
          sourceEndMs: 1250,
          speed: 2,
        } as never,
      ],
    });

    expect(editor.clipRegions).toEqual([
      {
        id: "legacy-clip",
        startMs: 250,
        endMs: 1250,
        speed: 2,
        muted: false,
      },
    ]);
  });

  it("normalizes snapshot metadata and caps the restore list", () => {
    const snapshots = normalizeProjectSnapshots([
      {
        id: "snapshot-1",
        name: "Before edit",
        createdAt: "2026-05-16T00:00:00.000Z",
        reason: "manual",
        editor: {
          clipRegions: [{ id: "clip-1", startMs: 0, endMs: 1000, speed: 1 }],
        },
      },
      {
        id: "snapshot-2",
        name: "Auto",
        editor: {},
        reason: "auto",
      },
    ]);

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.id).toBe("snapshot-2");
    expect(snapshots[0]?.reason).toBe("auto");
    expect(snapshots[1]?.reason).toBe("manual");
  });

  it("creates file URLs from local media paths", () => {
    expect(toFileUrl("C:\\Recordings\\clip 1.mp4")).toBe(
      "file:///C:/Recordings/clip%201.mp4",
    );
  });
});

describe("normalizeProjectEditor — instant zoom", () => {
  const region: ZoomRegion = {
    id: "z1",
    startMs: 1000,
    endMs: 4000,
    depth: 3,
    focus: { cx: 0.5, cy: 0.5 },
  };

  it("defaults instant to off for projects saved before the flag existed", () => {
    const [normalized] = normalizeProjectEditor({
      zoomRegions: [region],
    }).zoomRegions;
    expect(normalized.instant).toBe(false);
  });

  it("round-trips an instant zoom", () => {
    const [normalized] = normalizeProjectEditor({
      zoomRegions: [{ ...region, instant: true }],
    }).zoomRegions;
    expect(normalized.instant).toBe(true);
  });

  it("coerces a non-boolean instant value to off rather than trusting it", () => {
    const [normalized] = normalizeProjectEditor({
      zoomRegions: [{ ...region, instant: "yes" as unknown as boolean }],
    }).zoomRegions;
    expect(normalized.instant).toBe(false);
  });
});

describe("normalizeProjectEditor — zoom drift", () => {
  it("defaults to off for projects saved before drift existed", () => {
    expect(normalizeProjectEditor({}).zoomDrift).toBe(0);
  });

  it("round-trips a drift strength", () => {
    expect(normalizeProjectEditor({ zoomDrift: 0.6 }).zoomDrift).toBe(0.6);
  });

  it("clamps out-of-range values rather than trusting the file", () => {
    expect(normalizeProjectEditor({ zoomDrift: 9 }).zoomDrift).toBe(1);
    expect(normalizeProjectEditor({ zoomDrift: -3 }).zoomDrift).toBe(0);
    expect(
      normalizeProjectEditor({ zoomDrift: "lots" as unknown as number })
        .zoomDrift,
    ).toBe(0);
  });
});

describe("normalizeProjectEditor — motion values are the user's, not a preset's", () => {
  // Loading a project used to resolve the closest motion preset and then
  // overwrite ten stored fields with that preset's values, so any custom
  // tuning silently snapped back to Focused on reopen.
  const custom = {
    cursorSize: 4.2,
    cursorSmoothing: 1.1,
    cursorSpringStiffnessMultiplier: 2.4,
    cursorSpringDampingMultiplier: 0.4,
    cursorSpringMassMultiplier: 2.1,
    cursorMotionBlur: 1.7,
    cursorClickBounce: 4.4,
    cursorClickBounceDuration: 420,
    zoomInDurationMs: 640,
    zoomOutDurationMs: 880,
  };

  it("keeps every custom motion value through a load", () => {
    const normalized = normalizeProjectEditor(custom);
    for (const [key, value] of Object.entries(custom)) {
      expect([key, normalized[key as keyof typeof custom]]).toEqual([
        key,
        value,
      ]);
    }
  });

  it("still clamps values that are out of range", () => {
    expect(normalizeProjectEditor({ cursorSize: 999 }).cursorSize).toBe(10);
  });

  it("still falls back for values that are absent", () => {
    const normalized = normalizeProjectEditor({});
    expect(Number.isFinite(normalized.cursorSize)).toBe(true);
    expect(Number.isFinite(normalized.zoomInDurationMs)).toBe(true);
  });
});

describe("normalizeProjectEditor — zoom smoothness", () => {
  // Was hardcoded to the default on load, so whatever a motion preset wrote
  // snapped back to 0.5 on reopen.
  it("keeps a stored value", () => {
    expect(normalizeProjectEditor({ zoomSmoothness: 0.7 }).zoomSmoothness).toBe(
      0.7,
    );
  });

  it("clamps and falls back", () => {
    expect(normalizeProjectEditor({ zoomSmoothness: 5 }).zoomSmoothness).toBe(1);
    expect(normalizeProjectEditor({}).zoomSmoothness).toBe(0.5);
  });
});
