/**
 * A post-writer run on the worker, for deployments that set
 * MARKETING_EXECUTOR=worker. One attempt per Inngest attempt: a failure with
 * attempts left puts the run back in the queue and throws, so Inngest retries
 * it — and the retry resumes from the stages the last attempt checkpointed
 * instead of redoing them. A run that fails for good is marked failed so the
 * screen never polls forever.
 */
import { finishMarketingRun } from "@launchstack/pipelines/marketing/runs";

import { attemptMarketingRun, failureMessage } from "~/server/marketing/executor";

import { inngest } from "../client";

export class MarketingRunRetry extends Error {
    constructor(runId: string) {
        super(`Post-writer run ${runId} failed an attempt; retrying from its checkpoints`);
        this.name = "MarketingRunRetry";
    }
}

export const marketingRunJob = inngest.createFunction(
    {
        id: "marketing-run",
        name: "Post writer run",
        // Three executions in all, matching MAX_ATTEMPTS (the run row counts them too;
        // Inngest wants a literal here).
        retries: 2,
        concurrency: [{ key: "event.data.companyId", limit: 2 }, { limit: 8 }],
        onFailure: async ({ error, event }) => {
            const runId = String(event.data.event.data.runId ?? "");
            if (!runId) return;
            try {
                await finishMarketingRun(runId, {
                    status: "failed",
                    errorMessage: failureMessage(error),
                });
            } catch (failureError) {
                console.error("[marketing-run] Could not mark run failed:", failureError);
            }
        },
    },
    { event: "marketing/run.requested" },
    async ({ event, step, attempt }) => {
        const { runId } = event.data;
        // attemptMarketingRun enters the workspace's model scope itself, inside the step.
        const outcome = await step.run(`attempt-${attempt}`, () =>
            attemptMarketingRun(runId, BigInt(event.data.companyId))
        );
        if (outcome === "retry") throw new MarketingRunRetry(runId);
        return { runId, outcome };
    }
);
