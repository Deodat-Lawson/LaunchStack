/**
 * Distribution discovery run on the worker (design §4.6 "Background jobs").
 *
 * Every mode runs here: live providers with the research agent, or keyless
 * public directories with the page profiler. Stages 1–4 are one step; every
 * candidate's research is its own step so a retry replays completed
 * candidates instead of re-researching them; the summary is the last step.
 * Stop is honoured between candidates: the pipeline reads the run row's
 * cancel flag before each one. Publishing dossiers into Sources and
 * metering are host ports because they need apps/web's storage and ledger.
 */
import {
    DistributionRunEventDataSchema,
    enrichCandidate,
    failRun,
    finalizeRun,
    prepareRun,
    type EnrichCandidateResult,
} from "@launchstack/pipelines/distribution";
import { getProgram, getRun } from "@launchstack/pipelines/distribution/db";

import { inngest } from "../client";
import { portsForMode } from "~/server/prospects/host-ports";
import { recordRunFinished, recordCandidate } from "~/server/prospects/metrics";

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    try {
        return JSON.stringify(error);
    } catch {
        return "Unknown distribution pipeline error";
    }
}

export const distributionRunJob = inngest.createFunction(
    {
        id: "distribution-run",
        name: "Distribution Discovery Run",
        retries: 1,
        concurrency: [{ key: "event.data.companyId", limit: 2 }, { limit: 8 }],
        onFailure: async ({ error, event }) => {
            const parsed = DistributionRunEventDataSchema.safeParse(event.data.event.data);
            if (!parsed.success) {
                console.error("[distribution] Failed run with invalid payload:", parsed.error);
                return;
            }
            try {
                const companyId = BigInt(parsed.data.companyId);
                const run = await getRun(parsed.data.runId, companyId);
                await failRun({ runId: parsed.data.runId, companyId }, toErrorMessage(error));
                recordRunFinished(run?.options.mode ?? "live", "failed", run);
            } catch (failureError) {
                console.error("[distribution] Could not mark run failed:", failureError);
            }
        },
    },
    { event: "distribution/run.requested" },
    async ({ event, step }) => {
        const data = DistributionRunEventDataSchema.parse(event.data);
        const companyId = BigInt(data.companyId);
        const ctx = { runId: data.runId, companyId, programId: data.programId };

        // The run row decides the mode, not the event: what was queued is what runs.
        const mode = await step.run("load", async () => {
            const run = await getRun(data.runId, companyId);
            if (!run) throw new Error("Run not found");
            return run.options.mode;
        });

        const ports = async () => {
            const program = await getProgram(data.programId, companyId);
            if (!program) throw new Error("Program not found");
            return portsForMode(mode, {
                companyId,
                userId: data.userId,
                requestUrl: data.requestUrl,
                program,
            });
        };

        const startedAtIso = await step.run("start", async () => new Date().toISOString());

        const prepared = await step.run("prepare", async () => prepareRun(ctx, await ports()));

        const results: EnrichCandidateResult[] = [];
        for (const [index, relationshipId] of prepared.candidateRelationshipIds.entries()) {
            const result = await step.run(`enrich-${index}`, async () =>
                enrichCandidate(ctx, await ports(), { relationshipId, profile: prepared.profile })
            );
            results.push(result);
            recordCandidate(mode, result.status);
            // The stop flag is read inside enrichCandidate; a cancelled result
            // means nothing after it should start.
            if (result.status === "cancelled") break;
        }

        const summary = await step.run("finalize", () =>
            finalizeRun(ctx, prepared, results, new Date(startedAtIso))
        );
        const finished = await getRun(data.runId, companyId);
        recordRunFinished(mode, finished?.status === "stopped" ? "stopped" : "completed", finished);
        return {
            status: finished?.status ?? "completed",
            enriched: summary.enriched,
            shortlisted: summary.shortlisted,
        };
    }
);
