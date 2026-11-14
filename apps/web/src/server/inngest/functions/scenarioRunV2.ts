/**
 * Contract v2 scenario runs on the worker (SCENARIOS_EXECUTOR=worker).
 *
 * `scenario-run-v2` performs one unit per `step.run`; every step claims the
 * run's fenced lease itself, so a replayed step, a duplicate delivery or a
 * second function run can never commit or charge a unit twice. A unit waiting
 * on the graph service sleeps here until its backoff passes. When Inngest
 * gives up on a step nothing is marked failed from outside the lease: the
 * unit's own attempt count fails the run, and the reconciler re-dispatches a
 * run that nothing is driving.
 *
 * `scenario-run-v2-reconciler` runs every minute: delivers dispatches that
 * were never published, re-dispatches stalled runs, releases holds left on
 * finished runs and purges old raw replies.
 */
import { getRunById } from "@launchstack/pipelines/scenarios/db";
import { stepV2, type AdvanceV2Outcome } from "@launchstack/pipelines/scenarios/v2/engine";

import { createEngineDeps } from "~/server/scenarios/v2/deps";
import { reconcileScenarioRunsV2, SCENARIO_RUN_V2_EVENT } from "~/server/scenarios/v2/dispatch";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { inngest } from "../client";

/** Units plus waits; a 30-round graph run has well under 100 units. */
const MAX_STEPS = 500;

/** A step's result as Inngest memoizes it (JSON: the retry time as a string). */
export interface ScenarioStepResult {
    state: AdvanceV2Outcome["state"];
    unitKey?: string;
    reason?: string;
    retryAt?: string;
}

function toStepResult(outcome: AdvanceV2Outcome): ScenarioStepResult {
    switch (outcome.state) {
        case "advanced":
            return { state: outcome.state, unitKey: outcome.unitKey };
        case "waiting":
            return {
                state: outcome.state,
                unitKey: outcome.unitKey,
                retryAt: outcome.retryAt.toISOString(),
            };
        case "skipped":
            return { state: outcome.state, reason: outcome.reason };
        default:
            return { state: outcome.state };
    }
}

/** One unit, in the workspace's model scope, counted against the run's creator. */
export async function runScenarioUnitV2(
    runId: number,
    companyId: bigint
): Promise<ScenarioStepResult> {
    const run = await getRunById(runId);
    if (!run) return { state: "skipped", reason: "missing" };
    const aiUse = {
        feature: "scenarios",
        userId: run.createdByUserId,
        enforce: false,
    } as const;
    const outcome = await withWorkspaceChatModels(companyId, aiUse, () =>
        stepV2(createEngineDeps(), runId)
    );
    return toStepResult(outcome);
}

export const scenarioRunV2Job = inngest.createFunction(
    {
        id: "scenario-run-v2",
        name: "Scenario Run (v2)",
        retries: 2,
        concurrency: [{ key: "event.data.companyId", limit: 2 }, { limit: 6 }],
        onFailure: async ({ error, event }) => {
            console.error(
                `[scenarios:v2] run ${String(event.data.event.data.runId)} gave up a delivery; the reconciler resumes it:`,
                error
            );
        },
    },
    { event: SCENARIO_RUN_V2_EVENT },
    async ({ event, step }) => {
        const runId = Number(event.data.runId);
        const companyId = BigInt(event.data.companyId);
        let last: ScenarioStepResult = { state: "skipped", reason: "no_ready_unit" };
        for (let i = 0; i < MAX_STEPS; i++) {
            // A step body doesn't inherit the handler's async context: the
            // model scope is entered inside the step.
            last = await step.run(`unit-${i}`, () => runScenarioUnitV2(runId, companyId));
            if (last.state === "advanced") continue;
            if (last.state === "waiting" && last.retryAt) {
                await step.sleepUntil(`wait-${i}`, new Date(last.retryAt));
                continue;
            }
            break;
        }
        return { runId, ...last };
    }
);

export const scenarioRunV2Reconciler = inngest.createFunction(
    {
        id: "scenario-run-v2-reconciler",
        name: "Scenario Run (v2) Reconciler",
        retries: 1,
        concurrency: [{ limit: 1 }],
    },
    { cron: "* * * * *" },
    async ({ step }) => step.run("reconcile", () => reconcileScenarioRunsV2())
);
