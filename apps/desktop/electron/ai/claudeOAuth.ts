/**
 * electron/ai/claudeOAuth.ts — reuse Claude Code's stored OAuth login.
 *
 * PERSONAL USE ONLY. These are consumer (Claude Pro/Max) OAuth tokens scoped
 * `user:inference`, minted for Anthropic's own CLI. Anthropic gates them to
 * Claude Code, so using them from Quiro requires the `oauth-2025-04-20` beta
 * header AND a system prompt that identifies as Claude Code (see anthropic.ts).
 * That is a ToS grey area — do not enable this in a distributed build.
 *
 * We don't run our own OAuth flow: if the user has logged into Claude Code on
 * this machine, the token already sits at ~/.claude/.credentials.json. We read
 * it, refresh it when it's near expiry, and hand the access token to the SDK.
 *
 * ponytail: macOS stores these creds in the Keychain, not this file. Handle the
 * `security find-generic-password -s "Claude Code-credentials"` path only if a
 * mac user actually needs it.
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CREDENTIALS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");

// Well-known public Claude Code OAuth client (reverse-engineered; Anthropic can
// rotate these). Only used to refresh an already-issued token.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";

/** Refresh when the token has under this long left, to avoid mid-request expiry. */
const REFRESH_SKEW_MS = 60_000;

interface OAuthCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scopes?: string[];
  subscriptionType?: string;
}

async function readFileCreds(): Promise<OAuthCreds | null> {
  try {
    const raw = await fs.readFile(CREDENTIALS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { claudeAiOauth?: OAuthCreds };
    const o = parsed.claudeAiOauth;
    if (o?.accessToken && o.refreshToken) return o;
    return null;
  } catch {
    return null;
  }
}

async function writeFileCreds(creds: OAuthCreds): Promise<void> {
  await fs.writeFile(
    CREDENTIALS_PATH,
    JSON.stringify({ claudeAiOauth: creds }, null, 2),
    "utf-8",
  );
}

async function refresh(creds: OAuthCreds): Promise<OAuthCreds> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Claude OAuth refresh failed (${res.status}). Re-run \`claude login\`.`,
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  const next: OAuthCreds = {
    ...creds,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? creds.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await writeFileCreds(next);
  return next;
}

/** True if a usable Claude Code login exists on disk. */
export async function hasClaudeOAuth(): Promise<boolean> {
  return (await readFileCreds()) !== null;
}

/**
 * Cheap synchronous existence check for the sync `hasKey()` gate. Doesn't
 * validate/parse — the real `complete()` call refreshes and errors if invalid.
 */
export function hasClaudeOAuthSync(): boolean {
  return existsSync(CREDENTIALS_PATH);
}

/**
 * A valid (refreshed if needed) access token, or null if the user hasn't
 * logged into Claude Code. Callers fall back to API-key auth on null.
 */
export async function getClaudeAccessToken(): Promise<string | null> {
  let creds = await readFileCreds();
  if (!creds) return null;
  if (Date.now() >= creds.expiresAt - REFRESH_SKEW_MS) {
    creds = await refresh(creds);
  }
  return creds.accessToken;
}
