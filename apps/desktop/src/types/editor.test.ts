import { describe, expect, it } from "vitest";
import {
  clipsToTrims,
  getClipSourceEndMs,
  mapSourceTimeToTimelineTime,
  mapTimelineTimeToSourceTime,
  trimsToClips,
  type ClipRegion,
} from "./editor";

describe("editor clip timeline mapping", () => {
  const clips: ClipRegion[] = [
    { id: "clip-2", startMs: 3000, endMs: 5000, speed: 0.5 },
    { id: "clip-1", startMs: 0, endMs: 2000, speed: 1 },
  ];

  it("maps split clip boundaries without introducing a gap", () => {
    const splitClips: ClipRegion[] = [
      { id: "left", startMs: 0, endMs: 2000, speed: 1 },
      { id: "middle", startMs: 2000, endMs: 4000, speed: 1 },
      { id: "right", startMs: 4000, endMs: 6000, speed: 1 },
    ];

    expect(clipsToTrims(splitClips, 6000)).toEqual([]);
    expect(mapTimelineTimeToSourceTime(2000, splitClips)).toBe(2000);
    expect(mapSourceTimeToTimelineTime(4000, splitClips)).toBe(4000);
  });

  it("converts timeline time through clip speed", () => {
    expect(getClipSourceEndMs(clips[0])).toBe(4000);
    expect(mapTimelineTimeToSourceTime(4000, clips)).toBe(3500);
    expect(mapSourceTimeToTimelineTime(3500, clips)).toBe(4000);
  });

  it("clamps seeks outside kept clips to the nearest clip boundary", () => {
    expect(mapTimelineTimeToSourceTime(2500, clips)).toBe(2000);
    expect(mapSourceTimeToTimelineTime(2500, clips)).toBe(2000);
    expect(mapTimelineTimeToSourceTime(2501, clips)).toBe(3000);
  });

  it("keeps legacy trim conversion as the complement of removed ranges", () => {
    expect(
      trimsToClips([{ id: "gap", startMs: 2000, endMs: 3000 }], 5000),
    ).toEqual([
      { id: "clip-1", startMs: 0, endMs: 2000, speed: 1 },
      { id: "clip-2", startMs: 3000, endMs: 5000, speed: 1 },
    ]);
  });
});
