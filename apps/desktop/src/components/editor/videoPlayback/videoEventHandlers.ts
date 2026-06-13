import type React from "react";
import { extensionHost } from "@/lib/extensions";
import { enablePitchPreservingPlayback } from "@/lib/mediaTiming";
import { playbackSessionDebug } from "@/lib/playbackSessionDebug";
import type { SpeedRegion, TrimRegion } from "@/types/editor";

const TRIM_BOUNDARY_EPSILON_MS = 2;
const PREEMPTIVE_TRIM_SKIP_MS = 45;
const STALE_FRAME_SEEK_TOLERANCE_MS = 40;

interface PresentedFrameMetadata {
  mediaTime?: number;
  presentedFrames?: number;
  processingDuration?: number;
  expectedDisplayTime?: number;
}

type PresentedFrameVideoElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (
      now: DOMHighResTimeStamp,
      metadata: PresentedFrameMetadata,
    ) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface VideoEventHandlersParams {
  video: HTMLVideoElement;
  isSeekingRef: React.MutableRefObject<boolean>;
  isPlayingRef: React.MutableRefObject<boolean>;
  allowPlaybackRef: React.MutableRefObject<boolean>;
  currentTimeRef: React.MutableRefObject<number>;
  timeUpdateAnimationRef: React.MutableRefObject<number | null>;
  onPlayStateChange: (playing: boolean) => void;
  onTimeUpdate: (time: number) => void;
  trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
  speedRegionsRef: React.MutableRefObject<SpeedRegion[]>;
}

export function createVideoEventHandlers(params: VideoEventHandlersParams) {
  const {
    video,
    isSeekingRef,
    isPlayingRef,
    allowPlaybackRef,
    currentTimeRef,
    timeUpdateAnimationRef,
    onPlayStateChange,
    onTimeUpdate,
    trimRegionsRef,
    speedRegionsRef,
  } = params;
  const presentedFrameVideo = video as PresentedFrameVideoElement;
  let videoFrameRequestId: number | null = null;
  let pendingProgrammaticSeekMs: number | null = null;
  enablePitchPreservingPlayback(video);

  const emitTime = (timeValue: number) => {
    currentTimeRef.current = timeValue * 1000;
    onTimeUpdate(timeValue);
    extensionHost.emitEvent({
      type: "playback:timeupdate",
      timeMs: timeValue * 1000,
    });
  };

  // Helper function to check if current time is within a trim region
  const findActiveTrimRegion = (currentTimeMs: number): TrimRegion | null => {
    const trimRegions = trimRegionsRef.current;
    return (
      trimRegions.find(
        (region) =>
          currentTimeMs >= region.startMs &&
          currentTimeMs < region.endMs - TRIM_BOUNDARY_EPSILON_MS,
      ) || null
    );
  };

  const findUpcomingTrimRegion = (currentTimeMs: number): TrimRegion | null => {
    const trimRegions = trimRegionsRef.current;
    return (
      trimRegions.find(
        (region) =>
          currentTimeMs < region.startMs &&
          region.startMs - currentTimeMs <= PREEMPTIVE_TRIM_SKIP_MS,
      ) || null
    );
  };

  // Helper function to find the active speed region at the current time
  const findActiveSpeedRegion = (currentTimeMs: number): SpeedRegion | null => {
    return (
      speedRegionsRef.current.find(
        (region) =>
          currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
      ) || null
    );
  };

  const skipPastTrimRegion = (trimRegion: TrimRegion) => {
    const skipToTime = (trimRegion.endMs + TRIM_BOUNDARY_EPSILON_MS) / 1000;
    const clampedSkipToTime = Math.min(skipToTime, video.duration);
    pendingProgrammaticSeekMs = clampedSkipToTime * 1000;

    video.currentTime = clampedSkipToTime;
    emitTime(clampedSkipToTime);

    if (clampedSkipToTime >= video.duration) {
      video.pause();
    }
  };

  const cancelScheduledUpdate = () => {
    if (timeUpdateAnimationRef.current !== null) {
      cancelAnimationFrame(timeUpdateAnimationRef.current);
      timeUpdateAnimationRef.current = null;
    }

    if (
      videoFrameRequestId !== null &&
      typeof presentedFrameVideo.cancelVideoFrameCallback === "function"
    ) {
      presentedFrameVideo.cancelVideoFrameCallback(videoFrameRequestId);
      videoFrameRequestId = null;
    }
  };

  const scheduleNextUpdate = () => {
    if (video.paused || video.ended) {
      return;
    }

    // Align editor state with the frame Chromium actually presented instead of
    // polling `currentTime` on a generic animation frame.
    if (typeof presentedFrameVideo.requestVideoFrameCallback === "function") {
      videoFrameRequestId = presentedFrameVideo.requestVideoFrameCallback(
        (now, metadata) => {
          videoFrameRequestId = null;
          playbackSessionDebug.recordPresentedFrame(now, metadata);
          updateTime(metadata);
        },
      );
      return;
    }

    timeUpdateAnimationRef.current = requestAnimationFrame(() => {
      timeUpdateAnimationRef.current = null;
      updateTime();
    });
  };

  function getPresentedTime(metadata?: PresentedFrameMetadata): number {
    const mediaTime = metadata?.mediaTime;
    if (!Number.isFinite(mediaTime)) {
      return video.currentTime;
    }

    if (pendingProgrammaticSeekMs !== null) {
      const presentedTimeMs = (mediaTime ?? 0) * 1000;
      const presentedFrameIsStale =
        Math.abs(presentedTimeMs - pendingProgrammaticSeekMs) >
        STALE_FRAME_SEEK_TOLERANCE_MS;

      if (presentedFrameIsStale) {
        return pendingProgrammaticSeekMs / 1000;
      }

      pendingProgrammaticSeekMs = null;
    }

    return mediaTime ?? 0;
  }

  function updateTime(metadata?: PresentedFrameMetadata) {
    if (!video) return;

    const presentedTime = getPresentedTime(metadata);
    const currentTimeMs = presentedTime * 1000;
    const activeTrimRegion = findActiveTrimRegion(currentTimeMs);
    const upcomingTrimRegion =
      activeTrimRegion || video.paused || video.ended
        ? null
        : findUpcomingTrimRegion(currentTimeMs);
    const trimRegionToSkip = activeTrimRegion ?? upcomingTrimRegion;

    // Skip slightly before removed footage so cuts read as continuous playback.
    if (trimRegionToSkip && !video.paused && !video.ended) {
      skipPastTrimRegion(trimRegionToSkip);
    } else {
      // Apply playback speed from active speed region
      const activeSpeedRegion = findActiveSpeedRegion(currentTimeMs);
      enablePitchPreservingPlayback(video);
      video.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
      emitTime(presentedTime);
    }

    scheduleNextUpdate();
  }

  const handlePlay = () => {
    if (!allowPlaybackRef.current) {
      video.pause();
      return;
    }

    isPlayingRef.current = true;

    onPlayStateChange(true);

    playbackSessionDebug.beginSession(video);
    cancelScheduledUpdate();
    scheduleNextUpdate();
  };

  const handlePause = () => {
    isPlayingRef.current = false;
    onPlayStateChange(false);
    playbackSessionDebug.endSession(video.ended ? "ended" : "pause");
    cancelScheduledUpdate();
    emitTime(video.currentTime);
  };

  const handleSeeked = () => {
    isSeekingRef.current = false;
    pendingProgrammaticSeekMs = null;

    const currentTimeMs = video.currentTime * 1000;
    const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

    // Never leave the preview parked on removed footage after a seek.
    if (activeTrimRegion) {
      skipPastTrimRegion(activeTrimRegion);
      return;
    }

    emitTime(video.currentTime);

    if (isPlayingRef.current && !video.paused && !video.ended) {
      cancelScheduledUpdate();
      scheduleNextUpdate();
    }
  };

  const handleSeeking = () => {
    isSeekingRef.current = true;
    playbackSessionDebug.markSeek();
    cancelScheduledUpdate();
    emitTime(video.currentTime);
  };

  const dispose = () => {
    playbackSessionDebug.endSession("dispose");
    cancelScheduledUpdate();
  };

  return {
    dispose,
    handlePlay,
    handlePause,
    handleSeeked,
    handleSeeking,
  };
}
