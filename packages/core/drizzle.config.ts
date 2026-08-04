import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { type Config } from "drizzle-kit";

// Migrations live next to the schema they are generated from. Paths below are
// resolved relative to this file, so there is no cwd dependency — unlike the
// old apps/web config, which only worked when invoked from apps/web/.
dotenv.config({
  path: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.env"),
});

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",

  // Timestamped filenames. Sequential numbering is what let two migrations
  // both claim `0002` in the old apps/web/drizzle set; with timestamps two
  // parallel PRs cannot collide.
  migrations: { prefix: "timestamp" },

  // Only read by push/pull/studio — `generate` never opens a connection, and
  // the migration runner reads DATABASE_URL itself. MIGRATE_DATABASE_URL must
  // be a direct (session) connection: advisory locks do not survive a
  // transaction-mode pooler.
  dbCredentials: {
    url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL!,
  },

  // Every table goes through the prefixing `pgTable` in
  // src/db/schema/helpers.ts, so this one glob covers all of them. It also
  // deliberately excludes the migration ledger `_launchstack_migrations` —
  // drizzle-kit must never see, and therefore can never drop, the ledger.
  tablesFilter: ["pdr_ai_v2_*"],
} satisfies Config;
