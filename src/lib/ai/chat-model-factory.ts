import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  ProviderDefaultModels,
  ProviderModelMap,
  isModelAllowedForProvider,
  type AIModelType,
  type LLMProvider,
} from "~/app/api/agents/documentQ&A/services/types";

const FALLBACK_OLLAMA_URL = "http://localhost:11434";

function coerceModel(
  provider: LLMProvider,
  requested?: AIModelType,
): AIModelType {
  if (requested && isModelAllowedForProvider(provider, requested)) {
    return requested;
  }

  const envValue =
    provider === "ollama"
      ? (process.env.OLLAMA_MODEL as AIModelType | undefined)
      : (process.env.OPENAI_MODEL as AIModelType | undefined);

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
    return process.env.OLLAMA_BASE_URL ?? FALLBACK_OLLAMA_URL;
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

  if (!ProviderModelMap[provider].includes(modelName)) {
    throw new Error(
      `Model \"${modelName}\" is not supported for provider \"${provider}\"`,
    );
  }

  if (provider === "ollama") {
    return new ChatOllama({
      baseUrl: getProviderBaseUrl("ollama"),
      model: modelName,
      temperature: temperature ?? 0.7,
    });
  }

  return new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: modelName,
    temperature: temperature ?? 0.7,
    timeout: timeoutMs ?? 600_000,
  });
}

export function describeOllamaError(
  error: unknown,
  model: string,
): { status: number; message: string } | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes("fetch failed") ||
    message.includes("econn") ||
    message.includes("connection") ||
    message.includes("timeout")
  ) {
    return {
      status: 502,
      message: `Unable to reach Ollama at ${getProviderBaseUrl(
        "ollama",
      )}. Please ensure the Ollama server is running.`,
    };
  }

  if (
    message.includes("not found") ||
    message.includes("no such model") ||
    message.includes("pull")
  ) {
    return {
      status: 400,
      message: `Ollama model \"${model}\" is not available. Run \"ollama pull ${model}\" and try again.`,
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
