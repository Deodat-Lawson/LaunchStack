/**
 * A proposals run on the worker, for deployments that set
 * PROPOSALS_EXECUTOR=worker. The same `executeProposalRun` the web process calls
 * after a response; here it runs under Inngest's retries, and a run that
 * fails for good is marked failed so the run sheet never spins forever.
 */
import {
    ProposalRunEventDataSchema,
    executeProposalRun,
    failProposalRun,
} from "@launchstack/pipelines/proposals";

import { createProposalPorts } from "~/server/proposals/ports";

import { inngest } from "../client";

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    return "The run failed";
}

export const proposalsRunJob = inngest.createFunction(
    {
        id: "proposals-run",
        name: "Proposals Run",
        retries: 1,
        concurrency: [{ key: "event.data.companyId", limit: 1 }, { limit: 8 }],
        onFailure: async ({ error, event }) => {
            const parsed = ProposalRunEventDataSchema.safeParse(event.data.event.data);
            if (!parsed.success) {
                console.error("[proposals] Failed run with invalid payload:", parsed.error);
                return;
            }
            try {
                await failProposalRun(
                    {
                        runId: parsed.data.runId,
                        companyId: BigInt(parsed.data.companyId),
                        userId: parsed.data.userId,
                    },
                    toErrorMessage(error)
                );
            } catch (failureError) {
                console.error("[proposals] Could not mark run failed:", failureError);
            }
        },
    },
    { event: "proposals/run.requested" },
    async ({ event, step }) => {
        const data = ProposalRunEventDataSchema.parse(event.data);
        const companyId = BigInt(data.companyId);
        const result = await step.run("execute", async () => {
            const run = await executeProposalRun(
                { runId: data.runId, companyId, userId: data.userId },
                createProposalPorts(companyId)
            );
            return { status: run.status, headline: run.summary?.headline ?? null };
        });
        return result;
    }
);
