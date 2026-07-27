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
