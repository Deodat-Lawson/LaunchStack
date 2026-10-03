/**
 * Where a scenario run executes.
 *
 * A run is a few dozen to a few thousand model calls, split into units
 * (brief, cast, one per round, report) that `advanceRun` performs one at a
 * time. By default the web process drives them after the response with
 * `after()`, holding a lease on the run row; if the process dies, the lease
 * expires and the next poll of the run picks it up where the last committed
 * unit left it. A deployment with the worker attached sets
 * SCENARIOS_EXECUTOR=worker to run the same units as Inngest steps instead.
 */
import { after } from "next/server";

import {
    advanceRun,
    createLlmSimulationModel,
    unitCount,
    type ScenarioRunPorts,
    type ScenarioRunRecord,
} from "@launchstack/pipelines/scenarios";
import {
    claimLease,
    createScenarioStore,
    getRunById,
    releaseLease,
    renewLease,
} from "@launchstack/pipelines/scenarios/db";
import { llmChatTokens } from "@launchstack/store/credits";

import { debitTokens } from "~/lib/credits";
import { inngest } from "~/server/inngest/client";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { gatherScenarioEvidence } from "./evidence";

export type ScenariosExecutor = "inline" | "worker";

export function readScenariosExecutor(
    env: Record<string, string | undefined> = process.env
): ScenariosExecutor {
    return env.SCENARIOS_EXECUTOR?.trim().toLowerCase() === "worker" ? "worker" : "inline";
}

/**
 * How long the in-process lease lasts without a heartbeat. The executor
 * renews it every LEASE_MS / 3 while a unit runs, so only a process that
 * died (not a slow round) lets a poll resume the run.
 */
export const LEASE_MS = 2 * 60_000;
/** Attempts per unit before the run is marked failed. */
export const UNIT_ATTEMPTS = 3;

/** Parallel model calls per round: SCENARIOS_CONCURRENCY, 1–16, default 6 (1 suits a single-slot local model). */
export function readScenariosConcurrency(
    env: Record<string, string | undefined> = process.env
): number {
    const n = Number.parseInt(env.SCENARIOS_CONCURRENCY ?? "", 10);
    return Number.isFinite(n) ? Math.max(1, Math.min(16, n)) : 6;
}

export function createScenarioPorts(): ScenarioRunPorts {
    return {
        store: createScenarioStore(),
        model: createLlmSimulationModel(),
        gatherEvidence: gatherScenarioEvidence,
        creditsFor: usage => llmChatTokens(usage.inputTokens, usage.outputTokens),
        charge: async (run: ScenarioRunRecord, credits: number, unit: string) => {
            if (credits <= 0) return true;
            const result = await debitTokens({
                companyId: run.companyId,
                amount: credits,
                service: "scenario_simulation",
                description:
                    run.kind === "post_test"
                        ? `${run.title} (${unit})`
                        : `Scenario "${run.title}" (${unit})`,
                referenceId: `scenario:${run.id}`,
            });
            return result !== null;
        },
        now: () => new Date(),
        concurrency: readScenariosConcurrency(),
        log: (message, meta) => console.warn(`[scenarios] ${message}`, meta ?? {}),
    };
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return "The run failed";
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Perform one unit with retries; marks the run failed after the last attempt.
 * Returns true when the run should keep going.
 */
export async function advanceWithRetries(
    ports: ScenarioRunPorts,
    runId: number,
    attempts = UNIT_ATTEMPTS,
    backoffMs = 1500
): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
        const started = Date.now();
        try {
            const outcome = await advanceRun(ports, runId);
            console.info(
                `[scenarios] run ${runId}: ${outcome.state}${"step" in outcome ? ` to step ${outcome.step}` : ""} in ${Math.round((Date.now() - started) / 1000)}s`
            );
            return outcome.state === "advanced";
        } catch (error) {
            if (attempt >= attempts) {
                console.error(`[scenarios] run ${runId} failed:`, error);
                await ports.store.finish(runId, "failed", errorMessage(error), ports.now());
                return false;
            }
            console.warn(
                `[scenarios] run ${runId}: attempt ${attempt} of ${attempts} failed after ${Math.round((Date.now() - started) / 1000)}s, retrying:`,
                errorMessage(error)
            );
            await sleep(backoffMs * attempt);
        }
    }
}

/** Drive a run to the end in this process, if no live lease holds it. */
export async function driveRun(
    runId: number,
    ports: ScenarioRunPorts = createScenarioPorts()
): Promise<void> {
    const now = ports.now();
    if (!(await claimLease(runId, now, new Date(now.getTime() + LEASE_MS)))) return;
    // Heartbeat: a round on a slow model can outlast the lease; keep it fresh
    // so a poll doesn't take it for a dead process and start a second driver.
    const heartbeat = setInterval(() => {
        renewLease(runId, new Date(Date.now() + LEASE_MS)).catch((error: unknown) =>
            console.warn("[scenarios] lease renewal failed:", error)
        );
    }, LEASE_MS / 3);
    try {
        const run = await getRunById(runId);
        if (!run) return;
        const limit = unitCount(run.roundCount) + 2;
        for (let i = 0; i < limit; i++) {
            // Each unit runs on the workspace's own models when it brings them.
            const keepGoing = await withWorkspaceChatModels(run.companyId, () =>
                advanceWithRetries(ports, runId)
            );
            if (!keepGoing) break;
        }
    } finally {
        clearInterval(heartbeat);
        await releaseLease(runId);
    }
}

/** Hand a new run to the executor. */
export async function dispatchRun(run: Pick<ScenarioRunRecord, "id" | "companyId">): Promise<void> {
    if (readScenariosExecutor() === "worker") {
        await inngest.send({
            name: "scenarios/run.requested",
            data: { runId: run.id, companyId: run.companyId.toString() },
        });
        return;
    }
    after(async () => {
        try {
            await driveRun(run.id);
        } catch (error) {
            console.error("[scenarios] executor crashed:", error);
        }
    });
}

/**
 * Resume a run whose in-process executor went away (a restart, a crash).
 * Called when someone polls a run; a no-op unless the run is unfinished,
 * runs inline, and its lease has lapsed.
 */
export function resumeIfStalled(
    run: Pick<ScenarioRunRecord, "id" | "status" | "leaseUntil">,
    now = new Date()
): boolean {
    if (readScenariosExecutor() !== "inline") return false;
    if (run.status !== "queued" && run.status !== "running") return false;
    if (run.leaseUntil && run.leaseUntil.getTime() > now.getTime()) return false;
    after(async () => {
        try {
            await driveRun(run.id);
        } catch (error) {
            console.error("[scenarios] resume failed:", error);
        }
    });
    return true;
}
