import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/extensions", () => ({
	extensionHost: {
		emitEvent: vi.fn(),
	},
}));

import { extensionHost } from "@/lib/extensions";
import { createVideoEventHandlers } from "./videoEventHandlers";

type PresentedFrameCallback = (now: DOMHighResTimeStamp, metadata: { mediaTime?: number }) => void;

type MockVideo = HTMLVideoElement & {
	requestVideoFrameCallback?: (callback: PresentedFrameCallback) => number;
	cancelVideoFrameCallback?: (handle: number) => void;
};

function createMutableRef<T>(value: T) {
	return { current: value };
}

function createMockVideo(overrides: Partial<MockVideo> = {}): MockVideo {
	const video = {
		currentTime: 0.5,
		duration: 10,
		paused: false,
		ended: false,
		playbackRate: 1,
		pause: vi.fn(),
	} as unknown as MockVideo;

	return Object.assign(video, overrides);
}

function expectPresentedFrameCallback(
	callback: PresentedFrameCallback | null,
): PresentedFrameCallback {
	expect(callback).toBeTypeOf("function");
	return callback as PresentedFrameCallback;
}

function expectAnimationFrameCallback(
	callback: FrameRequestCallback | null,
): FrameRequestCallback {
	expect(callback).toBeTypeOf("function");
	return callback as FrameRequestCallback;
}

describe("createVideoEventHandlers", () => {
	const emitEventMock = vi.mocked(extensionHost.emitEvent);
	let requestAnimationFrameMock: ReturnType<typeof vi.fn>;
	let cancelAnimationFrameMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		requestAnimationFrameMock = vi.fn(() => 11);
		cancelAnimationFrameMock = vi.fn();
		vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
		vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
		emitEventMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("prefers requestVideoFrameCallback mediaTime when available", () => {
		let presentedFrameCallback: PresentedFrameCallback | null = null;
		const video = createMockVideo({
			requestVideoFrameCallback: vi.fn((callback) => {
				presentedFrameCallback = callback;
				return 7;
			}),
			cancelVideoFrameCallback: vi.fn(),
		});
		const onPlayStateChange = vi.fn();
		const onTimeUpdate = vi.fn();
		const currentTimeRef = createMutableRef(0);
		const timeUpdateAnimationRef = createMutableRef<number | null>(null);

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef,
			timeUpdateAnimationRef,
			onPlayStateChange,
			onTimeUpdate,
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		expect(onPlayStateChange).toHaveBeenCalledWith(true);
		expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
		expect(requestAnimationFrameMock).not.toHaveBeenCalled();

		expectPresentedFrameCallback(presentedFrameCallback)(0, { mediaTime: 1.25 });

		expect(onTimeUpdate).toHaveBeenCalledWith(1.25);
		expect(currentTimeRef.current).toBe(1250);
		expect(emitEventMock).toHaveBeenLastCalledWith({
			type: "playback:timeupdate",
			timeMs: 1250,
		});
	});

	it("falls back to requestAnimationFrame when requestVideoFrameCallback is unavailable", () => {
		let animationFrameCallback: FrameRequestCallback | null = null;
		requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
			animationFrameCallback = callback;
			return 19;
		});
		const video = createMockVideo({ currentTime: 0.75 });
		const onTimeUpdate = vi.fn();

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

		Object.defineProperty(video, "paused", { configurable: true, value: true });
		expectAnimationFrameCallback(animationFrameCallback)(0);

		expect(onTimeUpdate).toHaveBeenCalledWith(0.75);
	});

	it("cancels a pending requestVideoFrameCallback on pause and dispose", () => {
		const cancelVideoFrameCallback = vi.fn();
		const video = createMockVideo({
			requestVideoFrameCallback: vi.fn(() => 23),
			cancelVideoFrameCallback,
		});
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate: vi.fn(),
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		handlers.handlePause();
		expect(cancelVideoFrameCallback).toHaveBeenCalledWith(23);

		cancelVideoFrameCallback.mockClear();
		handlers.handlePlay();
		handlers.dispose();
		expect(cancelVideoFrameCallback).toHaveBeenCalledWith(23);
	});

	it("skips removed footage after a paused seek", () => {
		const video = createMockVideo({
			currentTime: 1.25,
			paused: true,
		});
		const onTimeUpdate = vi.fn();
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(true),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([{ id: "trim-1", startMs: 1000, endMs: 2000 }]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handleSeeked();

		expect(video.currentTime).toBe(2.002);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2.002);
	});

	it("reschedules frame updates after a seek completes during playback", () => {
		const requestVideoFrameCallback = vi.fn(() => 31);
		const cancelVideoFrameCallback = vi.fn();
		const video = createMockVideo({
			currentTime: 2,
			paused: false,
			requestVideoFrameCallback,
			cancelVideoFrameCallback,
		});
		const onTimeUpdate = vi.fn();

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(true),
			isPlayingRef: createMutableRef(true),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handleSeeked();

		expect(onTimeUpdate).toHaveBeenLastCalledWith(2);
		expect(cancelVideoFrameCallback).not.toHaveBeenCalled();
		expect(requestVideoFrameCallback).toHaveBeenCalledTimes(1);
	});

	it("does not repeatedly process stale presented frames after skipping a clip gap", () => {
		let presentedFrameCallback: PresentedFrameCallback | null = null;
		const video = createMockVideo({
			currentTime: 1.1,
			duration: 10,
			requestVideoFrameCallback: vi.fn((callback) => {
				presentedFrameCallback = callback;
				return 7;
			}),
			cancelVideoFrameCallback: vi.fn(),
		});
		const onTimeUpdate = vi.fn();

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([{ id: "gap", startMs: 1000, endMs: 2000 }]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		expectPresentedFrameCallback(presentedFrameCallback)(0, { mediaTime: 1.1 });

		expect(video.currentTime).toBe(2.002);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2.002);

		expectPresentedFrameCallback(presentedFrameCallback)(16, { mediaTime: 1.12 });

		expect(video.currentTime).toBe(2.002);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2.002);
	});

	it("uses the pending skip target when stale frames arrive before currentTime catches up", () => {
		let presentedFrameCallback: PresentedFrameCallback | null = null;
		let reportedCurrentTime = 1.1;
		let assignedCurrentTime: number | null = null;
		const video = createMockVideo({
			duration: 10,
			requestVideoFrameCallback: vi.fn((callback) => {
				presentedFrameCallback = callback;
				return 7;
			}),
			cancelVideoFrameCallback: vi.fn(),
		});
		Object.defineProperty(video, "currentTime", {
			configurable: true,
			get: () => reportedCurrentTime,
			set: (value: number) => {
				assignedCurrentTime = value;
			},
		});
		const onTimeUpdate = vi.fn();

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([
				{ id: "gap-1", startMs: 1000, endMs: 2000 },
				{ id: "gap-2", startMs: 3500, endMs: 4500 },
			]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		expectPresentedFrameCallback(presentedFrameCallback)(0, { mediaTime: 1.1 });

		expect(assignedCurrentTime).toBe(2.002);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2.002);

		expectPresentedFrameCallback(presentedFrameCallback)(16, { mediaTime: 1.12 });

		expect(assignedCurrentTime).toBe(2.002);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2.002);

		reportedCurrentTime = 2.002;
		expectPresentedFrameCallback(presentedFrameCallback)(32, { mediaTime: 2.002 });

		expect(onTimeUpdate).toHaveBeenLastCalledWith(2.002);
	});

	it("preemptively skips just before removed footage is presented", () => {
		let presentedFrameCallback: PresentedFrameCallback | null = null;
		const video = createMockVideo({
			currentTime: 0.98,
			duration: 10,
			requestVideoFrameCallback: vi.fn((callback) => {
				presentedFrameCallback = callback;
				return 7;
			}),
			cancelVideoFrameCallback: vi.fn(),
		});
		const onTimeUpdate = vi.fn();

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([{ id: "gap", startMs: 1000, endMs: 2000 }]),
			speedRegionsRef: createMutableRef([]),
		});

		handlers.handlePlay();
		expectPresentedFrameCallback(presentedFrameCallback)(0, { mediaTime: 0.98 });

		expect(video.currentTime).toBe(2.002);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2.002);
		expect(onTimeUpdate).not.toHaveBeenCalledWith(0.98);
	});
});
