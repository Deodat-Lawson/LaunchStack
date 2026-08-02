import { configureChatModels } from "@launchstack/core/llm";

/**
 * Configure the chat-model factory for a standalone benchmark run (test or
 * script) from environment variables. In the web app this is done inside
 * getEngine(); the benchmark runs outside that, so it must configure the judge
 * itself. Call once before scoring.
 */
export function configureJudgeFromEnv(): void {
  const openaiKey = process.env.OPENAI_API_KEY;
  const aiApiKey = process.env.AI_API_KEY;
  if (!openaiKey && !aiApiKey) {
    throw new Error(
      "Set OPENAI_API_KEY (or AI_API_KEY) before running the benchmark judge.",
    );
  }
  configureChatModels({
    aiBaseUrl: process.env.AI_BASE_URL,
    aiApiKey,
    openai: openaiKey ? { apiKey: openaiKey } : undefined,
  });
}
