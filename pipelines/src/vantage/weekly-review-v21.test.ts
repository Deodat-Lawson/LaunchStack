import { describe, it, expect, vi } from "vitest";
import type { ResolvedChatModel } from "@launchstack/llm";
import { RATED_CRITERIA, type ValidationJudge } from "./validation/contracts";
import { outputUnits } from "./validation/input";
import {
    WeeklyReviewV21Schema,
    validateWeeklyReviewV21,
    weeklyReviewEvaluation,
    runWeeklyReviewV21,
    reviewFingerprint,
    type WeeklyReviewInput,
    type WeeklyReviewV21,
} from "./weekly-review-v21";
const ref = "doc:finance@v1";
const input = (): WeeklyReviewInput => ({
    candidateId: "candidate-1",
    week: "2026-11-09",
    asOf: "2026-11-09T12:00:00Z",
    role: "finance",
    mandatoryCoverage: { required: 1, included: 1 },
    sources: [
        {
            ref,
            version: "v1",
            hash: "a".repeat(64),
            purpose: "workspace-required",
            title: "Finance",
            text: "Revenue is 12000. Cost is 3000. Alice proposed review on 2026-11-10. Legal review requested.",
        },
    ],
});
const report = (): WeeklyReviewV21 => ({
    schemaVersion: "vantage-weekly-review/v2.1",
    headline: "Revenue review",
    brief: "Reconcile recorded amounts",
    summary: "Revenue is 12000.",
    keyFigures: [
        {
            label: "Margin",
            value: "9000",
            tone: "neutral",
            refs: [ref],
            derivation: {
                op: "difference",
                inputs: [
                    { value: 12000, ref },
                    { value: 3000, ref },
                ],
            },
        },
    ],
    topics: [
        {
            title: "Review margin",
            facts: [{ text: "Revenue is 12000.", refs: [ref] }],
            conflicts: [{ text: "Cost is 3000.", refs: [ref] }],
            whyItMatters: "Understand margin",
            whyNow: "A review was proposed",
            decisionQuestion: "Which amount is authoritative?",
            rationale: "Definitions matter",
            recommendation: {
                call: "Reconcile definitions",
                confidence: "low",
                because: "Recorded amounts need review",
                refs: [ref],
                wouldChangeIf: "Definitions agree",
            },
            proposedNextStep: "Compare definitions",
            unknowns: ["Accounting policy"],
            proposedOwner: "Alice",
            proposedDue: "2026-11-10",
            helpRequested: "Legal review requested",
        },
    ],
});
const model = (id: string) => ({ modelId: id }) as ResolvedChatModel;
function passingJudge(): ValidationJudge {
    return {
        kind: "fixture-replay",
        id: "synthetic-only",
        evaluate: async request => {
            const source = request.input.scenario.documents[0]!,
                unit = request.outputUnits[0]!;
            const evidence = [
                { kind: "source" as const, id: source.id, quote: source.text.slice(0, 20) },
                { kind: "output" as const, id: unit.id, quote: unit.text },
            ];
            return {
                judgment: {
                    expectations: request.input.scenario.expectations.map(item => ({
                        expectationId: item.id,
                        verdict: "met",
                        reason: "Synthetic assessment",
                        evidence,
                    })),
                    ratings: RATED_CRITERIA.map(criterion => ({
                        criterion,
                        score: 4,
                        reason: "Synthetic assessment",
                        evidence,
                    })),
                },
            };
        },
    };
}
function ports() {
    return {
        generation: model("generation-distinct"),
        judge: model("judge-distinct"),
        authorizeDispatch: vi.fn(async (_kind: "generation" | "judge") => {}),
        invoke: vi.fn(async () => ({
            result: report(),
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        })),
        validationJudge: passingJudge(),
    };
}
const run = (p: ReturnType<typeof ports>) =>
    runWeeklyReviewV21(input(), { ...p, invoke: p.invoke as never });
describe("canonical V2.1 contract and admission", () => {
    it("rejects evaluator-incompatible source text before admitting any provider dispatch", async () => {
        const candidate = input();
        candidate.sources[0]!.text = "x".repeat(6001);
        const p = ports();
        await expect(runWeeklyReviewV21(candidate, { ...p, invoke: p.invoke as never })).rejects.toThrow();
        expect(p.authorizeDispatch).not.toHaveBeenCalled();
        expect(p.invoke).not.toHaveBeenCalled();
    });
    it("accepts one report, rejects companion and wrapped reports", () => {
        expect(WeeklyReviewV21Schema.safeParse(report()).success).toBe(true);
        expect(WeeklyReviewV21Schema.safeParse({ ...report(), native: {} }).success).toBe(false);
        expect(
            WeeklyReviewV21Schema.safeParse({ native: {}, experimental: report() }).success
        ).toBe(false);
    });
    it("rejects unknown source versions", () => {
        const r = report();
        r.topics[0]!.facts[0]!.refs = ["doc:finance@v2"];
        expect(() => validateWeeklyReviewV21(r, input())).toThrow("invalid_source_citation");
    });
    it.each(["value", "input", "reference"])("rejects invalid derivation %s", kind => {
        const r = report(),
            f = r.keyFigures[0]!;
        if (kind === "value") f.value = "10000";
        else if (kind === "input") f.derivation!.inputs[0]!.value = 99000;
        else f.derivation!.inputs[0]!.ref = "doc:other@v1";
        expect(() => validateWeeklyReviewV21(r, input())).toThrow();
    });
    it.each(["proposedOwner", "proposedDue", "helpRequested"] as const)(
        "rejects unsupported %s",
        field => {
            const r = report();
            r.topics[0]![field] = field === "proposedDue" ? "2099-01-01" : "Unsupported detail";
            expect(() => validateWeeklyReviewV21(r, input())).toThrow(
                "unsupported_proposal_detail"
            );
        }
    );
    it("rejects incomplete mandatory context", () => {
        const i = input();
        i.mandatoryCoverage.included = 0;
        expect(() => validateWeeklyReviewV21(report(), i)).toThrow("required_context_incomplete");
    });
    it("addresses all displayed field values in exact candidate evaluation", () => {
        const r = report(),
            e = weeklyReviewEvaluation(r, input()),
            text = outputUnits(e)
                .map(u => u.text)
                .join("\n");
        for (const field of [
            r.headline,
            r.brief,
            r.summary,
            ...Object.values(r.topics[0]!).filter((v): v is string => typeof v === "string"),
            r.topics[0]!.unknowns[0]!,
            r.topics[0]!.recommendation!.call,
            r.keyFigures[0]!.label,
        ])
            expect(text).toContain(field);
        expect(e.actual.id).toBe(input().candidateId);
        expect(e.scenario.documents[0]!.id).toBe(ref);
    });
    it("admits exactly the report judged and fingerprints it", async () => {
        const p = ports(),
            result = await run(p);
        expect(result.evidence.reportHash).toBe(reviewFingerprint(result.report));
        expect(p.invoke).toHaveBeenCalledTimes(1);
        expect(p.authorizeDispatch.mock.calls.map(c => c[0])).toEqual(["generation", "judge"]);
    });
    it("rejects identical model identities before transport", async () => {
        const p = ports();
        p.judge = p.generation;
        await expect(run(p)).rejects.toThrow("independent_judge_required");
        expect(p.invoke).not.toHaveBeenCalled();
    });
    it("revocation before Generation prevents transport", async () => {
        const p = ports();
        p.authorizeDispatch.mockRejectedValueOnce(Error("revoked"));
        await expect(run(p)).rejects.toThrow("revoked");
        expect(p.invoke).not.toHaveBeenCalled();
    });
    it("revocation after Generation prevents Judge", async () => {
        const p = ports(),
            judge = vi.spyOn(p.validationJudge, "evaluate");
        p.authorizeDispatch.mockImplementation(async kind => {
            if (kind === "judge") throw Error("revoked");
        });
        await expect(run(p)).rejects.toThrow("revoked");
        expect(p.invoke).toHaveBeenCalledTimes(1);
        expect(judge).not.toHaveBeenCalled();
    });
    it("rejects unavailable Judge", async () => {
        const p = ports();
        p.validationJudge.evaluate = async () => {
            throw Error("unavailable");
        };
        await expect(run(p)).rejects.toThrow("judge_admission_failed");
    });
    it("a low-scoring valid Judge cannot admit the report", async () => {
        const p = ports(),
            base = passingJudge();
        p.validationJudge = {
            ...base,
            evaluate: async (request, signal) => {
                const answer = await base.evaluate(request, signal);
                const judgment = answer.judgment as { ratings: { score: number }[] };
                judgment.ratings.forEach(r => (r.score = 0));
                return answer;
            },
        };
        await expect(run(p)).rejects.toThrow("judge_admission_failed");
    });
    it("fabricated Judge evidence cannot pass admission", async () => {
        const p = ports(),
            base = passingJudge();
        p.validationJudge = {
            ...base,
            evaluate: async (request, signal) => {
                const answer = await base.evaluate(request, signal);
                const judgment = answer.judgment as {
                    ratings: { evidence: { quote: string }[] }[];
                };
                judgment.ratings[0]!.evidence[0]!.quote = "This exact quote was never supplied";
                return answer;
            },
        };
        await expect(run(p)).rejects.toThrow("judge_admission_failed");
    });
    it("rejects missing configured Judge without network", async () => {
        const p = ports();
        await expect(
            runWeeklyReviewV21(input(), {
                ...p,
                invoke: p.invoke as never,
                validationJudge: undefined,
            })
        ).rejects.toThrow();
    });
    it("invalid candidate never reaches Judge", async () => {
        const p = ports(),
            bad = report();
        bad.topics[0]!.facts[0]!.refs = ["doc:denied@v1"];
        p.invoke.mockResolvedValueOnce({
            result: bad,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });
        await expect(run(p)).rejects.toThrow("invalid_source_citation");
        expect(p.authorizeDispatch.mock.calls.map(c => c[0])).toEqual(["generation"]);
    });
    it("incomplete required context is refused before any provider dispatch", async () => {
        const p = ports(),
            value = input();
        value.mandatoryCoverage.included = 0;
        await expect(
            runWeeklyReviewV21(value, { ...p, invoke: p.invoke as never })
        ).rejects.toThrow("required_context_incomplete");
        expect(p.invoke).not.toHaveBeenCalled();
        expect(p.authorizeDispatch).not.toHaveBeenCalled();
    });
    it("bounds an abort-ignoring provider and never dispatches Judge", async () => {
        vi.useFakeTimers();
        try {
            const p = ports(),
                judge = vi.spyOn(p.validationJudge, "evaluate");
            const invoke = vi.fn(() => new Promise<never>(() => {}));
            const pending = runWeeklyReviewV21(input(), {
                ...p,
                invoke: invoke as never,
                generationTimeoutMs: 1,
            });
            const rejected = expect(pending).rejects.toThrow("provider_timeout");
            await vi.advanceTimersByTimeAsync(2);
            await rejected;
            expect(invoke).toHaveBeenCalledTimes(1);
            expect(p.authorizeDispatch.mock.calls.map(call => call[0])).toEqual(["generation"]);
            expect(judge).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
    it("provider timeout propagates without Judge admission", async () => {
        const p = ports();
        p.invoke.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
        await expect(run(p)).rejects.toThrow("Timed out");
        expect(p.authorizeDispatch.mock.calls.map(c => c[0])).toEqual(["generation"]);
    });
});
