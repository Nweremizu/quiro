/**
 * src/lib/ai/keyStatus.ts — renderer-side AI key / "missing key" state (S0-3).
 *
 * Thin helpers over the `ai:get-key-status` bridge. Person B's ChatPanel (S0-4)
 * uses `fetchAiKeyStatus()` and renders `missingKeyMessage()` when no provider
 * key is configured.
 */

export interface AiKeyStatus {
  /** True if ANY provider has a key configured. */
  hasKey: boolean;
  /** Per-provider key presence — drive a model picker / per-provider hints. */
  providers: { anthropic: boolean; minimax: boolean };
}

/** Read which provider keys are configured (from the main process). */
export async function fetchAiKeyStatus(): Promise<AiKeyStatus> {
  return window.electronAPI.ai.getKeyStatus();
}

/**
 * Guidance to show when no provider key is configured, or `null` when at least
 * one is set (so the caller can render nothing).
 */
export function missingKeyMessage(status: AiKeyStatus): string | null {
  if (status.hasKey) return null;
  return (
    "AI editing needs a model key. Add ANTHROPIC_API_KEY (Claude) and/or " +
    "MINIMAX_API_KEY to apps/desktop/.env (copy .env.example), then restart Quiro."
  );
}
