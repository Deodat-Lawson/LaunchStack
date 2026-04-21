import { db } from "~/server/db/index";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { documentSections, document, pdfChunks } from "@launchstack/core/db/schema";
import { BM25Retriever } from "@langchain/community/retrievers/bm25";
import { Document } from "@langchain/core/documents";
import type { ChunkRow, SearchScope } from "../types";

/**
 * Version filter shared by every chunk lookup in this file.
 *
 * Semantics:
 *   - If the document has no current_version_id (fully unbackfilled), return
 *     all its chunks — we can't tell which version is current.
 *   - If the chunk itself has no version_id (pre-Step-2 data that the
 *     backfill hasn't touched yet), return it as a safety net.
 *   - Otherwise, only return chunks whose version_id matches the document's
 *     current_version_id. Older versions stay indexed but are hidden from RAG.
 *
 * Once the backfill has run everywhere, this degenerates to a strict equality
 * check. The IS NULL branches are defensive, not load-bearing.
 */
const currentVersionFilter = or(
  isNull(document.currentVersionId),
  isNull(documentSections.versionId),
  sql`${documentSections.versionId} = ${document.currentVersionId}`,
);

export async function getDocumentChunks(documentId: number): Promise<ChunkRow[]> {
  // Try primary table first. Joined to `document` so we can filter out chunks
  // that belong to non-current versions of this document.
  const rows = await db
    .select({
      id: documentSections.id,
      content: documentSections.content,
      page: documentSections.pageNumber,
      documentId: documentSections.documentId,
    })
    .from(documentSections)
    .innerJoin(document, eq(documentSections.documentId, document.id))
    .where(
      and(
        eq(documentSections.documentId, BigInt(documentId)),
        currentVersionFilter,
      )
    );

  // Fallback to legacy table if no results
  if (rows.length === 0) {
    const legacyRows = await db
      .select({
        id: pdfChunks.id,
        content: pdfChunks.content,
        page: pdfChunks.page,
        documentId: pdfChunks.documentId,
      })
      .from(pdfChunks)
      .where(eq(pdfChunks.documentId, BigInt(documentId)));
    
    return legacyRows.map(r => ({
      id: r.id,
      content: r.content,
      page: r.page ?? 0,
      documentId: Number(r.documentId),
      documentTitle: undefined,
    }));
  }

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    page: r.page ?? 0,
    documentId: Number(r.documentId),
    documentTitle: undefined,
  }));
}

export async function getCompanyChunks(companyId: number): Promise<ChunkRow[]> {
  // Try primary table first
  const rows = await db
    .select({
      id: documentSections.id,
      content: documentSections.content,
      page: documentSections.pageNumber,
      documentId: documentSections.documentId,
      documentTitle: document.title,
    })
    .from(documentSections)
    .innerJoin(document, eq(documentSections.documentId, document.id))
    .where(
      and(
        eq(document.companyId, BigInt(companyId)),
        currentVersionFilter,
      )
    );

  // Fallback to legacy table
  if (rows.length === 0) {
    const legacyRows = await db
      .select({
        id: pdfChunks.id,
        content: pdfChunks.content,
        page: pdfChunks.page,
        documentId: pdfChunks.documentId,
        documentTitle: document.title,
      })
      .from(pdfChunks)
      .innerJoin(document, eq(pdfChunks.documentId, document.id))
      .where(eq(document.companyId, BigInt(companyId)));
    
    return legacyRows.map(r => ({
      id: r.id,
      content: r.content,
      page: r.page ?? 0,
      documentId: Number(r.documentId),
      documentTitle: r.documentTitle ?? undefined,
    }));
  }

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    page: r.page ?? 0,
    documentId: Number(r.documentId),
    documentTitle: r.documentTitle ?? undefined,
  }));
}

export async function getMultiDocChunks(documentIds: number[]): Promise<ChunkRow[]> {
  if (documentIds.length === 0) {
    return [];
  }

  const bigIntDocIds = documentIds.map(id => BigInt(id));

  // Try primary table first
  const rows = await db
    .select({
      id: documentSections.id,
      content: documentSections.content,
      page: documentSections.pageNumber,
      documentId: documentSections.documentId,
      documentTitle: document.title,
    })
    .from(documentSections)
    .innerJoin(document, eq(documentSections.documentId, document.id))
    .where(
      and(
        inArray(documentSections.documentId, bigIntDocIds),
        currentVersionFilter,
      )
    );

  // Fallback to legacy table
  if (rows.length === 0) {
    const legacyRows = await db
      .select({
        id: pdfChunks.id,
        content: pdfChunks.content,
        page: pdfChunks.page,
        documentId: pdfChunks.documentId,
        documentTitle: document.title,
      })
      .from(pdfChunks)
      .innerJoin(document, eq(pdfChunks.documentId, document.id))
      .where(inArray(pdfChunks.documentId, bigIntDocIds));
    
    return legacyRows.map(r => ({
      id: r.id,
      content: r.content,
      page: r.page ?? 0,
      documentId: Number(r.documentId),
      documentTitle: r.documentTitle ?? undefined,
    }));
  }

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    page: r.page ?? 0,
    documentId: Number(r.documentId),
    documentTitle: r.documentTitle ?? undefined,
  }));
}

export function chunksToDocuments(
  chunks: ChunkRow[],
  searchScope: SearchScope
): Document[] {
  return chunks.map(
    (chunk) =>
      new Document({
        pageContent: chunk.content,
        metadata: {
          chunkId: chunk.id,
          page: chunk.page,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          source: "bm25",
          searchScope,
        },
      })
  );
}

export async function createDocumentBM25Retriever(
  documentId: number,
  topK = 8
): Promise<BM25Retriever> {
  const chunks = await getDocumentChunks(documentId);
  if (chunks.length === 0) {
    throw new Error(`No chunks found for document ${documentId}`);
  }

  const docs = chunksToDocuments(chunks, "document");
  return BM25Retriever.fromDocuments(docs, { k: topK });
}

export async function createCompanyBM25Retriever(
  companyId: number,
  topK = 10
): Promise<BM25Retriever> {
  const chunks = await getCompanyChunks(companyId);
  if (chunks.length === 0) {
    throw new Error(`No chunks found for company ${companyId}`);
  }

  const docs = chunksToDocuments(chunks, "company");
  return BM25Retriever.fromDocuments(docs, { k: topK });
}

export async function createMultiDocBM25Retriever(
  documentIds: number[],
  topK = 8
): Promise<BM25Retriever> {
  const chunks = await getMultiDocChunks(documentIds);
  if (chunks.length === 0) {
    throw new Error(`No chunks found for documents ${documentIds.join(", ")}`);
  }

  const docs = chunksToDocuments(chunks, "multi-document");
  return BM25Retriever.fromDocuments(docs, { k: topK });
}
