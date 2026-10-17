import { AsyncResource } from "node:async_hooks";
import { describe, expect, it } from "vitest";

import { getChatModelsScope, runWithChatModelsScope, type ChatModelsScope } from "@launchstack/llm";

import { createStepRunner } from "../src/doc-ingestion/step-runner";

/** Created at load, outside any scope — like Inngest's execution loop. */
const executionLoop = new AsyncResource("inngest-execution-loop");

/**
 * A stand-in for Inngest's `step.run`: the body runs from the loop's context,
 * not the caller's — which is exactly what loses AsyncLocalStorage.
 */
function detachedRunStep<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        executionLoop.runInAsyncScope(() => {
            setImmediate(() => {
                fn().then(resolve, reject);
            });
        });
    });
}

const WORKSPACE: ChatModelsScope = Object.freeze({ source: "workspace" as const });

describe("doc-ingestion step runner", () => {
    it("runs steps inline, inside the caller's scope, when the host gives no runStep", async () => {
        const seen = await runWithChatModelsScope(WORKSPACE, () =>
            createStepRunner()("step", async () => getChatModelsScope())
        );
        expect(seen).toBe(WORKSPACE);
    });

    it("carries the workspace's scope into a durable step that would lose it", async () => {
        // Without the carry-over, the detached step sees no scope at all.
        const lost = await runWithChatModelsScope(WORKSPACE, () =>
            detachedRunStep("step", async () => getChatModelsScope())
        );
        expect(lost).toBeUndefined();

        const carried = await runWithChatModelsScope(WORKSPACE, () =>
            createStepRunner({ runStep: detachedRunStep })("step", async () => getChatModelsScope())
        );
        expect(carried).toBe(WORKSPACE);
    });

    it("adds no scope when the stage started outside one", async () => {
        const seen = await createStepRunner({ runStep: detachedRunStep })("step", async () =>
            getChatModelsScope()
        );
        expect(seen).toBeUndefined();
    });
});
