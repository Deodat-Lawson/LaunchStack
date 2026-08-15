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
import { GEMINI_BASE_URL } from "./types";

export interface AuxiliaryOpenAIConfig {
    /**
     * Credential for {@link baseUrl}. Belongs to whatever service that URL names,
     * and is only ever sent there.
     */
    apiKey?: string;
    /** OpenAI-compatible base URL the operator named, if any. */
    baseUrl?: string;
    /**
     * Credential for the Gemini fallback, kept separate on purpose.
     *
     * {@link apiKey} may hold an OpenAI or other vendor's key. Defaulting the URL
     * to Gemini while reusing that key would post it to Google — the precise
     * failure this split exists to prevent. The fallback only fires when a Google
     * credential is present to pair with it.
     */
    googleApiKey?: string;
}

const configSlot = createSlot<AuxiliaryOpenAIConfig>("llm/auxiliaryOpenAI");
const clientSlot = createSlot<{ client: OpenAI; key: string }>("llm/auxiliaryOpenAIClient");

/** Install credentials for the non-chat OpenAI-compatible subsystems. */
export function configureAuxiliaryOpenAI(config: AuxiliaryOpenAIConfig): void {
    configSlot.set(config);
}

export function getAuxiliaryOpenAIConfig(): AuxiliaryOpenAIConfig {
    return configSlot.get() ?? {};
}

/**
 * Returns a client for the auxiliary OpenAI-compatible endpoint, or null when
 * nothing usable is configured — callers must check before making a request.
 *
 * Endpoint and credential are resolved as a PAIR, never independently:
 *
 *   1. The operator named a URL — use it with its own key.
 *   2. Nothing named a URL — fall back to Gemini, but only with the Google
 *      credential. A key belonging to another vendor is never carried along.
 *
 * A key with no URL and no Google credential is unusable rather than a licence
 * to pick a host for it. That is the whole point: the SDK's implicit
 * `api.openai.com` and a naive Gemini default are the same mistake pointed at
 * different companies.
 */
export function getOpenAIClient(): OpenAI | null {
    const { apiKey, baseUrl, googleApiKey } = getAuxiliaryOpenAIConfig();

    const resolved = baseUrl
        ? apiKey
            ? { apiKey, baseUrl }
            : null
        : googleApiKey
          ? { apiKey: googleApiKey, baseUrl: GEMINI_BASE_URL }
          : null;

    if (!resolved) {
        if (apiKey && !baseUrl) {
            console.warn(
                "[llm] An auxiliary credential is set but no endpoint names where it " +
                    "belongs, and no GOOGLE_AI_API_KEY is available for the Gemini " +
                    "default. Set AI_BASE_URL to pair it, or GOOGLE_AI_API_KEY to use " +
                    "Gemini. The key will not be sent anywhere."
            );
        }
        return null;
    }

    const cacheKey = `${resolved.apiKey}:${resolved.baseUrl}`;
    const cached = clientSlot.get();
    if (cached && cached.key === cacheKey) return cached.client;

    const client = new OpenAI({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
    });
    clientSlot.set({ client, key: cacheKey });
    return client;
}
