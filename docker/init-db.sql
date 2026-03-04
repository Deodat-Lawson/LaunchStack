-- Enable pgvector extension on first database initialisation.
-- This file is mounted into /docker-entrypoint-initdb.d/ and only
-- runs when PostgreSQL creates a fresh data directory.
--
-- NOTE: Do NOT create indexes here — the tables do not exist yet.
-- Tables and indexes are created by the migrate container (pnpm db:push).
CREATE EXTENSION IF NOT EXISTS vector;
