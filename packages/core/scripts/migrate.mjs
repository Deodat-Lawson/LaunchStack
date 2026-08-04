#!/usr/bin/env node
/**
 * Forward-only migration runner for the LaunchStack schema.
 *
 * Applies every migration listed in drizzle/meta/_journal.json, in journal
 * order, recording each in a `_launchstack_migrations` ledger so it runs
 * exactly once per database.
 *
 * This is the ONLY way schema reaches a database in any environment — local,
 * CI, Docker and Vercel all run this same command. `drizzle-kit push` is
 * banned outside a scratch database (see guard-push.mjs).
 *
 * Depends only on `postgres` and `dotenv`: drizzle-kit never loads on a
 * deploy path, which also keeps the pnpm patch out of production builds.
 *
 *   node scripts/migrate.mjs              apply pending migrations
 *   node scripts/migrate.mjs --check      report status, apply nothing
 *   node scripts/migrate.mjs --baseline   stamp as applied WITHOUT executing
 *   node scripts/migrate.mjs --dry-run    print the plan, apply nothing
 *
 * Exit codes (--check is designed to be used as a deploy preflight):
 *   0  up to date
 *   1  failure (bad config, SQL error, lock timeout, partial state)
 *   2  migrations pending
 *   3  checksum drift — an applied migration was edited
 *   4  database is AHEAD of this build — you are deploying a stale artifact
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "drizzle");
const JOURNAL = join(MIGRATIONS_DIR, "meta", "_journal.json");

dotenv.config({ path: join(HERE, "..", "..", "..", ".env") });

// Session-level advisory lock. Two-int form so the class is recognisable in
// pg_locks. Must never change: it is what makes concurrent deploys safe.
const LOCK_CLASS = 4919; // 0x1337
const LOCK_MIGRATIONS = 1;

const LOCK_WAIT_MS = Number(process.env.MIGRATE_LOCK_WAIT_MS ?? 120_000);
const LOCK_TIMEOUT = process.env.MIGRATE_LOCK_TIMEOUT ?? "10s";
const STATEMENT_TIMEOUT = process.env.MIGRATE_STATEMENT_TIMEOUT ?? "0";

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_PENDING = 2;
const EXIT_DRIFT = 3;
const EXIT_AHEAD = 4;

const argv = new Set(process.argv.slice(2));
const MODE = argv.has("--check")
  ? "check"
  : argv.has("--baseline")
    ? "baseline"
    : argv.has("--dry-run")
      ? "dry-run"
      : "apply";

const log = (msg) => console.log(`[migrate] ${msg}`);
const err = (msg) => console.error(`[migrate] ${msg}`);

/** Reads the journal and returns the ordered, validated migration plan. */
async function loadPlan() {
  let journal;
  try {
    journal = JSON.parse(await readFile(JOURNAL, "utf8"));
  } catch (e) {
    throw new Error(
      `could not read ${JOURNAL}: ${e.message}\n` +
        `Run \`pnpm --filter @launchstack/core db:generate\` to create it.`,
    );
  }

  const entries = [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);
  if (entries.length === 0) throw new Error("journal contains no migrations");

  // Contiguity + monotonicity. A botched merge of _journal.json shows up here
  // rather than as a silently skipped migration at 3am.
  entries.forEach((e, i) => {
    if (e.idx !== i) {
      throw new Error(
        `journal idx is not contiguous: expected ${i}, found ${e.idx} (${e.tag}).\n` +
          `This usually means _journal.json was hand-merged. Delete your .sql +\n` +
          `snapshot, take main's journal, and re-run db:generate.`,
      );
    }
    if (i > 0 && e.when <= entries[i - 1].when) {
      throw new Error(
        `journal timestamps are not strictly increasing: ${e.tag} (${e.when}) ` +
          `is not after ${entries[i - 1].tag} (${entries[i - 1].when}).`,
      );
    }
  });

  return Promise.all(
    entries.map(async (e) => {
      const file = join(MIGRATIONS_DIR, `${e.tag}.sql`);
      let body;
      try {
        body = await readFile(file, "utf8");
      } catch {
        throw new Error(`journal lists ${e.tag} but ${file} is missing`);
      }
      const firstLine = body.split("\n", 1)[0] ?? "";
      const noTransaction = /^--\s*launchstack:no-transaction\b/.test(firstLine);
      if (noTransaction && !/^--\s*Reason:/m.test(body)) {
        throw new Error(
          `${e.tag} is marked no-transaction but has no "-- Reason:" line.\n` +
            `Running outside a transaction means a failure leaves partial state;\n` +
            `say why it is necessary.`,
        );
      }
      return {
        tag: e.tag,
        body,
        noTransaction,
        checksum: createHash("sha256").update(body).digest("hex"),
        // drizzle emits `--> statement-breakpoint` between statements. Running
        // them individually is what turns a failure into "statement 7 of 143"
        // instead of a wall of SQL.
        statements: body
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)*$/.test(s)),
      };
    }),
  );
}

async function ensureLedger(cx) {
  // Name deliberately starts with `_`: it does not match the drizzle-kit
  // tablesFilter (`pdr_ai_v2_*`), so push/pull can never see or drop it.
  await cx`
    CREATE TABLE IF NOT EXISTS _launchstack_migrations (
      tag          text PRIMARY KEY,
      checksum     text        NOT NULL,
      state        text        NOT NULL DEFAULT 'applied',
      started_at   timestamptz NOT NULL DEFAULT now(),
      applied_at   timestamptz,
      duration_ms  integer,
      applied_by   text
    )
  `;
}

async function readLedger(cx) {
  const rows = await cx`SELECT tag, checksum, state, started_at FROM _launchstack_migrations`;
  return new Map(rows.map((r) => [r.tag, r]));
}

/**
 * Classify the plan against the ledger. Returns everything the caller needs to
 * decide, WITHOUT mutating anything — so `apply` can validate the entire plan
 * before touching the database.
 */
function diff(plan, ledger) {
  const pending = [];
  const drifted = [];
  const running = [];
  const known = new Set(plan.map((m) => m.tag));

  for (const m of plan) {
    const row = ledger.get(m.tag);
    if (!row) {
      pending.push(m);
    } else if (row.state === "running") {
      running.push(m.tag);
    } else if (row.checksum !== m.checksum) {
      drifted.push(m.tag);
    }
  }

  // Ledger rows this build knows nothing about => the DB was migrated by a
  // NEWER build. Deploying this artifact would run old code against a new
  // schema. Nobody implements this check; it is the one that catches a rollback.
  const ahead = [...ledger.keys()].filter((t) => !known.has(t));

  return { pending, drifted, running, ahead };
}

async function acquireLock(cx) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let waited = false;
  for (;;) {
    const [{ locked }] = await cx`
      SELECT pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_MIGRATIONS}) AS locked`;
    if (locked) {
      if (waited) log("lock acquired");
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `could not acquire the migration lock within ${LOCK_WAIT_MS / 1000}s.\n` +
          `Another deploy is migrating, or a previous run died holding the lock.\n` +
          `Inspect with:\n` +
          `  SELECT * FROM pg_locks WHERE locktype = 'advisory' AND classid = ${LOCK_CLASS};`,
      );
    }
    if (!waited) {
      log("another migration run holds the lock; waiting…");
      waited = true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function ensureVector(cx) {
  try {
    await cx`CREATE EXTENSION IF NOT EXISTS vector`;
  } catch (e) {
    throw new Error(
      `could not enable the pgvector extension: ${e.message}\n` +
        `The schema stores embeddings in vector(N) columns and cannot be created\n` +
        `without it. Use the pgvector/pgvector image (not stock postgres), or ask\n` +
        `a role with CREATE privilege to run:  CREATE EXTENSION vector;`,
    );
  }
}

async function applyOne(cx, m) {
  const by = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.HOSTNAME ?? "local";
  const t0 = Date.now();
  const n = m.statements.length;

  const runStatements = async () => {
    for (const [i, stmt] of m.statements.entries()) {
      try {
        await cx.unsafe(stmt);
      } catch (e) {
        throw new Error(
          `${m.tag}: statement ${i + 1} of ${n} failed\n` +
            `  ${e.message}${e.code ? ` (SQLSTATE ${e.code})` : ""}\n` +
            `  ${stmt.split("\n")[0].slice(0, 160)}`,
        );
      }
    }
  };

  if (m.noTransaction) {
    // Record intent first so a crash is detectable rather than silently retried.
    await cx`
      INSERT INTO _launchstack_migrations (tag, checksum, state, applied_by)
      VALUES (${m.tag}, ${m.checksum}, 'running', ${by})`;
    await runStatements();
    await cx`
      UPDATE _launchstack_migrations
         SET state = 'applied', applied_at = now(), duration_ms = ${Date.now() - t0}
       WHERE tag = ${m.tag}`;
    return;
  }

  await cx.unsafe("BEGIN");
  try {
    // The single most important production-safety line here. Without it an
    // ALTER TABLE queued behind a long-running SELECT holds an ACCESS EXCLUSIVE
    // lock *request*, which blocks every subsequent query on that table — a
    // schema change becomes an outage. Fail in 10s and let the deploy retry.
    await cx.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await cx.unsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await runStatements();
    await cx`
      INSERT INTO _launchstack_migrations
        (tag, checksum, state, applied_at, duration_ms, applied_by)
      VALUES (${m.tag}, ${m.checksum}, 'applied', now(), ${Date.now() - t0}, ${by})`;
    await cx.unsafe("COMMIT");
  } catch (e) {
    await cx.unsafe("ROLLBACK").catch(() => {});
    throw e;
  }
}

function reportBlockers({ drifted, running, ahead }) {
  if (drifted.length > 0) {
    err(`checksum drift — these migrations were edited after being applied:`);
    drifted.forEach((t) => err(`  ${t}`));
    err(`Migrations are immutable. Add a new forward migration instead.`);
    return EXIT_DRIFT;
  }
  if (running.length > 0) {
    err(`a previous run left these migrations in state='running':`);
    running.forEach((t) => err(`  ${t}`));
    err(
      `They may be partially applied. Inspect the database, finish or undo the\n` +
        `change by hand, then delete the ledger row — or write a corrective migration.`,
    );
    return EXIT_FAIL;
  }
  if (ahead.length > 0) {
    err(`the database is AHEAD of this build. It has migrations this code does not:`);
    ahead.forEach((t) => err(`  ${t}`));
    err(`You are deploying a stale artifact over a newer schema. Deploy newer code.`);
    return EXIT_AHEAD;
  }
  return null;
}

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    err("MIGRATE_DATABASE_URL or DATABASE_URL is required");
    return EXIT_FAIL;
  }

  const plan = await loadPlan();
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  // One pinned backend for the whole run: session advisory locks live on a
  // connection, so the lock and the migrations must share it.
  const cx = await sql.reserve();

  try {
    if (MODE === "check") {
      await ensureLedger(cx);
      const state = diff(plan, await readLedger(cx));
      const blocked = reportBlockers(state);
      if (blocked !== null) return blocked;
      if (state.pending.length > 0) {
        err(`${state.pending.length} migration(s) pending:`);
        state.pending.forEach((m) => err(`  ${m.tag}`));
        return EXIT_PENDING;
      }
      log(`up to date (${plan.length} migration(s) applied)`);
      return EXIT_OK;
    }

    // Everything below mutates. Take the lock BEFORE reading the ledger:
    // reading first is why the old runner let two concurrent Vercel builds
    // both decide the same migration was pending.
    await acquireLock(cx);
    await ensureLedger(cx);
    const state = diff(plan, await readLedger(cx));

    // Validate the WHOLE plan before applying anything. The old runner warned
    // about drift, applied everything else, and only then exited 1 — mutating
    // the database after detecting corruption.
    const blocked = reportBlockers(state);
    if (blocked !== null) return blocked;

    if (state.pending.length === 0) {
      log("database is up to date");
      return EXIT_OK;
    }

    if (MODE === "dry-run") {
      log(`${state.pending.length} migration(s) would be applied:`);
      state.pending.forEach((m) =>
        log(`  ${m.tag} (${m.statements.length} statement(s))${m.noTransaction ? " [no-transaction]" : ""}`),
      );
      return EXIT_OK;
    }

    if (MODE === "baseline") {
      log("baseline: recording as applied WITHOUT executing.");
      log("This asserts the database ALREADY matches the schema. Verify first.");
      for (const m of state.pending) {
        await cx`
          INSERT INTO _launchstack_migrations
            (tag, checksum, state, applied_at, applied_by)
          VALUES (${m.tag}, ${m.checksum}, 'applied', now(), 'baseline')`;
        log(`  stamped ${m.tag}`);
      }
      return EXIT_OK;
    }

    await ensureVector(cx);
    for (const m of state.pending) {
      log(`applying ${m.tag} (${m.statements.length} statement(s))`);
      await applyOne(cx, m);
    }
    log(`applied ${state.pending.length} migration(s)`);
    return EXIT_OK;
  } finally {
    // Release explicitly rather than relying on disconnect, so a pooled or
    // slow-to-close connection cannot strand the lock.
    await cx`SELECT pg_advisory_unlock(${LOCK_CLASS}, ${LOCK_MIGRATIONS})`.catch(() => {});
    cx.release();
    await sql.end({ timeout: 5 });
  }
}

try {
  process.exit(await main());
} catch (e) {
  err(`failed: ${e.message}`);
  process.exit(EXIT_FAIL);
}
