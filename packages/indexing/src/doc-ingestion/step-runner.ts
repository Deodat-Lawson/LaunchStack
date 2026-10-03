import { getChatModelsScope, runWithChatModelsScope } from "@launchstack/llm";

import type { DocIngestionToolRuntimeOptions } from "./types";

/** Runs one named stage step; the host's durable step when it gave one. */
export type StepRunner = <T>(stepName: string, fn: () => Promise<T>) => Promise<T>;

/**
 * The step runner for one stage run.
 *
 * The stages read the workspace's model scope (table summaries, image
 * descriptions and entity extraction go to the workspace's own model when it
 * brought one). A host that runs them inline — the worker — enters that scope
 * around the stage and every step inherits it. A host that hands in a durable
 * `runStep` (an Inngest `step.run`) does not get that for free: Inngest runs a
 * step body from its own execution loop, outside the caller's async context.
 * So the scope in force when the stage starts is carried into each step.
 */
export function createStepRunner(runtime?: DocIngestionToolRuntimeOptions): StepRunner {
    if (!runtime?.runStep) {
        return async <T>(_stepName: string, fn: () => Promise<T>): Promise<T> => fn();
    }

    const scope = getChatModelsScope();
    return async <T>(stepName: string, fn: () => Promise<T>): Promise<T> => {
        const body = scope ? () => runWithChatModelsScope(scope, fn) : fn;
        return runtime.runStep?.(stepName, body) ?? body();
    };
}
