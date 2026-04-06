/**
 * Shared chat model factory for use across the app (document Q&A, marketing pipeline, etc.).
 * Swap models in one place; all callers use LangChain BaseChatModel.
 */
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createEmbeddingModel } from "~/lib/ai/embedding-factory";
import { resolveEmbeddingIndex } from "~/lib/ai/embedding-index-registry";
import type { CompanyEmbeddingConfig } from "~/lib/ai/company-embedding-config";
import type { EmbeddingsProvider } from "~/lib/tools/rag/types";

export type AIModelType =
  | "gpt-4o"
  | "gpt-5.2"
  | "gpt-5.1"
  | "gpt-5-nano"
  | "gpt-5-mini"
  | "claude-sonnet-4"
  | "claude-opus-4.5"
  | "gemini-2.5-flash"
  | "gemini-3-flash"
  | "gemini-3-pro";

/**
 * Get a chat model instance based on the model type.
 * Supports OpenAI, Anthropic, and Google Gemini.
 */
export function getChatModel(modelType: AIModelType): BaseChatModel {
  switch (modelType) {
    case "gpt-4o":
      return new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o",
        temperature: 0.7,
        timeout: 600000,
      });

    case "gpt-5.2":
      return new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-5.2",
        temperature: 0.7,
        timeout: 600000,
      });

    case "gpt-5.1":
      return new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-5.1",
        temperature: 0.7,
        timeout: 600000,
      });

    case "gpt-5-nano":
      return new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-5-nano-2025-08-07",
        timeout: 300000,
      });

    case "gpt-5-mini":
      return new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-5-mini-2025-08-07",
        temperature: 0.3,
        timeout: 600000,
      });

    case "claude-sonnet-4":
      return new ChatAnthropic({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        modelName: "claude-sonnet-4-20250514",
        temperature: 0.7,
      });

    case "claude-opus-4.5":
      return new ChatAnthropic({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        modelName: "claude-opus-4.5",
        temperature: 0.7,
      });

    case "gemini-2.5-flash":
      return new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_AI_API_KEY,
        model: "gemini-2.5-flash",
        temperature: 0.7,
      });

    case "gemini-3-flash":
      return new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_AI_API_KEY,
        model: "gemini-3-flash-preview",
        temperature: 0.7,
      });

    case "gemini-3-pro":
      return new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_AI_API_KEY,
        model: "gemini-3-pro-preview",
        temperature: 0.7,
      });

    default:
      return new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o",
        temperature: 0.7,
        timeout: 600000,
      });
  }
}

export function getEmbeddings(
  indexKey?: string,
  config?: CompanyEmbeddingConfig,
): EmbeddingsProvider {
  return createEmbeddingModel(resolveEmbeddingIndex(indexKey, config), config);
}

/** Marketing pipeline model config: one place to swap models per stage. */
export const MARKETING_MODELS = {
  dnaExtraction: "gpt-5-nano" as AIModelType,
  competitorAnalysis: "gpt-5-nano" as AIModelType,
  strategyBuilding: "gpt-5-nano" as AIModelType,
  contentGeneration: "gpt-4o" as AIModelType,
  claimVerification: "gpt-5-nano" as AIModelType,
  refinement: "gpt-4o" as AIModelType,
} as const;
