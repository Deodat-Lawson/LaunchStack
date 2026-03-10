/**
 * Embeddings Service
 * Handles batch generation of embeddings using OpenAI's text-embedding-3-small model
 * Includes batching, rate limiting, and error handling
 */

/**
 * Embedding configuration
 */
export interface EmbeddingConfig {
  apiKey?: string; // OpenAI API key
  model?: string;
  batchSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  dimensions?: number;
}

const DEFAULT_CONFIG: Required<EmbeddingConfig> = {
  apiKey: process.env.OPENAI_API_KEY ?? "",
  model: "text-embedding-3-large",
  batchSize: 20,
  maxRetries: 3,
  retryDelayMs: 1000,
  dimensions: 1536,
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

  console.log(
    `[Embeddings] Processing ${chunks.length} chunks in ${batches.length} batches`
  );

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const { startIndex, texts } = batch;

    console.log(
      `[Embeddings] Processing batch ${i + 1}/${batches.length} (${texts.length} chunks)`
    );

    const result = await callEmbeddingAPIWithRetry(texts, cfg);

    for (let j = 0; j < result.embeddings.length; j++) {
      allEmbeddings[startIndex + j] = result.embeddings[j]!;
    }

    totalTokens += result.tokensUsed;

    if (i < batches.length - 1) {
      await delay(100);
    }
  }

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

  const response = await fetch("https://api.openai.com/v1/embeddings", {
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
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as OpenAIEmbeddingResponse;

  const sortedData = [...data.data].sort((a, b) => a.index - b.index);
  const embeddings = sortedData.map((item) => item.embedding);

  return {
    embeddings,
    tokensUsed: data.usage.total_tokens,
  };
}


function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

