/**
 * Applies ONE migration file by name, in a transaction, and records it in
 * `_launchstack_migrations` so a future run skips it.
 *
 * Why this exists alongside migrate.mjs: migrate.mjs applies *every* .sql
 * file under drizzle/ in lexicographic order, and the historical 0001-0016
 * files in this repo were written against UNPREFIXED table names
 * (REFERENCES "company"), while this database actually uses the
 * `pdr_ai_v2_` prefix that pgTableCreator adds (see
 * packages/core/src/db/schema/helpers.ts). So migrate.mjs fails on 0001 with
 * `relation "company" does not exist` before it ever reaches the storage
 * deletion migrations — which is why 0017-0020 were applied by hand.
 *
 * This is the same hand-application, just scripted and recorded, so it can't
 * drift from what the runner believes.
 *
 * Usage, from apps/web:
 *   node ./scripts/apply-migration.mjs 0021_storage_deletion_items_linked_item.sql
 *
 * Safe to re-run: the migrations in this series are written idempotently
 * (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), and this script
 * refuses to re-apply anything already recorded in the ledger.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

const name = process.argv[2];
if (!name) {
  console.error("[apply-migration] usage: node ./scripts/apply-migration.mjs <file.sql>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[apply-migration] DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = join(__dirname, "..", "drizzle");
const sql = postgres(url, { max: 1 });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS _launchstack_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const body = await readFile(join(migrationsDir, name), "utf8");
  const checksum = createHash("sha256").update(body).digest("hex");

  const [already] = await sql`
    SELECT name, checksum FROM _launchstack_migrations WHERE name = ${name}
  `;

  if (already) {
    if (already.checksum === checksum) {
      console.log(`[apply-migration] ${name} is already applied — nothing to do`);
    } else {
      console.error(
        `[apply-migration] ${name} is already applied but its contents have CHANGED ` +
          `since then. Migrations are immutable — write a new one instead of editing it.`,
      );
      process.exitCode = 1;
    }
  } else {
    console.log(`[apply-migration] applying ${name}...`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`
        INSERT INTO _launchstack_migrations (name, checksum) VALUES (${name}, ${checksum})
      `;
    });
    console.log(`[apply-migration] applied ${name}`);
  }

  // Verification: print what the column list actually looks like now, rather
  // than trusting that "no error" means "the change landed".
  const columns = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'pdr_ai_v2_storage_deletion_items'
    ORDER BY ordinal_position
  `;
  if (columns.length === 0) {
    console.warn(
      "[apply-migration] NOTE: table pdr_ai_v2_storage_deletion_items not found — " +
        "is DATABASE_URL pointing at the right database?",
    );
  } else {
    console.log("\n[apply-migration] pdr_ai_v2_storage_deletion_items columns:");
    for (const c of columns) {
      console.log(`  ${c.column_name.padEnd(24)} ${c.data_type} (nullable: ${c.is_nullable})`);
    }
  }
} catch (err) {
  console.error("[apply-migration] failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
