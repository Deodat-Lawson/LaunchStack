import { describe, expect, it, vi } from "vitest";
import type { ResolvedChatModel } from "@launchstack/llm";
import {
    parseWeeklyReviewRetrievalContext,
    WeeklyReviewRetrievalContextSchema,
    WEEKLY_REVIEW_RETRIEVAL_PROMPT,
    type WeeklyReviewRetrievalContext,
} from "./dynamic-retrieval-v3";
import {
    calculateWeeklyReviewBudget,
    runWeeklyReviewV21,
    weeklyReviewAdmissionBytes,
    weeklyReviewEvaluation,
    WEEKLY_REVIEW_SYSTEM_PROMPT,
    type WeeklyReviewInput,
    type WeeklyReviewV21,
} from "./weekly-review-v21";
import { RATED_CRITERIA, type ValidationJudge } from "./validation/contracts";
import { judgeInputPayload } from "./validation/input";

const context = (): WeeklyReviewRetrievalContext => ({
    schemaVersion: "vantage-dynamic-retrieval/v3",
    mode: "combined",
    businessRole: {
        primaryRole: "Finance",
        responsibilities: ["reconciliation"],
        priorities: ["runway"],
        revision: 2,
    },
    internalDecision: {
        outcome: "INSUFFICIENT_EVIDENCE",
        questions: ["Which amount is authoritative?"],
    },
    traceHash: "a".repeat(64),
});
const input = (): WeeklyReviewInput => ({
    candidateId: "candidate-1",
    week: "2026-11-09",
    asOf: "2026-11-09T12:00:00Z",
    role: "owner",
    mandatoryCoverage: { required: 1, included: 1 },
    sources: [
        {
            ref: "doc:finance@v1",
            version: "v1",
            hash: "b".repeat(64),
            purpose: "workspace-required",
            title: "Finance",
            text: "Revenue is provisional.",
        },
    ],
});
const report = (): WeeklyReviewV21 => ({
    schemaVersion: "vantage-weekly-review/v2.1",
    headline: "Review revenue",
    brief: "Review",
    summary: "Revenue is provisional.",
    keyFigures: [],
    topics: [
        {
            title: "Revenue",
            facts: [{ text: "Revenue is provisional.", refs: ["doc:finance@v1"] }],
            conflicts: [],
            whyItMatters: "Reconciliation",
            whyNow: "Provisional amount",
            decisionQuestion: "Reconcile?",
            rationale: "Unknown amount",
            recommendation: null,
            proposedNextStep: "",
            unknowns: ["Amount"],
            proposedOwner: null,
            proposedDue: null,
            helpRequested: null,
        },
    ],
});
function ports() {
    const validationJudge: ValidationJudge = {
        kind: "fixture-replay",
        id: "synthetic-context-test",
        evaluate: vi.fn(async (request: Parameters<ValidationJudge["evaluate"]>[0]) => {
            const source = request.input.scenario.documents[0]!,
                unit = request.outputUnits[0]!;
            const evidence = [
                { kind: "source" as const, id: source.id, quote: source.text },
                { kind: "output" as const, id: unit.id, quote: unit.text },
            ];
            return {
                judgment: {
                    expectations: request.input.scenario.expectations.map(item => ({
                        expectationId: item.id,
                        verdict: "met" as const,
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
        }),
    };
    return {
        generation: { modelId: "generation" } as ResolvedChatModel,
        judge: { modelId: "judge" } as ResolvedChatModel,
        authorizeDispatch: vi.fn(async (_kind: "generation" | "judge") => {}),
        invoke: vi.fn(async () => ({
            result: report(),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        })),
        validationJudge,
    };
}

describe("dynamic retrieval v3 model-facing contract", () => {
    it.each(["role", "internal-research", "combined"] as const)("accepts exact mode %s", mode => {
        expect(parseWeeklyReviewRetrievalContext({ ...context(), mode }).mode).toBe(mode);
    });
    it.each(["baseline", "research", "external-research", "ROLE", ""])("rejects mode %s", mode => {
        expect(WeeklyReviewRetrievalContextSchema.safeParse({ ...context(), mode }).success).toBe(
            false
        );
    });
    it("allows role absence and preserves exact context bytes during parse", () => {
        const raw = {
            schemaVersion: "vantage-dynamic-retrieval/v3",
            mode: "role",
            traceHash: "0".repeat(64),
        };
        expect(JSON.stringify(parseWeeklyReviewRetrievalContext(raw))).toBe(JSON.stringify(raw));
    });
    it("accepts maximum bounded role and questions and rejects overflow", () => {
        const maximum = {
            ...context(),
            businessRole: {
                primaryRole: "r".repeat(80),
                responsibilities: Array(8).fill("r".repeat(160)),
                priorities: Array(8).fill("p".repeat(160)),
                revision: 1,
            },
            internalDecision: {
                outcome: "INTERNAL_FOLLOW_UP",
                questions: Array(3).fill("q".repeat(300)),
            },
        };
        expect(WeeklyReviewRetrievalContextSchema.safeParse(maximum).success).toBe(true);
        for (const businessRole of [
            { ...maximum.businessRole, primaryRole: "r".repeat(81) },
            { ...maximum.businessRole, responsibilities: Array(9).fill("r") },
            { ...maximum.businessRole, priorities: ["p".repeat(161)] },
            { ...maximum.businessRole, revision: 0 },
        ])
            expect(
                WeeklyReviewRetrievalContextSchema.safeParse({ ...maximum, businessRole }).success
            ).toBe(false);
        expect(
            WeeklyReviewRetrievalContextSchema.safeParse({
                ...maximum,
                internalDecision: { outcome: "STOP", questions: Array(4).fill("q") },
            }).success
        ).toBe(false);
        expect(
            WeeklyReviewRetrievalContextSchema.safeParse({
                ...maximum,
                internalDecision: { outcome: "STOP", questions: ["q".repeat(301)] },
            }).success
        ).toBe(false);
    });
    it("rejects unknown properties, malformed trace hashes and whitespace-only role fields", () => {
        for (const raw of [
            { ...context(), authorization: true },
            { ...context(), traceHash: "tampered" },
            { ...context(), businessRole: { ...context().businessRole, primaryRole: "   " } },
            {
                ...context(),
                internalDecision: { outcome: "STOP", questions: [], facts: ["invented"] },
            },
        ])
            expect(WeeklyReviewRetrievalContextSchema.safeParse(raw).success).toBe(false);
    });
    it("projects the complete context to Judge payload and exact admission bytes", () => {
        const candidate = { ...input(), retrievalContext: context() };
        const evaluation = weeklyReviewEvaluation(report(), candidate);
        expect(JSON.parse(evaluation.scenario.title).retrievalContext).toEqual(context());
        expect(judgeInputPayload(evaluation)).toContain("Which amount is authoritative?");
        expect(weeklyReviewAdmissionBytes(report(), candidate)).toEqual({
            evaluationInputBytes: Buffer.byteLength(JSON.stringify(evaluation)),
            judgeInputBytes: Buffer.byteLength(judgeInputPayload(evaluation)),
        });
    });
    it("counts exact Generator JSON and additional Judge context overhead", () => {
        const baseline = calculateWeeklyReviewBudget(input());
        const candidate = { ...input(), retrievalContext: context() };
        const enriched = calculateWeeklyReviewBudget(candidate);
        expect(enriched.inputBytes).toBe(Buffer.byteLength(JSON.stringify(candidate)));
        expect(enriched.inputBytes).toBeGreaterThan(baseline.inputBytes);
        expect(enriched.evaluationOverhead).toBeGreaterThan(baseline.evaluationOverhead);
        expect(enriched.maxReportBytes).toBeLessThan(baseline.maxReportBytes);
    });
    it("rejects tampered context through every public admission path before dispatch", async () => {
        const candidate = { ...input(), retrievalContext: { ...context(), traceHash: "invalid" } };
        const p = ports();
        expect(() => calculateWeeklyReviewBudget(candidate)).toThrow();
        expect(() => weeklyReviewEvaluation(report(), candidate)).toThrow();
        expect(() => weeklyReviewAdmissionBytes(report(), candidate)).toThrow();
        await expect(
            runWeeklyReviewV21(candidate, { ...p, invoke: p.invoke as never })
        ).rejects.toThrow();
        expect(p.authorizeDispatch).not.toHaveBeenCalled();
        expect(p.invoke).not.toHaveBeenCalled();
    });
    it("sends identical context to Generator, Judge and persisted input snapshot", async () => {
        const candidate = { ...input(), retrievalContext: context() },
            p = ports();
        const result = await runWeeklyReviewV21(candidate, { ...p, invoke: p.invoke as never });
        const messages = (
            p.invoke.mock.calls[0] as unknown as [unknown, unknown, { content: string }[]]
        )[2];
        expect(JSON.parse(messages[1]!.content).retrievalContext).toEqual(context());
        expect(messages[0]!.content).toContain(WEEKLY_REVIEW_RETRIEVAL_PROMPT);
        expect(messages[0]!.content).toContain("grants no authorization");
        expect(messages[0]!.content).toContain("unresolved hypotheses");
        expect(messages[0]!.content).toContain("without tools, fetching or actions");
        const judgeRequest = vi.mocked(p.validationJudge.evaluate).mock.calls[0]![0];
        expect(JSON.parse(judgeRequest.input.scenario.title).retrievalContext).toEqual(context());
        expect(result.evidence.inputSnapshot.retrievalContext).toEqual(context());
    });
    it("preserves absent-context Generator payload, system prompt and legacy Judge title bytes", async () => {
        const candidate = input(),
            p = ports();
        const result = await runWeeklyReviewV21(candidate, { ...p, invoke: p.invoke as never });
        const messages = (
            p.invoke.mock.calls[0] as unknown as [unknown, unknown, { content: string }[]]
        )[2];
        expect(messages[1]!.content).toBe(JSON.stringify(candidate));
        expect(messages[0]!.content).toBe(
            WEEKLY_REVIEW_SYSTEM_PROMPT +
                " Maximum serialized UTF-8 report bytes: " +
                calculateWeeklyReviewBudget(candidate).maxReportBytes +
                ". Prefer fewer topics to fit this bound."
        );
        expect(weeklyReviewEvaluation(report(), candidate).scenario.title).toBe(
            JSON.stringify({
                week: candidate.week,
                role: candidate.role,
                mandatoryCoverage: candidate.mandatoryCoverage,
            })
        );
        expect(result.evidence.inputSnapshot).not.toHaveProperty("retrievalContext");
    });
});
