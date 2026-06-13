import { expect, test } from "@playwright/test";
import {
  closeQuiroElectron,
  launchQuiroElectron,
  openRouteWindow,
  type QuiroElectronApp,
} from "./helpers/electronApp";

test.describe("app window routes", () => {
  let instance: QuiroElectronApp | null = null;

  test.afterEach(async () => {
    if (instance) {
      await closeQuiroElectron(instance);
      instance = null;
    }
  });

  test("renders launch, source selector, countdown, and editor route shells", async () => {
    instance = await launchQuiroElectron();

    for (const windowType of ["hud-overlay", "source-selector", "countdown", "editor"]) {
      const page = await openRouteWindow(instance.app, windowType);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.dataset.windowType ?? ""),
        )
        .toBe(windowType);
      await expect.poll(() => page.evaluate(() => document.readyState)).toBe("complete");
    }
  });
});
