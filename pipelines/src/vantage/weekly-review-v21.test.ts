import { describe, it, expect, vi } from "vitest";
import { InvalidStructuredAttemptError, type ResolvedChatModel } from "@launchstack/llm";
import { RATED_CRITERIA, type ValidationJudge, type Judgment } from "./validation/contracts";
import { evaluateVantage } from "./validation/evaluate";
import { outputUnits } from "./validation/input";
import * as evaluationInputModule from "./validation/input";
import {
    WeeklyReviewDiagnosticError,
    weeklyReviewDiagnosticSnapshot,
    WEEKLY_REVIEW_DIAGNOSTIC_RULE_CODES,
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
        await expect(
            runWeeklyReviewV21(candidate, { ...p, invoke: p.invoke as never })
        ).rejects.toThrow();
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
        expect(result.evidence.schemaVersion).toBe("vantage-admission/v1");
        expect(result.evidence).not.toHaveProperty("budget");
        expect(result.evidence).not.toHaveProperty("selectionDiagnostics");
    });
    it("records private internal diagnostics without putting them into model input", async () => {
        const p = ports();
        const selectionDiagnostics = {
            privateMarker: "server-private-only",
            omitted: ["unselected-ref"],
        };
        const result = await runWeeklyReviewV21(input(), {
            ...p,
            invoke: p.invoke as never,
            budgetProfile: "internal-v1",
            selectionDiagnostics,
        });
        expect(result.evidence.schemaVersion).toBe("vantage-admission/v2");
        expect(result.evidence.budget?.reportReserveBytes).toBe(2800);
        expect(result.evidence.selectionDiagnostics).toEqual(selectionDiagnostics);
        selectionDiagnostics.omitted.push("later-mutation");
        expect(result.evidence.selectionDiagnostics).not.toEqual(selectionDiagnostics);
        expect(JSON.stringify(p.invoke.mock.calls)).not.toContain("server-private-only");
        expect(JSON.stringify(result.evidence.inputSnapshot)).not.toContain("server-private-only");
    });
    it("ignores selection diagnostics when the internal profile is disabled", async () => {
        const p = ports();
        const result = await runWeeklyReviewV21(input(), {
            ...p,
            invoke: p.invoke as never,
            selectionDiagnostics: { privateMarker: "server-private-only" },
        });
        expect(result.evidence.schemaVersion).toBe("vantage-admission/v1");
        expect(result.evidence).not.toHaveProperty("selectionDiagnostics");
    });
    it("refuses an unavailable internal reserve before either provider dispatch", async () => {
        const candidate = input();
        candidate.sources[0]!.text = "x".repeat(4500);
        candidate.sources.push({ ...candidate.sources[0]!, ref: "doc:second@v1" });
        candidate.mandatoryCoverage = { required: 2, included: 2 };
        const p = ports();
        await expect(
            runWeeklyReviewV21(candidate, {
                ...p,
                invoke: p.invoke as never,
                budgetProfile: "internal-v1",
            })
        ).rejects.toThrow("context_budget_exceeded");
        expect(p.authorizeDispatch).not.toHaveBeenCalled();
        expect(p.invoke).not.toHaveBeenCalled();
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

describe("observational generation completion", () => {
    it("notifies before deterministic validation rejects the generated report", async () => {
        const p = ports();
        const complete = vi.fn();
        p.invoke.mockResolvedValue({
            result: { ...report(), schemaVersion: "invalid" } as never,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        });
        await expect(
            runWeeklyReviewV21(input(), {
                ...p,
                invoke: p.invoke as never,
                onGenerationComplete: complete,
            })
        ).rejects.toThrow();
        expect(complete).toHaveBeenCalledTimes(1);
        expect(p.authorizeDispatch.mock.calls).toEqual([["generation"]]);
    });
    it("observer failure cannot change admission or add provider dispatches", async () => {
        const p = ports();
        const result = await runWeeklyReviewV21(input(), {
            ...p,
            invoke: p.invoke as never,
            onGenerationComplete: () => {
                throw Error("disconnected");
            },
        });
        expect(result.report.headline).toBe(report().headline);
        expect(p.authorizeDispatch.mock.calls).toEqual([["generation"], ["judge"]]);
        expect(p.invoke).toHaveBeenCalledTimes(1);
    });
});

describe("content-free topic-first failure diagnostics", () => {
    const topicInput = () => ({
        ...input(),
        retrievalContext: {
            schemaVersion: "vantage-topic-retrieval/v1" as const,
            mode: "topic-first" as const,
            guidanceLabel: "owner notes, not evidence" as const,
            topics: [],
            seedReasons: [],
            lane: { outcome: "none_eligible" as const, candidates: 0, admitted: 0 },
            traceHash: "a".repeat(64),
        },
    });
    async function failure(p: ReturnType<typeof ports>) {
        try {
            await runWeeklyReviewV21(topicInput(), {
                ...p,
                invoke: p.invoke as never,
                budgetProfile: "topic-first",
            });
            throw new Error("Expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(WeeklyReviewDiagnosticError);
            const snapshot = weeklyReviewDiagnosticSnapshot(error)!;
            const serialized = JSON.stringify(snapshot);
            for (const privateValue of [
                ref,
                "Revenue",
                "Alice",
                "Finance",
                "PRIVATE_CANARY",
                "Synthetic assessment",
            ])
                expect(serialized).not.toContain(privateValue);
            expect(
                snapshot.ruleCodes.every(code => WEEKLY_REVIEW_DIAGNOSTIC_RULE_CODES.includes(code))
            ).toBe(true);
            expect(Object.keys(snapshot.counts).sort()).toEqual(
                [
                    "sourceUnits",
                    "evidenceBytes",
                    "messageBytes",
                    "citationsChecked",
                    "citationsFailed",
                ].sort()
            );
            return { error: error as Error, snapshot };
        }
    }
    it.each([
        ["json_invalid", "generation_output_json_invalid"],
        ["schema_invalid", "generation_output_schema_invalid"],
        ["output_too_large", "generation_output_too_large"],
        [undefined, "generation_structured_output_invalid"],
    ] as const)("audits a pre-validation generation failure (%s)", async (reason, code) => {
        const p = ports();
        const structuredFailure = new InvalidStructuredAttemptError(reason);
        structuredFailure.message = "PRIVATE_CANARY";
        p.invoke.mockRejectedValue(structuredFailure);
        const { error, snapshot } = await failure(p);
        expect(error.message).toBe(code);
        expect(snapshot.stage).toBe("generation");
        expect(snapshot.ruleCodes).toEqual([code]);
        expect(snapshot.counts).toMatchObject({
            sourceUnits: 1,
            citationsChecked: null,
            citationsFailed: null,
        });
        expect(p.invoke).toHaveBeenCalledTimes(1);
        expect(p.authorizeDispatch).toHaveBeenCalledTimes(1);
        expect(p.authorizeDispatch).toHaveBeenCalledWith("generation");
    });
    it.each([
        [
            "report_schema_invalid",
            (r: WeeklyReviewV21) => {
                r.headline = "PRIVATE_CANARY".repeat(10);
            },
        ],
        [
            "invalid_source_citation",
            (r: WeeklyReviewV21) => {
                r.topics[0]!.facts[0]!.refs = ["PRIVATE_CANARY"];
            },
        ],
        [
            "unsupported_proposal_detail",
            (r: WeeklyReviewV21) => {
                r.topics[0]!.proposedOwner = "PRIVATE_CANARY";
            },
        ],
        [
            "derivation_reference_mismatch",
            (r: WeeklyReviewV21) => {
                r.keyFigures[0]!.derivation!.inputs[0]!.ref = "PRIVATE_CANARY";
            },
        ],
        [
            "unsupported_derivation_input",
            (r: WeeklyReviewV21) => {
                r.keyFigures[0]!.derivation!.inputs[0]!.value = 123456789;
            },
        ],
        [
            "invalid_numeric_derivation",
            (r: WeeklyReviewV21) => {
                r.keyFigures[0]!.value = "123456789";
            },
        ],
    ] as const)("identifies %s without field values", async (code, mutate) => {
        const p = ports(),
            r = report();
        mutate(r);
        p.invoke.mockResolvedValue({
            result: r,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        });
        const { snapshot } = await failure(p);
        expect(snapshot.stage).toBe("generation_validation");
        expect(snapshot.ruleCodes).toEqual([code]);
        expect(p.authorizeDispatch).toHaveBeenCalledTimes(1);
        if (code === "invalid_source_citation") expect(snapshot.counts.citationsFailed).toBe(1);
    });
    it("identifies a generic near-limit schema rejection", async () => {
        const p = ports(),
            r = report();
        r.headline = "x".repeat(121);
        p.invoke.mockResolvedValue({
            result: r,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        });
        expect((await failure(p)).snapshot.ruleCodes).toEqual(["report_schema_invalid"]);
    });
    it.each([
        [
            "Evaluation input exceeds 14000 bytes; explicitly prepare smaller scenario excerpts. Nothing was truncated.",
            "evaluation_input_budget_exceeded",
        ],
        [
            "Invalid evaluation input. Use the versioned scenario/expectation/output schema.",
            "evaluation_input_schema_invalid",
        ],
        [
            "Expectation evidence must quote an available source at the scenario cutoff.",
            "expectation_source_citation_invalid",
        ],
        ["PRIVATE_CANARY", "evaluation_input_invalid"],
    ])("identifies evaluation rejection using fixed rules (%s)", async (message, code) => {
        const original = evaluationInputModule.parseEvaluationInput;
        const spy = vi
            .spyOn(evaluationInputModule, "parseEvaluationInput")
            .mockImplementation((raw, limit) => {
                if ((raw as { actual?: { summary?: string } }).actual?.summary === report().summary)
                    throw new Error(message);
                return original(raw, limit);
            });
        try {
            const { snapshot } = await failure(ports());
            expect(snapshot.stage).toBe("evaluation_input");
            expect(snapshot.ruleCodes).toEqual([code]);
            expect(snapshot.counts.messageBytes).toBeGreaterThan(0);
        } finally {
            spy.mockRestore();
        }
    });
    it.each([
        [
            "judge_schema_invalid",
            (j: Judgment) => {
                j.ratings[0]!.score = 99 as never;
            },
        ],
        [
            "judge_coverage_invalid",
            (j: Judgment) => {
                j.expectations = [];
            },
        ],
        [
            "judge_evidence_quote_invalid",
            (j: Judgment) => {
                j.ratings[0]!.evidence = j.ratings[0]!.evidence.map((e, index) =>
                    index === 0 ? { ...e, quote: "PRIVATE_CANARY" } : e
                );
            },
        ],
        [
            "judge_expectation_verdict_invalid",
            (j: Judgment) => {
                j.expectations[0]!.verdict = "violated";
            },
        ],
        [
            "judge_source_evidence_missing",
            (j: Judgment) => {
                j.expectations[0]!.evidence = j.expectations[0]!.evidence.filter(
                    e => e.kind === "output"
                );
            },
        ],
        [
            "judge_output_evidence_missing",
            (j: Judgment) => {
                j.expectations[0]!.evidence = j.expectations[0]!.evidence.filter(
                    e => e.kind === "source"
                );
            },
        ],
        [
            "judge_rating_output_evidence_missing",
            (j: Judgment) => {
                j.ratings[0]!.evidence = j.ratings[0]!.evidence.filter(e => e.kind === "source");
            },
        ],
        [
            "judge_rating_source_evidence_missing",
            (j: Judgment) => {
                j.ratings[0]!.evidence = j.ratings[0]!.evidence.filter(e => e.kind === "output");
            },
        ],
        [
            "judge_critical_expectation_missed",
            (j: Judgment) => {
                j.expectations[0]!.verdict = "missed";
            },
        ],
        [
            "judge_status_partial",
            (j: Judgment) => {
                j.ratings[0]!.score = null;
            },
        ],
        ...RATED_CRITERIA.map(
            criterion =>
                [
                    `judge_metric_${criterion}_below_threshold`,
                    (j: Judgment) => {
                        j.ratings.find(r => r.criterion === criterion)!.score = 2;
                    },
                ] as const
        ),
    ] as const)("identifies %s without assessment content", async (code, mutate) => {
        const p = ports(),
            original = passingJudge();
        p.validationJudge = {
            ...original,
            evaluate: async (request, signal) => {
                const answer = await original.evaluate(request, signal);
                mutate(answer.judgment as Judgment);
                return answer;
            },
        };
        const { error, snapshot } = await failure(p);
        expect(error.message).toBe("judge_admission_failed");
        expect(snapshot.stage).toBe("judge");
        expect(snapshot.ruleCodes).toContain(code);
        if (code === "judge_evidence_quote_invalid")
            expect(snapshot.counts.citationsFailed).toBe(1);
        if (code === "judge_schema_invalid") expect(snapshot.counts.citationsChecked).toBeNull();
    });
    it("keeps arbitrary provider text out of diagnostics", async () => {
        const p = ports();
        p.validationJudge = {
            ...passingJudge(),
            evaluate: async () => {
                throw new Error("PRIVATE_CANARY");
            },
        };
        const { snapshot } = await failure(p);
        expect(snapshot.ruleCodes).toContain("provider-error");
        expect(snapshot.counts.citationsChecked).toBeNull();
    });
    it("keeps observer failures from changing assessment", async () => {
        const assessed = await evaluateVantage(weeklyReviewEvaluation(report(), input()), {
            judge: passingJudge(),
            onDiagnostic: () => {
                throw new Error("PRIVATE_CANARY");
            },
        });
        expect(assessed.verdict).toBe("pass");
        expect(assessed.error).toBeNull();
    });
    it("identifies invalid Judge setup after Generation", async () => {
        const p = ports();
        try {
            await runWeeklyReviewV21(topicInput(), {
                ...p,
                validationJudge: undefined,
                invoke: p.invoke as never,
                budgetProfile: "topic-first",
                judgeTimeoutMs: NaN,
            });
            throw new Error("Expected setup failure");
        } catch (error) {
            expect((error as Error).message).toBe(
                "Invalid validation judge limits or configuration identity."
            );
            expect(weeklyReviewDiagnosticSnapshot(error)?.ruleCodes).toEqual([
                "judge_setup_invalid",
            ]);
        }
    });
    it("does not attach snapshots to legacy failures or forged objects", async () => {
        const p = ports();
        p.invoke.mockResolvedValue({
            result: {} as never,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        });
        try {
            await run(p);
        } catch (error) {
            expect(weeklyReviewDiagnosticSnapshot(error)).toBeNull();
        }
        expect(
            weeklyReviewDiagnosticSnapshot({ stage: "judge", ruleCodes: ["PRIVATE_CANARY"] })
        ).toBeNull();
    });
    it("sanitizes numeric counts and returns independent snapshot copies", () => {
        const error = new WeeklyReviewDiagnosticError("PRIVATE_CANARY", {
            stage: "judge",
            ruleCodes: ["judge_admission_failed", "PRIVATE_CANARY" as never],
            counts: {
                sourceUnits: 1,
                evidenceBytes: NaN,
                messageBytes: Infinity,
                citationsChecked: -1,
                citationsFailed: 1.2,
            },
        });
        const snapshot = weeklyReviewDiagnosticSnapshot(error)!;
        expect(snapshot).toEqual({
            stage: "judge",
            ruleCodes: ["judge_admission_failed"],
            counts: {
                sourceUnits: 1,
                evidenceBytes: null,
                messageBytes: null,
                citationsChecked: null,
                citationsFailed: null,
            },
        });
        snapshot.ruleCodes.push("timeout");
        snapshot.counts.sourceUnits = 999;
        expect(weeklyReviewDiagnosticSnapshot(error)!.ruleCodes).toEqual([
            "judge_admission_failed",
        ]);
        expect(weeklyReviewDiagnosticSnapshot(error)!.counts.sourceUnits).toBe(1);
    });
});
