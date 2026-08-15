/**
 * Embeddings Service
 * Batch embedding generation against any OpenAI-compatible /embeddings
 * endpoint. Defaults to the text-embedding-3-large model (see DEFAULT_CONFIG)
 * but never to a default *endpoint* — see the note there.
 * Includes batching, rate limiting, and error handling
 */

/**
 * Embedding configuration
 */
export interface EmbeddingConfig {
    apiKey?: string;
    /**
     * Required. Base URL for the OpenAI-compatible endpoint. There is no
     * built-in default — see the note on DEFAULT_CONFIG.
     */
    baseUrl?: string;
    model?: string;
    batchSize?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    dimensions?: number;
    /** Max concurrent API requests (default 5) */
    concurrency?: number;
}

/**
 * Library defaults. The caller is expected to pass apiKey and baseUrl (and
 * optionally override model / dimensions) on every call; the default apiKey
 * is empty so a missing config throws a clear "API key not configured" error
 * rather than silently swallowing.
 *
 * There is deliberately no default baseUrl, and embeddings are the ONLY
 * capability without one — chat, OCR/VLM and NER all fall back to Gemini.
 * The difference is persistence. Those three make a request and discard it, so
 * a default merely picks who answers. An embedding is *stored*, and vectors are
 * only comparable to others from the same model, so defaulting the endpoint
 * would silently start writing incomparable vectors into an existing corpus
 * and degrade every future search against it. Switching embedding providers
 * has to be a deliberate act paired with a re-index.
 */
const DEFAULT_CONFIG: Omit<Required<EmbeddingConfig>, "baseUrl"> = {
    apiKey: "",
    model: "text-embedding-3-large",
    batchSize: 100,
    maxRetries: 5,
    retryDelayMs: 2000,
    dimensions: 1536,
    concurrency: 5,
};

/**
 * OpenAI embedding API response type
 */
interface OpenAIEmbeddingResponse {
    object: string;
    data: Array<{
        object: string;
        index: number;
        embedding: number[];
    }>;
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
}

export interface EmbeddingResult {
    embeddings: number[][];
    totalTokens: number;
    processingTimeMs: number;
    batchCount: number;
}

/**
 * Generate embeddings for an array of text chunks
 * Processes in batches to respect rate limits and reduce network overhead
 *
 * @param chunks - Array of text strings to embed
 * @param config - Optional configuration overrides
 * @returns Array of embeddings matching input order
 */
export async function generateEmbeddings(
    chunks: string[],
    config?: EmbeddingConfig
): Promise<EmbeddingResult> {
    const merged = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();

    if (!merged.apiKey) {
        throw new Error("API key not configured for embeddings");
    }

    const { baseUrl } = merged;
    if (!baseUrl) {
        throw new Error(
            "Embeddings base URL not configured. Set EMBEDDING_API_BASE_URL (with " +
                "EMBEDDING_API_KEY) or AI_BASE_URL, or pass EmbeddingConfig.baseUrl. " +
                "Embeddings deliberately have no default endpoint, unlike chat and " +
                "OCR: vectors are persisted and only comparable within one model, so " +
                "the provider must be chosen explicitly and changed only with a " +
                "full re-index."
        );
    }

    const cfg: Required<EmbeddingConfig> = { ...merged, baseUrl };

    if (chunks.length === 0) {
        return {
            embeddings: [],
            totalTokens: 0,
            processingTimeMs: 0,
            batchCount: 0,
        };
    }

    const batches = createBatches(chunks, cfg.batchSize);
    const allEmbeddings: number[][] = new Array<number[]>(chunks.length);
    let totalTokens = 0;
    const concurrency = cfg.concurrency;

    console.log(
        `[Embeddings] Processing ${chunks.length} chunks in ${batches.length} batches (concurrency=${concurrency})`
    );

    for (let wave = 0; wave < batches.length; wave += concurrency) {
        const waveBatches = batches.slice(wave, wave + concurrency);
        const waveNum = Math.floor(wave / concurrency) + 1;
        const totalWaves = Math.ceil(batches.length / concurrency);

        console.log(
            `[Embeddings] Wave ${waveNum}/${totalWaves}: batches ${wave + 1}-${wave + waveBatches.length} of ${batches.length}`
        );

        const results = await Promise.all(
            waveBatches.map(({ startIndex, texts }) =>
                callEmbeddingAPIWithRetry(texts, cfg).then(result => ({
                    ...result,
                    startIndex,
                }))
            )
        );

        for (const result of results) {
            for (let j = 0; j < result.embeddings.length; j++) {
                allEmbeddings[result.startIndex + j] = result.embeddings[j]!;
            }
            totalTokens += result.tokensUsed;
        }

        if (wave + concurrency < batches.length) {
            await delay(200);
        }
    }

    console.log(
        `[Embeddings] Done: ${chunks.length} chunks, ${totalTokens} tokens used (model=${cfg.model})`
    );

    const missingIndices = allEmbeddings
        .map((e, i) => (e === undefined ? i : -1))
        .filter(i => i !== -1);

    if (missingIndices.length > 0) {
        throw new Error(`Failed to generate embeddings for indices: ${missingIndices.join(", ")}`);
    }

    return {
        embeddings: allEmbeddings,
        totalTokens,
        processingTimeMs: Date.now() - startTime,
        batchCount: batches.length,
    };
}

function createBatches(
    chunks: string[],
    batchSize: number
): Array<{ startIndex: number; texts: string[] }> {
    const batches: Array<{ startIndex: number; texts: string[] }> = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
        batches.push({
            startIndex: i,
            texts: chunks.slice(i, i + batchSize),
        });
    }

    return batches;
}

async function callEmbeddingAPIWithRetry(
    texts: string[],
    config: Required<EmbeddingConfig>
): Promise<{ embeddings: number[][]; tokensUsed: number }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
        try {
            return await callEmbeddingAPI(texts, config);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.warn(
                `[Embeddings] Attempt ${attempt + 1}/${config.maxRetries} failed:`,
                lastError.message
            );

            if (attempt < config.maxRetries - 1) {
                const backoffMs = config.retryDelayMs * Math.pow(2, attempt);
                await delay(backoffMs);
            }
        }
    }

    throw new Error(
        `Failed to generate embeddings after ${config.maxRetries} attempts: ${lastError?.message}`
    );
}

async function callEmbeddingAPI(
    texts: string[],
    config: Required<EmbeddingConfig>
): Promise<{ embeddings: number[][]; tokensUsed: number }> {
    const sanitizedTexts = texts.map(text => text.replace(/\0/g, "").trim() || " ");

    const baseUrl = config.baseUrl.replace(/\/$/, "");

    const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            input: sanitizedTexts,
            dimensions: config.dimensions,
        }),
        signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;

    const sortedData = [...data.data].sort((a, b) => a.index - b.index);
    const dim = config.dimensions;
    const embeddings = sortedData.map(item =>
        item.embedding.length > dim ? item.embedding.slice(0, dim) : item.embedding
    );

    return {
        embeddings,
        tokensUsed: data.usage.total_tokens,
    };
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
