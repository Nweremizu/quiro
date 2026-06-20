/**
 * src/lib/ai/tools.ts — tool dispatcher (Sprint 1, S1-4).
 *
 * A registry of tool handlers. Each handler validates its args, executes via
 * EditorActions, and returns a structured ToolResult the agent narrates back.
 *
 * S1-4 implements: auto_zoom_on_clicks, remove_silences_and_fillers,
 * generate_captions, add_zoom, set_speed, add_annotation, query_recording.
 */
import type {
  AnnotationRegion,
  ClipRegion,
  SpeedRegion,
  ZoomRegion,
} from "@/types/editor";
import {
  DEFAULT_ANNOTATION_ANIMATION,
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
} from "@/types/editor";
import { buildInteractionZoomSuggestions } from "@/components/editor/timeline/zoomSuggestionUtils";
import {
  SILENCE_MIN_MS,
  type AiToolName,
  type AiToolUseBlock,
  type AddZoomInput,
  type AutoZoomOnClicksInput,
  type EditorActions,
  type GenerateCaptionsInput,
  type QueryRecordingInput,
  type RecordingBrain,
  type RemoveSilencesAndFillersInput,
  type SetSpeedInput,
  type TrimAggressiveness,
  type ToolResult,
} from "./contract";

/* ── Dispatch context (one per agent run) ─────────────────────────────────── */

export interface DispatchContext {
  brain: RecordingBrain;
  actions: EditorActions;
}

/* ── Silence thresholds by aggressiveness ─────────────────────────────────── */

const SILENCE_THRESHOLD: Record<TrimAggressiveness, number> = {
  light: 2000,        // only long pauses
  medium: 1000,       // medium pauses
  aggressive: SILENCE_MIN_MS, // everything the Brain tagged as silence
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTrimAggressiveness(value: unknown): value is TrimAggressiveness {
  return value === "light" || value === "medium" || value === "aggressive";
}

function normalizeZoomRange(rawArgs: unknown, totalMs: number): {
  startMs: number;
  endMs: number;
  depth: number;
  error?: string;
} {
  const args = rawArgs as Partial<AutoZoomOnClicksInput>;
  const startMs = Math.max(0, toNumber(args.startMs) ?? 0);
  const endMs = Math.min(totalMs, toNumber(args.endMs) ?? totalMs);
  if (endMs <= startMs) {
    return { startMs: 0, endMs: totalMs, depth: 2, error: "invalid-range" };
  }
  const depth = Math.min(6, Math.max(1, Math.round(toNumber(args.depth) ?? 2)));
  return { startMs, endMs, depth };
}

function formatRange(startMs: number, endMs: number) {
  return `${(startMs / 1000).toFixed(1)}s–${(endMs / 1000).toFixed(1)}s`;
}

/* ── Handlers ─────────────────────────────────────────────────────────────── */

async function autoZoomOnClicks(
  rawArgs: unknown,
  ctx: DispatchContext,
): Promise<ToolResult> {
  const args = rawArgs as AutoZoomOnClicksInput;
  const { brain, actions } = ctx;
  const telemetry = actions.getBrainInputs().cursorTelemetry;

  if (!brain.hasTelemetry || telemetry.length === 0) {
    return {
      ok: false,
      summary: "No click telemetry — was this recording imported? Zooms from clicks need native Quiro recording.",
      reason: "no-telemetry",
    };
  }

  const totalMs = brain.durationMs;
  const range = normalizeZoomRange(args, totalMs);
  if (range.error) {
    return {
      ok: false,
      summary: `Invalid zoom window ${formatRange(range.startMs, range.endMs)}. startMs must be less than endMs.`,
      reason: "invalid-arguments",
    };
  }

  const filtered = telemetry.filter((p) => p.timeMs >= range.startMs && p.timeMs <= range.endMs);

  const snapshot = actions.snapshot();
  const reservedSpans = snapshot.zoomRegions.map((r) => ({
    start: r.startMs,
    end: r.endMs,
  }));

  const result = buildInteractionZoomSuggestions({
    cursorTelemetry: filtered,
    totalMs: range.endMs - range.startMs,
    defaultDurationMs: 2000,
    reservedSpans,
  });

  if (result.status !== "ok" || result.suggestions.length === 0) {
    const msg: Record<string, string> = {
      "no-telemetry": "No clicks found in the specified range.",
      "no-interactions": "No distinct interaction candidates found.",
      "no-slots": "All slots are already reserved by existing zooms.",
    };
    return {
      ok: false,
      summary: msg[result.status] ?? "Could not generate zooms.",
      reason: result.status,
    };
  }

  const adjusted = result.suggestions.map((s) => ({
    ...s,
    start: s.start + range.startMs,
    end: s.end + range.startMs,
  }));

  actions.applyZoomSuggestions(adjusted, range.depth);
  return {
    ok: true,
    summary: `Added ${adjusted.length} zoom(s) on your clicks for ${formatRange(range.startMs, range.endMs)}.`,
    applied: { zoomRegionsAdded: adjusted.length },
  };
}

async function removeSilencesAndFillers(
  rawArgs: unknown,
  ctx: DispatchContext,
): Promise<ToolResult> {
  const args = rawArgs as RemoveSilencesAndFillersInput;
  const { brain, actions } = ctx;

  if (!brain.hasTranscript) {
    return {
      ok: false,
      summary: "No transcript — generate captions first so I can find the silences.",
      reason: "no-transcript",
    };
  }

  if (!isTrimAggressiveness(args.aggressiveness)) {
    return {
      ok: false,
      summary: "Invalid aggressiveness. Use light, medium, or aggressive.",
      reason: "invalid-arguments",
    };
  }

  const threshold = SILENCE_THRESHOLD[args.aggressiveness];
  const removeSpans: Array<{ start: number; end: number }> = [];

  for (const moment of brain.moments) {
    if (moment.kind === "silence" && moment.endMs - moment.startMs >= threshold) {
      removeSpans.push({ start: moment.startMs, end: moment.endMs });
    }
    if (Boolean(args.removeFillers) && moment.kind === "filler") {
      removeSpans.push({ start: moment.startMs, end: moment.endMs });
    }
  }

  if (removeSpans.length === 0) {
    return {
      ok: true,
      summary: "Nothing to remove at this aggressiveness level — the pacing already looks clean.",
      applied: { sectionsRemoved: 0, msTrimmed: 0 },
    };
  }

  removeSpans.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of removeSpans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const kept: ClipRegion[] = [];
  let cursor = 0;
  let idx = 0;
  for (const span of merged) {
    if (span.start > cursor) {
      kept.push({ id: `ai-trim-${idx++}`, startMs: cursor, endMs: span.start, speed: 1 });
    }
    cursor = span.end;
  }
  if (cursor < brain.durationMs) {
    kept.push({ id: `ai-trim-${idx++}`, startMs: cursor, endMs: brain.durationMs, speed: 1 });
  }

  const msTrimmed = merged.reduce((sum, s) => sum + (s.end - s.start), 0);
  actions.setKeptClips(kept);

  return {
    ok: true,
    summary: `Removed ${merged.length} section(s) (~${Math.round(msTrimmed / 1000)}s).${args.removeFillers ? " Filler words also cut." : ""}`,
    applied: { sectionsRemoved: merged.length, msTrimmed },
  };
}

function validateTimeRange(startMs: unknown, endMs: unknown, totalMs: number) {
  const start = Math.max(0, toNumber(startMs) ?? -1);
  const end = Math.min(totalMs, toNumber(endMs) ?? -1);
  if (start < 0 || end <= start || end > totalMs) {
    return null;
  }
  return { startMs: start, endMs: end };
}

function normalizeZoomRegion(rawArgs: unknown, totalMs: number): { region?: ZoomRegion; error?: string } {
  const args = rawArgs as AddZoomInput;
  const range = validateTimeRange(args.startMs, args.endMs, totalMs);
  if (!range) {
    return { error: "invalid-range" };
  }

  const focus = args.focus;
  if (
    !focus ||
    typeof focus.cx !== "number" ||
    typeof focus.cy !== "number" ||
    !Number.isFinite(focus.cx) ||
    !Number.isFinite(focus.cy) ||
    focus.cx < 0 ||
    focus.cx > 1 ||
    focus.cy < 0 ||
    focus.cy > 1
  ) {
    return { error: "invalid-focus" };
  }

  const depth = Math.min(6, Math.max(1, Math.round(toNumber(args.depth) ?? 2)));

  return {
    region: {
      id: `ai-zoom-${Date.now()}`,
      startMs: range.startMs,
      endMs: range.endMs,
      focus: { cx: focus.cx, cy: focus.cy },
      depth,
    },
  };
}

function normalizeSpeedRegion(rawArgs: unknown, totalMs: number): { region?: SpeedRegion; error?: string } {
  const args = rawArgs as SetSpeedInput;
  const range = validateTimeRange(args.startMs, args.endMs, totalMs);
  if (!range) {
    return { error: "invalid-range" };
  }

  const speed = Math.min(2, Math.max(0.25, toNumber(args.speed) ?? 1));
  return {
    region: {
      id: `ai-speed-${Date.now()}`,
      startMs: range.startMs,
      endMs: range.endMs,
      speed: speed as SpeedRegion["speed"],
    },
  };
}

function clampPercent(value: unknown) {
  const number = toNumber(value);
  if (number === null) return 50;
  return Math.min(100, Math.max(0, number));
}

function normalizeAnnotationRegion(
  rawArgs: unknown,
  totalMs: number,
): { region?: AnnotationRegion; error?: string } {
  const args = rawArgs as AddAnnotationInput;
  const range = validateTimeRange(args.startMs, args.endMs, totalMs);
  if (!range) {
    return { error: "invalid-range" };
  }

  if (!args.position || typeof args.position !== "object") {
    return { error: "invalid-position" };
  }

  const x = clampPercent((args.position as { x?: unknown }).x);
  const y = clampPercent((args.position as { y?: unknown }).y);
  const kind = args.kind === "arrow" ? "arrow" : "text";
  const contentText = typeof args.text === "string" && args.text.trim() ? args.text.trim() : kind === "text" ? "Annotation" : "Arrow annotation";

  const region: AnnotationRegion = {
    id: `ai-annotation-${Date.now()}`,
    startMs: range.startMs,
    endMs: range.endMs,
    type: kind === "arrow" ? "figure" : "text",
    content: contentText,
    textContent: contentText,
    position: { x, y },
    size: { ...DEFAULT_ANNOTATION_SIZE },
    style: { ...DEFAULT_ANNOTATION_STYLE },
    zIndex: 1,
    animation: { ...DEFAULT_ANNOTATION_ANIMATION },
    ...(kind === "arrow"
      ? {
          figureData: {
            arrowDirection: "right",
            color: "#f08030",
            strokeWidth: 4,
          },
        }
      : {}),
  };

  return { region };
}

async function generateCaptions(
  rawArgs: unknown,
  ctx: DispatchContext,
): Promise<ToolResult> {
  const args = rawArgs as GenerateCaptionsInput;
  const { actions } = ctx;
  const language = typeof args.language === "string" && args.language.trim() ? args.language : "auto";

  const result = await actions.generateCaptions(language);
  if (!result.ok) {
    return {
      ok: false,
      summary: result.message,
      reason: result.reason ?? "generate-captions-failed",
    };
  }

  const cues = result.cues ?? [];
  actions.applyCaptions(cues, { enable: true, language });

  return {
    ok: true,
    summary: cues.length > 0
      ? `Generated ${cues.length} captions and enabled the caption overlay.`
      : "Generated captions but found no speech to transcribe.",
    applied: { captionCuesAdded: cues.length },
  };
}

function addZoom(
  rawArgs: unknown,
  ctx: DispatchContext,
): ToolResult {
  const args = rawArgs as AddZoomInput;
  const { brain, actions } = ctx;
  const result = normalizeZoomRegion(args, brain.durationMs);
  if (!result.region) {
    return {
      ok: false,
      summary: "Invalid zoom arguments. Provide a valid time range and focus coordinates between 0 and 1.",
      reason: result.error ?? "invalid-arguments",
    };
  }

  actions.addZoomRegion(result.region);
  return {
    ok: true,
    summary: `Added a zoom from ${formatRange(result.region.startMs, result.region.endMs)}.`,
    applied: { zoomRegionsAdded: 1 },
  };
}

function setSpeed(
  rawArgs: unknown,
  ctx: DispatchContext,
): ToolResult {
  const args = rawArgs as SetSpeedInput;
  const { brain, actions } = ctx;
  const result = normalizeSpeedRegion(args, brain.durationMs);
  if (!result.region) {
    return {
      ok: false,
      summary: "Invalid speed arguments. Provide a valid time range and speed between 0.25 and 2.",
      reason: result.error ?? "invalid-arguments",
    };
  }

  actions.setSpeedRegion(result.region);
  return {
    ok: true,
    summary: `Set playback speed to ${result.region.speed}× for ${formatRange(result.region.startMs, result.region.endMs)}.`,
    applied: { speedRegionsAdded: 1 },
  };
}

function addAnnotation(
  rawArgs: unknown,
  ctx: DispatchContext,
): ToolResult {
  const args = rawArgs as AddAnnotationInput;
  const { brain, actions } = ctx;
  const result = normalizeAnnotationRegion(args, brain.durationMs);
  if (!result.region) {
    return {
      ok: false,
      summary: "Invalid annotation arguments. Provide a valid time range and a position between 0 and 100.",
      reason: result.error ?? "invalid-arguments",
    };
  }

  actions.addAnnotation(result.region);
  return {
    ok: true,
    summary: `Added an annotation from ${formatRange(result.region.startMs, result.region.endMs)}.`,
    applied: { annotationsAdded: 1 },
  };
}

function queryRecording(
  rawArgs: unknown,
  ctx: DispatchContext,
): ToolResult {
  const args = rawArgs as QueryRecordingInput;
  const { brain } = ctx;

  const lines: string[] = [`Recording: ${Math.round(brain.durationMs / 1000)}s`];

  if (brain.hasTranscript) {
    const speech = brain.moments
      .filter((m) => m.kind === "speech")
      .map((m) => m.text ?? "")
      .filter(Boolean)
      .join(" ");
    if (speech) lines.push(`Transcript: ${speech}`);
  } else {
    lines.push("No transcript available.");
  }

  if (brain.hasTelemetry) {
    const clicks = brain.moments.filter((m) => m.kind === "click");
    if (clicks.length > 0) {
      lines.push(
        `Clicks at: ${clicks.map((m) => `${(m.startMs / 1000).toFixed(1)}s`).join(", ")}`,
      );
    }
  }

  const silences = brain.moments.filter((m) => m.kind === "silence");
  if (silences.length > 0) {
    lines.push(`Silences: ${silences.length} (total ${Math.round(silences.reduce((s, m) => s + m.endMs - m.startMs, 0) / 1000)}s)`);
  }

  return {
    ok: true,
    summary: `[Question: "${args.question}"]\n${lines.join("\n")}`,
  };
}

function notImplemented(name: string): ToolResult {
  return {
    ok: false,
    summary: `"${name}" is a stretch tool — coming in Sprint 2. Try "zoom into my clicks" or "cut the dead air" instead.`,
    reason: "not-implemented",
  };
}

/* ── Dispatch ─────────────────────────────────────────────────────────────── */

export async function dispatchToolCall(
  block: AiToolUseBlock,
  ctx: DispatchContext,
): Promise<ToolResult> {
  const name = block.name as AiToolName;
  switch (name) {
    case "auto_zoom_on_clicks":
      return await autoZoomOnClicks(block.input, ctx);
    case "remove_silences_and_fillers":
      return await removeSilencesAndFillers(block.input, ctx);
    case "generate_captions":
      return await generateCaptions(block.input, ctx);
    case "query_recording":
      return queryRecording(block.input, ctx);
    case "add_zoom":
      return addZoom(block.input, ctx);
    case "set_speed":
      return setSpeed(block.input, ctx);
    case "add_annotation":
      return addAnnotation(block.input, ctx);
    default:
      return { ok: false, summary: `Unknown tool: ${name}`, reason: "unknown-tool" };
  }
}
