import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export interface OpenAIOAuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string;
  account_id?: string;
}

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_SCOPE = "openid profile email offline_access";

const SUCCESS_HTML = `<!doctype html>
<html><body><p>Authentication successful. Return to your terminal.</p></body></html>`;

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function createState(): string {
  return randomBytes(16).toString("hex");
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // continue
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }

  return { code: value };
}

function decodeJwtAccountId(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = parts[1] ?? "";
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const auth = parsed["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    const accountId = auth?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
  } catch {
    return undefined;
  }
}

async function exchangeAuthorizationCode(params: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OPENAI_CLIENT_ID,
    code: params.code,
    code_verifier: params.verifier,
    redirect_uri: params.redirectUri,
  });

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token exchange failed (${response.status}): ${text || response.statusText}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const access = String(json.access_token ?? "");
  const refresh = String(json.refresh_token ?? "");
  const tokenType = String(json.token_type ?? "Bearer");
  const expiresIn = Number(json.expires_in ?? 3600);
  if (!access || !refresh) throw new Error("Token exchange response missing access_token/refresh_token");

  return {
    access_token: access,
    refresh_token: refresh,
    token_type: tokenType,
    expires_at: new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString(),
    account_id: decodeJwtAccountId(access),
  };
}

export async function refreshOpenAIOAuthToken(refreshToken: string): Promise<OpenAIOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OPENAI_CLIENT_ID,
  });

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OAuth refresh failed (${response.status}): ${text || response.statusText}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const access = String(json.access_token ?? "");
  const refresh = String(json.refresh_token ?? refreshToken);
  const tokenType = String(json.token_type ?? "Bearer");
  const expiresIn = Number(json.expires_in ?? 3600);
  if (!access) throw new Error("OAuth refresh response missing access_token");

  return {
    access_token: access,
    refresh_token: refresh,
    token_type: tokenType,
    expires_at: new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString(),
    account_id: decodeJwtAccountId(access),
  };
}

async function startCallbackServer(preferredPort = 1455): Promise<{
  redirectUri: string;
  waitForCode: (timeoutMs?: number) => Promise<{ code: string; state: string } | null>;
  close: () => void;
}> {
  let result: { code: string; state: string } | null = null;
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        res.statusCode = 400;
        res.end("Missing code/state");
        return;
      }
      result = { code, state };
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(SUCCESS_HTML);
    } catch {
      res.statusCode = 500;
      res.end("Internal error");
    }
  });

  async function listenPort(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        const addr = server.address();
        resolve(typeof addr === "object" && addr?.port ? addr.port : port);
      });
    });
  }

  let port: number;
  try {
    port = await listenPort(preferredPort);
  } catch {
    port = await listenPort(0);
  }

  return {
    redirectUri: `http://127.0.0.1:${port}/auth/callback`,
    waitForCode: async (timeoutMs = 120_000) => {
      const start = Date.now();
      while (!result && Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return result;
    },
    close: () => server.close(),
  };
}

function buildAuthorizeUrl(params: {
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(OPENAI_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", OPENAI_SCOPE);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "skelo");
  return url.toString();
}

export async function loginOpenAIOAuth(params: {
  onAuthUrl: (url: string) => Promise<void> | void;
  onPrompt: (message: string) => Promise<string>;
  onProgress?: (message: string) => void;
  timeoutMs?: number;
}): Promise<OpenAIOAuthTokens> {
  const { verifier, challenge } = createPkce();
  const state = createState();
  const server = await startCallbackServer(1455);

  try {
    const authUrl = buildAuthorizeUrl({ redirectUri: server.redirectUri, challenge, state });
    await params.onAuthUrl(authUrl);

    const totalTimeoutMs = params.timeoutMs ?? 120_000;
    const prePromptWaitMs = Math.min(30_000, totalTimeoutMs);
    const hintAtMs = Math.min(12_000, Math.max(2_000, prePromptWaitMs - 1_000));

    const hintTimer = setTimeout(() => {
      params.onProgress?.("Still waiting for browser redirect... You can also paste the redirect URL below soon.");
    }, hintAtMs);

    const callbackResult = await server.waitForCode(prePromptWaitMs);
    clearTimeout(hintTimer);

    let code: string | undefined;

    if (callbackResult) {
      if (callbackResult.state !== state) throw new Error("State mismatch in callback");
      code = callbackResult.code;
    }

    if (!code) {
      const manual = await params.onPrompt("Paste the redirect URL (or authorization code):");
      const parsed = parseAuthorizationInput(manual);
      if (parsed.state && parsed.state !== state) throw new Error("State mismatch");
      code = parsed.code;
    }

    if (!code) throw new Error("Missing authorization code");
    return await exchangeAuthorizationCode({ code, verifier, redirectUri: server.redirectUri });
  } finally {
    server.close();
  }
}
