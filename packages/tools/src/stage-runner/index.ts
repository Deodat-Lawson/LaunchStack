/**
 * stage-runner — a table and a loop, deliberately not a workflow engine
 * (design D6: no DAG solver, no persistence, no dynamic graphs, no retries).
 *
 * One stage = one declaration: id, label, failure policy, the work, and how
 * to report it. The runner owns everything the marketing pipeline previously
 * hand-wove per stage (~25 lines each): timing, progress events, the
 * console line, skip handling, the required-vs-degradable error policy, and
 * cancellation checks between stages. Narration stays colocated with the
 * stage definition — data, not control flow.
 */

import type { PipelineProgressEvent } from "../contract";

export class PipelineAbortedError extends Error {
    constructor() {
        super("Pipeline aborted");
        this.name = "PipelineAbortedError";
    }
}

/** Throw between stages so an abandoned run stops before its next LLM call. */
export function throwIfPipelineAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new PipelineAbortedError();
}

export type StagePolicy = "required" | "degradable";

export interface StageSkip<F> {
    when: boolean;
    value: F;
    detail: string;
    narration?: string;
}

export interface StageFallback<F> {
    value: F;
    detail: string;
    narration?: string;
    /** console.warn prefix for the swallowed error. */
    logMessage: string;
}

export interface StageReport {
    detail?: string;
    /** A successful run may still report "skipped" (e.g. "no history yet"). */
    status?: "completed" | "skipped";
    data?: Record<string, unknown>;
    narration?: string;
}

export interface StageRunTools {
    signal?: AbortSignal;
}

/**
 * S = the success value; F = the skip/fallback value (defaults to S). A stage
 * therefore yields S | F, and `report` only ever sees a real success value.
 */
export interface RunStageOptions<S, F = S, Step extends string = string> {
    id: Step;
    label: string;
    parallelGroup?: number;
    /**
     * "required": a failure aborts the pipeline (rethrown, no completion
     * event — the pipeline's error arm reports it). "degradable": a failure
     * emits a failed completion and the stage yields `fallback.value`.
     */
    policy: StagePolicy;
    onProgress?: (event: PipelineProgressEvent<Step>) => void;
    signal?: AbortSignal;
    /** Prefix for the per-stage console line, e.g. "[marketing-pipeline]". */
    logPrefix?: string;
    skip?: StageSkip<F>;
    run: (tools: StageRunTools) => Promise<S>;
    report?: (value: S) => StageReport;
    fallback?: StageFallback<F>;
}

export async function runStage<S, F = S, Step extends string = string>(
    options: RunStageOptions<S, F, Step>
): Promise<S | F> {
    const { id, label, parallelGroup, policy, onProgress, signal, skip, fallback } = options;
    const logPrefix = options.logPrefix ?? "[pipeline]";

    if (policy === "degradable" && !fallback) {
        throw new Error(`stage "${id}" is degradable but declares no fallback`);
    }

    throwIfPipelineAborted(signal);

    const start = Date.now();
    onProgress?.({ type: "step_start", step: id, label, parallelGroup });

    const complete = (status: "completed" | "skipped" | "failed", detail?: string) => {
        const durationMs = Date.now() - start;
        console.log(
            "%s %s %s in %dms%s",
            logPrefix,
            id,
            status,
            durationMs,
            detail ? ` – ${detail}` : ""
        );
        onProgress?.({ type: "step_complete", step: id, durationMs, detail, status });
    };

    if (skip?.when) {
        complete("skipped", skip.detail);
        if (skip.narration) onProgress?.({ type: "step_thinking", step: id, text: skip.narration });
        return skip.value;
    }

    let value: S;
    try {
        value = await options.run({ signal });
    } catch (error) {
        if (error instanceof PipelineAbortedError || signal?.aborted) throw error;
        if (policy === "required" || !fallback) throw error;

        console.warn(fallback.logMessage, error);
        complete("failed", fallback.detail);
        if (fallback.narration) {
            onProgress?.({ type: "step_thinking", step: id, text: fallback.narration });
        }
        return fallback.value;
    }

    const report = options.report?.(value) ?? {};
    complete(report.status ?? "completed", report.detail);
    if (report.data) onProgress?.({ type: "step_data", step: id, data: report.data });
    if (report.narration) {
        onProgress?.({ type: "step_thinking", step: id, text: report.narration });
    }
    return value;
}
