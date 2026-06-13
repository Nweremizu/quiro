import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export type QuiroElectronApp = {
  app: ElectronApplication;
  userDataDir: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
export const rootDir = path.resolve(__dirname, "..", "..", "..");
export const distIndexPath = path.join(rootDir, "dist", "index.html");
export const preloadPath = path.join(rootDir, "dist-electron", "preload.mjs");
export const mainPath = path.join(rootDir, "dist-electron", "main.mjs");
export const fixtureVideoPath = path.join(
  rootDir,
  "tests",
  "fixtures",
  "generated",
  "editor-fixture.mp4",
);

export async function launchQuiroElectron(
  env: NodeJS.ProcessEnv = {},
): Promise<QuiroElectronApp> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "quiro-e2e-"));
  const launchEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    QUIRO_E2E: "1",
    QUIRO_TEST_USER_DATA_DIR: userDataDir,
    ...env,
  };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: [mainPath],
    env: launchEnv,
  });

  return { app, userDataDir };
}

export async function closeQuiroElectron(instance: QuiroElectronApp) {
  const childProcess = instance.app.process();
  await Promise.race([
    instance.app.close(),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (!childProcess.killed && childProcess.pid) {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], {
        windowsHide: true,
      }).catch(() => undefined);
    } else {
      childProcess.kill("SIGKILL");
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  await fs.rm(instance.userDataDir, { recursive: true, force: true }).catch(() => {
    // Chromium may briefly keep its profile lockfile open after process exit.
  });
}

export async function waitForEditorPage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => window.location.search.includes("windowType=editor"));
  return page;
}

export async function openRouteWindow(
  app: ElectronApplication,
  windowType: string,
): Promise<Page> {
  await app.evaluate(
    async ({ BrowserWindow }, options) => {
      const win = new BrowserWindow({
        width: 900,
        height: 700,
        show: false,
        webPreferences: {
          preload: options.preloadPath,
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false,
        },
      });
      await win.loadFile(options.distIndexPath, {
        query: { windowType: options.windowType },
      });
      win.show();
    },
    { distIndexPath, preloadPath, windowType },
  );

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (page.url().includes(`windowType=${windowType}`)) {
        await page.waitForLoadState("domcontentloaded");
        return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${windowType} window`);
}
