import { and, eq, inArray } from "drizzle-orm";
import { BM25Retriever } from "@langchain/community/retrievers/bm25";
import { Document } from "@langchain/core/documents";

import { getDb } from "@launchstack/store/client";
import { documentSections, document } from "@launchstack/store/schema";
import type { ChunkRow, DocumentScope, SearchScope } from "../../search-types";
import { documentScopeSql } from "../scope";

export async function getDocumentChunks(documentId: number): Promise<ChunkRow[]> {
    // Join to `document` so only chunks from its current version are returned.
    const rows = await getDb()
        .select({
            id: documentSections.id,
            content: documentSections.content,
            page: documentSections.pageNumber,
            documentId: documentSections.documentId,
            versionId: document.currentVersionId,
            category: document.category,
        })
        .from(documentSections)
        .innerJoin(document, eq(documentSections.documentId, document.id))
        .where(
            and(
                eq(documentSections.documentId, BigInt(documentId)),
                eq(documentSections.versionId, document.currentVersionId)
            )
        );

    return rows.map(r => ({
        id: r.id,
        content: r.content,
        page: r.page ?? 0,
        documentId: Number(r.documentId),
        versionId: r.versionId != null ? Number(r.versionId) : undefined,
        documentTitle: undefined,
        category: r.category,
    }));
}

/**
 * Every current-version chunk in the company that the scope allows. The
 * scope is a predicate on the joined `document` row, so a restricted folder
 * or document never reaches the in-memory BM25 index.
 */
export async function getCompanyChunks(
    companyId: number,
    scope?: DocumentScope
): Promise<ChunkRow[]> {
    // Join to `document` so only chunks from its current version are returned.
    const rows = await getDb()
        .select({
            id: documentSections.id,
            content: documentSections.content,
            page: documentSections.pageNumber,
            documentId: documentSections.documentId,
            versionId: document.currentVersionId,
            documentTitle: document.title,
            category: document.category,
        })
        .from(documentSections)
        .innerJoin(document, eq(documentSections.documentId, document.id))
        .where(
            and(
                eq(document.companyId, BigInt(companyId)),
                eq(documentSections.versionId, document.currentVersionId),
                documentScopeSql(scope)
            )
        );

    return rows.map(r => ({
        id: r.id,
        content: r.content,
        page: r.page ?? 0,
        documentId: Number(r.documentId),
        versionId: r.versionId != null ? Number(r.versionId) : undefined,
        documentTitle: r.documentTitle ?? undefined,
        category: r.category,
    }));
}

export async function getMultiDocChunks(documentIds: number[]): Promise<ChunkRow[]> {
    if (documentIds.length === 0) {
        return [];
    }

    const bigIntDocIds = documentIds.map(id => BigInt(id));

    // Join to `document` so only chunks from its current version are returned.
    const rows = await getDb()
        .select({
            id: documentSections.id,
            content: documentSections.content,
            page: documentSections.pageNumber,
            documentId: documentSections.documentId,
            versionId: document.currentVersionId,
            documentTitle: document.title,
            category: document.category,
        })
        .from(documentSections)
        .innerJoin(document, eq(documentSections.documentId, document.id))
        .where(
            and(
                inArray(documentSections.documentId, bigIntDocIds),
                eq(documentSections.versionId, document.currentVersionId)
            )
        );

    return rows.map(r => ({
        id: r.id,
        content: r.content,
        page: r.page ?? 0,
        documentId: Number(r.documentId),
        versionId: r.versionId != null ? Number(r.versionId) : undefined,
        documentTitle: r.documentTitle ?? undefined,
        category: r.category,
    }));
}

export function chunksToDocuments(chunks: ChunkRow[], searchScope: SearchScope): Document[] {
    return chunks.map(
        chunk =>
            new Document({
                pageContent: chunk.content,
                metadata: {
                    chunkId: chunk.id,
                    // BM25 ranks context (parent) chunks directly, so the
                    // chunk id *is* the parent id. Naming it lets the
                    // ensemble collapse a vector hit and a lexical hit on
                    // the same section into one result.
                    parentChunkId: chunk.id,
                    page: chunk.page,
                    documentId: chunk.documentId,
                    versionId: chunk.versionId,
                    documentTitle: chunk.documentTitle,
                    category: chunk.category,
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
    topK = 10,
    scope?: DocumentScope
): Promise<BM25Retriever> {
    const chunks = await getCompanyChunks(companyId, scope);
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
