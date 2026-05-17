import { expect, test } from "@playwright/test";
import {
  closeQuiroElectron,
  fixtureVideoPath,
  launchQuiroElectron,
  waitForEditorPage,
  type QuiroElectronApp,
} from "./helpers/electronApp";

type E2EClipRegion = {
  id: string;
  startMs: number;
  endMs: number;
  speed: number;
  muted?: boolean;
};

type E2EBridge = {
  state: {
    duration: number;
    sourceTime: number;
    timelineTime: number;
    isPlaying: boolean;
    videoPaused: boolean | null;
    videoCurrentTime: number | null;
    clipRegions: E2EClipRegion[];
    videoPath: string | null;
  };
  actions: {
    playPause: () => void;
    playMuted: () => Promise<void>;
    pause: () => void;
    advanceTimelineMs: (deltaMs: number) => void;
    seekTimelineMs: (timeMs: number) => void;
    splitAtTimelineMs: (timeMs: number) => void;
  };
};

type E2EWindow = Window & {
  __QUIRO_E2E__?: E2EBridge;
};

test.describe("editor playback", () => {
  let instance: QuiroElectronApp | null = null;

  test.afterEach(async () => {
    if (instance) {
      await closeQuiroElectron(instance);
      instance = null;
    }
  });

  test("loads fixture media and advances the playhead when played", async () => {
    instance = await launchQuiroElectron({
      QUIRO_DEV_OPEN_RECORDING_INPUT: fixtureVideoPath,
    });
    const page = await waitForEditorPage(instance.app);

    await page.waitForFunction(() => {
      const bridge = (window as E2EWindow).__QUIRO_E2E__;
      return Boolean(bridge?.state.videoPath && bridge.state.duration > 0);
    });

    await page.evaluate(() =>
      (window as E2EWindow).__QUIRO_E2E__?.actions.seekTimelineMs(0),
    );
    const initialTime = await page.evaluate(
      () => (window as E2EWindow).__QUIRO_E2E__?.state.videoCurrentTime ?? 0,
    );

    await page.evaluate(() =>
      (window as E2EWindow).__QUIRO_E2E__?.actions.playMuted(),
    );
    await page.evaluate(() =>
      (window as E2EWindow).__QUIRO_E2E__?.actions.advanceTimelineMs(500),
    );

    await page.waitForFunction(
      (startTime) => {
        const bridge = (window as E2EWindow).__QUIRO_E2E__;
        return (
          Boolean(bridge?.state.isPlaying) &&
          (bridge?.state.videoCurrentTime ?? 0) > Number(startTime) + 0.25
        );
      },
      initialTime,
      { timeout: 15_000 },
    );

    await page.evaluate(() => (window as E2EWindow).__QUIRO_E2E__?.actions.pause());
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as E2EWindow).__QUIRO_E2E__?.state.isPlaying ?? true,
        ),
      )
      .toBe(false);
  });

  test("continues playback across split clip boundaries", async () => {
    instance = await launchQuiroElectron({
      QUIRO_DEV_OPEN_RECORDING_INPUT: fixtureVideoPath,
    });
    const page = await waitForEditorPage(instance.app);

    await page.waitForFunction(() => {
      const bridge = (window as E2EWindow).__QUIRO_E2E__;
      return Boolean(bridge?.state.videoPath && bridge.state.duration >= 5);
    });

    await page.evaluate(() => {
      const bridge = (window as E2EWindow).__QUIRO_E2E__;
      bridge?.actions.splitAtTimelineMs(2000);
      bridge?.actions.splitAtTimelineMs(4000);
      bridge?.actions.seekTimelineMs(1750);
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as E2EWindow).__QUIRO_E2E__?.state.timelineTime ?? 0,
        ),
      )
      .toBeGreaterThan(1.7);

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as E2EWindow).__QUIRO_E2E__?.state.clipRegions.length ?? 0,
        ),
      )
      .toBe(3);

    await page.evaluate(() =>
      (window as E2EWindow).__QUIRO_E2E__?.actions.playMuted(),
    );
    await page.evaluate(() =>
      (window as E2EWindow).__QUIRO_E2E__?.actions.advanceTimelineMs(600),
    );

    await page.waitForFunction(() => {
      const bridge = (window as E2EWindow).__QUIRO_E2E__;
      return Boolean(bridge?.state.isPlaying && (bridge.state.videoCurrentTime ?? 0) > 2.25);
    });

    const afterFirstBoundary = await page.evaluate(
      () => (window as E2EWindow).__QUIRO_E2E__?.state.videoCurrentTime ?? 0,
    );
    expect(afterFirstBoundary).toBeGreaterThan(2.25);

    await page.evaluate(() =>
      (window as E2EWindow).__QUIRO_E2E__?.actions.advanceTimelineMs(2200),
    );
    await page.waitForFunction(
      () => {
        const bridge = (window as E2EWindow).__QUIRO_E2E__;
        return Boolean(bridge?.state.isPlaying && (bridge.state.videoCurrentTime ?? 0) > 4.25);
      },
      undefined,
      { timeout: 15_000 },
    );

    const finalState = await page.evaluate(
      () => (window as E2EWindow).__QUIRO_E2E__?.state,
    );

    expect(finalState?.isPlaying).toBe(true);
    expect(finalState?.videoCurrentTime).toBeGreaterThan(4.25);
  });
});
