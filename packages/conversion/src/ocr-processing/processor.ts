/**
 * Document Processor Module
 * Shared processing logic for OCR-to-Vector pipeline
 * Can be used by both Inngest background jobs and synchronous processing
 */

import type { RoutingDecision } from "./complexity";
import { renderPagesToImages } from "./complexity";
import { getOcrConfig } from "./config";
import { enrichPageWithVlm, isVlmEnrichmentConfigured } from "./enrichment";
import { createAzureAdapter } from "./adapters/azureAdapter";
import { createLandingAIAdapter } from "./adapters/landingAdapter";
import { createDatalabAdapter } from "./adapters/datalabAdapter";
import { createDoclingAdapter } from "./adapters/ossAdapter";
import {
    availableOcrEngines,
    firstAvailableOcrEngine,
    isOcrEngine,
    ocrFallbackChain,
    type OcrEngine,
} from "./provider-order";
import { chunkDocument, mergeWithEmbeddings, prepareForEmbedding } from "./chunker";
import { createEmbeddingModel } from "@launchstack/llm/embeddings";
import {
    isLegacyEmbeddingIndex,
    supportsShortVectorSearch,
    type EmbeddingIndexConfig,
} from "@launchstack/llm/embeddings";
import { storeDimensionTableEmbeddings } from "@launchstack/llm/embeddings";
import { getDb } from "@launchstack/store/client";
import {
    documentContextChunks,
    documentRetrievalChunks,
    documentStructure,
    documentMetadata,
    documentVersions,
    document as documentTable,
    ocrJobs,
} from "@launchstack/store/schema";
import { and, eq, sql } from "drizzle-orm";
import crypto from "crypto";
import { getStoragePort } from "@launchstack/runtime";

import type {
    ProcessDocumentEventData,
    PipelineResult,
    PageContent,
    OCRProvider,
    NormalizedDocument,
    VectorizedChunk,
    DocumentChunk,
} from "./types";

export type { ProcessDocumentEventData, PipelineResult, VectorizedChunk };

// ============================================================================
// DB Retry Utility
// ============================================================================

function isTransientDbError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const cause = (error as unknown as { cause?: { code?: string } }).cause;
    if (cause && typeof cause.code === "string") {
        return (
            cause.code === "ECONNRESET" ||
            cause.code === "ECONNREFUSED" ||
            cause.code === "ETIMEDOUT" ||
            cause.code === "EPIPE"
        );
    }
    return false;
}

/**
 * Strip verbose `query` and `params` properties from DB driver errors
 * so full chunk content / embedding vectors don't flood the console.
 */
function sanitizeDbError(error: unknown): void {
    if (!(error instanceof Error)) return;
    const e = error as unknown as Record<string, unknown>;
    delete e.params;
    if (typeof e.query === "string") {
        e.query = e.query.substring(0, 120) + "…";
    }
}

export async function withDbRetry<T>(
    fn: () => Promise<T>,
    maxAttempts = 3,
    baseDelayMs = 2000
): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            sanitizeDbError(error);
            if (!isTransientDbError(error) || attempt === maxAttempts) throw error;
            const delay = baseDelayMs * attempt;
            console.warn(
                `[DB] Transient error (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms...`
            );
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error("withDbRetry: unreachable");
}

/**
 * Router decision result from Step A.
 *
 * Carries the converter's enumerated reason and measured vision signals —
 * never an invented confidence (the old `confidence` field was fabricated
 * at several sites and is removed, ADR-004).
 */
export interface RouterDecisionResult {
    isNativePDF: boolean;
    pageCount: number;
    selectedProvider: OCRProvider;
    reason: string;
    visionLabel?: string;
    visionScore?: number;
    /**
     * When every OCR engine fails, read the PDF's own text layer instead of
     * failing the stage (see fallBackToTextLayer for when it still fails).
     * Set by provider-first routing, the default OCR_PDF_STRATEGY.
     */
    nativeFallback?: boolean;
}

/** One provider normalizeDocument tried, and how it went. */
export interface ProviderAttempt {
    provider: OCRProvider;
    ok: boolean;
    /** Why it did not produce the text: the error, shortened, URL query strings removed. */
    error?: string;
    durationMs: number;
}

/**
 * How a document's text was produced — written into ocr metadata so "which
 * OCR read this, and why not the one it was meant to" has an answer.
 */
export interface OcrRoutingRecord {
    /** What routing chose: a person's pick, the operator pin, or the order. */
    requestedProvider: OCRProvider;
    /** What produced the text. */
    provider: OCRProvider;
    /** True when `provider` is not `requestedProvider`. */
    fellBack: boolean;
    routingReason: string;
    attempts: ProviderAttempt[];
}

/**
 * Normalization result from Step B
 */
export interface NormalizationResult {
    pages: PageContent[];
    /** The provider that actually produced the text. */
    provider: OCRProvider;
    processingTimeMs: number;
    confidenceScore?: number;
    ocrRouting?: OcrRoutingRecord;
}

/** Office extensions that must go through the ingestion layer (not Azure OCR). */
const OFFICE_EXTENSIONS = [".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls"];

/**
 * True if the filename has a known Office extension. Used to route Office files
 * to the ingestion layer even when mimeType is missing.
 */
export function isKnownOfficeDocument(filename: string): boolean {
    const lower = filename.toLowerCase();
    return OFFICE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// ============================================================================
// Step A: Router - Determine document routing
// ============================================================================

const OCR_ONLY_PROVIDERS = ["AZURE", "LANDING_AI", "DATALAB", "DOCLING"] as const;

function isValidOCRProvider(p: string): p is (typeof OCR_ONLY_PROVIDERS)[number] {
    return OCR_ONLY_PROVIDERS.includes(p as (typeof OCR_ONLY_PROVIDERS)[number]);
}

export interface RouteDocumentOptions {
    forceOCR?: boolean;
    preferredProvider?: OCRProvider;
    mimeType?: string;
    filename?: string;
}

/** Provider-first is the default; OCR_PDF_STRATEGY=text-layer-first opts out. */
function isProviderFirst(): boolean {
    return getOcrConfig().pdfStrategy !== "text-layer-first";
}

/**
 * The engine every PDF goes to under provider-first (the default):
 * OCR_DEFAULT_PROVIDER when it can run here, else the first engine in the
 * shared order (./provider-order.ts) — Docling only while the converter
 * reports it answering.
 *
 * Undefined, so the converter's text-layer-first routing applies, when the
 * operator opted out (text-layer-first), pinned the text layer
 * (OCR_DEFAULT_PROVIDER=NATIVE_PDF, unless OCR is forced), or no engine can
 * run — a PDF with a text layer is then read from it, free.
 */
async function getProviderFirstOcrProvider(forceOCR?: boolean): Promise<OCRProvider | undefined> {
    if (!isProviderFirst()) return undefined;
    const pin = getOcrConfig().defaultProvider;
    if (pin === "NATIVE_PDF" && !forceOCR) return undefined;

    const engine = await firstAvailableOcrEngine();
    if (isOcrEngine(pin) && engine !== pin) {
        console.warn(
            `[Router] OCR_DEFAULT_PROVIDER=${pin} cannot run here; ${
                engine
                    ? `sending PDFs to ${engine}`
                    : "no OCR engine can, so reading the text layer"
            }`
        );
    } else if (!engine) {
        console.log("[Router] No OCR engine can run; reading the text layer");
    }
    return engine;
}

/**
 * Determine how to route the document for processing.
 *
 * An explicit provider wins. Otherwise every PDF goes to the first OCR
 * engine that can run (provider-first, the default). Under
 * OCR_PDF_STRATEGY=text-layer-first — or when no engine can run — the
 * converter decides: a PDF's own text layer when it has one, an engine in the
 * shared order for a scan. This process calls the engines, so its own view of
 * what can run is the one that counts: when the converter sends a scan to the
 * text layer because its environment has no engine but one is configured
 * here, that engine reads it.
 */
export async function routeDocument(
    documentUrl: string,
    options?: RouteDocumentOptions
): Promise<RouterDecisionResult> {
    const preferred = options?.preferredProvider;

    if (preferred && (preferred === "NATIVE_PDF" || isValidOCRProvider(preferred))) {
        const pageCount = await getPageCount(documentUrl);

        return {
            isNativePDF: preferred === "NATIVE_PDF",
            pageCount,
            selectedProvider: preferred,
            reason: "preferred-provider",
            // A pinned provider keeps provider-first's fallbacks, so an
            // upload that names its provider fails no more often than one
            // that leaves it to the order.
            ...(preferred !== "NATIVE_PDF" && isProviderFirst() ? { nativeFallback: true } : {}),
        };
    }

    // No converter round trip: the text-layer check it runs is exactly what
    // this strategy skips. The text layer is read only if every engine fails.
    const providerFirst = await getProviderFirstOcrProvider(options?.forceOCR);
    if (providerFirst) {
        return {
            isNativePDF: false,
            pageCount: await getPageCount(documentUrl),
            selectedProvider: providerFirst,
            reason: "provider-first",
            nativeFallback: true,
        };
    }

    const { determineDocumentRouting } = await import("./complexity");
    const decision: RoutingDecision = await determineDocumentRouting(documentUrl, {
        forceOCR: options?.forceOCR,
        mimeType: options?.mimeType,
        filename: options?.filename,
    });

    // The converter read a text layer (or a form) natively: that is what
    // text-layer-first means. Anything else it sent to NATIVE_PDF needed OCR
    // and found no engine in the converter's environment.
    const textLayerRead =
        decision.reason === "native-text-layer" || decision.reason === "interactive-form";
    const textLayerPinned = getOcrConfig().defaultProvider === "NATIVE_PDF" && !options?.forceOCR;
    if (decision.provider === "NATIVE_PDF" && !textLayerRead && !textLayerPinned) {
        const engine = await firstAvailableOcrEngine();
        if (engine) {
            return {
                isNativePDF: false,
                pageCount: decision.pageCount,
                selectedProvider: engine,
                reason: `${decision.reason}; the converter offered no OCR engine, ${engine} is configured here`,
                visionLabel: decision.signals.visionLabel,
                visionScore: decision.signals.visionScore,
            };
        }
    }

    return {
        isNativePDF: decision.provider === "NATIVE_PDF",
        pageCount: decision.pageCount,
        selectedProvider: decision.provider,
        reason: decision.reason,
        visionLabel: decision.signals.visionLabel,
        visionScore: decision.signals.visionScore,
    };
}

async function getPageCount(documentUrl: string): Promise<number> {
    try {
        const { PDFDocument } = await import("pdf-lib");
        const response = await getStoragePort().download(documentUrl);
        const buffer = await response.arrayBuffer();
        const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        return doc.getPageCount();
    } catch {
        console.warn("[Router] Could not extract page count, defaulting to 1");
        return 1;
    }
}

// ============================================================================
// Step B: Normalize - Run OCR or native extraction
// ============================================================================

/** An error as a short, loggable line — URL query strings (signed tokens) removed. */
function describeProviderError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1?…").slice(0, 300);
}

function textLength(doc: NormalizedDocument): number {
    return doc.pages.reduce(
        (sum, page) =>
            sum +
            page.textBlocks.join("").length +
            page.tables.reduce((t, table) => t + table.markdown.length, 0),
        0
    );
}

/**
 * What every failed engine adds up to. One engine: its own error, unchanged.
 * Several: one error naming each, which counts as the file being refused
 * (see providerRejectedFile) only when every engine refused it — any other
 * failure may pass, so the outbox retries.
 */
function chainError(failures: Array<{ provider: OCRProvider; error: unknown }>): unknown {
    if (failures.length === 1) return failures[0]?.error;
    const summary = failures.map(f => `${f.provider}: ${describeProviderError(f.error)}`);
    const error = new Error(`Every OCR provider failed (${summary.join("; ")})`) as Error & {
        cause?: unknown;
        fileRejected?: boolean;
    };
    error.cause = failures[0]?.error;
    if (failures.every(f => providerRejectedFile(f.error))) error.fileRejected = true;
    return error;
}

/**
 * Reads the PDF with `first`, then — only if it fails — with every other
 * engine that can run, in the shared order (./provider-order.ts; Docling only
 * while the converter reports it answering). When they all fail, the PDF's
 * own text layer is read if routing asked for that (`nativeFallback`), under
 * fallBackToTextLayer's rules; otherwise the engines' error stands.
 *
 * Azure returning fewer pages than the PDF has is a partial read (a free F0
 * resource reads only the first two pages): the next engines are tried, and
 * the partial read is kept only if nothing reads more.
 */
async function readWithOcrEngines(
    documentUrl: string,
    routerDecision: RouterDecisionResult,
    first: OcrEngine,
    attempts: ProviderAttempt[]
): Promise<NormalizedDocument> {
    const failures: Array<{ provider: OCRProvider; error: unknown }> = [];
    let partial: { doc: NormalizedDocument; attempt: ProviderAttempt } | undefined;

    /** One engine's attempt: its pages when it read the whole PDF, else undefined. */
    const tryEngine = async (provider: OCRProvider): Promise<NormalizedDocument | undefined> => {
        const started = Date.now();
        try {
            const doc = await processWithProvider(documentUrl, provider);
            const expected = routerDecision.pageCount;
            if (provider === "AZURE" && expected > 0 && doc.pages.length < expected) {
                const attempt: ProviderAttempt = {
                    provider,
                    ok: false,
                    error: `returned ${doc.pages.length} of ${expected} pages (a free F0 Document Intelligence resource reads only the first two)`,
                    durationMs: Date.now() - started,
                };
                attempts.push(attempt);
                console.warn(`[Normalize] ${provider} ${attempt.error}; trying the next provider`);
                partial ??= { doc, attempt };
                return undefined;
            }
            attempts.push({ provider, ok: true, durationMs: Date.now() - started });
            return doc;
        } catch (error) {
            const described = describeProviderError(error);
            failures.push({ provider, error });
            attempts.push({
                provider,
                ok: false,
                error: described,
                durationMs: Date.now() - started,
            });
            console.warn(`[Normalize] ${provider} failed: ${described}`);
            return undefined;
        }
    };

    const read = await tryEngine(first);
    if (read) return read;
    // The fallbacks are looked up only once `first` has failed, so a
    // document the first engine reads never waits on the converter.
    const [, ...fallbacks] = ocrFallbackChain(first, await availableOcrEngines(), { isPdf: false });
    for (const provider of fallbacks) {
        const fallbackRead = await tryEngine(provider);
        if (fallbackRead) return fallbackRead;
    }

    if (partial) {
        // A partial read beats a text layer holding less (a scan's), and
        // loses to one holding more (a long PDF that has its own text).
        if (routerDecision.nativeFallback) {
            const started = Date.now();
            try {
                const textLayer = await processNativePDF(documentUrl);
                if (textLength(textLayer) > textLength(partial.doc)) {
                    attempts.push({
                        provider: "NATIVE_PDF",
                        ok: true,
                        durationMs: Date.now() - started,
                    });
                    return textLayer;
                }
                attempts.push({
                    provider: "NATIVE_PDF",
                    ok: false,
                    error: `read less text than ${partial.attempt.provider}'s partial result`,
                    durationMs: Date.now() - started,
                });
            } catch (error) {
                attempts.push({
                    provider: "NATIVE_PDF",
                    ok: false,
                    error: describeProviderError(error),
                    durationMs: Date.now() - started,
                });
            }
        }
        partial.attempt.ok = true;
        return partial.doc;
    }

    const error = chainError(failures);
    if (!routerDecision.nativeFallback) throw error;

    const started = Date.now();
    const document = await fallBackToTextLayer(
        documentUrl,
        failures.map(f => f.provider).join(", "),
        error
    );
    attempts.push({ provider: "NATIVE_PDF", ok: true, durationMs: Date.now() - started });
    return document;
}

/**
 * Normalize document content with the provider routing chose. An OCR engine
 * that fails hands the document to the next one that can run, then (when
 * routing asked) to the PDF's own text layer; the text layer as the choice —
 * the text-only method, an operator pin, or no engine at all — stays exactly
 * that. The result names the provider that produced the text and carries
 * every attempt, so a fallback is on the record.
 */
export async function normalizeDocument(
    documentUrl: string,
    routerDecision: RouterDecisionResult
): Promise<NormalizationResult> {
    const requested: OCRProvider = routerDecision.isNativePDF
        ? "NATIVE_PDF"
        : routerDecision.selectedProvider;
    console.log(`[Normalize] Processing with provider: ${requested}`);

    const attempts: ProviderAttempt[] = [];
    let normalizedDoc: NormalizedDocument;

    if (isOcrEngine(requested)) {
        normalizedDoc = await readWithOcrEngines(documentUrl, routerDecision, requested, attempts);
    } else {
        const started = Date.now();
        normalizedDoc = await processWithProvider(documentUrl, requested);
        attempts.push({
            provider: normalizedDoc.metadata.provider,
            ok: true,
            durationMs: Date.now() - started,
        });
    }

    const ocrRouting: OcrRoutingRecord = {
        requestedProvider: requested,
        provider: normalizedDoc.metadata.provider,
        fellBack: normalizedDoc.metadata.provider !== requested,
        routingReason: routerDecision.reason,
        attempts,
    };
    if (ocrRouting.fellBack) {
        console.warn(
            `[Normalize] Fell back from ${requested} to ${ocrRouting.provider}: ` +
                attempts
                    .filter(a => !a.ok)
                    .map(a => `${a.provider} (${a.error})`)
                    .join(", ")
        );
    }

    // --- VLM Enrichment Step ---
    // Only applicable for PDFs where we can render pages to images.
    // Triggers:
    // 1. "Complex" / "Handwritten" label from the routing vision classifier
    // 2. Provider-reported low OCR confidence (< 0.7 on the [0,1] scale);
    //    absent confidence never triggers — it means "no measurement", not
    //    "low". (The old `?? 100 < 70` check compared a fabricated constant
    //    and was dead code, ADR-004.)
    // 3. Explicitly requested via options (future)

    const isPdf =
        documentUrl.toLowerCase().endsWith(".pdf") ||
        (await getStoragePort()
            .download(documentUrl, { method: "HEAD" })
            .then(r => r.headers.get("content-type") === "application/pdf")
            .catch(() => false));

    const vlmAvailable = isVlmEnrichmentConfigured();
    if (isPdf && vlmAvailable) {
        const isComplex = routerDecision.visionLabel
            ? ["complex", "handwritten", "messy", "figure", "diagram"].some(l =>
                  routerDecision.visionLabel?.toLowerCase().includes(l)
              )
            : false;

        const confidence = normalizedDoc.metadata.confidenceScore;
        const isLowConfidence = confidence !== undefined && confidence < 0.7;

        if (isComplex || isLowConfidence) {
            console.log(
                `[Enrichment] Triggering VLM enrichment (Complex=${isComplex}, LowConf=${isLowConfidence})`
            );
            try {
                const response = await getStoragePort().download(documentUrl);
                const buffer = await response.arrayBuffer();

                // Identify pages to enrich (all for now, or sample? Plan says "Complex" or "Low Conf").
                // For efficiency, let's limit to the first 5 pages + any low confidence pages if we had per-page confidence (we have avg).
                // Let's enrich up to 5 pages for now to avoid massive costs/latency.
                const pagesToEnrich = normalizedDoc.pages.slice(0, 5).map(p => p.pageNumber);

                if (pagesToEnrich.length > 0) {
                    console.log(`[Enrichment] Rendering ${pagesToEnrich.length} pages for VLM...`);
                    const images = await renderPagesToImages(buffer, pagesToEnrich);

                    for (let i = 0; i < images.length; i++) {
                        const imageBuffer = images[i];
                        if (!imageBuffer) continue;

                        const pageNum = pagesToEnrich[i];
                        console.log(`[Enrichment] Analyzing Page ${pageNum} with VLM...`);

                        const description = await enrichPageWithVlm(Buffer.from(imageBuffer));
                        if (description) {
                            const page = normalizedDoc.pages.find(p => p.pageNumber === pageNum);
                            if (page) {
                                page.textBlocks.push(`\n[Visual Description]: ${description}`);
                                console.log(`[Enrichment] Added description to Page ${pageNum}`);
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn("[Enrichment] Failed:", err);
            }
        }
    }

    return {
        pages: normalizedDoc.pages,
        provider: normalizedDoc.metadata.provider,
        processingTimeMs: normalizedDoc.metadata.processingTimeMs,
        confidenceScore: normalizedDoc.metadata.confidenceScore,
        ocrRouting,
    };
}

// ============================================================================
// Step C: Chunking
// ============================================================================

/**
 * Chunk the normalized document pages.
 * If a filename is provided and it's a known code extension, uses code-aware
 * chunking that respects function/class boundaries.
 */
export interface ChunkPagesOptions {
    /** Written into every chunk's breadcrumb so a chunk names its document. */
    documentTitle?: string;
    /** Embedding model whose tokenizer decides what fits; falls back to an estimate. */
    embeddingModel?: string;
}

export async function chunkPages(
    pages: PageContent[],
    filename?: string,
    options?: ChunkPagesOptions
): Promise<DocumentChunk[]> {
    const { isCodeFile, chunkCodeFile } = await import("./code-chunker");

    if (filename && isCodeFile(filename)) {
        console.log(`[Chunking] Using code-aware chunker for ${filename}`);
        const codeChunks = chunkCodeFile(pages, filename);
        console.log(`[Chunking] Created ${codeChunks.length} code parent chunks`);
        codeChunks.forEach((chunk, idx) => {
            console.log(
                `[Chunking] Code Parent ${idx}: ${chunk.content.length} chars, ${chunk.children?.length ?? 0} children, path=${chunk.metadata.structurePath ?? ""}`
            );
        });
        return codeChunks;
    }

    const pageSizes = pages.map((page, idx) => {
        const textLength = page.textBlocks.join("").length;
        return `Page ${idx + 1}: ${textLength} chars, ${page.textBlocks.length} blocks, ${page.tables.length} tables`;
    });
    console.log(`[Chunking] Page content sizes:\n${pageSizes.join("\n")}`);

    // A real tokenizer when one loads, the chars-per-token estimate when it
    // does not. Resolved here rather than inside the chunker so one document
    // pays the load cost once.
    const { tokenCounterFor } = await import("./tokenizer");
    const tokens = await tokenCounterFor(options?.embeddingModel ?? "text-embedding-3-large");

    const documentChunks = await chunkDocument(pages, {
        parentMaxTokens: 1000,
        childMaxTokens: 256,
        overlapTokens: 50,
        includePageContext: true,
        documentTitle: options?.documentTitle,
        tokens,
    });
    console.log(
        `[Chunking] Created ${documentChunks.length} Parent chunks (budget by ${tokens.id})`
    );

    documentChunks.forEach((chunk, idx) => {
        console.log(
            `[Chunking] Parent Chunk ${idx}: ${chunk.content.length} chars, ${chunk.children?.length ?? 0} children`
        );
    });

    return documentChunks;
}

// ============================================================================
// Step D: Vectorize
// ============================================================================

/**
 * Generate embeddings for document chunks
 */
export async function vectorizeChunks(
    chunks: DocumentChunk[],
    embeddingIndex: EmbeddingIndexConfig
): Promise<VectorizedChunk[]> {
    if (chunks.length === 0) {
        console.log("[Vectorize] No chunks to vectorize, returning empty");
        return [];
    }

    console.log(
        `[Vectorize] Preparing ${chunks.length} Parent chunks (and children) for embedding`
    );
    const contentStrings = prepareForEmbedding(chunks);
    console.log(
        `[Vectorize] Flattened to ${contentStrings.length} Child/Table chunks for embedding, total chars=${contentStrings.reduce((s, c) => s + c.length, 0)}`
    );

    const embedStart = Date.now();
    const embeddings = createEmbeddingModel(embeddingIndex);
    const vectors =
        (await embeddings.embedDocuments?.(contentStrings)) ??
        (await Promise.all(contentStrings.map(text => embeddings.embedQuery(text))));
    console.log(
        `[Vectorize] Embeddings generated: ${vectors.length} vectors (${Date.now() - embedStart}ms)`
    );

    const merged = mergeWithEmbeddings(chunks, vectors, {
        shortDimension: embeddingIndex.shortDimension,
        supportsMatryoshka: supportsShortVectorSearch(embeddingIndex),
    });
    console.log(`[Vectorize] Merged back into ${merged.length} Parent chunks`);
    return merged;
}

// ============================================================================
// Step E: Storage
// ============================================================================

/**
 * Stored section reference returned by storeDocument.
 * Used by downstream steps (e.g. Graph RAG entity extraction).
 */
export interface StoredSection {
    sectionId: number;
    content: string;
}

/**
 * Verify that the target document exists before inserting chunks.
 * Retries up to 3 times with exponential backoff to handle replication lag.
 */
export async function ensureDocumentExists(documentId: number): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const [existingDoc] = await getDb()
            .select({ id: documentTable.id })
            .from(documentTable)
            .where(eq(documentTable.id, documentId));
        if (existingDoc) return;
        if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, attempt * 500));
        }
    }
    throw new Error(
        `Document ${documentId} does not exist. Cannot store chunks. ` +
            `The document may have been deleted before the job completed.`
    );
}

/**
 * Create the root document structure node. Must be called once before storeBatch.
 *
 * The root structure node is tagged with the processing version so deleting
 * that version cascades and removes this node (and everything under it).
 */
export async function createRootStructure(
    documentId: number,
    totalPages: number,
    estimatedTokens: number,
    versionId: number
): Promise<number> {
    await ensureDocumentExists(documentId);

    return withDbRetry(async () => {
        const rootStructure = await getDb()
            .insert(documentStructure)
            .values({
                documentId: BigInt(documentId),
                versionId: BigInt(versionId),
                parentId: null,
                contentType: "section",
                path: "/",
                title: "Document Root",
                level: 0,
                ordering: 0,
                startPage: 1,
                endPage: totalPages,
                tokenCount: estimatedTokens,
                childCount: 0,
            })
            .returning({ id: documentStructure.id });

        const rootId = rootStructure[0]?.id;
        if (!rootId) {
            throw new Error("Failed to create root document structure");
        }
        return rootId;
    });
}

/**
 * The document's structure, as ids a chunk can point at.
 *
 * `byPath` is keyed by a chunk's ancestor path joined with the same separator
 * the breadcrumb uses, so a chunk resolves its own node without string
 * surgery. The root is the fallback for chunks that have no ancestors — a
 * table, or a document with no headings at all.
 */
export interface DocumentStructureMap {
    rootId: number;
    /**
     * A plain object, not a Map: this value is returned from an Inngest step,
     * and step output is JSON — a Map would arrive on the other side empty.
     */
    byPath: Record<string, number>;
}

/** The separator between breadcrumb steps; must match the chunker's. */
const CRUMB = " › ";

/**
 * Write the document's real hierarchy.
 *
 * The table has always modelled a tree — `parentId`, `path`, `level`,
 * `ordering` — and the pipeline has always written exactly one row into it,
 * so every chunk pointed at the same "Document Root" and no query could ask
 * for a section. Chunks now carry their ancestors, so the tree they imply
 * can be materialised: one node per distinct ancestor path, parents before
 * children, each chunk pointing at its own node.
 */
export async function createStructureTree(
    documentId: number,
    totalPages: number,
    versionId: number,
    chunks: DocumentChunk[]
): Promise<DocumentStructureMap> {
    const rootId = await createRootStructure(
        documentId,
        totalPages,
        chunks.reduce((sum, c) => sum + (c.metadata.tokenCount ?? 0), 0),
        versionId
    );
    const byPath: Record<string, number> = {};

    // Every ancestor path, plus every prefix of one, so a parent always
    // exists before the child that references it.
    const paths = new Set<string>();
    for (const chunk of chunks) {
        const ancestors = chunk.metadata.ancestors ?? [];
        for (let i = 1; i <= ancestors.length; i++) {
            paths.add(ancestors.slice(0, i).join(CRUMB));
        }
    }
    if (paths.size === 0) return { rootId, byPath };

    // Shallowest first: a node's parent is inserted before it.
    const ordered = [...paths].sort(
        (a, b) => a.split(CRUMB).length - b.split(CRUMB).length || a.localeCompare(b)
    );

    // Page span and token weight per node, summed from the chunks under it.
    const stats = new Map<string, { start: number; end: number; tokens: number }>();
    for (const chunk of chunks) {
        const ancestors = chunk.metadata.ancestors ?? [];
        const page = chunk.metadata.pageNumber;
        for (let i = 1; i <= ancestors.length; i++) {
            const key = ancestors.slice(0, i).join(CRUMB);
            const seen = stats.get(key);
            if (seen) {
                seen.start = Math.min(seen.start, page);
                seen.end = Math.max(seen.end, page);
                seen.tokens += chunk.metadata.tokenCount ?? 0;
            } else {
                stats.set(key, {
                    start: page,
                    end: page,
                    tokens: chunk.metadata.tokenCount ?? 0,
                });
            }
        }
    }

    const orderingByParent = new Map<string, number>();
    await withDbRetry(async () => {
        for (const path of ordered) {
            const steps = path.split(CRUMB);
            const parentPath = steps.slice(0, -1).join(CRUMB);
            const parentId = parentPath.length > 0 ? byPath[parentPath] : rootId;
            const ordering = orderingByParent.get(parentPath) ?? 0;
            orderingByParent.set(parentPath, ordering + 1);
            const stat = stats.get(path);

            const [row] = await getDb()
                .insert(documentStructure)
                .values({
                    documentId: BigInt(documentId),
                    versionId: BigInt(versionId),
                    parentId: parentId != null ? BigInt(parentId) : BigInt(rootId),
                    contentType: "section",
                    // `path` is varchar(256); a deep path is truncated from
                    // the left so the most specific steps survive.
                    path: `/${path.split(CRUMB).join("/")}`.slice(-256),
                    title: steps[steps.length - 1] ?? null,
                    level: steps.length,
                    ordering,
                    startPage: stat?.start ?? 1,
                    endPage: stat?.end ?? totalPages,
                    tokenCount: stat?.tokens ?? 0,
                    childCount: 0,
                })
                .returning({ id: documentStructure.id });
            if (row) byPath[path] = row.id;
        }
    });

    // Child counts, now that every node exists.
    const childCounts = new Map<string, number>();
    for (const path of ordered) {
        const parentPath = path.split(CRUMB).slice(0, -1).join(CRUMB);
        childCounts.set(parentPath, (childCounts.get(parentPath) ?? 0) + 1);
    }
    for (const [parentPath, count] of childCounts) {
        const id = parentPath.length > 0 ? byPath[parentPath] : rootId;
        if (id == null) continue;
        await getDb()
            .update(documentStructure)
            .set({ childCount: count })
            .where(eq(documentStructure.id, id))
            .catch((error: unknown) => {
                // Advisory only — a missing count never blocks ingestion.
                console.warn(`[Structure] child count update failed for ${id}:`, error);
            });
    }

    console.log(
        `[Structure] Wrote ${Object.keys(byPath).length} node(s) under the root for doc ${documentId}`
    );
    return { rootId, byPath };
}

/** The structure node a chunk belongs to, falling back to the document root. */
export function structureIdFor(
    structure: DocumentStructureMap | number,
    metadata: { ancestors?: string[] }
): number {
    if (typeof structure === "number") return structure;
    const key = (metadata.ancestors ?? []).join(CRUMB);
    return structure.byPath[key] ?? structure.rootId;
}

/**
 * Write a batch of vectorized chunks to the database (context + retrieval chunks).
 * Designed to be called per-batch inside an Inngest step so vectors never
 * need to pass through step output serialization.
 */
export async function storeBatch(
    documentId: number,
    /** The document's structure. A bare id keeps the pre-tree callers working. */
    structure: DocumentStructureMap | number,
    vectorizedChunks: VectorizedChunk[],
    embeddingIndex: EmbeddingIndexConfig,
    versionId: number
): Promise<StoredSection[]> {
    if (vectorizedChunks.length === 0) return [];

    const versionBigInt = BigInt(versionId);
    return withDbRetry(async () => {
        const result = await getDb().transaction(async tx => {
            const parentValues = vectorizedChunks.map(chunk => {
                const semanticType: "tabular" | "narrative" = chunk.metadata.isTable
                    ? "tabular"
                    : "narrative";
                return {
                    documentId: BigInt(documentId),
                    versionId: versionBigInt,
                    // Each chunk points at its own section now, not at one
                    // "Document Root" every chunk in the corpus shared.
                    structureId: BigInt(structureIdFor(structure, chunk.metadata)),
                    content: chunk.content,
                    // The chunker counted these with the embedding model's
                    // own tokenizer; the chars-per-token estimate is only a
                    // fallback for chunks made before it did.
                    tokenCount: chunk.metadata.tokenCount ?? Math.ceil(chunk.content.length / 4),
                    charCount: chunk.content.length,
                    embedding:
                        isLegacyEmbeddingIndex(embeddingIndex) &&
                        chunk.vector &&
                        chunk.vector.length > 0
                            ? sql`${JSON.stringify(chunk.vector)}::vector(1536)`
                            : null,
                    pageNumber: chunk.metadata.pageNumber,
                    semanticType,
                    contentHash: crypto.createHash("sha256").update(chunk.content).digest("hex"),
                };
            });

            const parentRows = await tx
                .insert(documentContextChunks)
                .values(parentValues)
                .returning({
                    id: documentContextChunks.id,
                    content: documentContextChunks.content,
                });

            const storedSections: StoredSection[] = parentRows.map(r => ({
                sectionId: r.id,
                content: r.content,
            }));

            const childValues: Array<{
                contextChunkId: bigint;
                documentId: bigint;
                versionId: bigint;
                content: string;
                tokenCount: number;
                embedding: ReturnType<typeof sql> | null;
                embeddingShort: ReturnType<typeof sql> | null;
            }> = [];
            const dimensionTableVectors: number[][] = [];

            for (let i = 0; i < vectorizedChunks.length; i++) {
                const chunk = vectorizedChunks[i]!;
                const parentId = parentRows[i]?.id;
                if (!parentId || !chunk.children?.length) continue;

                for (const child of chunk.children) {
                    childValues.push({
                        contextChunkId: BigInt(parentId),
                        documentId: BigInt(documentId),
                        versionId: versionBigInt,
                        content: child.content,
                        tokenCount:
                            child.metadata.tokenCount ?? Math.ceil(child.content.length / 4),
                        embedding: isLegacyEmbeddingIndex(embeddingIndex)
                            ? sql`${JSON.stringify(child.vector)}::vector(1536)`
                            : null,
                        embeddingShort:
                            isLegacyEmbeddingIndex(embeddingIndex) && child.vectorShort
                                ? sql`${JSON.stringify(child.vectorShort)}::vector(512)`
                                : null,
                    });
                    if (!isLegacyEmbeddingIndex(embeddingIndex)) {
                        dimensionTableVectors.push(child.vector);
                    }
                }
            }

            const CHILD_BATCH_SIZE = 50;
            const insertedDimensionTableChunkIds: number[] = [];
            for (let i = 0; i < childValues.length; i += CHILD_BATCH_SIZE) {
                const insertedRows = await tx
                    .insert(documentRetrievalChunks)
                    .values(childValues.slice(i, i + CHILD_BATCH_SIZE))
                    .returning({ id: documentRetrievalChunks.id });
                if (!isLegacyEmbeddingIndex(embeddingIndex)) {
                    insertedDimensionTableChunkIds.push(...insertedRows.map(row => row.id));
                }
            }

            return {
                storedSections,
                insertedDimensionTableChunkIds,
                dimensionTableVectors,
            };
        });

        if (!isLegacyEmbeddingIndex(embeddingIndex) && result.dimensionTableVectors.length > 0) {
            await storeDimensionTableEmbeddings({
                documentId,
                retrievalChunkIds: result.insertedDimensionTableChunkIds,
                vectors: result.dimensionTableVectors,
                index: embeddingIndex,
            });
        }

        return result.storedSections;
    });
}

/**
 * The `ocr_confidence_score` / `confidence_score` columns are integer percent
 * (0-100) and predate the [0,1] provider-reported scale (ADR-004). OCR-path
 * confidences are now optional [0,1]; ingestion adapters still report integer
 * percents. Store an integer percent either way; absent stays NULL — never
 * fabricated.
 */
function toStoredConfidencePercent(confidence: number | undefined): number | undefined {
    if (confidence === undefined) return undefined;
    return Math.round(confidence <= 1 ? confidence * 100 : confidence);
}

/**
 * Finalize storage after all batches: create document metadata, update document
 * record, and mark the OCR job as completed.  Needs only counts and metadata,
 * not vectors or chunk content.
 */
/** The keys apps/worker's dead-event handler stamps on a failed source. */
const FAILURE_STAMP_KEYS = new Set(["error", "errorMessage", "failedAt"]);

export async function finalizeStorage(
    documentId: number,
    jobId: string,
    totalChunks: number,
    summaryText: string,
    meta: {
        totalPages: number;
        provider: string;
        processingTimeMs: number;
        confidenceScore?: number;
        embeddingIndexKey?: string;
        /** Which provider was meant to read the document, which did, and why. */
        ocrRouting?: OcrRoutingRecord;
    },
    pipelineStartTime: number,
    versionId: number
): Promise<void> {
    return withDbRetry(async () => {
        const summaryPreview =
            summaryText.substring(0, 500) + (summaryText.length > 500 ? "..." : "");

        // Upsert on (document, version): the outbox worker replays this step
        // after downstream failures, and a plain INSERT would hit the unique
        // index forever once a first attempt got this far (ADR-003
        // idempotency requirement — found by the e2e replay smoke).
        await getDb()
            .insert(documentMetadata)
            .values({
                documentId: BigInt(documentId),
                versionId: BigInt(versionId),
                summary: summaryPreview,
                outline: Array.from({ length: meta.totalPages }, (_, i) => ({
                    id: i + 1,
                    title: `Page ${i + 1}`,
                    level: 1,
                    path: `/${i + 1}`,
                    pageRange: { start: i + 1, end: i + 1 },
                })),
                totalTokens: Math.ceil(summaryText.length / 4),
                totalPages: meta.totalPages,
                totalSections: totalChunks,
                topicTags: [],
                entities: {},
            })
            .onConflictDoUpdate({
                target: [documentMetadata.documentId, documentMetadata.versionId],
                set: {
                    summary: summaryPreview,
                    totalTokens: Math.ceil(summaryText.length / 4),
                    totalPages: meta.totalPages,
                    totalSections: totalChunks,
                    updatedAt: new Date(),
                },
            });

        // Merge, never replace: the row's metadata carries provenance written
        // at creation — a connector's marker, a published mindmap's id — and
        // the viewer picks a renderer by it. Overwriting it here turned every
        // imported session back into a plain Markdown file the moment it
        // finished indexing.
        const [existing] = await getDb()
            .select({ ocrMetadata: documentTable.ocrMetadata })
            .from(documentTable)
            .where(eq(documentTable.id, documentId))
            .limit(1);
        // ...except the dead-event handler's failure stamp: a run that
        // succeeds after it (an operator replay, a re-upload, Retry) must not
        // carry a stale "processing_failed" and its error message forward.
        const preserved = Object.fromEntries(
            Object.entries(
                existing?.ocrMetadata &&
                    typeof existing.ocrMetadata === "object" &&
                    !Array.isArray(existing.ocrMetadata)
                    ? (existing.ocrMetadata as Record<string, unknown>)
                    : {}
            ).filter(([key]) => !FAILURE_STAMP_KEYS.has(key))
        );
        const ocrMetadataPayload = {
            ...preserved,
            totalPages: meta.totalPages,
            totalChunks,
            processingTimeMs: meta.processingTimeMs,
            embeddingIndexKey: meta.embeddingIndexKey,
            ...(meta.ocrRouting ? { ocrRouting: meta.ocrRouting } : {}),
            processedAt: new Date().toISOString(),
        };

        await getDb()
            .update(documentTable)
            .set({
                ocrProcessed: true,
                ocrJobId: jobId,
                ocrProvider: meta.provider,
                ocrConfidenceScore: toStoredConfidencePercent(meta.confidenceScore),
                ocrMetadata: ocrMetadataPayload,
            })
            .where(
                and(
                    eq(documentTable.id, documentId),
                    eq(documentTable.currentVersionId, BigInt(versionId))
                )
            );

        // Mirror OCR completion onto the per-version row so each version carries
        // its own processing provenance. Important when different versions of the
        // same document were run through different OCR providers.
        await getDb()
            .update(documentVersions)
            .set({
                ocrProcessed: true,
                ocrJobId: jobId,
                ocrProvider: meta.provider,
                ocrMetadata: ocrMetadataPayload,
            })
            .where(
                and(
                    eq(documentVersions.id, versionId),
                    eq(documentVersions.documentId, BigInt(documentId))
                )
            );

        await getDb()
            .update(ocrJobs)
            .set({
                status: "completed",
                completedAt: new Date(),
                // A replayed job that failed before still holds that error.
                errorMessage: null,
                processingDurationMs: Date.now() - pipelineStartTime,
                pageCount: meta.totalPages,
                ...(meta.ocrRouting ? { primaryProvider: meta.ocrRouting.requestedProvider } : {}),
                actualProvider: meta.provider,
                confidenceScore: toStoredConfidencePercent(meta.confidenceScore),
            })
            .where(eq(ocrJobs.id, jobId));

        console.log(`[Storage] Finalized docId=${documentId}, ${totalChunks} chunks, job=${jobId}`);
    });
}

/**
 * Store vectorized chunks in the database.
 * Returns an array of { sectionId, content } for each inserted section (Context Chunk),
 * which downstream steps (e.g. entity extraction) can use.
 * @deprecated Use createRootStructure + storeBatch + finalizeStorage for Inngest pipelines
 */
export async function storeDocument(
    documentId: number,
    jobId: string,
    vectorizedChunks: VectorizedChunk[],
    normalizationResult: NormalizationResult,
    pipelineStartTime: number,
    versionId: number
): Promise<StoredSection[]> {
    if (vectorizedChunks.length === 0) {
        console.log("[Storage] No chunks to store, skipping");
        return [];
    }

    const versionBigInt = BigInt(versionId);

    const storeStart = Date.now();
    console.log(
        `[Storage] Storing ${vectorizedChunks.length} Parent chunks for docId=${documentId}, job=${jobId}, ` +
            `pages=${normalizationResult.pages.length}`
    );

    // Ensure document exists before inserting (avoids opaque FK violation).
    // Retry once after 2s to handle replication lag or timing races.
    let [existingDoc] = await getDb()
        .select({ id: documentTable.id })
        .from(documentTable)
        .where(eq(documentTable.id, documentId));
    if (!existingDoc) {
        await new Promise(r => setTimeout(r, 2000));
        [existingDoc] = await getDb()
            .select({ id: documentTable.id })
            .from(documentTable)
            .where(eq(documentTable.id, documentId));
    }
    if (!existingDoc) {
        throw new Error(
            `Document ${documentId} does not exist. Cannot store chunks. ` +
                `The document may have been deleted before the job completed.`
        );
    }

    const rootStructure = await getDb()
        .insert(documentStructure)
        .values({
            documentId: BigInt(documentId),
            versionId: versionBigInt,
            parentId: null,
            path: "/",
            title: "Document Root",
            level: 0,
            ordering: 0,
            startPage: 1,
            endPage: normalizationResult.pages.length,
            tokenCount: Math.ceil(
                vectorizedChunks.reduce((sum, c) => sum + c.content.length / 4, 0)
            ),
            childCount: 0,
        })
        .returning({ id: documentStructure.id });

    const rootId = rootStructure[0]?.id;
    if (!rootId) {
        throw new Error("Failed to create root document structure");
    }

    // 2. Insert document context chunks (Parents) and retrieval chunks (Children)
    console.log(`[Storage] 2/5 Inserting ${vectorizedChunks.length} document context chunks...`);
    const storedSections: StoredSection[] = [];

    for (const chunk of vectorizedChunks) {
        const contentHash = crypto.createHash("sha256").update(chunk.content).digest("hex");
        const isTable = chunk.metadata.isTable;

        const [row] = await getDb()
            .insert(documentContextChunks)
            .values({
                documentId: BigInt(documentId),
                versionId: versionBigInt,
                structureId: BigInt(rootId),
                content: chunk.content,
                tokenCount: chunk.metadata.tokenCount ?? Math.ceil(chunk.content.length / 4),
                charCount: chunk.content.length,
                // Parent chunks might not have embeddings in this architecture
                // But if 'vector' is present and not empty, use it. In new chunker, parent vector is empty.
                embedding:
                    chunk.vector && chunk.vector.length > 0
                        ? sql`${JSON.stringify(chunk.vector)}::vector(1536)`
                        : null,
                pageNumber: chunk.metadata.pageNumber,
                semanticType: isTable ? "tabular" : "narrative",
                contentHash,
            })
            .returning({ id: documentContextChunks.id });

        if (row) {
            storedSections.push({ sectionId: row.id, content: chunk.content });

            // Insert Children (Retrieval Chunks)
            if (chunk.children && chunk.children.length > 0) {
                for (const child of chunk.children) {
                    await getDb()
                        .insert(documentRetrievalChunks)
                        .values({
                            contextChunkId: BigInt(row.id),
                            documentId: BigInt(documentId),
                            versionId: versionBigInt,
                            content: child.content,
                            tokenCount:
                                child.metadata.tokenCount ?? Math.ceil(child.content.length / 4),
                            embedding: sql`${JSON.stringify(child.vector)}::vector(1536)`,
                            embeddingShort: child.vectorShort
                                ? sql`${JSON.stringify(child.vectorShort)}::vector(512)`
                                : null,
                        });
                }
            }
        }
    }

    console.log(`[Storage] 2/5 Done: ${storedSections.length} context chunks inserted`);

    // 3. Create document metadata for planning layer
    console.log("[Storage] 3/5 Creating document metadata...");
    const fullText = vectorizedChunks.map(c => c.content).join("\n\n");
    const summaryPreview = fullText.substring(0, 500) + (fullText.length > 500 ? "..." : "");

    await getDb()
        .insert(documentMetadata)
        .values({
            documentId: BigInt(documentId),
            versionId: versionBigInt,
            summary: summaryPreview,
            outline: normalizationResult.pages.map((_, i) => ({
                id: i + 1,
                title: `Page ${i + 1}`,
                level: 1,
                path: `/${i + 1}`,
                pageRange: { start: i + 1, end: i + 1 },
            })),
            totalTokens: vectorizedChunks.reduce(
                (sum, c) => sum + Math.ceil(c.content.length / 4),
                0
            ),
            totalPages: normalizationResult.pages.length,
            totalSections: vectorizedChunks.length,
            topicTags: [],
            entities: {},
        });

    // 4. Update document record with OCR metadata
    console.log("[Storage] 4/5 Updating document record...");
    await getDb()
        .update(documentTable)
        .set({
            ocrProcessed: true,
            ocrJobId: jobId,
            ocrProvider: normalizationResult.provider,
            ocrConfidenceScore: toStoredConfidencePercent(normalizationResult.confidenceScore),
            ocrMetadata: {
                totalPages: normalizationResult.pages.length,
                totalChunks: vectorizedChunks.length,
                processingTimeMs: normalizationResult.processingTimeMs,
                processedAt: new Date().toISOString(),
            },
        })
        .where(
            and(
                eq(documentTable.id, documentId),
                eq(documentTable.currentVersionId, BigInt(versionId))
            )
        );

    // 5. Update OCR job status
    console.log("[Storage] 5/5 Updating OCR job status...");
    await getDb()
        .update(ocrJobs)
        .set({
            status: "completed",
            completedAt: new Date(),
            processingDurationMs: Date.now() - pipelineStartTime,
            pageCount: normalizationResult.pages.length,
            actualProvider: normalizationResult.provider,
            confidenceScore: toStoredConfidencePercent(normalizationResult.confidenceScore),
        })
        .where(eq(ocrJobs.id, jobId));

    console.log(
        `[Storage] Successfully stored ${storedSections.length} sections for docId=${documentId} (${Date.now() - storeStart}ms)`
    );

    return storedSections;
}

/**
 * Mark OCR job as failed
 */
export async function markJobFailed(jobId: string, error: Error): Promise<void> {
    await getDb()
        .update(ocrJobs)
        .set({
            status: "failed",
            completedAt: new Date(),
            errorMessage: error.message,
        })
        .where(eq(ocrJobs.id, jobId));
}

// ============================================================================
// Full Pipeline - Synchronous Processing
// ============================================================================

// processDocumentSync was a convenience wrapper that dynamically imported
// apps/web's lib/tools doc-ingestion orchestrator. It had no callers inside
// this repo (verified via grep) and crossed the core → app boundary, so it
// has been removed. Callers that want the sync pipeline should invoke the
// orchestration tool from the hosting app directly.

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Process native PDF with per-page text extraction.
 * Uses pdfjs-serverless for Node.js/serverless (no DOMMatrix) - compatible with Inngest, Vercel, etc.
 */
export async function processNativePDF(documentUrl: string): Promise<NormalizedDocument> {
    const { document } = await readTextLayer(documentUrl, { findImageOnlyPages: false });
    return document;
}

/** pdf.js operators that paint an image onto the page. */
const IMAGE_PAINT_OPS = [
    "paintImageXObject",
    "paintImageXObjectRepeat",
    "paintInlineImageXObject",
    "paintInlineImageXObjectGroup",
    "paintImageMaskXObject",
    "paintImageMaskXObjectGroup",
    "paintImageMaskXObjectRepeat",
] as const;

/**
 * A page that paints an image and carries fewer non-space characters than
 * this in its text layer is a scan: a page or Bates stamp is not a reading of
 * the page, so a scan stamped "Page 3 of 40" is not indexed as its stamp.
 */
const SCANNED_PAGE_MAX_TEXT_CHARS = 20;

/**
 * Reads a PDF's own text layer, page by page. With `findImageOnlyPages`, it
 * also reports the pages that paint an image and have no text, or no more
 * than a stamp's worth — most likely scanned, so the text layer cannot read
 * them. A blank page paints nothing and is not reported.
 */
async function readTextLayer(
    documentUrl: string,
    { findImageOnlyPages }: { findImageOnlyPages: boolean }
): Promise<{ document: NormalizedDocument; imageOnlyPages: number[] }> {
    const startTime = Date.now();

    const { getDocument, OPS } = await import("pdfjs-serverless");
    const imagePaintOps = new Set<number>(IMAGE_PAINT_OPS.map(name => OPS[name]));
    const imageOnlyPages: number[] = [];

    // 1. Fetch PDF data
    const response = await getStoragePort().download(documentUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // 2. Load document (pdfjs-serverless is built for serverless - no worker needed)
    const loadingTask = getDocument({
        data: uint8Array,
        useSystemFonts: true,
    });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    // 3. Extract text per page
    const pages: PageContent[] = [];
    for (let i = 1; i <= numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items
            .map(item => ("str" in item ? item.str : ""))
            .join(" ")
            .trim();

        pages.push({
            pageNumber: i,
            textBlocks: text.length > 0 ? [text] : [],
            tables: [],
        });

        if (findImageOnlyPages && text.replace(/\s+/g, "").length < SCANNED_PAGE_MAX_TEXT_CHARS) {
            const { fnArray } = await page.getOperatorList();
            if (fnArray.some(op => imagePaintOps.has(op))) imageOnlyPages.push(i);
        }
    }

    await pdfDoc.destroy();

    return {
        document: {
            pages,
            metadata: {
                totalPages: numPages,
                provider: "NATIVE_PDF",
                processingTimeMs: Date.now() - startTime,
                // No confidenceScore: native text extraction reports none, and
                // fabricated constants are gone (ADR-004).
            },
        },
        imageOnlyPages,
    };
}

/**
 * Process document with Azure Document Intelligence
 */
export async function processWithAzure(documentUrl: string): Promise<NormalizedDocument> {
    const adapter = createAzureAdapter();
    return adapter.uploadDocument(documentUrl);
}

/**
 * Process document with Landing.AI
 */
export async function processWithLandingAI(documentUrl: string): Promise<NormalizedDocument> {
    const adapter = createLandingAIAdapter();
    return adapter.uploadDocument(documentUrl);
}

/**
 * Process document with Datalab
 */
export async function processWithDatalab(documentUrl: string): Promise<NormalizedDocument> {
    const adapter = createDatalabAdapter();
    return adapter.uploadDocument(documentUrl);
}

/**
 * Process document with Docling via the document-converter service
 * (Office + broad formats).
 */
export async function processWithDocling(documentUrl: string): Promise<NormalizedDocument> {
    const adapter = createDoclingAdapter();
    return adapter.uploadDocument(documentUrl);
}

async function processWithProvider(
    documentUrl: string,
    provider: OCRProvider
): Promise<NormalizedDocument> {
    switch (provider) {
        case "AZURE":
            return processWithAzure(documentUrl);
        case "LANDING_AI":
            return processWithLandingAI(documentUrl);
        case "DATALAB":
            return processWithDatalab(documentUrl);
        case "DOCLING":
            return processWithDocling(documentUrl);
        case "NATIVE_PDF":
            return processNativePDF(documentUrl);
        default:
            console.warn(
                `[Normalize] Unknown provider "${provider}", falling back to native PDF extraction`
            );
            return processNativePDF(documentUrl);
    }
}

/**
 * True when the provider refused the file itself (bad, unsupported, or
 * oversized content), so retrying it would be refused the same way. Adapters
 * mark such errors with `fileRejected: true`.
 */
function providerRejectedFile(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { fileRejected?: unknown }).fileRejected === true
    );
}

/**
 * Provider-first's last step: every OCR engine failed, so read the PDF's own
 * text layer instead — but never index a document with holes an engine
 * could still fill. A scan has no text layer at all, so the engines' error
 * stands and the outbox retries them. A mixed PDF with some scanned pages
 * (no text, an image) is retried too, unless every engine refused the file
 * outright; then the text layer is all there will ever be.
 */
async function fallBackToTextLayer(
    documentUrl: string,
    /** The engines that failed, for the log. */
    provider: string,
    providerError: unknown
): Promise<NormalizedDocument> {
    const reason = providerError instanceof Error ? providerError.message : "unknown error";
    console.warn(`[Normalize] ${provider} failed, reading the PDF's text layer instead: ${reason}`);

    let textLayer: { document: NormalizedDocument; imageOnlyPages: number[] };
    try {
        textLayer = await readTextLayer(documentUrl, { findImageOnlyPages: true });
    } catch (nativeError) {
        const nativeReason = nativeError instanceof Error ? nativeError.message : "unknown error";
        console.warn(`[Normalize] Text-layer fallback failed too: ${nativeReason}`);
        throw providerError;
    }
    const { document, imageOnlyPages } = textLayer;

    if (!document.pages.some(page => page.textBlocks.length > 0)) {
        console.warn("[Normalize] PDF has no text layer; keeping the provider error");
        throw providerError;
    }

    if (imageOnlyPages.length > 0) {
        const pageList = imageOnlyPages.join(", ");
        if (!providerRejectedFile(providerError)) {
            console.warn(
                `[Normalize] Text layer cannot read page(s) ${pageList} (an image with little or no text); keeping the provider error so ${provider} is retried`
            );
            throw providerError;
        }
        console.warn(
            `[Normalize] ${provider} refused this file; indexing the text layer without page(s) ${pageList} (an image with little or no text)`
        );
    }
    return document;
}
