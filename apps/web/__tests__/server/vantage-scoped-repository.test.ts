import {
    fingerprint,
    SCOPED_EVALUATION_VERSION,
    SCOPED_RUBRIC_VERSION,
} from "@launchstack/pipelines/vantage/weekly-review-validation";
jest.mock("@launchstack/store/crypto", () => ({
    encryptSecret: jest.fn((value: string) => ({ ciphertext: "sealed:" + value, keyVersion: 1 })),
    decryptSecret: jest.fn((value: string) => value.slice("sealed:".length)),
}));
import {
    compileScopedEvidence,
    hashScopedText,
} from "@launchstack/pipelines/vantage/scoped-evidence";
import {
    calculateWeeklyReviewBudget,
    reviewFingerprint,
    weeklyReviewEvaluation,
    weeklyReviewAdmissionBytes,
    type WeeklyReviewInput,
    type WeeklyReviewV21,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import { createWeeklyReviewRepository } from "~/server/vantage/weekly-review-repository";
import type { FrozenDependency, WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

function fixture(reservedWeek: string | Date = "2026-11-09", dynamic = false) {
    const text = "Approved revenue evidence. Other details.";
    const asOf = "2026-11-13T12:00:00.000Z";
    const prepared = compileScopedEvidence(
        {
            actorId: "actor",
            companyId: "1",
            documentId: "1",
            version: "10",
            asOf,
            expectedParentHash: hashScopedText(text),
            selectedUnitIds: ["revenue"],
        },
        {
            companyId: "1",
            documentId: "1",
            version: "10",
            versionDate: "2026-11-10T00:00:00.000Z",
            availableAt: "2026-11-10T00:00:00.000Z",
            title: "Revenue",
            purpose: "company-architecture",
            chunks: [{ id: "100", ordinal: 0, text }],
            originalCompleteness: "unknown",
        },
        {
            actorId: "actor",
            companyId: "1",
            documentId: "1",
            version: "10",
            authorized: true,
            purpose: "company-architecture",
            audience: "company",
            companyReadable: true,
            aclRevision: "1",
            authorityRevision: "policy:1",
            finiteScope: {
                qualification: "Revenue evidence only",
                requiredUnits: [
                    {
                        id: "revenue",
                        start: 0,
                        end: 26,
                        excerptHash: hashScopedText(text.slice(0, 26)),
                    },
                ],
            },
        }
    );
    const id = "11111111-1111-4111-8111-111111111111";
    const input: WeeklyReviewInput = {
        candidateId: id,
        week: "2026-11-09",
        asOf,
        role: "admin",
        mandatoryCoverage: { required: 1, included: 1 },
        sources: prepared.modelFacingProjection.sources.map(
            ({ ref, version, hash, text, title, purpose }) => ({
                ref,
                version,
                hash,
                text,
                title,
                purpose,
            })
        ),
        scopedEvidence: [prepared.dependency],
    };
    const ref = input.sources[0]!.ref;
    const ordinary = {
        ref: "doc:2@20",
        version: "20",
        hash: hashScopedText("Private star"),
        text: "Private star",
        title: "Private",
        purpose: "personal-star",
    };
    input.sources.push(ordinary);
    const trace = {
        schemaVersion: "vantage-dynamic-retrieval-trace/v3",
        mode: "combined",
        selectedRefs: input.sources.map(source => source.ref),
        roleStatus: "missing",
        ranking: [{ candidate: { id: "999", title: "Sensitive omitted discovery" } }],
        followUp: { rounds: 0, queryCount: 0, acquired: [] },
    };
    if (dynamic)
        input.retrievalContext = {
            schemaVersion: "vantage-dynamic-retrieval/v3",
            mode: "combined",
            traceHash: reviewFingerprint(trace),
        };
    const report: WeeklyReviewV21 = {
        schemaVersion: "vantage-weekly-review/v2.1",
        headline: "Revenue",
        brief: "Review revenue",
        summary: "Approved revenue evidence.",
        keyFigures: [],
        topics: [
            {
                title: "Revenue review",
                facts: [{ text: "Approved revenue evidence.", refs: [ref] }],
                conflicts: [],
                whyItMatters: "Review evidence",
                whyNow: "Weekly review",
                decisionQuestion: "Review revenue?",
                rationale: "Recorded evidence",
                recommendation: null,
                proposedNextStep: "Discuss",
                unknowns: [],
                proposedOwner: null,
                proposedDue: null,
                helpRequested: null,
            },
        ],
    };
    // The normal runner assigns display topic identities before persistence.
    Object.assign(report.topics[0]!, { id: "topic-0" });
    const dependencies: FrozenDependency[] = [
        {
            kind: "scoped-document",
            id: "1",
            version: "10",
            hash: prepared.dependency.parentHash,
            purpose: "company-architecture",
            scope: { request: prepared.request, dependency: prepared.dependency },
        },
    ];
    dependencies.push({
        kind: "document",
        id: "2",
        version: "20",
        hash: ordinary.hash,
        purpose: "personal-star",
    });
    const projected = weeklyReviewEvaluation(report, input);
    const evidence = {
        ...(dynamic ? { selectionDiagnostics: { dynamicRetrieval: trace, omitted: [] } } : {}),
        schemaVersion: "vantage-admission/v3",
        candidateId: id,
        reportHash: reviewFingerprint(report),
        inputHash: reviewFingerprint(input),
        evaluationHash: reviewFingerprint(weeklyReviewEvaluation(report, input)),
        ...weeklyReviewAdmissionBytes(report, input),
        inputSnapshot: input,
        budget: calculateWeeklyReviewBudget(input, "scoped-v2"),
        scopedEvidence: input.scopedEvidence,
        freezeHash: reviewFingerprint(input.sources),
        sourceRegistry: input.sources.map(({ ref, version, hash, purpose, title }) => ({
            ref,
            version,
            hash,
            purpose,
            title,
        })),
        evaluation: {
            version: SCOPED_EVALUATION_VERSION,
            rubricVersion: SCOPED_RUBRIC_VERSION,
            candidateId: projected.actual.id,
            pipelineVersion: projected.actual.pipelineVersion,
            scenarioId: projected.scenario.id,
            scenarioVersion: projected.scenario.version,
            inputFingerprint: fingerprint(projected),
            scenarioFingerprint: fingerprint(projected.scenario),
            contextCompleteness: projected.scenario.contextCompleteness,
            status: "assessed",
            verdict: "pass",
            error: null,
            integrityIssues: [],
            scopedEvidence: input.scopedEvidence,
        },
    };
    const calls: string[] = [];
    let active: string | null = null;
    let ciphertext: unknown;
    const query: WeeklyReviewQuery = async (sql, parameters = []) => {
        calls.push(sql);
        if (sql.includes("SET status='accepted'")) ciphertext = parameters[1];
        if (sql.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_runs"))
            return [
                {
                    id,
                    status: ciphertext ? "accepted" : "reserved",
                    ciphertext,
                    key_version: 1,
                    schema_version: "vantage-weekly-review/v2.1",
                    review_version: 1,
                    week_start: reservedWeek,
                    dependencies,
                    generation_dispatched: true,
                    judge_dispatched: true,
                },
            ];
        if (sql.startsWith("SELECT run_id")) return active ? [{ run_id: active }] : [];
        return [];
    };
    const authority = jest.fn(async () => undefined);
    const repository = createWeeklyReviewRepository(
        { transaction: work => work(query) },
        authority
    );
    const accept = (value: unknown = evidence) =>
        repository.accept({ companyId: "1", userId: "actor", authorityEpoch: "1" }, id, {
            report,
            evidence: value,
            expectedActiveId: null,
        });
    return {
        input,
        evidence,
        dependencies,
        calls,
        authority,
        accept,
        id,
        report,
        read: () => repository.get({ companyId: "1", userId: "actor" }, id),
        setActive: (value: string) => {
            active = value;
        },
    };
}

describe("scoped v3 activation recomputation (offline)", () => {
    it("binds dynamic trace and omits private discovery identities from report readback", async () => {
        const f = fixture("2026-11-09", true);
        await expect(f.accept()).resolves.toBe(f.id);
        const saved = await f.read();
        expect(JSON.stringify(saved.evidence)).not.toContain("Sensitive omitted discovery");
        expect(JSON.stringify(saved.evidence)).not.toContain('"999"');
        expect(saved.evidence).toMatchObject({
            selectionDiagnostics: {
                dynamicRetrieval: { mode: "combined", rankingCandidateCount: 1 },
            },
        });
    });
    it.each([false, true])(
        "reads legacy and explicit follow-up counts without exposing unfrozen identities (new=%s)",
        async explicit => {
            const f = fixture("2026-11-09", true);
            const evidence = structuredClone(f.evidence);
            const diagnostics = evidence.selectionDiagnostics;
            if (!diagnostics) throw new Error("Expected dynamic selection diagnostics");
            const trace = diagnostics.dynamicRetrieval as Record<string, unknown>;
            trace.followUp = {
                rounds: 1,
                queryCount: 1,
                acquired: [{ id: "999", version: "9990" }],
                ...(explicit
                    ? {
                          acquiredCount: 2,
                          newlyAcquiredCount: 2,
                          cachedMatchCount: 3,
                          admittedCount: 1,
                          admittedFromCacheCount: 1,
                      }
                    : {}),
            };
            trace.decision = {
                outcome: "INSUFFICIENT_EVIDENCE",
                gaps: [{ question: "Who approves release?", supportingRefs: ["doc:999@9990"] }],
                unresolved: [
                    { question: "Who approves release?", supportingRefs: ["doc:999@9990"] },
                ],
            };
            Object.assign(diagnostics, {
                omitted: [
                    { id: "999", version: "9990", reason: "budget_exceeded" },
                    { id: "999", version: "9990", reason: "budget_exceeded" },
                ],
            });
            evidence.inputSnapshot.retrievalContext!.traceHash = reviewFingerprint(trace);
            evidence.inputHash = reviewFingerprint(evidence.inputSnapshot);
            // Recompute the ordinary admission identities changed by traceHash.
            evidence.evaluationHash = reviewFingerprint(
                weeklyReviewEvaluation(f.report, evidence.inputSnapshot)
            );
            const evaluation = weeklyReviewEvaluation(f.report, evidence.inputSnapshot);
            evidence.evaluation.inputFingerprint = fingerprint(evaluation);
            evidence.evaluation.scenarioFingerprint = fingerprint(evaluation.scenario);
            Object.assign(evidence, weeklyReviewAdmissionBytes(f.report, evidence.inputSnapshot));
            evidence.budget = calculateWeeklyReviewBudget(evidence.inputSnapshot, "scoped-v2");
            await expect(f.accept(evidence)).resolves.toBe(f.id);
            const saved = await f.read();
            expect(JSON.stringify(saved.evidence)).not.toContain("doc:999@9990");
            expect(JSON.stringify(saved.evidence)).not.toContain('"999"');
            expect(saved.evidence).toMatchObject({
                selectionDiagnostics: {
                    omittedCount: 1,
                    omissionReasonCounts: { budget_exceeded: 1 },
                    dynamicRetrieval: {
                        followUp: explicit
                            ? {
                                  acquiredCount: 2,
                                  newlyAcquiredCount: 2,
                                  cachedMatchCount: 3,
                                  admittedCount: 1,
                                  admittedFromCacheCount: 1,
                              }
                            : { acquiredCount: 1 },
                    },
                },
            });
            if (!explicit)
                expect(
                    (
                        saved.evidence as {
                            selectionDiagnostics: { dynamicRetrieval: { followUp: object } };
                        }
                    ).selectionDiagnostics.dynamicRetrieval.followUp
                ).not.toHaveProperty("newlyAcquiredCount");
        }
    );
    it.each(["traceHash", "mode", "selectedRefs"])(
        "rejects dynamic %s substitution before activation",
        async field => {
            const f = fixture("2026-11-09", true);
            const evidence = structuredClone(f.evidence);
            if (field === "traceHash")
                evidence.inputSnapshot.retrievalContext!.traceHash = "0".repeat(64);
            if (field === "mode") evidence.selectionDiagnostics!.dynamicRetrieval.mode = "role";
            if (field === "selectedRefs")
                evidence.selectionDiagnostics!.dynamicRetrieval.selectedRefs = [];
            evidence.inputHash = reviewFingerprint(evidence.inputSnapshot);
            await expect(f.accept(evidence)).rejects.toThrow("candidate_admission_invalid");
            expect(f.calls.some(sql => sql.includes("SET status='accepted'"))).toBe(false);
        }
    );
    it("accepts matching exact budget, evaluation, source registry and frozen scope", async () => {
        const f = fixture();
        await expect(f.accept()).resolves.toBe(f.id);
        expect(f.authority).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ userId: "actor" }),
            f.dependencies,
            "activation"
        );
        expect(f.calls.some(sql => sql.includes("SET status='accepted'"))).toBe(true);
    });
    it.each([
        "budget",
        "evaluationHash",
        "scope",
        "registry",
        "coverage",
        "freezeHash",
        "downgrade",
        "judgeInputBytes",
        "outsideScopedText",
        "assessmentCandidate",
        "assessmentFingerprint",
    ])("rejects tampered %s before activation", async kind => {
        const f = fixture();
        const evidence = structuredClone(f.evidence);
        if (kind === "outsideScopedText") {
            evidence.inputSnapshot.sources[1]!.text = "Altered whole-document text";
            evidence.inputHash = reviewFingerprint(evidence.inputSnapshot);
            evidence.freezeHash = reviewFingerprint(evidence.inputSnapshot.sources);
            evidence.budget = calculateWeeklyReviewBudget(evidence.inputSnapshot, "scoped-v2");
        }
        if (kind === "assessmentCandidate") evidence.evaluation.candidateId = "another-candidate";
        if (kind === "assessmentFingerprint") evidence.evaluation.inputFingerprint = "0".repeat(64);
        if (kind === "budget") evidence.budget.reportReserveBytes++;
        if (kind === "evaluationHash") evidence.evaluationHash = "0".repeat(64);
        if (kind === "scope") evidence.scopedEvidence = [];
        if (kind === "registry") evidence.sourceRegistry = [];
        if (kind === "coverage") evidence.evaluation.scopedEvidence = [];
        if (kind === "freezeHash") evidence.freezeHash = "0".repeat(64);
        if (kind === "judgeInputBytes") evidence.judgeInputBytes++;
        if (kind === "downgrade") evidence.schemaVersion = "vantage-admission/v2";
        await expect(f.accept(evidence)).rejects.toThrow("candidate_admission_invalid");
        expect(f.calls.some(sql => sql.includes("SET status='accepted'"))).toBe(false);
    });
    it("rejects a different week even when every packet and assessed fingerprint is recomputed", async () => {
        const f = fixture();
        const evidence = structuredClone(f.evidence);
        evidence.inputSnapshot.week = "2026-01-05";
        const evaluation = weeklyReviewEvaluation(f.report, evidence.inputSnapshot);
        evidence.inputHash = reviewFingerprint(evidence.inputSnapshot);
        evidence.evaluationHash = reviewFingerprint(evaluation);
        evidence.budget = calculateWeeklyReviewBudget(evidence.inputSnapshot, "scoped-v2");
        Object.assign(evidence, weeklyReviewAdmissionBytes(f.report, evidence.inputSnapshot));
        Object.assign(evidence.evaluation, {
            scenarioId: evaluation.scenario.id,
            scenarioVersion: evaluation.scenario.version,
            scenarioFingerprint: fingerprint(evaluation.scenario),
            inputFingerprint: fingerprint(evaluation),
            candidateId: evaluation.actual.id,
            pipelineVersion: evaluation.actual.pipelineVersion,
            contextCompleteness: evaluation.scenario.contextCompleteness,
        });
        await expect(f.accept(evidence)).rejects.toThrow("candidate_admission_invalid");
        expect(f.calls.some(sql => sql.includes("SET status='accepted'"))).toBe(false);
    });
    it("normalizes a reserved PostgreSQL date before matching the review week", async () => {
        const f = fixture(new Date("2026-11-09T00:00:00.000Z"));
        await expect(f.accept()).resolves.toBe(f.id);
    });
    it("accepts semantically equal JSONB-normalized frozen descriptors", async () => {
        const f = fixture();
        const reorder = (value: unknown): unknown =>
            Array.isArray(value)
                ? value.map(reorder)
                : value && typeof value === "object"
                  ? Object.fromEntries(
                        Object.entries(value)
                            .reverse()
                            .map(([key, item]) => [key, reorder(item)])
                    )
                  : value;
        f.dependencies[0]!.scope = reorder(
            f.dependencies[0]!.scope
        ) as (typeof f.dependencies)[0]["scope"];
        await expect(f.accept()).resolves.toBe(f.id);
    });
    it("rejects altered frozen anchors despite matching parent hashes", async () => {
        const f = fixture();
        f.dependencies[0]!.scope = structuredClone(f.dependencies[0]!.scope);
        f.dependencies[0]!.scope!.dependency.units[0]!.anchors[0]!.start++;
        await expect(f.accept()).rejects.toThrow("candidate_admission_invalid");
    });
    it("keeps active-review compare-and-swap authoritative", async () => {
        const f = fixture();
        f.setActive("another-review");
        await expect(f.accept()).rejects.toThrow("active_review_changed");
        expect(f.calls.some(sql => sql.includes("SET status='accepted'"))).toBe(false);
    });
});
