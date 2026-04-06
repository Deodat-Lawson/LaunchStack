/**
 * Per-company embedding configuration types and constants.
 *
 * Companies can choose which embedding model to use for document ingestion
 * and search. All supported models output 1536 dimensions to maintain
 * compatibility with existing pgvector columns and indexes.
 */

export interface CompanyEmbeddingConfig {
    provider: "openai";
    model: string;
    dimensions: number;
}

export const DEFAULT_EMBEDDING_CONFIG: CompanyEmbeddingConfig = {
    provider: "openai",
    model: "text-embedding-3-large",
    dimensions: 1536,
};

export interface SupportedEmbeddingModel {
    provider: "openai";
    model: string;
    dimensions: number;
    label: string;
    description: string;
    costPer1MTokens: string;
}

export const SUPPORTED_EMBEDDING_MODELS: SupportedEmbeddingModel[] = [
    {
        provider: "openai",
        model: "text-embedding-3-large",
        dimensions: 1536,
        label: "OpenAI Large (Recommended)",
        description: "Highest quality embeddings for best search accuracy",
        costPer1MTokens: "$0.13",
    },
    {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
        label: "OpenAI Small",
        description: "Faster and cheaper with good quality",
        costPer1MTokens: "$0.02",
    },
];

/**
 * Validate that a config matches a supported model.
 */
export function isValidEmbeddingConfig(
    config: CompanyEmbeddingConfig,
): boolean {
    return SUPPORTED_EMBEDDING_MODELS.some(
        (m) =>
            m.provider === config.provider &&
            m.model === config.model &&
            m.dimensions === config.dimensions,
    );
}

/**
 * Resolve a potentially-null config to a concrete config,
 * falling back to the system default.
 */
export function resolveEmbeddingConfig(
    config: CompanyEmbeddingConfig | null | undefined,
): CompanyEmbeddingConfig {
    return config ?? DEFAULT_EMBEDDING_CONFIG;
}
