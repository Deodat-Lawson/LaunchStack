import { eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { company } from "@launchstack/core/db/schema";
import { getCompanyCredentialsPlaintext } from "./company-credentials";

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

/**
 * Load the effective per-company embedding configuration. Secrets (API
 * keys) are decrypted from `company_embedding_credentials`; the
 * `embeddingIndexKey` still lives on the `company` row because it isn't a
 * secret and is frequently read alongside non-credential metadata.
 */
export async function getCompanyEmbeddingConfig(
  companyId: bigint | number | string,
): Promise<CompanyEmbeddingConfig | null> {
  const numericCompanyId =
    typeof companyId === "bigint" ? Number(companyId) : Number(companyId);

  if (!Number.isFinite(numericCompanyId)) {
    return null;
  }

  const [indexRow, creds] = await Promise.all([
    db
      .select({
        activeIndexKey: company.activeEmbeddingIndexKey,
        legacyIndexKey: company.embeddingIndexKey,
      })
      .from(company)
      .where(eq(company.id, numericCompanyId))
      .limit(1),
    getCompanyCredentialsPlaintext(numericCompanyId),
  ]);

  if (!indexRow[0] && !creds) return null;

  // Prefer the new active column; fall back to the legacy column for
  // companies that pre-date migration 0012. Callers who need the
  // ingest-time vs query-time distinction should use
  // `resolveIngestIndexKey` / `resolveQueryIndexKey` from
  // `company-reindex-state` instead of reading this field directly.
  const indexKey =
    indexRow[0]?.activeIndexKey ?? indexRow[0]?.legacyIndexKey ?? null;

  return {
    embeddingIndexKey: indexKey,
    openAIApiKey: creds?.openAIApiKey ?? null,
    huggingFaceApiKey: creds?.huggingFaceApiKey ?? null,
    ollamaBaseUrl: creds?.ollamaBaseUrl ?? null,
    ollamaModel: creds?.ollamaModel ?? null,
  };
}
