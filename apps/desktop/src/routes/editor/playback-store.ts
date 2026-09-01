import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { FrameLayoutEvent } from "@/utils/tauri";
import type { SocketFrame } from "../screenshot-editor/frameSocket";

// Playback produces three streams that change up to 60 times a second: preview
// frames, playhead positions, and the renderer's frame layout. Holding those in
// React state re-rendered the whole editor per frame, which is what made the
// playhead move in visible steps — React coalesced the updates into bursts.
//
// They live here instead, in a plain observable store. Components that paint
// them (the canvas, the playhead) subscribe and write to the DOM directly;
// only components that genuinely need a re-render take a React snapshot, at a
// deliberately coarse rate.

/** How far ahead of the last reported position the playhead may be drawn. A
 * frame or two of slack smooths out jitter; more than that would be lying
 * about where playback is. */
const MAX_INTERPOLATION_LEAD_SECONDS = 0.25;

export type PlaybackSnapshot = {
	time: number;
	playing: boolean;
};

export class PlaybackStore {
	private time = 0;
	private playing = false;
	private frame: SocketFrame | null = null;
	private layout: FrameLayoutEvent | null = null;

	/** Wall clock at the last authoritative time from the backend, used to
	 * interpolate between its updates. */
	private anchoredAt = 0;

	private readonly timeListeners = new Set<() => void>();
	private readonly frameListeners = new Set<() => void>();
	private readonly layoutListeners = new Set<() => void>();

	subscribeTime = (listener: () => void) => {
		this.timeListeners.add(listener);
		return () => {
			this.timeListeners.delete(listener);
		};
	};

	subscribeFrame = (listener: () => void) => {
		this.frameListeners.add(listener);
		return () => {
			this.frameListeners.delete(listener);
		};
	};

	subscribeLayout = (listener: () => void) => {
		this.layoutListeners.add(listener);
		return () => {
			this.layoutListeners.delete(listener);
		};
	};

	getFrame = () => this.frame;
	getLayout = () => this.layout;
	getTime = () => this.time;
	isPlaying = () => this.playing;

	/** Where the playhead is *right now*: the last reported position plus the
	 * time elapsed since, so readers animating at display refresh rate get a
	 * continuous value instead of the backend's step function.
	 *
	 * The lead is capped: if the renderer stalls, the playhead should pause with
	 * it rather than sail off ahead of the picture and snap back. */
	getInterpolatedTime = () => {
		if (!this.playing) return this.time;

		const elapsed = (performance.now() - this.anchoredAt) / 1000;
		return this.time + Math.min(elapsed, MAX_INTERPOLATION_LEAD_SECONDS);
	};

	setTime(time: number) {
		this.time = time;
		this.anchoredAt = performance.now();
		for (const listener of this.timeListeners) listener();
	}

	setPlaying(playing: boolean) {
		// Re-anchor so the first interpolated frame after resuming doesn't jump
		// by however long playback was paused.
		this.anchoredAt = performance.now();
		this.playing = playing;
		for (const listener of this.timeListeners) listener();
	}

	setFrame(frame: SocketFrame) {
		this.frame?.bitmap.close();
		this.frame = frame;
		for (const listener of this.frameListeners) listener();
	}

	setLayout(layout: FrameLayoutEvent) {
		this.layout = layout;
		for (const listener of this.layoutListeners) listener();
	}

	dispose() {
		this.frame?.bitmap.close();
		this.frame = null;
		this.timeListeners.clear();
		this.frameListeners.clear();
		this.layoutListeners.clear();
	}
}

/** Re-renders on every new preview frame. Only for components that must, like
 * the overlays sizing themselves to the frame. */
export function useLatestFrame(store: PlaybackStore) {
	return useSyncExternalStore(store.subscribeFrame, store.getFrame);
}

export function useFrameLayout(store: PlaybackStore) {
	return useSyncExternalStore(store.subscribeLayout, store.getLayout);
}

/** The playhead time, re-rendered at most `hz` times a second. Interaction
 * handlers should read `store.getTime()` instead of using this. */
export function useThrottledPlaybackTime(store: PlaybackStore, hz = 10) {
	const [time, setTime] = useThrottledState(store.getTime(), 1000 / hz);

	useEffect(() => {
		const unsubscribe = store.subscribeTime(() => setTime(store.getTime()));
		return () => {
			unsubscribe();
		};
	}, [store, setTime]);

	return time;
}

/** Like useState, but at most one committed update per `intervalMs`; the last
 * value always lands, so a paused playhead settles on its true position. */
function useThrottledState<T>(initial: T, intervalMs: number) {
	const [value, setValue] = useState(initial);
	const lastCommitRef = useRef(0);
	const pendingRef = useRef<number | undefined>(undefined);

	const set = useCallback(
		(next: T) => {
			const now = performance.now();
			window.clearTimeout(pendingRef.current);

			if (now - lastCommitRef.current >= intervalMs) {
				lastCommitRef.current = now;
				setValue(next);
				return;
			}

			pendingRef.current = window.setTimeout(
				() => {
					lastCommitRef.current = performance.now();
					setValue(next);
				},
				intervalMs - (now - lastCommitRef.current),
			);
		},
		[intervalMs],
	);

	useEffect(() => () => window.clearTimeout(pendingRef.current), []);

	return [value, set] as const;
}
