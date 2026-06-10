import type {
  CursorClickEffectSettings,
  CursorTelemetryPoint,
} from "@/types/editor";
import { DEFAULT_CURSOR_CLICK_EFFECT } from "@/types/editor";

const CLICK_INTERACTIONS = new Set([
  "click",
  "double-click",
  "right-click",
  "middle-click",
]);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getAlphaHex(alpha: number) {
  return Math.round(clamp(alpha, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");
}

export function findRecentClickPoint(
  points: CursorTelemetryPoint[] | undefined,
  timeMs: number,
  durationMs: number,
): CursorTelemetryPoint | null {
  if (!points?.length) return null;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    const elapsedMs = timeMs - point.timeMs;
    if (elapsedMs < 0) continue;
    if (elapsedMs > durationMs) return null;
    if (point.interactionType && CLICK_INTERACTIONS.has(point.interactionType)) {
      return point;
    }
  }
  return null;
}

export function formatClickLabel(
  interactionType: CursorTelemetryPoint["interactionType"],
  labelMode: CursorClickEffectSettings["labelMode"],
) {
  if (labelMode === "generic") return "Click";
  switch (interactionType) {
    case "double-click":
      return "Double click";
    case "right-click":
      return "Right click";
    case "middle-click":
      return "Middle click";
    default:
      return "Click";
  }
}

export function renderCursorClickEffect(
  ctx: CanvasRenderingContext2D,
  options: {
    x: number;
    y: number;
    elapsedMs: number;
    settings?: CursorClickEffectSettings;
    interactionType?: CursorTelemetryPoint["interactionType"];
    scale?: number;
  },
) {
  const settings = options.settings ?? DEFAULT_CURSOR_CLICK_EFFECT;
  if (settings.id === "none") return;

  const durationMs = Math.max(120, settings.durationMs);
  const progress = clamp(options.elapsedMs / durationMs, 0, 1);
  const inverse = 1 - progress;
  const intensity = clamp(settings.intensity, 0, 1.5);
  const color = settings.color || DEFAULT_CURSOR_CLICK_EFFECT.color;
  const scale = options.scale ?? 1;
  const radius = (18 + progress * 46) * scale * (0.5 + intensity);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (settings.id === "spotlight") {
    const spotlightRadius = (72 + progress * 28) * scale * (0.75 + intensity);
    const gradient = ctx.createRadialGradient(
      options.x,
      options.y,
      0,
      options.x,
      options.y,
      spotlightRadius,
    );
    gradient.addColorStop(0, `${color}${getAlphaHex(0.18 * inverse)}`);
    gradient.addColorStop(0.45, `${color}${getAlphaHex(0.1 * inverse)}`);
    gradient.addColorStop(1, `${color}00`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(options.x, options.y, spotlightRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (settings.id === "label") {
    const label = formatClickLabel(options.interactionType, settings.labelMode);
    ctx.font = `${Math.round(13 * scale)}px Inter, system-ui, sans-serif`;
    const paddingX = 9 * scale;
    const paddingY = 5 * scale;
    const width = ctx.measureText(label).width + paddingX * 2;
    const height = 24 * scale;
    const x = options.x + 16 * scale;
    const y = options.y - height - 12 * scale;
    ctx.globalAlpha = inverse;
    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 999);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + paddingX, y + height - paddingY - 3 * scale);
    ctx.restore();
    return;
  }

  const alpha = inverse * (0.35 + intensity * 0.3);
  ctx.strokeStyle = `${color}${getAlphaHex(alpha)}`;
  ctx.lineWidth = Math.max(1.5, 3.5 * scale * (0.7 + intensity));

  if (settings.id === "ripple") {
    for (let index = 0; index < 3; index += 1) {
      const offset = index * 0.18;
      const localProgress = clamp((progress - offset) / (1 - offset), 0, 1);
      if (localProgress <= 0) continue;
      ctx.globalAlpha = 1 - localProgress;
      ctx.beginPath();
      ctx.arc(
        options.x,
        options.y,
        (14 + localProgress * 48) * scale * (0.75 + intensity),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (settings.id === "pulse") {
    ctx.fillStyle = `${color}${getAlphaHex(alpha * 0.55)}`;
    ctx.beginPath();
    ctx.arc(options.x, options.y, radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(options.x, options.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

