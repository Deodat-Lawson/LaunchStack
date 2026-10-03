/**
 * Prometheus metrics for Prospects runs. Counted where the outcome is
 * known: the worker's function for live and keyless runs, the request for
 * a sample run. The pipelines package cannot import the registry, so the
 * hosts call these.
 */
import type { RunOptions, RunRecord } from "@launchstack/pipelines/distribution/types";

import {
    prospectsCandidatesTotal,
    prospectsRunDuration,
    prospectsRunsTotal,
} from "~/server/metrics/registry";

export type RunResult = "completed" | "failed" | "stopped";

export function recordRunFinished(
    mode: RunOptions["mode"],
    result: RunResult,
    run: RunRecord | null | undefined
): void {
    prospectsRunsTotal.inc({ mode, result });
    const startedAt = run?.startedAt ?? run?.createdAt;
    const finishedAt = run?.completedAt ?? new Date();
    if (startedAt) {
        prospectsRunDuration.observe(
            { mode, result },
            Math.max(0, (finishedAt.getTime() - startedAt.getTime()) / 1000)
        );
    }
}

export function recordCandidate(
    mode: RunOptions["mode"],
    status: "ok" | "budget_exhausted" | "gate_failed" | "cancelled"
): void {
    prospectsCandidatesTotal.inc({ mode, status });
}
