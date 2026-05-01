/**
 * Shared OpenAI client for subsystems that need the raw `openai` SDK
 * (chunker, enrichment, embeddings fallback path). Reads credentials from
 * the same ChatModelsConfig registered via configureChatModels, so the
 * hosting app only wires once.
 *
 * Lazy — the client is only instantiated on first use, which keeps the
 * openai package out of cold-start for subsystems that never call it.
 */

import OpenAI from "openai";

import { getChatModelsConfig } from "./chat-model-factory";
import { createSlot } from "../internal/slot";

const clientSlot = createSlot<{ client: OpenAI; key: string }>(
  "llm/openaiClient",
);

/**
 * Returns an OpenAI SDK client configured from the registered
 * ChatModelsConfig. Returns null if no API key is available — callers
 * should check before making a request.
 */
export function getOpenAIClient(): OpenAI | null {
  const config = getChatModelsConfig();
  const apiKey = config.openai?.apiKey ?? config.aiApiKey;
  if (!apiKey) return null;

  const baseURL = config.aiBaseUrl;
  const cacheKey = `${apiKey}:${baseURL ?? ""}`;
  const cached = clientSlot.get();
  if (cached && cached.key === cacheKey) return cached.client;

  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  clientSlot.set({ client, key: cacheKey });
  return client;
}
