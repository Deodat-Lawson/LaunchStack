import { db } from "~/server/db/index";
import { and, eq, inArray } from "drizzle-orm";
import { documentSections, document } from "@launchstack/core/db/schema";
import { BM25Retriever } from "@langchain/community/retrievers/bm25";
import { Document } from "@langchain/core/documents";
import type { ChunkRow, SearchScope } from "../types";

export async function getDocumentChunks(documentId: number): Promise<ChunkRow[]> {
    // Join to `document` so only chunks from its current version are returned.
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
                eq(documentSections.versionId, document.currentVersionId)
            )
        );

    return rows.map(r => ({
        id: r.id,
        content: r.content,
        page: r.page ?? 0,
        documentId: Number(r.documentId),
        documentTitle: undefined,
    }));
}

export async function getCompanyChunks(companyId: number): Promise<ChunkRow[]> {
    // Join to `document` so only chunks from its current version are returned.
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
                eq(documentSections.versionId, document.currentVersionId)
            )
        );

    return rows.map(r => ({
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

    // Join to `document` so only chunks from its current version are returned.
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
                eq(documentSections.versionId, document.currentVersionId)
            )
        );

    return rows.map(r => ({
        id: r.id,
        content: r.content,
        page: r.page ?? 0,
        documentId: Number(r.documentId),
        documentTitle: r.documentTitle ?? undefined,
    }));
}

export function chunksToDocuments(chunks: ChunkRow[], searchScope: SearchScope): Document[] {
    return chunks.map(
        chunk =>
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
