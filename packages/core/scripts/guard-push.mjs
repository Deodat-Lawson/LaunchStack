#!/usr/bin/env node
/**
 * `drizzle-kit push` guard.
 *
 * push diffs the TypeScript schema against a live database and rewrites it to
 * match. That is a fine way to iterate on a scratch database and a terrible way
 * to change a real one: it is not reviewed, not ordered, not recorded, and it
 * will happily DROP a column to make the database match the code.
 *
 * This repo used to run push in CI, in Docker and in local dev while Vercel
 * production ran SQL migrations — two strategies that produced provably
 * different databases. push is now allowed only against a database that the
 * migration runner has never touched.
 *
 * Escape hatch: LAUNCHSTACK_ALLOW_PUSH=1 (used by the CI schema-parity job,
 * which pushes into a deliberately empty database to compare against one built
 * from migrations).
 */

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..");
dotenv.config({ path: resolve(CORE, "..", "..", ".env") });

const die = (msg) => {
  console.error(`[guard-push] refusing to run drizzle-kit push.\n\n${msg}\n`);
  process.exit(1);
};

const allow = process.env.LAUNCHSTACK_ALLOW_PUSH === "1";

for (const v of ["CI", "VERCEL", "VERCEL_ENV"]) {
  if (process.env[v] && !allow) {
    die(
      `${v} is set — this looks like a deploy or CI environment.\n` +
        `Deploy paths must use: pnpm --filter @launchstack/core db:migrate`,
    );
  }
}
if (process.env.NODE_ENV === "production" && !allow) {
  die("NODE_ENV=production. Use `db:migrate`.");
}

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) die("MIGRATE_DATABASE_URL or DATABASE_URL is required.");

if (!allow) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql`SELECT to_regclass('_launchstack_migrations') IS NOT NULL AS managed`;
    if (row?.managed) {
      die(
        `this database is migration-managed (it has a _launchstack_migrations ledger).\n` +
          `Pushing would rewrite it out from under the migration history.\n\n` +
          `  To change the schema:  edit packages/adapters/src/db/schema/*.ts, then\n` +
          `                         pnpm --filter @launchstack/core db:generate --name=<change>\n` +
          `  To apply migrations:   pnpm --filter @launchstack/core db:migrate\n` +
          `  To use a scratch DB:   point DATABASE_URL at a fresh database\n` +
          `  To override anyway:    LAUNCHSTACK_ALLOW_PUSH=1`,
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

console.warn(
  "[guard-push] pushing an unversioned schema diff. Nothing is recorded and\n" +
    "[guard-push] nothing is reviewable. Use this only on a scratch database.\n",
);

const child = spawn(
  "pnpm",
  ["exec", "drizzle-kit", "push", ...process.argv.slice(2)],
  { cwd: CORE, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
