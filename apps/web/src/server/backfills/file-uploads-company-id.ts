/**
 * Stamp legacy `file_uploads.company_id` from document URLs, then reconcile
 * weak matches to canonical `/api/files/{id}` ownership.
 *
 * Schema only: `packages/core/drizzle/20260809142627_file_uploads_company_id.sql`
 * (DDL). This backfill owns the data rewrite so clean-database migrates stay
 * DML-free.
 *
 * Invoked through the backfill registry:
 *   pnpm --filter @launchstack/web db:backfill --only=2026-08-file-uploads-company-id
 *
 * `sql/file-uploads-company-id.sql` is the SQL twin of this function — keep
 * the two in step; the tests below assert the shared regexes match.
 */

import { sql } from "drizzle-orm";

import type { DbClient } from "@launchstack/core/db";

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

/**
 * Patterns are declared as plain constants rather than inline in the tagged
 * templates: `sql` cooks its literal, so an inline `\?` collapses to a bare
 * `?` and Postgres rejects the pattern ("quantifier operand invalid"), which
 * aborted the whole transaction and left every legacy row unstamped.
 *
 * The weak matcher requires a delimiter after the id so an unrelated path such
 * as `/api/files/5-report.pdf` is not read as a reference to file 5.
 */
const WEAK_CAPTURE = String.raw`/api/files/([0-9]+)([/?#]|$)`;
const WEAK_MATCH = String.raw`/api/files/[0-9]+([/?#]|$)`;
const ANCHORED_CAPTURE = String.raw`^(https?://[^/?#]+)?/api/files/([0-9]+)/?(\?.*)?$`;
const ANCHORED_MATCH = String.raw`^(https?://[^/?#]+)?/api/files/[0-9]+/?(\?.*)?$`;

/**
 * Every URL that can name a file, with the company it belongs to.
 *
 * Versions matter: a document version uploaded before the `company_id` column
 * existed stores its file id only in `document_versions.url`, so a
 * document-only scan leaves it NULL and the hardened `/api/files` route denies
 * it forever.
 */
const fileRefs = sql`
  SELECT d.url AS url, d.company_id AS company_id
  FROM pdr_ai_v2_document d
  UNION ALL
  SELECT v.url AS url, d.company_id AS company_id
  FROM pdr_ai_v2_document_versions v
  INNER JOIN pdr_ai_v2_document d ON d.id = v.document_id
`;

/** Rows still missing a company stamp that a unique document URL can own. */
export async function countUnstampedFileUploads(db: DbClient): Promise<number> {
    return resultCount(
        await db.execute(sql`
      WITH file_refs AS (${fileRefs}),
      file_owner AS (
          SELECT
              (regexp_match(r.url, ${WEAK_CAPTURE}))[1]::bigint AS file_id,
              MIN(r.company_id) AS company_id,
              COUNT(DISTINCT r.company_id) AS company_count
          FROM file_refs r
          WHERE r.url ~ ${WEAK_MATCH}
          GROUP BY 1
      )
      SELECT COUNT(*)::int AS count
      FROM pdr_ai_v2_file_uploads f
      INNER JOIN file_owner o ON f.id = o.file_id
      WHERE o.company_count = 1
        AND f.company_id IS NULL
    `)
    );
}

/**
 * One-shot stamp + reconcile. Safe to re-run: stamped rows that already match
 * an anchored owner are left alone; disputed weak stamps are cleared first.
 */
export async function stampFileUploadsCompanyId(db: DbClient): Promise<void> {
    console.log("[backfill-file-uploads-company-id] Starting...");

    await db.transaction(async tx => {
        await tx.execute(sql`
      WITH file_refs AS (${fileRefs}),
      file_owner AS (
          SELECT
              (regexp_match(r.url, ${WEAK_CAPTURE}))[1]::bigint AS file_id,
              MIN(r.company_id) AS company_id,
              COUNT(DISTINCT r.company_id) AS company_count
          FROM file_refs r
          WHERE r.url ~ ${WEAK_MATCH}
          GROUP BY 1
      )
      UPDATE pdr_ai_v2_file_uploads f
      SET company_id = o.company_id
      FROM file_owner o
      WHERE f.id = o.file_id
        AND o.company_count = 1
        AND f.company_id IS NULL
    `);

        await tx.execute(sql`
      WITH file_refs AS (${fileRefs}),
      weak_matches AS (
          SELECT
              (regexp_match(r.url, ${WEAK_CAPTURE}))[1]::bigint AS file_id,
              MIN(r.company_id) AS company_id,
              COUNT(DISTINCT r.company_id) AS company_count
          FROM file_refs r
          WHERE r.url ~ ${WEAK_MATCH}
          GROUP BY 1
      ),
      weak_owner AS (
          SELECT file_id, company_id
          FROM weak_matches
          WHERE company_count = 1
      ),
      anchored_matches AS (
          SELECT
              (regexp_match(r.url, ${ANCHORED_CAPTURE}))[2]::bigint AS file_id,
              MIN(r.company_id) AS company_id,
              COUNT(DISTINCT r.company_id) AS company_count
          FROM file_refs r
          WHERE r.url ~ ${ANCHORED_MATCH}
          GROUP BY 1
      ),
      anchored_owner AS (
          SELECT file_id, company_id
          FROM anchored_matches
          WHERE company_count = 1
      ),
      disputed_files AS (
          SELECT f.id
          FROM pdr_ai_v2_file_uploads f
          LEFT JOIN weak_owner w
              ON w.file_id = f.id
          LEFT JOIN anchored_owner a
              ON a.file_id = f.id
          LEFT JOIN weak_matches ambiguous
              ON ambiguous.file_id = f.id
             AND ambiguous.company_count > 1
          WHERE (
              f.company_id = w.company_id
              AND (
                  a.file_id IS NULL
                  OR a.company_id IS DISTINCT FROM w.company_id
              )
          )
             OR (
                 -- Only clear an ambiguous file when the canonical matcher has
                 -- no opinion either. A stamp the runtime wrote inline is
                 -- authoritative and must survive an unrelated URL that merely
                 -- mentions the id.
                 ambiguous.file_id IS NOT NULL
                 AND f.company_id IS NOT NULL
                 AND a.file_id IS NULL
             )
      )
      UPDATE pdr_ai_v2_file_uploads f
      SET company_id = NULL
      FROM disputed_files d
      WHERE f.id = d.id
    `);

        await tx.execute(sql`
      WITH file_refs AS (${fileRefs}),
      anchored_matches AS (
          SELECT
              (regexp_match(r.url, ${ANCHORED_CAPTURE}))[2]::bigint AS file_id,
              MIN(r.company_id) AS company_id,
              COUNT(DISTINCT r.company_id) AS company_count
          FROM file_refs r
          -- Host is intentionally unchecked for id extraction; the runtime origin
          -- gate handles capability/authz host trust. Tenant attribution comes only
          -- from document.company_id.
          WHERE r.url ~ ${ANCHORED_MATCH}
          GROUP BY 1
      ),
      anchored_owner AS (
          SELECT file_id, company_id
          FROM anchored_matches
          WHERE company_count = 1
      )
      -- A weakly ambiguous file may be restored only when its canonical path
      -- evidence identifies exactly one tenant; malformed weak matches never choose
      -- an owner by themselves.
      UPDATE pdr_ai_v2_file_uploads f
      SET company_id = o.company_id
      FROM anchored_owner o
      WHERE f.id = o.file_id
        AND f.company_id IS NULL
    `);
    });

    console.log("[backfill-file-uploads-company-id] Done.");
}

/** Exported for the twin-parity test. */
export const FILE_REF_PATTERNS = {
    WEAK_CAPTURE,
    WEAK_MATCH,
    ANCHORED_CAPTURE,
    ANCHORED_MATCH,
};
