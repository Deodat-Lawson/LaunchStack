/**
 * @launchstack/core — the Launchstack engine. createEngine() bundles the
 * subsystems that currently live in core (DB + storage port + graph client)
 * into a single object the hosting app threads through its call graph.
 * Subsystems still landing in core (ingestion, RAG, OCR processor, LLM
 * registry, embeddings factory, graph sync, reranking) will be added here
 * as they migrate in subsequent refactor steps.
 */

import { createDb, configureDatabase, type Db, type DbClient } from "./db";
import { configureNeo4j, getNeo4jDriver, type Driver } from "./graph/neo4j-client";
import { configureStorage } from "./storage/slot";
import { configureJobDispatcher } from "./jobs/slot";
import { configureCredits } from "./credits/slot";
import type { CoreConfig } from "./config/types";

export * from "./config";
export type { StoragePort, UploadInput, UploadResult } from "./storage/types";
export type { Db, DbClient, SqlClient } from "./db";
export { createDb, toRows } from "./db";

/**
 * Runtime handle returned by createEngine. Fields are added over time as
 * more subsystems migrate into core — today it's db + storage + graph.
 */
export interface Engine {
  config: CoreConfig;
  /** Drizzle client + raw postgres.js client + close(). */
  db: DbClient;
  dbHandle: Db;
  /** StoragePort handed in via config — re-exposed for convenience. */
  storage: CoreConfig["storage"];
  /**
   * Accessor for the Neo4j driver. Returns null when config.neo4j is absent
   * so graph-dependent code paths can skip gracefully. The driver itself is
   * instantiated lazily inside the graph client module.
   */
  neo4j: () => Driver | null;
}

/**
 * Build a runtime engine from an explicit config. The factory opens a
 * single DB pool per call and registers Neo4j credentials (if any) with the
 * graph client module. Callers should construct the engine once per
 * process (see apps/web/src/server/engine.ts for the in-repo singleton
 * pattern that caches on globalThis to survive HMR).
 */
export function createEngine(config: CoreConfig): Engine {
  const dbHandle = createDb(config.db);
  configureDatabase(dbHandle.db);
  configureStorage(config.storage);
  if (config.jobs?.dispatcher) {
    configureJobDispatcher(config.jobs.dispatcher);
  }
  if (config.credits?.port) {
    configureCredits(config.credits.port);
  }
  configureNeo4j(config.neo4j ? {
    uri: config.neo4j.uri,
    user: config.neo4j.user,
    password: config.neo4j.password,
  } : null);

  return {
    config,
    db: dbHandle.db,
    dbHandle,
    storage: config.storage,
    neo4j: () => (config.neo4j ? getNeo4jDriver() : null),
  };
}
