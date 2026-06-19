import { afterEach, describe, expect, it } from "vitest";
import { getKeyStatus, getProvider, hasApiKey, runAiComplete } from "./client";
import { providerIdForModel } from "./types";

describe("ai/client router (S0-2 + multi-provider)", () => {
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalMiniMax = process.env.MINIMAX_API_KEY;

  afterEach(() => {
    restore("ANTHROPIC_API_KEY", originalAnthropic);
    restore("MINIMAX_API_KEY", originalMiniMax);
  });

  function restore(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  it("routes model ids to the right provider", () => {
    expect(providerIdForModel("claude-opus-4-8")).toBe("anthropic");
    expect(providerIdForModel("MiniMax-M2.5")).toBe("minimax");
    expect(providerIdForModel("abab6.5s-chat")).toBe("minimax");
    expect(getProvider("claude-haiku-4-5").id).toBe("anthropic");
    expect(getProvider("MiniMax-M3").id).toBe("minimax");
  });

  it("getKeyStatus reflects each provider's env var", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    expect(getKeyStatus()).toEqual({
      hasKey: false,
      providers: { anthropic: false, minimax: false },
    });
    expect(hasApiKey()).toBe(false);

    process.env.MINIMAX_API_KEY = "mm-test";
    expect(getKeyStatus()).toEqual({
      hasKey: true,
      providers: { anthropic: false, minimax: true },
    });
    expect(hasApiKey()).toBe(true);
  });

  it("runAiComplete dispatches to the Anthropic stub for claude models", async () => {
    const result = await runAiComplete({
      requestId: "req-a",
      model: "claude-opus-4-8",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.requestId).toBe("req-a");
    expect(String(result.content[0].text)).toContain("Anthropic");
  });

  it("runAiComplete dispatches to the MiniMax scaffold for MiniMax models", async () => {
    const result = await runAiComplete({
      requestId: "req-m",
      model: "MiniMax-M2.5",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.requestId).toBe("req-m");
    expect(String(result.content[0].text)).toContain("MiniMax");
  });
});
