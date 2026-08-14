/**
 * Integration tests for the transactional outbox against a real Postgres
 * (ADR-003). Gated on TEST_DATABASE_URL (falling back to DATABASE_URL) —
 * CI provides one; locally run the migrations first:
 *   DATABASE_URL=... node packages/core/scripts/migrate.mjs
 *   DATABASE_URL=... node packages/core/scripts/migrate.mjs --set=product
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

import { createDb, type Db } from "../src/db";
import { eventIds, PROTOCOL_VERSION } from "@launchstack/protocol";
import type { PipelineEvent } from "@launchstack/protocol";

import { DrizzleOutboxStore } from "../src/outbox/drizzle-outbox-store";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// A fixed fingerprint stands in for the producer's updatedAt epoch-ms: the
// tests below exercise retries/replays of the SAME logical edit, which
// share one deterministic event id.
function noteEvent(
  noteId: number,
  companyId: number,
  fingerprint = "fp1",
): PipelineEvent {
  return {
    eventId: eventIds.noteEmbeddingRequested(noteId, fingerprint),
    eventType: "note.embedding.requested",
    schemaVersion: PROTOCOL_VERSION,
    occurredAt: new Date().toISOString(),
    traceId: `test-${noteId}`,
    companyId,
    payload: { noteId, reason: "created" },
  };
}

describe.skipIf(!url)("DrizzleOutboxStore (integration)", () => {
  let handle: Db;
  let store: DrizzleOutboxStore;
  let companyId: number;

  beforeAll(async () => {
    handle = createDb({ url: url! });
    store = new DrizzleOutboxStore(handle.db, silentLogger);
    const rows = await handle.client`
      INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
      VALUES ('outbox-test-co', '1') RETURNING id
    `;
    companyId = Number(rows[0]!.id);
  });

  afterAll(async () => {
    if (!handle) return;
    await handle.client`DELETE FROM pdr_ai_v2_company WHERE id = ${companyId}`;
    await handle.close();
  });

  beforeEach(async () => {
    await handle.client`DELETE FROM pdr_ai_v2_event_outbox WHERE company_id = ${companyId}`;
  });

  it("enqueues, claims exactly once, and marks processed", async () => {
    await store.enqueue([noteEvent(1, companyId)]);

    const claimed = await store.claimBatch(10);
    const mine = claimed.filter((c) => c.event.companyId === companyId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.event.eventType).toBe("note.embedding.requested");

    // A second claim while the first is processing gets nothing.
    const second = await store.claimBatch(10);
    expect(second.filter((c) => c.event.companyId === companyId)).toHaveLength(0);

    await store.markProcessed(mine[0]!.outboxId);
    const rows = await handle.client`
      SELECT status, processed_at FROM pdr_ai_v2_event_outbox
      WHERE company_id = ${companyId}
    `;
    expect(rows[0]!.status).toBe("processed");
    expect(rows[0]!.processed_at).not.toBeNull();
  });

  it("is idempotent on event id: double enqueue yields one live row", async () => {
    await store.enqueue([noteEvent(2, companyId)]);
    await store.enqueue([noteEvent(2, companyId)]);
    const rows = await handle.client`
      SELECT count(*)::int AS n FROM pdr_ai_v2_event_outbox WHERE company_id = ${companyId}
    `;
    expect(rows[0]!.n).toBe(1);
  });

  it("revives a processed stable-id event on re-enqueue", async () => {
    await store.enqueue([noteEvent(3, companyId)]);
    const [claimed] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    await store.markProcessed(claimed!.outboxId);

    // The note changed again — the same stable event id must go live again.
    await store.enqueue([noteEvent(3, companyId)]);
    const rows = await handle.client`
      SELECT status, attempt_count FROM pdr_ai_v2_event_outbox WHERE company_id = ${companyId}
    `;
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.attempt_count).toBe(0);
  });

  it("markProcessed atomically enqueues follow-up events", async () => {
    await store.enqueue([noteEvent(4, companyId)]);
    const [claimed] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    await store.markProcessed(claimed!.outboxId, [noteEvent(5, companyId)]);

    const rows = await handle.client`
      SELECT event_id, status FROM pdr_ai_v2_event_outbox
      WHERE company_id = ${companyId} ORDER BY id
    `;
    expect(rows).toHaveLength(2);
    expect(rows[1]!.status).toBe("pending");
  });

  it("schedules retries with a future available_at and honors it", async () => {
    await store.enqueue([noteEvent(6, companyId)]);
    const [claimed] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    const retryAt = new Date(Date.now() + 60_000);
    await store.markFailed(claimed!.outboxId, "handler exploded", { retryAt });

    // Not yet due — must not be claimable.
    const reclaim = await store.claimBatch(10);
    expect(reclaim.filter((c) => c.event.companyId === companyId)).toHaveLength(0);

    const rows = await handle.client`
      SELECT status, attempt_count, last_error FROM pdr_ai_v2_event_outbox
      WHERE company_id = ${companyId}
    `;
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.attempt_count).toBe(1);
    expect(rows[0]!.last_error).toBe("handler exploded");
  });

  it("moves an event to dead and supports operator replay", async () => {
    await store.enqueue([noteEvent(7, companyId)]);
    const [claimed] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    await store.markFailed(claimed!.outboxId, "terminal", { retryAt: null });

    expect(await store.countDead()).toBeGreaterThanOrEqual(1);
    const notClaimable = await store.claimBatch(10);
    expect(notClaimable.filter((c) => c.event.companyId === companyId)).toHaveLength(0);

    // Operator replay (docs/runbooks/outbox.md): dead → pending → claimable.
    const replayed = await store.replay(eventIds.noteEmbeddingRequested(7, "fp1"));
    expect(replayed).toBe(true);
    const again = await store.claimBatch(10);
    expect(again.filter((c) => c.event.companyId === companyId)).toHaveLength(1);
  });

  it("reclaims stale processing claims from a crashed worker", async () => {
    await store.enqueue([noteEvent(8, companyId)]);
    const [claimed] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    expect(claimed).toBeDefined();

    // Simulate a crash: the claim is never resolved. Backdate it.
    await handle.client`
      UPDATE pdr_ai_v2_event_outbox
      SET claimed_at = CURRENT_TIMESTAMP - INTERVAL '2 hours'
      WHERE id = ${claimed!.outboxId}
    `;
    const reclaimed = await store.reclaimStale(
      new Date(Date.now() - 60 * 60_000),
      8,
    );
    expect(reclaimed).toBeGreaterThanOrEqual(1);

    // Each reclaim consumes one attempt.
    const rows = await handle.client`
      SELECT attempt_count FROM pdr_ai_v2_event_outbox WHERE id = ${claimed!.outboxId}
    `;
    expect(rows[0]!.attempt_count).toBe(1);

    const again = await store.claimBatch(10);
    expect(again.filter((c) => c.event.companyId === companyId)).toHaveLength(1);
  });

  it("dead-letters a stale claim whose attempts are exhausted by the reclaim", async () => {
    // A crash-poison event: the handler kills its worker before markFailed
    // can ever record the failure, so only reclaims consume its attempts.
    await store.enqueue([noteEvent(20, companyId)]);
    const [claimed] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    await handle.client`
      UPDATE pdr_ai_v2_event_outbox
      SET attempt_count = 7,
          claimed_at = CURRENT_TIMESTAMP - INTERVAL '2 hours'
      WHERE id = ${claimed!.outboxId}
    `;

    const reclaimed = await store.reclaimStale(
      new Date(Date.now() - 60 * 60_000),
      8,
    );
    expect(reclaimed).toBeGreaterThanOrEqual(1);

    const rows = await handle.client`
      SELECT status, attempt_count, last_error
      FROM pdr_ai_v2_event_outbox WHERE id = ${claimed!.outboxId}
    `;
    expect(rows[0]!.status).toBe("dead");
    expect(rows[0]!.attempt_count).toBe(8);
    expect(rows[0]!.last_error).toBe(
      "reclaimed after stale claim; attempts exhausted",
    );
  });

  it("returns a stale claim with remaining attempts to pending, counting the attempt", async () => {
    await store.enqueue([noteEvent(21, companyId)]);
    const [claimed] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    await handle.client`
      UPDATE pdr_ai_v2_event_outbox
      SET attempt_count = 2,
          claimed_at = CURRENT_TIMESTAMP - INTERVAL '2 hours'
      WHERE id = ${claimed!.outboxId}
    `;

    await store.reclaimStale(new Date(Date.now() - 60 * 60_000), 8);

    const rows = await handle.client`
      SELECT status, attempt_count FROM pdr_ai_v2_event_outbox
      WHERE id = ${claimed!.outboxId}
    `;
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.attempt_count).toBe(3);
  });

  it("discards a stale claimant's late outcome after its claim was reclaimed", async () => {
    await store.enqueue([noteEvent(22, companyId)]);
    const [firstClaim] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );

    // The reclaimer decides the first claimant is dead and takes the claim
    // back (force-reclaim simulation: backdate, then reclaim).
    await handle.client`
      UPDATE pdr_ai_v2_event_outbox
      SET claimed_at = CURRENT_TIMESTAMP - INTERVAL '2 hours'
      WHERE id = ${firstClaim!.outboxId}
    `;
    await store.reclaimStale(new Date(Date.now() - 60 * 60_000), 8);

    // The first claimant was actually alive and now reports a terminal
    // failure — it must NOT dead-letter a row it no longer owns.
    await store.markFailed(firstClaim!.outboxId, "late terminal failure", {
      retryAt: null,
    });
    // Nor may its late success clobber the row or enqueue follow-ups.
    await store.markProcessed(firstClaim!.outboxId, [noteEvent(23, companyId)]);

    const rows = await handle.client`
      SELECT event_id, status, last_error FROM pdr_ai_v2_event_outbox
      WHERE company_id = ${companyId} ORDER BY id
    `;
    expect(rows).toHaveLength(1); // no follow-up row for note 23
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.last_error).not.toBe("late terminal failure");

    // The row is still claimable by the re-processing worker.
    const again = await store.claimBatch(10);
    expect(again.filter((c) => c.event.companyId === companyId)).toHaveLength(1);
  });

  it("cascade replay: replaying an upstream row revives its dead downstream row", async () => {
    // Chain A → B: A processed with follow-up B; B dead-letters.
    await store.enqueue([noteEvent(30, companyId)]);
    const [a] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    await store.markProcessed(a!.outboxId, [noteEvent(31, companyId)]);
    const [b] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    expect(b!.event.eventId).toBe(eventIds.noteEmbeddingRequested(31, "fp1"));
    await store.markFailed(b!.outboxId, "terminal", { retryAt: null });

    // Operator replays A (docs/runbooks/outbox.md). The dead B row must not
    // block the chain: when A completes, its follow-up enqueue revives B.
    const replayed = await store.replay(
      eventIds.noteEmbeddingRequested(30, "fp1"),
    );
    expect(replayed).toBe(true);

    const [aAgain] = (await store.claimBatch(10)).filter(
      (c) => c.event.companyId === companyId,
    );
    expect(aAgain!.event.eventId).toBe(
      eventIds.noteEmbeddingRequested(30, "fp1"),
    );
    await store.markProcessed(aAgain!.outboxId, [noteEvent(31, companyId)]);

    const rows = await handle.client`
      SELECT status, attempt_count FROM pdr_ai_v2_event_outbox
      WHERE event_id = ${eventIds.noteEmbeddingRequested(31, "fp1")}
    `;
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.attempt_count).toBe(0);
  });

  it("dead-letters rows whose payload fails contract validation", async () => {
    await handle.db.execute(sql`
      INSERT INTO pdr_ai_v2_event_outbox
        (event_id, event_type, schema_version, company_id, payload, trace_id)
      VALUES
        ('corrupt:1', 'note.embedding.requested', 1, ${companyId}, '{"garbage": true}'::jsonb, 'test')
    `);
    const claimed = await store.claimBatch(10);
    expect(
      claimed.filter((c) => c.event.eventId === "corrupt:1"),
    ).toHaveLength(0);
    const rows = await handle.client`
      SELECT status FROM pdr_ai_v2_event_outbox WHERE event_id = 'corrupt:1'
    `;
    expect(rows[0]!.status).toBe("dead");
  });

  it("notifies onValidationDead when a malformed payload is dead-lettered", async () => {
    // Validation-dead rows never become a ClaimedEvent, so the tick-level
    // onDead hook cannot see them — the constructor callback is the
    // worker's failure-visibility channel for them.
    const onValidationDead = vi.fn();
    const observingStore = new DrizzleOutboxStore(handle.db, silentLogger, {
      onValidationDead,
    });
    await handle.db.execute(sql`
      INSERT INTO pdr_ai_v2_event_outbox
        (event_id, event_type, schema_version, company_id, payload, trace_id)
      VALUES
        ('corrupt:2', 'note.embedding.requested', 1, ${companyId}, '{"garbage": true}'::jsonb, 'test')
    `);

    const claimed = await observingStore.claimBatch(10);
    expect(claimed.filter((c) => c.event.eventId === "corrupt:2")).toHaveLength(0);

    const rows = await handle.client`
      SELECT id, status FROM pdr_ai_v2_event_outbox WHERE event_id = 'corrupt:2'
    `;
    expect(rows[0]!.status).toBe("dead");
    expect(onValidationDead).toHaveBeenCalledWith(Number(rows[0]!.id), "corrupt:2");
  });
});
