/** Model-agnostic embedding provider — all sub-features use this interface */
export interface EmbeddingProvider {
    /** Embed a single text string */
    embed(text: string): Promise<number[]>;
    /** Embed multiple texts in a batch */
    embedBatch(texts: string[]): Promise<number[][]>;
    /** The dimensionality of output vectors */
    readonly dimensions: number;
    /** The provider name for logging */
    readonly providerName: string;
}

/** Default provider: calls the Sidecar /embed endpoint, produces 768-dim BERT CLS vectors */
export class BertEmbeddingProvider implements EmbeddingProvider {
    readonly dimensions = 768;
    readonly providerName = "bert";

    private get sidecarUrl(): string {
        return process.env.SIDECAR_URL ?? "http://localhost:8080";
    }

    async embed(text: string): Promise<number[]> {
        const response = await fetch(`${this.sidecarUrl}/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
        if (!response.ok) {
            throw new Error(`[EmbeddingProvider] Sidecar /embed failed: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json()) as { embedding: number[] };
        return data.embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await fetch(`${this.sidecarUrl}/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts }),
        });
        if (!response.ok) {
            throw new Error(`[EmbeddingProvider] Sidecar /embed (batch) failed: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json()) as { embeddings: number[][] };
        return data.embeddings;
    }
}

/** OpenAI-compatible provider: calls any /v1/embeddings endpoint with configurable dimensions */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
    readonly dimensions: number;
    readonly providerName = "openai-compatible";

    constructor(
        private readonly apiUrl: string,
        private readonly model: string,
        dimensions: number
    ) {
        this.dimensions = dimensions;
    }

    async embed(text: string): Promise<number[]> {
        const response = await fetch(`${this.apiUrl}/v1/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: text, model: this.model, dimensions: this.dimensions }),
        });
        if (!response.ok) {
            throw new Error(`[EmbeddingProvider] OpenAI-compatible /v1/embeddings failed: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json()) as { data: { embedding: number[] }[] };
        return data.data[0].embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await fetch(`${this.apiUrl}/v1/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: texts, model: this.model, dimensions: this.dimensions }),
        });
        if (!response.ok) {
            throw new Error(`[EmbeddingProvider] OpenAI-compatible /v1/embeddings (batch) failed: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json()) as { data: { embedding: number[] }[] };
        return data.data.map((item) => item.embedding);
    }
}

/**
 * Factory: reads env vars, returns the appropriate provider.
 * Fallback: if config is missing or unknown, falls back to BERT with a warning.
 */
export function createEmbeddingProvider(): EmbeddingProvider {
    const provider = process.env.EMBEDDING_PROVIDER;

    if (!provider || provider === "bert") {
        return new BertEmbeddingProvider();
    }

    if (provider === "openai-compatible") {
        const apiUrl = process.env.EMBEDDING_API_URL;
        const model = process.env.EMBEDDING_MODEL;
        const dimensions = Number(process.env.EMBEDDING_DIMENSIONS);

        if (!apiUrl || !model || !dimensions) {
            console.warn(
                "[EmbeddingProvider] openai-compatible selected but missing EMBEDDING_API_URL, EMBEDDING_MODEL, or EMBEDDING_DIMENSIONS — falling back to BERT"
            );
            return new BertEmbeddingProvider();
        }

        return new OpenAICompatibleEmbeddingProvider(apiUrl, model, dimensions);
    }

    console.warn(`[EmbeddingProvider] Unknown provider "${provider}" — falling back to BERT`);
    return new BertEmbeddingProvider();
}
