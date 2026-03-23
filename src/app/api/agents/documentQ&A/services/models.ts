import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AIModelType } from "./types";
export { getChatModelForProvider, getProviderDefaultModel, describeOllamaError, describeProviderError } from "~/lib/ai/chat-model-factory";

// Re-export type for convenience
export type { AIModelType };

/**
 * Get a chat model instance based on the model type
 *
 * Supports all model types defined in types.ts:
 * - OpenAI: gpt-5.2, gpt-5.1, gpt-5-nano, gpt-5-mini
 * - Anthropic: claude-sonnet-4, claude-opus-4.5
 * - Google: gemini-2.5-flash, gemini-3-flash, gemini-3-pro
 */
export function getChatModel(modelType: AIModelType): BaseChatModel {
    switch (modelType) {
        // OpenAI Models
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
                timeout: 600000,
            });

        // Anthropic Models
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

        // Google Gemini Models
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

        // Default fallback
        default:
            return new ChatOpenAI({
                openAIApiKey: process.env.OPENAI_API_KEY,
                modelName: "gpt-5-mini",
                temperature: 0.7,
                timeout: 600000,
            });
    }
}

/**
 * Get embeddings instance
 */
export function getEmbeddings(): OpenAIEmbeddings {
    return new OpenAIEmbeddings({
        model: "text-embedding-ada-002",
        openAIApiKey: process.env.OPENAI_API_KEY,
    });
}

