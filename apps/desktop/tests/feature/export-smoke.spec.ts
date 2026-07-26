import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  closeQuiroElectron,
  fixtureVideoPath,
  launchQuiroElectron,
  type QuiroElectronApp,
} from "./helpers/electronApp";

test.describe("export smoke", () => {
  let instance: QuiroElectronApp | null = null;
  let outputPath: string | null = null;

  test.afterEach(async () => {
    if (instance) {
      await closeQuiroElectron(instance);
      instance = null;
    }
    if (outputPath) {
      await fs.rm(outputPath, { force: true });
      await fs.rm(`${outputPath}.report.json`, { force: true });
      outputPath = null;
    }
  });

  test.skip(
    process.env.QUIRO_RUN_EXPORT_SMOKE !== "1",
    "Set QUIRO_RUN_EXPORT_SMOKE=1 to run the slower export smoke test.",
  );

  test("exports a tiny fixture recording through the smoke-export path", async () => {
    outputPath = path.join(os.tmpdir(), `quiro-export-smoke-${Date.now()}.mp4`);
    instance = await launchQuiroElectron({
      QUIRO_SMOKE_EXPORT: "1",
      QUIRO_SMOKE_EXPORT_INPUT: fixtureVideoPath,
      QUIRO_SMOKE_EXPORT_OUTPUT: outputPath,
      QUIRO_SMOKE_EXPORT_QUALITY: "medium",
      QUIRO_SMOKE_EXPORT_FPS: "30",
      QUIRO_SMOKE_EXPORT_PIPELINE: "modern",
    });

    await expect
      .poll(
        async () => {
          try {
            const stats = await fs.stat(outputPath as string);
            return stats.size;
          } catch {
            return 0;
          }
        },
        { timeout: 120_000 },
      )
      .toBeGreaterThan(0);
  });

  test("exports a GIF through the FFmpeg palette path", async () => {
    test.setTimeout(180_000);
    outputPath = path.join(os.tmpdir(), `quiro-export-smoke-${Date.now()}.gif`);
    instance = await launchQuiroElectron({
      QUIRO_SMOKE_EXPORT: "1",
      QUIRO_SMOKE_EXPORT_INPUT: fixtureVideoPath,
      QUIRO_SMOKE_EXPORT_OUTPUT: outputPath,
      QUIRO_SMOKE_EXPORT_FORMAT: "gif",
    });

    await expect
      .poll(
        async () => {
          try {
            return (await fs.stat(outputPath as string)).size;
          } catch {
            return 0;
          }
        },
        { timeout: 150_000 },
      )
      .toBeGreaterThan(0);

    // Confirm it is a real GIF, not an empty/garbage file.
    const header = (await fs.readFile(outputPath)).subarray(0, 6).toString("ascii");
    expect(header).toMatch(/^GIF8[79]a$/);
  });
});
