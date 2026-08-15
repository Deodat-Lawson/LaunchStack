import { eq } from "drizzle-orm";

import { getDb } from "../db";
import { company } from "../db/schema";
import { getCompanyCredentialsPlaintext } from "./company-credentials";
import { createSlot } from "../internal/slot";

export interface CompanyEmbeddingConfig {
    embeddingIndexKey?: string | null;
    openAIApiKey?: string | null;
    /**
     * Endpoint for the OpenAI-compatible embeddings provider. Required to use
     * that provider — there is no built-in default URL.
     */
    openAIBaseUrl?: string | null;
    huggingFaceApiKey?: string | null;
    ollamaBaseUrl?: string | null;
    ollamaModel?: string | null;
}

export interface EffectiveEmbeddingConfig {
    embeddingIndexKey?: string;
    openAIApiKey?: string;
    openAIBaseUrl?: string;
    huggingFaceApiKey?: string;
    ollamaBaseUrl?: string;
    ollamaModel?: string;
}

/**
 * Defaults used when a per-company override is absent or blank. The host
 * registers these via configureCompanyEmbeddingDefaults (apps/web/src/
 * server/engine.ts builds them from CoreConfig). The slot is authoritative:
 * this module never reads process.env (ADR-002) — with nothing registered
 * there are simply no deployment defaults, and per-company config stands
 * alone.
 */
export interface CompanyEmbeddingDefaults {
    embeddingIndexKey?: string;
    openAIApiKey?: string;
    openAIBaseUrl?: string;
    huggingFaceApiKey?: string;
    ollamaBaseUrl?: string;
    ollamaEmbeddingModel?: string;
    ollamaModel?: string;
}

const defaultsSlot = createSlot<CompanyEmbeddingDefaults>("embeddings/companyDefaults");

export function configureCompanyEmbeddingDefaults(defaults: CompanyEmbeddingDefaults): void {
    defaultsSlot.set(defaults);
}

function getDefaults(): CompanyEmbeddingDefaults {
    return defaultsSlot.get() ?? {};
}

function normalizeOptional(value: string | null | undefined): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveEffectiveEmbeddingConfig(
    config?: CompanyEmbeddingConfig
): EffectiveEmbeddingConfig {
    const defaults = getDefaults();

    // A credential and the endpoint it is sent to must come from the SAME
    // source. Resolving them independently would let a company's key fall
    // through to the deployment's URL and ship that key to whatever vendor the
    // operator configured globally — `.env.example` suggests SiliconFlow, so an
    // A provider key pasted into the field labelled "OpenAI API key" would go there.
    // Now that no built-in default endpoint backstops the pairing, they are
    // resolved together or not at all.
    const companyOpenAIApiKey = normalizeOptional(config?.openAIApiKey);
    const openAI = companyOpenAIApiKey
        ? {
              apiKey: companyOpenAIApiKey,
              baseUrl: normalizeOptional(config?.openAIBaseUrl),
          }
        : { apiKey: defaults.openAIApiKey, baseUrl: defaults.openAIBaseUrl };

    return {
        embeddingIndexKey:
            normalizeOptional(config?.embeddingIndexKey) ?? defaults.embeddingIndexKey ?? undefined,
        openAIApiKey: openAI.apiKey ?? undefined,
        openAIBaseUrl: openAI.baseUrl ?? undefined,
        huggingFaceApiKey:
            normalizeOptional(config?.huggingFaceApiKey) ?? defaults.huggingFaceApiKey ?? undefined,
        ollamaBaseUrl:
            normalizeOptional(config?.ollamaBaseUrl) ?? defaults.ollamaBaseUrl ?? undefined,
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
    companyId: bigint | number | string
): Promise<CompanyEmbeddingConfig | null> {
    const numericCompanyId = typeof companyId === "bigint" ? Number(companyId) : Number(companyId);

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
    const indexKey = indexRow[0]?.activeIndexKey ?? indexRow[0]?.legacyIndexKey ?? null;

    return {
        embeddingIndexKey: indexKey,
        openAIApiKey: creds?.openAIApiKey ?? null,
        huggingFaceApiKey: creds?.huggingFaceApiKey ?? null,
        ollamaBaseUrl: creds?.ollamaBaseUrl ?? null,
        ollamaModel: creds?.ollamaModel ?? null,
    };
}
