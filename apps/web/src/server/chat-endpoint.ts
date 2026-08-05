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
  /** Pre-PR OpenAI credential accepted as a one-release deployment fallback. */
  OPENAI_API_KEY?: string;
  /** Read only to explain why a bare OpenRouter credential is insufficient. */
  OPENROUTER_API_KEY?: string;
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
const LEGACY_OPENAI_BASE_URL = "https://api.openai.com/v1";

export function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text.length > 0 ? text : undefined;
}

/**
 * A bare OpenRouter credential cannot identify which compatible endpoint the
 * operator intended. Keep it only so configuration errors name the omission.
 */
const BARE_CREDENTIALS = ["OPENROUTER_API_KEY"] as const;

/**
 * Map supported pre-PR configuration onto the canonical chat endpoint.
 *
 * `AI_BASE_URL`/`AI_API_KEY` are a straight rename. For one release, an
 * otherwise-unconfigured `OPENAI_API_KEY` retains the pre-PR OpenAI endpoint
 * behavior so deployed environments can migrate without an outage.
 */
export function translateLegacyEndpoint(
  server: AppChatModelEnvironment,
): { endpoint: ChatEndpointConfig; deprecation?: string } | undefined {
  const baseUrl = trimmed(server.AI_BASE_URL);
  if (!baseUrl) {
    const apiKey = trimmed(server.OPENAI_API_KEY);
    if (!apiKey) return undefined;

    return {
      endpoint: { baseUrl: LEGACY_OPENAI_BASE_URL, apiKey },
      deprecation:
        "[chat] OPENAI_API_KEY without CHAT_BASE_URL is deprecated and will be " +
        `removed next release. Set CHAT_BASE_URL=${LEGACY_OPENAI_BASE_URL} and ` +
        "CHAT_API_KEY instead.",
    };
  }

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
