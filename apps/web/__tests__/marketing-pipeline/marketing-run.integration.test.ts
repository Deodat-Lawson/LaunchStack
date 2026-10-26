/**
 * Post-writer runs against a real database: the slow-day story end to end.
 *
 * A run is queued, its first attempt finishes some stages and then dies; the
 * row keeps every progress event and every finished stage, the run goes back
 * in the queue, and the next attempt resumes from the checkpoints instead of
 * redoing them. Two executors never run it at once, a poll can tell an
 * abandoned run from a live one, and a run out of attempts ends failed (the
 * screen never polls forever). Gated like the other integration suites.
 */
import { company } from "@launchstack/store/schema";
import { configureDatabase } from "@launchstack/store/client";
import type { runMarketingPipeline } from "@launchstack/pipelines/marketing";
import {
    claimMarketingRun,
    createMarketingRun,
    getMarketingRun,
    listActiveMarketingRuns,
} from "@launchstack/pipelines/marketing/runs";

import { createFounderWeeklyReviewTestDatabase } from "../founderWeeklyReview/testDb";

jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (_companyId: unknown, _feature: unknown, fn: () => unknown) => fn(),
}));

import {
    MAX_ATTEMPTS,
    STALE_MS,
    attemptMarketingRun,
    driveMarketingRun,
    isStalled,
    type ExecutorDeps,
} from "~/server/marketing/executor";
import { toRunView } from "~/server/marketing/run-view";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

const STAGES = ["loading-context", "extracting-dna", "building-strategy", "generating-content"];
const input = { platform: "linkedin" as const, prompt: "Announce the new roast" };

/**
 * A stand-in pipeline with the real contract: it asks the checkpoint before
 * each stage, saves the stage when it succeeds, reports progress, and can be
 * told to die at a stage.
 */
function fakePipeline(dieAt: string | null, ran: string[]): typeof runMarketingPipeline {
    return (async args => {
        for (const step of STAGES) {
            args.onProgress?.({ type: "step_start", step: step as never, label: step });
            if (args.checkpoint?.get(step as never) === undefined) {
                if (step === dieAt) throw new Error("upstream model timed out");
                ran.push(step);
                await args.checkpoint?.put(step as never, { done: step });
            }
            args.onProgress?.({ type: "step_complete", step: step as never, durationMs: 1 });
        }
        return { platform: "linkedin", message: "Light roast, origin first." } as never;
    }) as typeof runMarketingPipeline;
}

describeDb("post-writer runs", () => {
    jest.setTimeout(120_000);

    let testDb: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        configureDatabase(testDb.db);
        const [row] = await testDb.db
            .insert(company)
            .values({ name: "Roastery", numberOfEmployees: "5" })
            .returning();
        companyId = BigInt(row!.id);
    }, 120_000);

    afterAll(async () => {
        await testDb?.close();
    });

    it("a run that dies mid-way keeps its progress and resumes from its checkpoints", async () => {
        const run = await createMarketingRun({ companyId, userId: "u1", input });
        expect(run.status).toBe("queued");

        const ran: string[] = [];
        const first: ExecutorDeps = {
            now: () => new Date(),
            runPipeline: fakePipeline("building-strategy", ran),
        };
        expect(await attemptMarketingRun(run.id, companyId, first)).toBe("retry");

        let stored = (await getMarketingRun(run.id, companyId))!;
        // Back in the queue, with what it finished and what it said.
        expect(stored.status).toBe("queued");
        expect(Object.keys(stored.checkpoints).sort()).toEqual(
            ["extracting-dna", "loading-context"].sort()
        );
        expect(stored.events.map(e => `${e.type}:${(e as { step: string }).step}`)).toEqual([
            "step_start:loading-context",
            "step_complete:loading-context",
            "step_start:extracting-dna",
            "step_complete:extracting-dna",
            "step_start:building-strategy",
        ]);
        // A reload (no cursor) replays everything; a poll with a cursor gets only what's new.
        expect(toRunView(stored).events).toHaveLength(5);
        expect(toRunView(stored, 4).events).toHaveLength(1);
        expect(await listActiveMarketingRuns(companyId, "u1")).toHaveLength(1);

        const second: ExecutorDeps = {
            now: () => new Date(),
            runPipeline: fakePipeline(null, ran),
        };
        expect(await attemptMarketingRun(run.id, companyId, second)).toBe("completed");
        // The first two stages ran once in all: the retry restored them.
        expect(ran).toEqual([
            "loading-context",
            "extracting-dna",
            "building-strategy",
            "generating-content",
        ]);
        stored = (await getMarketingRun(run.id, companyId))!;
        expect(stored.status).toBe("completed");
        expect(stored.attempts).toBe(2);
        expect(toRunView(stored).result).toMatchObject({ message: "Light roast, origin first." });
        expect(toRunView(stored).resumedStages).toBe(4);
        expect(await listActiveMarketingRuns(companyId, "u1")).toHaveLength(0);
        // Another workspace cannot read it.
        expect(await getMarketingRun(run.id, companyId + 1n)).toBeNull();
    });

    it("two executors never run the same run; an abandoned one is taken over", async () => {
        const run = await createMarketingRun({ companyId, userId: "u1", input });
        const now = new Date();
        const stale = new Date(now.getTime() - STALE_MS);
        expect(await claimMarketingRun(run.id, companyId, now, stale)).not.toBeNull();
        // A second executor, same moment: the first holds it.
        expect(await claimMarketingRun(run.id, companyId, now, stale)).toBeNull();
        const live = (await getMarketingRun(run.id, companyId))!;
        expect(isStalled(live, now)).toBe(false);

        // The holder's process died: no heartbeat for longer than STALE_MS.
        const later = new Date(now.getTime() + STALE_MS + 1_000);
        expect(isStalled(live, later)).toBe(true);
        expect(
            await claimMarketingRun(run.id, companyId, later, new Date(later.getTime() - STALE_MS))
        ).not.toBeNull();
    });

    it("a run out of attempts ends failed with a reason, so the screen stops polling", async () => {
        const run = await createMarketingRun({ companyId, userId: "u1", input });
        const deps: ExecutorDeps = {
            now: () => new Date(),
            runPipeline: fakePipeline("loading-context", []),
        };
        expect(await driveMarketingRun(run.id, companyId, deps, 0)).toBe("failed");
        const stored = (await getMarketingRun(run.id, companyId))!;
        expect(stored.status).toBe("failed");
        expect(stored.attempts).toBe(MAX_ATTEMPTS);
        expect(toRunView(stored).error).toMatch(/Failed to run marketing pipeline/);
    });
});
