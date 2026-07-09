import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the fs layer so tests never touch the real ~/.claude/.credentials.json.
const readFile = vi.fn();
const writeFile = vi.fn();
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (...a: unknown[]) => readFile(...a),
    writeFile: (...a: unknown[]) => writeFile(...a),
  },
}));
vi.mock("node:fs", () => ({ existsSync: () => true }));

import { getClaudeAccessToken } from "./claudeOAuth";

function creds(expiresAt: number) {
  return JSON.stringify({
    claudeAiOauth: { accessToken: "old", refreshToken: "r1", expiresAt },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  readFile.mockReset();
  writeFile.mockReset();
});

describe("getClaudeAccessToken", () => {
  it("returns the token unchanged when it is still valid", async () => {
    readFile.mockResolvedValue(creds(Date.now() + 3_600_000));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await getClaudeAccessToken()).toBe("old");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes and persists when the token is near expiry", async () => {
    readFile.mockResolvedValue(creds(Date.now() + 1_000)); // within skew
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 }),
        { status: 200 },
      ),
    );
    expect(await getClaudeAccessToken()).toBe("new");
    expect(writeFile).toHaveBeenCalledOnce();
  });

  it("returns null when no login exists", async () => {
    readFile.mockRejectedValue(new Error("ENOENT"));
    expect(await getClaudeAccessToken()).toBeNull();
  });
});
