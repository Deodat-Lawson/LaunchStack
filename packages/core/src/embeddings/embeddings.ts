/**
 * Embeddings Service
 * Handles batch generation of embeddings using OpenAI's text-embedding-3-small model
 * Includes batching, rate limiting, and error handling
 */

/**
 * Embedding configuration
 */
export interface EmbeddingConfig {
  apiKey?: string;
  /** Base URL for the OpenAI-compatible endpoint. Defaults to api.openai.com/v1. */
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
 * Library defaults. The caller is expected to pass apiKey (and optionally
 * override model / dimensions / baseUrl) on every call; the default apiKey
 * is empty so a missing config throws a clear "OpenAI API key not
 * configured" error rather than silently swallowing.
 */
const DEFAULT_CONFIG: Required<EmbeddingConfig> = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
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
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();

  if (!cfg.apiKey) {
    throw new Error("OpenAI API key not configured for embeddings");
  }

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
        callEmbeddingAPIWithRetry(texts, cfg).then((result) => ({
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
    .filter((i) => i !== -1);

  if (missingIndices.length > 0) {
    throw new Error(
      `Failed to generate embeddings for indices: ${missingIndices.join(", ")}`
    );
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
  const sanitizedTexts = texts.map((text) =>
    text.replace(/\0/g, "").trim() || " "
  );

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
  const embeddings = sortedData.map((item) =>
    item.embedding.length > dim ? item.embedding.slice(0, dim) : item.embedding
  );

  return {
    embeddings,
    tokensUsed: data.usage.total_tokens,
  };
}


function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

