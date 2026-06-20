/**
 * src/lib/ai/tools.ts — tool dispatcher (Sprint 1, S1-4).
 *
 * A registry of tool handlers. Each handler validates its args, executes via
 * EditorActions, and returns a structured ToolResult the agent narrates back.
 *
 * S1-4 implements: auto_zoom_on_clicks, remove_silences_and_fillers,
 * query_recording. generate_captions / stretch tools are stubbed cleanly.
 */
import type { ClipRegion } from "@/types/editor";
import { buildInteractionZoomSuggestions } from "@/components/editor/timeline/zoomSuggestionUtils";
import {
  SILENCE_MIN_MS,
  type AiToolName,
  type AiToolUseBlock,
  type AutoZoomOnClicksInput,
  type EditorActions,
  type GenerateCaptionsInput,
  type QueryRecordingInput,
  type RecordingBrain,
  type RemoveSilencesAndFillersInput,
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

/* ── Handlers ─────────────────────────────────────────────────────────────── */

function autoZoomOnClicks(
  rawArgs: unknown,
  ctx: DispatchContext,
): ToolResult {
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
  const startMs = typeof args.startMs === "number" ? Math.max(0, args.startMs) : 0;
  const endMs = typeof args.endMs === "number" ? Math.min(totalMs, args.endMs) : totalMs;

  const filtered =
    startMs > 0 || endMs < totalMs
      ? telemetry.filter((p) => p.timeMs >= startMs && p.timeMs <= endMs)
      : telemetry;

  const snapshot = actions.snapshot();
  const reservedSpans = snapshot.zoomRegions.map((r) => ({
    start: r.startMs,
    end: r.endMs,
  }));

  const result = buildInteractionZoomSuggestions({
    cursorTelemetry: filtered,
    totalMs: endMs > startMs ? endMs - startMs : totalMs,
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

  // Offset suggestions back to source-ms if we filtered a sub-range
  const offset = startMs > 0 ? startMs : 0;
  const adjusted = result.suggestions.map((s) => ({
    ...s,
    start: s.start + offset,
    end: s.end + offset,
  }));

  actions.applyZoomSuggestions(adjusted, args.depth ?? 2);
  return {
    ok: true,
    summary: `Added ${adjusted.length} zoom(s) on your clicks.`,
    applied: { zoomRegionsAdded: adjusted.length },
  };
}

function removeSilencesAndFillers(
  rawArgs: unknown,
  ctx: DispatchContext,
): ToolResult {
  const args = rawArgs as RemoveSilencesAndFillersInput;
  const { brain, actions } = ctx;

  if (!brain.hasTranscript) {
    return {
      ok: false,
      summary: "No transcript — generate captions first so I can find the silences.",
      reason: "no-transcript",
    };
  }

  const threshold = SILENCE_THRESHOLD[args.aggressiveness];
  const removeSpans: Array<{ start: number; end: number }> = [];

  for (const moment of brain.moments) {
    if (moment.kind === "silence" && moment.endMs - moment.startMs >= threshold) {
      removeSpans.push({ start: moment.startMs, end: moment.endMs });
    }
    if (args.removeFillers && moment.kind === "filler") {
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

  // Merge overlapping spans
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

  // Compute kept clips (inverse of removed spans)
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

function generateCaptions(
  rawArgs: unknown,
  // ctx not needed: generation requires the main-process whisper pipeline (S2-1).
): ToolResult {
  const args = rawArgs as GenerateCaptionsInput;
  // Caption generation requires the Whisper model download and a separate IPC
  // flow. Wire this up in S2-1 when the full caption pipeline integrates.
  // For now, guide the user to the existing captions button.
  return {
    ok: false,
    summary:
      `Caption generation (${args.language ?? "auto"}) is not yet wired to the AI tool. ` +
      "Click the Captions button in the editor toolbar, wait for it to finish, then ask me to refine them.",
    reason: "not-implemented",
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

export function dispatchToolCall(
  block: AiToolUseBlock,
  ctx: DispatchContext,
): ToolResult {
  const name = block.name as AiToolName;
  switch (name) {
    case "auto_zoom_on_clicks":
      return autoZoomOnClicks(block.input, ctx);
    case "remove_silences_and_fillers":
      return removeSilencesAndFillers(block.input, ctx);
    case "generate_captions":
      return generateCaptions(block.input);
    case "query_recording":
      return queryRecording(block.input, ctx);
    case "add_zoom":
    case "set_speed":
    case "add_annotation":
      return notImplemented(name);
    default:
      return { ok: false, summary: `Unknown tool: ${name}`, reason: "unknown-tool" };
  }
}
