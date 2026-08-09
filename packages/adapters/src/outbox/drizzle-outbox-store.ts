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
 * Insert events inside the caller's transaction. This is THE way producers
 * that change pipeline state enqueue events — the state change and its
 * event commit or roll back together. Conflicts on event_id are skipped:
 * retried producer transactions converge, and a replayed handler's
 * follow-ups never re-open an already-processed downstream stage.
 */
export async function enqueueOutboxEvents(
  tx: OutboxTx,
  events: PipelineEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const rows = events.map((event) => {
    const parsed = pipelineEventSchema.parse(event);
    return {
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      schemaVersion: parsed.schemaVersion,
      companyId: parsed.companyId,
      payload: parsed as unknown as Record<string, unknown>,
      traceId: parsed.traceId,
    };
  });
  await tx.insert(eventOutbox).values(rows).onConflictDoNothing({
    target: eventOutbox.eventId,
  });
}

/**
 * Insert-or-revive for stable-id request events (e.g. note embedding): a
 * live pending/processing row absorbs the request (the handler reads current
 * state anyway); a processed/dead row returns to `pending` with a fresh
 * attempt budget so the request runs again.
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

export class DrizzleOutboxStore implements OutboxStorePort {
  constructor(
    private readonly db: DbClient,
    private readonly logger: LoggerPort,
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
      RETURNING id, payload, attempt_count
    `);

    const claimed: ClaimedEvent[] = [];
    for (const row of rows as unknown as Array<{
      id: number;
      payload: unknown;
      attempt_count: number;
    }>) {
      const parsed = pipelineEventSchema.safeParse(row.payload);
      if (!parsed.success) {
        // A row that fails contract validation can never succeed; dead-letter
        // it immediately with the validation error for operator inspection.
        const message = `outbox payload failed protocol validation: ${parsed.error.message}`;
        this.logger.error({ outboxId: row.id }, message);
        await this.markFailed(Number(row.id), message, { retryAt: null });
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

  async markProcessed(
    outboxId: number,
    followUps: PipelineEvent[] = [],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE ${eventOutbox}
        SET status = 'processed',
            processed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP,
            last_error = NULL
        WHERE id = ${outboxId}
      `);
      await enqueueOutboxEvents(tx, followUps);
    });
  }

  async markFailed(
    outboxId: number,
    error: string,
    opts: { retryAt: Date | null },
  ): Promise<void> {
    // Truncate so a pathological error message cannot bloat the row.
    const message = error.slice(0, 4000);
    if (opts.retryAt === null) {
      await this.db.execute(sql`
        UPDATE ${eventOutbox}
        SET status = 'dead',
            attempt_count = attempt_count + 1,
            last_error = ${message},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${outboxId}
      `);
      return;
    }
    await this.db.execute(sql`
      UPDATE ${eventOutbox}
      SET status = 'pending',
          attempt_count = attempt_count + 1,
          available_at = ${opts.retryAt.toISOString()},
          claimed_at = NULL,
          last_error = ${message},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${outboxId}
    `);
  }

  async reclaimStale(claimedBefore: Date): Promise<number> {
    const rows = await this.db.execute(sql`
      UPDATE ${eventOutbox}
      SET status = 'pending',
          claimed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'processing'
        AND claimed_at < ${claimedBefore.toISOString()}
      RETURNING id
    `);
    const count = (rows as unknown as unknown[]).length;
    if (count > 0) {
      this.logger.warn(
        { count, claimedBefore: claimedBefore.toISOString() },
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
   * event to `pending`. Handlers are idempotent, so replay converges.
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
