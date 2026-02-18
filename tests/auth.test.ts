import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getProviderToken, isTokenExpired, loadAuthStore, saveAuthStore, type AuthStore } from "../src/core/auth";

describe("auth store", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    delete process.env.SKELO_AUTH_PATH;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function setTempAuthPath(): string {
    tempDir = mkdtempSync(join(tmpdir(), "skelo-auth-test-"));
    const p = join(tempDir, "auth.json");
    process.env.SKELO_AUTH_PATH = p;
    return p;
  }

  it("returns null when file is missing", () => {
    setTempAuthPath();
    expect(loadAuthStore()).toBeNull();
  });

  it("saves and loads valid auth store", () => {
    const p = setTempAuthPath();
    const store: AuthStore = {
      version: 1,
      providers: {
        openai: {
          type: "api_key",
          api_key: "sk-test",
          created_at: new Date().toISOString(),
        },
      },
    };
    saveAuthStore(store);
    const loaded = loadAuthStore();
    expect(loaded?.version).toBe(1);
    expect(loaded?.providers.openai?.type).toBe("api_key");

    const mode = statSync(p).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("resolves oauth and api key tokens", () => {
    setTempAuthPath();
    const store: AuthStore = {
      version: 1,
      providers: {
        openai: {
          type: "oauth",
          access_token: "oauth-token",
          refresh_token: "refresh-token",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          created_at: new Date().toISOString(),
        },
        openrouter: {
          type: "api_key",
          api_key: "sk-or-test",
          created_at: new Date().toISOString(),
        },
      },
    };
    saveAuthStore(store);

    expect(getProviderToken("openai")).toBe("oauth-token");
    expect(getProviderToken("openrouter")).toBe("sk-or-test");
    expect(getProviderToken("unknown")).toBeNull();
  });

  it("treats near-expiry oauth token as expired", () => {
    const expired = {
      type: "oauth" as const,
      access_token: "x",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
    };
    const nearExpiry = {
      type: "oauth" as const,
      access_token: "x",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    };

    expect(isTokenExpired(expired)).toBe(true);
    expect(isTokenExpired(nearExpiry)).toBe(true);
  });
});
