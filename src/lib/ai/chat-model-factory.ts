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

const REASONING_MODELS: ReadonlySet<string> = new Set([
  "gpt-5-mini",
  "gpt-5-nano",
]);

const PROVIDER_ENV_MODEL_KEY: Record<LLMProvider, string> = {
  openai: "OPENAI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
  google: "GOOGLE_MODEL",
  ollama: "OLLAMA_MODEL",
};

function coerceModel(
  provider: LLMProvider,
  requested?: AIModelType,
): AIModelType {
  if (requested && isModelAllowedForProvider(provider, requested)) {
    return requested;
  }

  const envValue = process.env[PROVIDER_ENV_MODEL_KEY[provider]] as
    | AIModelType
    | undefined;

  if (envValue && isModelAllowedForProvider(provider, envValue)) {
    return envValue;
  }

  return ProviderDefaultModels[provider];
}

export function getProviderDefaultModel(provider: LLMProvider): AIModelType {
  return coerceModel(provider);
}

export function getProviderBaseUrl(provider: LLMProvider): string {
  if (provider === "ollama") {
    const url = process.env.OLLAMA_BASE_URL;
    if (!url) {
      throw new Error(
        "OLLAMA_BASE_URL is not set. Add it to your .env file (e.g. OLLAMA_BASE_URL=\"http://localhost:11434\").",
      );
    }
    return url;
  }
  return "https://api.openai.com/v1";
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
      `Model \"${modelName}\" is not supported for provider \"${provider}\"`,
    );
  }

  switch (provider) {
    case "ollama":
      return new ChatOllama({
        baseUrl: getProviderBaseUrl("ollama"),
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
        ...(useTemp ? { temperature: temperature ?? 0.7 } : {}),
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
        message: `Unable to reach Ollama at ${getProviderBaseUrl(
          "ollama",
        )}. Please ensure the Ollama server is running.`,
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
      `Model \"${model}\" is not supported for provider \"${provider}\"`,
    );
  }
}
