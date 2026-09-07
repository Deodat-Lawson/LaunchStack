/**
 * Data backfill CLI.
 *
 * Backfills are explicit and on-demand. They are NOT run on container boot and
 * NOT part of a migration — see packages/core/src/db/schema/ops.ts for why.
 *
 *   pnpm --filter @launchstack/web db:backfill --list
 *   pnpm --filter @launchstack/web db:backfill --only=2026-08-note-embeddings
 *   pnpm --filter @launchstack/web db:backfill --all [--batch=500] [--dry-run]
 *
 * Safe to interrupt: progress is written to the `data_backfills` ledger after
 * every batch, and re-running resumes from there.
 */

import "dotenv/config";

import { createDb } from "@launchstack/store/client";
import { backfillStatus, runBackfill } from "@launchstack/store/backfills";

import { BACKFILLS } from "../src/server/backfills";
import { getEngine } from "../src/server/engine";

function arg(name: string): string | undefined {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit?.split("=", 2)[1];
}

/**
 * `Number("abc")` is NaN, and NaN silently survives `?? default` — it would
 * reach SQL as `LIMIT NaN`. Validate instead of coercing.
 */
function positiveInt(name: string): number | undefined {
    const raw = arg(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--${name} must be a positive integer, got "${raw}"`);
    }
    return n;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<number> {
    // `--list` is an ops command: it must work with nothing but DATABASE_URL, so
    // it opens a bare connection rather than booting the whole engine (which
    // validates chat endpoints, storage, and everything else a backfill run
    // genuinely needs).
    if (has("list")) {
        const url = process.env.DATABASE_URL;
        if (!url) {
            console.error("DATABASE_URL is required");
            return 1;
        }
        const handle = createDb({ url, maxConnections: 1 });
        try {
            const rows = await backfillStatus(handle.db, BACKFILLS);
            if (rows.length === 0) {
                console.log("no backfills registered");
                return 0;
            }
            for (const r of rows) {
                console.log(
                    `${r.status.padEnd(8)} ${r.id.padEnd(32)} ${String(r.processed).padStart(8)} rows  ${r.description}`
                );
            }
            return 0;
        } finally {
            await handle.close();
        }
    }

    const only = arg("only");
    const selected = only ? BACKFILLS.filter(b => b.id === only) : has("all") ? BACKFILLS : [];

    if (selected.length === 0) {
        if (only) {
            console.error(`unknown backfill "${only}". Known ids:`);
            BACKFILLS.forEach(b => console.error(`  ${b.id}`));
        } else {
            console.error("specify --list, --only=<id>, or --all");
        }
        return 1;
    }

    const opts = {
        batchSize: positiveInt("batch"),
        maxBatches: positiveInt("max-batches"),
        dryRun: has("dry-run"),
    };

    // Boot the engine only if something selected actually needs it. A pure-SQL
    // backfill must stay runnable with nothing but DATABASE_URL — requiring chat
    // endpoints to repair legacy rows would be absurd.
    const needsEngine = selected.some(b => b.requiresEngine !== false);
    const url = process.env.DATABASE_URL;
    if (!needsEngine && !url) {
        console.error("DATABASE_URL is required");
        return 1;
    }

    // Pass the full handle, not just .db — the advisory lock is session-scoped
    // and needs a pinned connection.
    const handle = needsEngine ? getEngine().dbHandle : createDb({ url: url!, maxConnections: 2 });
    try {
        for (const b of selected) {
            await runBackfill(handle, b, opts);
        }
    } finally {
        if (!needsEngine) await handle.close();
    }
    return 0;
}

try {
    process.exit(await main());
} catch (err) {
    console.error("[backfill] failed:", err);
    process.exit(1);
}
