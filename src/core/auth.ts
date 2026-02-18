import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

export interface AuthEntry {
  type: "oauth" | "api_key";
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  token_type?: string;
  account_id?: string;
  created_at: string;
}

export interface AuthStore {
  version: 1;
  providers: Record<string, AuthEntry>;
}

function authPath(): string {
  return process.env.SKELO_AUTH_PATH
    ? resolve(process.env.SKELO_AUTH_PATH)
    : resolve(homedir(), ".skelo", "auth.json");
}

export function getAuthPath(): string {
  return authPath();
}

export function loadAuthStore(): AuthStore | null {
  const path = authPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as Partial<AuthStore>;
  if (parsed.version !== 1 || !parsed.providers || typeof parsed.providers !== "object") {
    throw new Error("Invalid auth store format in ~/.skelo/auth.json");
  }
  return parsed as AuthStore;
}

export function saveAuthStore(store: AuthStore): void {
  const path = authPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort on platforms where chmod may not be meaningful
  }
}

export function getProviderAuthEntry(providerTypeOrName: string): AuthEntry | null {
  const store = loadAuthStore();
  if (!store) return null;
  return store.providers[providerTypeOrName] ?? null;
}

export function getProviderToken(providerTypeOrName: string): string | null {
  const entry = getProviderAuthEntry(providerTypeOrName);
  if (!entry) return null;
  if (entry.type === "api_key") return entry.api_key ?? null;
  if (entry.type === "oauth") return entry.access_token ?? null;
  return null;
}

export function isTokenExpired(entry: AuthEntry, skewMs = 5 * 60 * 1000): boolean {
  if (entry.type !== "oauth") return false;
  if (!entry.expires_at) return true;
  const expiresAt = Date.parse(entry.expires_at);
  if (!Number.isFinite(expiresAt)) return true;
  return Date.now() + skewMs >= expiresAt;
}

export async function refreshOAuthToken(entry: AuthEntry): Promise<AuthEntry> {
  if (entry.type !== "oauth") throw new Error("refreshOAuthToken requires oauth entry");
  if (!entry.refresh_token) throw new Error("Missing refresh_token");

  const clientId = process.env.OPENAI_PUBLIC_CLIENT_ID;
  if (!clientId) throw new Error("OPENAI_PUBLIC_CLIENT_ID is required for OAuth refresh");

  const tokenUrl = process.env.OPENAI_OAUTH_TOKEN_URL ?? "https://auth.openai.com/oauth/token";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: entry.refresh_token,
    client_id: clientId,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`OAuth refresh failed (${res.status}): ${text || res.statusText}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const access = String(data.access_token ?? "");
  if (!access) throw new Error("OAuth refresh response missing access_token");
  const refresh = String(data.refresh_token ?? entry.refresh_token ?? "");
  const expiresIn = Number(data.expires_in ?? 3600);

  return {
    ...entry,
    type: "oauth",
    access_token: access,
    refresh_token: refresh,
    token_type: String(data.token_type ?? entry.token_type ?? "Bearer"),
    expires_at: new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString(),
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
