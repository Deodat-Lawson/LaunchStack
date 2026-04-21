/**
 * Backfill script for the document versioning feature (Phase 1).
 *
 * For every existing document row, this creates a v1 entry in
 * `pdr_ai_v2_document_versions` and backfills:
 *   - document.current_version_id -> the new v1 row
 *   - document.file_type           -> copied from document.mime_type
 *   - RLM chunk/structure/metadata/preview tables .version_id -> the new v1 row
 *
 * The script is IDEMPOTENT: re-running it is a no-op for any document that
 * already has a current_version_id. Safe to run on every container boot,
 * locally and in CI.
 *
 * Run with:
 *   pnpm tsx scripts/backfill-document-versions.ts
 *
 * Typically wired into the migrate container after `pnpm db:push` so that
 * `docker compose up` on this branch leaves the DB in a consistent state.
 */

import "dotenv/config";
import { sql } from "drizzle-orm";

import { db } from "../apps/web/src/server/db";

async function backfill() {
    console.log("[backfill-document-versions] Starting...");

    // 1. Insert a v1 row for every document that doesn't have one yet.
    //    Uses INSERT ... SELECT with a NOT EXISTS guard so re-running is safe.
    //    mime_type falls back to 'application/octet-stream' if the document row
    //    has none — the upload flow will prefer doc.file_type over this, and
    //    this only affects the backfilled v1 record.
    const insertResult = await db.execute(sql`
        INSERT INTO pdr_ai_v2_document_versions (
            document_id,
            version_number,
            url,
            mime_type,
            uploaded_by,
            ocr_processed,
            created_at
        )
        SELECT
            d.id,
            1,
            d.url,
            COALESCE(d.mime_type, 'application/octet-stream'),
            NULL,
            COALESCE(d.ocr_processed, FALSE),
            d.created_at
        FROM pdr_ai_v2_document d
        WHERE NOT EXISTS (
            SELECT 1
            FROM pdr_ai_v2_document_versions v
            WHERE v.document_id = d.id AND v.version_number = 1
        )
    `);
    console.log(
        `[backfill-document-versions] Inserted v1 rows for ${
            (insertResult as { rowCount?: number }).rowCount ?? "?"
        } documents`
    );

    // 2. Point each document at its v1 row and copy mime_type -> file_type.
    //    Only touches rows where current_version_id is NULL, so this is idempotent.
    const updateDocResult = await db.execute(sql`
        UPDATE pdr_ai_v2_document AS d
        SET
            current_version_id = v.id,
            file_type = COALESCE(d.file_type, d.mime_type)
        FROM pdr_ai_v2_document_versions AS v
        WHERE v.document_id = d.id
          AND v.version_number = 1
          AND d.current_version_id IS NULL
    `);
    console.log(
        `[backfill-document-versions] Set current_version_id on ${
            (updateDocResult as { rowCount?: number }).rowCount ?? "?"
        } documents`
    );

    // 3. Backfill version_id on all RLM tables. Each UPDATE only touches rows
    //    where version_id IS NULL, so the script is safe to re-run.
    const rlmTables = [
        "pdr_ai_v2_document_structure",
        "pdr_ai_v2_document_context_chunks",
        "pdr_ai_v2_document_retrieval_chunks",
        "pdr_ai_v2_document_metadata",
        "pdr_ai_v2_document_previews",
    ] as const;

    for (const table of rlmTables) {
        const result = await db.execute(
            sql`
                UPDATE ${sql.raw(table)} AS t
                SET version_id = v.id
                FROM pdr_ai_v2_document_versions AS v
                WHERE v.document_id = t.document_id
                  AND v.version_number = 1
                  AND t.version_id IS NULL
            `
        );
        console.log(
            `[backfill-document-versions] ${table}: updated ${
                (result as { rowCount?: number }).rowCount ?? "?"
            } rows`
        );
    }

    console.log("[backfill-document-versions] Done.");
}

backfill()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error("[backfill-document-versions] Failed:", error);
        process.exit(1);
    });
