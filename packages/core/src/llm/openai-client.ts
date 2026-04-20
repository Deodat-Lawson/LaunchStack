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

let _client: OpenAI | null = null;
let _clientKey: string | null = null;

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
  if (_client && _clientKey === cacheKey) return _client;

  _client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  _clientKey = cacheKey;
  return _client;
}
