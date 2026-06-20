/**
 * electron/ai/client.ts — the main-process model router (Sprint 0, S0-2 + D5).
 *
 * `ai:complete` lands here. We pick a provider by model id and delegate. The
 * renderer never knows which provider ran — it always speaks the same wire
 * protocol (decision D1 + D5). API keys live only in this process.
 *
 * Provider implementations: ./providers/*. Real model calls land in S1-2.
 */
import { AnthropicProvider } from "./providers/anthropic";
import { MiniMaxProvider } from "./providers/minimax";
import {
  providerIdForModel,
  type AiCompleteRequestWire,
  type AiCompleteResultWire,
  type AiProviderId,
  type ModelProvider,
} from "./types";

export type {
  AiCompleteRequestWire,
  AiCompleteResultWire,
  AiProviderId,
} from "./types";

const providers: Record<AiProviderId, ModelProvider> = {
  anthropic: new AnthropicProvider(),
  minimax: new MiniMaxProvider(),
};

/** The provider that will service a given model id. */
export function getProvider(model: string): ModelProvider {
  return providers[providerIdForModel(model)];
}

/** Route one model turn to the right provider. */
export async function runAiComplete(
  request: AiCompleteRequestWire,
): Promise<AiCompleteResultWire> {
  return getProvider(request?.model ?? "").complete(request);
}

export interface KeyStatus {
  /** True if ANY provider has a key configured. */
  hasKey: boolean;
  /** Per-provider key presence — lets the UI offer the configured models. */
  providers: Record<AiProviderId, boolean>;
}

export function getKeyStatus(): KeyStatus {
  const perProvider: Record<AiProviderId, boolean> = {
    anthropic: providers.anthropic.hasKey(),
    minimax: providers.minimax.hasKey(),
  };
  return {
    hasKey: Object.values(perProvider).some(Boolean),
    providers: perProvider,
  };
}

/** Back-compat: true if any provider is configured. */
export function hasApiKey(): boolean {
  return getKeyStatus().hasKey;
}
