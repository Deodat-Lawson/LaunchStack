import { sql } from "drizzle-orm";

import type { BackfillContext, BackfillResult } from "@launchstack/store/backfills";
import type { DbClient } from "@launchstack/store/client";

// Exact legacy form only: query strings, fragments, suffixes and trailing slashes stay intact.
const LEGACY_FILE_URL = String.raw`^https?://[^/]+/api/files/([0-9]+)$`;
const RELATIVE_FILE_URL = String.raw`/api/files/\1`;

function rowsOf<T>(result: unknown): T[] {
    // Drizzle drivers return either the row array or its query-result wrapper.
    const wrapped = result as { rows?: T[] };
    return Array.isArray(result) ? (result as T[]) : (wrapped.rows ?? []);
}

function pendingUrls(cursor: BackfillContext["cursor"]) {
    const source =
        cursor && typeof cursor === "object" && !Array.isArray(cursor) ? cursor.source : 0;
    const id = cursor && typeof cursor === "object" && !Array.isArray(cursor) ? cursor.id : "0";
    return sql`
        SELECT source, id FROM (
            SELECT 0 AS source, id FROM pdr_ai_v2_document WHERE url ~ ${LEGACY_FILE_URL}
            UNION ALL
            SELECT 1 AS source, id FROM pdr_ai_v2_document_versions WHERE url ~ ${LEGACY_FILE_URL}
        ) AS pending
        WHERE (source, id) > (${source}, ${id}::bigint)
    `;
}

export async function countLegacyDocumentFileUrls(
    db: DbClient,
    cursor: BackfillContext["cursor"]
): Promise<number> {
    const rows = rowsOf<{ count: number }>(
        await db.execute(
            sql`SELECT count(*)::int AS count FROM (${pendingUrls(cursor)}) AS pending`
        )
    );
    return rows[0]?.count ?? 0;
}

/** A single statement commits each cross-table batch atomically; replay skips normalized URLs. */
export async function normalizeDocumentFileUrls({
    db,
    cursor,
    batchSize,
}: BackfillContext): Promise<BackfillResult> {
    const rows = rowsOf<{ source: number; id: string }>(
        await db.execute(sql`
        WITH pending AS MATERIALIZED (
            ${pendingUrls(cursor)}
            ORDER BY source, id
            LIMIT ${batchSize}
        ), normalized_documents AS (
            UPDATE pdr_ai_v2_document AS d
            SET url = regexp_replace(d.url, ${LEGACY_FILE_URL}, ${RELATIVE_FILE_URL})
            FROM pending AS p
            WHERE p.source = 0 AND d.id = p.id AND d.url ~ ${LEGACY_FILE_URL}
            RETURNING d.id
        ), normalized_versions AS (
            UPDATE pdr_ai_v2_document_versions AS v
            SET url = regexp_replace(v.url, ${LEGACY_FILE_URL}, ${RELATIVE_FILE_URL})
            FROM pending AS p
            WHERE p.source = 1 AND v.id = p.id AND v.url ~ ${LEGACY_FILE_URL}
            RETURNING v.id
        )
        SELECT source, id::text AS id FROM pending ORDER BY source, pending.id
    `)
    );
    const last = rows.at(-1);
    return { cursor: last ? { source: last.source, id: last.id } : null, processed: rows.length };
}
