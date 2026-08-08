-- Reproduce: polymorphic owner FK vs exclusive nullable FK columns
-- Context: LAU-20 / GitHub #313 storage deletion lifecycle (Dev B schema)
--
-- storage_objects must exclusively own bytes for exactly one of:
--   document | document_version | artifact_group
--
-- Pattern 1 (polymorphic owner_type + owner_id) looks clean in app code, but
-- Postgres cannot attach a real FOREIGN KEY to "whichever table owner_type
-- names". Deleting an owner therefore leaves dangling manifest rows — fatal
-- for a deletion lifecycle that must snapshot owned refs before cascade.
--
-- Pattern 2 (document_id / document_version_id / artifact_group_id + CHECK
-- that exactly one is non-null) trades two NULL columns per row for real
-- referential integrity and ON DELETE behavior the worker can rely on.

\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS storage_owner_fk_repro CASCADE;
CREATE SCHEMA storage_owner_fk_repro;
SET search_path TO storage_owner_fk_repro;

CREATE TABLE documents (
  id bigserial PRIMARY KEY,
  title text NOT NULL
);

CREATE TABLE document_versions (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL
);

CREATE TABLE artifact_groups (
  id bigserial PRIMARY KEY,
  label text NOT NULL
);

---------------------------------------------------------------------------
-- Pattern 1: polymorphic FK (NOT enforceable as a real FK)
---------------------------------------------------------------------------

CREATE TABLE storage_objects_polymorphic (
  id bigserial PRIMARY KEY,
  adapter text NOT NULL,
  storage_location_id text NOT NULL,
  object_key text NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('document', 'document_version', 'artifact_group')),
  owner_id bigint NOT NULL
  -- Intentionally no FOREIGN KEY: Postgres cannot target three tables
  -- conditionally from (owner_type, owner_id).
);

INSERT INTO documents (title) VALUES ('pitch-deck.pdf') RETURNING id \gset doc_
INSERT INTO document_versions (document_id, version_number)
  VALUES (:doc_id, 1) RETURNING id \gset ver_
INSERT INTO artifact_groups (label) VALUES ('zip-extract-children') RETURNING id \gset art_

INSERT INTO storage_objects_polymorphic
  (adapter, storage_location_id, object_key, owner_type, owner_id)
VALUES
  ('s3', 's3:http://localhost:8333@pdr-documents', 'documents/pitch-v1.pdf', 'document_version', :ver_id),
  ('s3', 's3:http://localhost:8333@pdr-documents', 'artifacts/child-a.pdf', 'artifact_group', :art_id);

\echo ''
\echo '=== Pattern 1: delete the owning document_version ==='
DELETE FROM document_versions WHERE id = :ver_id;

\echo 'Polymorphic manifest AFTER owner delete (dangling ref expected):'
SELECT id, owner_type, owner_id, object_key
FROM storage_objects_polymorphic
WHERE owner_type = 'document_version';

\echo 'Owner row still exists? (should be 0):'
SELECT count(*) AS surviving_versions FROM document_versions WHERE id = :ver_id;

---------------------------------------------------------------------------
-- Pattern 2: exclusive nullable FK columns + exactly-one CHECK
---------------------------------------------------------------------------

CREATE TABLE storage_objects_exclusive (
  id bigserial PRIMARY KEY,
  adapter text NOT NULL,
  storage_location_id text NOT NULL,
  object_key text NOT NULL,
  document_id bigint REFERENCES documents(id) ON DELETE RESTRICT,
  document_version_id bigint REFERENCES document_versions(id) ON DELETE RESTRICT,
  artifact_group_id bigint REFERENCES artifact_groups(id) ON DELETE RESTRICT,
  CONSTRAINT storage_objects_exclusive_one_owner CHECK (
    ((document_id IS NOT NULL)::int
     + (document_version_id IS NOT NULL)::int
     + (artifact_group_id IS NOT NULL)::int) = 1
  )
);

-- Fresh owners for pattern 2
INSERT INTO documents (title) VALUES ('roadmap.pdf') RETURNING id \gset doc2_
INSERT INTO document_versions (document_id, version_number)
  VALUES (:doc2_id, 1) RETURNING id \gset ver2_
INSERT INTO artifact_groups (label) VALUES ('audio-transcript-pair') RETURNING id \gset art2_

INSERT INTO storage_objects_exclusive
  (adapter, storage_location_id, object_key, document_version_id)
VALUES
  ('s3', 's3:http://localhost:8333@pdr-documents', 'documents/roadmap-v1.pdf', :ver2_id);

INSERT INTO storage_objects_exclusive
  (adapter, storage_location_id, object_key, artifact_group_id)
VALUES
  ('vercel-blob', 'vercel-blob:store_demo', 'transcripts/roadmap.txt', :art2_id);

\echo ''
\echo '=== Pattern 2: CHECK rejects zero / multi-owner rows ==='
\echo 'Expect failure: zero owners'
DO $$
BEGIN
  BEGIN
    INSERT INTO storage_objects_exclusive
      (adapter, storage_location_id, object_key)
    VALUES ('s3', 's3:loc', 'orphan-key');
    RAISE EXCEPTION 'UNEXPECTED: zero-owner insert succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: zero-owner insert rejected by CHECK';
  END;
END $$;

\echo 'Expect failure: two owners'
DO $$
BEGIN
  BEGIN
    INSERT INTO storage_objects_exclusive
      (adapter, storage_location_id, object_key, document_id, artifact_group_id)
    VALUES ('s3', 's3:loc', 'two-owners', 1, 1);
    RAISE EXCEPTION 'UNEXPECTED: multi-owner insert succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: multi-owner insert rejected by CHECK';
  END;
END $$;

\echo ''
\echo '=== Pattern 2: deleting an owned version is blocked while manifest exists ==='
\echo 'Expect FK violation (RESTRICT) — deletion coordinator must snapshot + clear first:'
DO $$
DECLARE
  ver_id bigint;
BEGIN
  SELECT document_version_id INTO ver_id
  FROM storage_objects_exclusive
  WHERE object_key = 'documents/roadmap-v1.pdf';

  BEGIN
    DELETE FROM document_versions WHERE id = ver_id;
    RAISE EXCEPTION 'UNEXPECTED: owner delete succeeded while exclusive FK remained';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'OK: owner delete blocked by real FK (no dangling manifest possible)';
  END;
END $$;

\echo ''
\echo '=== Pattern 2: after coordinator removes manifest refs, owner delete succeeds ==='
DELETE FROM storage_objects_exclusive WHERE object_key = 'documents/roadmap-v1.pdf';
DELETE FROM document_versions WHERE id = :ver2_id;
SELECT count(*) AS remaining_version_manifest_rows
FROM storage_objects_exclusive
WHERE document_version_id = :ver2_id;

\echo ''
\echo '=== Summary ==='
\echo 'Pattern 1 leaves dangling owner_id after owner delete — DB cannot prevent it.'
\echo 'Pattern 2 enforces exactly-one owner + real FKs — required for LAU-20 integrity.'
