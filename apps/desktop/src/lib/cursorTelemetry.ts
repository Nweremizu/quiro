import type { CursorTelemetryPoint } from "@/types";

const MAX_CURSOR_SAMPLES = 60 * 60 * 30; // 1 hour @ 30Hz

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCursorTelemetrySamples(
  rawSamples: unknown,
  maxTimeMs?: number,
): CursorTelemetryPoint[] {
  const samples = Array.isArray(rawSamples)
    ? rawSamples
    : Array.isArray(
          (rawSamples as { samples?: unknown[] } | null | undefined)?.samples,
        )
      ? ((rawSamples as { samples: unknown[] }).samples ?? [])
      : [];
  const boundedSamples = samples.slice(0, MAX_CURSOR_SAMPLES);

  const capMs =
    typeof maxTimeMs === "number" && Number.isFinite(maxTimeMs) && maxTimeMs > 0
      ? maxTimeMs
      : null;

  return boundedSamples
    .filter((sample: unknown) => Boolean(sample && typeof sample === "object"))
    .map((sample: unknown) => {
      const point = sample as Partial<CursorTelemetryPoint>;
      return {
        timeMs:
          typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
            ? Math.max(0, point.timeMs)
            : 0,
        cx:
          typeof point.cx === "number" && Number.isFinite(point.cx)
            ? clamp(point.cx, 0, 1)
            : 0.5,
        cy:
          typeof point.cy === "number" && Number.isFinite(point.cy)
            ? clamp(point.cy, 0, 1)
            : 0.5,
        interactionType:
          point.interactionType === "click" ||
          point.interactionType === "double-click" ||
          point.interactionType === "right-click" ||
          point.interactionType === "middle-click" ||
          point.interactionType === "move" ||
          point.interactionType === "mouseup"
            ? point.interactionType
            : undefined,
        cursorType:
          point.cursorType === "arrow" ||
          point.cursorType === "text" ||
          point.cursorType === "pointer" ||
          point.cursorType === "crosshair" ||
          point.cursorType === "open-hand" ||
          point.cursorType === "closed-hand" ||
          point.cursorType === "resize-ew" ||
          point.cursorType === "resize-ns" ||
          point.cursorType === "not-allowed"
            ? point.cursorType
            : undefined,
      };
    })
    .filter((point) => capMs === null || point.timeMs <= capMs)
    .sort((a, b) => a.timeMs - b.timeMs);
}
