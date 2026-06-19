/**
 * AiChatPanel — "Quiro Director" dock (Sprint 0, S0-4).
 *
 * S0-4 is the *shell*: a toggleable panel that (a) reads the AI key status and
 * shows an "add a key" state (S0-3 helpers), and (b) reads the editor context
 * via `EditorActions.snapshot()` to prove the agent↔editor seam works. The
 * actual agent loop / streaming lands in S1-3.
 *
 * Memoized + stable props (see CLAUDE.md memo discipline) so it never
 * re-renders on unrelated `window.tsx` updates and never touches the
 * performance-critical playback path.
 */
import { memo, useCallback, useEffect, useState } from "react";
import type { EditorActions } from "@/lib/ai/contract";
import {
  fetchAiKeyStatus,
  missingKeyMessage,
  type AiKeyStatus,
} from "@/lib/ai/keyStatus";

interface AiChatPanelProps {
  open: boolean;
  onToggle: () => void;
  actions: EditorActions;
}

function AiChatPanelImpl({ open, onToggle, actions }: AiChatPanelProps) {
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchAiKeyStatus()
      .then((status) => {
        if (alive) setKeyStatus(status);
      })
      .catch(() => {
        if (alive) setKeyStatus(null);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const handleSend = useCallback(() => {
    // S1-3: hand `draft` to the agent runner. No-op shell for now.
    setDraft("");
  }, []);

  const missing = keyStatus ? missingKeyMessage(keyStatus) : null;
  const context = open ? actions.snapshot() : null;

  return (
    <>
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
        <div className="fixed bottom-20 right-4 z-50 flex h-[28rem] w-80 flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/95 text-sm text-white shadow-2xl backdrop-blur">
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

          {context && (
            <div className="border-b border-white/5 px-4 py-2 text-[11px] text-white/45">
              Context: {context.zoomRegions.length} zooms ·{" "}
              {context.clipRegions.length} clips · captions{" "}
              {context.captionsEnabled ? "on" : "off"} · telemetry{" "}
              {context.hasTelemetry ? "✓" : "—"} · transcript{" "}
              {context.hasTranscript ? "✓" : "—"}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-3 text-white/60">
            {missing ? (
              <div className="rounded-lg border border-[#f08030]/30 bg-[#f08030]/10 px-3 py-2 text-[13px] text-[#f0a060]">
                {missing}
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed">
                Ask me to edit your recording — “zoom into my clicks”, “cut the
                dead air”, “add captions”.
                <br />
                <span className="text-white/35">
                  (Conversational editing wires up in S1-3.)
                </span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-white/10 p-3">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && draft.trim() && !missing) {
                  handleSend();
                }
              }}
              disabled={Boolean(missing)}
              placeholder={
                missing ? "Add a key to enable AI…" : "Make this a punchy demo…"
              }
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-neutral-800/80 px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-[#f08030]/50 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={Boolean(missing) || !draft.trim()}
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
