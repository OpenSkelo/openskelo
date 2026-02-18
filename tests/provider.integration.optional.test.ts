import { describe, it, expect } from "vitest";
import { createOllamaProvider } from "../src/core/ollama-provider";
import { createOpenAICompatibleProvider } from "../src/core/openai-compatible-provider";

const runOptional = process.env.OPENSKELO_RUN_PROVIDER_INTEGRATION === "1";

describe("optional real provider integration profile", () => {
  it.skipIf(!runOptional)("ollama adapter can be constructed for real integration runs", async () => {
    const provider = createOllamaProvider({
      baseUrl: process.env.OPENSKELO_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      model: process.env.OPENSKELO_OLLAMA_MODEL ?? "llama3.1",
      timeoutMs: Number(process.env.OPENSKELO_OLLAMA_TIMEOUT_MS ?? "15000"),
    });
    expect(provider.name).toBe("ollama");
    expect(provider.type).toBe("ollama");
  });

  it.skipIf(!runOptional)("openai-compatible adapter can be constructed for real integration runs", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: process.env.OPENSKELO_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: process.env.OPENSKELO_OPENAI_MODEL ?? "gpt-4o-mini",
      apiKeyEnv: process.env.OPENSKELO_OPENAI_APIKEY_ENV ?? "OPENAI_API_KEY",
      timeoutMs: Number(process.env.OPENSKELO_OPENAI_TIMEOUT_MS ?? "15000"),
    });
    expect(provider.name).toBe("openai-compatible");
    expect(provider.type).toBe("openai-compatible");
  });
});
