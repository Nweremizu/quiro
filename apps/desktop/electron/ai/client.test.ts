import { afterEach, describe, expect, it } from "vitest";
import { hasApiKey, runAiComplete } from "./client";

describe("ai/client (S0-2 stub)", () => {
  const original = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("hasApiKey reflects the env var (blank counts as missing)", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(hasApiKey()).toBe(false);

    process.env.ANTHROPIC_API_KEY = "   ";
    expect(hasApiKey()).toBe(false);

    process.env.ANTHROPIC_API_KEY = "sk-test-123";
    expect(hasApiKey()).toBe(true);
  });

  it("runAiComplete echoes a canned assistant text block", async () => {
    const result = await runAiComplete({
      requestId: "req-1",
      model: "claude-opus-4-8",
      system: "you are a test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.requestId).toBe("req-1");
    expect(result.stopReason).toBe("end_turn");
    expect(result.content[0].type).toBe("text");
    expect(String(result.content[0].text)).toContain("stub");
  });
});
