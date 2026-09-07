/**
 * Citation building for the query path (ADR-005 §3–4).
 *
 * Retrieval rows come in already permission-scoped (the caller resolved the
 * workspace at the boundary); this module turns them into stable, anchored
 * citations. `relevance` is the retrieval score — it is deliberately NOT
 * called confidence: extraction confidence is a provider-reported property
 * of evidence, retrieval relevance is a property of the query.
 */
import {
    anchorKey,
    computeFreshness,
    DEFAULT_FRESHNESS_POLICY,
    type CitationAnchor,
    type FreshnessPolicy,
} from "@launchstack/evidence";

/** A retrieval hit, as produced by the ensemble search adapters. */
export interface RetrievedEvidence {
    sourceId: number;
    sourceVersionId: number;
    chunkId?: number;
    /** 1-based page for paged sources; absent for pageless evidence. */
    page?: number;
    /** Seconds span for transcript evidence. */
    startSeconds?: number;
    endSeconds?: number;
    /** Verbatim excerpt the citation quotes. */
    content: string;
    documentTitle?: string;
    /** Retrieval score in [0,1] when the retriever provides one. */
    relevance?: number;
}

/** What the caller knows about each cited source version. */
export interface SourceVersionInfo {
    sourceVersionId: number;
    /** ISO timestamp the version was created/uploaded. */
    createdAt: string;
}

export interface Citation {
    anchor: CitationAnchor;
    /** Stable key — safe to store and to render as a citation reference. */
    anchorKey: string;
    quote: string;
    documentTitle?: string;
    relevance?: number;
    freshness?: "fresh" | "aging" | "stale";
}

const MAX_QUOTE_CHARS = 300;

function spanFor(hit: RetrievedEvidence): CitationAnchor["span"] {
    if (hit.startSeconds !== undefined && hit.endSeconds !== undefined) {
        return {
            kind: "time",
            startSeconds: hit.startSeconds,
            endSeconds: hit.endSeconds,
        };
    }
    if (hit.page !== undefined && hit.page > 0) {
        return { kind: "page", page: hit.page };
    }
    // Pageless evidence anchors at the document level: page 1 by convention,
    // which parseAnchorKey round-trips and the UI renders without a page label.
    return { kind: "page", page: 1 };
}

/**
 * Build citations for a set of retrieval hits. Deduplicates by anchor key
 * (two hits on the same page of the same version merge, keeping the higher
 * relevance), orders by relevance descending then anchor key for
 * determinism.
 */
export function buildCitations(
    hits: RetrievedEvidence[],
    versions: SourceVersionInfo[],
    opts: { now: string; freshnessPolicy?: FreshnessPolicy }
): Citation[] {
    const policy = opts.freshnessPolicy ?? DEFAULT_FRESHNESS_POLICY;
    const versionById = new Map(versions.map(v => [v.sourceVersionId, v]));

    const byKey = new Map<string, Citation>();
    for (const hit of hits) {
        const anchor: CitationAnchor = {
            sourceId: hit.sourceId,
            sourceVersionId: hit.sourceVersionId,
            span: spanFor(hit),
            chunkId: hit.chunkId,
            quote: hit.content.slice(0, MAX_QUOTE_CHARS),
        };
        const key = anchorKey(anchor);
        const version = versionById.get(hit.sourceVersionId);
        const citation: Citation = {
            anchor,
            anchorKey: key,
            quote: anchor.quote ?? "",
            documentTitle: hit.documentTitle,
            relevance: hit.relevance,
            freshness: version ? computeFreshness(version.createdAt, opts.now, policy) : undefined,
        };
        const existing = byKey.get(key);
        if (!existing || (citation.relevance ?? -1) > (existing.relevance ?? -1)) {
            byKey.set(key, citation);
        }
    }

    return [...byKey.values()].sort((a, b) => {
        const rel = (b.relevance ?? -1) - (a.relevance ?? -1);
        if (rel !== 0) return rel;
        return a.anchorKey.localeCompare(b.anchorKey);
    });
}
