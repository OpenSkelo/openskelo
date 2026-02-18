import { afterEach, describe, expect, it } from "vitest";
import { loginOpenAIOAuth, refreshOpenAIOAuthToken } from "../src/core/oauth";

function withFetchMock(mock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (mock as unknown) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("openai oauth helpers", () => {
  afterEach(() => {
    // noop, fetch restored per test
  });

  it("refreshOpenAIOAuthToken parses success payload", async () => {
    const jwt = `aaa.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" } })).toString("base64url")}.bbb`;
    const restore = withFetchMock(async () => {
      return new Response(JSON.stringify({
        access_token: jwt,
        refresh_token: "refresh-new",
        token_type: "Bearer",
        expires_in: 3600,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    try {
      const res = await refreshOpenAIOAuthToken("refresh-old");
      expect(res.access_token).toBe(jwt);
      expect(res.refresh_token).toBe("refresh-new");
      expect(res.account_id).toBe("acct_123");
      expect(res.token_type).toBe("Bearer");
    } finally {
      restore();
    }
  });

  it("loginOpenAIOAuth falls back to manual prompt when callback not received", async () => {
    let authUrl = "";
    const restore = withFetchMock(async (_input, _init) => {
      return new Response(JSON.stringify({
        access_token: "tok",
        refresh_token: "ref",
        token_type: "Bearer",
        expires_in: 1200,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    try {
      const out = await loginOpenAIOAuth({
        onAuthUrl: async (url) => {
          authUrl = url;
        },
        onPrompt: async () => "manual-auth-code",
        timeoutMs: 5,
      });

      expect(authUrl).toContain("auth.openai.com/oauth/authorize");
      expect(out.access_token).toBe("tok");
      expect(out.refresh_token).toBe("ref");
    } finally {
      restore();
    }
  });
});
