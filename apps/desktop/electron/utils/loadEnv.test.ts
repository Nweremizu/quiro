import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile, parseEnv } from "./loadEnv";

describe("parseEnv", () => {
  it("parses keys, skips comments/blank lines, strips surrounding quotes", () => {
    const env = parseEnv(
      [
        "# a comment",
        "",
        "ANTHROPIC_API_KEY=sk-abc",
        '  MINIMAX_API_KEY = "mm-123" ',
        "MINIMAX_BASE_URL='https://api.minimax.io/v1'",
        "NO_EQUALS_LINE",
      ].join("\n"),
    );

    expect(env.ANTHROPIC_API_KEY).toBe("sk-abc");
    expect(env.MINIMAX_API_KEY).toBe("mm-123");
    expect(env.MINIMAX_BASE_URL).toBe("https://api.minimax.io/v1");
    expect(env.NO_EQUALS_LINE).toBeUndefined();
  });

  it("keeps '=' characters inside values", () => {
    expect(parseEnv("KEY=a=b=c").KEY).toBe("a=b=c");
  });
});

describe("loadEnvFile", () => {
  afterEach(() => {
    delete process.env.QUIRO_TEST_NEW;
    delete process.env.QUIRO_TEST_EXISTING;
  });

  it("loads the first existing file, sets missing vars, never overrides existing", () => {
    const dir = mkdtempSync(join(tmpdir(), "quiro-env-"));
    const file = join(dir, ".env");
    writeFileSync(
      file,
      "QUIRO_TEST_NEW=fromfile\nQUIRO_TEST_EXISTING=fromfile\n",
    );

    process.env.QUIRO_TEST_EXISTING = "real";
    delete process.env.QUIRO_TEST_NEW;

    const loaded = loadEnvFile([join(dir, "missing.env"), file]);

    expect(loaded).toBe(file);
    expect(process.env.QUIRO_TEST_NEW).toBe("fromfile");
    expect(process.env.QUIRO_TEST_EXISTING).toBe("real");
  });

  it("returns null when no candidate exists", () => {
    expect(loadEnvFile([join(tmpdir(), "definitely-missing-quiro.env")])).toBeNull();
  });
});
