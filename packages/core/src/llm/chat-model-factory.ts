import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  ProviderDefaultModels,
  ProviderModelMap,
  isModelAllowedForProvider,
  type AIModelType,
  type LLMProvider,
} from "./types";

/**
 * Chat-model factory.
 *
 * API keys, base URLs, and per-provider model defaults come from a
 * ChatModelsConfig the hosting app registers via configureChatModels().
 */

const REASONING_MODELS: ReadonlySet<string> = new Set([
  "gpt-5-mini",
  "gpt-5-nano",
]);

export interface ChatModelsConfig {
  /** Global OpenAI-compatible fallback endpoint (AI_BASE_URL). */
  aiBaseUrl?: string;
  /** Global OpenAI-compatible key (AI_API_KEY). */
  aiApiKey?: string;
  openai?: { apiKey: string; model?: string; chatModel?: string };
  anthropic?: { apiKey: string; model?: string };
  google?: { apiKey: string; model?: string };
  ollama?: { baseUrl: string; model?: string };
}

let _config: ChatModelsConfig | null = null;

/**
 * Register chat-model config. apps/web/src/server/engine.ts calls this
 * during getEngine() initialization with the relevant slice of CoreConfig.
 */
export function configureChatModels(config: ChatModelsConfig): void {
  _config = config;
}

function getConfig(): ChatModelsConfig {
  return _config ?? {};
}

/** Exposed so sibling modules (openai-client) can read the same captured config. */
export function getChatModelsConfig(): ChatModelsConfig {
  return getConfig();
}

function isCustomProvider(): boolean {
  return !!getConfig().aiBaseUrl;
}

function getServerModelOverride(provider: LLMProvider): string | undefined {
  const c = getConfig();
  switch (provider) {
    case "openai":
      // CHAT_MODEL takes priority over OPENAI_MODEL (provider-agnostic naming)
      return c.openai?.chatModel ?? c.openai?.model;
    case "anthropic":
      return c.anthropic?.model;
    case "google":
      return c.google?.model;
    case "ollama":
      return c.ollama?.model;
  }
}

function coerceModel(
  provider: LLMProvider,
  requested?: AIModelType,
): string {
  // When using a custom OpenAI-compatible provider (AI_BASE_URL),
  // accept any model string — don't validate against the allowlist
  if (isCustomProvider() && provider === "openai") {
    if (requested) return requested;
    const envValue = getServerModelOverride(provider);
    if (envValue) return envValue;
    return ProviderDefaultModels[provider];
  }

  if (requested && isModelAllowedForProvider(provider, requested)) {
    return requested;
  }

  const envValue = getServerModelOverride(provider);
  if (envValue && isModelAllowedForProvider(provider, envValue)) {
    return envValue;
  }

  return ProviderDefaultModels[provider];
}

export function getProviderDefaultModel(provider: LLMProvider): string {
  return coerceModel(provider);
}

/** Base URL for the local Ollama HTTP API (used by ChatOllama only). */
export function getOllamaBaseUrl(): string {
  const url = getConfig().ollama?.baseUrl;
  if (!url) {
    throw new Error(
      "OLLAMA_BASE_URL is not set. Add it to your .env file (e.g. OLLAMA_BASE_URL=\"http://localhost:11434\").",
    );
  }
  return url;
}

export function getChatModelForProvider(opts: {
  provider: LLMProvider;
  model?: AIModelType;
  temperature?: number;
  timeoutMs?: number;
}): BaseChatModel {
  const { provider, temperature, timeoutMs } = opts;
  const modelName = coerceModel(provider, opts.model);
  const c = getConfig();

  // Skip allowlist validation when using a custom provider (AI_BASE_URL)
  if (!(isCustomProvider() && provider === "openai")) {
    if (!(ProviderModelMap[provider] as readonly string[]).includes(modelName)) {
      throw new Error(
        `Model \"${String(modelName)}\" is not supported for provider \"${String(provider)}\"`,
      );
    }
  }

  switch (provider) {
    case "ollama":
      return new ChatOllama({
        baseUrl: getOllamaBaseUrl(),
        model: modelName,
        temperature: temperature ?? 0.7,
      });

    case "anthropic":
      return new ChatAnthropic({
        anthropicApiKey: c.anthropic?.apiKey,
        modelName,
        temperature: temperature ?? 0.7,
      });

    case "google":
      return new ChatGoogleGenerativeAI({
        apiKey: c.google?.apiKey,
        model: modelName,
        temperature: temperature ?? 0.7,
      });

    case "openai":
    default: {
      const useTemp = !REASONING_MODELS.has(modelName);
      return new ChatOpenAI({
        apiKey: c.openai?.apiKey ?? c.aiApiKey,
        modelName,
        ...(useTemp ? { temperature: temperature ?? 0.7 } : {}),
        timeout: timeoutMs ?? 600_000,
        // Route to custom provider when AI_BASE_URL is set
        ...(c.aiBaseUrl ? { configuration: { baseURL: c.aiBaseUrl } } : {}),
      });
    }
  }
}

export function describeOllamaError(
  error: unknown,
  model: string,
): { status: number; message: string } | null {
  return describeProviderError("ollama", error, model);
}

export function describeProviderError(
  provider: LLMProvider,
  error: unknown,
  model: string,
): { status: number; message: string } | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const msg = error.message.toLowerCase();

  if (provider === "ollama") {
    if (
      msg.includes("fetch failed") ||
      msg.includes("econn") ||
      msg.includes("connection") ||
      msg.includes("timeout")
    ) {
      return {
        status: 502,
        message: `Unable to reach Ollama at ${getConfig().ollama?.baseUrl ?? "(OLLAMA_BASE_URL not set)"}. Please ensure the Ollama server is running.`,
      };
    }
    if (
      msg.includes("not found") ||
      msg.includes("no such model") ||
      msg.includes("pull")
    ) {
      return {
        status: 400,
        message: `Ollama model \"${model}\" is not available. Run \"ollama pull ${model}\" and try again.`,
      };
    }
  }

  if (provider === "anthropic" && (msg.includes("invalid x-api-key") || msg.includes("authentication"))) {
    return {
      status: 401,
      message: "Invalid or missing ANTHROPIC_API_KEY. Please check your API key configuration.",
    };
  }

  if (provider === "google" && (msg.includes("api key not valid") || msg.includes("permission denied"))) {
    return {
      status: 401,
      message: "Invalid or missing GOOGLE_AI_API_KEY. Please check your API key configuration.",
    };
  }

  return null;
}

export function assertProviderModelSupport(
  provider: LLMProvider,
  model: AIModelType,
) {
  if (!isModelAllowedForProvider(provider, model)) {
    throw new Error(
      `Model \"${String(model)}\" is not supported for provider \"${String(provider)}\"`,
    );
  }
}

/**
 * Infer the LLM provider from a model identifier. Falls back to "openai".
 * Uses the canonical ProviderModelMap so adding a new model in types.ts
 * automatically updates the inference — callers don't have to re-enumerate.
 */
export function inferProviderFromModel(model: AIModelType): LLMProvider {
  for (const provider of Object.keys(ProviderModelMap) as LLMProvider[]) {
    if ((ProviderModelMap[provider] as readonly string[]).includes(model)) {
      return provider;
    }
  }
  return "openai";
}

/**
 * Return a chat model directly from an AIModelType, inferring the provider.
 * Convenience for callers that only know the model string (e.g. feature code
 * that previously consumed the apps/web-only `~/lib/models.getChatModel`).
 */
export function getChatModelByType(
  model: AIModelType,
  opts: { temperature?: number; timeoutMs?: number } = {},
): BaseChatModel {
  return getChatModelForProvider({
    provider: inferProviderFromModel(model),
    model,
    ...opts,
  });
}
