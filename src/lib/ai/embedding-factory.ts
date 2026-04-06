/**
 * Embedding factory — returns the right embedding provider based on
 * a company's persisted configuration.
 *
 * Analogous to `getChatModel()` in models.ts but for embeddings.
 */

import { OpenAIEmbeddings } from "@langchain/openai";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "~/server/db/schema";
import {
    type CompanyEmbeddingConfig,
    resolveEmbeddingConfig,
} from "./embedding-config";

/**
 * Build a LangChain embeddings instance from a company's config.
 * Falls back to the system default when config is null/undefined.
 */
export function getEmbeddingsForCompany(
    config?: CompanyEmbeddingConfig | null,
): OpenAIEmbeddings {
    const cfg = resolveEmbeddingConfig(config);

    return new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: cfg.model,
        dimensions: cfg.dimensions,
    });
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
 * Convenience: look up a company's config and return a ready-to-use
 * embeddings instance in one call.
 */
export async function getEmbeddingsForCompanyId(
    companyId: bigint | number,
): Promise<OpenAIEmbeddings> {
    const cfg = await getCompanyEmbeddingConfig(companyId);
    return getEmbeddingsForCompany(cfg);
}
