import type { SearchResult } from "~/lib/tools/rag";
import type { SourceReference } from "./types";

const STOPWORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for",
    "from", "how", "i", "in", "is", "it", "of", "on", "or", "that",
    "the", "their", "this", "to", "was", "we", "what", "when", "where",
    "which", "who", "why", "with", "you", "your",
]);

function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function getQuestionKeywords(question: string): string[] {
    const words = question
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2 && !STOPWORDS.has(word));

    return Array.from(new Set(words)).slice(0, 12);
}

function getPageValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value > 0
        ? value
        : undefined;
}

function extractSnippet(text: string, question: string): {
    snippet: string;
    matchText?: string;
    matchStart?: number;
    matchEnd?: number;
    confidence: number;
} {
    const normalizedText = normalizeWhitespace(text);
    if (!normalizedText) {
        return { snippet: "", confidence: 0 };
    }

    const maxSnippetLength = 240;
    const keywords = getQuestionKeywords(question).sort((a, b) => b.length - a.length);
    const haystack = normalizedText.toLowerCase();

    let bestIndex = -1;
    for (const keyword of keywords) {
        const idx = haystack.indexOf(keyword);
        if (idx >= 0) {
            bestIndex = idx;
            break;
        }
    }

    if (bestIndex < 0) {
        const snippet = normalizedText.slice(0, maxSnippetLength).trimEnd();
        return { snippet, confidence: 0.25 };
    }

    const left = Math.max(0, bestIndex - 110);
    const right = Math.min(normalizedText.length, left + maxSnippetLength);
    const rawSnippet = normalizedText.slice(left, right).trim();

    const prefix = left > 0 ? "... " : "";
    const suffix = right < normalizedText.length ? " ..." : "";
    const bestKeyword = keywords.find((keyword) => haystack.indexOf(keyword) === bestIndex);
    return {
        snippet: `${prefix}${rawSnippet}${suffix}`,
        matchText: bestKeyword,
        matchStart: bestIndex,
        matchEnd: bestKeyword ? bestIndex + bestKeyword.length : undefined,
        confidence: 0.8,
    };
}

export function extractRecommendedPages(documents: SearchResult[]): number[] {
    const pages = documents
        .map((doc) => getPageValue(doc.metadata?.page))
        .filter((page): page is number => page !== undefined);

    if (pages.length > 1 && pages.every((page) => page === 1)) {
        // Legacy fallback data often pins everything to page 1; hide misleading values.
        return [];
    }

    return Array.from(new Set(pages)).sort((a, b) => a - b);
}

/**
 * Filters a list of candidate page numbers to only those explicitly cited in
 * the AI's response text.
 *
 * The AI receives context chunks labelled "Page N", so it naturally produces
 * phrases like "according to page 3" or "(pages 4–6)". This function extracts
 * those references and returns only the pages the model actually used,
 * addressing the behaviour reported in issue #90 where all retrieved pages
 * were surfaced regardless of whether the AI mentioned them.
 *
 * Falls back to returning all `candidatePages` unchanged when:
 * - No page references are found in the response (model answered without
 *   explicit citations — preserve backward-compatible behaviour).
 * - Every cited page falls outside the candidate set (e.g. the model
 *   hallucinated a page number — avoid returning an empty list).
 */
export function filterPagesByAICitation(
    aiResponse: string,
    candidatePages: number[]
): number[] {
    if (candidatePages.length === 0) return [];

    const cited = new Set<number>();

    // Matches "page 5", "pages 5-7", "pages 5–7", "p. 5", "(page 5)", etc.
    // The optional range group captures constructs like "pages 4-6".
    const pagePattern = /\bpages?\s*\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?/gi;
    let match: RegExpExecArray | null;

    while ((match = pagePattern.exec(aiResponse)) !== null) {
        const start = Number.parseInt(match[1]!, 10);
        const end = match[2] !== undefined ? Number.parseInt(match[2], 10) : start;
        for (let p = start; p <= Math.min(end, start + 50); p++) {
            cited.add(p);
        }
    }

    if (cited.size === 0) {
        return candidatePages;
    }

    const filtered = candidatePages.filter((p) => cited.has(p));
    return filtered.length > 0 ? filtered : candidatePages;
}

export function buildReferences(
    question: string,
    documents: SearchResult[],
    maxReferences = 5
): SourceReference[] {
    const dedup = new Set<string>();
    const references: SourceReference[] = [];

    for (const doc of documents) {
        if (references.length >= maxReferences) {
            break;
        }

        const metadata = (doc.metadata ?? {}) as unknown as Record<string, unknown>;
        const childContent = typeof metadata.childContent === "string" ? metadata.childContent : "";
        const snippetResult = extractSnippet(childContent || doc.pageContent, question);
        if (!snippetResult.snippet) {
            continue;
        }

        const page = getPageValue(metadata.page);
        const reference: SourceReference = {
            page,
            snippet: snippetResult.snippet,
            matchText: snippetResult.matchText,
            matchStart: snippetResult.matchStart,
            matchEnd: snippetResult.matchEnd,
            confidence: snippetResult.confidence,
            documentId: typeof metadata.documentId === "number" ? metadata.documentId : undefined,
            documentTitle: typeof metadata.documentTitle === "string" ? metadata.documentTitle : undefined,
            chunkId: typeof metadata.chunkId === "number" ? metadata.chunkId : undefined,
            source: typeof metadata.source === "string" ? metadata.source : undefined,
        };

        const docId = reference.documentId ?? "unknown";
        const pageVal = reference.page ?? "unknown";
        const dedupKey = `${docId}|${pageVal}|${reference.snippet}`;
        if (dedup.has(dedupKey)) {
            continue;
        }
        dedup.add(dedupKey);
        references.push(reference);
    }

    return references;
}
