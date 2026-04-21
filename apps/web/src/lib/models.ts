/**
 * Legacy re-export shim.
 *
 * getChatModel + AIModelType now live in @launchstack/core/llm so that
 * features (packages/features/*) can build chat models without reaching
 * back into apps/web. getEmbeddings stays app-local because it pulls in
 * ~/lib/tools/rag types; refactor the RAG layer first if that needs to
 * move.
 *
 * New call sites should import from @launchstack/core/llm directly — this
 * file exists only so the ~120 existing callers keep working unchanged.
 */
import { getChatModelByType, type AIModelType } from "@launchstack/core/llm";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createEmbeddingModel } from "@launchstack/core/embeddings";
import { resolveEmbeddingIndex } from "@launchstack/core/embeddings";
import type { CompanyEmbeddingConfig } from "@launchstack/core/embeddings";
import type { EmbeddingsProvider } from "~/lib/tools/rag/types";

export type { AIModelType };

export function getChatModel(modelType: AIModelType): BaseChatModel {
  return getChatModelByType(modelType);
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
