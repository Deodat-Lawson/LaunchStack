import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";
import type { DbConfig } from "../config/types";

export { pgVector } from "./pgVector";
export * as schema from "./schema";

/**
 * Drizzle client bound to our full schema. Call sites can `engine.db.select(...)`,
 * `engine.db.insert(...)`, etc. — the usual postgres-js-backed surface.
 */
export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Raw postgres.js client, exposed for rare cases where drizzle's query builder
 * is not the right tool (e.g. LISTEN/NOTIFY, COPY, hand-rolled SQL).
 */
export type SqlClient = Sql;

export interface Db {
  /** Drizzle query builder + execute(). */
  db: DbClient;
  /** Underlying postgres.js client — use sparingly. */
  client: SqlClient;
  /** Closes the underlying connection pool. */
  close: () => Promise<void>;
}

/**
 * Build a DB client from a config slice. Consumers outside the monorepo call
 * this directly; inside the monorepo, apps/web reaches it through
 * createEngine + getEngine().
 */
export function createDb(config: DbConfig): Db {
  const client = postgres(config.url, { max: config.maxConnections ?? 10 });
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    close: () => client.end({ timeout: 5 }),
  };
}

/**
 * Extract rows from db.execute() result (postgres.js returns an array directly).
 * Lifted from the former app-side helper so consumers get the same ergonomics.
 */
export function toRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : []) as T[];
}
