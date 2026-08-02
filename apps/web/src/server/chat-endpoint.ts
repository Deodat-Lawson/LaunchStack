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

import {
  ChatConfigurationError,
  type ChatEndpointConfig,
} from "@launchstack/core/llm/types";

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
   * Read only to explain a failure. A bare credential no longer selects an
   * endpoint: there are no built-in vendor URLs, so a key on its own says
   * nothing about where to send the request. See {@link BARE_CREDENTIALS}.
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
  OPENROUTER_MODEL?: string;
  /** @deprecated Model selection moved to the configuration file. */
  CHAT_MODEL?: string;
}

export const DEFAULT_CHAT_CONFIG_PATH = "config/chat-models.yaml";

export function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text.length > 0 ? text : undefined;
}

/**
 * Credentials that used to imply a vendor's URL. They no longer do — the
 * mapping key-to-endpoint is exactly the vendor lock-in this module exists to
 * avoid, and a built-in default silently decides on the operator's behalf
 * where their prompts and their key are sent. Listed here only so
 * {@link resolveChatEndpoint} can say why a key alone was not enough.
 */
const BARE_CREDENTIALS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY"] as const;

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
  server: AppChatModelEnvironment,
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

/** The endpoint every route talks to, from the environment alone. */
export function resolveChatEndpoint(
  server: AppChatModelEnvironment,
): ChatEndpointConfig {
  const baseUrl = trimmed(server.CHAT_BASE_URL);
  if (baseUrl) {
    return { baseUrl, apiKey: trimmed(server.CHAT_API_KEY) };
  }

  const legacy = translateLegacyEndpoint(server);
  if (!legacy) {
    const bare = BARE_CREDENTIALS.filter((name) => trimmed(server[name]));
    throw new ChatConfigurationError(
      "CHAT_BASE_URL is not set. Point it at an OpenAI-compatible chat endpoint " +
        "(and set CHAT_API_KEY when that endpoint requires a credential)." +
        (bare.length
          ? ` ${bare.join(" and ")} ${bare.length > 1 ? "are" : "is"} set, but a credential ` +
            "no longer selects an endpoint — there is no built-in default URL. " +
            "Set CHAT_BASE_URL explicitly."
          : ""),
    );
  }
  if (legacy.deprecation) console.warn(legacy.deprecation);
  return legacy.endpoint;
}

/**
 * Pre-PR variables that used to choose a *model*. Model ids now live in the
 * configuration file, so these are inert — and an inert variable that used to
 * work is worth a warning, not silence: an operator who set
 * `OPENROUTER_MODEL=vendor/x` and still sees a different model answering
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
  "OPENROUTER_MODEL",
  "ANTHROPIC_MODEL",
  "GOOGLE_MODEL",
] as const;

export function findIgnoredModelVariables(
  environment: Record<string, string | undefined>,
): string[] {
  return IGNORED_MODEL_VARIABLES.filter((name) => trimmed(environment[name]));
}
