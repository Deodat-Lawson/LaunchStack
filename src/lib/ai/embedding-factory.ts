/**
 * Embedding factory — returns the right embedding provider based on
 * a company's persisted configuration and per-company API key.
 *
 * Supports OpenAI, Google, Cohere, and Voyage AI embedding providers.
 * Voyage AI uses an OpenAI-compatible API, so we instantiate it via
 * OpenAIEmbeddings with a custom base URL.
 */

import { OpenAIEmbeddings } from "@langchain/openai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { CohereEmbeddings } from "@langchain/cohere";
import type { Embeddings } from "@langchain/core/embeddings";
import { eq, and } from "drizzle-orm";

import { db } from "~/server/db";
import { company, companyApiKeys } from "~/server/db/schema";
import { decryptApiKey } from "~/lib/crypto/api-key-encryption";
import {
    type CompanyEmbeddingConfig,
    type EmbeddingProvider,
    resolveEmbeddingConfig,
} from "./embedding-config";

/**
 * Build a LangChain embeddings instance from a company's config.
 * Falls back to the system default when config is null/undefined.
 *
 * @param config - The company's embedding configuration
 * @param apiKey - Decrypted API key for the provider (optional, falls back to env vars)
 */
export function getEmbeddingsForCompany(
    config?: CompanyEmbeddingConfig | null,
    apiKey?: string | null,
): Embeddings {
    const cfg = resolveEmbeddingConfig(config);

    switch (cfg.provider) {
        case "openai":
            return new OpenAIEmbeddings({
                openAIApiKey: apiKey ?? process.env.OPENAI_API_KEY,
                modelName: cfg.model,
                dimensions: cfg.dimensions,
            });

        case "google":
            return new GoogleGenerativeAIEmbeddings({
                apiKey: apiKey ?? process.env.GOOGLE_AI_API_KEY,
                model: cfg.model,
            });

        case "cohere":
            return new CohereEmbeddings({
                apiKey: apiKey ?? undefined,
                model: cfg.model,
            });

        case "voyage":
            // Voyage AI exposes an OpenAI-compatible embeddings endpoint
            return new OpenAIEmbeddings({
                openAIApiKey: apiKey ?? undefined,
                modelName: cfg.model,
                dimensions: cfg.dimensions,
                configuration: {
                    baseURL: "https://api.voyageai.com/v1",
                },
            });

        default:
            throw new Error(`Unsupported embedding provider: ${String(cfg.provider)}`);
    }
}

/**
 * Retrieve and decrypt a company's API key for a given provider.
 * Returns null if no key is stored.
 */
export async function getDecryptedApiKeyForCompany(
    companyId: bigint | number,
    provider: EmbeddingProvider,
): Promise<string | null> {
    const [row] = await db
        .select({
            encryptedApiKey: companyApiKeys.encryptedApiKey,
            keyIv: companyApiKeys.keyIv,
            keyTag: companyApiKeys.keyTag,
        })
        .from(companyApiKeys)
        .where(
            and(
                eq(companyApiKeys.companyId, BigInt(companyId)),
                eq(companyApiKeys.provider, provider),
            )
        );

    if (!row) return null;

    return decryptApiKey(row.encryptedApiKey, row.keyIv, row.keyTag);
}

/**
 * Look up a company's embedding config from the database and return
 * the resolved config object (never null).
 */
export async function getCompanyEmbeddingConfig(
    companyId: bigint | number,
): Promise<CompanyEmbeddingConfig> {
    const [row] = await db
        .select({ embeddingConfig: company.embeddingConfig })
        .from(company)
        .where(eq(company.id, Number(companyId)));

    return resolveEmbeddingConfig(row?.embeddingConfig);
}

/**
 * Convenience: look up a company's config + API key and return a
 * ready-to-use embeddings instance in one call.
 */
export async function getEmbeddingsForCompanyId(
    companyId: bigint | number,
): Promise<Embeddings> {
    const cfg = await getCompanyEmbeddingConfig(companyId);
    const apiKey = await getDecryptedApiKeyForCompany(companyId, cfg.provider);
    return getEmbeddingsForCompany(cfg, apiKey);
}
