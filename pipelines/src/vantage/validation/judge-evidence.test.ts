import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { structuredSchemaInstruction, type ResolvedChatModel } from "@launchstack/llm";
import captures from "../../../../fixtures/vantage-phase-a-repair/judge-evidence-captures.json";
import { JudgmentSchema, RUBRIC_VERSION, type JudgeRequest } from "./contracts";
import { outputUnits, parseEvaluationInput } from "./input";
import { evaluateVantage, validateJudgment } from "./evaluate";
import { createModelValidationJudge } from "./judge";
import { judgmentSchemaFor, JUDGE_EVIDENCE_TRANSPORT_VERSION } from "./judge-evidence";

const requestFor = (capture: (typeof captures.captures)[number]): JudgeRequest => {
    const input = parseEvaluationInput(capture.input);
    return { input, outputUnits: outputUnits(input), rubricVersion: RUBRIC_VERSION };
};

describe("captured Phase A Judge evidence failures (offline, no provider)", () => {
    it("reproduces the exact expectation-as-source IDs and closes the structural gap", () => {
        const capture = captures.captures.find(item => item.observed === "invalid-id")!;
        const request = requestFor(capture);
        // This was the actual pre-repair structural gap; semantic validation did reject it.
        expect(JudgmentSchema.safeParse(capture.judgment).success).toBe(true);
        expect(() => validateJudgment(capture.judgment, request.input)).toThrow("evidence");
        const scoped = judgmentSchemaFor(request).safeParse(capture.judgment);
        expect(scoped.success).toBe(false);
        if (!scoped.success)
            expect(scoped.error.issues.some(issue => issue.path.includes("id"))).toBe(true);
        const wrong = capture.judgment.expectations[0]!.evidence[0]!;
        expect(wrong.id).toBe("negation-and-old-mandatory-policy/expected-1/a");
        expect(request.input.scenario.documents.some(doc => doc.id === wrong.id)).toBe(false);
        expect(request.outputUnits.some(unit => unit.id === wrong.id)).toBe(false);
    });

    it("keeps the fabricated-prefix quotation invalid instead of rewriting it", () => {
        const capture = captures.captures.find(item => item.observed === "non-verbatim-quote")!;
        const request = requestFor(capture);
        const before = JSON.stringify(capture);
        expect(judgmentSchemaFor(request).safeParse(capture.judgment).success).toBe(true);
        expect(() => validateJudgment(capture.judgment, request.input)).toThrow("evidence");
        expect(JSON.stringify(capture)).toBe(before);
    });

    it("accepts the actual later verbatim assessment structurally without regrading it", () => {
        const capture = captures.captures.find(item => item.observed === "valid-recovery")!;
        const request = requestFor(capture);
        expect(judgmentSchemaFor(request).safeParse(capture.judgment).success).toBe(true);
        expect(validateJudgment(capture.judgment, request.input)).toEqual(capture.judgment);
    });

    it.each(["expectation-as-source", "output-as-source", "source-as-output", "invented-version"])(
        "does not infer an alias for %s",
        kind => {
            const capture = captures.captures.find(item => item.observed === "valid-recovery")!;
            const request = requestFor(capture);
            const judgment = structuredClone(capture.judgment);
            const evidence = judgment.expectations[0]!.evidence[0]!;
            evidence.kind = kind === "source-as-output" ? "output" : "source";
            evidence.id =
                kind === "expectation-as-source"
                    ? request.input.scenario.expectations[0]!.id
                    : kind === "output-as-source"
                      ? request.outputUnits[0]!.id
                      : kind === "source-as-output"
                        ? request.input.scenario.documents[0]!.id
                        : request.input.scenario.documents[0]!.id + "-invented-version";
            expect(judgmentSchemaFor(request).safeParse(judgment).success).toBe(false);
        }
    );

    it.each(captures.captures)(
        "$observed gets exact IDs in its actual prompt schema within the existing budget",
        async capture => {
            const request = requestFor(capture);
            const invoke = vi.fn(async () => ({ result: capture.judgment, usage: {} }));
            const model = {
                modelId: "offline-only",
                behavior: { parameters: { systemMessages: "supported" } },
            } as ResolvedChatModel;
            const judge = createModelValidationJudge(
                model,
                { configurationId: "offline" },
                invoke as Parameters<typeof createModelValidationJudge>[2]
            );
            await judge.evaluate(request, new AbortController().signal);
            expect(invoke).toHaveBeenCalledTimes(1);
            const args = (invoke.mock.calls as unknown[][])[0]!;
            const schema = args[1] as z.ZodType;
            const messages = args[2] as { content: string }[];
            const instruction = structuredSchemaInstruction(schema);
            for (const doc of request.input.scenario.documents)
                expect(instruction).toContain(doc.id);
            for (const unit of request.outputUnits) expect(instruction).toContain(unit.id);
            expect(messages[0]!.content).toContain("expectationId identifies an assessment target");
            expect(messages[0]!.content).toContain("verbatim substring");
            expect(judge.id).toContain(JUDGE_EVIDENCE_TRANSPORT_VERSION);
            const bytes = Buffer.byteLength(
                JSON.stringify([instruction, ...messages.map(message => message.content)])
            );
            expect(bytes).toBeLessThanOrEqual(24000);
        }
    );

    it("still reports unavailable assessment for the captured invalid Judge output", async () => {
        const capture = captures.captures.find(item => item.observed === "invalid-id")!;
        const { input } = requestFor(capture);
        const report = await evaluateVantage(input, {
            judge: {
                kind: "fixture-replay",
                id: "offline-invalid-capture",
                evaluate: async () => ({ judgment: capture.judgment }),
            },
        });
        expect(report).toMatchObject({
            error: "invalid-judgment",
            status: "unavailable",
            overallScore: null,
        });
        expect(report.expectations.every(item => item.verdict === "unassessed")).toBe(true);
    });
});
