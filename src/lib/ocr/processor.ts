/**
 * Document Processor Module
 * Shared processing logic for OCR-to-Vector pipeline
 * Can be used by both Inngest background jobs and synchronous processing
 */

import type { RoutingDecision } from "~/lib/ocr/complexity";
import { renderPagesToImages } from "~/lib/ocr/complexity";
import { enrichPageWithVlm } from "~/lib/ocr/enrichment";
import { createAzureAdapter, createLandingAIAdapter, createDatalabAdapter } from "~/lib/ocr/adapters";
import { chunkDocument, mergeWithEmbeddings, prepareForEmbedding } from "~/lib/ocr/chunker";
import { generateEmbeddings } from "~/lib/ai/embeddings";
import { db } from "~/server/db";
import {
  documentContextChunks,
  documentRetrievalChunks,
  documentStructure,
  documentMetadata,
  document as documentTable,
  ocrJobs,
} from "~/server/db/schema";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";
import { fetchBlob } from "~/server/storage/vercel-blob";
import {
  insertCompanyEmbeddings,
  companyEmbeddingTableExists,
} from "~/lib/db/company-embeddings";
import { getCompanyEmbeddingConfig } from "~/lib/ai/embedding-factory";

import type {
  ProcessDocumentEventData,
  PipelineResult,
  PageContent,
  OCRProvider,
  NormalizedDocument,
  VectorizedChunk,
  DocumentChunk,
} from "~/lib/ocr/types";

export type { ProcessDocumentEventData, PipelineResult, VectorizedChunk };

// ============================================================================
// DB Retry Utility
// ============================================================================

function isTransientDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as unknown as { cause?: { code?: string } }).cause;
  if (cause && typeof cause.code === "string") {
    return cause.code === "ECONNRESET" || cause.code === "ECONNREFUSED" || cause.code === "ETIMEDOUT" || cause.code === "EPIPE";
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
  baseDelayMs = 2000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      sanitizeDbError(error);
      if (!isTransientDbError(error) || attempt === maxAttempts) throw error;
      const delay = baseDelayMs * attempt;
      console.warn(
        `[DB] Transient error (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("withDbRetry: unreachable");
}

/**
 * Router decision result from Step A
 */
export interface RouterDecisionResult {
  isNativePDF: boolean;
  pageCount: number;
  selectedProvider: OCRProvider;
  confidence: number;
  reason: string;
  visionLabel?: string;
}

/**
 * Normalization result from Step B
 */
export interface NormalizationResult {
  pages: PageContent[];
  provider: OCRProvider;
  processingTimeMs: number;
  confidenceScore?: number;
}

/** Office extensions that must go through the ingestion layer (not Azure OCR). */
const OFFICE_EXTENSIONS = [".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls"];

/**
 * True if the filename has a known Office extension. Used to route Office files
 * to the ingestion layer even when mimeType is missing.
 */
export function isKnownOfficeDocument(filename: string): boolean {
  const lower = filename.toLowerCase();
  return OFFICE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ============================================================================
// Step A: Router - Determine document routing
// ============================================================================

const OCR_ONLY_PROVIDERS = ["AZURE", "LANDING_AI", "DATALAB"] as const;

function isValidOCRProvider(p: string): p is (typeof OCR_ONLY_PROVIDERS)[number] {
  return OCR_ONLY_PROVIDERS.includes(p as (typeof OCR_ONLY_PROVIDERS)[number]);
}

/**
 * Determine how to route the document for processing
 */
export async function routeDocument(
  documentUrl: string,
  options?: { forceOCR?: boolean; preferredProvider?: OCRProvider }
): Promise<RouterDecisionResult> {
  const preferred = options?.preferredProvider;

  if (preferred && (preferred === "NATIVE_PDF" || isValidOCRProvider(preferred))) {
    const pageCount = await getPageCount(documentUrl);

    return {
      isNativePDF: preferred === "NATIVE_PDF",
      pageCount,
      selectedProvider: preferred,
      confidence: 1.0,
      reason: preferred === "NATIVE_PDF"
        ? "User selected native PDF extraction"
        : `User selected ${preferred} for OCR`,
    };
  }

  const { determineDocumentRouting } = await import("~/lib/ocr/complexity");
  const decision: RoutingDecision = await determineDocumentRouting(documentUrl);

  const isNativePDF = decision.provider === "NATIVE_PDF";

  if (options?.forceOCR === true && isNativePDF) {
    const isComplex = decision.visionResult?.label
      ? ["handwritten", "complex", "blurry", "messy"].some(k => decision.visionResult?.label.includes(k))
      : false;

    const ocrProvider: OCRProvider = isComplex ? "LANDING_AI" : "AZURE";

    return {
      isNativePDF: false,
      pageCount: decision.pageCount,
      selectedProvider: ocrProvider,
      confidence: decision.confidence,
      reason: `Force OCR enabled (Original: ${decision.provider}), switching to ${ocrProvider}`,
      visionLabel: decision.visionResult?.label,
    };
  }

  return {
    isNativePDF,
    pageCount: decision.pageCount,
    selectedProvider: decision.provider,
    confidence: decision.confidence,
    reason: decision.reason,
    visionLabel: decision.visionResult?.label,
  };
}

async function getPageCount(documentUrl: string): Promise<number> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const response = await fetchBlob(documentUrl);
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

/**
 * Normalize document content using the appropriate provider
 */
export async function normalizeDocument(
  documentUrl: string,
  routerDecision: RouterDecisionResult
): Promise<NormalizationResult> {
  console.log(`[Normalize] Processing with provider: ${routerDecision.selectedProvider}`);

  let normalizedDoc: NormalizedDocument;

  if (routerDecision.isNativePDF) {
    normalizedDoc = await processNativePDF(documentUrl);
  } else {
    switch (routerDecision.selectedProvider) {
      case "AZURE":
        normalizedDoc = await processWithAzure(documentUrl);
        break;
      case "LANDING_AI":
        normalizedDoc = await processWithLandingAI(documentUrl);
        break;
      case "DATALAB":
        normalizedDoc = await processWithDatalab(documentUrl);
        break;
      case "NATIVE_PDF":
        normalizedDoc = await processNativePDF(documentUrl);
        break;
      default:
        console.warn(`[Normalize] Unknown provider "${routerDecision.selectedProvider}", falling back to native PDF extraction`);
        normalizedDoc = await processNativePDF(documentUrl);
    }
  }

  // --- VLM Enrichment Step ---
  // Only applicable for PDFs where we can render pages to images.
  // Triggers:
  // 1. "Complex" / "Handwritten" label from Router
  // 2. Low OCR confidence (< 70%)
  // 3. Explicitly requested via options (future)
  
  const isPdf = documentUrl.toLowerCase().endsWith(".pdf") || 
                (await fetchBlob(documentUrl, { method: "HEAD" }).then(r => r.headers.get("content-type") === "application/pdf").catch(() => false));

  if (isPdf && process.env.OPENAI_API_KEY) {
    const isComplex = routerDecision.visionLabel 
      ? ["complex", "handwritten", "messy", "figure", "diagram"].some(l => routerDecision.visionLabel?.toLowerCase().includes(l))
      : false;
    
    const isLowConfidence = (normalizedDoc.metadata.confidenceScore ?? 100) < 70;

    if (isComplex || isLowConfidence) {
      console.log(`[Enrichment] Triggering VLM enrichment (Complex=${isComplex}, LowConf=${isLowConfidence})`);
      try {
        const response = await fetchBlob(documentUrl);
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
export async function chunkPages(pages: PageContent[], filename?: string): Promise<DocumentChunk[]> {
  const { isCodeFile, chunkCodeFile } = await import("./code-chunker");

  if (filename && isCodeFile(filename)) {
    console.log(`[Chunking] Using code-aware chunker for ${filename}`);
    const codeChunks = chunkCodeFile(pages, filename);
    console.log(`[Chunking] Created ${codeChunks.length} code parent chunks`);
    codeChunks.forEach((chunk, idx) => {
      console.log(`[Chunking] Code Parent ${idx}: ${chunk.content.length} chars, ${chunk.children?.length ?? 0} children, path=${chunk.metadata.structurePath ?? ""}`);
    });
    return codeChunks;
  }

  const pageSizes = pages.map((page, idx) => {
    const textLength = page.textBlocks.join("").length;
    return `Page ${idx + 1}: ${textLength} chars, ${page.textBlocks.length} blocks, ${page.tables.length} tables`;
  });
  console.log(`[Chunking] Page content sizes:\n${pageSizes.join("\n")}`);

  const documentChunks = await chunkDocument(pages, {
    parentMaxTokens: 1000,
    childMaxTokens: 256,
    overlapTokens: 50,
    includePageContext: true,
  });
  console.log(`[Chunking] Created ${documentChunks.length} Parent chunks`);

  documentChunks.forEach((chunk, idx) => {
    console.log(`[Chunking] Parent Chunk ${idx}: ${chunk.content.length} chars, ${chunk.children?.length ?? 0} children`);
  });

  return documentChunks;
}

// ============================================================================
// Step D: Vectorize
// ============================================================================

/**
 * Generate embeddings for document chunks
 */
export async function vectorizeChunks(chunks: DocumentChunk[]): Promise<VectorizedChunk[]> {
  if (chunks.length === 0) {
    console.log("[Vectorize] No chunks to vectorize, returning empty");
    return [];
  }

  console.log(`[Vectorize] Preparing ${chunks.length} Parent chunks (and children) for embedding`);
  const contentStrings = prepareForEmbedding(chunks);
  console.log(`[Vectorize] Flattened to ${contentStrings.length} Child/Table chunks for embedding, total chars=${contentStrings.reduce((s, c) => s + c.length, 0)}`);

  const embedStart = Date.now();
  const embeddingResult = await generateEmbeddings(contentStrings, {
    model: "text-embedding-3-large",
    dimensions: 1536,
  });
  console.log(`[Vectorize] Embeddings generated: ${embeddingResult.embeddings.length} vectors (${Date.now() - embedStart}ms)`);

  const merged = mergeWithEmbeddings(chunks, embeddingResult.embeddings);
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
 * Retries once after 2s to handle replication lag.
 */
export async function ensureDocumentExists(documentId: number): Promise<void> {
  let [existingDoc] = await db
    .select({ id: documentTable.id })
    .from(documentTable)
    .where(eq(documentTable.id, documentId));
  if (!existingDoc) {
    await new Promise((r) => setTimeout(r, 2000));
    [existingDoc] = await db
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
}

/**
 * Create the root document structure node. Must be called once before storeBatch.
 */
export async function createRootStructure(
  documentId: number,
  totalPages: number,
  estimatedTokens: number,
): Promise<number> {
  await ensureDocumentExists(documentId);

  return withDbRetry(async () => {
    const rootStructure = await db.insert(documentStructure).values({
      documentId: BigInt(documentId),
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
    }).returning({ id: documentStructure.id });

    const rootId = rootStructure[0]?.id;
    if (!rootId) {
      throw new Error("Failed to create root document structure");
    }
    return rootId;
  });
}

/**
 * Write a batch of vectorized chunks to the database (context + retrieval chunks).
 * Designed to be called per-batch inside an Inngest step so vectors never
 * need to pass through step output serialization.
 */
export async function storeBatch(
  documentId: number,
  rootStructureId: number,
  vectorizedChunks: VectorizedChunk[],
  companyId?: number,
): Promise<StoredSection[]> {
  if (vectorizedChunks.length === 0) return [];

  const storedSections = await withDbRetry(async () => {
    return db.transaction(async (tx) => {
      const parentValues = vectorizedChunks.map((chunk) => {
        const semanticType: "tabular" | "narrative" = chunk.metadata.isTable
          ? "tabular"
          : "narrative";
        return {
          documentId: BigInt(documentId),
          structureId: BigInt(rootStructureId),
          content: chunk.content,
          tokenCount: Math.ceil(chunk.content.length / 4),
          charCount: chunk.content.length,
          embedding:
            chunk.vector && chunk.vector.length > 0
              ? sql`${JSON.stringify(chunk.vector)}::vector(1536)`
              : null,
          pageNumber: chunk.metadata.pageNumber,
          semanticType,
          contentHash: crypto
            .createHash("sha256")
            .update(chunk.content)
            .digest("hex"),
        };
      });

      const parentRows = await tx
        .insert(documentContextChunks)
        .values(parentValues)
        .returning({ id: documentContextChunks.id, content: documentContextChunks.content });

      const sections: StoredSection[] = parentRows.map((r) => ({
        sectionId: r.id,
        content: r.content,
      }));

      const childValues: Array<{
        contextChunkId: bigint;
        documentId: bigint;
        content: string;
        tokenCount: number;
        embedding: ReturnType<typeof sql>;
        embeddingShort: ReturnType<typeof sql> | null;
      }> = [];

      for (let i = 0; i < vectorizedChunks.length; i++) {
        const chunk = vectorizedChunks[i]!;
        const parentId = parentRows[i]?.id;
        if (!parentId || !chunk.children?.length) continue;

        for (const child of chunk.children) {
          childValues.push({
            contextChunkId: BigInt(parentId),
            documentId: BigInt(documentId),
            content: child.content,
            tokenCount: Math.ceil(child.content.length / 4),
            embedding: sql`${JSON.stringify(child.vector)}::vector(1536)`,
            embeddingShort: child.vectorShort
              ? sql`${JSON.stringify(child.vectorShort)}::vector(512)`
              : null,
          });
        }
      }

      const CHILD_BATCH_SIZE = 50;
      for (let i = 0; i < childValues.length; i += CHILD_BATCH_SIZE) {
        await tx
          .insert(documentRetrievalChunks)
          .values(childValues.slice(i, i + CHILD_BATCH_SIZE));
      }

      return sections;
    });
  });

  // Also write to per-company embedding table if it exists
  if (companyId && storedSections.length > 0) {
    try {
      const hasTable = await companyEmbeddingTableExists(companyId);
      if (hasTable) {
        const cfg = await getCompanyEmbeddingConfig(companyId);
        const embeddingRows: Array<{
          documentId: number;
          chunkType: string;
          chunkId: number;
          content: string | null;
          embedding: number[];
        }> = [];

        for (let i = 0; i < vectorizedChunks.length; i++) {
          const chunk = vectorizedChunks[i]!;
          const parentId = storedSections[i]?.sectionId;
          if (!parentId) continue;

          if (chunk.vector && chunk.vector.length > 0) {
            embeddingRows.push({
              documentId,
              chunkType: "context",
              chunkId: parentId,
              content: chunk.content,
              embedding: chunk.vector,
            });
          }

          if (chunk.children) {
            for (const child of chunk.children) {
              if (child.vector && child.vector.length > 0) {
                embeddingRows.push({
                  documentId,
                  chunkType: "retrieval",
                  chunkId: parentId,
                  content: child.content,
                  embedding: child.vector,
                });
              }
            }
          }
        }

        if (embeddingRows.length > 0) {
          await insertCompanyEmbeddings(companyId, cfg.dimensions, embeddingRows);
        }
      }
    } catch (err) {
      console.warn("[storeBatch] Failed to write to per-company embedding table:", err);
    }
  }

  return storedSections;
}

/**
 * Finalize storage after all batches: create document metadata, update document
 * record, and mark the OCR job as completed.  Needs only counts and metadata,
 * not vectors or chunk content.
 */
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
  },
  pipelineStartTime: number,
): Promise<void> {
  return withDbRetry(async () => {
    const summaryPreview = summaryText.substring(0, 500) + (summaryText.length > 500 ? "..." : "");

    await db.insert(documentMetadata).values({
      documentId: BigInt(documentId),
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
    });

    await db
      .update(documentTable)
      .set({
        ocrProcessed: true,
        ocrJobId: jobId,
        ocrProvider: meta.provider,
        ocrConfidenceScore: meta.confidenceScore,
        ocrMetadata: {
          totalPages: meta.totalPages,
          totalChunks,
          processingTimeMs: meta.processingTimeMs,
          processedAt: new Date().toISOString(),
        },
      })
      .where(eq(documentTable.id, documentId));

    await db
      .update(ocrJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        processingDurationMs: Date.now() - pipelineStartTime,
        pageCount: meta.totalPages,
        actualProvider: meta.provider,
        confidenceScore: meta.confidenceScore,
      })
      .where(eq(ocrJobs.id, jobId));

    console.log(
      `[Storage] Finalized docId=${documentId}, ${totalChunks} chunks, job=${jobId}`
    );
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
  pipelineStartTime: number
): Promise<StoredSection[]> {
  if (vectorizedChunks.length === 0) {
    console.log("[Storage] No chunks to store, skipping");
    return [];
  }

  const storeStart = Date.now();
  console.log(
    `[Storage] Storing ${vectorizedChunks.length} Parent chunks for docId=${documentId}, job=${jobId}, ` +
    `pages=${normalizationResult.pages.length}`
  );

  // Ensure document exists before inserting (avoids opaque FK violation).
  // Retry once after 2s to handle replication lag or timing races.
  let [existingDoc] = await db
    .select({ id: documentTable.id })
    .from(documentTable)
    .where(eq(documentTable.id, documentId));
  if (!existingDoc) {
    await new Promise((r) => setTimeout(r, 2000));
    [existingDoc] = await db
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

  // 1. Create root document structure
  console.log("[Storage] 1/5 Creating root document structure...");
  const rootStructure = await db.insert(documentStructure).values({
    documentId: BigInt(documentId),
    parentId: null,
    contentType: "section",
    path: "/",
    title: "Document Root",
    level: 0,
    ordering: 0,
    startPage: 1,
    endPage: normalizationResult.pages.length,
    tokenCount: Math.ceil(vectorizedChunks.reduce((sum, c) => sum + (c.content.length / 4), 0)),
    childCount: 0,
  }).returning({ id: documentStructure.id });

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

    // Insert Parent (Context Chunk)
    const [row] = await db.insert(documentContextChunks).values({
      documentId: BigInt(documentId),
      structureId: BigInt(rootId),
      content: chunk.content,
      tokenCount: Math.ceil(chunk.content.length / 4),
      charCount: chunk.content.length,
      // Parent chunks might not have embeddings in this architecture
      // But if 'vector' is present and not empty, use it. In new chunker, parent vector is empty.
      embedding: chunk.vector && chunk.vector.length > 0 
          ? sql`${JSON.stringify(chunk.vector)}::vector(1536)` 
          : null,
      pageNumber: chunk.metadata.pageNumber,
      semanticType: isTable ? "tabular" : "narrative",
      contentHash,
    }).returning({ id: documentContextChunks.id });

    if (row) {
      storedSections.push({ sectionId: row.id, content: chunk.content });

      // Insert Children (Retrieval Chunks)
      if (chunk.children && chunk.children.length > 0) {
          for (const child of chunk.children) {
              await db.insert(documentRetrievalChunks).values({
                  contextChunkId: BigInt(row.id),
                  documentId: BigInt(documentId),
                  content: child.content,
                  tokenCount: Math.ceil(child.content.length / 4),
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

  await db.insert(documentMetadata).values({
    documentId: BigInt(documentId),
    summary: summaryPreview,
    outline: normalizationResult.pages.map((_, i) => ({
      id: i + 1,
      title: `Page ${i + 1}`,
      level: 1,
      path: `/${i + 1}`,
      pageRange: { start: i + 1, end: i + 1 },
    })),
    totalTokens: vectorizedChunks.reduce((sum, c) => sum + Math.ceil(c.content.length / 4), 0),
    totalPages: normalizationResult.pages.length,
    totalSections: vectorizedChunks.length,
    topicTags: [],
    entities: {},
  });

  // 4. Update document record with OCR metadata
  console.log("[Storage] 4/5 Updating document record...");
  await db
    .update(documentTable)
    .set({
      ocrProcessed: true,
      ocrJobId: jobId,
      ocrProvider: normalizationResult.provider,
      ocrConfidenceScore: normalizationResult.confidenceScore,
      ocrMetadata: {
        totalPages: normalizationResult.pages.length,
        totalChunks: vectorizedChunks.length,
        processingTimeMs: normalizationResult.processingTimeMs,
        processedAt: new Date().toISOString(),
      },
    })
    .where(eq(documentTable.id, documentId));

  // 5. Update OCR job status
  console.log("[Storage] 5/5 Updating OCR job status...");
  await db
    .update(ocrJobs)
    .set({
      status: "completed",
      completedAt: new Date(),
      processingDurationMs: Date.now() - pipelineStartTime,
      pageCount: normalizationResult.pages.length,
      actualProvider: normalizationResult.provider,
      confidenceScore: normalizationResult.confidenceScore,
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
  await db
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

/**
 * Process a document synchronously (all steps in sequence)
 * Used when Inngest is disabled.
 *
 * For PDFs this uses the existing 5-step routing pipeline.
 * For all other file types it delegates to the Source Adapter ingestion layer.
 */
export async function processDocumentSync(
  eventData: ProcessDocumentEventData
): Promise<PipelineResult> {
  const { runDocIngestionTool } = await import("~/lib/tools");
  return runDocIngestionTool({
    ...eventData,
    runtime: {
      updateJobStatus: true,
      markFailureInDb: true,
    },
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Process native PDF with per-page text extraction.
 * Uses pdfjs-serverless for Node.js/serverless (no DOMMatrix) - compatible with Inngest, Vercel, etc.
 */
export async function processNativePDF(documentUrl: string): Promise<NormalizedDocument> {
  const startTime = Date.now();

  const { getDocument } = await import("pdfjs-serverless");

  // 1. Fetch PDF data
  const response = await fetchBlob(documentUrl);
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
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();

    pages.push({
      pageNumber: i,
      textBlocks: text.length > 0 ? [text] : [],
      tables: [],
    });
  }

  await pdfDoc.destroy();

  return {
    pages,
    metadata: {
      totalPages: numPages,
      provider: "NATIVE_PDF",
      processingTimeMs: Date.now() - startTime,
      confidenceScore: 95,
    },
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
