/**
 * A scenario run on the worker, for deployments that set
 * SCENARIOS_EXECUTOR=worker. One `step.run` per unit (brief, cast, each
 * round, report), so a restart replays finished units from Inngest's memo
 * and redoes at most the unit in flight — which `advanceRun` commits with a
 * compare-and-set, so it never applies twice.
 */
import { advanceRun } from "@launchstack/pipelines/scenarios";
import { createScenarioStore } from "@launchstack/pipelines/scenarios/db";

import { createScenarioPorts } from "~/server/scenarios/executor";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { inngest } from "../client";

/** brief + cast + 30 rounds + report, plus slack for skipped units. */
const MAX_UNITS = 40;

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    return "The run failed";
}

export const scenarioRunJob = inngest.createFunction(
    {
        id: "scenario-run",
        name: "Scenario Run",
        retries: 2,
        concurrency: [{ key: "event.data.companyId", limit: 2 }, { limit: 6 }],
        onFailure: async ({ error, event }) => {
            const runId = Number(event.data.event.data.runId);
            if (!Number.isInteger(runId)) return;
            try {
                await createScenarioStore().finish(
                    runId,
                    "failed",
                    toErrorMessage(error),
                    new Date()
                );
            } catch (failureError) {
                console.error("[scenarios] Could not mark run failed:", failureError);
            }
        },
    },
    { event: "scenarios/run.requested" },
    async ({ event, step }) => {
        const runId = Number(event.data.runId);
        // Units count against whoever started the run; a run under way is never stopped.
        const aiUse = {
            feature: "scenarios",
            userId: event.data.userId ?? null,
            enforce: false,
        } as const;
        let last = "skipped";
        for (let i = 0; i < MAX_UNITS; i++) {
            // A step body doesn't inherit the handler's async context: enter the
            // workspace's model scope inside the step.
            const outcome = await step.run(`unit-${i}`, () =>
                withWorkspaceChatModels(BigInt(event.data.companyId), aiUse, () =>
                    advanceRun(createScenarioPorts(), runId)
                )
            );
            last = outcome.state;
            if (outcome.state !== "advanced") break;
        }
        return { runId, state: last };
    }
);
