/**
 * Where a v2 scenario run executes.
 *
 * With SCENARIOS_EXECUTOR=worker the accepted run's dispatch is published to
 * Inngest and `scenario-run-v2` drives it on the worker, one unit per step.
 * Otherwise (local dev) this process drives the same engine after the
 * response with `after()`, holding the fenced lease with a heartbeat; if the
 * process dies the lease lapses, and the next poll of the run resumes it
 * from its last committed unit.
 */
import { randomUUID } from "node:crypto";

import { after } from "next/server";

import type { ScenarioRunRecord } from "@launchstack/pipelines/scenarios";
import { markDispatchSent, type AcceptRunResult } from "@launchstack/pipelines/scenarios/v2/db";
import { requestCancel } from "@launchstack/pipelines/scenarios/db";
import {
    driveV2,
    type DriveV2Result,
    type EngineDeps,
} from "@launchstack/pipelines/scenarios/v2/engine";

import { readScenariosExecutor } from "~/server/scenarios/executor";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { createEngineDeps } from "./deps";
import { deliverDispatch } from "./dispatch";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Drive a v2 run in this process for as long as it advances. A unit waiting
 * on the graph service is waited out here (the engine fails the run once the
 * wait is too long), so a local run does not need a poll to continue.
 */
export async function driveV2Inline(
    runId: number,
    deps = createEngineDeps()
): Promise<DriveV2Result | null> {
    const run = await deps.store.getRun(runId);
    if (!run) return null;
    // Each unit runs on the workspace's own models when it brings them,
    // counted against whoever started the run and never stopped midway.
    const aiUse = {
        feature: "scenarios",
        userId: run.createdByUserId,
        enforce: false,
    } as const;
    const around = <T>(fn: () => Promise<T>) => withWorkspaceChatModels(run.companyId, aiUse, fn);
    for (;;) {
        const result = await driveV2(deps, runId, { around });
        if (result.last.state !== "waiting") return result;
        await sleep(Math.max(0, result.last.retryAt.getTime() - Date.now()) + 250);
    }
}

function driveAfterResponse(runId: number, label: string): void {
    after(async () => {
        try {
            await driveV2Inline(runId);
        } catch (error) {
            console.error(`[scenarios:v2] ${label} failed for run ${runId}:`, error);
        }
    });
}

/**
 * Hand an accepted run to its executor. Never throws for a delivery problem:
 * a dispatch left pending is the reconciler's to send. Safe to call again for
 * a replayed acceptance (`created: false`): a sent dispatch is not resent,
 * and a second inline driver finds the lease taken.
 */
export async function startV2Run(
    accepted: Pick<AcceptRunResult, "run" | "dispatch">
): Promise<void> {
    if (readScenariosExecutor() === "worker") {
        await deliverDispatch(accepted.dispatch.id).catch((error: unknown) =>
            console.warn(
                "[scenarios:v2] publishing the dispatch failed; the reconciler will:",
                error
            )
        );
        return;
    }
    await markDispatchSent(accepted.dispatch.id, new Date()).catch((error: unknown) =>
        console.warn("[scenarios:v2] could not mark the dispatch sent:", error)
    );
    driveAfterResponse(accepted.run.id, "executor");
}

/**
 * Resume a v2 run whose in-process driver went away (a restart, a crash).
 * Called when someone polls the run; a no-op unless it is a v2 run that is
 * unfinished, runs inline, and whose lease (or wait backoff) has lapsed.
 */
export function resumeV2IfStalled(
    run: Pick<ScenarioRunRecord, "id" | "status" | "leaseUntil" | "contractVersion">,
    now = new Date()
): boolean {
    if (readScenariosExecutor() !== "inline") return false;
    if (run.contractVersion !== 2) return false;
    if (run.status !== "queued" && run.status !== "running") return false;
    if (run.leaseUntil && run.leaseUntil.getTime() > now.getTime()) return false;
    driveAfterResponse(run.id, "resume");
    return true;
}

/**
 * Stop a v2 run. The flag stops new units at once; a run no driver holds is
 * finished here under a lease of its own, so the fenced terminal write
 * releases its credit holds in the same transaction. A driver holding the
 * lease sees the flag at its next check or loses its commit to it.
 */
export async function cancelV2(
    run: Pick<ScenarioRunRecord, "id" | "companyId">,
    now: Date,
    deps: Pick<EngineDeps, "store"> = createEngineDeps()
): Promise<void> {
    await requestCancel(run.companyId, run.id, now);
    const fence = await deps.store.claimLease(
        run.id,
        `cancel:${randomUUID()}`,
        now,
        new Date(now.getTime() + 30_000)
    );
    if (!fence) return;
    await deps.store.finishRun(fence, { status: "cancelled", error: null, at: now });
}
