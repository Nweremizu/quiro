/**
 * electron/utils/loadEnv.ts — minimal, zero-dependency `.env` loader (S0-3).
 *
 * The AI provider keys (`ANTHROPIC_API_KEY`, `MINIMAX_API_KEY`,
 * `MINIMAX_BASE_URL`) live in the MAIN process env. In dev we load them from a
 * local `.env` (gitignored). Real environment variables always win — we never
 * override a value that is already set.
 */
import { existsSync, readFileSync } from "node:fs";

/** Parse `.env` text into key/value pairs. No interpolation; `#` lines ignored. */
export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    const first = value[0];
    const last = value[value.length - 1];
    if (value.length >= 2 && (first === '"' || first === "'") && last === first) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Load the first existing `.env` from `candidatePaths` into `process.env`,
 * without overriding existing values. Returns the path that was loaded, or null
 * if none existed.
 */
export function loadEnvFile(candidatePaths: string[]): string | null {
  for (const filePath of candidatePaths) {
    if (!filePath || !existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    for (const [key, value] of Object.entries(parseEnv(content))) {
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
    return filePath;
  }

  return null;
}
