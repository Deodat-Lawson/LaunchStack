import { eq, sql } from "drizzle-orm";

import type { Db, DbClient } from "../index";
import { type BackfillCursor, dataBackfills } from "../schema/ops";

/**
 * Data backfills: resumable, individually invocable rewrites of existing rows.
 *
 * Explicitly separate from migrations. See the note on `dataBackfills` in
 * ../schema/ops.ts for why.
 */

export interface BackfillContext {
    db: DbClient;
    /** Resume point returned by the previous `step`, or null on first run. */
    cursor: BackfillCursor;
    batchSize: number;
}

export interface BackfillResult {
    /** Next resume point, or null when there is nothing left to do. */
    cursor: BackfillCursor | null;
    /** Rows handled in this batch. */
    processed: number;
}

export interface Backfill {
    /** Stable, never reused. Convention: `YYYY-MM-slug`. */
    id: string;
    description: string;
    /**
     * Optional journal tag this backfill depends on beyond the ledger itself.
     * Set it when a backfill writes columns introduced by a specific migration;
     * the runner refuses to start until that tag is recorded as applied.
     *
     * Leave unset for a backfill that only needs the schema to exist — the
     * ledger table is always checked. Do NOT point this at a baseline tag:
     * baselines are regenerated, and the tag would go stale.
     */
    requiresMigration?: string;
    /**
     * Process at most `batchSize` rows and return the next cursor. MUST be
     * re-entrant: it is called repeatedly, and may be interrupted between calls.
     *
     * If any row fails, advance the cursor only as far as the last SUCCESSFUL
     * row and throw. Swallowing the error and advancing past it silently drops
     * work that a re-run can never pick up again.
     */
    step(ctx: BackfillContext): Promise<BackfillResult>;

    /**
     * Whether this backfill needs the full application engine (embedding
     * providers, storage, LLM config). Pure-SQL backfills set this to `false` so
     * they can be run in an ops context with nothing but DATABASE_URL — which is
     * exactly the situation you are usually in when recovering legacy rows.
     * Defaults to `true`.
     */
    requiresEngine?: boolean;

    /**
     * Optional read-only estimate of remaining work, used by `--dry-run`.
     * MUST NOT mutate anything. Without it, a dry run reports ledger state only
     * — it never calls `step`, because `step` writes.
     */
    estimate?(ctx: Omit<BackfillContext, "batchSize">): Promise<number>;
}

// Distinct from BOTH migration locks — engine (4919/1) and product (4919/2) —
// so a long backfill can never block a deploy.
const LOCK_CLASS = 4919;
const LOCK_BACKFILLS = 3;

export const DEFAULT_BATCH_SIZE = 500;

export interface RunOptions {
    batchSize?: number;
    /** Stop after N batches — used by tests to simulate an interrupted run. */
    maxBatches?: number;
    dryRun?: boolean;
    log?: (msg: string) => void;
}

/**
 * The ledger's own precondition is the ledger TABLE, not a migration tag.
 *
 * Tags change whenever a baseline is regenerated (squash, or splitting the
 * engine and product sets), and a stale constant here would make every backfill
 * refuse to start with a confusing "migration not applied" error. Checking the
 * table is both the real requirement and immune to that.
 */
async function assertLedgerTable(db: DbClient) {
    const rows = await db.execute<{ ok: boolean }>(
        sql`SELECT to_regclass('pdr_ai_v2_data_backfills') IS NOT NULL AS ok`
    );
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    if (!(list[0] as { ok?: boolean } | undefined)?.ok) {
        throw new Error(
            "the data_backfills ledger table does not exist. " +
                "Run `pnpm --filter @launchstack/web db:migrate` first."
        );
    }
}

async function assertMigrationApplied(db: DbClient, tag: string) {
    const rows = await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM _launchstack_migrations
       WHERE tag = ${tag} AND state = 'applied'
    ) AS ok
  `);
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    const ok = (list[0] as { ok?: boolean } | undefined)?.ok;
    if (!ok) {
        throw new Error(
            `backfill requires migration ${tag}, which is not applied to this database. ` +
                `Run the engine migrations first: \`node packages/core/scripts/migrate.mjs\`.`
        );
    }
}

/**
 * Runs one backfill to completion (or to `maxBatches`), resuming if needed.
 *
 * Takes the full `Db` handle rather than just the drizzle client: the advisory
 * lock is SESSION-scoped, so it must be taken and released on one pinned
 * connection. Issuing it through the pool can unlock on a different backend
 * than it locked, stranding the lock until the pool recycles.
 */
export async function runBackfill(
    handle: Db,
    backfill: Backfill,
    opts: RunOptions = {}
): Promise<{ processed: number; done: boolean }> {
    const { db, client } = handle;
    const log = opts.log ?? ((m: string) => console.log(`[backfill] ${m}`));
    const batchSize =
        Number.isFinite(opts.batchSize) && (opts.batchSize ?? 0) > 0
            ? Math.floor(opts.batchSize!)
            : DEFAULT_BATCH_SIZE;

    await assertLedgerTable(db);
    if (backfill.requiresMigration) {
        await assertMigrationApplied(db, backfill.requiresMigration);
    }

    // Serialise operators against each other without touching the deploy lock.
    // Pinned connection: a session lock released on a different pooled backend
    // is a no-op, and the real lock would then be held until that backend dies.
    const cx = await client.reserve();
    const [lockRow] = await cx`
    SELECT pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_BACKFILLS}) AS locked`;
    if (!lockRow?.locked) {
        cx.release();
        throw new Error("another backfill run is in progress (advisory lock held)");
    }

    try {
        const [existing] = await db
            .select()
            .from(dataBackfills)
            .where(eq(dataBackfills.id, backfill.id))
            .limit(1);

        if (existing?.status === "done") {
            log(`${backfill.id}: already complete (${existing.processed} rows) — nothing to do`);
            return { processed: 0, done: true };
        }

        if (opts.dryRun) {
            // Deliberately does NOT call `step` — steps write (the note backfill
            // calls embedNote, which deletes and inserts rows and spends money).
            // A dry run reports ledger state, plus a read-only estimate when the
            // backfill provides one.
            const from = existing?.cursor ?? null;
            log(
                `${backfill.id}: dry run — status=${existing?.status ?? "pending"}, ` +
                    `resume cursor=${JSON.stringify(from)}, batch size=${batchSize}`
            );
            if (backfill.estimate) {
                const remaining = await backfill.estimate({ db, cursor: from });
                log(`${backfill.id}: dry run — ${remaining} row(s) remaining`);
            } else {
                log(`${backfill.id}: dry run — no estimate() implemented; nothing was executed`);
            }
            return { processed: 0, done: false };
        }

        if (!existing) {
            await db.insert(dataBackfills).values({
                id: backfill.id,
                status: "running",
                startedAt: new Date(),
                updatedAt: new Date(),
            });
        } else {
            await db
                .update(dataBackfills)
                .set({ status: "running", updatedAt: new Date(), error: null })
                .where(eq(dataBackfills.id, backfill.id));
            log(`${backfill.id}: resuming from ${JSON.stringify(existing.cursor)}`);
        }

        let cursor = existing?.cursor ?? null;
        let total = existing?.processed ?? 0;
        let batches = 0;

        try {
            for (;;) {
                const r = await backfill.step({ db, cursor, batchSize });
                total += r.processed;
                cursor = r.cursor;
                batches += 1;

                // Persist after every batch — this is what makes a kill -9 resumable
                // rather than a restart.
                await db
                    .update(dataBackfills)
                    .set({ cursor, processed: total, updatedAt: new Date() })
                    .where(eq(dataBackfills.id, backfill.id));

                if (r.processed > 0) log(`${backfill.id}: ${total} row(s) processed`);
                if (cursor === null) break;
                if (opts.maxBatches && batches >= opts.maxBatches) {
                    log(`${backfill.id}: stopping after ${batches} batch(es) as requested`);
                    return { processed: total, done: false };
                }
            }
        } catch (e) {
            await db
                .update(dataBackfills)
                .set({
                    status: "failed",
                    error: e instanceof Error ? e.message : String(e),
                    updatedAt: new Date(),
                })
                .where(eq(dataBackfills.id, backfill.id));
            throw e;
        }

        await db
            .update(dataBackfills)
            .set({
                status: "done",
                completedAt: new Date(),
                updatedAt: new Date(),
                processed: total,
            })
            .where(eq(dataBackfills.id, backfill.id));

        log(`${backfill.id}: complete — ${total} row(s)`);
        return { processed: total, done: true };
    } finally {
        await cx`SELECT pg_advisory_unlock(${LOCK_CLASS}, ${LOCK_BACKFILLS})`.catch(
            () => undefined
        );
        cx.release();
    }
}

/** Current ledger state for a set of backfills, for `--list` / `status`. */
export async function backfillStatus(db: DbClient, registry: Backfill[]) {
    const rows = await db.select().from(dataBackfills);
    const byId = new Map(rows.map(r => [r.id, r]));
    return registry.map(b => ({
        id: b.id,
        description: b.description,
        status: byId.get(b.id)?.status ?? "pending",
        processed: byId.get(b.id)?.processed ?? 0,
    }));
}
