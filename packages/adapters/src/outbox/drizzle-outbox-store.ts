/**
 * Postgres implementation of OutboxStorePort over `pdr_ai_v2_event_outbox`
 * (ADR-003). Claiming uses one UPDATE with a FOR UPDATE SKIP LOCKED
 * sub-select — the same shape as the proven founder-weekly-review dispatch
 * service — so concurrent workers never double-claim.
 *
 * Every payload is validated against the protocol schema on write AND on
 * read: a malformed row surfaces at this boundary with its event id, never
 * deep inside a handler.
 */
import { sql } from "drizzle-orm";

import { eventOutbox } from "../db/schema";
import type { DbClient } from "../db";
import {
  pipelineEventSchema,
  type PipelineEvent,
} from "@launchstack/protocol";
import type {
  ClaimedEvent,
  LoggerPort,
  OutboxStorePort,
} from "@launchstack/application";

type OutboxTx = Pick<DbClient, "insert" | "execute">;

/**
 * Insert-or-revive: THE enqueue semantics of the outbox. A live
 * `pending`/`processing` row absorbs the request (the handler reads current
 * state anyway); a `processed` or `dead` row returns to `pending` with a
 * fresh attempt budget so the event runs again.
 *
 * Reviving processed rows is what gives the pipeline clean cascade-replay
 * semantics (docs/runbooks/outbox.md): replaying stage N re-enqueues its
 * follow-ups through this path on completion, so stages N+1..end re-run even
 * when their rows had already been processed — or had dead-lettered — before
 * the replay. All handlers are idempotent, so the cascade converges.
 */
export async function enqueueOutboxEventsWithRevive(
  tx: OutboxTx,
  events: PipelineEvent[],
): Promise<void> {
  for (const event of events) {
    const parsed = pipelineEventSchema.parse(event);
    await tx
      .insert(eventOutbox)
      .values({
        eventId: parsed.eventId,
        eventType: parsed.eventType,
        schemaVersion: parsed.schemaVersion,
        companyId: parsed.companyId,
        payload: parsed as unknown as Record<string, unknown>,
        traceId: parsed.traceId,
      })
      .onConflictDoUpdate({
        target: eventOutbox.eventId,
        set: {
          status: "pending",
          availableAt: sql`CURRENT_TIMESTAMP`,
          attemptCount: 0,
          claimedAt: null,
          lastError: null,
          payload: parsed as unknown as Record<string, unknown>,
          traceId: parsed.traceId,
          updatedAt: new Date(),
        },
        setWhere: sql`${eventOutbox.status} IN ('processed', 'dead')`,
      });
  }
}

export interface DrizzleOutboxStoreOptions {
  /**
   * Failure-visibility hook for rows dead-lettered at claim time because
   * their payload failed protocol validation. Those rows never become a
   * `ClaimedEvent`, so the tick-level `onDead` hook cannot see them — this
   * callback is the only signal the worker gets. Hook errors are logged,
   * never thrown.
   */
  onValidationDead?: (
    outboxId: number,
    eventId: string,
  ) => void | Promise<void>;
}

export class DrizzleOutboxStore implements OutboxStorePort {
  constructor(
    private readonly db: DbClient,
    private readonly logger: LoggerPort,
    private readonly opts: DrizzleOutboxStoreOptions = {},
  ) {}

  async enqueue(events: PipelineEvent[]): Promise<void> {
    await enqueueOutboxEventsWithRevive(this.db, events);
  }

  async claimBatch(batchSize: number): Promise<ClaimedEvent[]> {
    const rows = await this.db.execute(sql`
      UPDATE ${eventOutbox}
      SET status = 'processing',
          claimed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT id FROM ${eventOutbox}
        WHERE status = 'pending'
          AND available_at <= CURRENT_TIMESTAMP
        ORDER BY created_at, id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_id, payload, attempt_count
    `);

    const claimed: ClaimedEvent[] = [];
    for (const row of rows as unknown as Array<{
      id: number;
      event_id: string;
      payload: unknown;
      attempt_count: number;
    }>) {
      const parsed = pipelineEventSchema.safeParse(row.payload);
      if (!parsed.success) {
        // A row that fails contract validation can never succeed; dead-letter
        // it immediately with the validation error for operator inspection.
        // No ClaimedEvent exists for it, so the tick-level onDead hook never
        // fires — visibility runs through the onValidationDead callback.
        const message = `outbox payload failed protocol validation: ${parsed.error.message}`;
        this.logger.error(
          { outboxId: row.id, eventId: row.event_id },
          `${message} (dead-lettered at claim; tick-level onDead does not fire for this row)`,
        );
        await this.markFailed(Number(row.id), message, { retryAt: null });
        if (this.opts.onValidationDead) {
          try {
            await this.opts.onValidationDead(
              Number(row.id),
              String(row.event_id),
            );
          } catch (hookError) {
            this.logger.error(
              { outboxId: row.id, error: String(hookError) },
              "onValidationDead hook failed",
            );
          }
        }
        continue;
      }
      claimed.push({
        outboxId: Number(row.id),
        event: parsed.data,
        attemptCount: Number(row.attempt_count),
      });
    }
    return claimed;
  }

  /**
   * Mark a claimed row processed and enqueue its follow-ups in the same
   * transaction. Follow-ups go through the revive path: an already-processed
   * or dead downstream row returns to `pending`, which is what makes
   * operator replay of stage N cascade through stages N+1..end.
   *
   * Guarded on `status = 'processing'`: if the row was reclaimed while this
   * claimant was working (stale claim), its late outcome is discarded and
   * follow-ups are NOT enqueued — the re-processing claimant will enqueue
   * them when it finishes.
   */
  async markProcessed(
    outboxId: number,
    followUps: PipelineEvent[] = [],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE ${eventOutbox}
        SET status = 'processed',
            processed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP,
            last_error = NULL
        WHERE id = ${outboxId}
          AND status = 'processing'
        RETURNING id
      `);
      if ((rows as unknown as unknown[]).length === 0) {
        this.logger.warn(
          { outboxId },
          "stale claimant outcome discarded; row was reclaimed",
        );
        return;
      }
      await enqueueOutboxEventsWithRevive(tx, followUps);
    });
  }

  /**
   * Record a handler failure. Guarded on `status = 'processing'` like
   * markProcessed: a stale claimant that lost its claim to the reclaimer
   * must not dead-letter or reschedule a row it no longer owns.
   */
  async markFailed(
    outboxId: number,
    error: string,
    opts: { retryAt: Date | null },
  ): Promise<void> {
    // Truncate so a pathological error message cannot bloat the row.
    const message = error.slice(0, 4000);
    const rows =
      opts.retryAt === null
        ? await this.db.execute(sql`
            UPDATE ${eventOutbox}
            SET status = 'dead',
                attempt_count = attempt_count + 1,
                last_error = ${message},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${outboxId}
              AND status = 'processing'
            RETURNING id
          `)
        : await this.db.execute(sql`
            UPDATE ${eventOutbox}
            SET status = 'pending',
                attempt_count = attempt_count + 1,
                available_at = ${opts.retryAt.toISOString()},
                claimed_at = NULL,
                last_error = ${message},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${outboxId}
              AND status = 'processing'
            RETURNING id
          `);
    if ((rows as unknown as unknown[]).length === 0) {
      this.logger.warn(
        { outboxId },
        "stale claimant outcome discarded; row was reclaimed",
      );
    }
  }

  /**
   * Return stale `processing` rows (worker died mid-handler) to `pending`.
   * Every reclaim counts as one consumed attempt — a crash-poison event
   * (one that kills its worker before markFailed can run) must not loop
   * forever. Rows whose incremented count reaches `maxAttempts` go `dead`
   * with an explanatory last_error instead.
   */
  async reclaimStale(claimedBefore: Date, maxAttempts: number): Promise<number> {
    const rows = await this.db.execute(sql`
      UPDATE ${eventOutbox}
      SET attempt_count = attempt_count + 1,
          status = CASE
            WHEN attempt_count + 1 >= ${maxAttempts} THEN 'dead'
            ELSE 'pending'
          END,
          last_error = CASE
            WHEN attempt_count + 1 >= ${maxAttempts}
            THEN 'reclaimed after stale claim; attempts exhausted'
            ELSE last_error
          END,
          claimed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'processing'
        AND claimed_at < ${claimedBefore.toISOString()}
      RETURNING id, status
    `);
    const reclaimed = rows as unknown as Array<{ id: number; status: string }>;
    const count = reclaimed.length;
    if (count > 0) {
      const dead = reclaimed.filter((r) => r.status === "dead").length;
      this.logger.warn(
        { count, dead, claimedBefore: claimedBefore.toISOString() },
        "reclaimed stale outbox claims (worker died mid-handler?)",
      );
    }
    return count;
  }

  async countDead(): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT count(*)::int AS dead FROM ${eventOutbox} WHERE status = 'dead'
    `);
    const first = (rows as unknown as Array<{ dead: number }>)[0];
    return first ? Number(first.dead) : 0;
  }

  /**
   * Operator replay (docs/runbooks/outbox.md): return a dead or processed
   * event to `pending`. Handlers are idempotent, so replay converges — and
   * because markProcessed enqueues follow-ups through the revive path, the
   * replay cascades through every downstream stage.
   */
  async replay(eventId: string): Promise<boolean> {
    const rows = await this.db.execute(sql`
      UPDATE ${eventOutbox}
      SET status = 'pending',
          available_at = CURRENT_TIMESTAMP,
          claimed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE event_id = ${eventId}
        AND status IN ('dead', 'processed', 'processing')
      RETURNING id
    `);
    return (rows as unknown as unknown[]).length > 0;
  }
}
