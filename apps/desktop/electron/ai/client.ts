/**
 * electron/ai/client.ts — main-process Claude boundary (Sprint 0, task S0-2).
 *
 * S0-2 ships a STUB: no network call. `runAiComplete` echoes a canned assistant
 * message so Person B can build the renderer agent loop against a real IPC
 * round-trip today. S1-2 replaces the body with the actual `@anthropic-ai/sdk`
 * call and maps the wire types below to/from SDK types.
 *
 * SECURITY: the Anthropic API key lives ONLY in this process. It is never
 * returned to or referenced by the renderer.
 *
 * The wire types here mirror the IPC section of `src/lib/ai/contract.ts`. Keep
 * them in sync — see docs/ai-team-log.md decision D1 (renderer stays SDK-free;
 * main owns the SDK and the mapping).
 */

export type AiRole = "user" | "assistant";

export interface AiContentBlockWire {
  type: string;
  [key: string]: unknown;
}

export interface AiMessageWire {
  role: AiRole;
  content: string | AiContentBlockWire[];
}

export interface AiCompleteRequestWire {
  requestId: string;
  model: string;
  system: string;
  messages: AiMessageWire[];
  tools?: unknown[];
  maxTokens?: number;
  stream?: boolean;
  /** Opus-only; omitted for Haiku. */
  effort?: "low" | "medium" | "high" | "max";
}

export interface AiCompleteResultWire {
  requestId: string;
  stopReason: string;
  content: AiContentBlockWire[];
  usage?: { inputTokens: number; outputTokens: number };
}

/** True when an Anthropic API key is configured in the main-process env. */
export function hasApiKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * S0-2 STUB — returns a canned assistant text block, no network.
 * Replaced by the real Anthropic tool-use call in S1-2.
 */
export async function runAiComplete(
  request: AiCompleteRequestWire,
): Promise<AiCompleteResultWire> {
  const messageCount = Array.isArray(request?.messages)
    ? request.messages.length
    : 0;
  const model = request?.model ?? "(unset)";

  const text =
    `🔌 ai:complete stub — received ${messageCount} message(s) for model ` +
    `"${model}". The real Anthropic call lands in S1-2.`;

  return {
    requestId: request?.requestId ?? "",
    stopReason: "end_turn",
    content: [{ type: "text", text }],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
