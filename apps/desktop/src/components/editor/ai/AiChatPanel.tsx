/**
 * AiChatPanel — "Quiro Director" dock (Sprint 0 shell → Sprint 1 full loop).
 *
 * S1-3 wires the real agent runner loop: user sends a message → runAgentTurn()
 * calls ai:complete over IPC, dispatches tool_use blocks, feeds results back,
 * repeats until the model stops. S1-4's tool dispatcher powers the edits.
 *
 * Memoized + stable props (CLAUDE.md memo discipline) — never re-renders on
 * unrelated window.tsx updates, never touches the performance-critical
 * playback path.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { runAgentTurn } from "@/lib/ai/agent";
import type { EditorActions } from "@/lib/ai/contract";
import type { AiMessage } from "@/lib/ai/contract";
import type { ToolResult } from "@/lib/ai/contract";
import { fetchAiKeyStatus, missingKeyMessage, type AiKeyStatus } from "@/lib/ai/keyStatus";

/* ── Display types ────────────────────────────────────────────────────────── */

type DisplayMessage =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tools"; applied: Array<{ name: string; result: ToolResult }> }
  | { kind: "error"; text: string };

/* ── Props ────────────────────────────────────────────────────────────────── */

interface AiChatPanelProps {
  open: boolean;
  onToggle: () => void;
  actions: EditorActions;
}

/* ── Component ────────────────────────────────────────────────────────────── */

function AiChatPanelImpl({ open, onToggle, actions }: AiChatPanelProps) {
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  // Display-friendly messages (what the user sees).
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  // Raw AiMessage[] for conversation history passed to the agent.
  const historyRef = useRef<AiMessage[]>([]);
  const assistantMessageIndexRef = useRef<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch key status whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchAiKeyStatus()
      .then((status) => { if (alive) setKeyStatus(status); })
      .catch(() => { if (alive) setKeyStatus(null); });
    return () => { alive = false; };
  }, [open]);

  // Auto-scroll to bottom when new messages land.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [displayMessages, isRunning]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || isRunning) return;
    setDraft("");
    setIsRunning(true);
    assistantMessageIndexRef.current = null;

    setDisplayMessages((prev) => [...prev, { kind: "user", text }] );

    const appendAssistantDelta = (delta: string) => {
      setDisplayMessages((prev) => {
        if (assistantMessageIndexRef.current === null) {
          assistantMessageIndexRef.current = prev.length;
          return [...prev, { kind: "assistant", text: delta }];
        }

        const index = assistantMessageIndexRef.current;
        if (index < 0 || index >= prev.length) {
          return prev;
        }

        const next = [...prev];
        const current = next[index];
        if (current.kind !== "assistant") {
          return prev;
        }
        next[index] = { kind: "assistant", text: `${current.text}${delta}` };
        return next;
      });
    };

    try {
      const result = await runAgentTurn({
        userMessage: text,
        previousMessages: historyRef.current,
        actions,
        onAssistantDelta: appendAssistantDelta,
      });

      historyRef.current = result.messages;

      if (result.error) {
        setDisplayMessages((prev) => [
          ...prev,
          { kind: "error", text: result.error! },
        ]);
      } else {
        if (result.assistantText) {
          setDisplayMessages((prev) => {
            const index = assistantMessageIndexRef.current;
            if (index !== null && index >= 0 && index < prev.length) {
              const next = [...prev];
              next[index] = { kind: "assistant", text: result.assistantText };
              return next;
            }
            return [...prev, { kind: "assistant", text: result.assistantText }];
          });
        }
        if (result.toolsApplied.length > 0) {
          setDisplayMessages((prev) => [
            ...prev,
            { kind: "tools", applied: result.toolsApplied },
          ]);
        }
      }
    } catch (err) {
      setDisplayMessages((prev) => [
        ...prev,
        { kind: "error", text: `Something went wrong: ${String(err)}` },
      ]);
    } finally {
      assistantMessageIndexRef.current = null;
      setIsRunning(false);
    }
  }, [draft, isRunning, actions]);

  const missing = keyStatus ? missingKeyMessage(keyStatus) : null;
  const context = open ? actions.snapshot() : null;

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={onToggle}
        aria-label="Toggle Quiro Director"
        className="fixed bottom-4 right-4 z-50 flex h-11 items-center gap-2 rounded-full border border-white/10 bg-neutral-900/90 px-4 text-sm font-medium text-white shadow-lg backdrop-blur transition hover:bg-neutral-800"
      >
        <span className="text-[#f08030]">✦</span>
        {open ? "Close" : "Quiro Director"}
      </button>

      {open && (
        <div className="fixed bottom-20 right-4 z-50 flex h-[32rem] w-80 flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/95 text-sm text-white shadow-2xl backdrop-blur">
          {/* Header */}
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 font-semibold">
              <span className="text-[#f08030]">✦</span> Quiro Director
            </div>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Close"
              className="text-white/50 transition hover:text-white"
            >
              ✕
            </button>
          </header>

          {/* Context bar */}
          {context && (
            <div className="border-b border-white/5 px-4 py-2 text-[11px] text-white/45">
              {context.zoomRegions.length} zooms · {context.clipRegions.length} clips ·
              captions {context.captionsEnabled ? "on" : "off"} ·
              telemetry {context.hasTelemetry ? "✓" : "—"} ·
              transcript {context.hasTranscript ? "✓" : "—"}
            </div>
          )}

          {/* Message area */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
          >
            {missing && (
              <div className="rounded-lg border border-[#f08030]/30 bg-[#f08030]/10 px-3 py-2 text-[13px] text-[#f0a060]">
                {missing}
              </div>
            )}

            {displayMessages.length === 0 && !missing && (
              <p className="text-[13px] leading-relaxed text-white/50 px-1 pt-1">
                Ask me to edit your recording —{" "}
                <span className="text-white/35">"zoom into my clicks"</span>,{" "}
                <span className="text-white/35">"cut the dead air"</span>,{" "}
                <span className="text-white/35">"add captions"</span>.
              </p>
            )}

            {displayMessages.map((msg, i) => {
              if (msg.kind === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-xl rounded-br-sm bg-[#f08030]/20 px-3 py-2 text-[13px] text-white/90">
                      {msg.text}
                    </div>
                  </div>
                );
              }
              if (msg.kind === "assistant") {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-white/5 px-3 py-2 text-[13px] leading-relaxed text-white/80">
                      {msg.text}
                    </div>
                  </div>
                );
              }
              if (msg.kind === "tools") {
                return (
                  <div key={i} className="flex flex-col gap-1">
                    {msg.applied.map((t, j) => (
                      <div
                        key={j}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] ${
                          t.result.ok
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-red-500/10 text-red-400"
                        }`}
                      >
                        <span>{t.result.ok ? "✓" : "✗"}</span>
                        <span>{t.result.summary}</span>
                      </div>
                    ))}
                  </div>
                );
              }
              if (msg.kind === "error") {
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-400"
                  >
                    {msg.text}
                  </div>
                );
              }
              return null;
            })}

            {isRunning && (
              <div className="flex items-center gap-2 px-1 text-[12px] text-white/40">
                <span className="animate-pulse text-[#f08030]">✦</span>
                Thinking…
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="flex items-center gap-2 border-t border-white/10 p-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim() && !missing && !isRunning) {
                  void handleSend();
                }
              }}
              disabled={Boolean(missing) || isRunning}
              placeholder={
                isRunning
                  ? "Working…"
                  : missing
                    ? "Add a key to enable AI…"
                    : "Make this a punchy demo…"
              }
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-neutral-800/80 px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-[#f08030]/50 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={Boolean(missing) || !draft.trim() || isRunning}
              className="rounded-lg bg-[#f08030] px-3 py-2 text-[13px] font-medium text-neutral-950 transition hover:bg-[#f5944d] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export const AiChatPanel = memo(AiChatPanelImpl);
