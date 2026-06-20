import { describe, expect, it } from "vitest";
import { missingKeyMessage, type AiKeyStatus } from "./keyStatus";

describe("missingKeyMessage", () => {
  it("returns null when at least one provider key is present", () => {
    const status: AiKeyStatus = {
      hasKey: true,
      providers: { anthropic: true, minimax: false },
    };
    expect(missingKeyMessage(status)).toBeNull();
  });

  it("returns actionable guidance when no key is present", () => {
    const status: AiKeyStatus = {
      hasKey: false,
      providers: { anthropic: false, minimax: false },
    };
    const message = missingKeyMessage(status);
    expect(message).toContain("ANTHROPIC_API_KEY");
    expect(message).toContain("MINIMAX_API_KEY");
    expect(message).toContain(".env");
  });
});
