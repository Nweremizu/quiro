/**
 * AiChatPanel — "Quiro Director" right-hand editor panel.
 *
 * Renders as an in-flow flex sibling of the editor's top row, mirroring the
 * SettingsPanel on the left (same width / shape / design tokens) so the
 * timeline below stays full-width and is never overlapped. On first load it
 * greets the user with telemetry-based insight and kicks off background
 * transcription, updating the greeting when the transcript is ready.
 * The "First Draft" button sends a chat message through the agent loop so
 * the judge sees the AI streaming its reasoning in real time.
 *
 * Phase 3: messages render via AI Elements (Conversation / Message /
 * ChainOfThought / Shimmer). Tool calls stream in live — each appears in
 * "Applying changes…" → "N changes applied" as the agent loop runs. The
 * input uses PromptInput so Enter submits and Shift+Enter inserts a newline.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { runAgentTurn } from "@/lib/ai/agent";
import type { AgentStreamEvent } from "@/lib/ai/agent";
import type { EditorActions, AiMessage, ToolResult } from "@/lib/ai/contract";
import { fetchAiKeyStatus, missingKeyMessage, type AiKeyStatus } from "@/lib/ai/keyStatus";
import { buildBrain, summarizeBrain } from "@/lib/ai/brain";
import { AiMagicIcon, Cancel01Icon, SparklesIcon } from "@/components/icons";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";

/* ── Motion tokens ────────────────────────────────────────────────────────── */

/** Open width — matches the left SettingsPanel (`w-83` = 332px). */
const PANEL_WIDTH = 332;
/** Collapsed rail width (`w-12` = 48px), mirroring the left section rail. */
const RAIL_WIDTH = 48;

/** iOS/Vaul drawer curve — for the width morph + reflow (on-screen movement). */
const EASE_DRAWER: [number, number, number, number] = [0.32, 0.72, 0, 1];
/** Strong ease-out — for content entering/leaving (feels responsive). */
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/* ── Internal chat model ──────────────────────────────────────────────────── */

type ChatTextPart = { kind: "text"; text: string; streaming: boolean };
type ChatToolPart = {
  kind: "tool";
  toolCallId: string;
  toolName: string;
  input: unknown;
  /** Mirrors AI SDK ToolUIPart states so we can pass them directly to ToolHeader. */
  state: "input-available" | "output-available" | "output-error";
  output: ToolResult | null;
};
type ChatPart = ChatTextPart | ChatToolPart;

type ChatMessage =
  | { role: "user"; id: string; text: string }
  | { role: "assistant"; id: string; parts: ChatPart[] }
  | { role: "error"; id: string; text: string };

function friendlyToolName(name: string): string {
  return name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/* ── Greeting types ───────────────────────────────────────────────────────── */

type GreetingPhase =
  | "no-video"        // nothing loaded yet
  | "analyzing"       // transcription running in background
  | "ready"           // transcript done — show full analysis + First Draft
  | "no-model"        // model missing and the download failed — offer download
  | "model-downloading" // tiny model is downloading
  | "error";          // transcription itself failed — offer retry

/* ── Props ────────────────────────────────────────────────────────────────── */

interface AiChatPanelProps {
  open: boolean;
  onToggle: () => void;
  actions: EditorActions;
  videoPath: string | null;
  /** Reactive video duration — updates after the video element reports it. */
  durationMs: number;
  whisperTinyModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
  onDownloadWhisperModel: () => void;
}

/* ── Greeting helpers ─────────────────────────────────────────────────────── */

function clickCount(actions: EditorActions): number {
  try {
    const inputs = actions.getBrainInputs();
    return inputs.cursorTelemetry.filter((p) => p.interactionType === "click").length;
  } catch {
    return 0;
  }
}

function GreetingBubble({
  phase,
  clicks,
  silenceTotalMs,
  fillerCount,
  durationMs,
  errorMessage,
  onFirstDraft,
  onDownloadModel,
  onRetry,
  downloadStatus,
}: {
  phase: GreetingPhase;
  clicks: number;
  silenceTotalMs: number;
  fillerCount: number;
  durationMs: number;
  errorMessage: string | null;
  onFirstDraft: () => void;
  onDownloadModel: () => void;
  onRetry: () => void;
  downloadStatus: "idle" | "downloading" | "downloaded" | "error";
}) {
  const durationSec = Math.round(durationMs / 1000);
  const silenceSec = Math.round(silenceTotalMs / 1000);
  const durationLabel = durationSec > 0 ? ` in your ${durationSec}s recording` : "";
  const recordingLabel = durationSec > 0 ? `your ${durationSec}s recording` : "your recording";

  const seenLine =
    clicks > 0
      ? `I see ${clicks} click${clicks !== 1 ? "s" : ""}${durationLabel}.`
      : `I see ${recordingLabel}.`;

  if (phase === "no-video") {
    return (
      <p className="px-1 pt-1 text-[13px] leading-relaxed text-muted-foreground">
        Open a recording to get started.
      </p>
    );
  }

  if (phase === "error") {
    return (
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-foreground/80">
          {seenLine} I couldn&apos;t analyse the audio.
        </p>
        {errorMessage && (
          <p className="text-[12px] leading-relaxed text-muted-foreground/70">
            {errorMessage}
          </p>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-foreground/10 active:scale-95"
        >
          Retry
        </button>
      </div>
    );
  }

  if (phase === "model-downloading") {
    return (
      <div className="space-y-2">
        <p className="text-[13px] leading-relaxed text-foreground/80">{seenLine}</p>
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground/70">
          <SparklesIcon className="h-3.5 w-3.5 animate-pulse text-primary" />
          Downloading speech model in background…
        </p>
      </div>
    );
  }

  if (phase === "no-model") {
    return (
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-foreground/80">
          {seenLine} Download the speech model to analyse audio.
        </p>
        <button
          type="button"
          onClick={onDownloadModel}
          disabled={downloadStatus === "downloading"}
          className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary transition hover:bg-primary/15 disabled:opacity-50"
        >
          {downloadStatus === "downloading" ? "Downloading…" : "Download speech model"}
        </button>
      </div>
    );
  }

  if (phase === "analyzing") {
    return (
      <div className="space-y-2">
        <p className="text-[13px] leading-relaxed text-foreground/80">{seenLine}</p>
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground/70">
          <SparklesIcon className="h-3.5 w-3.5 animate-pulse text-primary" />
          Analysing speech…
        </p>
      </div>
    );
  }

  // ready
  const parts: string[] = [];
  if (clicks > 0) parts.push(`${clicks} click${clicks !== 1 ? "s" : ""}`);
  if (silenceSec > 0) parts.push(`${silenceSec}s of dead air`);
  if (fillerCount > 0) parts.push(`${fillerCount} filler word${fillerCount !== 1 ? "s" : ""}`);

  const summary = parts.length > 0
    ? `Found ${parts.join(", ")}.`
    : "Looks clean already.";

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-foreground/80">
        Ready. {summary}
      </p>
      <button
        type="button"
        onClick={onFirstDraft}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground transition hover:bg-primary/90 active:scale-95"
      >
        <SparklesIcon className="h-4 w-4" />
        Make a first draft
      </button>
    </div>
  );
}

/* ── Component ────────────────────────────────────────────────────────────── */

function AiChatPanelImpl({
  open,
  onToggle,
  actions,
  videoPath,
  durationMs,
  whisperTinyModelDownloadStatus,
  onDownloadWhisperModel,
}: AiChatPanelProps) {
  const reduceMotion = useReducedMotion();
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const historyRef = useRef<AiMessage[]>([]);

  // The collapsed rail and the full panel are BOTH kept mounted (so chat scroll
  // position and state survive a collapse) and crossfaded. Whichever layer is
  // hidden is marked `inert` so it can't be focused or clicked underneath the
  // visible one. Set via DOM API to avoid the v18 @types/react `inert` gap.
  const panelContentRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const setInert = (el: HTMLElement | null, on: boolean) => {
      if (!el) return;
      if (on) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    };
    setInert(panelContentRef.current, !open); // panel inert while collapsed
    setInert(railRef.current, open);           // rail inert while open
  }, [open]);

  // Greeting state
  const [greetingPhase, setGreetingPhase] = useState<GreetingPhase>("no-video");
  const [greetingClicks, setGreetingClicks] = useState(0);
  const [greetingSilenceTotalMs, setGreetingSilenceTotalMs] = useState(0);
  const [greetingFillerCount, setGreetingFillerCount] = useState(0);
  const [greetingError, setGreetingError] = useState<string | null>(null);
  const transcriptionStartedRef = useRef(false);
  // Incrementing this re-triggers the transcription effect (after a model
  // download finishes, or when the user hits "Retry").
  const [retryTrigger, setRetryTrigger] = useState(0);

  // Fetch key status on open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchAiKeyStatus()
      .then((s) => { if (alive) setKeyStatus(s); })
      .catch(() => { if (alive) setKeyStatus(null); });
    return () => { alive = false; };
  }, [open]);

  // Greeting + background transcription trigger.
  useEffect(() => {
    if (!videoPath) {
      setGreetingPhase("no-video");
      transcriptionStartedRef.current = false;
      return;
    }
    if (transcriptionStartedRef.current) return;
    transcriptionStartedRef.current = true;

    const snapshot = actions.snapshot();
    const clicks = clickCount(actions);
    setGreetingClicks(clicks);

    // If already has transcript, go straight to ready.
    if (snapshot.hasTranscript) {
      const brain = buildBrain(actions.getBrainInputs());
      const summary = summarizeBrain(brain);
      setGreetingSilenceTotalMs(summary.silenceTotalMs);
      setGreetingFillerCount(summary.fillerCount);
      setGreetingPhase("ready");
      return;
    }

    void (async () => {
      const result = await actions.generateCaptions("auto");
      if (!result.ok) {
        if (result.reason === "missing-model") {
          // Model isn't available yet — kick off the download (the dedicated
          // status effect retries transcription once it lands).
          setGreetingPhase("model-downloading");
          onDownloadWhisperModel();
        } else {
          // The model is present but transcription failed (bad audio, whisper
          // error, no source, …). Surface the real reason and offer a retry —
          // do NOT mislabel this as "download the model".
          setGreetingError(result.message || "Couldn't analyse the audio.");
          setGreetingPhase("error");
        }
        return;
      }

      setGreetingError(null);
      const brain = buildBrain(actions.getBrainInputs());
      const summary = summarizeBrain(brain);
      setGreetingSilenceTotalMs(summary.silenceTotalMs);
      setGreetingFillerCount(summary.fillerCount);
      setGreetingPhase("ready");
    })();

    setGreetingPhase("analyzing");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPath, retryTrigger]);

  // Drive the greeting off the model-download status. This must cover BOTH the
  // auto-download phase AND a manual "Download" click from the no-model state —
  // otherwise the panel gets stuck showing the button after the model arrives.
  useEffect(() => {
    if (greetingPhase !== "model-downloading" && greetingPhase !== "no-model") {
      return;
    }
    if (whisperTinyModelDownloadStatus === "downloaded") {
      // Model is ready — retry transcription from the top.
      transcriptionStartedRef.current = false;
      setRetryTrigger((n) => n + 1);
    } else if (whisperTinyModelDownloadStatus === "downloading") {
      setGreetingPhase("model-downloading");
    } else if (whisperTinyModelDownloadStatus === "error") {
      setGreetingPhase("no-model");
    }
  }, [whisperTinyModelDownloadStatus, greetingPhase]);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isRunning) return;
    setIsRunning(true);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    setChatMessages((prev) => [
      ...prev,
      { role: "user", id: userId, text },
      { role: "assistant", id: assistantId, parts: [] },
    ]);

    try {
      const result = await runAgentTurn({
        userMessage: text,
        previousMessages: historyRef.current,
        actions,
        onEvent: (event: AgentStreamEvent) => {
          if (event.type === "text-delta") {
            setChatMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === assistantId);
              if (idx === -1) return prev;
              const msg = prev[idx];
              if (msg.role !== "assistant") return prev;
              const parts = [...msg.parts];
              const last = parts[parts.length - 1];
              if (last?.kind === "text") {
                parts[parts.length - 1] = {
                  ...last,
                  text: last.text + event.text,
                  streaming: true,
                };
              } else {
                parts.push({ kind: "text", text: event.text, streaming: true });
              }
              const next = [...prev];
              next[idx] = { ...msg, parts };
              return next;
            });
          } else if (event.type === "tool-input") {
            setChatMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === assistantId);
              if (idx === -1) return prev;
              const msg = prev[idx];
              if (msg.role !== "assistant") return prev;
              const next = [...prev];
              next[idx] = {
                ...msg,
                parts: [
                  ...msg.parts,
                  {
                    kind: "tool",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    input: event.input,
                    state: "input-available" as const,
                    output: null,
                  },
                ],
              };
              return next;
            });
          } else if (event.type === "tool-output") {
            setChatMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === assistantId);
              if (idx === -1) return prev;
              const msg = prev[idx];
              if (msg.role !== "assistant") return prev;
              const parts = msg.parts.map((p) =>
                p.kind === "tool" && p.toolCallId === event.toolCallId
                  ? {
                      ...p,
                      state: (event.output.ok
                        ? "output-available"
                        : "output-error") as "output-available" | "output-error",
                      output: event.output,
                    }
                  : p
              );
              const next = [...prev];
              next[idx] = { ...msg, parts };
              return next;
            });
          }
        },
      });

      historyRef.current = result.messages;

      // Finalize: mark text parts as no longer streaming; handle error turns.
      setChatMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === assistantId);
        if (idx === -1) return prev;
        const next = [...prev];

        if (result.error) {
          next[idx] = { role: "error", id: assistantId, text: result.error };
          return next;
        }

        const msg = prev[idx];
        if (msg.role === "assistant") {
          let parts: ChatPart[] = msg.parts.map((p) =>
            p.kind === "text" ? { ...p, streaming: false } : p
          );
          // Fallback: streaming produced no text parts but the model returned text
          if (parts.filter((p) => p.kind === "text").length === 0 && result.assistantText) {
            parts = [...parts, { kind: "text", text: result.assistantText, streaming: false }];
          }
          next[idx] = { ...msg, parts };
        }
        return next;
      });
    } catch (err) {
      setChatMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === assistantId);
        const errMsg: ChatMessage = {
          role: "error",
          id: assistantId,
          text: `Something went wrong: ${String(err)}`,
        };
        if (idx === -1) return [...prev, { ...errMsg, id: crypto.randomUUID() }];
        const next = [...prev];
        next[idx] = errMsg;
        return next;
      });
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, actions]);

  const handleFirstDraft = useCallback(() => {
    void handleSend("Make this a polished first draft — trim dead air, add zooms on my clicks, and clean up any filler words.");
  }, [handleSend]);

  // Manual "Download speech model" — move to the downloading phase immediately so
  // the user gets feedback (the status effect retries transcription when it lands).
  const handleDownloadModel = useCallback(() => {
    setGreetingPhase("model-downloading");
    onDownloadWhisperModel();
  }, [onDownloadWhisperModel]);

  // Re-run transcription from scratch (used by the "Retry" button on failure).
  const handleRetryTranscription = useCallback(() => {
    setGreetingError(null);
    transcriptionStartedRef.current = false;
    setRetryTrigger((n) => n + 1);
  }, []);

  const missing = keyStatus ? missingKeyMessage(keyStatus) : null;
  const showGreeting = chatMessages.length === 0 && !missing;

  // The panel is an in-flow flex sibling whose WIDTH animates between the open
  // panel (332px) and a collapsed rail (48px). Animating width drives the video
  // preview to reflow smoothly into the freed space — translate alone can't do
  // that. Both layers stay mounted and crossfade; the slow part (width) uses the
  // drawer curve, the content fade uses a strong ease-out and is slightly faster.
  const widthTransition = reduceMotion
    ? { duration: 0 }
    : { duration: open ? 0.3 : 0.26, ease: EASE_DRAWER };

  const contentTransition = reduceMotion
    ? { duration: 0.12 }
    : open
      ? { duration: 0.28, ease: EASE_OUT, delay: 0.04 }
      : { duration: 0.16, ease: EASE_OUT };

  return (
    <motion.div
      initial={false}
      animate={{ width: open ? PANEL_WIDTH : RAIL_WIDTH }}
      transition={widthTransition}
      className="relative h-full shrink-0 overflow-hidden"
    >
      {/* Collapsed rail — mirrors the left EditorSectionRail; fades in once the
          panel has begun narrowing (delay), so the two never visibly overlap. */}
      <motion.div
        ref={railRef}
        initial={false}
        animate={{ opacity: open ? 0 : 1 }}
        transition={
          reduceMotion
            ? { duration: 0.12 }
            : { duration: 0.18, ease: EASE_OUT, delay: open ? 0 : 0.1 }
        }
        className="absolute inset-y-0 right-0 flex w-12 items-start justify-center py-2"
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label="Open Quiro Director"
          title="Quiro Director"
          className="group flex size-9 items-center justify-center rounded-lg text-foreground/60 outline-none transition hover:bg-foreground/8 hover:text-foreground focus:outline-none focus-visible:outline-none active:scale-95"
        >
          <AiMagicIcon className="size-5.5" />
        </button>
      </motion.div>

      {/* Full panel — kept at its natural width so its contents never squish as
          the container narrows; it fades, slides and blurs out on collapse. The
          blur masks the crossfade so the eye reads one smooth morph, not two
          objects swapping. */}
      <motion.div
        ref={panelContentRef}
        initial={false}
        animate={
          reduceMotion
            ? { opacity: open ? 1 : 0, x: 0, filter: "blur(0px)" }
            : {
                opacity: open ? 1 : 0,
                x: open ? 0 : 16,
                filter: open ? "blur(0px)" : "blur(3px)",
              }
        }
        transition={contentTransition}
        style={{ width: PANEL_WIDTH }}
        className="absolute inset-y-0 right-0 flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/3"
      >
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AiMagicIcon className="size-4 text-primary" />
            Quiro Director
          </div>
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse Director"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground active:scale-95"
          >
            <Cancel01Icon className="size-4" />
          </button>
        </header>

        {/* Context bar */}
        {videoPath && (
          <div className="shrink-0 border-b border-foreground/5 px-4 py-1.5 text-[11px] text-muted-foreground/70">
            {(() => {
              const s = actions.snapshot();
              return `${s.zoomRegions.length} zoom${s.zoomRegions.length !== 1 ? "s" : ""} · ${s.clipRegions.length} clip${s.clipRegions.length !== 1 ? "s" : ""} · captions ${s.captionsEnabled ? "on" : "off"}`;
            })()}
          </div>
        )}

        {/* Messages — StickToBottom handles auto-scroll; ConversationScrollButton
            shows a "jump to bottom" button when the user has scrolled up. */}
        <Conversation>
          <ConversationContent className="gap-4 px-3 py-3">
            {missing && (
              <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-[13px] text-primary">
                {missing}
              </div>
            )}

            {showGreeting && (
              <GreetingBubble
                phase={greetingPhase}
                clicks={greetingClicks}
                silenceTotalMs={greetingSilenceTotalMs}
                fillerCount={greetingFillerCount}
                durationMs={durationMs}
                errorMessage={greetingError}
                onFirstDraft={handleFirstDraft}
                onDownloadModel={handleDownloadModel}
                onRetry={handleRetryTranscription}
                downloadStatus={whisperTinyModelDownloadStatus}
              />
            )}

            {chatMessages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <Message key={msg.id} from="user">
                    <MessageContent className="rounded-xl rounded-br-sm bg-primary/15 px-3 py-2 text-[13px] text-foreground">
                      {msg.text}
                    </MessageContent>
                  </Message>
                );
              }

              if (msg.role === "assistant") {
                const toolParts = msg.parts.filter(
                  (p): p is ChatToolPart => p.kind === "tool"
                );
                const textParts = msg.parts.filter(
                  (p): p is ChatTextPart => p.kind === "text"
                );
                const allToolsDone = toolParts.every(
                  (p) => p.state !== "input-available"
                );
                const isLastMsg = msg === chatMessages[chatMessages.length - 1];

                return (
                  <Message key={msg.id} from="assistant">
                    <MessageContent className="w-full rounded-xl rounded-bl-sm bg-foreground/5 px-3 py-2 text-[13px] leading-relaxed text-foreground/80">
                      {/* Thinking shimmer — before any content has arrived */}
                      {msg.parts.length === 0 && isRunning && isLastMsg && (
                        <Shimmer className="text-[12px]">Thinking…</Shimmer>
                      )}

                      {/* Live tool sequence — collapses once all done */}
                      {toolParts.length > 0 && (
                        <ChainOfThought defaultOpen={!allToolsDone}>
                          <ChainOfThoughtHeader>
                            {allToolsDone
                              ? `${toolParts.length} change${toolParts.length !== 1 ? "s" : ""} applied`
                              : "Applying changes…"}
                          </ChainOfThoughtHeader>
                          <ChainOfThoughtContent>
                            {toolParts.map((part) => (
                              <ChainOfThoughtStep
                                key={part.toolCallId}
                                label={friendlyToolName(part.toolName)}
                                description={part.output?.summary ?? undefined}
                                status={
                                  part.state === "input-available"
                                    ? "active"
                                    : "complete"
                                }
                              />
                            ))}
                          </ChainOfThoughtContent>
                        </ChainOfThought>
                      )}

                      {/* Streaming / final assistant text */}
                      {textParts.map((part, i) => (
                        <MessageResponse key={i} isAnimating={part.streaming}>
                          {part.text}
                        </MessageResponse>
                      ))}
                    </MessageContent>
                  </Message>
                );
              }

              if (msg.role === "error") {
                return (
                  <div
                    key={msg.id}
                    className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[12px] text-destructive"
                  >
                    {msg.text}
                  </div>
                );
              }

              return null;
            })}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Input — PromptInput handles Enter-to-submit and Shift+Enter newline. */}
        <div className="shrink-0 border-t border-foreground/10 p-3">
          <PromptInput
            onSubmit={({ text }) => {
              if (!text.trim() || Boolean(missing) || isRunning) return;
              setDraft("");
              void handleSend(text);
            }}
          >
            <PromptInputBody>
              <PromptInputTextarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={Boolean(missing) || isRunning}
                placeholder={
                  isRunning
                    ? "Working…"
                    : missing
                      ? "Add a key to enable AI…"
                      : "Ask me to edit…"
                }
                rows={1}
              />
            </PromptInputBody>
            <PromptInputToolbar>
              <PromptInputTools />
              <PromptInputSubmit
                status={isRunning ? "submitted" : undefined}
                disabled={Boolean(missing) || !draft.trim() || isRunning}
              />
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </motion.div>
    </motion.div>
  );
}

export const AiChatPanel = memo(AiChatPanelImpl);
