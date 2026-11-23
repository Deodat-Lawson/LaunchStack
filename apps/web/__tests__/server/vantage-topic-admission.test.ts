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

import {
    topicManifestHash,
    topicInputHash,
    type TopicManifest,
} from "~/server/vantage/weekly-review-topic-types";

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
    const manifest: TopicManifest = {
        week: input.week,
        cutoff: input.asOf,
        asOf: input.asOf,
        epoch: "1",
        expectedActiveId: null,
        configuration: { provider: "seeds", scoped: true },
        revisions: { policy: 1, preference: 1, role: null },
        topics: [],
        fixed: input.sources.map(source => ({
            ...source,
            id: source.ref.startsWith("unit:") ? "1" : "2",
            audience: "company" as const,
            purpose: source.purpose as FrozenDependency["purpose"],
        })),
        fixedDependencies: dependencies,
        offered: [],
        lane: [],
        carryover: "unavailable",
    };
    for (const source of input.sources) Object.assign(source, { audience: "company" });
    const contextFields = {
        schemaVersion: "vantage-topic-retrieval/v1" as const,
        mode: "topic-first" as const,
        guidanceLabel: "owner notes, not evidence" as const,
        topics: [
            {
                id: "private-topic",
                title: "Private owner guidance",
                openQuestions: ["Private question"],
            },
        ],
        seedReasons: [],
        lane: { outcome: "none_eligible" as const, candidates: 0, admitted: 0 },
    };
    input.retrievalContext = {
        ...contextFields,
        traceHash: fingerprint([
            topicManifestHash(manifest),
            { ...input, retrievalContext: contextFields },
        ]),
    };
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
        budget: calculateWeeklyReviewBudget(input, "topic-first"),
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
                    retrieval_mode: "topic_first",
                    authority_epoch: "1",
                    input_hash: topicInputHash(manifest),
                    snapshot_hash: fingerprint(input),
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
        if (sql.startsWith("SELECT * FROM pdr_ai_v2_vantage_weekly_review_run_manifests"))
            return [
                {
                    manifest,
                    manifest_hash: topicManifestHash(manifest),
                    trace: { secret: "private exploration trace" },
                    snapshot_commitment: {
                        snapshotHash: fingerprint(input),
                        dependencyHash: fingerprint(dependencies),
                    },
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

it("accepts a correctly bound topic snapshot and allowlists its read DTO", async () => {
    const f = fixture();
    const evidence = {
        ...f.evidence,
        trace: { secret: "private exploration trace" },
        manifest: { secret: "private manifest" },
    };
    await expect(f.accept(evidence)).resolves.toBe(f.id);
    const saved = await f.read();
    const serialized = JSON.stringify(saved);
    expect(serialized).not.toContain("private exploration trace");
    expect(serialized).not.toContain("private manifest");
    expect(serialized).not.toContain("Private owner guidance");
    expect(serialized).not.toContain("Private question");
    expect(saved.evidence).not.toHaveProperty("trace");
    expect(saved.evidence).not.toHaveProperty("manifest");
    expect(saved.evidence).not.toHaveProperty("inputSnapshot.retrievalContext");
});
it("the run mode forces topic binding even if evidence claims legacy admission", async () => {
    const f = fixture();
    await expect(
        f.accept({ ...f.evidence, schemaVersion: "vantage-admission/v1" })
    ).rejects.toThrow("candidate_admission_invalid");
});
it("rejects context tampering while source arrays stay identical", async () => {
    const f = fixture();
    const evidence = structuredClone(f.evidence);
    if (evidence.inputSnapshot.retrievalContext?.schemaVersion !== "vantage-topic-retrieval/v1")
        throw new Error("topic fixture missing");
    evidence.inputSnapshot.retrievalContext.topics[0]!.openQuestions = ["Tampered owner question"];
    expect(evidence.inputSnapshot.sources).toEqual(f.input.sources);
    await expect(f.accept(evidence)).rejects.toThrow("candidate_admission_invalid");
});
it("rejects scoped proof tampering while source arrays stay identical", async () => {
    const f = fixture();
    const evidence = structuredClone(f.evidence);
    evidence.inputSnapshot.scopedEvidence![0]!.coverage.qualification = "Tampered coverage";
    expect(evidence.inputSnapshot.sources).toEqual(f.input.sources);
    await expect(f.accept(evidence)).rejects.toThrow("candidate_admission_invalid");
});
