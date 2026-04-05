-- Enable pgvector extension on first database initialisation.
-- This file is mounted into /docker-entrypoint-initdb.d/ and only
-- runs when PostgreSQL creates a fresh data directory.
--
-- NOTE: Do NOT create indexes here — the tables do not exist yet.
-- Tables and indexes are created by the migrate container (pnpm db:push).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE DATABASE seaweedfs;

-- SeaweedFS filer metadata table (required by the [postgres] filer store driver).
-- The postgres2 driver has a known SQL formatting bug in current SeaweedFS versions,
-- so we use the [postgres] driver which requires this table to be pre-created.
\c seaweedfs
CREATE TABLE IF NOT EXISTS filemeta (
  dirhash   BIGINT,
  name      VARCHAR(65535),
  directory VARCHAR(65535),
  meta      bytea,
  PRIMARY KEY (dirhash, name)
);
