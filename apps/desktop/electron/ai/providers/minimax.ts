/**
 * electron/ai/providers/minimax.ts — MiniMax provider (selectable alternative).
 *
 * MiniMax exposes an OpenAI-compatible chat endpoint
 * (`POST {baseUrl}/chat/completions`, `Authorization: Bearer $MINIMAX_API_KEY`)
 * with standard `tools` / `tool_calls` function calling. Models (2026):
 * MiniMax-M3, MiniMax-M2.7, MiniMax-M2.5 (coding/reasoning), M2.1, M2.
 *   • International base URL: https://api.minimax.io/v1
 *   • China base URL:        https://api.minimaxi.com/v1   (set MINIMAX_BASE_URL)
 *
 * S0 SCAFFOLD: the provider, key handling, and the wire↔OpenAI translation
 * (`toOpenAiRequest` / `fromOpenAiResponse`, unit-tested) are done. The actual
 * fetch to `{baseUrl}/chat/completions` is wired in S1-2.
 */
import {
  envHasValue,
  type AiCompleteRequestWire,
  type AiCompleteResultWire,
  type AiContentBlockWire,
  type ModelProvider,
} from "../types";
import { getCachedAiPreferences, resolveKey } from "../aiSettings";

const DEFAULT_BASE_URL = "https://api.minimax.io/v1";

/* ── Minimal OpenAI chat shapes (only the fields we use) ─────────────────── */

interface OpenAiTool {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  tools?: OpenAiTool[];
  max_tokens?: number;
  stream?: boolean;
}

export interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/* ── Translation: our Anthropic-shaped wire format → OpenAI chat ─────────── */

export function toOpenAiRequest(
  request: AiCompleteRequestWire,
): OpenAiChatRequest {
  const messages: OpenAiMessage[] = [];

  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }

  for (const message of request.messages) {
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content });
      continue;
    }

    const textParts: string[] = [];
    const toolCalls: NonNullable<OpenAiMessage["tool_calls"]> = [];
    const toolResults: OpenAiMessage[] = [];

    for (const block of message.content) {
      if (block.type === "text") {
        textParts.push(String((block as { text?: unknown }).text ?? ""));
      } else if (block.type === "tool_use") {
        const b = block as { id?: string; name?: string; input?: unknown };
        toolCalls.push({
          id: String(b.id ?? ""),
          type: "function",
          function: {
            name: String(b.name ?? ""),
            arguments: JSON.stringify(b.input ?? {}),
          },
        });
      } else if (block.type === "tool_result") {
        const b = block as { tool_use_id?: string; content?: unknown };
        toolResults.push({
          role: "tool",
          tool_call_id: String(b.tool_use_id ?? ""),
          content:
            typeof b.content === "string"
              ? b.content
              : JSON.stringify(b.content ?? ""),
        });
      }
    }

    if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: textParts.length ? textParts.join("\n") : null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // OpenAI requires tool results as their own `role: "tool"` messages.
      if (textParts.length) {
        messages.push({ role: "user", content: textParts.join("\n") });
      }
      messages.push(...toolResults);
    }
  }

  const tools = (request.tools ?? []).map((tool): OpenAiTool => {
    const def = tool as {
      name: string;
      description?: string;
      input_schema?: unknown;
    };
    return {
      type: "function",
      function: {
        name: def.name,
        description: def.description,
        parameters: def.input_schema ?? { type: "object", properties: {} },
      },
    };
  });

  return {
    model: request.model,
    messages,
    ...(tools.length ? { tools } : {}),
    ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
  };
}

/* ── Translation: OpenAI chat response → our wire result ─────────────────── */

function mapFinishReason(reason: string | undefined): string {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
      return "end_turn";
    default:
      return reason ?? "end_turn";
  }
}

export function fromOpenAiResponse(
  requestId: string,
  response: OpenAiChatResponse,
): AiCompleteResultWire {
  const choice = response.choices?.[0];
  const message = choice?.message;
  const content: AiContentBlockWire[] = [];

  if (message?.content) {
    content.push({ type: "text", text: message.content });
  }

  for (const call of message?.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = call.function?.arguments
        ? JSON.parse(call.function.arguments)
        : {};
    } catch {
      input = { _unparsed: call.function?.arguments ?? "" };
    }
    content.push({
      type: "tool_use",
      id: call.id ?? "",
      name: call.function?.name ?? "",
      input,
    });
  }

  return {
    requestId,
    stopReason: mapFinishReason(choice?.finish_reason),
    content,
    usage: response.usage
      ? {
          inputTokens: response.usage.prompt_tokens ?? 0,
          outputTokens: response.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}

/* ── Provider ────────────────────────────────────────────────────────────── */

export class MiniMaxProvider implements ModelProvider {
  readonly id = "minimax" as const;

  hasKey(): boolean {
    const stored = getCachedAiPreferences().minimaxKey.trim();
    return stored.length > 0 || envHasValue("MINIMAX_API_KEY");
  }

  baseUrl(): string {
    return process.env.MINIMAX_BASE_URL?.trim() || DEFAULT_BASE_URL;
  }

  async complete(
    request: AiCompleteRequestWire,
  ): Promise<AiCompleteResultWire> {
    const apiKey = resolveKey("MINIMAX_API_KEY", getCachedAiPreferences().minimaxKey);
    if (!apiKey) throw new Error("MINIMAX_API_KEY is not set");

    const url = `${this.baseUrl()}/chat/completions`;
    const body = toOpenAiRequest(request);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`MiniMax API error ${response.status}: ${text}`);
    }

    const json = (await response.json()) as OpenAiChatResponse;
    return fromOpenAiResponse(request.requestId, json);
  }
}
