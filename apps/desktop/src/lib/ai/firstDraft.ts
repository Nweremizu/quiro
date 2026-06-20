import { buildBrain } from "./brain";
import { buildInteractionZoomSuggestions } from "@/components/editor/timeline/zoomSuggestionUtils";
import type {
  BrainInputs,
  EditorActions,
  RecordingBrain,
  TrimAggressiveness,
  ZoomDepth,
} from "./contract";
import type { ClipRegion, CursorTelemetryPoint } from "@/types/editor";

const DEFAULT_FIRST_DRAFT_ZOOM_DEPTH: ZoomDepth = 2;
const DEFAULT_FIRST_DRAFT_TRIM_AGGRESSIVENESS: TrimAggressiveness = "medium";

function buildKeptClips(
  brain: RecordingBrain,
  aggressiveness: TrimAggressiveness,
  removeFillers: boolean,
): { clips: ClipRegion[]; sectionsRemoved: number; msTrimmed: number } {
  const threshold =
    aggressiveness === "light"
      ? 2000
      : aggressiveness === "medium"
      ? 1000
      : 400;

  const removeSpans: Array<{ start: number; end: number }> = [];
  for (const moment of brain.moments) {
    if (moment.kind === "silence" && moment.endMs - moment.startMs >= threshold) {
      removeSpans.push({ start: moment.startMs, end: moment.endMs });
    }
    if (removeFillers && moment.kind === "filler") {
      removeSpans.push({ start: moment.startMs, end: moment.endMs });
    }
  }

  if (removeSpans.length === 0) {
    return { clips: [], sectionsRemoved: 0, msTrimmed: 0 };
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

  const clips: ClipRegion[] = [];
  let cursor = 0;
  let sectionIndex = 0;
  for (const span of merged) {
    if (span.start > cursor) {
      clips.push({
        id: `ai-draft-${sectionIndex++}`,
        startMs: cursor,
        endMs: span.start,
        speed: 1,
      });
    }
    cursor = span.end;
  }
  if (cursor < brain.durationMs) {
    clips.push({
      id: `ai-draft-${sectionIndex++}`,
      startMs: cursor,
      endMs: brain.durationMs,
      speed: 1,
    });
  }

  const msTrimmed = merged.reduce((sum, span) => sum + (span.end - span.start), 0);
  return { clips, sectionsRemoved: merged.length, msTrimmed };
}

function extractClickTelemetry(
  brain: RecordingBrain,
): CursorTelemetryPoint[] {
  return brain.moments
    .filter((moment) => moment.kind === "click" && moment.focus)
    .map((click) => ({
      timeMs: click.startMs,
      cx: click.focus!.cx,
      cy: click.focus!.cy,
      interactionType: "click",
    }));
}

interface FirstDraftOptions {
  zoomDepth?: ZoomDepth;
  trimAggressiveness?: TrimAggressiveness;
  removeFillers?: boolean;
}

export interface FirstDraftResult {
  ok: boolean;
  summary: string;
  applied?: {
    zoomRegionsAdded: number;
    sectionsRemoved: number;
    msTrimmed: number;
    captionsGenerated?: boolean;
  };
  reason?: string;
}

export async function runFirstDraft(
  actions: EditorActions,
  options: FirstDraftOptions = {},
): Promise<FirstDraftResult> {
  const { zoomDepth = DEFAULT_FIRST_DRAFT_ZOOM_DEPTH, trimAggressiveness = DEFAULT_FIRST_DRAFT_TRIM_AGGRESSIVENESS, removeFillers = true } = options;

  const inputs: BrainInputs = { ...actions.getBrainInputs() };
  if (!inputs.sourcePath) {
    return { ok: false, summary: "No source video is loaded.", reason: "no-source" };
  }

  let captionsGenerated = false;
  if (actions.snapshot().hasTranscript === false) {
    const captionResult = await actions.generateCaptions("auto");
    if (!captionResult.ok) {
      return {
        ok: false,
        summary:
          captionResult.message ||
          "Unable to generate captions for the first draft.",
        reason: captionResult.reason,
      };
    }
    captionsGenerated = true;
    if (captionResult.cues) {
      inputs.transcript = captionResult.cues;
    }
  }

  const brain = buildBrain(inputs);
  if (brain.durationMs <= 0) {
    return { ok: false, summary: "Unable to build a draft from an empty recording.", reason: "empty-recording" };
  }

  if (brain.hasTranscript) {
    actions.applyCaptions(brain.transcript, { enable: true });
  }

  let zoomRegionsAdded = 0;
  if (brain.hasTelemetry) {
    const cursorTelemetry = extractClickTelemetry(brain);
    const snapshot = actions.snapshot();
    const reservedSpans = snapshot.zoomRegions.map((region) => ({
      start: region.startMs,
      end: region.endMs,
    }));
    const suggestions = buildInteractionZoomSuggestions({
      cursorTelemetry,
      totalMs: brain.durationMs,
      defaultDurationMs: 2200,
      reservedSpans,
    });
    if (suggestions.status === "ok" && suggestions.suggestions.length > 0) {
      const adjusted = suggestions.suggestions.map((suggestion) => ({
        ...suggestion,
        start: suggestion.start,
        end: suggestion.end,
      }));
      actions.applyZoomSuggestions(adjusted, zoomDepth);
      zoomRegionsAdded = adjusted.length;
    }
  }

  let sectionsRemoved = 0;
  let msTrimmed = 0;
  if (brain.hasTranscript) {
    const trimResult = buildKeptClips(brain, trimAggressiveness, removeFillers);
    if (trimResult.sectionsRemoved > 0) {
      actions.setKeptClips(trimResult.clips);
      sectionsRemoved = trimResult.sectionsRemoved;
      msTrimmed = trimResult.msTrimmed;
    }
  }

  const pieces: string[] = [];
  if (captionsGenerated) {
    pieces.push("Generated captions");
  }
  if (zoomRegionsAdded > 0) {
    pieces.push(`Added ${zoomRegionsAdded} zoom${zoomRegionsAdded === 1 ? "" : "s"}`);
  }
  if (sectionsRemoved > 0) {
    pieces.push(`Trimmed ${sectionsRemoved} section${sectionsRemoved === 1 ? "" : "s"}`);
  }

  if (pieces.length === 0) {
    return {
      ok: true,
      summary: "Nothing to change — the recording already looks polished.",
      applied: {
        zoomRegionsAdded: 0,
        sectionsRemoved: 0,
        msTrimmed: 0,
        captionsGenerated,
      },
    };
  }

  const summary = pieces.join(" and ") + ".";
  return {
    ok: true,
    summary,
    applied: {
      zoomRegionsAdded,
      sectionsRemoved,
      msTrimmed,
      captionsGenerated,
    },
  };
}
