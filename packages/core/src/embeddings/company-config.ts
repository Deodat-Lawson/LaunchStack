import { eq } from "drizzle-orm";

import { getDb } from "../db";
import { company } from "../db/schema";
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

/**
 * Defaults used when a per-company override is absent or blank. apps/web/
 * src/server/engine.ts registers these via configureCompanyEmbeddingDefaults
 * so this module can be env-agnostic when it later moves to core. A
 * process.env fallback is retained for the transitional window.
 */
export interface CompanyEmbeddingDefaults {
  embeddingIndexKey?: string;
  openAIApiKey?: string;
  huggingFaceApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaEmbeddingModel?: string;
  ollamaModel?: string;
}

let _defaults: CompanyEmbeddingDefaults | null = null;

export function configureCompanyEmbeddingDefaults(
  defaults: CompanyEmbeddingDefaults,
): void {
  _defaults = defaults;
}

function getDefaults(): CompanyEmbeddingDefaults {
  if (_defaults) return _defaults;
  return {
    embeddingIndexKey: process.env.EMBEDDING_INDEX,
    openAIApiKey: process.env.OPENAI_API_KEY,
    huggingFaceApiKey: process.env.HUGGINGFACE_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL,
    ollamaModel: process.env.OLLAMA_MODEL,
  };
}

function normalizeOptional(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveEffectiveEmbeddingConfig(
  config?: CompanyEmbeddingConfig,
): EffectiveEmbeddingConfig {
  const defaults = getDefaults();
  return {
    embeddingIndexKey:
      normalizeOptional(config?.embeddingIndexKey) ??
      defaults.embeddingIndexKey ??
      undefined,
    openAIApiKey:
      normalizeOptional(config?.openAIApiKey) ??
      defaults.openAIApiKey ??
      undefined,
    huggingFaceApiKey:
      normalizeOptional(config?.huggingFaceApiKey) ??
      defaults.huggingFaceApiKey ??
      undefined,
    ollamaBaseUrl:
      normalizeOptional(config?.ollamaBaseUrl) ??
      defaults.ollamaBaseUrl ??
      undefined,
    ollamaModel:
      normalizeOptional(config?.ollamaModel) ??
      defaults.ollamaEmbeddingModel ??
      defaults.ollamaModel ??
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
    getDb()
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
