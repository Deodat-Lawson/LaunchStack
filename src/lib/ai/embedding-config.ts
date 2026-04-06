/**
 * Per-company embedding configuration types and constants.
 *
 * Companies can choose which embedding provider and model to use for
 * document ingestion and search. Each provider has its own native
 * dimensions, and per-company embedding tables are sized accordingly.
 */

export type EmbeddingProvider = "openai" | "google" | "cohere" | "voyage";

export const EMBEDDING_PROVIDERS: readonly EmbeddingProvider[] = [
    "openai",
    "google",
    "cohere",
    "voyage",
] as const;

export interface CompanyEmbeddingConfig {
    provider: EmbeddingProvider;
    model: string;
    dimensions: number;
}

export const DEFAULT_EMBEDDING_CONFIG: CompanyEmbeddingConfig = {
    provider: "openai",
    model: "text-embedding-3-large",
    dimensions: 3072,
};

export interface SupportedEmbeddingModel {
    provider: EmbeddingProvider;
    model: string;
    dimensions: number;
    label: string;
    description: string;
    costPer1MTokens: string;
}

export const SUPPORTED_EMBEDDING_MODELS: SupportedEmbeddingModel[] = [
    // OpenAI
    {
        provider: "openai",
        model: "text-embedding-3-large",
        dimensions: 3072,
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
    // Google
    {
        provider: "google",
        model: "text-embedding-004",
        dimensions: 768,
        label: "Google Embedding",
        description: "Google's latest text embedding model",
        costPer1MTokens: "$0.00",
    },
    // Cohere
    {
        provider: "cohere",
        model: "embed-english-v3.0",
        dimensions: 1024,
        label: "Cohere English v3",
        description: "Cohere's high-quality English embedding model",
        costPer1MTokens: "$0.10",
    },
    // Voyage AI
    {
        provider: "voyage",
        model: "voyage-3",
        dimensions: 1024,
        label: "Voyage 3",
        description: "Voyage AI's latest general-purpose embedding model",
        costPer1MTokens: "$0.06",
    },
    {
        provider: "voyage",
        model: "voyage-3-lite",
        dimensions: 512,
        label: "Voyage 3 Lite",
        description: "Lightweight and fast variant of Voyage 3",
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

/**
 * Get all supported models for a given provider.
 */
export function getModelsForProvider(
    provider: EmbeddingProvider,
): SupportedEmbeddingModel[] {
    return SUPPORTED_EMBEDDING_MODELS.filter((m) => m.provider === provider);
}

/**
 * Check if an embedding provider is valid.
 */
export function isEmbeddingProvider(value: string): value is EmbeddingProvider {
    return (EMBEDDING_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Provider display labels for the UI.
 */
export const PROVIDER_LABELS: Record<EmbeddingProvider, string> = {
    openai: "OpenAI",
    google: "Google",
    cohere: "Cohere",
    voyage: "Voyage AI",
};
