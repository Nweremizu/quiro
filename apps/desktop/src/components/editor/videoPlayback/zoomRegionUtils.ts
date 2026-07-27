import type {
  ZoomFocus,
  ZoomRegion,
  ZoomTransitionEasing,
} from "@/types/editor";
import {
  DEFAULT_CONNECTED_ZOOM_EASING,
  DEFAULT_ZOOM_IN_EASING,
  DEFAULT_ZOOM_OUT_EASING,
  ZOOM_DEPTH_SCALES,
} from "@/types/editor";
import {
  TRANSITION_WINDOW_MS,
  ZOOM_IN_TRANSITION_WINDOW_MS,
  ZOOM_OUT_EARLY_START_MS,
} from "./constants";
import { clampFocusToScale } from "./focusUtils";
import { clamp01, ZOOM_TRANSITION_EASINGS } from "./mathUtils";

const CHAINED_ZOOM_PAN_GAP_MS = 1350;
const CONNECTED_ZOOM_PAN_DURATION_MS = 1000;
const ZOOM_IN_OVERLAP_MS = 1000;
const ZOOM_ANIMATION_LEAD_MS = 200;

export type CameraMotionOptions = {
  connectZooms?: boolean;
  zoomInDurationMs?: number;
  zoomOutDurationMs?: number;
  zoomInEasing?: ZoomTransitionEasing;
  zoomOutEasing?: ZoomTransitionEasing;
  connectedZoomEasing?: ZoomTransitionEasing;
};

/**
 * Falls back on an unrecognised curve name rather than trusting the type.
 *
 * Easing values reach here from persisted JSON, and until these curves were
 * wired up an unknown value was inert. Now it would be called every frame, so
 * a stale or hand-edited preferences file must not be able to throw inside the
 * ticker.
 */
function resolveEasing(
  easing: ZoomTransitionEasing | undefined,
  fallback: ZoomTransitionEasing,
) {
  return (
    (easing && ZOOM_TRANSITION_EASINGS[easing]) ??
    ZOOM_TRANSITION_EASINGS[fallback]
  );
}

/**
 * The single place camera-motion options are assembled.
 *
 * Callers pass an object they already own and it is narrowed to just the
 * camera-motion fields — the export renderers hand over their whole render
 * config, the preview a memoised object built from its props. Adding a camera
 * parameter is a change here, not a hunt across four call sites.
 *
 * Deliberately applies no defaults. `computeRegionStrength` already falls back
 * for a missing duration; defaulting here as well would put the same value in
 * two places and let them drift.
 */
export function buildCameraMotionOptions(
  settings: CameraMotionOptions,
): CameraMotionOptions {
  return {
    connectZooms: settings.connectZooms,
    zoomInDurationMs: settings.zoomInDurationMs,
    zoomOutDurationMs: settings.zoomOutDurationMs,
    zoomInEasing: settings.zoomInEasing,
    zoomOutEasing: settings.zoomOutEasing,
    connectedZoomEasing: settings.connectedZoomEasing,
  };
}

type ConnectedRegionPair = {
  currentRegion: ZoomRegion;
  nextRegion: ZoomRegion;
  transitionStart: number;
  transitionEnd: number;
};

type ConnectedPanTransition = {
  progress: number;
  startFocus: ZoomFocus;
  endFocus: ZoomFocus;
  startScale: number;
  endScale: number;
};

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

/**
 * True only on the frame an instant zoom lands.
 *
 * Edge-triggered on purpose. Two things key off it, and both are wrong if it
 * stays true for the whole region: the camera spring has to be snapped past
 * (otherwise the spring glides the cut and "instant" is not instant), and
 * motion blur has to be dropped (otherwise the largest camera delta in the
 * project smears the frame meant to read as a cut). During the rest of the
 * hold the camera can legitimately move — cursor-follow and pan-and-zoom both
 * do — and that motion should spring and blur normally.
 */
export function isInstantZoomCut(
  region: ZoomRegion | null,
  strength: number,
  previousProgress: number,
) {
  return region?.instant === true && strength >= 1 && previousProgress < 1;
}

export function computeRegionStrength(
  region: ZoomRegion,
  timeMs: number,
  options: Pick<
    CameraMotionOptions,
    | "zoomInDurationMs"
    | "zoomOutDurationMs"
    | "zoomInEasing"
    | "zoomOutEasing"
  > = {},
) {
  const zoomInDurationMs = Math.max(
    1,
    options.zoomInDurationMs ?? ZOOM_IN_TRANSITION_WINDOW_MS,
  );
  const zoomOutDurationMs = Math.max(
    1,
    options.zoomOutDurationMs ?? TRANSITION_WINDOW_MS,
  );
  const adjustedTimeMs = timeMs - ZOOM_ANIMATION_LEAD_MS;
  const leadInStart =
    region.startMs + ZOOM_IN_OVERLAP_MS - ZOOM_IN_TRANSITION_WINDOW_MS;
  let zoomOutStart = region.endMs - ZOOM_OUT_EARLY_START_MS;
  let zoomInEnd = leadInStart + zoomInDurationMs;

  // Instant zoom: no ramp in, so no anticipation lead either — the cut has to
  // land on the frame the region starts, not 200ms before it. The zoom out is
  // deliberately left alone so cut-in / drift-out is the default shape.
  if (region.instant) {
    if (timeMs < region.startMs) {
      return 0;
    }
    // A region shorter than the zoom-out lead would otherwise start its ramp
    // out before the cut had landed, so the cut would never reach full depth.
    // The hold always begins where the cut lands.
    const instantZoomOutStart = Math.max(zoomOutStart, region.startMs);
    if (adjustedTimeMs <= instantZoomOutStart) {
      return 1;
    }
    const outProgress = clamp01(
      (adjustedTimeMs - instantZoomOutStart) / zoomOutDurationMs,
    );
    return (
      1 -
      resolveEasing(options.zoomOutEasing, DEFAULT_ZOOM_OUT_EASING)(outProgress)
    );
  }

  if (zoomInEnd > zoomOutStart) {
    const midpoint = (zoomInEnd + zoomOutStart) / 2;
    zoomInEnd = midpoint;
    zoomOutStart = midpoint;
  }

  const leadOutEnd = zoomOutStart + zoomOutDurationMs;

  if (adjustedTimeMs < leadInStart || adjustedTimeMs > leadOutEnd) {
    return 0;
  }

  if (adjustedTimeMs < zoomInEnd) {
    const progress = (adjustedTimeMs - leadInStart) / zoomInDurationMs;
    return resolveEasing(options.zoomInEasing, DEFAULT_ZOOM_IN_EASING)(progress);
  }

  if (adjustedTimeMs <= zoomOutStart) {
    return 1;
  }

  const progress = clamp01((adjustedTimeMs - zoomOutStart) / zoomOutDurationMs);
  return (
    1 - resolveEasing(options.zoomOutEasing, DEFAULT_ZOOM_OUT_EASING)(progress)
  );
}

function getLinearFocus(
  start: ZoomFocus,
  end: ZoomFocus,
  amount: number,
): ZoomFocus {
  return {
    cx: lerp(start.cx, end.cx, amount),
    cy: lerp(start.cy, end.cy, amount),
  };
}

function getResolvedFocus(
  region: ZoomRegion,
  zoomScale: number,
  timeMs?: number,
): ZoomFocus {
  if (
    region.presetId === "pan-and-zoom" &&
    region.endFocus &&
    Number.isFinite(timeMs)
  ) {
    const progress = clamp01(
      ((timeMs as number) - region.startMs) /
        Math.max(1, region.endMs - region.startMs),
    );
    return clampFocusToScale(
      getLinearFocus(region.focus, region.endFocus, progress),
      zoomScale,
    );
  }
  return clampFocusToScale(region.focus, zoomScale);
}

function getConnectedRegionPairs(regions: ZoomRegion[]) {
  const sortedRegions = [...regions].sort((a, b) => a.startMs - b.startMs);
  const pairs: ConnectedRegionPair[] = [];

  for (let index = 0; index < sortedRegions.length - 1; index += 1) {
    const currentRegion = sortedRegions[index];
    const nextRegion = sortedRegions[index + 1];
    const gapMs = nextRegion.startMs - currentRegion.endMs;

    if (gapMs > CHAINED_ZOOM_PAN_GAP_MS) {
      continue;
    }

    // You cannot glide into a cut. A connected pan would ease the camera into
    // the next region and start it early, which is exactly what instant
    // exists to avoid — so an instant region never chains from its neighbour.
    if (nextRegion.instant) {
      continue;
    }

    pairs.push({
      currentRegion,
      nextRegion,
      transitionStart: currentRegion.endMs + ZOOM_ANIMATION_LEAD_MS,
      transitionEnd:
        currentRegion.endMs +
        ZOOM_ANIMATION_LEAD_MS +
        CONNECTED_ZOOM_PAN_DURATION_MS,
    });
  }

  return pairs;
}

function getActiveRegion(
  regions: ZoomRegion[],
  timeMs: number,
  connectedPairs: ConnectedRegionPair[],
  options: CameraMotionOptions,
) {
  const activeRegions = regions
    .map((region) => {
      const outgoingPair = connectedPairs.find(
        (pair) => pair.currentRegion.id === region.id,
      );
      if (outgoingPair && timeMs >= outgoingPair.transitionStart) {
        return { region, strength: 0 };
      }

      const incomingPair = connectedPairs.find(
        (pair) => pair.nextRegion.id === region.id,
      );
      if (incomingPair) {
        if (timeMs < incomingPair.transitionStart) {
          return { region, strength: 0 };
        }

        const nextRegionZoomOutStart =
          incomingPair.nextRegion.endMs -
          ZOOM_OUT_EARLY_START_MS +
          ZOOM_ANIMATION_LEAD_MS;
        if (timeMs < nextRegionZoomOutStart) {
          return { region, strength: 1 };
        }
      }

      return {
        region,
        strength: computeRegionStrength(region, timeMs, options),
      };
    })
    .filter((entry) => entry.strength > 0)
    .sort((left, right) => {
      if (right.strength !== left.strength) {
        return right.strength - left.strength;
      }

      return right.region.startMs - left.region.startMs;
    });

  if (activeRegions.length === 0) {
    return null;
  }

  const activeRegion = activeRegions[0].region;
  const activeScale = ZOOM_DEPTH_SCALES[activeRegion.depth];

  return {
    region: {
      ...activeRegion,
      focus: getResolvedFocus(activeRegion, activeScale, timeMs),
    },
    strength: activeRegions[0].strength,
    blendedScale: null,
  };
}

function getConnectedRegionHold(
  timeMs: number,
  connectedPairs: ConnectedRegionPair[],
) {
  for (const pair of connectedPairs) {
    if (timeMs >= pair.transitionEnd && timeMs < pair.nextRegion.startMs) {
      const nextScale = ZOOM_DEPTH_SCALES[pair.nextRegion.depth];
      return {
        region: {
          ...pair.nextRegion,
          focus: getResolvedFocus(pair.nextRegion, nextScale),
        },
        strength: 1,
        blendedScale: null,
      };
    }
  }

  return null;
}

function getConnectedRegionTransition(
  connectedPairs: ConnectedRegionPair[],
  timeMs: number,
  options: Pick<CameraMotionOptions, "connectedZoomEasing">,
) {
  for (const pair of connectedPairs) {
    const { currentRegion, nextRegion, transitionStart, transitionEnd } = pair;

    if (timeMs < transitionStart || timeMs > transitionEnd) {
      continue;
    }

    const transitionProgress = resolveEasing(
      options.connectedZoomEasing,
      DEFAULT_CONNECTED_ZOOM_EASING,
    )(
      clamp01(
        (timeMs - transitionStart) /
          Math.max(1, transitionEnd - transitionStart),
      ),
    );
    const currentScale = ZOOM_DEPTH_SCALES[currentRegion.depth];
    const nextScale = ZOOM_DEPTH_SCALES[nextRegion.depth];
    const transitionScale = lerp(currentScale, nextScale, transitionProgress);
    const currentFocus = getResolvedFocus(currentRegion, currentScale);
    const nextFocus = getResolvedFocus(nextRegion, nextScale);
    const transitionFocus = getLinearFocus(
      currentFocus,
      nextFocus,
      transitionProgress,
    );

    return {
      region: {
        ...nextRegion,
        focus: transitionFocus,
      },
      strength: 1,
      blendedScale: transitionScale,
      transition: {
        progress: transitionProgress,
        startFocus: currentFocus,
        endFocus: nextFocus,
        startScale: currentScale,
        endScale: nextScale,
      },
    };
  }

  return null;
}

export function findDominantRegion(
  regions: ZoomRegion[],
  timeMs: number,
  options: CameraMotionOptions = {},
): {
  region: ZoomRegion | null;
  strength: number;
  blendedScale: number | null;
  transition: ConnectedPanTransition | null;
} {
  const connectedPairs = options.connectZooms
    ? getConnectedRegionPairs(regions)
    : [];

  if (options.connectZooms) {
    const connectedTransition = getConnectedRegionTransition(
      connectedPairs,
      timeMs,
      options,
    );
    if (connectedTransition) {
      return connectedTransition;
    }

    const connectedHold = getConnectedRegionHold(timeMs, connectedPairs);
    if (connectedHold) {
      return { ...connectedHold, transition: null };
    }
  }

  const activeRegion = getActiveRegion(
    regions,
    timeMs,
    connectedPairs,
    options,
  );
  return activeRegion
    ? { ...activeRegion, transition: null }
    : { region: null, strength: 0, blendedScale: null, transition: null };
}
