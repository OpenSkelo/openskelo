import { OpenAIProvider } from "./openai.js";

export function createOpenRouterProvider(apiKey: string): OpenAIProvider {
  return new OpenAIProvider(apiKey, "https://openrouter.ai/api/v1", "openrouter");
}
