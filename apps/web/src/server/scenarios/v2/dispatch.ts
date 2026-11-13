/**
 * Getting v2 scenario runs to a worker, and keeping them moving.
 *
 * Acceptance writes a dispatch row in the same transaction as the run; it is
 * published to Inngest after commit with the row's deterministic event id
 * (Inngest drops a duplicate id, the fenced lease absorbs any second driver).
 * Whatever does not get published — the web process died after commit, Inngest
 * was down — the reconciler delivers. The reconciler also re-dispatches runs
 * nothing is driving any more, lets go of holds a finished run still has,
 * records attempts whose worker died mid-call as unknown, drops raw replies
 * past the retention window, and deletes graph groups made from deleted files.
 */
import type { ScenarioGraphPort } from "@launchstack/pipelines/scenarios/v2";
import {
    buildsWithDeletedSources,
    claimDispatch,
    claimDueDispatches,
    createV2Store,
    markAbandonedAttempts,
    markDispatchFailed,
    markDispatchSent,
    markGraphBuildDeleted,
    purgeRawReplies,
    redispatchStalledRuns,
    releaseTerminalHolds,
    type DispatchRecord,
} from "@launchstack/pipelines/scenarios/v2/db";
import { newLeaseOwner, RUN_MESSAGES } from "@launchstack/pipelines/scenarios/v2/engine";

import { inngest } from "~/server/inngest/client";

import { createAppScenarioCredits } from "./credits";
import { scenarioGraphPort } from "./graph";

export const SCENARIO_RUN_V2_EVENT = "scenarios/run.v2.requested" as const;

export type PublishDispatch = (dispatch: DispatchRecord) => Promise<void>;

export const publishToInngest: PublishDispatch = async dispatch => {
    await inngest.send({
        id: dispatch.eventId,
        name: SCENARIO_RUN_V2_EVENT,
        data: {
            runId: dispatch.runId,
            companyId: dispatch.companyId.toString(),
            generation: dispatch.generation,
        },
    });
};

function errorText(error: unknown): string {
    return error instanceof Error && error.message ? error.message : String(error);
}

async function send(
    dispatch: DispatchRecord,
    publish: PublishDispatch,
    now: Date
): Promise<boolean> {
    try {
        await publish(dispatch);
        await markDispatchSent(dispatch.id, new Date());
        return true;
    } catch (error) {
        const next = await markDispatchFailed(dispatch, errorText(error), now);
        console.warn(
            `[scenarios:v2] dispatch ${dispatch.eventId} failed; retrying at ${next.toISOString()}:`,
            errorText(error)
        );
        return false;
    }
}

/**
 * Publish one dispatch now (right after acceptance). False when it was not
 * due or the send failed; the reconciler picks it up either way.
 */
export async function deliverDispatch(
    dispatchId: number,
    publish: PublishDispatch = publishToInngest,
    now = new Date()
): Promise<boolean> {
    const claimed = await claimDispatch(dispatchId, { now });
    if (!claimed) return false;
    return send(claimed, publish, now);
}

/** Raw replies are kept this many days (SCENARIOS_RAW_RETENTION_DAYS, default 30). */
export function readRawRetentionDays(
    env: Record<string, string | undefined> = process.env
): number {
    const n = Number.parseInt(env.SCENARIOS_RAW_RETENTION_DAYS ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 30;
}

/** Longer than any model call's timeout: an attempt still `started` after this lost its worker. */
const ABANDONED_ATTEMPT_MS = 30 * 60_000;

export interface ReconcileReport {
    delivered: number;
    failedSends: number;
    redispatched: number;
    /** Runs re-dispatched past the cap and failed instead. */
    stalledFailed: number;
    holdsReleased: number;
    abandonedAttempts: number;
    purgedReplies: number;
    /** Graph builds deleted because a file they were made from was deleted. */
    graphsDeleted: number;
}

/**
 * One reconciler pass (the worker's cron runs it every minute).
 *
 * It does not check SCENARIOS_EXECUTOR: that variable is the web process's
 * choice and the worker may not carry it. Inline runs mark their dispatch
 * sent before they start, so only a run whose web process died can be
 * picked up here — and driving it on the worker is exactly the recovery it
 * needs (the lease fences off a web process that comes back).
 */
export async function reconcileScenarioRunsV2(
    options: {
        now?: Date;
        publish?: PublishDispatch;
        retentionDays?: number;
        /** The graph service; defaults to the configured one (null: none). */
        graph?: ScenarioGraphPort | null;
    } = {}
): Promise<ReconcileReport> {
    const now = options.now ?? new Date();
    const publish = options.publish ?? publishToInngest;
    const report: ReconcileReport = {
        delivered: 0,
        failedSends: 0,
        redispatched: 0,
        stalledFailed: 0,
        holdsReleased: 0,
        abandonedAttempts: 0,
        purgedReplies: 0,
        graphsDeleted: 0,
    };

    const stalled = await redispatchStalledRuns({ now });
    report.redispatched = stalled.dispatched.length;
    for (const dispatch of await claimDueDispatches({ now })) {
        if (await send(dispatch, publish, now)) report.delivered += 1;
        else report.failedSends += 1;
    }
    if (stalled.overCap.length > 0) {
        const store = createV2Store({ credits: createAppScenarioCredits() });
        for (const runId of stalled.overCap) {
            // A fresh lease, so a run someone is still driving is left alone.
            const fence = await store.claimLease(
                runId,
                newLeaseOwner("reconciler"),
                now,
                new Date(now.getTime() + 60_000)
            );
            if (!fence) continue;
            const failed = await store.finishRun(fence, {
                status: "failed",
                error: RUN_MESSAGES.stalled,
                at: now,
            });
            if (failed) report.stalledFailed += 1;
        }
    }

    report.holdsReleased = await releaseTerminalHolds(now);
    report.abandonedAttempts = await markAbandonedAttempts(
        new Date(now.getTime() - ABANDONED_ATTEMPT_MS),
        now
    );
    const retention = options.retentionDays ?? readRawRetentionDays();
    report.purgedReplies = await purgeRawReplies(new Date(now.getTime() - retention * 86_400_000));
    report.graphsDeleted = await deleteGraphsOfDeletedSources(
        options.graph === undefined ? scenarioGraphPort() : options.graph,
        now
    );
    return report;
}

/**
 * Delete the Neo4j group and the frozen snapshot of every graph build made
 * from a file that has since been deleted. A group that can't be deleted now
 * (the service is down) is tried again on the next pass; the snapshot goes
 * only once the group is gone, so the two stores never disagree for long.
 */
export async function deleteGraphsOfDeletedSources(
    graph: ScenarioGraphPort | null,
    now: Date
): Promise<number> {
    if (!graph) return 0;
    let deleted = 0;
    for (const build of await buildsWithDeletedSources()) {
        try {
            await graph.deleteGroup(build.groupId);
            await markGraphBuildDeleted(build.id, now);
            deleted += 1;
        } catch (error) {
            console.warn("[scenarios:v2] could not delete a graph group yet:", {
                buildId: build.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return deleted;
}
