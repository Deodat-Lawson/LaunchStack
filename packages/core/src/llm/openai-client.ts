/**
 * Shared OpenAI SDK client for **non-chat** subsystems: the OCR chunker, VLM
 * enrichment, and the embeddings fallback path.
 *
 * Deliberately configured separately from the chat endpoint. Those subsystems
 * have their own model requirements and often their own provider, and
 * borrowing the chat credential for them is exactly the cross-service key
 * reuse this architecture forbids. Hosts wire it from their auxiliary AI
 * settings, never from `CHAT_BASE_URL` / `CHAT_API_KEY`.
 *
 * Lazy — the client is only instantiated on first use, which keeps the
 * openai package out of cold-start for subsystems that never call it.
 */

import OpenAI from "openai";

import { createSlot } from "../internal/slot";

export interface AuxiliaryOpenAIConfig {
  apiKey?: string;
  /** OpenAI-compatible base URL. Omit for api.openai.com. */
  baseUrl?: string;
}

const configSlot = createSlot<AuxiliaryOpenAIConfig>("llm/auxiliaryOpenAI");
const clientSlot = createSlot<{ client: OpenAI; key: string }>(
  "llm/auxiliaryOpenAIClient",
);

/** Install credentials for the non-chat OpenAI-compatible subsystems. */
export function configureAuxiliaryOpenAI(config: AuxiliaryOpenAIConfig): void {
  configSlot.set(config);
}

export function getAuxiliaryOpenAIConfig(): AuxiliaryOpenAIConfig {
  return configSlot.get() ?? {};
}

/**
 * Returns a client for the auxiliary OpenAI-compatible endpoint, or null when
 * no credential is configured — callers must check before making a request.
 */
export function getOpenAIClient(): OpenAI | null {
  const { apiKey, baseUrl } = getAuxiliaryOpenAIConfig();
  if (!apiKey) return null;

  const cacheKey = `${apiKey}:${baseUrl ?? ""}`;
  const cached = clientSlot.get();
  if (cached && cached.key === cacheKey) return cached.client;

  const client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  clientSlot.set({ client, key: cacheKey });
  return client;
}
