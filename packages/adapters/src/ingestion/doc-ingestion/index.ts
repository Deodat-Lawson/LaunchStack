import { and, eq } from "drizzle-orm";

import {
    chunkPages,
    createRootStructure,
    finalizeStorage,
    markJobFailed,
    normalizeDocument,
    routeDocument,
    storeBatch,
    withDbRetry,
    type NormalizationResult,
    type RouterDecisionResult,
    type StoredSection,
} from "../../ocr/processor";
import {
    prepareForEmbedding,
    mergeWithEmbeddings,
    getTotalChunkSize,
} from "../../ocr/chunker";
import { createEmbeddingModel } from "../../embeddings";
import type { CompanyEmbeddingConfig } from "../../embeddings";
import {
    resolveEmbeddingIndex,
    supportsShortVectorSearch,
    type EmbeddingIndexConfig,
} from "../../embeddings";
import type { DocumentChunk, PageContent, PipelineResult } from "../../ocr/types";
import { getDb } from "../../db";
import { ocrJobs, documentContextChunks } from "../../db/schema";
import {
    creditsDebitSafe,
    embeddingTokens,
    ocrTokens,
    ocrProviderToTokenKey,
} from "../../credits";
import { isCloudMode } from "../../providers/registry";

import type {
    DocIngestionToolInput,
    DocIngestionToolResult,
    DocIngestionToolRuntimeOptions,
} from "./types";

const DEFAULT_EMBEDDING_BATCH_SIZE = 50;

/**
 * Lightweight step output for normalize, kept under Inngest's ~4MB step output limit.
 * The full page data is stored in ocrJobs.ocrResult so subsequent steps can load it.
 */
interface NormalizeSummary {
    jobId: string;
    pageCount: number;
    provider: NormalizationResult["provider"];
    processingTimeMs: number;
    confidenceScore?: number;
}

/**
 * Lightweight step output for chunking.
 * Full chunk data is stored in ocrJobs.ocrResult.
 */
interface ChunkSummary {
    jobId: string;
    parentChunkCount: number;
    childChunkCount: number;
    textChunks: number;
    tableChunks: number;
}

async function savePipelineState(jobId: string, key: string, data: unknown): Promise<void> {
    return withDbRetry(async () => {
        const db = getDb();
        const [job] = await db
            .select({ ocrResult: ocrJobs.ocrResult })
            .from(ocrJobs)
            .where(eq(ocrJobs.id, jobId));

        const existing = (job?.ocrResult as Record<string, unknown> | null) ?? {};
        await db
            .update(ocrJobs)
            .set({ ocrResult: { ...existing, [key]: data } })
            .where(eq(ocrJobs.id, jobId));
    });
}

async function loadPipelineState<T>(jobId: string, key: string): Promise<T> {
    return withDbRetry(async () => {
        const db = getDb();
        const [job] = await db
            .select({ ocrResult: ocrJobs.ocrResult })
            .from(ocrJobs)
            .where(eq(ocrJobs.id, jobId));

        const state = job?.ocrResult as Record<string, unknown> | null;
        if (!state || !(key in state)) {
            throw new Error(`Pipeline state "${key}" not found for job ${jobId}`);
        }
        return state[key] as T;
    });
}

function splitIntoBatches<T>(arr: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        batches.push(arr.slice(i, i + size));
    }
    return batches;
}

function createStepRunner(runtime?: DocIngestionToolRuntimeOptions) {
    if (runtime?.runStep) {
        return async <T>(stepName: string, fn: () => Promise<T>): Promise<T> =>
            runtime.runStep?.(stepName, fn) ?? fn();
    }

    return async <T>(_stepName: string, fn: () => Promise<T>): Promise<T> => fn();
}

async function maybeMarkProcessing(jobId: string, shouldUpdateStatus: boolean): Promise<void> {
    if (!shouldUpdateStatus) return;

    await getDb()
        .update(ocrJobs)
        .set({
            status: "processing",
            startedAt: new Date(),
        })
        .where(eq(ocrJobs.id, jobId));
}

const AZURE_SUPPORTED_EXTENSIONS = new Set([
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tiff",
    ".tif",
    ".heif",
    ".docx",
    ".doc",
    ".pptx",
    ".ppt",
    ".xlsx",
    ".xls",
]);

function shouldUsePdfPipeline(mimeType: string | undefined, documentName: string): boolean {
    if (mimeType === "application/pdf") return true;
    if (documentName.toLowerCase().endsWith(".pdf")) return true;
    return false;
}

function isAzureSupportedFile(documentUrl: string, documentName: string): boolean {
    const nameToCheck = `${documentUrl} ${documentName}`.toLowerCase();
    return [...AZURE_SUPPORTED_EXTENSIONS].some(ext => nameToCheck.includes(ext));
}

/**
 * Vectorize chunks using the resolved embedding index.
 * Each step embeds a batch of parent chunks AND writes them directly to the
 * database, returning only a tiny count. This avoids Inngest's output_too_large
 * error since vectors never pass through step serialization.
 */
async function vectorizeWithIndex(
    chunks: DocumentChunk[],
    embeddingIndex: EmbeddingIndexConfig,
    embeddingConfig: CompanyEmbeddingConfig | undefined,
    batchSize: number,
    documentId: number,
    rootStructureId: number,
    versionId: number,
    runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>
): Promise<{ totalStored: number; storedSections: StoredSection[] }> {
    if (chunks.length === 0) return { totalStored: 0, storedSections: [] };

    const embeddings = createEmbeddingModel(embeddingIndex, embeddingConfig);
    const contentStrings = prepareForEmbedding(chunks);
    const childCounts = chunks.map(chunk =>
        chunk.children && chunk.children.length > 0 ? chunk.children.length : 1
    );
    const batches = splitIntoBatches(chunks, batchSize);
    let totalStored = 0;
    let stringOffset = 0;

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        if (!batch) continue;

        const batchChildCount = batch.reduce(
            (sum, _, idx) => sum + (childCounts[i * batchSize + idx] ?? 0),
            0
        );
        const batchStrings = contentStrings.slice(stringOffset, stringOffset + batchChildCount);
        stringOffset += batchChildCount;

        const result = await runStep(
            `step-d-batch-${i}`,
            async (): Promise<{ batchIndex: number; stored: number }> => {
                console.log(
                    `[Vectorize] Batch ${i + 1}/${batches.length}: ${batch.length} parents, ${batchStrings.length} strings, index=${embeddingIndex.indexKey}`
                );
                const vectors =
                    (await embeddings.embedDocuments?.(batchStrings)) ??
                    (await Promise.all(batchStrings.map(text => embeddings.embedQuery(text))));
                const vectorized = mergeWithEmbeddings(batch, vectors, {
                    shortDimension: embeddingIndex.shortDimension,
                    supportsMatryoshka: supportsShortVectorSearch(embeddingIndex),
                });
                const sections = await storeBatch(
                    documentId,
                    rootStructureId,
                    vectorized,
                    embeddingIndex,
                    versionId
                );
                return { batchIndex: i, stored: sections.length };
            }
        );

        totalStored += result.stored;
    }

    const versionBigInt = BigInt(versionId);
    const rows = await getDb()
        .select({ id: documentContextChunks.id, content: documentContextChunks.content })
        .from(documentContextChunks)
        .where(
            and(
                eq(documentContextChunks.documentId, BigInt(documentId)),
                eq(documentContextChunks.versionId, versionBigInt)
            )
        );

    return {
        totalStored,
        storedSections: rows.map(r => ({ sectionId: r.id, content: r.content })),
    };
}

async function maybeExtractEntities(
    storedSections: StoredSection[],
    documentId: number,
    companyId: string,
    runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>
): Promise<void> {
    if (storedSections.length === 0) return;

    // Entity extraction runs on the cloud/LLM NER provider — the only mode
    // since ADR-004 §5 removed the sidecar path (and its /health probe here).
    //
    // Best-effort: graph enrichment failing (LLM outage, no NER configured)
    // must not fail indexing — the evidence chunks are already stored and
    // retrievable, and a whole-stage retry would re-run embedding for
    // nothing. The failure is logged loudly; the KG tables simply gain no
    // rows for this version.
    try {
        await runStep("step-f-graph-rag", async () => {
            const { extractAndStoreEntities } = await import(
                "../entity-extraction"
            );

            const result = await extractAndStoreEntities(storedSections, documentId, BigInt(companyId));

            console.log(
                `[DocIngestionTool] Graph RAG: ${result.totalEntities} entities, ` +
                    `${result.totalRelationships} relationships stored`
            );

            return result;
        });
    } catch (error) {
        console.warn(
            `[DocIngestionTool] Graph RAG extraction failed for document ${documentId} — ` +
                `continuing without graph enrichment: ${
                    error instanceof Error ? error.message : String(error)
                }`
        );
    }
}

async function maybeSyncToNeo4j(
    documentId: number,
    companyId: string,
    runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>
): Promise<boolean> {
    // The host's composition root (createEngine) registers Neo4j credentials
    // with the graph slot; when it hasn't, graph sync is simply off. Returns
    // whether a sync actually ran so `evidence.version.indexed` can report it.
    const { isNeo4jConfigured, checkNeo4jHealth } = await import("../../graph");
    if (!isNeo4jConfigured()) return false;

    let synced = false;
    await runStep("step-g-neo4j-sync", async () => {
        const healthy = await checkNeo4jHealth();
        if (!healthy) {
            console.warn("[DocIngestionTool] Step G skipped: Neo4j unhealthy");
            return null;
        }

        const { syncDocumentToNeo4j } = await import("../../graph");

        const result = await syncDocumentToNeo4j(documentId, BigInt(companyId));
        synced = true;

        console.log(
            `[DocIngestionTool] Neo4j sync: ${result.entities} entities, ` +
                `${result.mentions} mentions, ${result.relationships} relationships (${result.durationMs}ms)`
        );

        return result;
    });
    return synced;
}

function buildFailureResult(
    jobId: string,
    documentId: number,
    pipelineStartTime: number,
    error: unknown
): PipelineResult {
    const elapsed = Date.now() - pipelineStartTime;

    return {
        success: false,
        jobId,
        documentId,
        chunks: [],
        metadata: {
            totalChunks: 0,
            textChunks: 0,
            tableChunks: 0,
            totalPages: 0,
            provider: "AZURE",
            processingTimeMs: elapsed,
            embeddingTimeMs: 0,
        },
        error: error instanceof Error ? error.message : String(error),
    };
}

/**
 * Extraction-stage summary persisted in pipeline state (`ocrResult`) so the
 * indexing stage — possibly a different process, hours later — can load it.
 */
export interface ExtractionStageSummary {
    provider: NormalizationResult["provider"];
    pageCount: number;
    processingTimeMs: number;
    confidenceScore?: number;
    usedFastTextPath: boolean;
}

/**
 * Stage 1 of the pipeline (ADR-003): route + normalize/OCR, persisting the
 * normalized pages and this summary into pipeline state. Idempotent —
 * re-running overwrites the same state keys with converged content.
 * Consumed by the worker's `source.version.created` handler.
 */
export async function runExtractionStage(
    input: DocIngestionToolInput
): Promise<ExtractionStageSummary> {
    const {
        jobId,
        documentUrl,
        documentName,
        mimeType,
        originalFilename,
        isWebsite,
        options,
        runtime,
    } = input;
    const routingFilename = originalFilename ?? documentName;
    const runStep = createStepRunner(runtime);
    const isInngest = !!runtime?.runStep;
    const updateJobStatus = runtime?.updateJobStatus ?? false;
    const fastTextPath = runtime?.fastTextPath ?? false;

    await maybeMarkProcessing(jobId, updateJobStatus);

    const isPdf = !fastTextPath && shouldUsePdfPipeline(mimeType, routingFilename);

    let normSummary: NormalizeSummary;

    if (isPdf && isAzureSupportedFile(documentUrl, routingFilename)) {
        const routerDecision = await runStep(
            "step-a-router",
            async (): Promise<RouterDecisionResult> => routeDocument(documentUrl, options)
        );

        if (isInngest) {
            normSummary = await runStep(
                "step-b-normalize",
                async (): Promise<NormalizeSummary> => {
                    const result = await normalizeDocument(documentUrl, routerDecision);
                    await savePipelineState(jobId, "pages", result.pages);
                    return {
                        jobId,
                        pageCount: result.pages.length,
                        provider: result.provider,
                        processingTimeMs: result.processingTimeMs,
                        confidenceScore: result.confidenceScore,
                    };
                }
            );
        } else {
            const result = await runStep(
                "step-b-normalize",
                async (): Promise<NormalizationResult> =>
                    normalizeDocument(documentUrl, routerDecision)
            );
            normSummary = {
                jobId,
                pageCount: result.pages.length,
                provider: result.provider,
                processingTimeMs: result.processingTimeMs,
                confidenceScore: result.confidenceScore,
            };
            await savePipelineState(jobId, "pages", result.pages);
        }
    } else {
        if (isInngest) {
            normSummary = await runStep(
                "step-ab-ingest",
                async (): Promise<NormalizeSummary> => {
                    const { ingestToNormalized } = await import("../index");
                    const normalizedDoc = await ingestToNormalized(documentUrl, {
                        mimeType,
                        filename: routingFilename,
                        forceOCR: options?.forceOCR,
                        isWebsite,
                    });
                    await savePipelineState(jobId, "pages", normalizedDoc.pages);
                    return {
                        jobId,
                        pageCount: normalizedDoc.pages.length,
                        provider: normalizedDoc.metadata.provider,
                        processingTimeMs: normalizedDoc.metadata.processingTimeMs,
                        confidenceScore: normalizedDoc.metadata.confidenceScore,
                    };
                }
            );
        } else {
            const result = await runStep(
                "step-ab-ingest",
                async (): Promise<NormalizationResult> => {
                    const { ingestToNormalized } = await import("../index");
                    const normalizedDoc = await ingestToNormalized(documentUrl, {
                        mimeType,
                        filename: routingFilename,
                        forceOCR: options?.forceOCR,
                        isWebsite,
                    });
                    return {
                        pages: normalizedDoc.pages,
                        provider: normalizedDoc.metadata.provider,
                        processingTimeMs: normalizedDoc.metadata.processingTimeMs,
                        confidenceScore: normalizedDoc.metadata.confidenceScore,
                    };
                }
            );
            normSummary = {
                jobId,
                pageCount: result.pages.length,
                provider: result.provider,
                processingTimeMs: result.processingTimeMs,
                confidenceScore: result.confidenceScore,
            };
            await savePipelineState(jobId, "pages", result.pages);
        }
    }

    const summary: ExtractionStageSummary = {
        provider: normSummary.provider,
        pageCount: normSummary.pageCount,
        processingTimeMs: normSummary.processingTimeMs,
        confidenceScore: normSummary.confidenceScore,
        usedFastTextPath: fastTextPath,
    };
    await savePipelineState(jobId, "extraction", summary);
    return summary;
}

/** Counters the indexing stage reports for `evidence.version.indexed`. */
export interface IndexingStageCounts {
    embeddingIndexKey: string;
    contextChunkCount: number;
    retrievalChunkCount: number;
    graphSynced: boolean;
}

/**
 * Stage 2 of the pipeline (ADR-003): chunk the persisted pages, embed,
 * store, finalize metadata, and run optional graph extraction/sync.
 * Requires `runExtractionStage` to have persisted pipeline state for the
 * job. Idempotent via content-hash dedup and per-version upserts.
 */
export async function runIndexingStage(
    input: DocIngestionToolInput
): Promise<IndexingStageCounts> {
    const {
        jobId,
        documentId,
        documentName,
        companyId,
        originalFilename,
        versionId,
        options,
        runtime,
    } = input;
    const pipelineStartTime = Date.now();
    const routingFilename = originalFilename ?? documentName;
    const runStep = createStepRunner(runtime);
    const isInngest = !!runtime?.runStep;
    const embeddingBatchSize = runtime?.sidecarBatchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;
    const { getCompanyEmbeddingConfig } = await import("../../embeddings");
    const companyEmbeddingConfig = await getCompanyEmbeddingConfig(companyId);
    const embeddingIndex = resolveEmbeddingIndex(
        options?.embeddingIndexKey,
        companyEmbeddingConfig ?? undefined
    );

    const normSummary = await loadPipelineState<ExtractionStageSummary>(jobId, "extraction");

    // -----------------------------------------------------------------------
    // Step C: Chunking
    // -----------------------------------------------------------------------
    let chunks: DocumentChunk[];

    if (isInngest) {
        const chunkSummary = await runStep(
            "step-c-chunking",
            async (): Promise<ChunkSummary> => {
                const pages = await loadPipelineState<PageContent[]>(jobId, "pages");
                const chunked = await chunkPages(pages, routingFilename);
                await savePipelineState(jobId, "chunks", chunked);
                const stats = getTotalChunkSize(chunked);
                return {
                    jobId,
                    parentChunkCount: chunked.length,
                    childChunkCount: chunked.reduce(
                        (sum, c) => sum + (c.children?.length ?? 1),
                        0
                    ),
                    textChunks: stats.textChunks,
                    tableChunks: stats.tableChunks,
                };
            }
        );
        chunks = await loadPipelineState<DocumentChunk[]>(jobId, "chunks");
        console.log(
            `[Pipeline] Chunks loaded: ${chunkSummary.parentChunkCount} parents, ${chunkSummary.childChunkCount} children`
        );
    } else {
        const pages = await loadPipelineState<PageContent[]>(jobId, "pages");
        chunks = await runStep(
            "step-c-chunking",
            async (): Promise<DocumentChunk[]> => chunkPages(pages, routingFilename)
        );
    }

    // -----------------------------------------------------------------------
    // Step D: Setup root structure + Embed & Store per batch
    // -----------------------------------------------------------------------
    let storedSections: StoredSection[] = [];
    let totalStored = 0;

    if (chunks.length > 0) {
        const rootStructureId = await runStep("step-d-setup", async (): Promise<number> => {
            const estimatedTokens = Math.ceil(
                chunks.reduce((sum, c) => sum + c.content.length / 4, 0)
            );
            return createRootStructure(
                documentId,
                normSummary.pageCount,
                estimatedTokens,
                versionId
            );
        });

        const result = await vectorizeWithIndex(
            chunks,
            embeddingIndex,
            companyEmbeddingConfig ?? undefined,
            embeddingBatchSize,
            documentId,
            rootStructureId,
            versionId,
            runStep
        );
        storedSections = result.storedSections;
        totalStored = result.totalStored;
    }

    // -----------------------------------------------------------------------
    // Credit debits (cloud mode only)
    // -----------------------------------------------------------------------
    if (isCloudMode() && companyId) {
        const bigCompanyId = BigInt(companyId);

        if (totalStored > 0) {
            const estimatedTokens = Math.ceil(
                chunks.reduce((sum, c) => sum + c.content.length / 4, 0)
            );
            const embedCost = embeddingTokens(estimatedTokens);
            await creditsDebitSafe({
                companyId: bigCompanyId,
                tokens: embedCost,
                service: "embedding",
                description: `Embed ${totalStored} chunks for document ${documentId}`,
                referenceId: String(documentId),
                metadata: { estimatedTokens, chunks: totalStored },
            });
        }

        if (normSummary.pageCount > 0 && normSummary.provider !== "NATIVE_PDF") {
            const providerKey = ocrProviderToTokenKey(normSummary.provider);
            const credits = ocrTokens(normSummary.pageCount, providerKey);
            if (credits > 0) {
                await creditsDebitSafe({
                    companyId: bigCompanyId,
                    tokens: credits,
                    service: `ocr_${providerKey}`,
                    description: `OCR ${normSummary.pageCount} pages via ${normSummary.provider}`,
                    referenceId: String(documentId),
                    metadata: { pages: normSummary.pageCount, provider: normSummary.provider },
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // Step E: Finalize (metadata + job status)
    // -----------------------------------------------------------------------
    await runStep("step-e-finalize", async (): Promise<{ ok: true }> => {
        const summaryText = chunks.map(c => c.content).join("\n\n");
        await finalizeStorage(
            documentId,
            jobId,
            totalStored,
            summaryText,
            {
                totalPages: normSummary.pageCount,
                provider: normSummary.provider,
                processingTimeMs: normSummary.processingTimeMs,
                confidenceScore: normSummary.confidenceScore,
                embeddingIndexKey: embeddingIndex.indexKey,
            },
            pipelineStartTime,
            versionId
        );
        return { ok: true };
    });

    // -----------------------------------------------------------------------
    // Steps F+G: Graph RAG (optional) + Neo4j sync
    // -----------------------------------------------------------------------
    await maybeExtractEntities(storedSections, documentId, companyId, runStep);

    const graphSynced = await maybeSyncToNeo4j(documentId, companyId, runStep);

    const childCount = chunks.reduce((sum, c) => sum + (c.children?.length ?? 1), 0);
    return {
        embeddingIndexKey: embeddingIndex.indexKey,
        contextChunkCount: totalStored,
        retrievalChunkCount: childCount,
        graphSynced,
    };
}

/**
 * Shared backend tool for end-to-end document ingestion.
 * Runs OCR/normalization, chunking, embedding, storage, and optional graph
 * extraction — `runExtractionStage` then `runIndexingStage` in one process.
 * The outbox worker calls the stages separately; synchronous callers (and
 * tests) use this composition.
 */
export async function runDocIngestionTool(
    input: DocIngestionToolInput
): Promise<DocIngestionToolResult> {
    const { jobId, documentId, runtime } = input;
    const pipelineStartTime = Date.now();
    const markFailureInDb = runtime?.markFailureInDb ?? false;
    const isInngest = !!runtime?.runStep;

    try {
        const extraction = await runExtractionStage(input);
        const indexing = await runIndexingStage(input);

        const chunks = await loadPipelineState<DocumentChunk[]>(jobId, "chunks").catch(
            () => [] as DocumentChunk[]
        );
        const stats = getTotalChunkSize(chunks);
        const totalProcessingTime = Date.now() - pipelineStartTime;

        return {
            success: true,
            jobId,
            documentId,
            chunks: [],
            metadata: {
                totalChunks: indexing.contextChunkCount,
                textChunks: stats.textChunks,
                tableChunks: stats.tableChunks,
                totalPages: extraction.pageCount,
                provider: extraction.provider,
                processingTimeMs: extraction.processingTimeMs,
                embeddingTimeMs: totalProcessingTime - extraction.processingTimeMs,
            },
        };
    } catch (error) {
        if (markFailureInDb) {
            await markJobFailed(jobId, error instanceof Error ? error : new Error(String(error)));
        }

        if (isInngest) throw error;

        return buildFailureResult(jobId, documentId, pipelineStartTime, error);
    }
}

export type {
    DocIngestionToolInput,
    DocIngestionToolResult,
    DocIngestionToolRuntimeOptions,
} from "./types";
