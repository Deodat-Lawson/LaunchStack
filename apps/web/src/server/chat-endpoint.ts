/**
 * Resolving *which endpoint* chat talks to, from the environment alone.
 *
 * Deliberately a leaf module. `env.ts` imports this, and `env.ts` is imported
 * by nearly every server module plus `next.config.ts` at build time — so
 * pulling in the `@launchstack/core/llm` barrel here would eagerly load
 * `ChatOpenAI`, the `openai` SDK, `yaml`, and `zod-to-json-schema` into all of
 * them. Only `@launchstack/core/llm/types` is imported, which has no imports
 * of its own. Reading and validating the model *file* lives in
 * `./chat-models`, which nothing on the env path touches.
 */

import { GEMINI_BASE_URL, type ChatEndpointConfig } from "@launchstack/core/llm/types";

/**
 * Environment the chat layer reads.
 *
 * Only three variables matter going forward: where the endpoint is, how to
 * authenticate to it, and which configuration file describes the models. The
 * rest are pre-PR names kept alive for one release; see
 * {@link translateLegacyEndpoint}.
 */
export interface AppChatModelEnvironment {
    CHAT_BASE_URL?: string;
    CHAT_API_KEY?: string;
    CHAT_MODELS_CONFIG?: string;
    /** @deprecated Pre-PR name for CHAT_BASE_URL. */
    AI_BASE_URL?: string;
    /** @deprecated Pre-PR name for CHAT_API_KEY. */
    AI_API_KEY?: string;
    /**
     * The credential for the default Gemini endpoint. Paired with
     * {@link GEMINI_BASE_URL} — never with an operator-supplied CHAT_BASE_URL,
     * which takes its key from CHAT_API_KEY.
     *
     * Deliberately the only spelling. Google AI Studio calls it a "Gemini API
     * key", but adding a GEMINI_API_KEY alias would mean declaring it in
     * `env.ts` too, and a second name for one credential is a second thing to
     * get wrong.
     */
    GOOGLE_AI_API_KEY?: string;
    /**
     * Read only to explain where a key did *not* go. These name a vendor other
     * than the default one, so they select nothing: a key on its own says
     * nothing about where to send the request, and pairing it with the Gemini
     * URL would post an OpenAI or OpenRouter credential to Google. See
     * {@link MISPAIRED_CREDENTIALS}.
     */
    OPENROUTER_API_KEY?: string;
    OPENAI_API_KEY?: string;
    /**
     * Declared because the environment still carries it — it configures the
     * Ollama *embeddings* provider — but deliberately ignored for chat. Ollama
     * speaks the OpenAI chat-completions protocol, so it is reached through
     * CHAT_BASE_URL like every other endpoint.
     */
    OLLAMA_BASE_URL?: string;
    /** @deprecated Model selection moved to the configuration file. */
    CHAT_MODEL?: string;
}

export const DEFAULT_CHAT_CONFIG_PATH = "config/chat-models.yaml";

export function trimmed(value: string | undefined): string | undefined {
    const text = value?.trim();
    return text && text.length > 0 ? text : undefined;
}

/**
 * Credentials belonging to a vendor other than the default one.
 *
 * Chat falls back to Gemini, so a key for a *different* service cannot be
 * carried along: sending an `sk-…` to `generativelanguage.googleapis.com`
 * would hand an OpenAI credential to Google. Each of these still names no
 * endpoint. They are listed only so {@link resolveChatEndpoint} can explain
 * that the request went to the default endpoint *without* them, and which
 * variable to set to change that.
 */
const MISPAIRED_CREDENTIALS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY"] as const;

/**
 * Messages already emitted. `next build` evaluates this module in every render
 * worker and every route that imports `~/env`, which turned one misconfigured
 * deployment into a dozen identical lines in the build log. Deduplicating keeps
 * the warning legible without weakening it — a distinct message still prints.
 */
const warnedMessages = new Set<string>();

function warnOnce(message: string): void {
    if (warnedMessages.has(message)) return;
    warnedMessages.add(message);
    console.warn(message);
}

/** Test seam: forget which warnings have been emitted. */
export function resetChatEndpointWarnings(): void {
    warnedMessages.clear();
}

/**
 * Map the one surviving pre-PR alias onto the endpoint.
 *
 * `AI_BASE_URL`/`AI_API_KEY` are a straight rename of `CHAT_BASE_URL`/
 * `CHAT_API_KEY`: the operator writes the URL either way, so translating them
 * infers nothing.
 *
 * No variable names a *provider*. Ollama, OpenRouter and OpenAI all serve the
 * OpenAI chat-completions protocol, so each is reached through CHAT_BASE_URL
 * like any other endpoint. A per-vendor variable bought only a vendor to
 * maintain — and, for the two that mapped a bare key to a URL, a destination
 * chosen on the operator's behalf.
 */
export function translateLegacyEndpoint(
    server: AppChatModelEnvironment
): { endpoint: ChatEndpointConfig; deprecation?: string } | undefined {
    const baseUrl = trimmed(server.AI_BASE_URL);
    if (!baseUrl) return undefined;

    const endpoint: ChatEndpointConfig = {
        baseUrl,
        apiKey: trimmed(server.AI_API_KEY),
    };
    return {
        endpoint,
        deprecation:
            "[chat] AI_BASE_URL/AI_API_KEY are deprecated and will be removed next " +
            `release. Set CHAT_BASE_URL=${baseUrl}` +
            `${endpoint.apiKey ? " and CHAT_API_KEY" : ""} instead.`,
    };
}

/**
 * The endpoint every route talks to, from the environment alone.
 *
 * Order: CHAT_BASE_URL, then the AI_BASE_URL alias, then the built-in Gemini
 * default. Explicit configuration always wins; the default exists so a
 * deployment that names no endpoint still boots and still answers.
 *
 * This never throws. Chat resolution used to be able to fail startup — that
 * is what made a missing CHAT_BASE_URL a build-time error — and with a default
 * in place there is no longer a state it can fail in.
 */
export function resolveChatEndpoint(server: AppChatModelEnvironment): ChatEndpointConfig {
    const baseUrl = trimmed(server.CHAT_BASE_URL);
    if (baseUrl) {
        return { baseUrl, apiKey: trimmed(server.CHAT_API_KEY) };
    }

    const legacy = translateLegacyEndpoint(server);
    if (legacy) {
        if (legacy.deprecation) warnOnce(legacy.deprecation);
        return legacy.endpoint;
    }

    // Nothing named an endpoint. Fall back to Gemini, paired only with a Google
    // credential — a key for another vendor is reported, never forwarded.
    const geminiKey = trimmed(server.GOOGLE_AI_API_KEY);
    const mispaired = MISPAIRED_CREDENTIALS.filter(name => trimmed(server[name]));

    if (!geminiKey) {
        warnOnce(
            "[chat] No CHAT_BASE_URL set, so chat defaults to Gemini " +
                `(${GEMINI_BASE_URL}) — but GOOGLE_AI_API_KEY is not set either, so ` +
                "requests will be rejected as unauthenticated." +
                (mispaired.length
                    ? ` ${mispaired.join(" and ")} ${mispaired.length > 1 ? "are" : "is"} set, ` +
                      `but ${mispaired.length > 1 ? "they belong" : "it belongs"} to another ` +
                      "service and will not be sent to Google. Set CHAT_BASE_URL and " +
                      "CHAT_API_KEY to use that service instead."
                    : " Set GOOGLE_AI_API_KEY, or point CHAT_BASE_URL elsewhere.")
        );
    }

    return { baseUrl: GEMINI_BASE_URL, apiKey: geminiKey };
}

/**
 * Pre-PR variables that used to choose a *model*. Model ids now live in the
 * configuration file, so these are inert — and an inert variable that used to
 * work is worth a warning, not silence: an operator who set
 * `CHAT_MODEL=some-model` and still sees a different model answering
 * deserves to be told why rather than left to guess.
 */
const IGNORED_MODEL_VARIABLES = [
    "CHAT_MODEL",
    "CHAT_CAPABILITIES",
    "CHAT_PROVIDER",
    "CHAT_FAST_MODEL",
    "CHAT_REASONING_MODEL",
    "CHAT_VISION_MODEL",
    "CHAT_STRUCTURED_MODEL",
    "GOOGLE_MODEL",
] as const;

export function findIgnoredModelVariables(
    environment: Record<string, string | undefined>
): string[] {
    return IGNORED_MODEL_VARIABLES.filter(name => trimmed(environment[name]));
}
