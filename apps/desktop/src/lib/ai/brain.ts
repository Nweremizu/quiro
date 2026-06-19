/**
 * src/lib/ai/brain.ts — the "Recording Brain" (Sprint 1, S1-1).
 *
 * Pure fusion of the two signals we already capture — the transcript
 * (`CaptionCue[]` from generate-auto-captions) and the cursor/interaction
 * stream (`CursorTelemetryPoint[]`) — into a `RecordingBrain`: a sorted list of
 * tagged `Moment`s. Every AI feature is a query over these moments.
 *
 * No model, no IPC, no React — just data in, data out. See spec §4 / §5.1.
 * All times are source-media ms (decision D2).
 *
 * Vision-derived `scene` moments are intentionally out of scope here (stretch).
 */
import {
  AI_CONTRACT_VERSION,
  FILLER_WORDS,
  IDLE_MIN_MS,
  SILENCE_MIN_MS,
  type BrainInputs,
  type BrainSummary,
  type Moment,
  type MomentKind,
  type RecordingBrain,
} from "./contract";
import type { CaptionCue } from "@/types/editor";

const EXPLICIT_CLICK_TYPES: ReadonlySet<string> = new Set([
  "click",
  "double-click",
  "right-click",
  "middle-click",
]);

const FILLER_SET: ReadonlySet<string> = new Set(
  FILLER_WORDS.map((word) => word.toLowerCase()),
);

interface Interval {
  start: number;
  end: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Strip punctuation/spacing so "Um," matches the filler "um". */
function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^a-z']/g, "");
}

/** Gaps in [0, durationMs] not covered by the (merged) speech intervals. */
function speechGaps(cues: CaptionCue[], durationMs: number): Interval[] {
  const merged: Interval[] = [];
  for (const cue of cues) {
    const start = clamp(cue.startMs, 0, durationMs);
    const end = clamp(cue.endMs, 0, durationMs);
    if (end <= start) continue;
    const last = merged[merged.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      merged.push({ start, end });
    }
  }

  const gaps: Interval[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < durationMs) gaps.push({ start: cursor, end: durationMs });
  return gaps;
}

/**
 * Build the Recording Brain. Degrades gracefully:
 *  - no transcript → no speech/silence/filler/idle moments (`hasTranscript:false`)
 *  - no telemetry  → no click moments (`hasTelemetry:false`)
 */
export function buildBrain(inputs: BrainInputs): RecordingBrain {
  const transcript = inputs.transcript ?? [];
  const telemetry = inputs.cursorTelemetry ?? [];
  const hasTranscript = transcript.length > 0;
  const hasTelemetry = telemetry.length > 0;

  let durationMs = Math.max(0, Math.round(inputs.durationMs || 0));
  if (durationMs === 0) {
    const lastCue = transcript.reduce((max, cue) => Math.max(max, cue.endMs || 0), 0);
    const lastClick = telemetry.reduce((max, p) => Math.max(max, p.timeMs || 0), 0);
    durationMs = Math.max(lastCue, lastClick);
  }

  let seq = 0;
  const add = (moment: Omit<Moment, "id">): Moment => ({
    id: `m${seq++}`,
    ...moment,
  });
  const moments: Moment[] = [];

  const cues = [...transcript]
    .filter(
      (cue) =>
        Number.isFinite(cue.startMs) &&
        Number.isFinite(cue.endMs) &&
        cue.endMs > cue.startMs,
    )
    .sort((a, b) => a.startMs - b.startMs);

  const clicks = telemetry
    .filter(
      (point) =>
        typeof point.interactionType === "string" &&
        EXPLICIT_CLICK_TYPES.has(point.interactionType),
    )
    .map((point) => ({
      timeMs: durationMs > 0
        ? clamp(Math.round(point.timeMs), 0, durationMs)
        : Math.max(0, Math.round(point.timeMs)),
      cx: clamp(point.cx, 0, 1),
      cy: clamp(point.cy, 0, 1),
    }))
    .sort((a, b) => a.timeMs - b.timeMs);

  // Speech + filler
  for (const cue of cues) {
    moments.push(add({ kind: "speech", startMs: cue.startMs, endMs: cue.endMs, text: cue.text }));
    for (const word of cue.words ?? []) {
      if (FILLER_SET.has(normalizeWord(word.text))) {
        moments.push(
          add({ kind: "filler", startMs: word.startMs, endMs: word.endMs, text: word.text }),
        );
      }
    }
  }

  // Silence + idle (derived from speech gaps; idle additionally requires no click)
  if (cues.length > 0 && durationMs > 0) {
    for (const gap of speechGaps(cues, durationMs)) {
      const length = gap.end - gap.start;
      if (length >= SILENCE_MIN_MS) {
        moments.push(add({ kind: "silence", startMs: gap.start, endMs: gap.end }));
      }
      const hasClickInside = clicks.some(
        (click) => click.timeMs > gap.start && click.timeMs < gap.end,
      );
      if (length >= IDLE_MIN_MS && !hasClickInside) {
        moments.push(add({ kind: "idle", startMs: gap.start, endMs: gap.end }));
      }
    }
  }

  // Clicks
  for (const click of clicks) {
    moments.push(
      add({
        kind: "click",
        startMs: click.timeMs,
        endMs: click.timeMs,
        focus: { cx: click.cx, cy: click.cy },
      }),
    );
  }

  moments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  return {
    version: AI_CONTRACT_VERSION,
    sourcePath: inputs.sourcePath,
    durationMs,
    moments,
    transcript,
    hasTelemetry,
    hasTranscript,
  };
}

/* ── Summary for the model (compact; not the whole Brain) ────────────────── */

function totalMs(moments: Moment[]): number {
  return moments.reduce((sum, m) => sum + Math.max(0, m.endMs - m.startMs), 0);
}

function formatMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

function describe(summary: BrainSummary): string {
  const parts: string[] = [];
  if (summary.hasTranscript) {
    parts.push(`${summary.speechCount} spoken segment(s)`);
    if (summary.silenceCount) {
      parts.push(`${summary.silenceCount} silence(s) (${formatMs(summary.silenceTotalMs)})`);
    }
    if (summary.fillerCount) parts.push(`${summary.fillerCount} filler word(s)`);
    if (summary.idleCount) {
      parts.push(`${summary.idleCount} idle stretch(es) (${formatMs(summary.idleTotalMs)})`);
    }
  } else {
    parts.push("no transcript");
  }
  parts.push(summary.hasTelemetry ? `${summary.clickCount} click(s)` : "no click telemetry");
  return `${formatMs(summary.durationMs)} recording — ${parts.join(", ")}.`;
}

/** Compact, model-facing summary of a Brain (counts + one paragraph). */
export function summarizeBrain(brain: RecordingBrain): BrainSummary {
  const of = (kind: MomentKind) => brain.moments.filter((m) => m.kind === kind);
  const silence = of("silence");
  const idle = of("idle");

  const summary: BrainSummary = {
    durationMs: brain.durationMs,
    clickCount: of("click").length,
    silenceCount: silence.length,
    silenceTotalMs: totalMs(silence),
    fillerCount: of("filler").length,
    idleCount: idle.length,
    idleTotalMs: totalMs(idle),
    speechCount: of("speech").length,
    hasTelemetry: brain.hasTelemetry,
    hasTranscript: brain.hasTranscript,
    text: "",
  };
  summary.text = describe(summary);
  return summary;
}
