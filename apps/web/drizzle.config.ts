import { resolve } from "node:path";
import dotenv from "dotenv";
import { type Config } from "drizzle-kit";

// drizzle-kit bundles this config and may execute it in a context where
// `import.meta.url` is unreliable, so resolve from cwd. db:push always runs
// from apps/web/, putting the repo-root .env two levels up.
dotenv.config({ path: resolve(process.cwd(), "../../.env") });

export default {
  schema: "../../packages/core/src/db/schema.ts",
  dialect: "postgresql",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DRIZZLE_DATABASE_URL ??
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL,
  },
  // Scope drizzle-kit to tables this project owns. Historically all project
  // tables used the `pdr_ai_v2_` prefix, but `marketing_content_history` was
  // added without the prefix (see `src/server/db/schema/marketing-history.ts`)
  // and is listed explicitly here so drizzle-kit sees it during schema pulls.
  // Without this, the filter hides the existing table from the "current DB
  // state" view while the TS schema still declares it, causing every push
  // to generate a spurious `CREATE TABLE` that fails with "already exists".
  tablesFilter: ["pdr_ai_v2_*", "marketing_content_history"],
  migrations: {
    schema: "public",
  },
} as Config;
