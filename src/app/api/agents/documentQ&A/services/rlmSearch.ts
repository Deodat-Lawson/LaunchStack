/**
 * RLM Search Service
 *
 * Provides hierarchical, cost-aware document retrieval for Recursive Language Model (RLM)
 * style inference. Unlike traditional RAG which stuffs chunks into context, RLM search:
 *
 * 1. First gets document overview (cheap metadata for planning)
 * 2. Retrieves sections within a token budget
 * 3. Supports semantic filtering by content type
 * 4. Enables hierarchical navigation of document structure
 *
 * Use this for large documents or complex analysis requiring cost-aware retrieval.
 * For simple queries, use the standard ensemble search (AIQuery).
 */

import {
    createRLMRetriever,
    type DocumentOverview,
    type SectionWithCost,
    type SectionPreview,
    type TokenBudgetOptions,
} from "~/lib/tools/rag/retrievers";
import { getEmbeddings } from "./models";
import { getCompanyEmbeddingConfig } from "~/lib/ai/embedding-factory";
import type { CompanyEmbeddingConfig } from "~/lib/ai/embedding-config";
import type { SemanticType, PreviewType } from "~/server/db/schema";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for RLM-based document search
 */
export interface RLMSearchOptions {
    /** Maximum tokens to retrieve (default: 4000) */
    maxTokens?: number;
    /** Include document overview in results (default: true) */
    includeOverview?: boolean;
    /** Include section previews (default: false) */
    includePreviews?: boolean;
    /** Filter sections by semantic type */
    semanticTypes?: SemanticType[];
    /** Prioritize sections from start, end, or by relevance */
    prioritize?: "start" | "end" | "relevance";
    /** Filter by page range */
    pageRange?: { start: number; end: number };
    /** Preview types to include if includePreviews is true */
    previewTypes?: PreviewType[];
    /** Company embedding config for query embedding generation */
    embeddingConfig?: CompanyEmbeddingConfig | null;
}

/**
 * Result from RLM search operation
 */
export interface RLMSearchResult {
    /** Retrieved sections with token cost information */
    sections: SectionWithCost[];
    /** Document overview (if includeOverview is true) */
    overview: DocumentOverview | null;
    /** Section previews (if includePreviews is true) */
    previews: SectionPreview[];
    /** Total tokens used across all sections */
    totalTokensUsed: number;
    /** Combined content string for LLM context */
    combinedContent: string;
    /** Whether the search used semantic search */
    usedSemanticSearch: boolean;
    /** Token budget that was specified */
    tokenBudget: number;
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Perform RLM-style hierarchical search on a document
 *
 * This function implements the RLM access pattern:
 * 1. Get document overview for context (if enabled)
 * 2. Retrieve sections within token budget
 * 3. Optionally filter by semantic type
 * 4. Return combined content with metadata
 *
 * @param documentId - The document to search
 * @param query - The user's question (used for semantic search if prioritize="relevance")
 * @param options - Search configuration options
 * @returns RLM search result with sections, overview, and metadata
 */
export async function performRLMSearch(
    documentId: number,
    query: string,
    options: RLMSearchOptions = {}
): Promise<RLMSearchResult> {
    const {
        maxTokens = 4000,
        includeOverview = true,
        includePreviews = false,
        semanticTypes,
        prioritize = "relevance",
        pageRange,
        previewTypes = ["summary", "keywords"],
    } = options;

    console.log(`🔍 [RLM Search] Starting search for document ${documentId}`);
    console.log(`   Token budget: ${maxTokens}, Prioritize: ${prioritize}`);

    // Create retriever with embeddings if we need semantic search
    const needsEmbeddings = prioritize === "relevance";
    const embeddings = needsEmbeddings ? getEmbeddings(options.embeddingConfig) : undefined;
    const retriever = createRLMRetriever(embeddings);

    // Fetch overview and previews in parallel if needed
    const [overview, previews] = await Promise.all([
        includeOverview ? retriever.getDocumentOverview(documentId) : Promise.resolve(null),
        includePreviews
            ? retriever.getDocumentPreviews(documentId, previewTypes)
            : Promise.resolve([]),
    ]);

    if (overview) {
        console.log(`   Document: "${overview.title}" (${overview.totalTokens} tokens, ${overview.totalSections} sections)`);
    }

    // Retrieve sections based on prioritization strategy
    let sections: SectionWithCost[];
    let usedSemanticSearch = false;

    if (prioritize === "relevance" && embeddings) {
        // Use semantic search for relevance-based retrieval
        console.log(`   Using semantic search for relevance-based retrieval`);
        sections = await retriever.semanticSearch(documentId, query, {
            topK: 20, // Get more candidates for budget filtering
            maxTokens,
        });
        usedSemanticSearch = true;
    } else {
        // Use budget-based retrieval with ordering
        const budgetOptions: TokenBudgetOptions = {
            maxTokens,
            prioritize: prioritize === "relevance" ? "start" : prioritize,
            semanticTypes,
            pageRange,
        };
        sections = await retriever.getSectionsWithinBudget(documentId, budgetOptions);
    }

    // Calculate total tokens used
    const totalTokensUsed = sections.length > 0
        ? sections[sections.length - 1]!.cumulativeTokens
        : 0;

    console.log(`✅ [RLM Search] Retrieved ${sections.length} sections (${totalTokensUsed} tokens)`);

    // Build combined content string for LLM context
    const combinedContent = buildCombinedContent(sections, overview, previews);

    return {
        sections,
        overview,
        previews,
        totalTokensUsed,
        combinedContent,
        usedSemanticSearch,
        tokenBudget: maxTokens,
    };
}

/**
 * Build combined content string from sections and metadata
 * Formats content in a way that's optimal for LLM consumption
 */
function buildCombinedContent(
    sections: SectionWithCost[],
    overview: DocumentOverview | null,
    previews: SectionPreview[]
): string {
    const parts: string[] = [];

    // Add document overview if available
    if (overview) {
        parts.push("=== DOCUMENT OVERVIEW ===");
        parts.push(`Title: ${overview.title}`);
        parts.push(`Total Pages: ${overview.totalPages}`);
        parts.push(`Total Tokens: ${overview.totalTokens}`);

        if (overview.summary) {
            parts.push(`\nSummary: ${overview.summary}`);
        }

        if (overview.topicTags.length > 0) {
            parts.push(`Topics: ${overview.topicTags.join(", ")}`);
        }

        if (overview.documentClass) {
            parts.push(`Document Type: ${overview.documentClass}`);
        }

        parts.push("");
    }

    // Add previews if available
    if (previews.length > 0) {
        const keywordPreview = previews.find(p => p.previewType === "keywords");
        if (keywordPreview) {
            parts.push(`Key Terms: ${keywordPreview.content}`);
            parts.push("");
        }
    }

    // Add sections with metadata
    if (sections.length > 0) {
        parts.push("=== RELEVANT CONTENT ===");

        sections.forEach((section, idx) => {
            const pageInfo = section.pageNumber !== null ? `Page ${section.pageNumber}` : "Unknown page";
            const typeInfo = section.semanticType ? ` (${section.semanticType})` : "";
            const pathInfo = section.structurePath ? ` [${section.structurePath}]` : "";

            parts.push(`\n--- Section ${idx + 1}: ${pageInfo}${typeInfo}${pathInfo} ---`);
            parts.push(section.content);
        });
    }

    return parts.join("\n");
}

/**
 * Get document overview for planning purposes
 * This is a lightweight call that returns metadata without content
 */
export async function getDocumentOverviewForPlanning(
    documentId: number
): Promise<DocumentOverview | null> {
    const retriever = createRLMRetriever();
    return retriever.getDocumentOverview(documentId);
}

/**
 * Get multiple document overviews for batch planning
 */
export async function getDocumentOverviewsBatch(
    documentIds: number[]
): Promise<DocumentOverview[]> {
    const retriever = createRLMRetriever();
    return retriever.getDocumentOverviews(documentIds);
}

/**
 * Navigate document structure tree
 * Returns hierarchical structure for drilling down into specific sections
 */
export async function getDocumentStructureTree(
    documentId: number,
    maxDepth = 2
) {
    const retriever = createRLMRetriever();
    return retriever.getDocumentTree(documentId, maxDepth);
}

/**
 * Get sections by structure path
 * Useful for drilling down into specific parts of a document
 */
export async function getSectionsByPath(
    documentId: number,
    path: string,
    maxTokens: number
) {
    const retriever = createRLMRetriever();
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
