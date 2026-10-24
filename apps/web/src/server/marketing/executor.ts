/**
 * Where a post-writer run executes, and how it survives a slow day.
 *
 * The post writer is ten stages and roughly a minute of model calls. It used
 * to run inside the web request that streamed its progress, so a closed tab,
 * a dropped connection or a slow step lost the whole run and nothing was
 * kept. Now the route only queues a `marketing_runs` row; the run executes
 * off the request path and writes as it goes:
 *
 * - every progress event is appended to the row (the screen polls them);
 * - every stage that succeeds is checkpointed, so a retry resumes after it;
 * - a heartbeat says the executor is alive.
 *
 * By default the web process runs it after the response (`after()`); a poll
 * that finds the heartbeat stale picks it up again from its checkpoints. A
 * deployment with the worker attached sets MARKETING_EXECUTOR=worker to run
 * it as an Inngest function instead (the company search's path).
 */
import { after } from "next/server";

import { runMarketingPipeline } from "@launchstack/pipelines/marketing";
import {
    appendMarketingRunEvents,
    claimMarketingRun,
    finishMarketingRun,
    heartbeatMarketingRun,
    requeueMarketingRun,
    saveMarketingRunCheckpoint,
    type MarketingRunEvent,
    type MarketingRunRecord,
} from "@launchstack/pipelines/marketing/runs";

import { inngest } from "~/server/inngest/client";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

export type MarketingExecutor = "inline" | "worker";

export function readMarketingExecutor(
    env: Record<string, string | undefined> = process.env
): MarketingExecutor {
    return env.MARKETING_EXECUTOR?.trim().toLowerCase() === "worker" ? "worker" : "inline";
}

/** No heartbeat for this long and an unfinished run counts as abandoned. */
export const STALE_MS = 90_000;
/** Attempts (each resuming from the last one's checkpoints) before a run fails for good. */
export const MAX_ATTEMPTS = 3;

export type AttemptOutcome = "completed" | "failed" | "retry" | "skipped";

/** What the screen shows when a run fails, with a hint for the usual misconfigurations. */
export function failureMessage(error: unknown): string {
    const raw = (error instanceof Error ? error.message : String(error)).toLowerCase();
    const hint =
        raw.includes("chat_base_url") ||
        raw.includes("chat model") ||
        raw.includes("route") ||
        raw.includes("api_key")
            ? " Ensure CHAT_BASE_URL (and CHAT_API_KEY if required) are set and the chat model configuration file is valid."
            : raw.includes("company")
              ? " Ensure your user has a valid company profile."
              : "";
    return `Failed to run marketing pipeline${hint}`;
}

export interface ExecutorDeps {
    now: () => Date;
    runPipeline: typeof runMarketingPipeline;
}

const defaultDeps: ExecutorDeps = { now: () => new Date(), runPipeline: runMarketingPipeline };

/**
 * One attempt at a run: claim it, run the pipeline from its checkpoints, and
 * record the outcome. "retry" means the attempt failed with attempts left
 * and the run is back in the queue; "skipped" means another executor holds
 * it or it already finished.
 */
export async function attemptMarketingRun(
    runId: string,
    companyId: bigint,
    deps: ExecutorDeps = defaultDeps
): Promise<AttemptOutcome> {
    const now = deps.now();
    const run = await claimMarketingRun(runId, companyId, now, new Date(now.getTime() - STALE_MS));
    if (!run) return "skipped";

    const heartbeat = setInterval(() => {
        heartbeatMarketingRun(runId).catch((error: unknown) =>
            console.warn("[marketing-run] heartbeat failed:", error)
        );
    }, STALE_MS / 3);
    // Progress arrives from parallel stages; append in arrival order.
    let writes: Promise<void> = Promise.resolve();
    const record = (event: MarketingRunEvent) => {
        writes = writes
            .then(() => appendMarketingRunEvents(runId, [event]))
            .catch((error: unknown) => console.warn("[marketing-run] event write failed:", error));
    };
    const checkpoints = { ...run.checkpoints };

    try {
        const result = await withWorkspaceChatModels(companyId, () =>
            deps.runPipeline({
                companyId: Number(companyId),
                input: run.input,
                debug: run.debug,
                onProgress: record,
                checkpoint: {
                    get: step => checkpoints[step],
                    put: async (step, value) => {
                        checkpoints[step] = value;
                        await saveMarketingRunCheckpoint(runId, step, value);
                    },
                },
            })
        );
        await writes;
        await finishMarketingRun(runId, { status: "completed", result }, deps.now());
        return "completed";
    } catch (error) {
        await writes;
        if (run.attempts < MAX_ATTEMPTS) {
            console.warn(
                `[marketing-run] ${runId}: attempt ${run.attempts} of ${MAX_ATTEMPTS} failed, will resume from ${Object.keys(checkpoints).length} saved stage(s):`,
                error
            );
            await requeueMarketingRun(runId);
            return "retry";
        }
        console.error(`[marketing-run] ${runId} failed:`, error);
        await finishMarketingRun(
            runId,
            { status: "failed", errorMessage: failureMessage(error) },
            deps.now()
        );
        return "failed";
    } finally {
        clearInterval(heartbeat);
    }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Drive a run to the end in this process: attempts with a short backoff between them. */
export async function driveMarketingRun(
    runId: string,
    companyId: bigint,
    deps: ExecutorDeps = defaultDeps,
    backoffMs = 2000
): Promise<AttemptOutcome> {
    for (let i = 1; ; i++) {
        const outcome = await attemptMarketingRun(runId, companyId, deps);
        if (outcome !== "retry") return outcome;
        await sleep(backoffMs * i);
    }
}

/** Hand a new run to the executor. */
export async function dispatchMarketingRun(
    run: Pick<MarketingRunRecord, "id" | "companyId">
): Promise<void> {
    if (readMarketingExecutor() === "worker") {
        await inngest.send({
            name: "marketing/run.requested",
            data: { runId: run.id, companyId: run.companyId.toString() },
        });
        return;
    }
    after(async () => {
        try {
            await driveMarketingRun(run.id, run.companyId);
        } catch (error) {
            console.error("[marketing-run] executor crashed:", error);
        }
    });
}

/**
 * Whether a polled run's inline executor went away (a restart, a crash, a
 * deploy) and the poll should pick it up again.
 */
export function isStalled(
    run: Pick<MarketingRunRecord, "status" | "heartbeatAt" | "createdAt">,
    now = new Date()
): boolean {
    const staleBefore = now.getTime() - STALE_MS;
    if (run.status === "running") return (run.heartbeatAt?.getTime() ?? 0) < staleBefore;
    if (run.status === "queued") return run.createdAt.getTime() < staleBefore;
    return false;
}

/** Resume a stalled inline run from its checkpoints. A no-op for the worker. */
export function resumeIfStalled(
    run: Pick<MarketingRunRecord, "id" | "companyId" | "status" | "heartbeatAt" | "createdAt">,
    now = new Date()
): boolean {
    if (readMarketingExecutor() !== "inline" || !isStalled(run, now)) return false;
    after(async () => {
        try {
            await driveMarketingRun(run.id, run.companyId);
        } catch (error) {
            console.error("[marketing-run] resume failed:", error);
        }
    });
    return true;
}
