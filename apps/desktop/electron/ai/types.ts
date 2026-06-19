/**
 * electron/ai/types.ts — provider-neutral wire types + the ModelProvider seam.
 *
 * Quiro is **multi-provider** (decision D5): Claude and MiniMax are both
 * selectable; the renderer is unaware — it always speaks the same Anthropic-
 * shaped wire protocol over `ai:complete`, and the main process routes to a
 * provider by model id. Adding a provider never touches the renderer.
 *
 * These wire types mirror the IPC section of `src/lib/ai/contract.ts`.
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
  effort?: "low" | "medium" | "high" | "max";
}

export interface AiCompleteResultWire {
  requestId: string;
  stopReason: string;
  content: AiContentBlockWire[];
  usage?: { inputTokens: number; outputTokens: number };
}

export type AiProviderId = "anthropic" | "minimax";

/** One model backend. The renderer never sees this — main routes to it. */
export interface ModelProvider {
  readonly id: AiProviderId;
  /** Whether this provider's API key is configured in the main-process env. */
  hasKey(): boolean;
  /** Run one model turn. */
  complete(request: AiCompleteRequestWire): Promise<AiCompleteResultWire>;
}

/**
 * Route a model id to its provider. MiniMax ids look like `MiniMax-M2.5`,
 * `MiniMax-M3`, or the older `abab*`; everything else (notably `claude-*`)
 * routes to Anthropic.
 */
export function providerIdForModel(model: string): AiProviderId {
  const id = (model ?? "").toLowerCase();
  if (id.startsWith("minimax") || id.startsWith("abab")) {
    return "minimax";
  }
  return "anthropic";
}

/** Whether an env var holds a non-blank value. */
export function envHasValue(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

/** Shared S0 stub response (no network). Replaced per-provider in S1-2. */
export function stubCompleteResult(
  providerLabel: string,
  request: AiCompleteRequestWire,
): AiCompleteResultWire {
  const messageCount = Array.isArray(request?.messages)
    ? request.messages.length
    : 0;
  const model = request?.model ?? "(unset)";
  const text =
    `🔌 ${providerLabel} stub — received ${messageCount} message(s) for model ` +
    `"${model}". The real call lands in S1-2.`;

  return {
    requestId: request?.requestId ?? "",
    stopReason: "end_turn",
    content: [{ type: "text", text }],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
