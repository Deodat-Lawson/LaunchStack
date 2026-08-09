/**
 * Integration tests for the transactional outbox against a real Postgres
 * (ADR-003). Gated on TEST_DATABASE_URL (falling back to DATABASE_URL) —
 * CI provides one; locally run the migrations first:
 *   DATABASE_URL=... node packages/core/scripts/migrate.mjs
 *   DATABASE_URL=... node packages/core/scripts/migrate.mjs --set=product
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

function noteEvent(noteId: number, companyId: number): PipelineEvent {
  return {
    eventId: eventIds.noteEmbeddingRequested(noteId),
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
    const replayed = await store.replay(eventIds.noteEmbeddingRequested(7));
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
    const reclaimed = await store.reclaimStale(new Date(Date.now() - 60 * 60_000));
    expect(reclaimed).toBeGreaterThanOrEqual(1);

    const again = await store.claimBatch(10);
    expect(again.filter((c) => c.event.companyId === companyId)).toHaveLength(1);
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
});
