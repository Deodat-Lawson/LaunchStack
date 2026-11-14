import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import type { WeeklyReviewAuthorityActor } from "./weekly-review-authority";
import { WeeklyReviewConflict, type WeeklyReviewQuery } from "./weekly-review-types";

export type InternalEvidenceSearchCandidate = {
    id: string;
    version: string;
    title: string;
    category: string;
    availableAt: string | Date;
    matchedQueryIndexes: number[];
};
export type InternalEvidenceSearchResult = {
    candidates: InternalEvidenceSearchCandidate[];
    deniedCount: number;
    scanLimit: 64;
    returnedLimit: number;
    queryCount: number;
};
export type InternalEvidenceSearchOptions = Readonly<{
    queries: readonly string[];
    excludeIds: readonly string[];
    limit?: number;
}>;

const searchSql = `
WITH eligible AS MATERIALIZED (
    SELECT d.id,
           CASE WHEN octet_length(d.title)<=1024 THEN d.title ELSE NULL END AS title,
           d.category,v.id AS version_id,v.created_at AS available_at
    FROM pdr_ai_v2_document d
    JOIN LATERAL (
        SELECT id,created_at FROM pdr_ai_v2_document_versions
        WHERE document_id=d.id AND created_at<=$2::timestamptz
        ORDER BY created_at DESC,id DESC LIMIT 1
    ) v ON true
    WHERE d.company_id=$1::bigint AND NOT(d.id=ANY($3::bigint[]))
    ORDER BY v.created_at DESC,v.id DESC,d.id DESC
    LIMIT 64
), bounded_chunks AS MATERIALIZED (
    SELECT e.id,
           CASE WHEN octet_length(c.content)<=24000 THEN lower(c.content) ELSE '' END AS searchable
    FROM eligible e
    CROSS JOIN LATERAL (
        SELECT content FROM pdr_ai_v2_document_context_chunks
        WHERE document_id=e.id AND version_id=e.version_id
        ORDER BY page_number,line_start,id LIMIT 129
    ) c
), query_terms AS MATERIALIZED (
    SELECT (q.ordinality-1)::integer AS query_index,t.term
    FROM jsonb_array_elements($4::text::jsonb) WITH ORDINALITY q(terms,ordinality)
    CROSS JOIN LATERAL jsonb_array_elements_text(q.terms) t(term)
)
SELECT e.id,e.version_id,e.title,e.category,e.available_at,
       ARRAY(
           SELECT DISTINCT qt.query_index FROM query_terms qt
           WHERE strpos(lower(COALESCE(e.title,'')),qt.term)>0
              OR EXISTS (
                  SELECT 1 FROM bounded_chunks c
                  WHERE c.id=e.id AND strpos(c.searchable,qt.term)>0
              )
           ORDER BY qt.query_index
       ) AS matched_query_indexes
FROM eligible e
ORDER BY e.available_at DESC,e.version_id DESC,e.id DESC
`;

function cancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new WeeklyReviewConflict("retrieval_acquisition_cancelled", 503);
}

/**
 * Pure lexical SQL discovery within the caller's transaction and shared bounded query wrapper.
 * Results require the collector's exact-version read, purpose check and budget admission.
 */
export async function searchInternalEvidence(
    query: WeeklyReviewQuery,
    actor: WeeklyReviewAuthorityActor,
    cutoff: string,
    options: InternalEvidenceSearchOptions,
    signal?: AbortSignal
): Promise<InternalEvidenceSearchResult> {
    cancelled(signal);
    const limit = options.limit ?? 16;
    if (
        !Number.isInteger(limit) ||
        limit < 0 ||
        limit > 16 ||
        typeof cutoff !== "string" ||
        cutoff.length > 64 ||
        !Number.isFinite(Date.parse(cutoff)) ||
        !Array.isArray(options.queries as unknown) ||
        options.queries.length > 2 ||
        options.queries.some(value => typeof value !== "string" || value.length > 160) ||
        !Array.isArray(options.excludeIds) ||
        options.excludeIds.length > 128 ||
        options.excludeIds.some(
            value =>
                typeof value !== "string" ||
                !/^[1-9]\d{0,18}$/.test(value) ||
                BigInt(value) > 9223372036854775807n
        )
    )
        throw new WeeklyReviewConflict("invalid_internal_search");

    // Parameters contain only bounded literal tokens. SQL never interprets source text as syntax.
    const terms = options.queries.map(value =>
        [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,39}/g) ?? [])].slice(0, 8)
    );
    const queryCount = terms.filter(values => values.length).length;
    const result: InternalEvidenceSearchResult = {
        candidates: [],
        deniedCount: 0,
        scanLimit: 64,
        returnedLimit: limit,
        queryCount,
    };
    if (!queryCount || !limit) return result;
    const rows = await query(searchSql, [
        actor.companyId,
        cutoff,
        [...new Set(options.excludeIds)],
        JSON.stringify(terms),
    ]);
    cancelled(signal);
    if (rows.length > 64) throw new WeeklyReviewConflict("source_context_unavailable");
    for (const row of rows) {
        const id = String(row.id);
        if (row.category != null && typeof row.category !== "string")
            throw new WeeklyReviewConflict("source_context_unavailable");
        const category = typeof row.category === "string" ? row.category : "";
        if (!scopeAllowsDocument(actor.documentScope, { id: Number(id), category })) {
            result.deniedCount += 1;
            continue;
        }
        const indexes = row.matched_query_indexes as unknown[];
        if (
            !Array.isArray(indexes as unknown) ||
            indexes.some(
                index =>
                    typeof index !== "number" ||
                    !Number.isInteger(index) ||
                    index < 0 ||
                    index >= options.queries.length
            )
        )
            throw new WeeklyReviewConflict("source_context_unavailable");
        if (!indexes.length || row.title == null || result.candidates.length >= limit) continue;
        if (
            typeof row.title !== "string" ||
            (typeof row.available_at !== "string" && !(row.available_at instanceof Date))
        )
            throw new WeeklyReviewConflict("source_context_unavailable");
        result.candidates.push({
            id,
            version: String(row.version_id),
            title: row.title,
            category,
            availableAt: row.available_at,
            matchedQueryIndexes: [...new Set(indexes.map(Number))],
        });
    }
    return result;
}
