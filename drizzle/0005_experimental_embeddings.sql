CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document_embeddings_exp" (
    "id" bigserial PRIMARY KEY,
    "document_id" bigint NOT NULL REFERENCES "pdr_ai_v2_document"("id") ON DELETE CASCADE,
    "retrieval_chunk_id" bigint NOT NULL REFERENCES "pdr_ai_v2_document_retrieval_chunks"("id") ON DELETE CASCADE,
    "provider" text NOT NULL,
    "model" text NOT NULL,
    "version" text NOT NULL,
    "dimension" integer NOT NULL DEFAULT 1024,
    "embedding" vector(1024) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "document_embeddings_exp_chunk_unique" UNIQUE ("retrieval_chunk_id", "provider", "model", "version")
);

CREATE INDEX IF NOT EXISTS "document_embeddings_exp_doc_idx"
    ON "pdr_ai_v2_document_embeddings_exp" ("document_id", "provider", "model", "version");

CREATE INDEX IF NOT EXISTS "document_embeddings_exp_chunk_idx"
    ON "pdr_ai_v2_document_embeddings_exp" ("retrieval_chunk_id");
