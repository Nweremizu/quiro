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

// Drift tuning. Provisional — the character of the motion is a taste decision
// the tuning sweep is expected to revisit. What is *not* provisional: it must
// stay deterministic, bounded, and off by default.
const DRIFT_MIN_HOLD_MS = 1500;
const DRIFT_RAMP_MS = 600;
const DRIFT_PERIOD_X_MS = 11000;
const DRIFT_PERIOD_Y_MS = 7000;
const DRIFT_MAX_OFFSET = 0.045;
const DRIFT_VERTICAL_WEIGHT = 0.6;
// Offsets the vertical phase from the horizontal one so the pair traces a slow
// open path rather than a diagonal line.
const DRIFT_VERTICAL_PHASE_OFFSET = 1.37;
const TAU = Math.PI * 2;
const NO_DRIFT = Object.freeze({ dx: 0, dy: 0 });

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
  zoomDrift?: number;
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
    zoomDrift: settings.zoomDrift,
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

/** FNV-1a, folded to 0..1. Gives each region a stable phase from its id. */
function hashToUnitInterval(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/**
 * Slow parallax while a zoom is held, so a long hold reads as a camera pointed
 * at something rather than a cropped screenshot.
 *
 * Two slow sinusoids at incommensurate periods, phase-seeded from the region
 * id so neighbouring zooms do not move in lockstep. Deterministic by
 * construction — a pure function of the region, the time within it and the
 * settings, with no RNG, no accumulated state and no wall-clock — because
 * re-exporting a project has to produce identical frames.
 *
 * Returns an offset in focus space. The caller re-clamps, so drift inherits
 * the existing bounds and can never reveal an edge.
 */
export function computeZoomDriftOffset(
  region: ZoomRegion,
  timeMs: number,
  zoomScale: number,
  driftStrength: number | undefined,
  zoomInDurationMs: number = ZOOM_IN_TRANSITION_WINDOW_MS,
) {
  // Ordered cheapest-first: the common case is drift off, and this runs every
  // frame for every region.
  if (!driftStrength || driftStrength <= 0) {
    return NO_DRIFT;
  }
  // Auto regions are already tracking the cursor; drift on top is just noise.
  // pan-and-zoom is likewise already deliberate camera work.
  if (region.mode !== "manual" || region.presetId === "pan-and-zoom") {
    return NO_DRIFT;
  }

  // Measured over the *hold*, not the region. A region is mostly ramp: with
  // the default 1522ms zoom in, a 1.6s region has no hold at all. Gating and
  // ramping on region bounds would let drift run at full amplitude while the
  // zoom was still moving, which is the motion it is supposed to wait for.
  const holdStartMs = region.instant
    ? region.startMs
    : region.startMs + zoomInDurationMs;
  const holdEndMs = region.endMs - ZOOM_OUT_EARLY_START_MS;
  const holdMs = holdEndMs - holdStartMs;
  if (holdMs < DRIFT_MIN_HOLD_MS) {
    return NO_DRIFT;
  }

  const elapsedMs = timeMs - holdStartMs;
  if (elapsedMs < 0 || elapsedMs > holdMs) {
    return NO_DRIFT;
  }

  // Zero at both ends so drift neither snaps on nor fights the zoom out.
  const ramp = Math.min(
    1,
    elapsedMs / DRIFT_RAMP_MS,
    (holdMs - elapsedMs) / DRIFT_RAMP_MS,
  );
  if (ramp <= 0) {
    return NO_DRIFT;
  }

  const phase = hashToUnitInterval(region.id);
  // Divided by the zoom scale so on-screen travel stays comparable as the
  // zoom goes deeper — the same focus-space offset covers more pixels at 5x.
  const amplitude =
    (DRIFT_MAX_OFFSET * clamp01(driftStrength) * ramp) / Math.max(1, zoomScale);

  return {
    dx: Math.sin(TAU * (elapsedMs / DRIFT_PERIOD_X_MS + phase)) * amplitude,
    dy:
      Math.sin(
        TAU *
          (elapsedMs / DRIFT_PERIOD_Y_MS +
            phase * DRIFT_VERTICAL_PHASE_OFFSET),
      ) *
      amplitude *
      DRIFT_VERTICAL_WEIGHT,
  };
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
  driftStrength?: number,
  zoomInDurationMs?: number,
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

  if (driftStrength && Number.isFinite(timeMs)) {
    const drift = computeZoomDriftOffset(
      region,
      timeMs as number,
      zoomScale,
      driftStrength,
      zoomInDurationMs,
    );
    if (drift.dx !== 0 || drift.dy !== 0) {
      // Clamped here, so drift can never push the frame past a video edge.
      return clampFocusToScale(
        { cx: region.focus.cx + drift.dx, cy: region.focus.cy + drift.dy },
        zoomScale,
      );
    }
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
      // Connected holds and pans deliberately do not drift: the camera there
      // is either chained or already in motion, which is not the static-frame
      // problem drift exists to solve.
      focus: getResolvedFocus(
        activeRegion,
        activeScale,
        timeMs,
        options.zoomDrift,
        options.zoomInDurationMs,
      ),
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
