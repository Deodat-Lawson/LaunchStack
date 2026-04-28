-- Studio - Notes expansion: knowledge graph + JOIN-free user-scoped retrieval.
--
-- 1. Adds `user_id` to `pdr_ai_v2_document_note_embeddings` so the retriever
--    can filter by owner without joining `pdr_ai_v2_document_notes` on every
--    semantic search. Backfilled from the source notes table.
--
-- 2. Creates `pdr_ai_v2_note_links` — the bidirectional link graph populated
--    when `[[Wiki Link]]` mentions are written into a note's Tiptap JSON.
--    Powers the Backlinks panel and clickable wiki-link chips.
--
-- See `packages/core/src/db/schema/document-notes.ts` for the TS shape.
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. user_id on note embeddings (denormalized for retrieval)
-- ---------------------------------------------------------------------------

ALTER TABLE "pdr_ai_v2_document_note_embeddings"
    ADD COLUMN IF NOT EXISTS "user_id" varchar(256);

UPDATE "pdr_ai_v2_document_note_embeddings" ne
SET "user_id" = n."user_id"
FROM "pdr_ai_v2_document_notes" n
WHERE ne."note_id" = n."id"
  AND ne."user_id" IS NULL;

CREATE INDEX IF NOT EXISTS "doc_note_emb_user_id_idx"
    ON "pdr_ai_v2_document_note_embeddings" ("user_id");

-- ---------------------------------------------------------------------------
-- 2. note_links — wiki-link graph
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_note_links" (
    "id" serial PRIMARY KEY,
    "source_note_id" integer NOT NULL,
    "target_type" varchar(8) NOT NULL,
    "target_note_id" integer,
    "target_document_id" varchar(256),
    "target_title" text NOT NULL,
    "resolved_at" timestamptz,
    "company_id" varchar(256),
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "note_links_source_idx"
    ON "pdr_ai_v2_note_links" ("source_note_id");
CREATE INDEX IF NOT EXISTS "note_links_target_note_idx"
    ON "pdr_ai_v2_note_links" ("target_note_id");
CREATE INDEX IF NOT EXISTS "note_links_target_document_idx"
    ON "pdr_ai_v2_note_links" ("target_document_id");
CREATE INDEX IF NOT EXISTS "note_links_company_title_idx"
    ON "pdr_ai_v2_note_links" ("company_id", "target_title");
