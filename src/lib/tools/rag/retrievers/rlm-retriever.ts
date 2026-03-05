/**
 * RLM Retriever - Hierarchical Access Patterns for Recursive Language Models
 *
 * This retriever is designed for RLM-style inference where:
 * - Knowledge is accessed programmatically, not stuffed into context
 * - Cheap probing before full retrieval
 * - Cost-aware planning with token budgets
 * - Recursive decomposition through document structure
 * - Intermediate results stored for reuse
 *
 * Key access patterns:
 * 1. getDocumentOverview - Cheap metadata for planning
 * 2. getDocumentTree - Navigate hierarchical structure
 * 3. getSectionsWithinBudget - Cost-aware retrieval
 * 4. probeSection - Preview before full read
 * 5. Workspace operations - Store/retrieve intermediate results
 */

import { db } from "~/server/db/index";
import { eq, and, sql, asc, desc, lte, inArray, isNull } from "drizzle-orm";
import {
    documentStructure,
    documentSections,
    documentMetadata,
    documentPreviews,
    workspaceResults,
    document,
    type OutlineNode,
    type WorkspaceMetadata,
    type ContentType,
    type SemanticType,
    type PreviewType,
    type ResultType,
} from "~/server/db/schema";
import type { EmbeddingsProvider } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface DocumentOverview {
    documentId: number;
    title: string;
    totalTokens: number;
    totalSections: number;
    totalPages: number;
    maxDepth: number;
    summary: string | null;
    outline: OutlineNode[];
    topicTags: string[];
    complexityScore: number | null;
    documentClass: string | null;
}

export interface StructureNode {
    id: number;
    parentId: number | null;
    level: number;
    ordering: number;
    title: string | null;
    contentType: ContentType;
    path: string | null;
    startPage: number | null;
    endPage: number | null;
    childCount: number;
    tokenCount: number;
    children?: StructureNode[];
}

export interface SectionWithCost {
    id: number;
    content: string;
    tokenCount: number;
    pageNumber: number | null;
    semanticType: SemanticType | null;
    structurePath: string | null;
    cumulativeTokens: number; // Running total
}

export interface SectionPreview {
    id: number;
    previewType: PreviewType;
    content: string;
    tokenCount: number;
    sectionId: number | null;
    structureId: number | null;
}

export interface WorkspaceEntry {
    id: number;
    sessionId: string;
    resultType: ResultType;
    content: string;
    metadata: WorkspaceMetadata | null;
    status: string;
    documentId: number | null;
    sectionId: number | null;
    createdAt: Date;
}

export interface TokenBudgetOptions {
    maxTokens: number;
    prioritize?: "start" | "end" | "relevance";
    semanticTypes?: SemanticType[];
    pageRange?: { start: number; end: number };
}

export interface WorkspaceStoreOptions {
    sessionId: string;
    userId: string;
    companyId: number;
    resultType: ResultType;
    content: string;
    documentId?: number;
    sectionId?: number;
    structureId?: number;
    parentResultId?: number;
    metadata?: WorkspaceMetadata;
    ttlHours?: number;
}

// ============================================================================
// RLM Retriever Class
// ============================================================================

export class RLMRetriever {
    private embeddings?: EmbeddingsProvider;

    constructor(embeddings?: EmbeddingsProvider) {
        this.embeddings = embeddings;
    }

    // ========================================================================
    // 1. Document Overview - Cheap metadata for LLM planning
    // ========================================================================

    /**
     * Get document overview for cost-aware planning.
     * This is the first call an RLM should make - cheap, informative.
     */
    async getDocumentOverview(documentId: number): Promise<DocumentOverview | null> {
        const [meta] = await db
            .select({
                documentId: documentMetadata.documentId,
                title: document.title,
                totalTokens: documentMetadata.totalTokens,
                totalSections: documentMetadata.totalSections,
                totalPages: documentMetadata.totalPages,
                maxSectionDepth: documentMetadata.maxSectionDepth,
                summary: documentMetadata.summary,
                outline: documentMetadata.outline,
                topicTags: documentMetadata.topicTags,
                complexityScore: documentMetadata.complexityScore,
                documentClass: documentMetadata.documentClass,
            })
            .from(documentMetadata)
            .innerJoin(document, eq(documentMetadata.documentId, document.id))
            .where(eq(documentMetadata.documentId, BigInt(documentId)))
            .limit(1);

        if (!meta) return null;

        return {
            documentId: Number(meta.documentId),
            title: meta.title,
            totalTokens: meta.totalTokens ?? 0,
            totalSections: meta.totalSections ?? 0,
            totalPages: meta.totalPages ?? 0,
            maxDepth: meta.maxSectionDepth ?? 0,
            summary: meta.summary,
            outline: meta.outline ?? [],
            topicTags: meta.topicTags ?? [],
            complexityScore: meta.complexityScore,
            documentClass: meta.documentClass,
        };
    }

    /**
     * Get overviews for multiple documents (batch operation).
     */
    async getDocumentOverviews(documentIds: number[]): Promise<DocumentOverview[]> {
        if (documentIds.length === 0) return [];

        const metas = await db
            .select({
                documentId: documentMetadata.documentId,
                title: document.title,
                totalTokens: documentMetadata.totalTokens,
                totalSections: documentMetadata.totalSections,
                totalPages: documentMetadata.totalPages,
                maxSectionDepth: documentMetadata.maxSectionDepth,
                summary: documentMetadata.summary,
                outline: documentMetadata.outline,
                topicTags: documentMetadata.topicTags,
                complexityScore: documentMetadata.complexityScore,
                documentClass: documentMetadata.documentClass,
            })
            .from(documentMetadata)
            .innerJoin(document, eq(documentMetadata.documentId, document.id))
            .where(
                inArray(
                    documentMetadata.documentId,
                    documentIds.map((id) => BigInt(id))
                )
            );

        return metas.map((meta) => ({
            documentId: Number(meta.documentId),
            title: meta.title,
            totalTokens: meta.totalTokens ?? 0,
            totalSections: meta.totalSections ?? 0,
            totalPages: meta.totalPages ?? 0,
            maxDepth: meta.maxSectionDepth ?? 0,
            summary: meta.summary,
            outline: meta.outline!,
            topicTags: meta.topicTags!,
            complexityScore: meta.complexityScore,
            documentClass: meta.documentClass,
        }));
    }

    // ========================================================================
    // 2. Document Structure Navigation
    // ========================================================================

    /**
     * Get document structure tree up to specified depth.
     * Enables recursive decomposition of document.
     */
    async getDocumentTree(
        documentId: number,
        maxDepth = 2
    ): Promise<StructureNode[]> {
        const nodes = await db
            .select()
            .from(documentStructure)
            .where(
                and(
                    eq(documentStructure.documentId, BigInt(documentId)),
                    lte(documentStructure.level, maxDepth)
                )
            )
            .orderBy(asc(documentStructure.level), asc(documentStructure.ordering));

        // Build tree from flat list
        const nodeMap = new Map<number, StructureNode>();
        const roots: StructureNode[] = [];

        for (const node of nodes) {
            const structNode: StructureNode = {
                id: node.id,
                parentId: node.parentId ? Number(node.parentId) : null,
                level: node.level,
                ordering: node.ordering,
                title: node.title,
                contentType: node.contentType,
                path: node.path,
                startPage: node.startPage,
                endPage: node.endPage,
                childCount: node.childCount,
                tokenCount: node.tokenCount ?? 0,
                children: [],
            };
            nodeMap.set(node.id, structNode);
        }

        // Link children to parents
        for (const node of nodeMap.values()) {
            if (node.parentId === null) {
                roots.push(node);
            } else {
                const parent = nodeMap.get(node.parentId);
                if (parent) {
                    parent.children = parent.children ?? [];
                    parent.children.push(node);
                }
            }
        }

        return roots;
    }

    /**
     * Get children of a specific structure node.
     */
    async getStructureChildren(structureId: number): Promise<StructureNode[]> {
        const nodes = await db
            .select()
            .from(documentStructure)
            .where(eq(documentStructure.parentId, BigInt(structureId)))
            .orderBy(asc(documentStructure.ordering));

        return nodes.map((node) => ({
            id: node.id,
            parentId: node.parentId ? Number(node.parentId) : null,
            level: node.level,
            ordering: node.ordering,
            title: node.title,
            contentType: node.contentType,
            path: node.path,
            startPage: node.startPage,
            endPage: node.endPage,
            childCount: node.childCount,
            tokenCount: node.tokenCount ?? 0,
        }));
    }

    /**
     * Get structure node by path (e.g., "1.2.3").
     */
    async getStructureByPath(
        documentId: number,
        path: string
    ): Promise<StructureNode | null> {
        const [node] = await db
            .select()
            .from(documentStructure)
            .where(
                and(
                    eq(documentStructure.documentId, BigInt(documentId)),
                    eq(documentStructure.path, path)
                )
            )
            .limit(1);

        if (!node) return null;

        return {
            id: node.id,
            parentId: node.parentId ? Number(node.parentId) : null,
            level: node.level,
            ordering: node.ordering,
            title: node.title,
            contentType: node.contentType,
            path: node.path,
            startPage: node.startPage,
            endPage: node.endPage,
            childCount: node.childCount,
            tokenCount: node.tokenCount ?? 0,
        };
    }

    // ========================================================================
    // 3. Cost-Aware Section Retrieval
    // ========================================================================

    /**
     * Get sections within a token budget.
     * Core RLM pattern: plan retrieval based on cost constraints.
     */
    async getSectionsWithinBudget(
        documentId: number,
        options: TokenBudgetOptions
    ): Promise<SectionWithCost[]> {
        const { maxTokens, prioritize = "start", semanticTypes, pageRange } = options;

        // Build query conditions
        const conditions = [eq(documentSections.documentId, BigInt(documentId))];

        if (semanticTypes?.length) {
            conditions.push(
                inArray(documentSections.semanticType, semanticTypes)
            );
        }

        // Order based on priority
        let orderClause;
        if (prioritize === "start") {
            orderClause = [
                asc(documentSections.pageNumber),
                asc(documentSections.id),
            ];
        } else if (prioritize === "end") {
            orderClause = [
                desc(documentSections.pageNumber),
                desc(documentSections.id),
            ];
        } else {
            // Relevance-based would require embedding search
            orderClause = [asc(documentSections.id)];
        }

        const allSections = await db
            .select({
                id: documentSections.id,
                content: documentSections.content,
                tokenCount: documentSections.tokenCount,
                pageNumber: documentSections.pageNumber,
                semanticType: documentSections.semanticType,
                structureId: documentSections.structureId,
            })
            .from(documentSections)
            .where(and(...conditions))
            .orderBy(...orderClause);

        // Filter by page range if specified
        let filtered = allSections;
        if (pageRange) {
            filtered = allSections.filter(
                (s) =>
                    s.pageNumber !== null &&
                    s.pageNumber >= pageRange.start &&
                    s.pageNumber <= pageRange.end
            );
        }

        // Accumulate until budget exhausted
        const result: SectionWithCost[] = [];
        let cumulative = 0;

        for (const section of filtered) {
            const tokenCount = section.tokenCount;
            if (cumulative + tokenCount > maxTokens && result.length > 0) {
                break; // Budget exhausted
            }

            cumulative += tokenCount;

            // Get structure path
            let structurePath: string | null = null;
            if (section.structureId) {
                const [struct] = await db
                    .select({ path: documentStructure.path })
                    .from(documentStructure)
                    .where(eq(documentStructure.id, Number(section.structureId)))
                    .limit(1);
                structurePath = struct?.path ?? null;
            }

            result.push({
                id: section.id,
                content: section.content,
                tokenCount,
                pageNumber: section.pageNumber,
                semanticType: section.semanticType,
                structurePath,
                cumulativeTokens: cumulative,
            });
        }

        return result;
    }

    /**
     * Get sections by structure node (all content under a tree node).
     */
    async getSectionsByStructure(structureId: number): Promise<SectionWithCost[]> {
        const sections = await db
            .select({
                id: documentSections.id,
                content: documentSections.content,
                tokenCount: documentSections.tokenCount,
                pageNumber: documentSections.pageNumber,
                semanticType: documentSections.semanticType,
                path: documentStructure.path,
            })
            .from(documentSections)
            .leftJoin(
                documentStructure,
                eq(documentSections.structureId, documentStructure.id)
            )
            .where(eq(documentSections.structureId, BigInt(structureId)))
            .orderBy(asc(documentSections.id));

        let cumulative = 0;
        return sections.map((s) => {
            cumulative += s.tokenCount;
            return {
                id: s.id,
                content: s.content,
                tokenCount: s.tokenCount,
                pageNumber: s.pageNumber,
                semanticType: s.semanticType,
                structurePath: s.path,
                cumulativeTokens: cumulative,
            };
        });
    }

    /**
     * Get sections by page range.
     */
    async getSectionsByPages(
        documentId: number,
        startPage: number,
        endPage: number
    ): Promise<SectionWithCost[]> {
        const sections = await db
            .select({
                id: documentSections.id,
                content: documentSections.content,
                tokenCount: documentSections.tokenCount,
                pageNumber: documentSections.pageNumber,
                semanticType: documentSections.semanticType,
                path: documentStructure.path,
            })
            .from(documentSections)
            .leftJoin(
                documentStructure,
                eq(documentSections.structureId, documentStructure.id)
            )
            .where(
                and(
                    eq(documentSections.documentId, BigInt(documentId)),
                    sql`${documentSections.pageNumber} >= ${startPage}`,
                    sql`${documentSections.pageNumber} <= ${endPage}`
                )
            )
            .orderBy(asc(documentSections.pageNumber), asc(documentSections.id));

        let cumulative = 0;
        return sections.map((s) => {
            cumulative += s.tokenCount;
            return {
                id: s.id,
                content: s.content,
                tokenCount: s.tokenCount,
                pageNumber: s.pageNumber,
                semanticType: s.semanticType,
                structurePath: s.path,
                cumulativeTokens: cumulative,
            };
        });
    }

    // ========================================================================
    // 4. Preview/Probing Operations
    // ========================================================================

    /**
     * Get previews for a document (cheap inspection before full retrieval).
     */
    async getDocumentPreviews(
        documentId: number,
        previewTypes?: PreviewType[]
    ): Promise<SectionPreview[]> {
        const conditions = [
            eq(documentPreviews.documentId, BigInt(documentId)),
            isNull(documentPreviews.sectionId), // Document-level previews
        ];

        if (previewTypes?.length) {
            conditions.push(inArray(documentPreviews.previewType, previewTypes));
        }

        const previews = await db
            .select()
            .from(documentPreviews)
            .where(and(...conditions));

        return previews.map((p) => ({
            id: p.id,
            previewType: p.previewType,
            content: p.content,
            tokenCount: p.tokenCount,
            sectionId: p.sectionId ? Number(p.sectionId) : null,
            structureId: p.structureId ? Number(p.structureId) : null,
        }));
    }

    /**
     * Get preview for a specific section (before reading full content).
     */
    async getSectionPreview(sectionId: number): Promise<SectionPreview | null> {
        const [preview] = await db
            .select()
            .from(documentPreviews)
            .where(eq(documentPreviews.sectionId, BigInt(sectionId)))
            .limit(1);

        if (!preview) return null;

        return {
            id: preview.id,
            previewType: preview.previewType,
            content: preview.content,
            tokenCount: preview.tokenCount,
            sectionId: preview.sectionId ? Number(preview.sectionId) : null,
            structureId: preview.structureId ? Number(preview.structureId) : null,
        };
    }

    /**
     * Probe multiple sections (get metadata without full content).
     */
    async probeSections(
        sectionIds: number[]
    ): Promise<Array<{ id: number; tokenCount: number; semanticType: string | null; pageNumber: number | null }>> {
        if (sectionIds.length === 0) return [];

        const sections = await db
            .select({
                id: documentSections.id,
                tokenCount: documentSections.tokenCount,
                semanticType: documentSections.semanticType,
                pageNumber: documentSections.pageNumber,
            })
            .from(documentSections)
            .where(inArray(documentSections.id, sectionIds));

        return sections;
    }

    // ========================================================================
    // 5. Workspace Operations (Intermediate Results)
    // ========================================================================

    /**
     * Store an intermediate result for later reuse.
     * Key RLM pattern: workspace as scratchpad for recursive operations.
     */
    async storeIntermediateResult(options: WorkspaceStoreOptions): Promise<number> {
        const expiresAt = options.ttlHours
            ? new Date(Date.now() + options.ttlHours * 60 * 60 * 1000)
            : new Date(Date.now() + 24 * 60 * 60 * 1000); // Default 24h TTL

        const [result] = await db
            .insert(workspaceResults)
            .values({
                sessionId: options.sessionId,
                userId: options.userId,
                companyId: BigInt(options.companyId),
                resultType: options.resultType,
                content: options.content,
                documentId: options.documentId ? BigInt(options.documentId) : null,
                sectionId: options.sectionId ? BigInt(options.sectionId) : null,
                structureId: options.structureId ? BigInt(options.structureId) : null,
                parentResultId: options.parentResultId
                    ? BigInt(options.parentResultId)
                    : null,
                metadata: options.metadata ?? null,
                status: "completed",
                expiresAt,
            })
            .returning({ id: workspaceResults.id });

        return result!.id;
    }

    /**
     * Get results for a session.
     */
    async getSessionResults(
        sessionId: string,
        resultTypes?: ResultType[]
    ): Promise<WorkspaceEntry[]> {
        const conditions = [eq(workspaceResults.sessionId, sessionId)];

        if (resultTypes?.length) {
            conditions.push(inArray(workspaceResults.resultType, resultTypes));
        }

        const results = await db
            .select()
            .from(workspaceResults)
            .where(and(...conditions))
            .orderBy(asc(workspaceResults.createdAt));

        return results.map((r) => ({
            id: r.id,
            sessionId: r.sessionId,
            resultType: r.resultType,
            content: r.content,
            metadata: r.metadata,
            status: r.status,
            documentId: r.documentId ? Number(r.documentId) : null,
            sectionId: r.sectionId ? Number(r.sectionId) : null,
            createdAt: r.createdAt,
        }));
    }

    /**
     * Get a specific result by ID.
     */
    async getResultById(resultId: number): Promise<WorkspaceEntry | null> {
        const [result] = await db
            .select()
            .from(workspaceResults)
            .where(eq(workspaceResults.id, resultId))
            .limit(1);

        if (!result) return null;

        return {
            id: result.id,
            sessionId: result.sessionId,
            resultType: result.resultType,
            content: result.content,
            metadata: result.metadata,
            status: result.status,
            documentId: result.documentId ? Number(result.documentId) : null,
            sectionId: result.sectionId ? Number(result.sectionId) : null,
            createdAt: result.createdAt,
        };
    }

    /**
     * Get child results (for tracking recursion chains).
     */
    async getChildResults(parentResultId: number): Promise<WorkspaceEntry[]> {
        const results = await db
            .select()
            .from(workspaceResults)
            .where(eq(workspaceResults.parentResultId, BigInt(parentResultId)))
            .orderBy(asc(workspaceResults.createdAt));

        return results.map((r) => ({
            id: r.id,
            sessionId: r.sessionId,
            resultType: r.resultType,
            content: r.content,
            metadata: r.metadata,
            status: r.status,
            documentId: r.documentId ? Number(r.documentId) : null,
            sectionId: r.sectionId ? Number(r.sectionId) : null,
            createdAt: r.createdAt,
        }));
    }

    /**
     * Clean up expired workspace results.
     */
    async cleanupExpiredResults(): Promise<number> {
        const result = await db
            .delete(workspaceResults)
            .where(sql`${workspaceResults.expiresAt} < NOW()`)
            .returning({ id: workspaceResults.id });

        return result.length;
    }

    // ========================================================================
    // 6. Semantic Search (uses embeddings if provided)
    // ========================================================================

    /**
     * Semantic search across sections with token budget awareness.
     */
    async semanticSearch(
        documentId: number,
        query: string,
        options: { topK?: number; maxTokens?: number } = {}
    ): Promise<SectionWithCost[]> {
        if (!this.embeddings) {
            throw new Error("Embeddings provider required for semantic search");
        }

        const { topK = 10, maxTokens } = options;
        const queryEmbedding = await this.embeddings.embedQuery(query);
        const bracketedEmbedding = `[${queryEmbedding.join(",")}]`;

        const results = await db.select({
            id: documentSections.id,
            content: documentSections.content,
            tokenCount: documentSections.tokenCount,
            pageNumber: documentSections.pageNumber,
            semanticType: documentSections.semanticType,
            structurePath: documentStructure.path,
            distance: sql<number>`${documentSections.embedding} <-> ${bracketedEmbedding}::vector(1536)`,
        })
        .from(documentSections)
        .leftJoin(documentStructure, eq(documentSections.structureId, documentStructure.id))
        .where(eq(documentSections.documentId, BigInt(documentId)))
        .orderBy(sql`${documentSections.embedding} <-> ${bracketedEmbedding}::vector(1536)`)
        .limit(topK);

        // Apply token budget if specified
        let cumulative = 0;
        const sections: SectionWithCost[] = [];

        for (const row of results) {
            if (maxTokens && cumulative + row.tokenCount > maxTokens && sections.length > 0) {
                break;
            }

            cumulative += row.tokenCount;
            sections.push({
                id: row.id,
                content: row.content,
                tokenCount: row.tokenCount,
                pageNumber: row.pageNumber,
                semanticType: row.semanticType,
                structurePath: row.structurePath,
                cumulativeTokens: cumulative,
            });
        }

        return sections;
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an RLM retriever instance.
 */
export function createRLMRetriever(embeddings?: EmbeddingsProvider): RLMRetriever {
    return new RLMRetriever(embeddings);
}

/**
 * Convenience function: Get document overview + previews in one call.
 */
export async function getDocumentSummary(
    documentId: number
): Promise<{ overview: DocumentOverview | null; previews: SectionPreview[] }> {
    const retriever = new RLMRetriever();
    const [overview, previews] = await Promise.all([
        retriever.getDocumentOverview(documentId),
        retriever.getDocumentPreviews(documentId, ["summary", "keywords"]),
    ]);
    return { overview, previews };
}

/**
 * Convenience function: Navigate to section and get content within budget.
 */
export async function getStructureContent(
    documentId: number,
    path: string,
    maxTokens: number
): Promise<{ structure: StructureNode | null; sections: SectionWithCost[] }> {
    const retriever = new RLMRetriever();
    const structure = await retriever.getStructureByPath(documentId, path);

    if (!structure) {
        return { structure: null, sections: [] };
    }

    const sections = await retriever.getSectionsByStructure(structure.id);

    // Trim to budget
    let cumulative = 0;
    const trimmed: SectionWithCost[] = [];
    for (const section of sections) {
        if (cumulative + section.tokenCount > maxTokens && trimmed.length > 0) {
            break;
        }
        cumulative += section.tokenCount;
        trimmed.push({ ...section, cumulativeTokens: cumulative });
    }

    return { structure, sections: trimmed };
}
