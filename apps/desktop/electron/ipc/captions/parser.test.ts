import { describe, expect, it } from "vitest";
import {
  buildCaptionTextFromWords,
  parseSrtCues,
  parseSrtTimestamp,
  parseWhisperJsonCues,
  parseWhisperJsonWords,
  shouldRetryWhisperWithoutJson,
} from "./parser";

describe("caption parser", () => {
  it("parses SRT timestamps and cues", () => {
    expect(parseSrtTimestamp("00:01:02,345")).toBe(62_345);
    expect(
      parseSrtCues(`1
00:00:00,000 --> 00:00:01,500
Hello

2
00:00:02,000 --> 00:00:03,000
World`),
    ).toEqual([
      { id: "caption-1", startMs: 0, endMs: 1500, text: "Hello" },
      { id: "caption-2", startMs: 2000, endMs: 3000, text: "World" },
    ]);
  });

  it("parses Whisper JSON cues with word timing", () => {
    const cues = parseWhisperJsonCues(
      JSON.stringify({
        transcription: [
          {
            text: "Hello world",
            offsets: { from: 0, to: 1000 },
            tokens: [
              { text: "Hello", offsets: { from: 0, to: 500 } },
              { text: " world", offsets: { from: 500, to: 1000 } },
            ],
          },
        ],
      }),
    );

    expect(cues).toEqual([
      {
        id: "caption-1",
        startMs: 0,
        endMs: 1000,
        text: "Hello world",
        words: [
          { text: "Hello", startMs: 0, endMs: 500 },
          { text: "world", startMs: 500, endMs: 1000, leadingSpace: true },
        ],
      },
    ]);
  });

  it("drops malformed Whisper token timing", () => {
    expect(
      parseWhisperJsonWords([{ text: "broken", offsets: { from: 100, to: 50 } }]),
    ).toEqual([]);
  });

  it("rebuilds caption text and recognizes json retry errors", () => {
    expect(
      buildCaptionTextFromWords([
        { text: "Hello", startMs: 0, endMs: 500 },
        { text: "world", startMs: 500, endMs: 1000, leadingSpace: true },
      ]),
    ).toBe("Hello world");

    expect(shouldRetryWhisperWithoutJson(new Error("unknown argument --ojf"))).toBe(
      true,
    );
    expect(shouldRetryWhisperWithoutJson(new Error("permission denied"))).toBe(
      false,
    );
  });
});
