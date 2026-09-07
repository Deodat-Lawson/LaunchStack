-- Stamp and reconcile pdr_ai_v2_file_uploads.company_id from document URLs.
--
-- 1. Backfill NULL rows where every weak /api/files/{id} reference agrees on
--    exactly one company.
-- 2. Clear stamps that come from the weak matcher but not the canonical path
--    matcher (or that sit on files with ambiguous weak references).
-- 3. Re-backfill NULL rows from unique canonical references only.
--
-- References are read from BOTH pdr_ai_v2_document.url and
-- pdr_ai_v2_document_versions.url: a version uploaded before the company_id
-- column existed stores its file id only on the version row, and leaving it
-- unstamped makes the hardened /api/files route deny it permanently.
--
-- The weak matcher requires a delimiter after the id (`/`, `?`, `#`, or end of
-- string) so an unrelated path such as `/api/files/5-report.pdf` is not read
-- as a reference to file 5 — without that, one foreign blob URL was enough to
-- make a correctly-stamped file look disputed and get cleared in step 2.
--
-- Host is intentionally unchecked for id extraction; the runtime origin gate
-- handles capability/authz host trust. Tenant attribution comes only from
-- document.company_id.
--
-- Twin of apps/web/src/server/backfills/file-uploads-company-id.ts

WITH file_refs AS (
    SELECT d."url" AS url, d."company_id" AS company_id
    FROM "pdr_ai_v2_document" d
    UNION ALL
    SELECT v."url" AS url, d."company_id" AS company_id
    FROM "pdr_ai_v2_document_versions" v
    INNER JOIN "pdr_ai_v2_document" d ON d."id" = v."document_id"
),
file_owner AS (
    SELECT
        (regexp_match(r.url, '/api/files/([0-9]+)([/?#]|$)'))[1]::bigint AS file_id,
        MIN(r.company_id) AS company_id,
        COUNT(DISTINCT r.company_id) AS company_count
    FROM file_refs r
    WHERE r.url ~ '/api/files/[0-9]+([/?#]|$)'
    GROUP BY 1
)
UPDATE "pdr_ai_v2_file_uploads" f
SET "company_id" = o.company_id
FROM file_owner o
WHERE f."id" = o.file_id
  AND o.company_count = 1
  AND f."company_id" IS NULL;

WITH file_refs AS (
    SELECT d."url" AS url, d."company_id" AS company_id
    FROM "pdr_ai_v2_document" d
    UNION ALL
    SELECT v."url" AS url, d."company_id" AS company_id
    FROM "pdr_ai_v2_document_versions" v
    INNER JOIN "pdr_ai_v2_document" d ON d."id" = v."document_id"
),
weak_matches AS (
    SELECT
        (regexp_match(r.url, '/api/files/([0-9]+)([/?#]|$)'))[1]::bigint AS file_id,
        MIN(r.company_id) AS company_id,
        COUNT(DISTINCT r.company_id) AS company_count
    FROM file_refs r
    WHERE r.url ~ '/api/files/[0-9]+([/?#]|$)'
    GROUP BY 1
),
weak_owner AS (
    SELECT file_id, company_id
    FROM weak_matches
    WHERE company_count = 1
),
anchored_matches AS (
    SELECT
        (regexp_match(
            r.url,
            '^(https?://[^/?#]+)?/api/files/([0-9]+)/?(\?.*)?$'
        ))[2]::bigint AS file_id,
        MIN(r.company_id) AS company_id,
        COUNT(DISTINCT r.company_id) AS company_count
    FROM file_refs r
    WHERE r.url ~ '^(https?://[^/?#]+)?/api/files/[0-9]+/?(\?.*)?$'
    GROUP BY 1
),
anchored_owner AS (
    SELECT file_id, company_id
    FROM anchored_matches
    WHERE company_count = 1
),
disputed_files AS (
    SELECT f."id"
    FROM "pdr_ai_v2_file_uploads" f
    LEFT JOIN weak_owner w
        ON w.file_id = f."id"
    LEFT JOIN anchored_owner a
        ON a.file_id = f."id"
    LEFT JOIN weak_matches ambiguous
        ON ambiguous.file_id = f."id"
       AND ambiguous.company_count > 1
    WHERE (
        f."company_id" = w.company_id
        AND (
            a.file_id IS NULL
            OR a.company_id IS DISTINCT FROM w.company_id
        )
    )
       OR (
           -- Only clear an ambiguous file when the canonical matcher has no
           -- opinion either. A stamp the runtime wrote inline is authoritative
           -- and must survive an unrelated URL that happens to mention the id.
           ambiguous.file_id IS NOT NULL
           AND f."company_id" IS NOT NULL
           AND a.file_id IS NULL
       )
)
UPDATE "pdr_ai_v2_file_uploads" f
SET "company_id" = NULL
FROM disputed_files d
WHERE f."id" = d."id";

WITH file_refs AS (
    SELECT d."url" AS url, d."company_id" AS company_id
    FROM "pdr_ai_v2_document" d
    UNION ALL
    SELECT v."url" AS url, d."company_id" AS company_id
    FROM "pdr_ai_v2_document_versions" v
    INNER JOIN "pdr_ai_v2_document" d ON d."id" = v."document_id"
),
anchored_matches AS (
    SELECT
        (regexp_match(
            r.url,
            '^(https?://[^/?#]+)?/api/files/([0-9]+)/?(\?.*)?$'
        ))[2]::bigint AS file_id,
        MIN(r.company_id) AS company_id,
        COUNT(DISTINCT r.company_id) AS company_count
    FROM file_refs r
    WHERE r.url ~ '^(https?://[^/?#]+)?/api/files/[0-9]+/?(\?.*)?$'
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
UPDATE "pdr_ai_v2_file_uploads" f
SET "company_id" = o.company_id
FROM anchored_owner o
WHERE f."id" = o.file_id
  AND f."company_id" IS NULL;
