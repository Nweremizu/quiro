/**
 * electron/ai/aiSettings.ts — persisted AI preferences (keys + selected model).
 *
 * Keys are stored in plain text in userData (same security posture as env vars).
 * A stored key takes priority over the corresponding environment variable so
 * that users who set keys via the UI don't need to maintain a .env file.
 */
import fs from "node:fs/promises";
import { AI_SETTINGS_FILE } from "@electron/utils/constants";

export interface AiPreferences {
  anthropicKey: string;
  minimaxKey: string;
  selectedModel: string;
}

const DEFAULTS: AiPreferences = {
  anthropicKey: "",
  minimaxKey: "",
  selectedModel: "claude-opus-4-8",
};

let _cache: AiPreferences | null = null;

export async function loadAiPreferences(): Promise<AiPreferences> {
  if (_cache) return _cache;
  try {
    const raw = await fs.readFile(AI_SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AiPreferences>;
    _cache = {
      anthropicKey:
        typeof parsed.anthropicKey === "string" ? parsed.anthropicKey : "",
      minimaxKey:
        typeof parsed.minimaxKey === "string" ? parsed.minimaxKey : "",
      selectedModel:
        typeof parsed.selectedModel === "string" && parsed.selectedModel
          ? parsed.selectedModel
          : DEFAULTS.selectedModel,
    };
  } catch {
    _cache = { ...DEFAULTS };
  }
  return _cache;
}

export async function saveAiPreferences(
  patch: Partial<AiPreferences>,
): Promise<void> {
  const current = await loadAiPreferences();
  _cache = { ...current, ...patch };
  await fs.writeFile(AI_SETTINGS_FILE, JSON.stringify(_cache, null, 2), "utf-8");
}

/** Synchronous read of the in-memory cache (populated after first loadAiPreferences call). */
export function getCachedAiPreferences(): AiPreferences {
  return _cache ?? { ...DEFAULTS };
}

/**
 * Resolve the effective API key for a provider.
 * Stored key wins over env var when non-empty.
 */
export function resolveKey(
  envVar: string,
  storedKey: string,
): string {
  const stored = storedKey.trim();
  if (stored) return stored;
  return process.env[envVar]?.trim() ?? "";
}
