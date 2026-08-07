/**
 * Repair legacy document lifecycle rows in place.
 *
 * The repair is intentionally idempotent. It never redispatches work or
 * touches storage: it only makes the document/version/job graph and RLM
 * version links complete enough for the version-aware readers.
 *
 * Run with:
 *   pnpm tsx scripts/backfill-document-versions.ts
 */

import "dotenv/config";
import { sql } from "drizzle-orm";

import { db } from "../src/server/db";

type QueryResult = {
    count?: number;
    rowCount?: number;
    rows?: Array<Record<string, unknown>>;
};

function resultCount(result: unknown): number {
    const queryResult = result as QueryResult;
    const rows = Array.isArray(result)
        ? (result as Array<Record<string, unknown>>)
        : queryResult.rows;
    const count = rows?.[0]?.count;
    return count === undefined
        ? Number(queryResult.count ?? queryResult.rowCount ?? 0)
        : Number(count);
}

export async function backfill() {
    console.log("[backfill-document-versions] Starting...");

    await db.transaction(async tx => {
        // Create v1 for every document that does not have one. Existing
        // versions are never replaced; their highest MIME is only used to
        // seed the synthetic v1 when the document has no MIME metadata.
        const insertResult = await tx.execute(sql`
            INSERT INTO pdr_ai_v2_document_versions (
                document_id,
                version_number,
                url,
                mime_type,
                uploaded_by,
                ocr_job_id,
                ocr_processed,
                ocr_metadata,
                created_at
            )
            SELECT
                d.id,
                1,
                d.url,
                COALESCE(
                    NULLIF(BTRIM(d.mime_type), ''),
                    NULLIF(BTRIM(d.file_type), ''),
                    (
                        SELECT NULLIF(BTRIM(v.mime_type), '')
                        FROM pdr_ai_v2_document_versions AS v
                        WHERE v.document_id = d.id
                        ORDER BY v.version_number DESC, v.id DESC
                        LIMIT 1
                    ),
                    'application/octet-stream'
                ),
                NULL,
                NULL,
                COALESCE(d.ocr_processed, FALSE),
                d.ocr_metadata,
                d.created_at
            FROM pdr_ai_v2_document AS d
            WHERE NOT EXISTS (
                SELECT 1
                FROM pdr_ai_v2_document_versions AS v
                WHERE v.document_id = d.id
                  AND v.version_number = 1
            )
            ON CONFLICT (document_id, version_number) DO NOTHING
        `);
        console.log(`[backfill-document-versions] Created v1 rows: ${resultCount(insertResult)}`);

        // Keep a valid current pointer. A pointer to another document is not
        // valid and is repaired just like a NULL pointer. The highest version
        // is the deterministic fallback; v1 above guarantees a final choice.
        const pointerResult = await tx.execute(sql`
            WITH selected_versions AS (
                SELECT
                    d.id AS document_id,
                    d.current_version_id AS observed_current_version_id,
                    COALESCE(current_version.id, highest_version.id) AS version_id
                FROM pdr_ai_v2_document AS d
                LEFT JOIN pdr_ai_v2_document_versions AS current_version
                    ON current_version.id = d.current_version_id
                   AND current_version.document_id = d.id
                LEFT JOIN LATERAL (
                    SELECT v.id
                    FROM pdr_ai_v2_document_versions AS v
                    WHERE v.document_id = d.id
                    ORDER BY v.version_number DESC, v.id DESC
                    LIMIT 1
                ) AS highest_version ON TRUE
            )
            UPDATE pdr_ai_v2_document AS d
            SET current_version_id = selected.version_id,
                mime_type = COALESCE(
                    NULLIF(BTRIM(d.mime_type), ''),
                    NULLIF(BTRIM(d.file_type), ''),
                    NULLIF(BTRIM(selected_version.mime_type), ''),
                    'application/octet-stream'
                ),
                file_type = COALESCE(
                    NULLIF(BTRIM(d.file_type), ''),
                    NULLIF(BTRIM(d.mime_type), ''),
                    NULLIF(BTRIM(selected_version.mime_type), ''),
                    'application/octet-stream'
                )
            FROM selected_versions AS selected
            LEFT JOIN pdr_ai_v2_document_versions AS selected_version
                ON selected_version.id = selected.version_id
               AND selected_version.document_id = selected.document_id
            WHERE d.id = selected.document_id
              AND d.current_version_id IS NOT DISTINCT FROM selected.observed_current_version_id
              AND (
                  d.current_version_id IS DISTINCT FROM selected.version_id
                  OR NULLIF(BTRIM(d.mime_type), '') IS NULL
                  OR NULLIF(BTRIM(d.file_type), '') IS NULL
              )
        `);
        console.log(
            `[backfill-document-versions] Repaired document pointers/metadata: ${resultCount(pointerResult)}`
        );

        // Version MIME is required by the lifecycle contract. Preserve a
        // non-empty value and only fill missing legacy values.
        const versionMimeResult = await tx.execute(sql`
            UPDATE pdr_ai_v2_document_versions AS v
            SET mime_type = COALESCE(
                NULLIF(BTRIM(v.mime_type), ''),
                NULLIF(BTRIM(d.mime_type), ''),
                NULLIF(BTRIM(d.file_type), ''),
                'application/octet-stream'
            )
            FROM pdr_ai_v2_document AS d
            WHERE d.id = v.document_id
              AND NULLIF(BTRIM(v.mime_type), '') IS NULL
        `);
        console.log(
            `[backfill-document-versions] Normalized version MIME: ${resultCount(versionMimeResult)}`
        );

        const unresolvedDocuments = await tx.execute(sql`
            SELECT COUNT(*)::int AS count
            FROM pdr_ai_v2_document AS d
            LEFT JOIN pdr_ai_v2_document_versions AS v
                ON v.id = d.current_version_id
               AND v.document_id = d.id
            WHERE v.id IS NULL
        `);
        const unresolvedDocumentCount = resultCount(unresolvedDocuments);
        if (unresolvedDocumentCount > 0) {
            console.warn(
                `[backfill-document-versions] Unresolved current document versions: ${unresolvedDocumentCount}`
            );
        }
        const rlmUnresolvedCounts: Record<string, number> = {};
        let unresolvedRlmCount = 0;

        const rlmTables = [
            "pdr_ai_v2_document_structure",
            "pdr_ai_v2_document_context_chunks",
            "pdr_ai_v2_document_retrieval_chunks",
            "pdr_ai_v2_document_metadata",
            "pdr_ai_v2_document_previews",
        ] as const;
        // Legacy RLM rows without a version belong to document v1. Never use
        // current_version_id here: a current v2 must not relabel legacy data.

        for (const table of rlmTables) {
            const result = await tx.execute(sql`
                UPDATE ${sql.raw(table)} AS t
                SET version_id = v.id
                FROM pdr_ai_v2_document AS d
                INNER JOIN pdr_ai_v2_document_versions AS v
                    ON v.document_id = d.id
                   AND v.version_number = 1
                WHERE t.document_id = d.id
                  AND t.version_id IS NULL
            `);
            const unresolved = await tx.execute(sql`
                SELECT COUNT(*)::int AS count
                FROM ${sql.raw(table)} AS t
                WHERE t.version_id IS NULL
                   OR NOT EXISTS (
                       SELECT 1
                       FROM pdr_ai_v2_document_versions AS v
                       WHERE v.id = t.version_id
                         AND v.document_id = t.document_id
                   )
            `);
            const unresolvedCount = resultCount(unresolved);
            rlmUnresolvedCounts[table] = unresolvedCount;
            unresolvedRlmCount += unresolvedCount;

            console.log(
                `[backfill-document-versions] ${table}: updated ${resultCount(result)} rows; unresolved ${unresolvedCount}`
            );
            if (unresolvedCount > 0) {
                console.warn(
                    `[backfill-document-versions] ${table} has ${unresolvedCount} rows without a derivable version`
                );
            }
        }

        // The document-level OCR job is the only reliable current-job signal.
        // Use the repaired current pointer for its version link. Duplicate
        // legacy job IDs are left untouched and reported rather than guessed.
        const documentJobResult = await tx.execute(sql`
            WITH document_matches AS (
                SELECT
                    d.ocr_job_id AS job_id,
                    MIN(d.id) AS document_id,
                    MIN(d.current_version_id) AS version_id
                FROM pdr_ai_v2_document AS d
                LEFT JOIN pdr_ai_v2_document_versions AS v
                    ON v.id = d.current_version_id
                   AND v.document_id = d.id
                WHERE d.ocr_job_id IS NOT NULL
                GROUP BY d.ocr_job_id
                HAVING COUNT(*) = 1
                   AND COUNT(v.id) = 1
            )
            UPDATE pdr_ai_v2_ocr_jobs AS j
            SET document_id = matches.document_id,
                version_id = matches.version_id
            FROM document_matches AS matches
            WHERE j.id = matches.job_id
              AND (
                  j.document_id IS DISTINCT FROM matches.document_id
                  OR j.version_id IS DISTINCT FROM matches.version_id
              )
        `);
        console.log(
            `[backfill-document-versions] Linked OCR jobs from document signals: ${resultCount(documentJobResult)}`
        );

        const ambiguousDocumentJobs = await tx.execute(sql`
            SELECT COUNT(*)::int AS count
            FROM (
                SELECT d.ocr_job_id
                FROM pdr_ai_v2_document AS d
                WHERE d.ocr_job_id IS NOT NULL
                GROUP BY d.ocr_job_id
                HAVING COUNT(*) > 1
            ) AS ambiguous
        `);
        const unresolvedJobDocuments = await tx.execute(sql`
            SELECT COUNT(*)::int AS count
            FROM pdr_ai_v2_ocr_jobs
            WHERE document_id IS NULL
        `);
        const unresolvedJobVersions = await tx.execute(sql`
            SELECT COUNT(*)::int AS count
            FROM pdr_ai_v2_ocr_jobs
            WHERE version_id IS NULL
        `);
        const ambiguousDocumentJobCount = resultCount(ambiguousDocumentJobs);
        const unresolvedJobDocumentCount = resultCount(unresolvedJobDocuments);
        const unresolvedJobVersionCount = resultCount(unresolvedJobVersions);
        if (
            ambiguousDocumentJobCount > 0 ||
            unresolvedJobDocumentCount > 0 ||
            unresolvedJobVersionCount > 0
        ) {
            console.warn(
                `[backfill-document-versions] OCR jobs without a unique derivable link: ambiguous_document_jobs=${ambiguousDocumentJobCount}, document_id=${unresolvedJobDocumentCount}, version_id=${unresolvedJobVersionCount}`
            );
        }
        if (unresolvedDocumentCount > 0 || unresolvedRlmCount > 0) {
            const rlmCountDetails = rlmTables
                .map(table => `${table}=${rlmUnresolvedCounts[table] ?? 0}`)
                .join(", ");
            throw new Error(
                `[backfill-document-versions] document version repair incomplete: unresolved_documents=${unresolvedDocumentCount}, unresolved_rlm=${unresolvedRlmCount}; ${rlmCountDetails}`
            );
        }
    });

    console.log("[backfill-document-versions] Done.");
}

if (/backfill-document-versions\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
    backfill()
        .then(() => {
            process.exit(0);
        })
        .catch(error => {
            console.error("[backfill-document-versions] Failed:", error);
            process.exit(1);
        });
}
