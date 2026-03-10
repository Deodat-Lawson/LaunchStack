import type { PdfChunk } from "~/app/api/agents/predictive-document-analysis/types";

export type ChunkBatchingOptions = {
    maxChunksPerCall: number;
    maxCharactersPerCall: number;
};

/**
 * Groups sequential chunks to keep OpenAI round trips bounded.
 */
export function createChunkBatches(
    chunks: PdfChunk[],
    options: ChunkBatchingOptions
): PdfChunk[][] {
    const { maxChunksPerCall, maxCharactersPerCall } = options;

    if (maxChunksPerCall <= 0) {
        throw new Error("maxChunksPerCall must be greater than zero");
    }
    if (maxCharactersPerCall <= 0) {
        throw new Error("maxCharactersPerCall must be greater than zero");
    }

    const batches: PdfChunk[][] = [];
    let currentBatch: PdfChunk[] = [];
    let currentCharCount = 0;

    for (const chunk of chunks) {
        const chunkLength = chunk.content?.length ?? 0;
        const wouldExceedChunkLimit = currentBatch.length >= maxChunksPerCall;
        const wouldExceedCharLimit = currentCharCount + chunkLength > maxCharactersPerCall;

        if (currentBatch.length > 0 && (wouldExceedChunkLimit || wouldExceedCharLimit)) {
            batches.push(currentBatch);
            currentBatch = [];
            currentCharCount = 0;
        }

        currentBatch.push(chunk);
        currentCharCount += chunkLength;
    }

    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }

    return batches;
}
