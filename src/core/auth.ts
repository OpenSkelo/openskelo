import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { refreshOpenAIOAuthToken } from "./oauth.js";

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

  const refreshed = await refreshOpenAIOAuthToken(entry.refresh_token);
  return {
    ...entry,
    type: "oauth",
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    token_type: refreshed.token_type,
    expires_at: refreshed.expires_at,
    account_id: refreshed.account_id ?? entry.account_id,
  };
}
