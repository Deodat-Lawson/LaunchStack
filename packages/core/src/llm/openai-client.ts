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
  /**
   * OpenAI-compatible base URL. Required — omitting it used to fall through to
   * the SDK's built-in api.openai.com default, which decided on the operator's
   * behalf where their documents and their key were sent.
   */
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
 * it is not fully configured — callers must check before making a request.
 *
 * Both a credential and a base URL are required. Passing only a key would let
 * the SDK fall back to its built-in api.openai.com default, which is the one
 * thing this module must not do: the endpoint is the operator's choice.
 */
export function getOpenAIClient(): OpenAI | null {
  const { apiKey, baseUrl } = getAuxiliaryOpenAIConfig();
  if (!apiKey) return null;
  if (!baseUrl) {
    console.warn(
      "[llm] Auxiliary OpenAI-compatible endpoint has a credential but no " +
        "baseUrl. Set it explicitly — there is no built-in default endpoint.",
    );
    return null;
  }

  const cacheKey = `${apiKey}:${baseUrl}`;
  const cached = clientSlot.get();
  if (cached && cached.key === cacheKey) return cached.client;

  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  clientSlot.set({ client, key: cacheKey });
  return client;
}
