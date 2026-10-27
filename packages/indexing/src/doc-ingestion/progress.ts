/**
 * Stage progress for the Processing queue: the ingestion stages record which
 * step a job is in, as it runs, in `ocr_processing_steps`.
 *
 * One row per (job, stage): id `<jobId>:<stage>`, step_number the stage's
 * 1-based place in `ocrProcessingStepTypes`. `created_at` is when the current
 * attempt of that stage started — the outbox re-runs a stage on retry or
 * stale-claim reclaim, and the re-run simply restarts its row.
 *
 * Fail-soft by contract. This is a progress display, not pipeline state:
 * no write is retried and no write ever throws into the pipeline. A failed
 * write logs one warning and the stage carries on, so a broken progress table
 * can cost a stale bar, never a document. Each write is one small upsert —
 * one per stage start/finish and one per embedding batch.
 *
 * Every write is a full-row upsert built from what this recorder already
 * knows (its start time and the output so far), so a lost `start` heals on
 * the next write instead of leaving the stage blank.
 */
import { and, eq, gt, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";
import {
    ocrProcessingSteps,
    ocrProcessingStepTypes,
    type OcrProcessingStepType,
} from "@launchstack/store/schema";

export type StageStep = OcrProcessingStepType;
export type StageStepOutput = Record<string, unknown>;

type StepStatus = "in_progress" | "completed" | "failed";

/** Keeps a stack-trace-sized message from bloating the row. */
const ERROR_MESSAGE_LIMIT = 2000;

export function stageStepId(jobId: string, step: StageStep): string {
    return `${jobId}:${step}`;
}

export function stageStepNumber(step: StageStep): number {
    return ocrProcessingStepTypes.indexOf(step) + 1;
}

export interface StageProgress {
    /** The stage began (or began again): row → in_progress, timer restarts. */
    start(step: StageStep, output?: StageStepOutput): Promise<void>;
    /** Partial progress — the embed stage reports parent chunks done of total. */
    progress(step: StageStep, done: number, total: number): Promise<void>;
    /** The stage finished: row → completed with its duration; output merges in. */
    complete(step: StageStep, output?: StageStepOutput): Promise<void>;
    /** The stage threw: row → failed with the message and duration. */
    fail(step: StageStep, error: unknown): Promise<void>;
    /** Marks whichever stage is started-but-unfinished as failed, if any. */
    failRunning(error: unknown): Promise<void>;
    /**
     * Deletes this job's rows for every stage after `step`. A new attempt of
     * a stage makes the later stages' rows stale (they describe the previous
     * attempt), so the first step of each stage clears them.
     */
    resetAfter(step: StageStep): Promise<void>;
}

interface StepState {
    startedAt: Date;
    output: StageStepOutput | null;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function createStageProgress(jobId: string): StageProgress {
    const steps = new Map<StageStep, StepState>();
    let running: StageStep | undefined;

    function stateOf(step: StageStep): StepState {
        let state = steps.get(step);
        if (!state) {
            state = { startedAt: new Date(), output: null };
            steps.set(step, state);
        }
        return state;
    }

    /** Runs one write; any failure (including no DB registered) is a warning. */
    async function attempt(
        step: StageStep,
        what: string,
        write: (db: ReturnType<typeof getDb>) => Promise<unknown>
    ): Promise<void> {
        try {
            await write(getDb());
        } catch (error) {
            console.warn(
                `[StageProgress] could not record ${what} of stage "${step}" for job ${jobId} — ` +
                    `ingestion continues: ${errorMessage(error)}`
            );
        }
    }

    function upsert(
        step: StageStep,
        what: string,
        row: { status: StepStatus; errorMessage: string | null; durationMs: number | null },
        restart: boolean
    ): Promise<void> {
        const state = stateOf(step);
        const fields = {
            status: row.status,
            output: state.output,
            errorMessage: row.errorMessage,
            durationMs: row.durationMs,
        };
        return attempt(step, what, db =>
            db
                .insert(ocrProcessingSteps)
                .values({
                    id: stageStepId(jobId, step),
                    jobId,
                    stepNumber: stageStepNumber(step),
                    stepType: step,
                    ...fields,
                    // A start stamps the database clock; a later write that
                    // has to insert (its start was lost) uses the start time
                    // this recorder kept.
                    createdAt: restart ? sql`now()` : state.startedAt,
                })
                .onConflictDoUpdate({
                    target: ocrProcessingSteps.id,
                    set: restart ? { ...fields, createdAt: sql`now()` } : fields,
                })
        );
    }

    function finish(step: StageStep): number {
        if (running === step) running = undefined;
        return Math.max(0, Date.now() - stateOf(step).startedAt.getTime());
    }

    const recorder: StageProgress = {
        start(step, output) {
            running = step;
            steps.set(step, { startedAt: new Date(), output: output ?? null });
            return upsert(
                step,
                "start",
                { status: "in_progress", errorMessage: null, durationMs: null },
                true
            );
        },

        progress(step, done, total) {
            const state = stateOf(step);
            state.output = { ...state.output, done, total };
            return upsert(
                step,
                "progress",
                { status: "in_progress", errorMessage: null, durationMs: null },
                false
            );
        },

        complete(step, output) {
            const state = stateOf(step);
            if (output) state.output = { ...state.output, ...output };
            const durationMs = finish(step);
            return upsert(
                step,
                "completion",
                { status: "completed", errorMessage: null, durationMs },
                false
            );
        },

        fail(step, error) {
            const durationMs = finish(step);
            return upsert(
                step,
                "failure",
                {
                    status: "failed",
                    errorMessage: errorMessage(error).slice(0, ERROR_MESSAGE_LIMIT),
                    durationMs,
                },
                false
            );
        },

        async failRunning(error) {
            if (running) await recorder.fail(running, error);
        },

        resetAfter(step) {
            return attempt(step, "reset of later stages", db =>
                db
                    .delete(ocrProcessingSteps)
                    .where(
                        and(
                            eq(ocrProcessingSteps.jobId, jobId),
                            gt(ocrProcessingSteps.stepNumber, stageStepNumber(step))
                        )
                    )
            );
        },
    };
    return recorder;
}

/**
 * The recorder for a host that runs the stages as durable Inngest steps.
 * Inngest replays a function from the top on every step, re-executing all
 * code outside `step.run`, so progress writes there would restart rows and
 * reset durations on each replay. The Processing queue reads the worker's
 * rows (the outbox path, ADR-003), which runs stages inline.
 */
export const noStageProgress: StageProgress = {
    start: async () => undefined,
    progress: async () => undefined,
    complete: async () => undefined,
    fail: async () => undefined,
    failRunning: async () => undefined,
    resetAfter: async () => undefined,
};
