/**
 * Integration tests for the outbox-transactional source lifecycle
 * (ADR-003 §2): creating a source version and enqueueing its
 * `source.version.created` event happen in ONE transaction, retries
 * converge on the same rows/event, and re-uploading after a dead pipeline
 * revives the event.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configureDatabase, createDb, type Db } from "../src/db";
import { eventIds } from "@launchstack/protocol";

import {
  createDocumentLifecycle,
  createDocumentVersionLifecycle,
} from "../src/ingestion/source-lifecycle";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("source lifecycle + outbox (integration)", () => {
  let handle: Db;
  let companyId: bigint;

  beforeAll(async () => {
    handle = createDb({ url: url! });
    configureDatabase(handle.db);
    const rows = await handle.client`
      INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
      VALUES ('lifecycle-test-co', '1') RETURNING id
    `;
    companyId = BigInt(rows[0]!.id as number);
  });

  afterAll(async () => {
    if (!handle) return;
    await handle.client`DELETE FROM pdr_ai_v2_company WHERE id = ${String(companyId)}`;
    await handle.close();
  });

  beforeEach(async () => {
    await handle.client`DELETE FROM pdr_ai_v2_event_outbox WHERE company_id = ${String(companyId)}`;
    await handle.client`DELETE FROM pdr_ai_v2_document WHERE company_id = ${String(companyId)}`;
  });

  async function outboxRows() {
    return handle.client`
      SELECT event_id, event_type, status, payload, trace_id
      FROM pdr_ai_v2_event_outbox WHERE company_id = ${String(companyId)}
      ORDER BY id
    `;
  }

  it("creates document + version + job + outbox event atomically", async () => {
    const result = await createDocumentLifecycle({
      companyId,
      userId: "user_test",
      title: "handbook.pdf",
      category: "General",
      url: "/api/files/1",
      creationKey: "upload:/api/files/1",
      mimeType: "application/pdf",
      traceId: "trace-lifecycle-1",
      processing: { originalFilename: "handbook.pdf" },
    });

    expect(result.jobId).not.toBeNull();
    expect(result.versionId).toBeGreaterThan(0);
    expect(result.eventIds).toEqual([]);

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_id).toBe(eventIds.sourceVersionCreated(result.jobId!));
    expect(rows[0]!.event_type).toBe("source.version.created");
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.trace_id).toBe("trace-lifecycle-1");
    const payload = rows[0]!.payload as {
      payload: { sourceId: number; sourceVersionId: number; documentName: string };
    };
    expect(payload.payload.sourceId).toBe(result.documentId);
    expect(payload.payload.sourceVersionId).toBe(result.versionId);
    expect(payload.payload.documentName).toBe("handbook.pdf");
  });

  it("converges retries on the same rows and a single outbox event", async () => {
    const params = {
      companyId,
      userId: "user_test",
      title: "same.pdf",
      category: "General",
      url: "/api/files/2",
      creationKey: "upload:/api/files/2",
      mimeType: "application/pdf" as const,
      processing: { originalFilename: "same.pdf" },
    };
    const first = await createDocumentLifecycle(params);
    const second = await createDocumentLifecycle(params);

    expect(second.documentId).toBe(first.documentId);
    expect(second.versionId).toBe(first.versionId);
    expect(second.jobId).toBe(first.jobId);
    expect(await outboxRows()).toHaveLength(1);
  });

  it("skipProcessing-style creation (no processing) enqueues nothing", async () => {
    const result = await createDocumentLifecycle({
      companyId,
      userId: "user_test",
      title: "audio-source.mp3",
      category: "General",
      url: "/api/files/3",
      creationKey: "upload:/api/files/3:audio-source",
      mimeType: "audio/mpeg",
    });
    expect(result.jobId).toBeNull();
    expect(await outboxRows()).toHaveLength(0);
  });

  it("re-upload after a dead pipeline revives the event and requeues the job", async () => {
    const params = {
      companyId,
      userId: "user_test",
      title: "retry.pdf",
      category: "General",
      url: "/api/files/4",
      creationKey: "upload:/api/files/4",
      mimeType: "application/pdf" as const,
      processing: { originalFilename: "retry.pdf" },
    };
    const first = await createDocumentLifecycle(params);

    // Simulate the pipeline giving up: job failed, event dead.
    await handle.client`
      UPDATE pdr_ai_v2_ocr_jobs SET status = 'failed' WHERE id = ${first.jobId}
    `;
    await handle.client`
      UPDATE pdr_ai_v2_event_outbox
      SET status = 'dead', attempt_count = 8, last_error = 'gave up'
      WHERE company_id = ${String(companyId)}
    `;

    const second = await createDocumentLifecycle(params);
    expect(second.jobId).toBe(first.jobId);
    expect(second.job?.status).toBe("queued");

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
  });

  it("does not disturb a pending event when converging on a queued job", async () => {
    const params = {
      companyId,
      userId: "user_test",
      title: "pending.pdf",
      category: "General",
      url: "/api/files/5",
      creationKey: "upload:/api/files/5",
      mimeType: "application/pdf" as const,
      processing: { originalFilename: "pending.pdf" },
    };
    await createDocumentLifecycle(params);
    const before = await outboxRows();
    await createDocumentLifecycle(params);
    const after = await outboxRows();
    expect(after).toEqual(before);
  });

  it("creates a later version with its own job and event (supersession)", async () => {
    const v1 = await createDocumentLifecycle({
      companyId,
      userId: "user_test",
      title: "versioned.pdf",
      category: "General",
      url: "/api/files/6",
      creationKey: "upload:/api/files/6",
      mimeType: "application/pdf",
      processing: { originalFilename: "versioned.pdf" },
    });

    const v2 = await createDocumentVersionLifecycle({
      documentId: v1.documentId,
      companyId,
      userId: "user_test",
      title: "versioned.pdf",
      category: "General",
      url: "/api/files/6-v2",
      creationKey: "upload:/api/files/6-v2",
      mimeType: "application/pdf",
    });

    expect(v2.versionId).not.toBe(v1.versionId);
    expect(v2.version.versionNumber).toBe(2);
    expect(v2.jobId).not.toBe(v1.jobId);

    // The document's current version pointer flipped (supersession).
    const docRows = await handle.client`
      SELECT current_version_id FROM pdr_ai_v2_document WHERE id = ${v1.documentId}
    `;
    expect(Number(docRows[0]!.current_version_id)).toBe(v2.versionId);

    const rows = await outboxRows();
    expect(rows.map((r) => r.event_id)).toEqual([
      eventIds.sourceVersionCreated(v1.jobId!),
      eventIds.sourceVersionCreated(v2.jobId),
    ]);
  });
});
