-- Storage deletion lifecycle — make a tombstone's request_id survive the purge.
--
-- 0020 created storage_deletion_tombstones.request_id as a real FK with
-- ON DELETE SET NULL. That defeats the point of a tombstone in exactly the way
-- 0020's own comment warns about for document_id:
--
--     "A real FK would either block the document from ever being purged, or
--      cascade-delete the tombstone along with it, defeating the whole point
--      of a tombstone surviving the purge it's recording."
--
-- storage_deletion_requests.document_id is ON DELETE CASCADE against
-- document.id, so completing a deletion destroys the request row — and the
-- SET NULL then wipes the tombstone's only pointer back to it. The result is
-- that "look up a deletion by its request id" stops working the instant the
-- deletion succeeds, which is precisely when someone holding a request id from
-- a log line wants to ask what happened (B7).
--
-- Fix: drop the FK and keep request_id as a plain unconstrained bigint, the
-- same treatment document_id / document_version_id already get. The column,
-- its index, and every existing value are otherwise untouched.
--
-- The FK was declared inline in 0020 and so was auto-named by Postgres
-- (normally <table>_<column>_fkey). Rather than depend on that, this looks the
-- constraint up by what it actually is — the single-column foreign key on
-- request_id — and drops it by whatever name it has.
--
-- NOTE: tombstones whose request_id was ALREADY nulled by a purge before this
-- migration ran cannot be recovered — that information is gone. Only tombstones
-- written from here on will retain their request id.
--
-- Safe to re-run: if no such FK exists, this does nothing.

DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT con.conname
    INTO fk_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND rel.relname = 'pdr_ai_v2_storage_deletion_tombstones'
      AND att.attname = 'request_id'
      AND array_length(con.conkey, 1) = 1
    LIMIT 1;

    IF fk_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE %I DROP CONSTRAINT %I',
            'pdr_ai_v2_storage_deletion_tombstones',
            fk_name
        );
        RAISE NOTICE 'dropped foreign key % on storage_deletion_tombstones.request_id', fk_name;
    ELSE
        RAISE NOTICE 'no foreign key on storage_deletion_tombstones.request_id — nothing to do';
    END IF;
END
$$;

-- The lookup index stays: B7 queries tombstones by request_id.
CREATE INDEX IF NOT EXISTS "storage_deletion_tombstones_request_id_idx"
    ON "pdr_ai_v2_storage_deletion_tombstones" ("request_id");
