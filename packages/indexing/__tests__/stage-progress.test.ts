/**
 * The stage-progress recorder (ocr_processing_steps): row shape, the write
 * each call makes, and the fail-soft contract — a broken progress table must
 * never surface as an ingestion error.
 */
import { is, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ocrProcessingSteps, ocrProcessingStepTypes } from "@launchstack/store/schema";

import { createStageProgress, stageStepId, stageStepNumber } from "../src/doc-ingestion/progress";

interface Upsert {
    kind: "upsert";
    values: Record<string, unknown>;
    set: Record<string, unknown>;
    target: unknown;
}
interface Delete {
    kind: "delete";
    where: SQL;
}
type Write = Upsert | Delete;

const fake = vi.hoisted(() => ({
    writes: [] as unknown[],
    /** "reject" → the query rejects; "throw" → getDb() itself throws. */
    failure: undefined as undefined | "reject" | "throw",
}));

vi.mock("@launchstack/store/client", async importOriginal => {
    const original = await importOriginal<Record<string, unknown>>();
    const run = async (write: unknown) => {
        if (fake.failure === "reject") throw new Error("connection terminated");
        fake.writes.push(write);
    };
    const db = {
        insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => ({
                onConflictDoUpdate: (config: { target: unknown; set: Record<string, unknown> }) => {
                    expect(table).toBe(ocrProcessingSteps);
                    return run({ kind: "upsert", values, set: config.set, target: config.target });
                },
            }),
        }),
        delete: (table: unknown) => ({
            where: (where: SQL) => {
                expect(table).toBe(ocrProcessingSteps);
                return run({ kind: "delete", where });
            },
        }),
    };
    return {
        ...original,
        getDb: () => {
            if (fake.failure === "throw") throw new Error("No DbClient registered");
            return db;
        },
    };
});

const writes = () => fake.writes as Write[];
const upserts = () => writes().filter((w): w is Upsert => w.kind === "upsert");
const isNow = (value: unknown) =>
    is(value, SQL) && new PgDialect().sqlToQuery(value).sql === "now()";

beforeEach(() => {
    fake.writes.length = 0;
    fake.failure = undefined;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("stage progress row shape", () => {
    it("ids rows <jobId>:<stage> and numbers stages 1..5 in pipeline order", () => {
        expect(stageStepId("ocr-job-1", "embed")).toBe("ocr-job-1:embed");
        expect(ocrProcessingStepTypes.map(stageStepNumber)).toEqual([1, 2, 3, 4, 5]);
        expect(stageStepNumber("route")).toBe(1);
        expect(stageStepNumber("finalize")).toBe(5);
    });
});

describe("stage progress writes", () => {
    it("start upserts an in_progress row stamped with the database clock", async () => {
        await createStageProgress("job-a").start("read");

        expect(upserts()).toHaveLength(1);
        const [write] = upserts();
        expect(write!.target).toBe(ocrProcessingSteps.id);
        expect(write!.values).toMatchObject({
            id: "job-a:read",
            jobId: "job-a",
            stepNumber: 2,
            stepType: "read",
            status: "in_progress",
            output: null,
            errorMessage: null,
            durationMs: null,
        });
        expect(isNow(write!.values.createdAt)).toBe(true);
        // A restart resets the attempt's start time and clears the last outcome.
        expect(write!.set).toMatchObject({
            status: "in_progress",
            errorMessage: null,
            durationMs: null,
        });
        expect(isNow(write!.set.createdAt)).toBe(true);
    });

    it("start → progress per batch → complete merges output and records the duration", async () => {
        const progress = createStageProgress("job-b");
        await progress.start("embed", { done: 0, total: 120 });
        vi.advanceTimersByTime(400);
        await progress.progress("embed", 50, 120);
        vi.advanceTimersByTime(400);
        await progress.progress("embed", 100, 120);
        vi.advanceTimersByTime(700);
        await progress.complete("embed", { done: 120, total: 120, stored: 118 });

        const rows = upserts();
        expect(rows.map(w => [w.values.status, w.values.output])).toEqual([
            ["in_progress", { done: 0, total: 120 }],
            ["in_progress", { done: 50, total: 120 }],
            ["in_progress", { done: 100, total: 120 }],
            ["completed", { done: 120, total: 120, stored: 118 }],
        ]);
        const completion = rows[3]!;
        expect(completion.values.durationMs).toBe(1500);
        expect(completion.set).toMatchObject({ status: "completed", durationMs: 1500 });
        // Only a start moves the attempt's start time.
        expect(completion.set).not.toHaveProperty("createdAt");
        expect(rows[1]!.set).not.toHaveProperty("createdAt");
    });

    it("complete without a recorded start still inserts a whole row (a lost start heals)", async () => {
        await createStageProgress("job-c").complete("finalize");

        const [write] = upserts();
        expect(write!.values).toMatchObject({
            id: "job-c:finalize",
            stepNumber: 5,
            status: "completed",
            durationMs: 0,
        });
        expect(write!.values.createdAt).toEqual(new Date("2026-10-17T12:00:00Z"));
    });

    it("fail records the message (truncated) and the duration", async () => {
        const progress = createStageProgress("job-d");
        await progress.start("chunk");
        vi.advanceTimersByTime(250);
        await progress.fail("chunk", new Error("x".repeat(5000)));

        const failure = upserts()[1]!;
        expect(failure.values.status).toBe("failed");
        expect(failure.values.durationMs).toBe(250);
        expect(failure.values.errorMessage).toBe("x".repeat(2000));
        expect(failure.set).toMatchObject({ status: "failed", durationMs: 250 });
    });

    it("failRunning fails the started-but-unfinished stage, and only that one", async () => {
        const progress = createStageProgress("job-e");
        await progress.start("chunk");
        await progress.complete("chunk", { chunks: 3 });
        await progress.start("embed", { done: 0, total: 3 });
        await progress.failRunning(new Error("embedding provider 503"));

        const last = upserts().at(-1)!;
        expect(last.values).toMatchObject({
            id: "job-e:embed",
            status: "failed",
            errorMessage: "embedding provider 503",
            output: { done: 0, total: 3 },
        });

        // Nothing is running after a completion → no write.
        const idle = createStageProgress("job-f");
        await idle.start("read");
        await idle.complete("read");
        const before = writes().length;
        await idle.failRunning(new Error("later"));
        expect(writes()).toHaveLength(before);
    });

    it("resetAfter deletes only this job's rows for the later stages", async () => {
        await createStageProgress("job-g").resetAfter("route");

        const [write] = writes();
        expect(write!.kind).toBe("delete");
        const query = new PgDialect().sqlToQuery((write as Delete).where);
        expect(query.sql).toBe(
            '("pdr_ai_v2_ocr_processing_steps"."job_id" = $1 and "pdr_ai_v2_ocr_processing_steps"."step_number" > $2)'
        );
        expect(query.params).toEqual(["job-g", 1]);
    });
});

describe("stage progress is fail-soft", () => {
    it.each(["reject", "throw"] as const)(
        "never throws when the write %ss — one warning per call instead",
        async failure => {
            fake.failure = failure;
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const progress = createStageProgress("job-h");

            await expect(progress.resetAfter("read")).resolves.toBeUndefined();
            await expect(progress.start("embed", { done: 0, total: 2 })).resolves.toBeUndefined();
            await expect(progress.progress("embed", 1, 2)).resolves.toBeUndefined();
            await expect(progress.complete("embed")).resolves.toBeUndefined();
            await expect(progress.fail("finalize", new Error("boom"))).resolves.toBeUndefined();
            await expect(progress.failRunning(new Error("boom"))).resolves.toBeUndefined();

            expect(writes()).toHaveLength(0);
            expect(warn).toHaveBeenCalledTimes(5);
            expect(warn.mock.calls[1]![0]).toContain('stage "embed" for job job-h');
        }
    );
});
