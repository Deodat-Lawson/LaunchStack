/**
 * @launchstack/core — the Launchstack engine. createEngine() bundles the
 * subsystems that currently live in core (DB + storage port) into a single
 * object the hosting app threads through its call graph. Subsystems still
 * landing in core (ingestion, RAG, OCR processor, LLM registry, embeddings
 * factory, graph sync, reranking) will be added here as they migrate in
 * subsequent refactor steps.
 */

import { createDb, type Db, type DbClient } from "./db";
import type { CoreConfig } from "./config/types";

export * from "./config";
export type { StoragePort, UploadInput, UploadResult } from "./storage/types";
export type { Db, DbClient, SqlClient } from "./db";
export { createDb, toRows } from "./db";

/**
 * Runtime handle returned by createEngine. Fields are added over time as
 * more subsystems migrate into core — today it's just db + storage.
 */
export interface Engine {
  config: CoreConfig;
  /** Drizzle client + raw postgres.js client + close(). */
  db: DbClient;
  dbHandle: Db;
  /** StoragePort handed in via config — re-exposed for convenience. */
  storage: CoreConfig["storage"];
}

/**
 * Build a runtime engine from an explicit config. The factory opens a
 * single DB pool per call, so callers should construct the engine once per
 * process (see `apps/web/src/server/engine.ts` for the in-repo singleton
 * pattern that caches on globalThis to survive HMR).
 */
export function createEngine(config: CoreConfig): Engine {
  const dbHandle = createDb(config.db);
  return {
    config,
    db: dbHandle.db,
    dbHandle,
    storage: config.storage,
  };
}
