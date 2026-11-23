import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
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
import { evaluateVantage } from "./validation/evaluate";
import {
    RATED_CRITERIA,
    LEGACY_SCOPED_EVALUATION_VERSION,
    LEGACY_SCOPED_RUBRIC_VERSION,
    SCOPED_EVALUATION_VERSION,
    SCOPED_RUBRIC_VERSION,
    type EvaluationInput,
    type Judgment,
    type RubricVersion,
    type ValidationJudge,
} from "./validation/contracts";
import { createModelValidationJudge } from "./validation/judge";
import {
    LEGACY_SCOPED_VALIDATION_SYSTEM_PROMPT,
    SCOPED_VALIDATION_SYSTEM_PROMPT,
} from "./validation/rubric";

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
function fixtureJudge(
    verdict: "met" | "missed" = "met",
    partial = false,
    rubricVersion: RubricVersion = SCOPED_RUBRIC_VERSION
): ValidationJudge {
    return {
        kind: "fixture-replay",
        id: "synthetic-scoped-purpose-v3",
        evaluate: async request => {
            expect(request.rubricVersion).toBe(rubricVersion);
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
function personalStar(input: WeeklyReviewInput) {
    const text = "Personal preference: explore dashboard colors when useful.";
    const parent: ScopedParent = {
        companyId: "company",
        documentId: "personal",
        version: "1",
        versionDate: "2026-11-01T00:00:00Z",
        availableAt: "2026-11-02T00:00:00Z",
        title: "Personal preference",
        purpose: "personal-star",
        originalCompleteness: "unknown",
        chunks: [{ id: "personal-chunk", ordinal: 0, text }],
    };
    return compileScopedEvidence(
        {
            actorId: "actor",
            companyId: "company",
            documentId: "personal",
            version: "1",
            asOf: input.asOf,
            expectedParentHash: hashScopedText(text),
            selectedUnitIds: ["preference"],
        },
        parent,
        {
            actorId: "actor",
            companyId: "company",
            documentId: "personal",
            version: "1",
            authorized: true,
            purpose: "personal-star",
            audience: "actor",
            companyReadable: false,
            aclRevision: "acl-personal",
            authorityRevision: "personal-selection-1",
            finiteScope: {
                qualification: "Personally selected preference, relevant when useful.",
                requiredUnits: [
                    {
                        id: "preference",
                        start: 0,
                        end: text.length,
                        excerptHash: hashScopedText(text),
                    },
                ],
            },
        }
    );
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

describe("weekly review finite evidence and purpose-aware admission", () => {
    it("keeps whole and scoped personal Stars outside mandatory semantic admission", async () => {
        const { input, report } = fixture();
        const personal = personalStar(input);
        const source = personal.modelFacingProjection.sources[0]!;
        const wholeStar = structuredClone(input);
        wholeStar.sources.push({ ...source, ref: "doc:personal@1" });
        const scopedStar = structuredClone(input);
        scopedStar.scopedEvidence!.push(personal.dependency);
        scopedStar.sources.push(source);
        const judge = fixtureJudge();
        const assess = judge.evaluate;
        judge.evaluate = async (request, signal) => {
            const answer = await assess(request, signal);
            const judgment = answer.judgment as Judgment;
            for (const expected of request.input.scenario.expectations) {
                if (expected.evidence.some(evidence => evidence.sourceId === source.ref))
                    judgment.expectations.find(
                        item => item.expectationId === expected.id
                    )!.verdict = "missed";
            }
            return answer;
        };
        for (const candidate of [wholeStar, scopedStar]) {
            const evaluated = weeklyReviewEvaluation(report, candidate);
            expect(evaluated.scenario.expectations).toHaveLength(1);
            const assessment = await evaluateVantage(evaluated, { judge });
            expect(assessment).toMatchObject({ status: "assessed", verdict: "pass", error: null });
        }
        const invoke = vi.fn(async () => ({ result: report, usage: {} }));
        const result = await runWeeklyReviewV21(scopedStar, {
            ...ports(report, judge),
            invoke: invoke as never,
        });
        const args = invoke.mock.calls[0] as unknown as [unknown, unknown, { content: string }[]];
        const generationPrompt = args[2][0]!.content;
        expect(generationPrompt).toContain("Company-required scopes are administrator-approved.");
        expect(generationPrompt).toContain(
            "Personal-star scopes are selected by the actor as personal preferences."
        );
        expect(generationPrompt).not.toContain("only administrator-authorized exact spans");
        expect(result.evidence.evaluation.verdict).toBe("pass");
        expect(result.evidence.scopedEvidence).toHaveLength(2);
        await expect(
            runWeeklyReviewV21(scopedStar, ports(report, fixtureJudge("missed")))
        ).rejects.toThrow("judge_admission_failed");
    });
    it.each(["missing-unit", "corrupt-unit"])(
        "still rejects a personal Star %s before dispatch",
        async mode => {
            const { input, report } = fixture();
            const personal = personalStar(input);
            input.scopedEvidence!.push(personal.dependency);
            input.sources.push({ ...personal.modelFacingProjection.sources[0]! });
            if (mode === "missing-unit") input.sources.pop();
            else input.sources.at(-1)!.text += "corrupted";
            const p = ports(report);
            await expect(runWeeklyReviewV21(input, p)).rejects.toThrow("scoped_source_mismatch");
            expect(p.authorizeDispatch).not.toHaveBeenCalled();
        }
    );
    it("rejects a critical inclusion gate based solely on personal Star evidence", () => {
        const { input, report } = fixture();
        const personal = personalStar(input);
        input.scopedEvidence!.push(personal.dependency);
        const source = personal.modelFacingProjection.sources[0]!;
        input.sources.push(source);
        const evaluated = weeklyReviewEvaluation(report, input);
        evaluated.scenario.expectations.push({
            id: "personal-critical",
            description: "Include the personal preference.",
            kind: "must_include",
            importance: "critical",
            evidence: [{ sourceId: source.ref, quote: source.text }],
        });
        expect(() => parseEvaluationInput(evaluated)).toThrow("company-required source");
    });
    it("retains explicit V2 parsing and its original personal-unit critical gate", async () => {
        const { input, report } = fixture();
        const personal = personalStar(input);
        input.scopedEvidence!.push(personal.dependency);
        const source = personal.modelFacingProjection.sources[0]!;
        input.sources.push(source);
        const current = weeklyReviewEvaluation(report, input);
        if (current.version !== SCOPED_EVALUATION_VERSION) throw Error("scoped fixture required");
        const legacy: EvaluationInput = {
            ...current,
            version: LEGACY_SCOPED_EVALUATION_VERSION,
            scenario: {
                ...current.scenario,
                version: "production-v21/scoped-2",
                expectations: [
                    ...current.scenario.expectations,
                    {
                        id: "personal-critical",
                        description: "Original V2 personal-unit coverage expectation.",
                        kind: "must_include",
                        importance: "critical",
                        evidence: [{ sourceId: source.ref, quote: source.text }],
                    },
                ],
            },
        };
        expect(parseEvaluationInput(legacy)).toEqual(legacy);
        const incomplete = structuredClone(legacy);
        incomplete.scenario.expectations.pop();
        expect(() => parseEvaluationInput(incomplete)).toThrow("Every required scoped unit");
        const base = fixtureJudge("met", false, LEGACY_SCOPED_RUBRIC_VERSION);
        const assessment = await evaluateVantage(legacy, {
            judge: {
                ...base,
                id: "synthetic-legacy-scoped-v2",
                evaluate: async (request, signal) => {
                    expect(request.rubricVersion).toBe(LEGACY_SCOPED_RUBRIC_VERSION);
                    const answer = await base.evaluate(request, signal);
                    const judgment = answer.judgment as Judgment;
                    judgment.expectations.find(
                        item => item.expectationId === "personal-critical"
                    )!.verdict = "missed";
                    return answer;
                },
            },
        });
        expect(assessment).toMatchObject({
            version: LEGACY_SCOPED_EVALUATION_VERSION,
            rubricVersion: LEGACY_SCOPED_RUBRIC_VERSION,
            scenarioVersion: "production-v21/scoped-2",
            status: "assessed",
            verdict: "fail",
            error: null,
        });
    });
    it("retains the exact legacy V2 prompt while versioning the purpose-aware rubric", () => {
        expect(
            createHash("sha256").update(LEGACY_SCOPED_VALIDATION_SYSTEM_PROMPT).digest("hex")
        ).toBe("554c2f536e7574a2b1f52dd7c407785532e6aa3b43ed952c5d46525700bc49f1");
        expect(SCOPED_VALIDATION_SYSTEM_PROMPT).toContain(SCOPED_EVALUATION_VERSION);
        expect(SCOPED_VALIDATION_SYSTEM_PROMPT).toContain(
            "Personal-star units record the actor's selected preferences"
        );
        expect(SCOPED_VALIDATION_SYSTEM_PROMPT).not.toContain("administrator");
    });
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
            scenarioVersion: "production-v21/scoped-3",
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
        const evaluated = weeklyReviewEvaluation(report, input);
        evaluated.scenario.expectations.pop();
        expect(() => parseEvaluationInput(evaluated)).toThrow("Every company-required source");
    });
    it("requires a critical semantic expectation for every company-required unit", () => {
        const { input, report } = fixture();
        const evaluated = weeklyReviewEvaluation(report, input);
        evaluated.scenario.expectations[0]!.importance = "normal";
        expect(() => parseEvaluationInput(evaluated)).toThrow("Every company-required source");
    });
    it("preserves all canonical presented fields in the current scoped projection", () => {
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
    it.each([
        {
            version: LEGACY_SCOPED_EVALUATION_VERSION,
            rubric: LEGACY_SCOPED_RUBRIC_VERSION,
            otherVersion: SCOPED_EVALUATION_VERSION,
            otherRubric: SCOPED_RUBRIC_VERSION,
            prompt: LEGACY_SCOPED_VALIDATION_SYSTEM_PROMPT,
        },
        {
            version: SCOPED_EVALUATION_VERSION,
            rubric: SCOPED_RUBRIC_VERSION,
            otherVersion: LEGACY_SCOPED_EVALUATION_VERSION,
            otherRubric: LEGACY_SCOPED_RUBRIC_VERSION,
            prompt: SCOPED_VALIDATION_SYSTEM_PROMPT,
        },
    ] as const)("pins the $version adapter and rejects the other scoped version", async config => {
        const { input, report } = fixture();
        const current = weeklyReviewEvaluation(report, input);
        const evaluated = parseEvaluationInput({ ...current, version: config.version });
        const invoke = vi.fn(async () => ({ result: {}, usage: {} }));
        const judge = createModelValidationJudge(
            {
                modelId: "fixture",
                behavior: { parameters: { systemMessages: "supported" } },
            } as unknown as ResolvedChatModel,
            { configurationId: "version-pinned", evaluationVersion: config.version },
            invoke as never
        );
        expect(judge.id).toContain(config.rubric);
        await judge.evaluate(
            { rubricVersion: config.rubric, input: evaluated, outputUnits: outputUnits(evaluated) },
            new AbortController().signal
        );
        expect(invoke).toHaveBeenCalledTimes(1);
        const args = invoke.mock.calls[0] as unknown as [unknown, unknown, { content: unknown }[]];
        expect(args[2][0]!.content).toEqual(expect.stringContaining(config.prompt));
        const other = parseEvaluationInput({ ...current, version: config.otherVersion });
        await expect(
            judge.evaluate(
                {
                    rubricVersion: config.otherRubric,
                    input: other,
                    outputUnits: outputUnits(other),
                },
                new AbortController().signal
            )
        ).rejects.toThrow("Judge configuration");
        expect(invoke).toHaveBeenCalledTimes(1);
    });
    it("rejects a V1 Judge for current scoped evaluation before invoking", async () => {
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
