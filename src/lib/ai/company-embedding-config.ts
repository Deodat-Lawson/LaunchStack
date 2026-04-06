import { eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { company } from "~/server/db/schema";

export interface CompanyEmbeddingConfig {
  embeddingIndexKey?: string | null;
  openAIApiKey?: string | null;
  huggingFaceApiKey?: string | null;
  ollamaBaseUrl?: string | null;
  ollamaModel?: string | null;
}

export interface EffectiveEmbeddingConfig {
  embeddingIndexKey?: string;
  openAIApiKey?: string;
  huggingFaceApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}

function normalizeOptional(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveEffectiveEmbeddingConfig(
  config?: CompanyEmbeddingConfig,
): EffectiveEmbeddingConfig {
  return {
    embeddingIndexKey:
      normalizeOptional(config?.embeddingIndexKey) ??
      env.server.EMBEDDING_INDEX ??
      undefined,
    openAIApiKey:
      normalizeOptional(config?.openAIApiKey) ??
      env.server.OPENAI_API_KEY ??
      undefined,
    huggingFaceApiKey:
      normalizeOptional(config?.huggingFaceApiKey) ??
      env.server.HUGGINGFACE_API_KEY ??
      undefined,
    ollamaBaseUrl:
      normalizeOptional(config?.ollamaBaseUrl) ??
      env.server.OLLAMA_BASE_URL ??
      undefined,
    ollamaModel:
      normalizeOptional(config?.ollamaModel) ??
      env.server.OLLAMA_EMBEDDING_MODEL ??
      env.server.OLLAMA_MODEL ??
      undefined,
  };
}

export async function getCompanyEmbeddingConfig(
  companyId: bigint | number | string,
): Promise<CompanyEmbeddingConfig | null> {
  const numericCompanyId =
    typeof companyId === "bigint" ? Number(companyId) : Number(companyId);

  if (!Number.isFinite(numericCompanyId)) {
    return null;
  }

  const [record] = await db
    .select({
      embeddingIndexKey: company.embeddingIndexKey,
      openAIApiKey: company.embeddingOpenAIApiKey,
      huggingFaceApiKey: company.embeddingHuggingFaceApiKey,
      ollamaBaseUrl: company.embeddingOllamaBaseUrl,
      ollamaModel: company.embeddingOllamaModel,
    })
    .from(company)
    .where(eq(company.id, numericCompanyId))
    .limit(1);

  return record ?? null;
}
