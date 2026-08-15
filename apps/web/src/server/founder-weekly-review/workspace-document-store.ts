import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, type DbClient } from "@launchstack/core/db";
import {
    createEmbeddingModel,
    resolveEmbeddingIndex,
    type EmbeddingsProvider,
} from "@launchstack/core/embeddings";
import { document, documentContextChunks, documentStructure } from "@launchstack/core/db/schema";
import {
    MAX_WORKSPACE_RETRIEVAL_CANDIDATES,
    normalizeFounderContextRetrievalQuery,
    type WorkspaceDocumentHit,
    type WorkspaceDocumentRetrievalInput,
    type WorkspaceDocumentRetrievalResult,
} from "@launchstack/features/founder-weekly-review";

export interface FounderWeeklyReviewWorkspaceDocumentStore {
    retrieveRelevantCurrentDocumentChunks(
        input: WorkspaceDocumentRetrievalInput
    ): Promise<WorkspaceDocumentRetrievalResult>;
}

/** Strict current-version vector retrieval used only by Founder Weekly Review. */
export class StrictCurrentWorkspaceDocumentStore
    implements FounderWeeklyReviewWorkspaceDocumentStore
{
    constructor(
        private readonly db: DbClient = getDb(),
        private readonly embeddings?: EmbeddingsProvider
    ) {}

    async retrieveRelevantCurrentDocumentChunks(
        input: WorkspaceDocumentRetrievalInput
    ): Promise<WorkspaceDocumentRetrievalResult> {
        const query = normalizeFounderContextRetrievalQuery(input.founderContext);
        if (!query) return { state: "empty", hits: [] };
        const topK = Math.max(
            1,
            Math.min(
                MAX_WORKSPACE_RETRIEVAL_CANDIDATES,
                input.topK ?? MAX_WORKSPACE_RETRIEVAL_CANDIDATES
            )
        );
        try {
            // document_context_chunks.embedding is the legacy 1536-dimensional store.
            // Do not resolve a configurable dimension-table index for this SQL path.
            const embedding = await (
                this.embeddings ?? createEmbeddingModel(resolveEmbeddingIndex("legacy-openai-1536"))
            ).embedQuery(query);
            if (embedding.length !== 1536 || embedding.some(value => !Number.isFinite(value))) {
                return {
                    state: "unavailable",
                    hits: [],
                    warnings: ["workspace_document_embedding_index_unavailable"],
                };
            }
            const literal = sql.raw(`'${JSON.stringify(embedding)}'::vector(1536)`);
            const rows = await this.db
                .select({
                    documentId: documentContextChunks.documentId,
                    documentTitle: document.title,
                    versionId: documentContextChunks.versionId,
                    contextChunkId: documentContextChunks.id,
                    content: documentContextChunks.content,
                    structureId: documentContextChunks.structureId,
                    structurePath: documentStructure.path,
                    structureTitle: documentStructure.title,
                    pageNumber: documentContextChunks.pageNumber,
                    lineStart: documentContextChunks.lineStart,
                    lineEnd: documentContextChunks.lineEnd,
                    similarityScore: sql<number>`1 - (${documentContextChunks.embedding} <=> ${literal})`,
                })
                .from(documentContextChunks)
                .innerJoin(document, eq(documentContextChunks.documentId, document.id))
                .leftJoin(
                    documentStructure,
                    eq(documentContextChunks.structureId, documentStructure.id)
                )
                .where(
                    and(
                        eq(document.companyId, input.companyId),
                        eq(documentContextChunks.versionId, document.currentVersionId),
                        sql`${documentContextChunks.versionId} IS NOT NULL`,
                        sql`${document.currentVersionId} IS NOT NULL`,
                        sql`${documentContextChunks.embedding} IS NOT NULL`
                    )
                )
                .orderBy(
                    sql`${documentContextChunks.embedding} <=> ${literal}`,
                    asc(document.id),
                    asc(documentContextChunks.versionId),
                    asc(documentContextChunks.id)
                )
                .limit(topK);
            if (!rows.length) return { state: "empty", hits: [] };
            return {
                state: "success",
                hits: rows.map(
                    (row): WorkspaceDocumentHit => ({
                        ...row,
                        versionId: row.versionId!,
                        similarityScore: row.similarityScore,
                    })
                ),
            };
        } catch {
            return {
                state: "unavailable",
                hits: [],
                warnings: ["workspace_document_retrieval_unavailable"],
            };
        }
    }
}
