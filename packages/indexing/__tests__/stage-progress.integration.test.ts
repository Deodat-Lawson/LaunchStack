/**
 * The stage-progress recorder against a real ocr_processing_steps table:
 * the upsert restarts a row in place, output lands as a JSON object the
 * Processing queue can read (not a JSON-encoded string), and resetAfter
 * clears only the later stages of this job.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureDatabase, createDb, type Db } from "@launchstack/store/client";

import { createStageProgress } from "../src/doc-ingestion/progress";

const url = process.env.TEST_DATABASE_URL;

interface StepRow {
    id: string;
    step_number: number;
    step_type: string;
    status: string;
    output: unknown;
    error_message: string | null;
    duration_ms: number | null;
    /** drizzle's postgres-js driver leaves timestamps as strings on the raw client. */
    created_at: string;
}

describe.skipIf(!url)("stage progress recorder (integration)", () => {
    let handle: Db;
    let companyId: string;
    const jobId = `stage-progress-${randomUUID()}`;

    beforeAll(async () => {
        handle = createDb({ url: url! });
        configureDatabase(handle.db);
        const rows = await handle.client`
      INSERT INTO pdr_ai_v2_company (name, "numberOfEmployees")
      VALUES ('stage-progress-test-co', '1') RETURNING id
    `;
        companyId = String(rows[0]!.id);
        await handle.client`
      INSERT INTO pdr_ai_v2_ocr_jobs (id, company_id, user_id, document_url, document_name)
      VALUES (${jobId}, ${companyId}, 'user_test', '/api/files/stage-progress', 'scan.pdf')
    `;
    });

    afterAll(async () => {
        if (!handle) return;
        await handle.client`DELETE FROM pdr_ai_v2_ocr_jobs WHERE id = ${jobId}`;
        await handle.client`DELETE FROM pdr_ai_v2_company WHERE id = ${companyId}`;
        await handle.close();
    });

    async function rows(): Promise<StepRow[]> {
        return handle.client<StepRow[]>`
      SELECT id, step_number, step_type, status, output, error_message, duration_ms, created_at
      FROM pdr_ai_v2_ocr_processing_steps WHERE job_id = ${jobId} ORDER BY step_number
    `;
    }

    it("records a stage's whole life and restarts it in place on a retry", async () => {
        const first = createStageProgress(jobId);
        await first.start("route");
        await first.complete("route", { provider: "AZURE", pages: 4 });
        await first.start("read");
        await first.complete("read", { provider: "AZURE", pages: 4 });
        await first.start("embed", { done: 0, total: 120 });
        await first.progress("embed", 50, 120);
        await first.fail("embed", new Error("embedding provider 503"));

        let current = await rows();
        expect(current.map(r => [r.id, r.step_number, r.status])).toEqual([
            [`${jobId}:route`, 1, "completed"],
            [`${jobId}:read`, 2, "completed"],
            [`${jobId}:embed`, 4, "failed"],
        ]);
        const failed = current[2]!;
        expect(failed.output).toEqual({ done: 50, total: 120 });
        expect(typeof failed.output).toBe("object");
        expect(failed.error_message).toBe("embedding provider 503");
        expect(failed.duration_ms).toBeGreaterThanOrEqual(0);
        const firstStart = new Date(failed.created_at).getTime();

        // The outbox retries indexing: a new recorder restarts the same row.
        await new Promise(resolve => setTimeout(resolve, 20));
        const retry = createStageProgress(jobId);
        await retry.start("embed", { done: 0, total: 120 });
        current = await rows();
        const restarted = current.find(r => r.step_type === "embed")!;
        expect(current).toHaveLength(3);
        expect(restarted).toMatchObject({
            status: "in_progress",
            output: { done: 0, total: 120 },
            error_message: null,
            duration_ms: null,
        });
        expect(new Date(restarted.created_at).getTime()).toBeGreaterThan(firstStart);

        await retry.progress("embed", 120, 120);
        await retry.complete("embed");
        expect((await rows()).find(r => r.step_type === "embed")).toMatchObject({
            status: "completed",
            output: { done: 120, total: 120 },
        });
    });

    it("resetAfter drops only the later stages of this job", async () => {
        await createStageProgress(jobId).resetAfter("read");
        expect((await rows()).map(r => r.step_type)).toEqual(["route", "read"]);

        await createStageProgress(jobId).resetAfter("route");
        expect((await rows()).map(r => r.step_type)).toEqual(["route"]);
    });
});
