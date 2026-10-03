/**
 * Evidence numbering — retrieval results become the numbered list a fact
 * or a draft cites. Pure: no database, no model.
 */
import type { RagSearchResult } from "@launchstack/retrieval";

import type { Evidence } from "./types";

const MAX_QUOTE = 700;

function cleanQuote(text: string, max = MAX_QUOTE): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function documentIdOf(result: RagSearchResult): number | null {
    const raw = result.metadata.documentId ?? result.documentId;
    if (raw === undefined || raw === null) return null;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isInteger(n) ? n : null;
}

/**
 * Number retrieval results from `start`, dropping empties and duplicates
 * (same document, same page, same opening words). Order is retrieval order,
 * which is relevance order, so the first numbers are the strongest.
 */
export function numberEvidence(results: RagSearchResult[], start = 1): Evidence[] {
    const seen = new Set<string>();
    const out: Evidence[] = [];
    for (const result of results) {
        const quote = cleanQuote(result.pageContent ?? "");
        if (!quote) continue;
        const documentId = documentIdOf(result);
        const page = result.metadata.page ?? result.pageNumber ?? null;
        const key = `${documentId ?? "?"}|${page ?? "?"}|${quote.slice(0, 80).toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            n: start + out.length,
            documentId,
            title: result.metadata.documentTitle ?? result.title ?? "Untitled source",
            page: typeof page === "number" ? page : null,
            quote,
            url: null,
        });
    }
    return out;
}

/** The numbered block a prompt reads: "[1] Title (p. 3): quote". */
export function formatEvidenceBlock(evidence: Evidence[], emptyText: string): string {
    if (evidence.length === 0) return emptyText;
    return evidence
        .map(e => `[${e.n}] ${e.title}${e.page ? ` (p. ${e.page})` : ""}: ${e.quote}`)
        .join("\n\n");
}

/** Keep only citations that name an evidence number that exists, once each, in order. */
export function validCites(cites: number[], evidence: Evidence[]): number[] {
    const known = new Set(evidence.map(e => e.n));
    return [...new Set(cites.filter(n => Number.isInteger(n) && known.has(n)))].sort(
        (a, b) => a - b
    );
}

/** Distinct documents behind a set of evidence. */
export function documentCount(evidence: Evidence[]): number {
    return new Set(evidence.map(e => e.documentId ?? `t:${e.title}`)).size;
}
