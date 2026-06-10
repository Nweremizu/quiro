import { describe, expect, it } from "vitest";
import {
  buildEditedTrackSourceAudioFilter,
  buildNativeH264StreamExportArgs,
  buildNativeVideoExportArgs,
  buildTrimmedSourceAudioFilter,
  getEditedAudioExtension,
  getNativeVideoInputByteSize,
  getPreferredNativeVideoEncoders,
  parseAvailableFfmpegEncoders,
} from "./nativeVideoExport";

describe("native video export helpers", () => {
  it("calculates raw RGBA frame byte size", () => {
    expect(getNativeVideoInputByteSize(320, 180)).toBe(320 * 180 * 4);
  });

  it("parses available ffmpeg encoders from ffmpeg output", () => {
    const encoders = parseAvailableFfmpegEncoders(`
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder
 V..... libx264              libx264 H.264 / AVC encoder
    `);

    expect(encoders.has("h264_nvenc")).toBe(true);
    expect(encoders.has("libx264")).toBe(true);
  });

  it("prefers platform encoders before software fallback", () => {
    expect(getPreferredNativeVideoEncoders("win32")).toContain("libx264");
    expect(getPreferredNativeVideoEncoders("darwin")[0]).toBe("h264_videotoolbox");
    expect(getPreferredNativeVideoEncoders("freebsd")).toEqual(["libx264"]);
  });

  it("builds bounded native raw video export args", () => {
    const args = buildNativeVideoExportArgs(
      "libx264",
      {
        width: 320,
        height: 180,
        frameRate: 30,
        bitrate: 500_000,
        encodingMode: "fast",
      },
      "out.mp4",
    );

    expect(args).toContain("-f");
    expect(args).toContain("rawvideo");
    expect(args).toContain("320x180");
    expect(args).toContain("1500000");
    expect(args).toContain("ultrafast");
    expect(args[args.length - 1]).toBe("out.mp4");
  });

  it("builds H.264 stream copy args", () => {
    expect(
      buildNativeH264StreamExportArgs({ frameRate: 30, outputPath: "out.mp4" }),
    ).toEqual([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "h264",
      "-r",
      "30",
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "copy",
      "-movflags",
      "+faststart",
      "out.mp4",
    ]);
  });

  it("builds trim and edited-track audio filters", () => {
    expect(
      buildTrimmedSourceAudioFilter([
        { startMs: 0, endMs: 1000 },
        { startMs: 3000, endMs: 4000 },
      ]),
    ).toContain("concat=n=2:v=0:a=1[aout]");

    expect(
      buildEditedTrackSourceAudioFilter(
        [
          { startMs: 0, endMs: 1000, speed: 1 },
          { startMs: 1000, endMs: 3000, speed: 2 },
        ],
        48000,
      ),
    ).toContain("atempo=2");
  });

  it("resolves edited audio temp extensions from mime type", () => {
    expect(getEditedAudioExtension("audio/wav")).toBe(".wav");
    expect(getEditedAudioExtension("audio/mp4")).toBe(".m4a");
    expect(getEditedAudioExtension("audio/ogg")).toBe(".ogg");
    expect(getEditedAudioExtension(null)).toBe(".webm");
  });
});
