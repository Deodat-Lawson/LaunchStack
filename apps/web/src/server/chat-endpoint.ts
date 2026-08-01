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
  /** @deprecated Pre-PR OpenRouter selection. */
  OPENROUTER_API_KEY?: string;
  /** @deprecated Pre-PR OpenAI selection. */
  OPENAI_API_KEY?: string;
  /** @deprecated Pre-PR Ollama selection. */
  OLLAMA_BASE_URL?: string;
  /** @deprecated Model selection moved to the configuration file. */
  OPENROUTER_MODEL?: string;
  /** @deprecated Model selection moved to the configuration file. */
  CHAT_MODEL?: string;
}

export const DEFAULT_CHAT_CONFIG_PATH = "config/chat-models.yaml";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

export function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text.length > 0 ? text : undefined;
}

/**
 * Map documented pre-PR variables onto the single endpoint — but only when
 * they unambiguously describe one.
 *
 * Two *chat* endpoints configured at once used to mean "pick one at runtime";
 * under a single endpoint it has no meaning, so it is an error rather than a
 * guess. A credential is only ever paired with its own service's URL:
 * borrowing, say, OPENAI_API_KEY for an OpenRouter base URL would ship
 * someone's key to the wrong company.
 *
 * OPENAI_API_KEY is deliberately the lowest-priority signal, because unlike
 * the others it has a documented second job: it is the credential for
 * embeddings, OCR/VLM enrichment, and chunking. "OpenRouter for chat, OpenAI
 * for embeddings" is a recommended pairing, so its presence alongside a real
 * chat variable is not a conflict — it is that other job. It names the chat
 * endpoint only when nothing else does.
 */
export function translateLegacyEndpoint(
  server: AppChatModelEnvironment,
): { endpoint: ChatEndpointConfig; deprecation?: string } | undefined {
  const candidates: { endpoint: ChatEndpointConfig; source: string }[] = [];

  const aiBaseUrl = trimmed(server.AI_BASE_URL);
  if (aiBaseUrl) {
    candidates.push({
      endpoint: { baseUrl: aiBaseUrl, apiKey: trimmed(server.AI_API_KEY) },
      source: "AI_BASE_URL/AI_API_KEY",
    });
  }

  const openRouterKey = trimmed(server.OPENROUTER_API_KEY);
  if (openRouterKey) {
    candidates.push({
      endpoint: { baseUrl: OPENROUTER_BASE_URL, apiKey: openRouterKey },
      source: "OPENROUTER_API_KEY",
    });
  }

  const ollamaBaseUrl = trimmed(server.OLLAMA_BASE_URL);
  if (ollamaBaseUrl) {
    candidates.push({
      // Ollama's OpenAI-compatible surface lives under /v1 and needs no key.
      endpoint: {
        baseUrl: ollamaBaseUrl.replace(/\/+$/, "").endsWith("/v1")
          ? ollamaBaseUrl.replace(/\/+$/, "")
          : `${ollamaBaseUrl.replace(/\/+$/, "")}/v1`,
      },
      source: "OLLAMA_BASE_URL",
    });
  }

  if (candidates.length > 1) {
    throw new ChatConfigurationError(
      `Deprecated chat variables describe more than one endpoint (${candidates.map((c) => c.source).join(", ")}). ` +
        `This release serves one endpoint: set CHAT_BASE_URL (and CHAT_API_KEY if required) and remove the others.`,
    );
  }

  // Fallback only — see the note above on OPENAI_API_KEY's second job.
  const openAiKey = trimmed(server.OPENAI_API_KEY);
  if (candidates.length === 0 && openAiKey) {
    candidates.push({
      endpoint: { baseUrl: OPENAI_BASE_URL, apiKey: openAiKey },
      source: "OPENAI_API_KEY",
    });
  }

  const only = candidates[0];
  if (!only) return undefined;
  return {
    endpoint: only.endpoint,
    deprecation:
      `[chat] ${only.source} is deprecated and will be removed next release. ` +
      `Set CHAT_BASE_URL=${only.endpoint.baseUrl}${only.endpoint.apiKey ? " and CHAT_API_KEY" : ""} instead.`,
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
    throw new ChatConfigurationError(
      "CHAT_BASE_URL is not set. Point it at an OpenAI-compatible chat endpoint " +
        "(and set CHAT_API_KEY when that endpoint requires a credential).",
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
