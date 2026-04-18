import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  chunkPages,
  createRootStructure,
  finalizeStorage,
  isKnownOfficeDocument,
  markJobFailed,
  normalizeDocument,
  routeDocument,
  storeBatch,
  withDbRetry,
  type NormalizationResult,
  type RouterDecisionResult,
  type StoredSection,
} from "~/lib/ocr/processor";
import { prepareForEmbedding, mergeWithEmbeddings, getTotalChunkSize } from "~/lib/ocr/chunker";
import { generateEmbeddings } from "~/lib/ai/embeddings";
import type {
  DocumentChunk,
  PageContent,
  PipelineResult,
  VectorizedChunk,
} from "~/lib/ocr/types";
import { db } from "~/server/db";
import { ocrJobs, documentContextChunks } from "~/server/db/schema";

import type {
  DocIngestionToolInput,
  DocIngestionToolResult,
  DocIngestionToolRuntimeOptions,
} from "./types";
import type {
  Neo4jEntityInput,
  Neo4jRelationshipInput,
  Neo4jMentionInput,
} from "~/lib/graph/neo4j-direct-writer";

const DEFAULT_SIDECAR_BATCH_SIZE = 50;
const DEFAULT_OPENAI_BATCH_SIZE = 50;

/**
 * Lightweight step output for normalize, kept under Inngest's ~4MB step output limit.
 * The full page data is stored in ocrJobs.ocrResult so subsequent steps can load it.
 */
interface NormalizeSummary {
  jobId: string;
  pageCount: number;
  provider: string;
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

async function savePipelineState(
  jobId: string,
  key: string,
  data: unknown,
): Promise<void> {
  return withDbRetry(async () => {
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

async function maybeMarkProcessing(
  jobId: string,
  shouldUpdateStatus: boolean,
): Promise<void> {
  if (!shouldUpdateStatus) return;

  await db
    .update(ocrJobs)
    .set({
      status: "processing",
      startedAt: new Date(),
    })
    .where(eq(ocrJobs.id, jobId));
}

const AZURE_SUPPORTED_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".heif",
  ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
]);

function shouldUsePdfPipeline(mimeType: string | undefined, documentName: string): boolean {
  if (mimeType === "application/pdf") return true;
  if (documentName.toLowerCase().endsWith(".pdf")) return true;
  return false;
}

function isAzureSupportedFile(documentUrl: string, documentName: string): boolean {
  const nameToCheck = `${documentUrl} ${documentName}`.toLowerCase();
  return [...AZURE_SUPPORTED_EXTENSIONS].some((ext) => nameToCheck.includes(ext));
}

async function vectorizeWithSidecar(
  chunks: DocumentChunk[],
  sidecarUrl: string,
  sidecarBatchSize: number,
  documentId: number,
  rootStructureId: number,
  runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>,
): Promise<{ totalStored: number; storedSections: StoredSection[] }> {
  const batches = splitIntoBatches(chunks, sidecarBatchSize);
  let totalStored = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (!batch) continue;

    const result = await runStep(
      `step-d-batch-${i}`,
      async (): Promise<{ batchIndex: number; stored: number }> => {
        const texts = batch.map((chunk) => chunk.content);
        const response = await fetch(`${sidecarUrl}/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts }),
        });

        if (!response.ok) {
          throw new Error(
            `Sidecar /embed failed (batch ${i}): ${response.status} ${await response.text()}`,
          );
        }

        const data = (await response.json()) as { embeddings: number[][] };
        const vectorized: VectorizedChunk[] = batch.map((chunk, idx) => ({
          content: chunk.content,
          metadata: chunk.metadata,
          vector: data.embeddings[idx] ?? [],
        }));

        const sections = await storeBatch(documentId, rootStructureId, vectorized);
        return { batchIndex: i, stored: sections.length };
      },
    );

    totalStored += result.stored;
  }

  const rows = await db
    .select({ id: documentContextChunks.id, content: documentContextChunks.content })
    .from(documentContextChunks)
    .where(eq(documentContextChunks.documentId, BigInt(documentId)));

  return {
    totalStored,
    storedSections: rows.map((r) => ({ sectionId: r.id, content: r.content })),
  };
}

/**
 * Vectorize chunks via OpenAI using batched Inngest steps.
 * Each step embeds a batch of parent chunks AND writes them directly to the
 * database, returning only a tiny count. This avoids Inngest's output_too_large
 * error since vectors never pass through step serialization.
 */
async function vectorizeWithOpenAI(
  chunks: DocumentChunk[],
  batchSize: number,
  documentId: number,
  rootStructureId: number,
  runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>,
): Promise<{ totalStored: number; storedSections: StoredSection[] }> {
  if (chunks.length === 0) return { totalStored: 0, storedSections: [] };

  const contentStrings = prepareForEmbedding(chunks);
  console.log(
    `[Vectorize] Prepared ${chunks.length} parents -> ${contentStrings.length} strings for embedding`,
  );

  const childCounts = chunks.map(
    (c) => (c.children && c.children.length > 0 ? c.children.length : 1),
  );

  const parentBatches = splitIntoBatches(chunks, batchSize);
  let totalStored = 0;
  let stringOffset = 0;

  for (let i = 0; i < parentBatches.length; i++) {
    const batch = parentBatches[i];
    if (!batch) continue;

    const batchChildCount = batch.reduce(
      (sum, _, idx) => sum + (childCounts[i * batchSize + idx] ?? 0),
      0,
    );
    const batchStringsStart = stringOffset;
    const batchStrings = contentStrings.slice(
      batchStringsStart,
      batchStringsStart + batchChildCount,
    );
    stringOffset += batchChildCount;

    const result = await runStep(
      `step-d-batch-${i}`,
      async (): Promise<{ batchIndex: number; stored: number }> => {
        console.log(
          `[Vectorize] Batch ${i + 1}/${parentBatches.length}: ${batch.length} parents, ${batchStrings.length} strings`,
        );
        const embedResult = await generateEmbeddings(batchStrings, {
          model: "text-embedding-3-large",
          dimensions: 1536,
        });
        const vectorized = mergeWithEmbeddings(batch, embedResult.embeddings);
        const sections = await storeBatch(documentId, rootStructureId, vectorized);
        return { batchIndex: i, stored: sections.length };
      },
    );

    totalStored += result.stored;
  }

  const rows = await db
    .select({ id: documentContextChunks.id, content: documentContextChunks.content })
    .from(documentContextChunks)
    .where(eq(documentContextChunks.documentId, BigInt(documentId)));

  return {
    totalStored,
    storedSections: rows.map((r) => ({ sectionId: r.id, content: r.content })),
  };
}

// ─── GraphRAG pipeline state keys ────────────────────────────────────────────
const GRAPH_STATE_ENTITIES = "graphrag_entities";
const GRAPH_STATE_CO_OCCURS = "graphrag_co_occurs";
const GRAPH_STATE_MENTIONS = "graphrag_mentions";
const GRAPH_STATE_LLM_RELS = "graphrag_llm_rels";

// Inline Zod schemas for sidecar response validation (mirrors graphrag-schemas.ts)
const EntityWithEmbeddingSchema = z.object({
  text: z.string().min(1),
  label: z.string().min(1),
  score: z.number().min(0).max(1),
  embedding: z.array(z.number()).length(768),
});

const ExtractEntitiesEnhancedResponseSchema = z.object({
  results: z.array(z.object({
    text: z.string(),
    entities: z.array(EntityWithEmbeddingSchema),
  })),
  total_entities: z.number().int().nonnegative(),
});

const ExtractionRelationshipSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().min(1).regex(/^[A-Z][A-Z0-9_]*$/),
  detail: z.string(),
});

const ExtractionEntitySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["PERSON", "ORGANIZATION", "LOCATION", "PRODUCT", "EVENT", "OTHER"]),
});

const ExtractRelationshipsResponseSchema = z.object({
  results: z.array(z.object({
    text: z.string(),
    entities: z.array(ExtractionEntitySchema),
    relationships: z.array(ExtractionRelationshipSchema),
    dropped_relationships: z.array(ExtractionRelationshipSchema),
  })),
  total_entities: z.number().int().nonnegative(),
  total_relationships: z.number().int().nonnegative(),
  total_dropped: z.number().int().nonnegative(),
});

/**
 * Step F — BERT NER entity extraction with CLS embeddings.
 * Only runs when NEO4J_URI is set AND SIDECAR_URL is set AND sidecar is healthy.
 */
async function maybeExtractEntities(
  jobId: string,
  sidecarUrl: string | undefined,
  storedSections: StoredSection[],
  documentId: number,
  companyId: string,
  runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>,
): Promise<void> {
  // Gate: NEO4J_URI must be set
  if (!process.env.NEO4J_URI) return;
  // Gate: sidecar must be configured
  if (!sidecarUrl || storedSections.length === 0) return;

  await runStep("step-f-extract-entities", async () => {
    const sidecarHealthy = await fetch(`${sidecarUrl}/health`)
      .then((r) => r.ok)
      .catch(() => false);

    if (!sidecarHealthy) {
      console.warn("[DocIngestionTool] Step F skipped: sidecar unhealthy");
      return null;
    }

    const resp = await fetch(
      `${sidecarUrl}/extract-entities?include_embeddings=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks: storedSections.map((s) => s.content) }),
      },
    );

    if (!resp.ok) {
      console.warn(`[DocIngestionTool] Step F: /extract-entities failed (${resp.status}), skipping`);
      return null;
    }

    const raw = await resp.json();
    const parsed = ExtractEntitiesEnhancedResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[DocIngestionTool] Step F: response schema validation failed, skipping");
      return null;
    }

    // Deduplicate entities across chunks: accumulate mentionCount, keep best confidence/embedding
    const entityMap = new Map<string, Neo4jEntityInput>();
    const coOccurs: Neo4jRelationshipInput[] = [];
    const mentions: Neo4jMentionInput[] = [];

    for (let i = 0; i < parsed.data.results.length; i++) {
      const chunkResult = parsed.data.results[i]!;
      const section = storedSections[i];
      if (!section) continue;

      const chunkEntityKeys: { name: string; label: string }[] = [];

      for (const ent of chunkResult.entities) {
        const name = ent.text.toLowerCase().trim();
        if (name.length < 2) continue;

        const key = `${name}|${ent.label}`;
        const existing = entityMap.get(key);
        if (existing) {
          existing.mentionCount += 1;
          if (ent.score > existing.confidence) {
            existing.confidence = ent.score;
            existing.displayName = ent.text;
          }
          if (ent.embedding && !existing.embedding) {
            existing.embedding = ent.embedding;
          }
        } else {
          entityMap.set(key, {
            name,
            displayName: ent.text,
            label: ent.label,
            confidence: ent.score,
            mentionCount: 1,
            companyId,
            embedding: ent.embedding,
          });
        }

        chunkEntityKeys.push({ name, label: ent.label });

        mentions.push({
          entityName: name,
          entityLabel: ent.label,
          sectionId: section.sectionId,
          documentId,
          confidence: ent.score,
          companyId,
        });
      }

      // CO_OCCURS relationships between entities in the same chunk
      for (let a = 0; a < chunkEntityKeys.length; a++) {
        for (let b = a + 1; b < chunkEntityKeys.length; b++) {
          const ea = chunkEntityKeys[a]!;
          const eb = chunkEntityKeys[b]!;
          coOccurs.push({
            sourceName: ea.name,
            sourceLabel: ea.label,
            targetName: eb.name,
            targetLabel: eb.label,
            relationType: "CO_OCCURS",
            weight: 0.5,
            evidenceCount: 1,
            documentId,
            companyId,
          });
        }
      }
    }

    const entities = [...entityMap.values()];

    await savePipelineState(jobId, GRAPH_STATE_ENTITIES, entities);
    await savePipelineState(jobId, GRAPH_STATE_CO_OCCURS, coOccurs);
    await savePipelineState(jobId, GRAPH_STATE_MENTIONS, mentions);

    console.log(
      `[DocIngestionTool] Step F: ${entities.length} entities, ${coOccurs.length} CO_OCCURS, ${mentions.length} mentions`,
    );
    return { entities: entities.length, coOccurs: coOccurs.length, mentions: mentions.length };
  });
}

/**
 * Step F2 — LLM relationship extraction.
 * Only runs when NEO4J_URI is set AND EXTRACTION_LLM_BASE_URL is set AND sidecar is healthy.
 */
async function maybeExtractRelationships(
  jobId: string,
  sidecarUrl: string | undefined,
  storedSections: StoredSection[],
  documentId: number,
  companyId: string,
  runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>,
): Promise<void> {
  if (!process.env.NEO4J_URI) return;
  if (!process.env.EXTRACTION_LLM_BASE_URL) return;
  if (!sidecarUrl || storedSections.length === 0) return;

  await runStep("step-f2-extract-relationships", async () => {
    const sidecarHealthy = await fetch(`${sidecarUrl}/health`)
      .then((r) => r.ok)
      .catch(() => false);

    if (!sidecarHealthy) {
      console.warn("[DocIngestionTool] Step F2 skipped: sidecar unhealthy");
      return null;
    }

    let raw: unknown;
    try {
      const resp = await fetch(`${sidecarUrl}/extract-relationships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks: storedSections.map((s) => s.content) }),
      });
      if (!resp.ok) {
        console.warn(`[DocIngestionTool] Step F2: /extract-relationships failed (${resp.status}), skipping`);
        return null;
      }
      raw = await resp.json();
    } catch (err) {
      console.warn("[DocIngestionTool] Step F2: sidecar call failed, skipping:", err instanceof Error ? err.message : err);
      return null;
    }

    const parsed = ExtractRelationshipsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[DocIngestionTool] Step F2: response schema validation failed, skipping");
      return null;
    }

    const llmRels: Neo4jRelationshipInput[] = [];

    // Map LLM entity types to BERT NER labels so relationship MATCH
    // queries find the entities created by Step F.
    const LLM_TO_BERT_LABEL: Record<string, string> = {
      PERSON: "PER", ORGANIZATION: "ORG", LOCATION: "LOC",
      PRODUCT: "MISC", EVENT: "MISC", OTHER: "MISC",
    };

    for (const chunkResult of parsed.data.results) {
      const entityTypeMap = new Map<string, string>(
        chunkResult.entities.map((e) => [e.name, e.type]),
      );

      for (const rel of chunkResult.relationships) {
        const sourceLabel = LLM_TO_BERT_LABEL[entityTypeMap.get(rel.source) ?? "OTHER"] ?? "MISC";
        const targetLabel = LLM_TO_BERT_LABEL[entityTypeMap.get(rel.target) ?? "OTHER"] ?? "MISC";
        llmRels.push({
          sourceName: rel.source.toLowerCase().trim(),
          sourceLabel,
          targetName: rel.target.toLowerCase().trim(),
          targetLabel,
          relationType: rel.type,
          weight: 0.7,
          evidenceCount: 1,
          detail: rel.detail,
          documentId,
          companyId,
        });
      }
    }

    await savePipelineState(jobId, GRAPH_STATE_LLM_RELS, llmRels);

    console.log(`[DocIngestionTool] Step F2: ${llmRels.length} LLM relationships extracted`);
    return { relationships: llmRels.length };
  });
}

/**
 * Step G — Direct Neo4j write.
 * Only runs when NEO4J_URI is set. Uses Neo4jDirectWriterImpl.
 */
async function maybeSyncToNeo4j(
  jobId: string,
  documentId: number,
  documentName: string,
  companyId: string,
  storedSections: StoredSection[],
  runStep: <T>(stepName: string, fn: () => Promise<T>) => Promise<T>,
): Promise<void> {
  if (!process.env.NEO4J_URI) return;

  await runStep("step-g-neo4j-write", async () => {
    const { isNeo4jConfigured, checkNeo4jHealth } = await import(
      "~/lib/graph/neo4j-client"
    );

    if (!isNeo4jConfigured()) return null;

    const healthy = await checkNeo4jHealth();
    if (!healthy) {
      console.warn("[DocIngestionTool] Step G skipped: Neo4j unreachable, document still ingested");
      return null;
    }

    // Load pipeline state (may be empty if Steps F/F2 were skipped)
    const loadOrDefault = async <T>(key: string, def: T): Promise<T> => {
      try {
        return await loadPipelineState<T>(jobId, key);
      } catch {
        return def;
      }
    };

    const entities = await loadOrDefault<Neo4jEntityInput[]>(GRAPH_STATE_ENTITIES, []);
    const coOccurs = await loadOrDefault<Neo4jRelationshipInput[]>(GRAPH_STATE_CO_OCCURS, []);
    const mentions = await loadOrDefault<Neo4jMentionInput[]>(GRAPH_STATE_MENTIONS, []);
    const llmRels = await loadOrDefault<Neo4jRelationshipInput[]>(GRAPH_STATE_LLM_RELS, []);

    const allRelationships = [...coOccurs, ...llmRels];

    const { Neo4jDirectWriterImpl, resolveEntities } = await import(
      "~/lib/graph/neo4j-direct-writer-impl"
    );

    const writer = new Neo4jDirectWriterImpl();
    const startMs = Date.now();

    try {
      await writer.ensureIndexes();

      const entityCount = await writer.writeEntities(entities, companyId);
      const dynamicRelTypes = await writer.writeRelationships(allRelationships, companyId);
      const mentionCount = await writer.writeMentions(mentions, companyId);

      await writer.writeDocumentGraph(
        {
          document: {
            id: documentId,
            name: documentName,
            companyId,
            uploadedAt: new Date().toISOString(),
          },
          sectionIds: storedSections.map((s) => s.sectionId),
        },
        companyId,
      );

      // Entity resolution (R6)
      if (entities.length > 0) {
        await resolveEntities(entities, companyId);
      }

      const result = {
        entities: entityCount,
        mentions: mentionCount,
        relationships: allRelationships.length,
        dynamicRelTypes,
        durationMs: Date.now() - startMs,
      };

      console.log(
        `[DocIngestionTool] Step G: ${result.entities} entities, ${result.mentions} mentions, ` +
          `${result.relationships} relationships (${result.durationMs}ms)`,
      );

      return result;
    } catch (err) {
      console.warn(
        "[DocIngestionTool] Step G: Neo4j write failed, document still ingested:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  });
}

function buildFailureResult(
  jobId: string,
  documentId: number,
  pipelineStartTime: number,
  error: unknown,
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
 * Shared backend tool for end-to-end document ingestion.
 * Runs OCR/normalization, chunking, embedding, storage, and optional graph extraction.
 */
export async function runDocIngestionTool(
  input: DocIngestionToolInput,
): Promise<DocIngestionToolResult> {
  const {
    jobId,
    documentUrl,
    documentId,
    documentName,
    companyId,
    mimeType,
    originalFilename,
    options,
    runtime,
  } = input;
  const pipelineStartTime = Date.now();
  const routingFilename = originalFilename ?? documentName;

  const runStep = createStepRunner(runtime);
  const isInngest = !!runtime?.runStep;
  const sidecarUrl = runtime?.sidecarUrl ?? process.env.SIDECAR_URL;
  const sidecarBatchSize = runtime?.sidecarBatchSize ?? DEFAULT_SIDECAR_BATCH_SIZE;
  const updateJobStatus = runtime?.updateJobStatus ?? false;
  const markFailureInDb = runtime?.markFailureInDb ?? false;

  const fastTextPath = runtime?.fastTextPath ?? false;

  try {
    await maybeMarkProcessing(jobId, updateJobStatus);

    const isPdf = !fastTextPath && shouldUsePdfPipeline(mimeType, routingFilename);

    // -----------------------------------------------------------------------
    // Steps A+B: Route & Normalize (OCR)
    // When running under Inngest, store page data in DB and return only a
    // lightweight summary so Inngest can memoize it without exceeding the
    // ~4MB step output limit.  Without this, every Inngest replay re-runs OCR.
    // -----------------------------------------------------------------------
    let normSummary: NormalizeSummary;

    if (isPdf && isAzureSupportedFile(documentUrl, routingFilename)) {
      const routerDecision = await runStep(
        "step-a-router",
        async (): Promise<RouterDecisionResult> =>
          routeDocument(documentUrl, options),
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
          },
        );
      } else {
        const result = await runStep(
          "step-b-normalize",
          async (): Promise<NormalizationResult> =>
            normalizeDocument(documentUrl, routerDecision),
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
            const { ingestToNormalized } = await import("~/lib/ingestion");
            const normalizedDoc = await ingestToNormalized(documentUrl, {
              mimeType,
              filename: routingFilename,
              forceOCR: options?.forceOCR,
            });
            await savePipelineState(jobId, "pages", normalizedDoc.pages);
            return {
              jobId,
              pageCount: normalizedDoc.pages.length,
              provider: normalizedDoc.metadata.provider,
              processingTimeMs: normalizedDoc.metadata.processingTimeMs,
              confidenceScore: normalizedDoc.metadata.confidenceScore,
            };
          },
        );
      } else {
        const result = await runStep(
          "step-ab-ingest",
          async (): Promise<NormalizationResult> => {
            const { ingestToNormalized } = await import("~/lib/ingestion");
            const normalizedDoc = await ingestToNormalized(documentUrl, {
              mimeType,
              filename: routingFilename,
              forceOCR: options?.forceOCR,
            });
            return {
              pages: normalizedDoc.pages,
              provider: normalizedDoc.metadata.provider,
              processingTimeMs: normalizedDoc.metadata.processingTimeMs,
              confidenceScore: normalizedDoc.metadata.confidenceScore,
            };
          },
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

    // -----------------------------------------------------------------------
    // Step C: Chunking
    // Load pages from DB, chunk them, store chunks back, return summary.
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
              0,
            ),
            textChunks: stats.textChunks,
            tableChunks: stats.tableChunks,
          };
        },
      );
      chunks = await loadPipelineState<DocumentChunk[]>(jobId, "chunks");
      console.log(
        `[Pipeline] Chunks loaded: ${chunkSummary.parentChunkCount} parents, ${chunkSummary.childChunkCount} children`,
      );
    } else {
      const pages = await loadPipelineState<PageContent[]>(jobId, "pages");
      chunks = await runStep(
        "step-c-chunking",
        async (): Promise<DocumentChunk[]> => chunkPages(pages, routingFilename),
      );
    }

    // -----------------------------------------------------------------------
    // Step D: Setup root structure + Embed & Store per batch
    // -----------------------------------------------------------------------
    let storedSections: StoredSection[] = [];
    let totalStored = 0;

    if (chunks.length > 0) {
      const rootStructureId = await runStep(
        "step-d-setup",
        async (): Promise<number> => {
          const estimatedTokens = Math.ceil(
            chunks.reduce((sum, c) => sum + c.content.length / 4, 0),
          );
          return createRootStructure(documentId, normSummary.pageCount, estimatedTokens);
        },
      );

      if (sidecarUrl) {
        const result = await vectorizeWithSidecar(
          chunks,
          sidecarUrl,
          sidecarBatchSize,
          documentId,
          rootStructureId,
          runStep,
        );
        storedSections = result.storedSections;
        totalStored = result.totalStored;
      } else {
        const result = await vectorizeWithOpenAI(
          chunks,
          DEFAULT_OPENAI_BATCH_SIZE,
          documentId,
          rootStructureId,
          runStep,
        );
        storedSections = result.storedSections;
        totalStored = result.totalStored;
      }
    }

    // -----------------------------------------------------------------------
    // Step E: Finalize (metadata + job status)
    // -----------------------------------------------------------------------
    await runStep("step-e-finalize", async (): Promise<{ ok: true }> => {
      const summaryText = chunks.map((c) => c.content).join("\n\n");
      await finalizeStorage(documentId, jobId, totalStored, summaryText, {
        totalPages: normSummary.pageCount,
        provider: normSummary.provider,
        processingTimeMs: normSummary.processingTimeMs,
        confidenceScore: normSummary.confidenceScore,
      }, pipelineStartTime);
      return { ok: true };
    });

    // -----------------------------------------------------------------------
    // Step F: BERT NER entity extraction (GraphRAG, gated by NEO4J_URI)
    // -----------------------------------------------------------------------
    await maybeExtractEntities(
      jobId,
      sidecarUrl,
      storedSections,
      documentId,
      companyId,
      runStep,
    );

    // -----------------------------------------------------------------------
    // Step F2: LLM relationship extraction (gated by NEO4J_URI + EXTRACTION_LLM_BASE_URL)
    // -----------------------------------------------------------------------
    await maybeExtractRelationships(
      jobId,
      sidecarUrl,
      storedSections,
      documentId,
      companyId,
      runStep,
    );

    // -----------------------------------------------------------------------
    // Step G: Direct Neo4j write (gated by NEO4J_URI)
    // -----------------------------------------------------------------------
    await maybeSyncToNeo4j(
      jobId,
      documentId,
      documentName,
      companyId,
      storedSections,
      runStep,
    );

    const stats = getTotalChunkSize(chunks);
    const totalProcessingTime = Date.now() - pipelineStartTime;

    return {
      success: true,
      jobId,
      documentId,
      chunks: [],
      metadata: {
        totalChunks: totalStored,
        textChunks: stats.textChunks,
        tableChunks: stats.tableChunks,
        totalPages: normSummary.pageCount,
        provider: normSummary.provider as NormalizationResult["provider"],
        processingTimeMs: normSummary.processingTimeMs,
        embeddingTimeMs: totalProcessingTime - normSummary.processingTimeMs,
      },
    };
  } catch (error) {
    if (markFailureInDb) {
      await markJobFailed(
        jobId,
        error instanceof Error ? error : new Error(String(error)),
      );
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

// Exported for integration testing — not part of the public API.
export const __test__ = {
  maybeExtractEntities,
  maybeExtractRelationships,
  maybeSyncToNeo4j,
  savePipelineState,
  loadPipelineState,
} as const;
