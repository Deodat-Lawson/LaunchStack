import { describe, expect, it, vi } from "vitest";
import type { ResolvedChatModel } from "@launchstack/llm";
import {
    canonicalParentText,
    compileScopedEvidence,
    hashScopedText,
    type ScopedParent,
    type ScopedAuthority,
} from "./scoped-evidence";
import {
    calculateWeeklyReviewBudget,
    runWeeklyReviewV21,
    validateScopedWeeklyReviewInput,
    weeklyReviewEvaluation,
    type WeeklyReviewInput,
    type WeeklyReviewV21,
} from "./weekly-review-v21";
import { outputUnits, parseEvaluationInput } from "./validation/input";
import {
    RATED_CRITERIA,
    SCOPED_EVALUATION_VERSION,
    SCOPED_RUBRIC_VERSION,
    type ValidationJudge,
} from "./validation/contracts";
import { createModelValidationJudge } from "./validation/judge";

function fixture() {
    const parent: ScopedParent = {
        companyId: "company",
        documentId: "finance",
        version: "7",
        versionDate: "2026-11-01T00:00:00Z",
        availableAt: "2026-11-02T00:00:00Z",
        title: "Synthetic finance",
        purpose: "workspace-required",
        originalCompleteness: "unknown",
        chunks: Array.from({ length: 129 }, (_, ordinal) => ({
            id: `chunk-${ordinal}`,
            ordinal,
            text:
                ordinal === 0
                    ? "Revenue recorded is 12000. Approval remains unknown. " + "a".repeat(203)
                    : "a".repeat(255),
        })),
    };
    const text = canonicalParentText(parent);
    const authority: ScopedAuthority = {
        actorId: "actor",
        companyId: "company",
        documentId: "finance",
        version: "7",
        authorized: true,
        aclRevision: "acl-1",
        authorityRevision: "admin-1",
        purpose: "workspace-required",
        audience: "company",
        companyReadable: true,
        finiteScope: {
            qualification:
                "Administrator-authorized finance spans only. The remaining parent and original PDF/OCR completeness are unreviewed.",
            requiredUnits: [
                {
                    id: "finance-unit",
                    start: 0,
                    end: 2000,
                    excerptHash: hashScopedText(text.slice(0, 2000)),
                },
            ],
        },
    };
    const prepared = compileScopedEvidence(
        {
            actorId: "actor",
            companyId: "company",
            documentId: "finance",
            version: "7",
            asOf: "2026-11-13T00:00:00Z",
            expectedParentHash: hashScopedText(text),
            selectedUnitIds: ["finance-unit"],
        },
        parent,
        authority
    );
    const ref = prepared.modelFacingProjection.sources[0]!.ref;
    const input: WeeklyReviewInput = {
        candidateId: "candidate-scoped",
        week: "2026-11-09",
        asOf: prepared.request.asOf,
        role: "owner",
        mandatoryCoverage: { required: 1, included: 1 },
        sources: prepared.modelFacingProjection.sources.map(
            ({ ref, version, hash, text, purpose, title }) => ({
                ref,
                version,
                hash,
                text,
                purpose,
                title,
            })
        ),
        scopedEvidence: [prepared.dependency],
    };
    const report: WeeklyReviewV21 = {
        schemaVersion: "vantage-weekly-review/v2.1",
        headline: "Finance spans reviewed",
        brief: "Authorized finance spans only",
        summary: "Revenue recorded is 12000. Approval remains unknown.",
        keyFigures: [],
        topics: [
            {
                title: "Finance record",
                facts: [{ text: "Revenue recorded is 12000.", refs: [ref] }],
                conflicts: [],
                whyItMatters: "Recorded revenue informs the review.",
                whyNow: "Finance is required for this review.",
                decisionQuestion: "What approval evidence is available?",
                rationale: "Approval remains unknown.",
                recommendation: null,
                proposedNextStep: "Review approval evidence",
                unknowns: ["Approval"],
                proposedOwner: null,
                proposedDue: null,
                helpRequested: null,
            },
        ],
    };
    return { parent, authority, prepared, input, report, ref };
}
function fixtureJudge(verdict: "met" | "missed" = "met", partial = false): ValidationJudge {
    return {
        kind: "fixture-replay",
        id: "synthetic-scoped-v2",
        evaluate: async request => {
            expect(request.rubricVersion).toBe(SCOPED_RUBRIC_VERSION);
            const output = request.outputUnits[0]!;
            return {
                judgment: {
                    expectations: request.input.scenario.expectations.map(expected => ({
                        expectationId: expected.id,
                        verdict,
                        reason: "Synthetic scope assessment",
                        evidence: [
                            {
                                kind: "source",
                                id: expected.evidence[0]!.sourceId,
                                quote: expected.evidence[0]!.quote,
                            },
                            { kind: "output", id: output.id, quote: output.text },
                        ],
                    })),
                    ratings: RATED_CRITERIA.map((criterion, i) => ({
                        criterion,
                        score: partial && i === 0 ? null : 4,
                        reason: "Synthetic rating",
                        evidence: [
                            {
                                kind: "source",
                                id: request.input.scenario.documents[0]!.id,
                                quote: request.input.scenario.documents[0]!.text.slice(0, 20),
                            },
                            { kind: "output", id: output.id, quote: output.text },
                        ],
                    })),
                },
            };
        },
    };
}
function ports(report: WeeklyReviewV21, judge = fixtureJudge()) {
    return {
        generation: { modelId: "synthetic-generation" } as ResolvedChatModel,
        judge: { modelId: "synthetic-judge" } as ResolvedChatModel,
        authorizeDispatch: vi.fn(async () => {}),
        invoke: vi.fn(async () => ({ result: report, usage: {} })) as never,
        validationJudge: judge,
        budgetProfile: "scoped-v2" as const,
    };
}

describe("weekly review scoped-v2 experimental admission", () => {
    it("admits the authorized spans of a 32KB/129-chunk required parent through the normal pipeline", async () => {
        const { parent, prepared, input, report } = fixture();
        expect(Buffer.byteLength(canonicalParentText(parent))).toBeGreaterThan(32000);
        expect(parent.chunks).toHaveLength(129);
        const budget = calculateWeeklyReviewBudget(input, "scoped-v2");
        expect(budget.feasible).toBe(true);
        expect(budget.reportReserveBytes).toBe(2800);
        const p = ports(report);
        const result = await runWeeklyReviewV21(input, p);
        expect(p.authorizeDispatch).toHaveBeenNthCalledWith(1, "generation");
        expect(p.authorizeDispatch).toHaveBeenNthCalledWith(2, "judge");
        expect(result.evidence.schemaVersion).toBe("vantage-admission/v3");
        expect(result.evidence.evaluationInputBytes).toBeLessThanOrEqual(14000);
        expect(result.evidence.judgeInputBytes).toBeLessThanOrEqual(14000);
        expect(result.evidence.evaluation).toMatchObject({
            version: SCOPED_EVALUATION_VERSION,
            rubricVersion: SCOPED_RUBRIC_VERSION,
            verdict: "pass",
            status: "assessed",
            contextCompleteness: "scoped",
        });
        expect(result.evidence.scopedEvidence).toEqual([prepared.dependency]);
        expect(result.evidence.evaluation.scopedEvidence?.[0]!.coverage).toMatchObject({
            state: "relevant_spans_reviewed",
            originalCompleteness: "unknown",
        });
        expect(result.evidence.inputSnapshot.scopedEvidence?.[0]!.coverage.qualification).toBe(
            prepared.dependency.coverage.qualification
        );
        const evaluated = weeklyReviewEvaluation(result.report, input);
        expect(evaluated.scenario.documents[0]!.availableAt).toBe(parent.availableAt);
        expect(Buffer.byteLength(JSON.stringify(evaluated))).toBeLessThanOrEqual(14000);
        expect(outputUnits(evaluated).some(unit => unit.id.includes("headline"))).toBe(true);
    });
    it.each(["missed", "partial"])("rejects a %s semantic assessment", async mode => {
        const { input, report } = fixture();
        await expect(
            runWeeklyReviewV21(
                input,
                ports(
                    report,
                    fixtureJudge(mode === "missed" ? "missed" : "met", mode === "partial")
                )
            )
        ).rejects.toThrow("judge_admission_failed");
    });
    it.each([
        "missing-unit",
        "missing-proof",
        "ref",
        "hash",
        "text",
        "version",
        "scope-hash",
        "future",
        "inventory",
        "full-parent-claim",
        "partial-coverage",
    ])("rejects %s before generation dispatch", async mode => {
        const { input: original, report } = fixture();
        const input = structuredClone(original);
        const proof = input.scopedEvidence![0]!;
        if (mode === "missing-unit") input.sources = [];
        if (mode === "missing-proof") delete input.scopedEvidence;
        if (mode === "ref") input.sources[0]!.ref = "unit:" + "0".repeat(64);
        if (mode === "hash") input.sources[0]!.hash = "0".repeat(64);
        if (mode === "text") input.sources[0]!.text += "changed";
        if (mode === "version") input.sources[0]!.version = "8";
        if (mode === "scope-hash") proof.scopeHash = "0".repeat(64);
        if (mode === "future") proof.versionDate = "2026-12-01T00:00:00Z";
        if (mode === "inventory") proof.requiredUnits[0]!.end += 1;
        if (mode === "full-parent-claim") proof.coverage.state = "full_document_reviewed";
        if (mode === "partial-coverage") proof.coverage.state = "insufficient_evidence";
        const p = ports(report);
        await expect(runWeeklyReviewV21(input, p)).rejects.toThrow();
        expect(p.authorizeDispatch).not.toHaveBeenCalled();
    });
    it("requires the explicit experimental budget profile and preserves document-level mandatory coverage", async () => {
        const { input, report } = fixture();
        expect(calculateWeeklyReviewBudget(input, "internal-v1").feasible).toBe(false);
        await expect(
            runWeeklyReviewV21(input, { ...ports(report), budgetProfile: "internal-v1" })
        ).rejects.toThrow("scoped_budget_profile_mismatch");
        input.mandatoryCoverage = { required: 2, included: 1 };
        await expect(runWeeklyReviewV21(input, ports(report))).rejects.toThrow(
            "required_context_incomplete"
        );
    });
    it("supports mixed whole-document requirements and scoped required spans", async () => {
        const { input, report } = fixture();
        input.sources.push({
            ref: "doc:whole@1",
            version: "1",
            hash: hashScopedText("Whole company architecture."),
            purpose: "company-architecture",
            title: "Company architecture",
            text: "Whole company architecture.",
        });
        input.mandatoryCoverage = { required: 2, included: 2 };
        validateScopedWeeklyReviewInput(input);
        const result = await runWeeklyReviewV21(input, ports(report));
        expect(result.evidence.evaluation.verdict).toBe("pass");
        expect(result.evidence.evaluation.expectations).toHaveLength(2);
    });
    it("requires a critical semantic expectation for every administrator-required unit", () => {
        const { input, report } = fixture();
        const evaluated = weeklyReviewEvaluation(report, input);
        evaluated.scenario.expectations[0]!.importance = "normal";
        expect(() => parseEvaluationInput(evaluated)).toThrow("Every required scoped unit");
    });
    it("preserves all canonical presented fields in the V2 projection", () => {
        const { input, report } = fixture();
        const evaluated = weeklyReviewEvaluation(report, input);
        const units = outputUnits(evaluated);
        for (const value of [
            report.headline,
            report.brief,
            report.summary,
            report.topics[0]!.whyNow,
            report.topics[0]!.rationale,
            report.topics[0]!.proposedNextStep,
        ])
            expect(units.some(unit => unit.text.includes(value))).toBe(true);
        expect(parseEvaluationInput(evaluated)).toEqual(evaluated);
    });
    it("uses the scoped rubric and exact evidence-location schema with an injected model adapter", async () => {
        const { input, report } = fixture();
        const evaluated = weeklyReviewEvaluation(report, input);
        const invoke = vi.fn(async () => ({ result: {}, usage: {} }));
        const judge = createModelValidationJudge(
            {
                modelId: "fixture",
                behavior: { parameters: { systemMessages: "supported" } },
            } as unknown as ResolvedChatModel,
            { configurationId: "test-v2", evaluationVersion: SCOPED_EVALUATION_VERSION },
            invoke as never
        );
        expect(judge.id).toContain(SCOPED_RUBRIC_VERSION);
        await judge.evaluate(
            {
                rubricVersion: SCOPED_RUBRIC_VERSION,
                input: evaluated,
                outputUnits: outputUnits(evaluated),
            },
            new AbortController().signal
        );
        expect(invoke).toHaveBeenCalledTimes(1);
        const args = invoke.mock.calls[0] as unknown as [unknown, unknown, { content: unknown }[]];
        expect(JSON.stringify(args[2])).toContain("relevant_spans_reviewed");
        expect(JSON.stringify(args[2])).toContain(SCOPED_RUBRIC_VERSION);
    });
    it("pins a separate scoped Judge configuration and rejects a V1 Judge for V2 before invoking", async () => {
        const { input, report } = fixture();
        const evaluated = weeklyReviewEvaluation(report, input);
        const invoke = vi.fn();
        const judge = createModelValidationJudge(
            { modelId: "fixture" } as ResolvedChatModel,
            { configurationId: "test-v1" },
            invoke as never
        );
        await expect(
            judge.evaluate(
                {
                    rubricVersion: SCOPED_RUBRIC_VERSION,
                    input: evaluated,
                    outputUnits: outputUnits(evaluated),
                },
                new AbortController().signal
            )
        ).rejects.toThrow("Judge configuration");
        expect(invoke).not.toHaveBeenCalled();
    });
});
