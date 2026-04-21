-- Add HNSW ANN indexes to the per-dimension embedding tables.
-- Without these indexes, pgvector falls back to a sequential scan on every
-- query, which does not scale past a few thousand rows.
--
-- m=16, ef_construction=64 are pgvector's default HNSW parameters and give a
-- good recall/latency balance for most corpora. Tune later if needed.
--
-- Not using CREATE INDEX CONCURRENTLY because Drizzle runs migrations inside
-- a transaction. These tables are small/new in all current environments, so
-- the brief write lock is acceptable. If this migration is re-run against a
-- large production table later, run the CREATE INDEX manually with
-- CONCURRENTLY outside a transaction.

CREATE INDEX IF NOT EXISTS "document_embeddings_768_embedding_hnsw_idx"
    ON "pdr_ai_v2_document_embeddings_768"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS "document_embeddings_1024_embedding_hnsw_idx"
    ON "pdr_ai_v2_document_embeddings_1024"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
