import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { type Config } from "drizzle-kit";

// ADR-002: the engine schema source moved to @launchstack/adapters; this
// package remains the home of the immutable migration history under
// ./drizzle, so the config points across the workspace at the moved source.
import * as engineSchema from "../adapters/src/db/schema";

dotenv.config({
  path: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.env"),
});

/**
 * Engine migration set — the tables @launchstack/core publishes.
 *
 * `tablesFilter` is derived from the schema rather than a `pdr_ai_v2_*` glob:
 * engine and product tables share one database and one prefix, so a glob would
 * make this config believe the product's 36 tables were deleted and offer to
 * drop them. Naming exactly what this set owns keeps each side blind to the
 * other.
 */
const engineTables: string[] = [];
for (const value of Object.values(engineSchema)) {
  // drizzle's `is` narrows, so no hand-written type predicate is needed.
  if (is(value, PgTable)) engineTables.push(getTableName(value));
}

export default {
  schema: "../adapters/src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",

  // Timestamped filenames: sequential numbering is what let two migrations
  // both claim `0002` in the old set.
  migrations: { prefix: "timestamp" },

  // Only read by push/pull/studio — `generate` never connects, and the runner
  // reads DATABASE_URL itself. MIGRATE_DATABASE_URL must be a direct (session)
  // connection: advisory locks do not survive a transaction-mode pooler.
  dbCredentials: {
    url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL!,
  },

  tablesFilter: engineTables,
} satisfies Config;
