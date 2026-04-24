-- Extend `pdr_ai_v2_document_notes` with anchor payload + rich content, and
-- add a parallel `pdr_ai_v2_document_note_embeddings` table so notes can be
-- unioned into the existing hybrid retriever (mirrors the shape of
-- `pdr_ai_v2_document_retrieval_chunks`).
--
-- Anchor model follows W3C Web Annotation selectors: a format-native `primary`
-- (PDF quads, media fragment, etc.) + a durable `quote` with prefix/suffix
-- that survives re-OCR and version re-upload via fuzzy matching.
-- See `packages/core/src/db/schema/document-notes.ts` for the TS types.
--
-- Safe to re-run: every statement is idempotent.

-- Ensure the base table exists. Earlier environments created it via
-- drizzle-kit push; codify the shape here so fresh migrations work too.
CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document_notes" (
    "id" serial PRIMARY KEY,
    "user_id" varchar(256) NOT NULL,
    "company_id" varchar(256),
    "document_id" varchar(256),
    "title" text,
    "content" text,
    "tags" text[] DEFAULT '{}'::text[],
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz
);

ALTER TABLE "pdr_ai_v2_document_notes"
    ADD COLUMN IF NOT EXISTS "version_id" bigint,
    ADD COLUMN IF NOT EXISTS "content_rich" jsonb,
    ADD COLUMN IF NOT EXISTS "content_markdown" text,
    ADD COLUMN IF NOT EXISTS "anchor" jsonb,
    ADD COLUMN IF NOT EXISTS "anchor_status" varchar(24) DEFAULT 'resolved';

CREATE INDEX IF NOT EXISTS "document_notes_user_idx"
    ON "pdr_ai_v2_document_notes" ("user_id");
CREATE INDEX IF NOT EXISTS "document_notes_document_idx"
    ON "pdr_ai_v2_document_notes" ("document_id");
CREATE INDEX IF NOT EXISTS "document_notes_company_idx"
    ON "pdr_ai_v2_document_notes" ("company_id");
CREATE INDEX IF NOT EXISTS "document_notes_version_idx"
    ON "pdr_ai_v2_document_notes" ("version_id");
CREATE INDEX IF NOT EXISTS "document_notes_anchor_status_idx"
    ON "pdr_ai_v2_document_notes" ("anchor_status");

-- pgvector is loaded globally by the ensure-pgvector.mjs bootstrap; skipping
-- `CREATE EXTENSION` here keeps the migration runnable under least-privilege
-- DB users.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document_note_embeddings" (
    "id" serial PRIMARY KEY,
    "note_id" integer NOT NULL,
    "document_id" varchar(256),
    "company_id" varchar(256),
    "version_id" bigint,
    "content" text NOT NULL,
    "token_count" integer NOT NULL DEFAULT 0,
    "embedding" vector(1536),
    "embedding_short" vector(512),
    "model_version" varchar(64),
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "doc_note_emb_note_id_idx"
    ON "pdr_ai_v2_document_note_embeddings" ("note_id");
CREATE INDEX IF NOT EXISTS "doc_note_emb_document_id_idx"
    ON "pdr_ai_v2_document_note_embeddings" ("document_id");
CREATE INDEX IF NOT EXISTS "doc_note_emb_company_id_idx"
    ON "pdr_ai_v2_document_note_embeddings" ("company_id");

-- HNSW on the short embedding for ANN speed (mirrors document_retrieval_chunks).
-- `IF NOT EXISTS` on DDL indexes is safe — Postgres 9.5+ supports it.
CREATE INDEX IF NOT EXISTS "doc_note_emb_embedding_short_idx"
    ON "pdr_ai_v2_document_note_embeddings"
    USING hnsw ("embedding_short" vector_cosine_ops);
