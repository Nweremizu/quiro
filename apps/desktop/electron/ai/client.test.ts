import { afterEach, describe, expect, it, vi } from "vitest";
import { providerIdForModel } from "./types";

// `hasKey()` reads three sources: env var, stored prefs, and a synced Claude
// OAuth session. Isolate the tests from the two machine-state sources so they
// exercise only env-var behavior — otherwise they fail on any dev machine that
// is logged into Claude Code (OAuth) or has a stored key, while passing in CI.
vi.mock("./claudeOAuth", () => ({
  hasClaudeOAuthSync: () => false,
  getClaudeAccessToken: async () => null,
}));
vi.mock("./aiSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./aiSettings")>();
  return {
    ...actual,
    getCachedAiPreferences: () => ({
      anthropicKey: "",
      minimaxKey: "",
      selectedModel: "claude-opus-4-8",
    }),
  };
});

const { getKeyStatus, getProvider, hasApiKey, runAiComplete } = await import(
  "./client"
);

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

  it("runAiComplete routes to Anthropic for claude models (provider check)", () => {
    // Real Anthropic calls require an API key + network — tested manually.
    // This verifies the routing that runAiComplete delegates to the right provider.
    expect(getProvider("claude-opus-4-8").id).toBe("anthropic");
    expect(getProvider("claude-haiku-4-5").id).toBe("anthropic");
  });

  it("runAiComplete routes to MiniMax; missing key throws before any network call", async () => {
    delete process.env.MINIMAX_API_KEY;
    await expect(
      runAiComplete({
        requestId: "req-m",
        model: "MiniMax-M2.5",
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("MINIMAX_API_KEY is not set");
  });
});
