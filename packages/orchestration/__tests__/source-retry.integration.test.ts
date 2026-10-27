/**
 * Integration tests for retrying a failed source (the Sources rail's Retry):
 * the earliest dead stage is revived — not the whole pipeline — the job is
 * requeued with its retry counted, and the failure stamp lifts without
 * taking the row's own metadata with it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configureDatabase, createDb, type Db } from "@launchstack/store/client";
import { eventIds } from "../src/pipeline-events";

import {
    createDocumentLifecycle,
    retrySourceProcessing,
    type CreatedDocumentLifecycle,
} from "../src/source-lifecycle/lifecycle";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const FAILURE_STAMP = {
    error: "processing_failed",
    errorMessage: "pipeline event dead: OpenAI API error: 429 - RESOURCE_EXHAUSTED",
    failedAt: "2026-10-23T00:00:00.000Z",
};

describe.skipIf(!url)("retrying a failed source (integration)", () => {
    let handle: Db;
    let companyId: bigint;
    let otherCompanyId: bigint;

    beforeAll(async () => {
        handle = createDb({ url: url! });
        configureDatabase(handle.db);
        const rows = await handle.client`
      INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
      VALUES ('retry-test-co', '1'), ('retry-test-other', '1') RETURNING id
    `;
        companyId = BigInt(rows[0]!.id as number);
        otherCompanyId = BigInt(rows[1]!.id as number);
    });

    afterAll(async () => {
        if (!handle) return;
        await handle.client`
      DELETE FROM pdr_ai_v2_company WHERE id IN (${String(companyId)}, ${String(otherCompanyId)})
    `;
        await handle.close();
    });

    beforeEach(async () => {
        await handle.client`DELETE FROM pdr_ai_v2_event_outbox WHERE company_id = ${String(companyId)}`;
        await handle.client`DELETE FROM pdr_ai_v2_document WHERE company_id = ${String(companyId)}`;
    });

    let uploads = 0;
    async function upload(): Promise<CreatedDocumentLifecycle> {
        uploads += 1;
        return createDocumentLifecycle({
            companyId,
            userId: "user_test",
            title: `book-${uploads}.pdf`,
            category: "Books",
            url: `/api/files/retry-${uploads}`,
            creationKey: `upload:/api/files/retry-${uploads}`,
            mimeType: "application/pdf",
            // Provenance a connector or transcript would carry — must survive.
            ocrMetadata: { marker: "keep-me" },
            processing: { originalFilename: `book-${uploads}.pdf` },
        });
    }

    /** What the dead-event handler leaves behind when `stage` exhausts its attempts. */
    async function failAt(lifecycle: CreatedDocumentLifecycle, stage: "extract" | "index") {
        const jobId = lifecycle.jobId!;
        await handle.client`
      UPDATE pdr_ai_v2_ocr_jobs
      SET status = 'failed', error_message = ${FAILURE_STAMP.errorMessage},
          completed_at = now(),
          progress = ${JSON.stringify({ stage: "embedding", done: 100, total: 267, updatedAt: "x" })}::jsonb
      WHERE id = ${jobId}
    `;
        const stamp = JSON.stringify({ marker: "keep-me", ...FAILURE_STAMP });
        await handle.client`
      UPDATE pdr_ai_v2_document SET ocr_metadata = ${stamp}::jsonb WHERE id = ${lifecycle.documentId}
    `;
        await handle.client`
      UPDATE pdr_ai_v2_document_versions SET ocr_metadata = ${stamp}::jsonb
      WHERE id = ${lifecycle.versionId}
    `;
        if (stage === "extract") {
            await handle.client`
        UPDATE pdr_ai_v2_event_outbox
        SET status = 'dead', attempt_count = 8, last_error = 'gave up'
        WHERE event_id = ${eventIds.sourceVersionCreated(jobId)}
      `;
            return;
        }
        await handle.client`
      UPDATE pdr_ai_v2_event_outbox SET status = 'processed', processed_at = now()
      WHERE event_id = ${eventIds.sourceVersionCreated(jobId)}
    `;
        await handle.client`
      INSERT INTO pdr_ai_v2_event_outbox
        (event_id, event_type, schema_version, company_id, payload, trace_id, status, attempt_count, last_error)
      VALUES (${eventIds.evidenceVersionExtracted(jobId)}, 'evidence.version.extracted', 1,
              ${String(companyId)}, '{}'::jsonb, ${jobId}, 'dead', 8, '429 RESOURCE_EXHAUSTED')
      ON CONFLICT (event_id) DO UPDATE SET status = 'dead', attempt_count = 8
    `;
    }

    async function outbox(jobId: string) {
        const rows = await handle.client`
      SELECT event_id, status, attempt_count, last_error FROM pdr_ai_v2_event_outbox
      WHERE trace_id = ${jobId} OR event_id LIKE ${"%:" + jobId}
      ORDER BY id
    `;
        return Object.fromEntries(rows.map(row => [row.event_id as string, row]));
    }

    async function job(jobId: string) {
        const [row] = await handle.client`
      SELECT status, error_message, retry_count, progress, completed_at
      FROM pdr_ai_v2_ocr_jobs WHERE id = ${jobId}
    `;
        return row!;
    }

    async function metadata(lifecycle: CreatedDocumentLifecycle) {
        const [doc] = await handle.client`
      SELECT ocr_metadata FROM pdr_ai_v2_document WHERE id = ${lifecycle.documentId}
    `;
        const [version] = await handle.client`
      SELECT ocr_metadata FROM pdr_ai_v2_document_versions WHERE id = ${lifecycle.versionId}
    `;
        return { document: doc!.ocr_metadata, version: version!.ocr_metadata };
    }

    function retry(lifecycle: CreatedDocumentLifecycle, company = companyId) {
        return retrySourceProcessing({
            companyId: company,
            documentId: lifecycle.documentId,
            userId: "user_retry",
        });
    }

    it("re-runs indexing — not OCR — when indexing is the stage that died", async () => {
        const lifecycle = await upload();
        const jobId = lifecycle.jobId!;
        await failAt(lifecycle, "index");

        const result = await retry(lifecycle);

        expect(result).toEqual({
            status: "retrying",
            jobId,
            stage: "evidence.version.extracted",
            retryCount: 1,
        });
        const rows = await outbox(jobId);
        expect(rows[eventIds.evidenceVersionExtracted(jobId)]).toMatchObject({
            status: "pending",
            attempt_count: 0,
            last_error: null,
        });
        // Extraction already succeeded; it is left alone.
        expect(rows[eventIds.sourceVersionCreated(jobId)]).toMatchObject({ status: "processed" });

        expect(await job(jobId)).toMatchObject({
            status: "queued",
            error_message: null,
            retry_count: 1,
            progress: null,
            completed_at: null,
        });
        // The failure lifts; the row's own metadata stays.
        expect(await metadata(lifecycle)).toEqual({
            document: { marker: "keep-me" },
            version: { marker: "keep-me" },
        });
    });

    it("revives extraction when that is where it died", async () => {
        const lifecycle = await upload();
        const jobId = lifecycle.jobId!;
        await failAt(lifecycle, "extract");

        const result = await retry(lifecycle);

        expect(result).toMatchObject({ status: "retrying", stage: "source.version.created" });
        expect((await outbox(jobId))[eventIds.sourceVersionCreated(jobId)]).toMatchObject({
            status: "pending",
            attempt_count: 0,
        });
    });

    it("re-enqueues extraction when the job failed with no dead stage", async () => {
        const lifecycle = await upload();
        const jobId = lifecycle.jobId!;
        await failAt(lifecycle, "extract");
        // Failed some other way: every stage row finished.
        await handle.client`
      UPDATE pdr_ai_v2_event_outbox SET status = 'processed' WHERE trace_id = ${jobId}
    `;

        const result = await retry(lifecycle);

        expect(result).toMatchObject({ status: "retrying", stage: "source.version.created" });
        const row = (await outbox(jobId))[eventIds.sourceVersionCreated(jobId)];
        expect(row).toMatchObject({ status: "pending", attempt_count: 0 });
    });

    it("counts every retry, and a second click converges instead of double-queueing", async () => {
        const lifecycle = await upload();
        const jobId = lifecycle.jobId!;
        await failAt(lifecycle, "index");

        await retry(lifecycle);
        // The job is queued now — a second press is a no-op, not a second replay.
        await expect(retry(lifecycle)).resolves.toEqual({
            status: "not_failed",
            jobStatus: "queued",
        });

        // It fails again; the next retry is the second.
        await failAt(lifecycle, "index");
        await expect(retry(lifecycle)).resolves.toMatchObject({ jobId, retryCount: 2 });
    });

    it("refuses while a stage is still pending or running", async () => {
        const lifecycle = await upload();
        await handle.client`
      UPDATE pdr_ai_v2_ocr_jobs SET status = 'failed' WHERE id = ${lifecycle.jobId}
    `;
        // The creation's own event is still pending.
        await expect(retry(lifecycle)).resolves.toEqual({ status: "already_running" });
    });

    it("leaves a healthy job alone", async () => {
        const lifecycle = await upload();
        await expect(retry(lifecycle)).resolves.toEqual({
            status: "not_failed",
            jobStatus: "queued",
        });
    });

    it("cannot reach another workspace's document", async () => {
        const lifecycle = await upload();
        await failAt(lifecycle, "index");

        await expect(retry(lifecycle, otherCompanyId)).resolves.toEqual({ status: "not_found" });
        expect((await job(lifecycle.jobId!)).status).toBe("failed");
    });
});
