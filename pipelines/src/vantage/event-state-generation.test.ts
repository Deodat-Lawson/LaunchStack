import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedChatModel } from "@launchstack/llm";
import type { GenerationInput } from "./contract-v1";
import { createGenerationPort, GENERATION_BUDGETS } from "./generation-v1";
import { validateGenerationResult } from "./validate-generation-v1";

const fixtures = JSON.parse(
    readFileSync(
        new URL("../../../fixtures/vantage-grounding/event-states.json", import.meta.url),
        "utf8"
    )
);
const scenarios = fixtures.cases as { id: string; input: GenerationInput }[];
const input = () => structuredClone(scenarios.find(x => x.id === "requested-only")!.input);
const runtime = () => ({
    resolveModel: () => ({ modelId: "synthetic-model" }) as ResolvedChatModel,
    signal: new AbortController().signal,
    budgets: GENERATION_BUDGETS,
});
const promoted = "The customer moved the synthetic pilot start from November 20 to November 27.";
function output() {
    return {
        summary:
            "The customer requested moving the synthetic pilot start from November 20 to November 27.",
        topics: [
            {
                title: "Review the requested pilot date",
                facts: [
                    {
                        text: "The customer requested moving the synthetic pilot start from November 20 to November 27.",
                        refs: ["ev:request-only"],
                    },
                ],
                whyItMatters: "Whether the requested date was accepted remains unknown.",
                decisionQuestion: "Has the requested date been accepted?",
                proposedNextStep:
                    "Ask the customer and operator whether they agreed to the requested date.",
                proposedOwner: null,
                proposedDueInDays: null,
                helpRequested: null,
                unknowns: ["Whether the date was accepted."],
                conflicts: [],
                rationale: "A date request needs clarification.",
            },
        ],
        enhancements: [],
    };
}
const response = (result = output()) => ({
    result,
    usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
});

describe("event-state repair and generation boundary", () => {
    it.each(["summary", "fact", "interpretation", "title", "rationale"])(
        "repairs a source-ID-valid %s promotion instead of accepting it",
        async field => {
            const bad = output();
            if (field === "summary") bad.summary = promoted;
            if (field === "fact") bad.topics[0]!.facts[0]!.text = promoted;
            if (field === "interpretation") bad.topics[0]!.whyItMatters = promoted;
            if (field === "title") bad.topics[0]!.title = promoted;
            if (field === "rationale") bad.topics[0]!.rationale = promoted;
            const invoke = vi
                .fn()
                .mockResolvedValueOnce(response(bad))
                .mockResolvedValueOnce(response());
            const supplied = input(),
                before = structuredClone(supplied);
            const result = await createGenerationPort(invoke)(supplied, runtime());
            expect(result.execution).toMatchObject({
                mode: "ai",
                attempts: 2,
                fallbackReason: null,
            });
            expect(result.draft.summary).toBe(output().summary);
            expect(invoke).toHaveBeenCalledTimes(2);
            expect(JSON.stringify(invoke.mock.calls[1]![2])).toContain("Preserve event states");
            expect(result.draft.modelMetadata.usage).toMatchObject({ totalTokens: 260 });
            expect(supplied).toEqual(before);
            expect(() => validateGenerationResult(supplied, result)).not.toThrow();
        }
    );
    it("uses the existing bounded Rules fallback after two contradictory responses", async () => {
        const bad = output();
        bad.summary = promoted;
        const invoke = vi.fn().mockResolvedValue(response(bad)),
            supplied = input();
        const result = await createGenerationPort(invoke)(supplied, runtime());
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(result.execution).toMatchObject({
            mode: "rules",
            attempts: 2,
            fallbackReason: "invalid-output",
            modelId: null,
        });
        expect(result.draft.summary).not.toContain(promoted);
        expect(
            result.draft.topics.every(t =>
                t.facts.every(f => f.refs.every(r => r.ref === "ev:request-only"))
            )
        ).toBe(true);
        expect(() => validateGenerationResult(supplied, result)).not.toThrow();
    });
    it("does not add a second call for a valid request-state report", async () => {
        const invoke = vi.fn().mockResolvedValue(response()),
            supplied = input();
        const result = await createGenerationPort(invoke)(supplied, runtime());
        expect(result.execution).toMatchObject({ mode: "ai", attempts: 1, fallbackReason: null });
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(() => validateGenerationResult(supplied, result)).not.toThrow();
    });
    it.each(["summary", "fact", "interpretation"])(
        "rejects an injected %s contradiction at the final boundary",
        async field => {
            const supplied = input();
            const result = await createGenerationPort(vi.fn().mockResolvedValue(response()))(
                supplied,
                runtime()
            );
            if (field === "summary") result.draft.summary = promoted;
            if (field === "fact") result.draft.topics[0]!.facts[0]!.text = promoted;
            if (field === "interpretation") result.draft.topics[0]!.whyItMatters = promoted;
            expect(() => validateGenerationResult(supplied, result)).toThrow(
                "explicit supplied event state"
            );
        }
    );
    it("rechecks the exact saved scheduling failure, including its pending lineage", async () => {
        const supplied = structuredClone(
            scenarios.find(x => x.id === "original-rolling-c3")!.input
        );
        const before = structuredClone(supplied);
        const raw = output();
        raw.summary = fixtures.observedPriorFailure.summary;
        raw.topics = []; // Even a summary-only response must not bypass grounding.
        const fixed = output();
        fixed.topics = [];
        const invoke = vi
            .fn()
            .mockResolvedValueOnce(response(raw))
            .mockResolvedValueOnce(response(fixed));
        const result = await createGenerationPort(invoke)(supplied, runtime());
        expect(result.execution).toMatchObject({ mode: "ai", attempts: 2, fallbackReason: null });
        expect(supplied.pendingHistoricalQuestions!.questions.map(q => q.questionId)).toEqual([
            "67f60126-1439-455f-994d-3e07b54ab620",
            "e637cb46-0e71-4b30-9dcb-583f56768db6",
        ]);
        expect(supplied).toEqual(before);
        expect(result.enhancements).toEqual([]);
    });
});
