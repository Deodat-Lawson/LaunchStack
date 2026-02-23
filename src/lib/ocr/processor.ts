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
  const { determineDocumentRouting } = await import("~/lib/ocr/complexity");
  const decision: RoutingDecision = await determineDocumentRouting(documentUrl);

  // Honor frontend provider selection when set
  const preferred = options?.preferredProvider;
  if (preferred) {
    if (preferred === "NATIVE_PDF") {
      return {
        isNativePDF: true,
        pageCount: decision.pageCount,
        selectedProvider: "NATIVE_PDF",
        confidence: decision.confidence,
        reason: `User selected native PDF extraction`,
        visionLabel: decision.visionResult?.label,
      };
    }
    if (isValidOCRProvider(preferred)) {
      return {
        isNativePDF: false,
        pageCount: decision.pageCount,
        selectedProvider: preferred,
        confidence: decision.confidence,
        reason: `User selected ${preferred} for OCR`,
        visionLabel: decision.visionResult?.label,
      };
    }
  }

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
                (await fetch(documentUrl, { method: "HEAD" }).then(r => r.headers.get("content-type") === "application/pdf").catch(() => false));

  if (isPdf && process.env.OPENAI_API_KEY) {
    const isComplex = routerDecision.visionLabel 
      ? ["complex", "handwritten", "messy", "figure", "diagram"].some(l => routerDecision.visionLabel?.toLowerCase().includes(l))
      : false;
    
    const isLowConfidence = (normalizedDoc.metadata.confidenceScore ?? 100) < 70;

    if (isComplex || isLowConfidence) {
      console.log(`[Enrichment] Triggering VLM enrichment (Complex=${isComplex}, LowConf=${isLowConfidence})`);
      try {
        const response = await fetch(documentUrl);
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
 * Chunk the normalized document pages
 */
export async function chunkPages(pages: PageContent[]): Promise<DocumentChunk[]> {
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
    batchSize: 20,
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
 * Store vectorized chunks in the database.
 * Returns an array of { sectionId, content } for each inserted section (Context Chunk),
 * which downstream steps (e.g. entity extraction) can use.
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
  const response = await fetch(documentUrl);
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
