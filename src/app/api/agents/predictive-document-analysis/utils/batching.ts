import type { PdfChunk } from "~/app/api/agents/predictive-document-analysis/types";

export type ChunkBatchingOptions = {
    maxChunksPerCall: number;
    maxCharactersPerCall: number;
};

/**
 * Groups chunks into batches, keeping semantically related chunks together.
 *
 * Strategy:
 *   1. Group by section heading (when available from document structure).
 *   2. Within each section group, chunks stay in page order.
 *   3. Section groups are packed into batches respecting size limits.
 *   4. Falls back to sequential batching when no structure data exists.
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

    const hasStructure = chunks.some(c => c.sectionHeading);
    if (!hasStructure) {
        return sequentialBatch(chunks, maxChunksPerCall, maxCharactersPerCall);
    }

    // Group by section heading, preserving insertion order
    const sectionGroups: PdfChunk[][] = [];
    const groupMap = new Map<string, PdfChunk[]>();

    for (const chunk of chunks) {
        const key = chunk.sectionHeading ?? `__page_${chunk.page}`;
        let group = groupMap.get(key);
        if (!group) {
            group = [];
            groupMap.set(key, group);
            sectionGroups.push(group);
        }
        group.push(chunk);
    }

    // Pack section groups into batches
    const batches: PdfChunk[][] = [];
    let currentBatch: PdfChunk[] = [];
    let currentCharCount = 0;

    for (const group of sectionGroups) {
        const groupCharCount = group.reduce((s, c) => s + (c.content?.length ?? 0), 0);

        // If this entire group fits in the current batch, add it
        const wouldExceedChunks = currentBatch.length + group.length > maxChunksPerCall;
        const wouldExceedChars = currentCharCount + groupCharCount > maxCharactersPerCall;

        if (currentBatch.length > 0 && (wouldExceedChunks || wouldExceedChars)) {
            batches.push(currentBatch);
            currentBatch = [];
            currentCharCount = 0;
        }

        // If the group itself is too large, split it sequentially
        if (group.length > maxChunksPerCall || groupCharCount > maxCharactersPerCall) {
            if (currentBatch.length > 0) {
                batches.push(currentBatch);
                currentBatch = [];
                currentCharCount = 0;
            }
            const subBatches = sequentialBatch(group, maxChunksPerCall, maxCharactersPerCall);
            batches.push(...subBatches);
            continue;
        }

        currentBatch.push(...group);
        currentCharCount += groupCharCount;
    }

    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }

    return batches;
}

function sequentialBatch(
    chunks: PdfChunk[],
    maxChunksPerCall: number,
    maxCharactersPerCall: number,
): PdfChunk[][] {
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
