CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document_embeddings_768" (
    "id" bigserial PRIMARY KEY,
    "document_id" bigint NOT NULL REFERENCES "pdr_ai_v2_document"("id") ON DELETE CASCADE,
    "retrieval_chunk_id" bigint NOT NULL REFERENCES "pdr_ai_v2_document_retrieval_chunks"("id") ON DELETE CASCADE,
    "index_key" varchar(128) NOT NULL,
    "provider" text NOT NULL,
    "model" text NOT NULL,
    "version" text NOT NULL,
    "embedding" vector(768) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "document_embeddings_768_chunk_unique" UNIQUE ("retrieval_chunk_id", "index_key")
);

CREATE INDEX IF NOT EXISTS "document_embeddings_768_doc_idx"
    ON "pdr_ai_v2_document_embeddings_768" ("document_id", "index_key");

CREATE INDEX IF NOT EXISTS "document_embeddings_768_chunk_idx"
    ON "pdr_ai_v2_document_embeddings_768" ("retrieval_chunk_id");

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document_embeddings_1024" (
    "id" bigserial PRIMARY KEY,
    "document_id" bigint NOT NULL REFERENCES "pdr_ai_v2_document"("id") ON DELETE CASCADE,
    "retrieval_chunk_id" bigint NOT NULL REFERENCES "pdr_ai_v2_document_retrieval_chunks"("id") ON DELETE CASCADE,
    "index_key" varchar(128) NOT NULL,
    "provider" text NOT NULL,
    "model" text NOT NULL,
    "version" text NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "document_embeddings_1024_chunk_unique" UNIQUE ("retrieval_chunk_id", "index_key")
);

CREATE INDEX IF NOT EXISTS "document_embeddings_1024_doc_idx"
    ON "pdr_ai_v2_document_embeddings_1024" ("document_id", "index_key");

CREATE INDEX IF NOT EXISTS "document_embeddings_1024_chunk_idx"
    ON "pdr_ai_v2_document_embeddings_1024" ("retrieval_chunk_id");
