import {
  DEFAULT_ZOOM_IN_DURATION_MS,
  DEFAULT_ZOOM_OUT_DURATION_MS,
  type ZoomTransitionEasing,
} from "@/types/editor";

export type CursorMotionPresetId = "focused" | "smooth";

/**
 * Every setting a motion preset writes.
 *
 * The matcher iterates these keys and the apply path requires a handler for
 * each, so adding a field here is a compile error until it is wired to a
 * control — which is what stops a preset from becoming the only way to reach a
 * value (roadmap D2: presets are starting points, not replacements).
 */
export interface CursorMotionPresetValues {
  // Camera
  zoomSmoothness: number;
  cameraSpringStiffnessMultiplier: number;
  cameraSpringDampingMultiplier: number;
  cameraSpringMassMultiplier: number;
  zoomInDurationMs: number;
  zoomOutDurationMs: number;
  zoomInEasing: ZoomTransitionEasing;
  zoomOutEasing: ZoomTransitionEasing;
  connectedZoomEasing: ZoomTransitionEasing;
  // Cursor
  cursorSize: number;
  cursorSmoothing: number;
  cursorSpringStiffnessMultiplier: number;
  cursorSpringDampingMultiplier: number;
  cursorSpringMassMultiplier: number;
  cursorMotionBlur: number;
  cursorClickBounce: number;
  cursorClickBounceDuration: number;
}

export interface CursorMotionPreset {
  id: CursorMotionPresetId;
  label: string;
  values: CursorMotionPresetValues;
}

const SHARED_CURSOR_PRESET_VALUES = {
  cursorSize: 2.5,
  cursorSmoothing: 0.67,
  cursorSpringMassMultiplier: 1.29,
  cursorMotionBlur: 0.4,
  cursorClickBounce: 3.5,
  cursorClickBounceDuration: 350,
} as const;

export const CURSOR_MOTION_PRESETS: Record<
  CursorMotionPresetId,
  CursorMotionPreset
> = {
  focused: {
    id: "focused",
    label: "Focused",
    values: {
      ...SHARED_CURSOR_PRESET_VALUES,
      // Tighter, quicker camera: arrives and settles.
      zoomSmoothness: 0.35,
      cameraSpringStiffnessMultiplier: 1.2,
      cameraSpringDampingMultiplier: 0.95,
      cameraSpringMassMultiplier: 0.95,
      zoomInDurationMs: 200,
      zoomOutDurationMs: 200,
      zoomInEasing: "snappy",
      zoomOutEasing: "quiro",
      connectedZoomEasing: "glide",
      cursorSpringStiffnessMultiplier: 1.35,
      cursorSpringDampingMultiplier: 0.79,
    },
  },
  smooth: {
    id: "smooth",
    label: "Smooth",
    values: {
      ...SHARED_CURSOR_PRESET_VALUES,
      // Looser, heavier camera: glides and coasts.
      zoomSmoothness: 0.7,
      cameraSpringStiffnessMultiplier: 0.85,
      cameraSpringDampingMultiplier: 1.3,
      cameraSpringMassMultiplier: 1.3,
      zoomInDurationMs: DEFAULT_ZOOM_IN_DURATION_MS,
      zoomOutDurationMs: DEFAULT_ZOOM_OUT_DURATION_MS,
      zoomInEasing: "smooth",
      zoomOutEasing: "smooth",
      connectedZoomEasing: "glide",
      cursorSpringStiffnessMultiplier: 0.92,
      cursorSpringDampingMultiplier: 1.36,
    },
  },
};

export const CURSOR_MOTION_PRESET_IDS = Object.keys(
  CURSOR_MOTION_PRESETS,
) as CursorMotionPresetId[];

export const CURSOR_MOTION_PRESET_KEYS = Object.keys(
  CURSOR_MOTION_PRESETS.focused.values,
) as (keyof CursorMotionPresetValues)[];

export function getMatchingCursorMotionPresetId(
  values: CursorMotionPresetValues,
): CursorMotionPresetId | null {
  for (const presetId of CURSOR_MOTION_PRESET_IDS) {
    const preset = CURSOR_MOTION_PRESETS[presetId];
    // Every declared key is compared. A preset that writes a field the matcher
    // ignored would keep showing as active after the user edited away from it.
    const matches = CURSOR_MOTION_PRESET_KEYS.every(
      (key) => preset.values[key] === values[key],
    );
    if (matches) {
      return presetId;
    }
  }

  return null;
}

export function resolveCursorMotionPresetId(
  values: CursorMotionPresetValues,
  fallback: CursorMotionPresetId = "focused",
): CursorMotionPresetId {
  return getMatchingCursorMotionPresetId(values) ?? fallback;
}

/**
 * A setter per preset field. Required, not optional — adding a field to
 * `CursorMotionPresetValues` without wiring a control here will not compile.
 */
export type CursorMotionPresetHandlers = {
  [K in keyof CursorMotionPresetValues]: (
    value: CursorMotionPresetValues[K],
  ) => void;
};

export function applyCursorMotionPreset(
  presetId: CursorMotionPresetId,
  handlers: CursorMotionPresetHandlers,
) {
  const { values } = CURSOR_MOTION_PRESETS[presetId];
  // Generic so the handler and the value stay correlated per key; a cast
  // here would widen both sides and let a curve name reach a number setter.
  const write = <K extends keyof CursorMotionPresetValues>(key: K) => {
    handlers[key](values[key]);
  };
  for (const key of CURSOR_MOTION_PRESET_KEYS) {
    write(key);
  }
}
