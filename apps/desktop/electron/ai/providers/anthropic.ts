/**
 * electron/ai/providers/anthropic.ts — Claude provider (S1-2: real model calls).
 *
 * Wraps `@anthropic-ai/sdk` behind the `ModelProvider` seam so the renderer and
 * the rest of the main process never touch the SDK. The API key lives only here.
 * Wire types ↔ SDK types are mapped locally; the wire format is the Anthropic
 * shape already (D1), so the translation is near-trivial.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  envHasValue,
  type AiCompleteRequestWire,
  type AiCompleteResultWire,
  type AiContentBlockWire,
  type ModelProvider,
} from "../types";
import { getCachedAiPreferences, resolveKey } from "../aiSettings";

const DEFAULT_MAX_TOKENS = 2048;

function getClient(): Anthropic {
  const apiKey = resolveKey("ANTHROPIC_API_KEY", getCachedAiPreferences().anthropicKey);
  return new Anthropic({ apiKey });
}

/* ── Wire → SDK ──────────────────────────────────────────────────────────── */

function toSdkMessages(
  messages: AiCompleteRequestWire["messages"],
): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        blocks.push({
          type: "text",
          text: String((block as { text?: unknown }).text ?? ""),
        });
      } else if (block.type === "tool_use") {
        const b = block as { id?: string; name?: string; input?: unknown };
        blocks.push({
          type: "tool_use",
          id: String(b.id ?? ""),
          name: String(b.name ?? ""),
          input: (b.input ?? {}) as Record<string, unknown>,
        });
      } else if (block.type === "tool_result") {
        const b = block as {
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        };
        blocks.push({
          type: "tool_result",
          tool_use_id: String(b.tool_use_id ?? ""),
          content:
            typeof b.content === "string"
              ? b.content
              : JSON.stringify(b.content ?? ""),
          ...(b.is_error ? { is_error: true as const } : {}),
        });
      }
    }
    return { role: msg.role, content: blocks };
  });
}

function toSdkTools(tools: unknown[]): Anthropic.Tool[] {
  return tools.map((tool) => {
    const t = tool as {
      name: string;
      description?: string;
      input_schema?: unknown;
    };
    return {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      input_schema: (t.input_schema ?? {
        type: "object",
        properties: {},
      }) as Anthropic.Tool.InputSchema,
    };
  });
}

/* ── SDK → wire ──────────────────────────────────────────────────────────── */

function fromSdkResponse(
  requestId: string,
  message: Anthropic.Message,
): AiCompleteResultWire {
  const content: AiContentBlockWire[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
    // thinking blocks are not part of the wire protocol — skip them
  }
  return {
    requestId,
    stopReason: message.stop_reason ?? "end_turn",
    content,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}

/* ── Provider ────────────────────────────────────────────────────────────── */

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;

  hasKey(): boolean {
    const stored = getCachedAiPreferences().anthropicKey.trim();
    return stored.length > 0 || envHasValue("ANTHROPIC_API_KEY");
  }

  async complete(request: AiCompleteRequestWire): Promise<AiCompleteResultWire> {
    const message = await getClient().messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.system,
      messages: toSdkMessages(request.messages),
      ...(request.tools?.length ? { tools: toSdkTools(request.tools) } : {}),
    });
    return fromSdkResponse(request.requestId, message);
  }
}
