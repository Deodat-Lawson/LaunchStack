/**
 * Production-safe migration runner for the Launchstack schema.
 *
 * Applies every *.sql file under apps/web/drizzle/ in lexicographic order,
 * tracking what's been applied in a `_launchstack_migrations` table so each
 * file runs exactly once per database.
 *
 * Intentionally simple — no drizzle-kit journal, no rollbacks. This is the
 * opposite of `drizzle-kit push`, which rewrites the schema based on the
 * current code; push is fine for dev, dangerous for prod. Migrations live
 * in the repo and are applied forward-only.
 *
 * Run manually: `pnpm --filter @launchstack/web db:migrate`
 * Or via the `migrate` compose service (see docker-compose.yml).
 */

import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is required");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "drizzle");

const sql = postgres(url, { max: 1 });

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS _launchstack_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function getAppliedMigrations() {
  const rows = await sql`SELECT name, checksum FROM _launchstack_migrations`;
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

async function listMigrationFiles() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

async function applyMigration(name) {
  const body = await readFile(join(migrationsDir, name), "utf8");
  const checksum = createHash("sha256").update(body).digest("hex");

  console.log(`[migrate] applying ${name}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`
      INSERT INTO _launchstack_migrations (name, checksum)
      VALUES (${name}, ${checksum})
    `;
  });

  return checksum;
}

async function main() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const files = await listMigrationFiles();

  let pending = 0;
  let drift = 0;

  for (const name of files) {
    const body = await readFile(join(migrationsDir, name), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const recorded = applied.get(name);

    if (recorded === undefined) {
      await applyMigration(name);
      pending += 1;
    } else if (recorded !== checksum) {
      console.warn(
        `[migrate] WARN: ${name} has changed since it was applied ` +
          `(checksum mismatch). Migrations are immutable — create a new ` +
          `migration instead of editing a historical one.`,
      );
      drift += 1;
    }
  }

  if (pending === 0) {
    console.log("[migrate] database is up to date");
  } else {
    console.log(`[migrate] applied ${pending} migration(s)`);
  }

  if (drift > 0) {
    console.error(`[migrate] ${drift} checksum mismatch(es) detected`);
    process.exit(1);
  }
}

try {
  await main();
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
