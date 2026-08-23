/**
 * grounded-retrieval — company-scoped RAG retrieval with named policies.
 *
 * One implementation of the retrieve → clean → cap pipeline that marketing's
 * stage modules each hand-rolled (weights [0.4, 0.6] was previously repeated
 * verbatim at six call sites with three different failure behaviors).
 *
 * Failure policy is declared per call, never implicit:
 *   - "throw": retrieval errors (including an unregistered RAG port)
 *     propagate to the caller, which owns what a failure means.
 *   - "empty": errors degrade to zero snippets; the swallowed error is logged
 *     so operators can still see it. Use only where the caller has decided
 *     that thin context is better than no result.
 */

import { getRag, type CompanySearchOptions, type RagSearchResult } from "@launchstack/core/rag";

export interface SnippetPolicy {
    topK: number;
    weights: [number, number];
    maxSnippets: number;
    maxSnippetChars: number;
}

/**
 * Named policies freeze the constants the marketing pipeline used per call
 * site at extraction time (design tenet: consolidation never changes values).
 */
export const SNIPPET_POLICIES = {
    /** KB context, brand voice, persona (topK 6, 400-char snippets). */
    standard: { topK: 6, weights: [0.4, 0.6], maxSnippets: 6, maxSnippetChars: 400 },
    /** CompanyDNA RAG fallback (topK 4, 320-char snippets). */
    compact: { topK: 4, weights: [0.4, 0.6], maxSnippets: 4, maxSnippetChars: 320 },
    /** Per-claim source lookup (topK 2, 200-char snippets). */
    pinpoint: { topK: 2, weights: [0.4, 0.6], maxSnippets: 2, maxSnippetChars: 200 },
} satisfies Record<string, SnippetPolicy>;

export type RetrievalErrorPolicy = "throw" | "empty";

export interface RetrieveCompanySnippetsArgs {
    companyId: number;
    query: string;
    policy: SnippetPolicy;
    /** What a retrieval error means here. Required thinking, defaulted to "throw". */
    onError?: RetrievalErrorPolicy;
}

export interface RetrievedSnippets {
    /** Cleaned snippet texts (trimmed, whitespace-collapsed, char-capped). */
    snippets: string[];
    /** The raw results, for callers that need scores or metadata. */
    results: RagSearchResult[];
}

export function cleanSnippet(text: string, maxChars: number): string {
    return text.trim().replace(/\s+/g, " ").slice(0, maxChars);
}

export async function retrieveCompanySnippets(
    args: RetrieveCompanySnippetsArgs
): Promise<RetrievedSnippets> {
    const { companyId, query, policy, onError = "throw" } = args;
    const options: CompanySearchOptions = {
        companyId,
        topK: policy.topK,
        weights: policy.weights,
    };

    let results: RagSearchResult[];
    try {
        results = await getRag().companyEnsembleSearch(query, options);
    } catch (error) {
        if (onError === "throw") throw error;
        console.warn("[tools/grounded-retrieval] retrieval failed (policy: empty):", error);
        return { snippets: [], results: [] };
    }

    const snippets = results
        .slice(0, policy.maxSnippets)
        .map(r => cleanSnippet(r.pageContent, policy.maxSnippetChars))
        .filter(Boolean);

    return { snippets, results };
}

/** Number snippets into a prompt block: "1. …\n\n2. …", or the empty text. */
export function formatSnippetBlock(snippets: string[], emptyText: string): string {
    if (snippets.length === 0) return emptyText;
    return snippets.map((s, i) => `${i + 1}. ${s}`).join("\n\n");
}
