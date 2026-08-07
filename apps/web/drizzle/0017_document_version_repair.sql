-- Repair legacy document/version/RLM links before strict version-aware readers run.
-- Safe to re-run: data writes are deterministic and all inserts are conflict-safe.

-- Every document needs a stable v1 row. A synthesized v1 never inherits an OCR
-- job: legacy document-level jobs are linked below only when ownership is unique.
INSERT INTO "pdr_ai_v2_document_versions" (
    "document_id",
    "version_number",
    "url",
    "mime_type",
    "uploaded_by",
    "ocr_job_id",
    "ocr_processed",
    "ocr_metadata",
    "created_at"
)
SELECT
    d."id",
    1,
    d."url",
    COALESCE(
        NULLIF(BTRIM(d."mime_type"), ''),
        NULLIF(BTRIM(d."file_type"), ''),
        (
            SELECT NULLIF(BTRIM(v."mime_type"), '')
            FROM "pdr_ai_v2_document_versions" AS v
            WHERE v."document_id" = d."id"
            ORDER BY v."version_number" DESC, v."id" DESC
            LIMIT 1
        ),
        'application/octet-stream'
    ),
    NULL,
    NULL,
    COALESCE(d."ocr_processed", FALSE),
    d."ocr_metadata",
    d."created_at"
FROM "pdr_ai_v2_document" AS d
WHERE NOT EXISTS (
    SELECT 1
    FROM "pdr_ai_v2_document_versions" AS v
    WHERE v."document_id" = d."id"
      AND v."version_number" = 1
)
ON CONFLICT ("document_id", "version_number") DO NOTHING;

-- Keep valid current pointers. A NULL pointer, or one that points at another
-- document, falls back to that document's highest version. MIME/file_type are
-- filled from existing document metadata, then the selected version.
WITH selected_versions AS (
    SELECT
        d."id" AS "document_id",
        COALESCE(current_version."id", highest_version."id") AS "version_id"
    FROM "pdr_ai_v2_document" AS d
    LEFT JOIN "pdr_ai_v2_document_versions" AS current_version
        ON current_version."id" = d."current_version_id"
       AND current_version."document_id" = d."id"
    LEFT JOIN LATERAL (
        SELECT v."id"
        FROM "pdr_ai_v2_document_versions" AS v
        WHERE v."document_id" = d."id"
        ORDER BY v."version_number" DESC, v."id" DESC
        LIMIT 1
    ) AS highest_version ON TRUE
)
UPDATE "pdr_ai_v2_document" AS d
SET
    "current_version_id" = selected."version_id",
    "mime_type" = COALESCE(
        NULLIF(BTRIM(d."mime_type"), ''),
        NULLIF(BTRIM(d."file_type"), ''),
        NULLIF(BTRIM(selected_version."mime_type"), ''),
        'application/octet-stream'
    ),
    "file_type" = COALESCE(
        NULLIF(BTRIM(d."file_type"), ''),
        NULLIF(BTRIM(d."mime_type"), ''),
        NULLIF(BTRIM(selected_version."mime_type"), ''),
        'application/octet-stream'
    )
FROM selected_versions AS selected
LEFT JOIN "pdr_ai_v2_document_versions" AS selected_version
    ON selected_version."id" = selected."version_id"
   AND selected_version."document_id" = selected."document_id"
WHERE d."id" = selected."document_id"
  AND (
      d."current_version_id" IS DISTINCT FROM selected."version_id"
      OR NULLIF(BTRIM(d."mime_type"), '') IS NULL
      OR NULLIF(BTRIM(d."file_type"), '') IS NULL
  );

-- Version MIME is required by the version-aware readers. Preserve non-empty
-- values and fill only legacy NULL/blank values.
UPDATE "pdr_ai_v2_document_versions" AS v
SET "mime_type" = COALESCE(
    NULLIF(BTRIM(v."mime_type"), ''),
    NULLIF(BTRIM(d."mime_type"), ''),
    NULLIF(BTRIM(d."file_type"), ''),
    'application/octet-stream'
)
FROM "pdr_ai_v2_document" AS d
WHERE d."id" = v."document_id"
  AND NULLIF(BTRIM(v."mime_type"), '') IS NULL;

-- Legacy RLM rows without a version belong to v1, not whichever version is
-- currently selected. Invalid non-NULL links are left untouched and rejected
-- by the guard below rather than guessed.
UPDATE "pdr_ai_v2_document_structure" AS t
SET "version_id" = v."id"
FROM "pdr_ai_v2_document" AS d
JOIN "pdr_ai_v2_document_versions" AS v
  ON v."document_id" = d."id"
 AND v."version_number" = 1
WHERE t."document_id" = d."id"
  AND t."version_id" IS NULL;

UPDATE "pdr_ai_v2_document_context_chunks" AS t
SET "version_id" = v."id"
FROM "pdr_ai_v2_document" AS d
JOIN "pdr_ai_v2_document_versions" AS v
  ON v."document_id" = d."id"
 AND v."version_number" = 1
WHERE t."document_id" = d."id"
  AND t."version_id" IS NULL;

UPDATE "pdr_ai_v2_document_retrieval_chunks" AS t
SET "version_id" = v."id"
FROM "pdr_ai_v2_document" AS d
JOIN "pdr_ai_v2_document_versions" AS v
  ON v."document_id" = d."id"
 AND v."version_number" = 1
WHERE t."document_id" = d."id"
  AND t."version_id" IS NULL;

UPDATE "pdr_ai_v2_document_metadata" AS t
SET "version_id" = v."id"
FROM "pdr_ai_v2_document" AS d
JOIN "pdr_ai_v2_document_versions" AS v
  ON v."document_id" = d."id"
 AND v."version_number" = 1
WHERE t."document_id" = d."id"
  AND t."version_id" IS NULL;

UPDATE "pdr_ai_v2_document_previews" AS t
SET "version_id" = v."id"
FROM "pdr_ai_v2_document" AS d
JOIN "pdr_ai_v2_document_versions" AS v
  ON v."document_id" = d."id"
 AND v."version_number" = 1
WHERE t."document_id" = d."id"
  AND t."version_id" IS NULL;

-- The document-level OCR job reference is authoritative only when exactly one
-- document names a job. Do not infer ownership from timestamps or filenames.
WITH document_matches AS (
    SELECT
        d."ocr_job_id" AS "job_id",
        MIN(d."id") AS "document_id",
        MIN(d."current_version_id") AS "version_id"
    FROM "pdr_ai_v2_document" AS d
    LEFT JOIN "pdr_ai_v2_document_versions" AS v
        ON v."id" = d."current_version_id"
       AND v."document_id" = d."id"
    WHERE d."ocr_job_id" IS NOT NULL
    GROUP BY d."ocr_job_id"
    HAVING COUNT(*) = 1
       AND COUNT(v."id") = 1
)
UPDATE "pdr_ai_v2_ocr_jobs" AS j
SET
    "document_id" = matches."document_id",
    "version_id" = matches."version_id"
FROM document_matches AS matches
WHERE j."id" = matches."job_id"
  AND (
      j."document_id" IS DISTINCT FROM matches."document_id"
      OR j."version_id" IS DISTINCT FROM matches."version_id"
  );

-- Strict readers must never see a missing document pointer or an RLM row that
-- cannot be tied to its own document version. Ambiguous/unreferenced OCR jobs
-- remain nullable because their owner cannot be derived safely.
DO $$
DECLARE
    unresolved_documents bigint;
    unresolved_rlm bigint;
    ambiguous_document_jobs bigint;
    unresolved_job_documents bigint;
    unresolved_job_versions bigint;
BEGIN
    SELECT COUNT(*)
    INTO unresolved_documents
    FROM "pdr_ai_v2_document" AS d
    LEFT JOIN "pdr_ai_v2_document_versions" AS v
        ON v."id" = d."current_version_id"
       AND v."document_id" = d."id"
    WHERE v."id" IS NULL;

    SELECT COALESCE(SUM(unresolved_count), 0)
    INTO unresolved_rlm
    FROM (
        SELECT COUNT(*) AS unresolved_count
        FROM "pdr_ai_v2_document_structure" AS t
        WHERE t."version_id" IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM "pdr_ai_v2_document_versions" AS v
               WHERE v."id" = t."version_id"
                 AND v."document_id" = t."document_id"
           )
        UNION ALL
        SELECT COUNT(*)
        FROM "pdr_ai_v2_document_context_chunks" AS t
        WHERE t."version_id" IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM "pdr_ai_v2_document_versions" AS v
               WHERE v."id" = t."version_id"
                 AND v."document_id" = t."document_id"
           )
        UNION ALL
        SELECT COUNT(*)
        FROM "pdr_ai_v2_document_retrieval_chunks" AS t
        WHERE t."version_id" IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM "pdr_ai_v2_document_versions" AS v
               WHERE v."id" = t."version_id"
                 AND v."document_id" = t."document_id"
           )
        UNION ALL
        SELECT COUNT(*)
        FROM "pdr_ai_v2_document_metadata" AS t
        WHERE t."version_id" IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM "pdr_ai_v2_document_versions" AS v
               WHERE v."id" = t."version_id"
                 AND v."document_id" = t."document_id"
           )
        UNION ALL
        SELECT COUNT(*)
        FROM "pdr_ai_v2_document_previews" AS t
        WHERE t."version_id" IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM "pdr_ai_v2_document_versions" AS v
               WHERE v."id" = t."version_id"
                 AND v."document_id" = t."document_id"
           )
    ) AS unresolved;

    SELECT COUNT(*)
    INTO ambiguous_document_jobs
    FROM (
        SELECT d."ocr_job_id"
        FROM "pdr_ai_v2_document" AS d
        WHERE d."ocr_job_id" IS NOT NULL
        GROUP BY d."ocr_job_id"
        HAVING COUNT(*) > 1
    ) AS ambiguous;

    SELECT COUNT(*)
    INTO unresolved_job_documents
    FROM "pdr_ai_v2_ocr_jobs" AS j
    WHERE j."document_id" IS NULL;

    SELECT COUNT(*)
    INTO unresolved_job_versions
    FROM "pdr_ai_v2_ocr_jobs" AS j
    WHERE j."version_id" IS NULL;

    RAISE NOTICE
        'document version repair OCR links: ambiguous_document_jobs=%, document_id_null=%, version_id_null=%',
        ambiguous_document_jobs,
        unresolved_job_documents,
        unresolved_job_versions;

    IF unresolved_documents > 0 OR unresolved_rlm > 0 THEN
        RAISE EXCEPTION
            'document version repair incomplete: unresolved_documents=%, unresolved_rlm=%',
            unresolved_documents,
            unresolved_rlm;
    END IF;
END $$;
