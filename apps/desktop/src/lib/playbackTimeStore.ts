/**
 * Live playback time, published every presented video frame.
 *
 * Updating React state on every frame re-renders the entire editor tree
 * (timeline, panels, preview) at up to 60 Hz, which caps playback FPS. So
 * during playback the React `currentTime` state is throttled, and the few
 * things that genuinely need per-frame time (the timeline playhead, media
 * sync) read it from this store instead. Holds `null` while paused — the
 * throttled React state is flushed and authoritative then.
 */
export interface LivePlaybackTime {
  /** Source-video time in seconds (same unit as the `currentTime` state). */
  sourceSec: number;
  /** Timeline-space time in ms (trims/clips collapsed), for the playhead. */
  timelineMs: number;
}

let value: LivePlaybackTime | null = null;
const listeners = new Set<() => void>();

export const playbackTimeStore = {
  get(): LivePlaybackTime | null {
    return value;
  },
  set(next: LivePlaybackTime | null): void {
    value = next;
    for (const listener of listeners) {
      listener();
    }
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
