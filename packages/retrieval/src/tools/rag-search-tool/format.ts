import type { SearchResult } from "../../search-types";

/**
 * Group retrieval hits by document and render them as prompt context, page
 * markers included. Titles resolve from the caller's map first, then hit
 * metadata, then a plain "Document N" fallback.
 */
export function formatResultsForPrompt(
    results: SearchResult[],
    documentTitles?: Map<number, string>
): string {
    if (results.length === 0) {
        return "";
    }

    const byDocument = new Map<number, SearchResult[]>();
    for (const result of results) {
        const docId = result.metadata.documentId;
        if (docId !== undefined) {
            if (!byDocument.has(docId)) {
                byDocument.set(docId, []);
            }
            byDocument.get(docId)!.push(result);
        }
    }

    const sections: string[] = [];

    for (const [docId, docResults] of byDocument.entries()) {
        const title =
            documentTitles?.get(docId) ??
            docResults[0]?.metadata.documentTitle ??
            `Document ${docId}`;

        docResults.sort((a, b) => (a.metadata.page ?? 0) - (b.metadata.page ?? 0));

        const content = docResults
            .map(r => {
                const pageInfo = r.metadata.page ? `[Page ${r.metadata.page}]` : "";
                return `${pageInfo}\n${r.pageContent}`;
            })
            .join("\n\n");

        sections.push(`--- ${title} ---\n${content}`);
    }

    return sections.join("\n\n");
}
