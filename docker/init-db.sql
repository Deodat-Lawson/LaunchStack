-- Enable pgvector extension on first database initialisation.
-- This file is mounted into /docker-entrypoint-initdb.d/ and only
-- runs when PostgreSQL creates a fresh data directory.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS doc_sections_embedding_hnsw_idx
ON pdr_ai_v2_document_sections
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS doc_metadata_summary_embedding_hnsw_idx
ON pdr_ai_v2_document_metadata
USING hnsw (summary_embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS doc_previews_embedding_hnsw_idx
ON pdr_ai_v2_document_previews
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
