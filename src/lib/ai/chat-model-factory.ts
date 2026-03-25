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
} from "~/app/api/agents/documentQ&A/services/types";
import { env } from "~/env";

/** OpenAI GPT-5 models only accept default temperature; see `openAiTemperatureOption` in ~/lib/models. */
const REASONING_MODELS: ReadonlySet<string> = new Set([
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5-mini",
  "gpt-5-nano",
]);

function getServerModelOverride(provider: LLMProvider): string | undefined {
  switch (provider) {
    case "openai":
      return env.server.OPENAI_MODEL;
    case "anthropic":
      return env.server.ANTHROPIC_MODEL;
    case "google":
      return env.server.GOOGLE_MODEL;
    case "ollama":
      return env.server.OLLAMA_MODEL;
  }
}

function coerceModel(
  provider: LLMProvider,
  requested?: AIModelType,
): AIModelType {
  if (requested && isModelAllowedForProvider(provider, requested)) {
    return requested;
  }

  const envValue = getServerModelOverride(provider);
  if (envValue && isModelAllowedForProvider(provider, envValue)) {
    return envValue;
  }

  return ProviderDefaultModels[provider];
}

export function getProviderDefaultModel(provider: LLMProvider): AIModelType {
  return coerceModel(provider);
}

/** Base URL for the local Ollama HTTP API (used by ChatOllama only). */
export function getOllamaBaseUrl(): string {
  const url = process.env.OLLAMA_BASE_URL;
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

  if (!(ProviderModelMap[provider] as readonly string[]).includes(modelName)) {
    throw new Error(
      `Model \"${String(modelName)}\" is not supported for provider \"${String(provider)}\"`,
    );
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
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        modelName,
        temperature: temperature ?? 0.7,
      });

    case "google":
      return new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_AI_API_KEY,
        model: modelName,
        temperature: temperature ?? 0.7,
      });

    case "openai":
    default: {
      const useTemp = !REASONING_MODELS.has(modelName);
      return new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName,
        ...(useTemp ? { temperature: temperature ?? 0.7 } : { temperature: 1 }),
        timeout: timeoutMs ?? 600_000,
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
        message: `Unable to reach Ollama at ${process.env.OLLAMA_BASE_URL ?? "(OLLAMA_BASE_URL not set)"}. Please ensure the Ollama server is running.`,
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
