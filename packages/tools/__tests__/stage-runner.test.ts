import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineProgressEvent } from "@launchstack/tools/contract";
import {
    PipelineAbortedError,
    runStage,
    throwIfPipelineAborted,
} from "@launchstack/tools/stage-runner";

describe("runStage", () => {
    let events: PipelineProgressEvent[];
    const onProgress = (e: PipelineProgressEvent) => events.push(e);

    beforeEach(() => {
        events = [];
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("emits start → complete → data → thinking in order on success", async () => {
        const value = await runStage({
            id: "demo",
            label: "Demo stage",
            parallelGroup: 1,
            policy: "required",
            onProgress,
            run: async () => 42,
            report: v => ({
                detail: `got ${v}`,
                data: { v },
                narration: "thinking aloud",
            }),
        });

        expect(value).toBe(42);
        expect(events.map(e => e.type)).toEqual([
            "step_start",
            "step_complete",
            "step_data",
            "step_thinking",
        ]);
        expect(events[0]).toMatchObject({ step: "demo", label: "Demo stage", parallelGroup: 1 });
        expect(events[1]).toMatchObject({ status: "completed", detail: "got 42" });
    });

    it("a report may mark a successful run as skipped (no-history case)", async () => {
        await runStage({
            id: "history",
            label: "History",
            policy: "degradable",
            fallback: { value: [], detail: "unavailable", logMessage: "x" },
            onProgress,
            run: async () => [] as string[],
            report: v =>
                v.length > 0 ? { detail: `${v.length}` } : { status: "skipped", detail: "none" },
        });
        expect(events[1]).toMatchObject({
            type: "step_complete",
            status: "skipped",
            detail: "none",
        });
    });

    it("skip.when short-circuits before run", async () => {
        const run = vi.fn();
        const value = await runStage({
            id: "persona",
            label: "Persona",
            policy: "degradable",
            fallback: { value: undefined, detail: "unavailable", logMessage: "x" },
            skip: { when: true, value: undefined, detail: "no audience", narration: "skipping" },
            onProgress,
            run,
        });
        expect(run).not.toHaveBeenCalled();
        expect(value).toBeUndefined();
        expect(events.map(e => e.type)).toEqual(["step_start", "step_complete", "step_thinking"]);
        expect(events[1]).toMatchObject({ status: "skipped", detail: "no audience" });
    });

    it("degradable failure logs, emits failed, and yields the fallback", async () => {
        const value = await runStage({
            id: "voice",
            label: "Voice",
            policy: "degradable",
            fallback: {
                value: "default",
                detail: "Using default voice",
                narration: "fallback narration",
                logMessage: "[test] voice failed:",
            },
            onProgress,
            run: async () => {
                throw new Error("rag down");
            },
        });

        expect(value).toBe("default");
        expect(console.warn).toHaveBeenCalledWith("[test] voice failed:", expect.any(Error));
        expect(events[1]).toMatchObject({
            type: "step_complete",
            status: "failed",
            detail: "Using default voice",
        });
        expect(events[2]).toMatchObject({ type: "step_thinking", text: "fallback narration" });
    });

    it("required failure rethrows without a completion event", async () => {
        await expect(
            runStage({
                id: "dna",
                label: "DNA",
                policy: "required",
                onProgress,
                run: async () => {
                    throw new Error("llm down");
                },
            })
        ).rejects.toThrow("llm down");
        expect(events.map(e => e.type)).toEqual(["step_start"]);
    });

    it("an aborted signal stops the stage before any work or events", async () => {
        const controller = new AbortController();
        controller.abort();
        const run = vi.fn();

        await expect(
            runStage({
                id: "late",
                label: "Late",
                policy: "required",
                signal: controller.signal,
                onProgress,
                run,
            })
        ).rejects.toBeInstanceOf(PipelineAbortedError);
        expect(run).not.toHaveBeenCalled();
        expect(events).toEqual([]);
    });

    it("an abort during run rethrows raw, even for degradable stages", async () => {
        const controller = new AbortController();
        await expect(
            runStage({
                id: "trends",
                label: "Trends",
                policy: "degradable",
                fallback: { value: [], detail: "d", logMessage: "x" },
                signal: controller.signal,
                onProgress,
                run: async () => {
                    controller.abort();
                    throw new Error("fetch aborted");
                },
            })
        ).rejects.toThrow("fetch aborted");
    });

    it("degradable without a fallback is a configuration error", async () => {
        await expect(
            runStage({
                id: "bad",
                label: "Bad",
                policy: "degradable",
                run: async () => 1,
            })
        ).rejects.toThrow('stage "bad" is degradable but declares no fallback');
    });
});

describe("throwIfPipelineAborted", () => {
    it("throws only when the signal is aborted", () => {
        expect(() => throwIfPipelineAborted(undefined)).not.toThrow();
        const controller = new AbortController();
        expect(() => throwIfPipelineAborted(controller.signal)).not.toThrow();
        controller.abort();
        expect(() => throwIfPipelineAborted(controller.signal)).toThrow(PipelineAbortedError);
    });
});
