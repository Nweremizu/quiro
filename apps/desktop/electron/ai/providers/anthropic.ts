/**
 * electron/ai/providers/anthropic.ts — Claude provider.
 *
 * S0 ships a STUB (echo, no network). S1-2 replaces `complete()` with the real
 * `@anthropic-ai/sdk` tool-use call. The Anthropic API key lives only here.
 */
import {
  envHasValue,
  stubCompleteResult,
  type AiCompleteRequestWire,
  type AiCompleteResultWire,
  type ModelProvider,
} from "../types";

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;

  hasKey(): boolean {
    return envHasValue("ANTHROPIC_API_KEY");
  }

  async complete(
    request: AiCompleteRequestWire,
  ): Promise<AiCompleteResultWire> {
    // S1-2: call Anthropic Messages API with tool use; map SDK types ↔ wire types.
    return stubCompleteResult("Anthropic", request);
  }
}
