import type {
  AnnotationAnimationPresetId,
  AnnotationKeyframe,
  AnnotationPosition,
  AnnotationRegion,
  ArrowDirection,
} from "@/types/editor";
import { DEFAULT_ANNOTATION_ANIMATION } from "@/types/editor";

const MIN_ANNOTATION_ANIMATION_DURATION_MS = 120;
const MAX_ANNOTATION_ANIMATION_DURATION_MS = 1800;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ease(progress: number, easing: AnnotationKeyframe["easing"]) {
  const t = clamp(progress, 0, 1);
  if (easing === "ease-in-out") {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  return t;
}

function lerp(a: number, b: number, progress: number) {
  return a + (b - a) * progress;
}

function easeOut(progress: number) {
  const t = clamp(progress, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function springEase(progress: number, stiffness: number, damping: number) {
  const t = clamp(progress, 0, 1);
  const safeStiffness = clamp(stiffness, 80, 700);
  const safeDamping = clamp(damping, 8, 60);
  const frequency = Math.sqrt(safeStiffness) / 10;
  const decay = safeDamping / 12;
  const value =
    1 - Math.exp(-decay * t) * Math.cos(frequency * Math.PI * 2 * t);
  return clamp(value, 0, 1);
}

function lerpPosition(
  a: AnnotationPosition,
  b: AnnotationPosition,
  progress: number,
): AnnotationPosition {
  return {
    x: lerp(a.x, b.x, progress),
    y: lerp(a.y, b.y, progress),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeKeyframes(keyframes?: AnnotationKeyframe[]) {
  return (Array.isArray(keyframes) ? keyframes : [])
    .filter((keyframe) => Number.isFinite(keyframe.timeMs))
    .sort((left, right) => left.timeMs - right.timeMs);
}

export function getAnnotationAnimationDurationMs(
  annotation: Pick<AnnotationRegion, "startMs" | "endMs" | "animation">,
): number {
  const annotationDurationMs = Math.max(
    1,
    Math.round(annotation.endMs - annotation.startMs),
  );
  const minimumMs = Math.min(
    MIN_ANNOTATION_ANIMATION_DURATION_MS,
    annotationDurationMs,
  );
  const maximumMs = Math.min(
    MAX_ANNOTATION_ANIMATION_DURATION_MS,
    annotationDurationMs,
  );
  const requestedMs = Number.isFinite(annotation.animation?.durationMs)
    ? Math.round(annotation.animation?.durationMs ?? minimumMs)
    : DEFAULT_ANNOTATION_ANIMATION.durationMs;

  return clamp(requestedMs, minimumMs, Math.max(minimumMs, maximumMs));
}

function applyPresetAnimation(
  annotation: AnnotationRegion,
  timeMs: number,
): AnnotationRegion {
  const settings = {
    ...DEFAULT_ANNOTATION_ANIMATION,
    ...(annotation.animation ?? {}),
  };
  if (settings.presetId === "none") return annotation;

  const totalMs = Math.max(1, annotation.endMs - annotation.startMs);
  const durationMs = getAnnotationAnimationDurationMs(annotation);
  const phaseDurationMs = Math.min(durationMs, Math.max(1, totalMs / 2));
  const elapsedMs = clamp(timeMs - annotation.startMs, 0, totalMs);
  const remainingMs = clamp(annotation.endMs - timeMs, 0, totalMs);
  const entering = elapsedMs < phaseDurationMs;
  const exiting = remainingMs < phaseDurationMs;
  const rawProgress = entering
    ? elapsedMs / phaseDurationMs
    : exiting
      ? remainingMs / phaseDurationMs
      : 1;
  const progress =
    settings.presetId === "pop"
      ? springEase(rawProgress, settings.springStiffness, settings.springDamping)
      : easeOut(rawProgress);
  const direction = entering ? 1 - progress : exiting ? progress - 1 : 0;

  const baseOpacity = annotation.opacity ?? 1;
  const baseScale = annotation.scale ?? 1;
  const presetId: AnnotationAnimationPresetId = settings.presetId;
  let nextPosition = annotation.position;
  let nextOpacity = baseOpacity;
  let nextScale = baseScale;

  switch (presetId) {
    case "fade":
      nextOpacity = baseOpacity * progress;
      break;
    case "rise":
      nextOpacity = baseOpacity * progress;
      nextPosition = {
        ...annotation.position,
        y: annotation.position.y + direction * 5,
      };
      break;
    case "pop":
      nextOpacity = baseOpacity * progress;
      nextScale = baseScale * lerp(0.88, 1, progress);
      break;
    case "slide-left":
      nextOpacity = baseOpacity * progress;
      nextPosition = {
        ...annotation.position,
        x: annotation.position.x - direction * 6,
      };
      break;
    case "spotlight":
      nextOpacity = baseOpacity * progress;
      nextScale = baseScale * lerp(1.08, 1, progress);
      break;
  }

  return {
    ...annotation,
    opacity: clamp(nextOpacity, 0, 1),
    scale: clamp(nextScale, 0.1, 4),
    position: {
      x: clamp(nextPosition.x, 0, 100),
      y: clamp(nextPosition.y, 0, 100),
    },
  };
}

function getLastValue<T>(
  keyframes: AnnotationKeyframe[],
  timeMs: number,
  getter: (keyframe: AnnotationKeyframe) => T | undefined,
): T | undefined {
  let value: T | undefined;
  for (const keyframe of keyframes) {
    if (keyframe.timeMs > timeMs) break;
    const next = getter(keyframe);
    if (next !== undefined) value = next;
  }
  return value;
}

function interpolateNumber(
  keyframes: AnnotationKeyframe[],
  timeMs: number,
  fallback: number,
  getter: (keyframe: AnnotationKeyframe) => number | undefined,
): number {
  const frames = keyframes.filter((keyframe) => isFiniteNumber(getter(keyframe)));
  if (frames.length === 0) return fallback;

  const first = frames[0];
  if (timeMs <= first.timeMs) return getter(first) ?? fallback;

  for (let index = 0; index < frames.length - 1; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    if (timeMs < current.timeMs || timeMs > next.timeMs) continue;
    const span = Math.max(1, next.timeMs - current.timeMs);
    const progress = ease((timeMs - current.timeMs) / span, next.easing);
    return lerp(getter(current) ?? fallback, getter(next) ?? fallback, progress);
  }

  return getter(frames[frames.length - 1]) ?? fallback;
}

function interpolatePosition(
  keyframes: AnnotationKeyframe[],
  timeMs: number,
  fallback: AnnotationPosition,
): AnnotationPosition {
  const frames = keyframes.filter((keyframe) => keyframe.position);
  if (frames.length === 0) return fallback;

  const first = frames[0];
  if (timeMs <= first.timeMs) return first.position ?? fallback;

  for (let index = 0; index < frames.length - 1; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    if (timeMs < current.timeMs || timeMs > next.timeMs) continue;
    const span = Math.max(1, next.timeMs - current.timeMs);
    const progress = ease((timeMs - current.timeMs) / span, next.easing);
    return lerpPosition(
      current.position ?? fallback,
      next.position ?? fallback,
      progress,
    );
  }

  return frames[frames.length - 1].position ?? fallback;
}

export function resolveAnnotationAtTime(
  annotation: AnnotationRegion,
  timeMs: number,
): AnnotationRegion {
  const keyframes = normalizeKeyframes(annotation.keyframes);
  if (keyframes.length === 0) {
    return applyPresetAnimation({
      ...annotation,
      opacity: annotation.opacity ?? 1,
      scale: annotation.scale ?? 1,
      visible: annotation.visible ?? true,
    }, timeMs);
  }

  const arrowDirection = getLastValue<ArrowDirection>(
    keyframes,
    timeMs,
    (keyframe) => keyframe.arrowDirection,
  );

  const resolved = {
    ...annotation,
    visible: annotation.visible ?? true,
    position: interpolatePosition(keyframes, timeMs, annotation.position),
    opacity: clamp(
      interpolateNumber(
        keyframes,
        timeMs,
        annotation.opacity ?? 1,
        (keyframe) => keyframe.opacity,
      ),
      0,
      1,
    ),
    scale: clamp(
      interpolateNumber(
        keyframes,
        timeMs,
        annotation.scale ?? 1,
        (keyframe) => keyframe.scale,
      ),
      0.1,
      4,
    ),
    blurIntensity: interpolateNumber(
      keyframes,
      timeMs,
      annotation.blurIntensity ?? 20,
      (keyframe) => keyframe.blurIntensity,
    ),
    figureData:
      arrowDirection && annotation.figureData
        ? { ...annotation.figureData, arrowDirection }
        : annotation.figureData,
  };

  return applyPresetAnimation(resolved, timeMs);
}
