/**
 * Quiro AI — shared contract (Sprint 0, task S0-1).
 *
 * This is the SINGLE SOURCE OF TRUTH shared by:
 *   • Person A ("The Brain")    — Recording Brain + main-process Claude client
 *   • Person B ("The Director") — chat UI + agent loop + tool dispatcher
 *
 * Nothing parallelizes until this file is agreed. If you need to change a type
 * here, say so in docs/ai-team-log.md first — the other half depends on it.
 *
 * Spec: docs/ai-implementation-spec.md §3.   Tasks: docs/ai-sprint-plan.md.
 *
 * Design note (IPC boundary): the renderer↔main protocol below uses plain,
 * structured-clone-serializable types (not `@anthropic-ai/sdk` types). The
 * main process (S0-2) owns the SDK and maps these wire types ↔ SDK types
 * (`Anthropic.MessageParam`, `Anthropic.Tool`, …). This keeps the renderer
 * free of the SDK and the IPC contract explicit. See ai-team-log decision D1.
 */

import type {
  AnnotationRegion,
  CaptionCue,
  ClipRegion,
  CursorTelemetryPoint,
  SpeedRegion,
  ZoomDepth,
  ZoomFocus,
  ZoomRegion,
} from "@/types/editor";
import type { SuggestedZoomRegion } from "@/components/editor/timeline/zoomSuggestionUtils";

export const AI_CONTRACT_VERSION = 1 as const;

/* ════════════════════════════════════════════════════════════════════════
 * 1. RECORDING BRAIN   (owner: A — src/lib/ai/brain.ts)
 * ════════════════════════════════════════════════════════════════════════ */

/** A tagged span of the recording. Every AI feature is a query over these. */
export type MomentKind =
  | "speech" // a spoken phrase/sentence
  | "silence" // gap with no speech (candidate to cut)
  | "filler" // "um", "uh", "like", … (candidate to cut)
  | "click" // explicit interaction (from cursor telemetry)
  | "idle" // no speech AND no interaction (candidate to speed up)
  | "scene"; // vision-derived scene label (stretch only)

export interface Moment {
  id: string;
  kind: MomentKind;
  /** Source-media time. See timebase note on RecordingBrain. */
  startMs: number;
  endMs: number;
  /** Transcript text for `speech` / `filler`. */
  text?: string;
  /** Normalized focus point for `click` moments. */
  focus?: ZoomFocus;
  /** Scene label for `scene` moments. */
  label?: string;
  /** 0..1 — how confident detection is (optional). */
  confidence?: number;
}

/** Raw inputs the Brain builder fuses. All already available in window.tsx. */
export interface BrainInputs {
  sourcePath: string;
  durationMs: number;
  /** From the `generate-auto-captions` IPC → CaptionCue[]. Empty if none. */
  transcript: CaptionCue[];
  /** From window.tsx `cursorTelemetry` state. Empty for imported videos. */
  cursorTelemetry: CursorTelemetryPoint[];
}

/**
 * The fused understanding of one recording.
 *
 * TIMEBASE: every `*Ms` is **source-media** time (matches transcript +
 * telemetry). When applying edits that interact with existing clips, convert
 * with mapTimelineTimeToSourceTime / mapSourceTimeToTimelineTime (editor.ts).
 */
export interface RecordingBrain {
  version: typeof AI_CONTRACT_VERSION;
  sourcePath: string;
  durationMs: number;
  /** Sorted by startMs. */
  moments: Moment[];
  /** Raw transcript, reused as-is for captions. */
  transcript: CaptionCue[];
  hasTelemetry: boolean;
  hasTranscript: boolean;
}

/**
 * Compact form sent to the model as context (NOT the whole Brain — keeps
 * tokens bounded on long recordings). `text` is the one-paragraph version the
 * planner reads.
 */
export interface BrainSummary {
  durationMs: number;
  clickCount: number;
  silenceCount: number;
  silenceTotalMs: number;
  fillerCount: number;
  idleCount: number;
  idleTotalMs: number;
  speechCount: number;
  hasTelemetry: boolean;
  hasTranscript: boolean;
  /** Human-readable summary fed to the model in the system prompt. */
  text: string;
}

/* ════════════════════════════════════════════════════════════════════════
 * 2. EDITOR BOUNDARY   (owner: B — exposed from window.tsx)
 *
 * The ONLY door between the agent and the editor's internals. Must be a
 * referentially-stable, memoized object (see CLAUDE.md memo discipline).
 * ════════════════════════════════════════════════════════════════════════ */

/** Read-only snapshot the agent reads at the start of a run for context. */
export interface EditorStateForAI {
  durationMs: number;
  zoomRegions: ZoomRegion[];
  clipRegions: ClipRegion[];
  speedRegions: SpeedRegion[];
  annotationCount: number;
  captionsEnabled: boolean;
  captionCueCount: number;
  hasTelemetry: boolean;
  hasTranscript: boolean;
}

export interface EditorActions {
  /** Current editor state for the agent's context. */
  snapshot(): EditorStateForAI;

  /** Raw inputs for buildBrain() — refreshed every render via a ref. */
  getBrainInputs(): BrainInputs;

  /** Apply zoom windows produced by buildInteractionZoomSuggestions(). */
  applyZoomSuggestions(suggestions: SuggestedZoomRegion[], depth?: ZoomDepth): void;
  /** Add one explicit zoom (the `add_zoom` tool). */
  addZoomRegion(region: ZoomRegion): void;

  /** Set the kept segments; trims are derived via clipsToTrims(). */
  setKeptClips(clips: ClipRegion[]): void;

  /** Apply transcript cues as captions and (optionally) enable the overlay. */
  applyCaptions(cues: CaptionCue[], opts?: { enable?: boolean; language?: string }): void;

  addAnnotation(region: AnnotationRegion): void;
  setSpeedRegion(region: SpeedRegion): void;

  /** Wrap a whole agent run as ONE undo step. */
  beginAiBatch(label?: string): void;
  endAiBatch(): void;
}

/* ════════════════════════════════════════════════════════════════════════
 * 3. TOOLS   (schemas owner: A · dispatcher owner: B)
 * ════════════════════════════════════════════════════════════════════════ */

export type AiToolName =
  | "auto_zoom_on_clicks"
  | "remove_silences_and_fillers"
  | "generate_captions"
  | "add_zoom"
  | "set_speed"
  | "add_annotation"
  | "query_recording";

export type TrimAggressiveness = "light" | "medium" | "aggressive";

export interface AutoZoomOnClicksInput {
  startMs?: number;
  endMs?: number;
  /** 1 (subtle) … 6 (extreme). Default 2. */
  depth?: ZoomDepth;
}
export interface RemoveSilencesAndFillersInput {
  aggressiveness: TrimAggressiveness;
  removeFillers: boolean;
}
export interface GenerateCaptionsInput {
  /** BCP-47 or "auto". */
  language?: string;
}
export interface AddZoomInput {
  startMs: number;
  endMs: number;
  focus: ZoomFocus;
  depth: ZoomDepth;
}
export interface SetSpeedInput {
  startMs: number;
  endMs: number;
  /** Playback multiplier, e.g. 2 = 2× faster. */
  speed: number;
}
export interface AddAnnotationInput {
  startMs: number;
  endMs: number;
  kind: "text" | "arrow";
  text?: string;
  /** Percentage position on the 1920×1080 base canvas (0..100). */
  position: { x: number; y: number };
}
export interface QueryRecordingInput {
  question: string;
}

/** Maps a tool name to its parsed input — handy for the dispatcher's typing. */
export interface AiToolInputMap {
  auto_zoom_on_clicks: AutoZoomOnClicksInput;
  remove_silences_and_fillers: RemoveSilencesAndFillersInput;
  generate_captions: GenerateCaptionsInput;
  add_zoom: AddZoomInput;
  set_speed: SetSpeedInput;
  add_annotation: AddAnnotationInput;
  query_recording: QueryRecordingInput;
}

/** What a dispatcher returns to the agent as the tool_result. */
export interface ToolResult {
  ok: boolean;
  /** One line the agent narrates to the user. */
  summary: string;
  /** Quantified effect, e.g. { zoomRegionsAdded: 4, msTrimmed: 9200 }. */
  applied?: Record<string, number>;
  /** Machine reason on failure, e.g. "no-telemetry", "out-of-range". */
  reason?: string;
}

interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface AiToolDefinition {
  name: AiToolName;
  /** The description IS the API — it's how the model decides to call the tool. */
  description: string;
  input_schema: JsonSchema;
}

/** The tool list passed to the model. Stretch tools are commented per spec §3.2. */
export const AI_TOOLS: AiToolDefinition[] = [
  {
    name: "auto_zoom_on_clicks",
    description:
      "Add smooth zoom-ins on the things the user clicked during the recording. " +
      "Use this whenever the user wants to emphasize their interactions, draw " +
      "attention to buttons/UI, or 'zoom into what I did'. Clusters nearby clicks " +
      "into single zooms and skips spans that already have a zoom. No-ops cleanly " +
      "if there is no click telemetry (imported video).",
    input_schema: {
      type: "object",
      properties: {
        startMs: { type: "number", description: "Optional window start (source ms)." },
        endMs: { type: "number", description: "Optional window end (source ms)." },
        depth: { type: "integer", minimum: 1, maximum: 6, description: "Zoom strength, default 2." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "remove_silences_and_fillers",
    description:
      "Tighten the pacing by cutting dead air (long pauses with no speech) and, " +
      "optionally, filler words like 'um' and 'uh'. Use for 'make it punchy', " +
      "'cut the dead air', 'remove my ums', 'tighten it up'. 'light' trims only " +
      "long pauses; 'aggressive' trims most pauses.",
    input_schema: {
      type: "object",
      properties: {
        aggressiveness: { type: "string", enum: ["light", "medium", "aggressive"] },
        removeFillers: { type: "boolean", description: "Also cut filler words." },
      },
      required: ["aggressiveness", "removeFillers"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_captions",
    description:
      "Transcribe the audio and turn on burned-in captions. Use for 'add captions', " +
      "'add subtitles', 'caption this'. If the speech model is not downloaded yet, " +
      "this returns a failure asking the user to download it.",
    input_schema: {
      type: "object",
      properties: {
        language: { type: "string", description: "BCP-47 code or 'auto'. Default 'auto'." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "add_zoom",
    description:
      "Add ONE explicit zoom over a specific time range and focus point. Use when " +
      "the user names a moment ('zoom into the pricing page at 0:40') rather than " +
      "all clicks. Times are source ms; focus is normalized 0..1.",
    input_schema: {
      type: "object",
      properties: {
        startMs: { type: "number" },
        endMs: { type: "number" },
        focus: {
          type: "object",
          properties: { cx: { type: "number" }, cy: { type: "number" } },
          required: ["cx", "cy"],
        },
        depth: { type: "integer", minimum: 1, maximum: 6 },
      },
      required: ["startMs", "endMs", "focus", "depth"],
      additionalProperties: false,
    },
  },
  {
    name: "set_speed",
    description:
      "Speed up (or slow down) a time range — e.g. fast-forward a boring install " +
      "or loading stretch. Times are source ms; speed is a multiplier (2 = 2×).",
    input_schema: {
      type: "object",
      properties: {
        startMs: { type: "number" },
        endMs: { type: "number" },
        speed: { type: "number", minimum: 0.25, maximum: 8 },
      },
      required: ["startMs", "endMs", "speed"],
      additionalProperties: false,
    },
  },
  {
    name: "add_annotation",
    description:
      "Add a text label or an arrow over a time range to call out something on " +
      "screen. position is a percentage (0..100) on the 1920×1080 base canvas.",
    input_schema: {
      type: "object",
      properties: {
        startMs: { type: "number" },
        endMs: { type: "number" },
        kind: { type: "string", enum: ["text", "arrow"] },
        text: { type: "string" },
        position: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
        },
      },
      required: ["startMs", "endMs", "kind", "position"],
      additionalProperties: false,
    },
  },
  {
    name: "query_recording",
    description:
      "Answer a question about what happened in the recording (what was said, " +
      "what was clicked, when). READ-ONLY — makes no edit. Use for 'what did I " +
      "demo at 2:30?'.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
      additionalProperties: false,
    },
  },
];

/* ════════════════════════════════════════════════════════════════════════
 * 4. IPC PROTOCOL   (renderer ↔ main; owner: A)
 *
 * Plain serializable wire types. Main maps these to/from the Anthropic SDK.
 * ════════════════════════════════════════════════════════════════════════ */

/** Which backend serves a model. Routed in the main process by model id. */
export type AiProvider = "anthropic" | "minimax";

export type AiModelId =
  // Anthropic
  | "claude-opus-4-8" // planner / agent
  | "claude-haiku-4-5" // bulk classification + vision
  | "claude-sonnet-4-6" // mid-tier alternative
  // MiniMax (selectable alternative — D5). Ids starting "MiniMax"/"abab" route to MiniMax.
  | "MiniMax-M3" // newest flagship
  | "MiniMax-M2.5" // coding / reasoning tuned
  | (string & Record<never, never>);

export const AI_MODELS = {
  planner: "claude-opus-4-8",
  classifier: "claude-haiku-4-5",
  /** Selectable MiniMax alternative for the planner/agent. */
  minimaxPlanner: "MiniMax-M2.5",
} as const satisfies Record<string, AiModelId>;

export type AiRole = "user" | "assistant";

export interface AiTextBlock {
  type: "text";
  text: string;
}
export interface AiToolUseBlock {
  type: "tool_use";
  id: string;
  name: AiToolName;
  /** Raw model-produced input — ALWAYS validate/parse before use. */
  input: unknown;
}
export interface AiToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
export type AiContentBlock = AiTextBlock | AiToolUseBlock | AiToolResultBlock;

export interface AiMessage {
  role: AiRole;
  content: string | AiContentBlock[];
}

export type AiEffort = "low" | "medium" | "high" | "max";

export interface AiCompleteRequest {
  /** Correlates streaming events + cancellation. */
  requestId: string;
  model: AiModelId;
  system: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  maxTokens?: number;
  stream?: boolean;
  /** Opus-only; omit for Haiku (it errors). */
  effort?: AiEffort;
}

export type AiStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence"
  | (string & Record<never, never>);

export interface AiCompleteResult {
  requestId: string;
  stopReason: AiStopReason;
  content: AiContentBlock[];
  usage?: { inputTokens: number; outputTokens: number };
}

/** Emitted on AI_IPC.streamEvent while streaming. */
export type AiStreamEvent =
  | { type: "delta"; requestId: string; text: string }
  | { type: "tool_use"; requestId: string; block: AiToolUseBlock }
  | { type: "done"; requestId: string; result: AiCompleteResult }
  | { type: "error"; requestId: string; message: string };

export interface AiKeyStatus {
  hasKey: boolean;
}

/** IPC channel names. Keep in sync with both electron-env.d.ts files (S0-2). */
export const AI_IPC = {
  complete: "ai:complete",
  streamEvent: "ai:stream-event",
  cancel: "ai:cancel",
  getKeyStatus: "ai:get-key-status",
} as const;

/* ════════════════════════════════════════════════════════════════════════
 * 5. TUNING CONSTANTS   (shared defaults — tweak together)
 * ════════════════════════════════════════════════════════════════════════ */

/** Lowercased filler tokens (English) for the Brain's `filler` moments. */
export const FILLER_WORDS = [
  "um", "uh", "erm", "er", "hmm", "like", "you know",
  "basically", "actually", "literally", "sort of", "kind of",
] as const;

/** Gap between speech longer than this becomes a `silence` moment. */
export const SILENCE_MIN_MS = 400;
/** Span with no speech AND no clicks longer than this becomes an `idle` moment. */
export const IDLE_MIN_MS = 1500;
/** Hard cap on agent tool-use iterations (runaway-loop guard). */
export const MAX_TOOL_ITERATIONS = 8;
/** Default model output cap. */
export const DEFAULT_MAX_TOKENS = 2048;
