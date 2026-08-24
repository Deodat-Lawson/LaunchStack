import {
    evaluateFounderWeeklyReview,
    buildFounderWeeklyReviewEvaluationPrompt,
} from "@launchstack/features/founder-weekly-review";
import type {
    FounderWeeklyReviewEvidenceSnapshot,
    FounderWeeklyReviewV2Payload,
} from "@launchstack/features/founder-weekly-review";

const snapshot = (
    items: FounderWeeklyReviewEvidenceSnapshot["items"]
): FounderWeeklyReviewEvidenceSnapshot => ({
    schemaVersion: "founder-weekly-review-evidence/v2",
    capturedAt: "2026-01-01T00:00:00.000Z",
    reportingPeriod: { start: "2026-01-01", end: "2026-01-07" },
    workspaceTimezone: "UTC",
    items,
    sourceWarnings: [],
    documentChangeAudit: { schemaVersion: "document-change-audit/v1", rawChanges: [], groups: [] },
});
const payload = (
    whatCustomersSaid: FounderWeeklyReviewV2Payload["sections"]["whatCustomersSaid"],
    whatChanged: FounderWeeklyReviewV2Payload["sections"]["whatChanged"]
): FounderWeeklyReviewV2Payload => ({
    schemaVersion: "founder-weekly-review/v2",
    sections: {
        whatChanged,
        whatShipped: {
            state: "no_evidence",
            noEvidence: { code: "none", message: "None", cta: "None" },
        },
        whatCustomersSaid,
        currentBlockers: {
            state: "no_evidence",
            noEvidence: { code: "none", message: "None", cta: "None" },
        },
        nextPriorities: {
            state: "no_evidence",
            noEvidence: { code: "none", message: "None", cta: "None" },
        },
    },
});
const change = {
    sourceType: "document_change" as const,
    sourceId: "change-1",
    title: "Launch",
    excerpt: "The launch shipped.",
    metadata: {},
};
const workspace = {
    sourceType: "workspace_document" as const,
    sourceId: "workspace-1",
    title: "Current",
    excerpt: "Current blocker context.",
    metadata: {},
};
const feedback = {
    sourceType: "customer_feedback" as const,
    sourceId: "feedback-1",
    title: "Interview",
    excerpt: "Customers requested reliable recovery.",
    metadata: {},
};

describe("Founder Weekly Review evaluation", () => {
    it("enforces customer-only attribution and temporal workspace semantics", () => {
        const evidence = snapshot([change, workspace, feedback]);
        const invalid = payload(
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "Customers requested reliable recovery.",
                        sourceIds: ["workspace-1"],
                        confidence: 0.8,
                    },
                ],
            },
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "A current document changed this week.",
                        sourceIds: ["workspace-1"],
                        confidence: 0.8,
                    },
                ],
            }
        );
        const result = evaluateFounderWeeklyReview(evidence, invalid);
        expect(result.hasHardFailure).toBe(true);
        expect(result.failures.map(failure => failure.category)).toEqual(
            expect.arrayContaining(["invalid_source_type"])
        );
    });

    it("allows workspace context alongside temporal evidence", () => {
        const evidence = snapshot([change, workspace, feedback]);
        const valid = payload(
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "Customers requested reliable recovery.",
                        sourceIds: ["feedback-1"],
                        confidence: 0.8,
                    },
                ],
            },
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "The launch shipped with current blocker context.",
                        sourceIds: ["change-1", "workspace-1"],
                        confidence: 0.8,
                    },
                ],
            }
        );
        expect(evaluateFounderWeeklyReview(evidence, valid).hasHardFailure).toBe(false);
    });

    it("allows workspace context to complement document-change shipping proof", () => {
        const evidence = snapshot([change, workspace]);
        const review = payload(
            {
                state: "no_evidence",
                noEvidence: { code: "none", message: "None", cta: "None" },
            },
            {
                state: "no_evidence",
                noEvidence: { code: "none", message: "None", cta: "None" },
            }
        );
        review.sections.whatShipped = {
            state: "evidence",
            items: [
                {
                    kind: "observed_fact",
                    text: "The launch shipped and remains reflected in current context.",
                    sourceIds: ["change-1", "workspace-1"],
                    confidence: 0.8,
                },
            ],
        };
        const result = evaluateFounderWeeklyReview(evidence, review);
        expect(result.failures).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ category: "unsupported_shipped_claim" }),
            ])
        );
        expect(result.hasHardFailure).toBe(false);
    });

    it("flags a future release as not shipped in the reporting period", () => {
        const evidence = snapshot([
            {
                ...change,
                excerpt:
                    "Status changed. Before: planned for the April release. After: launched in the April release.",
                sourceTimestamp: "2026-02-20T10:00:00.000Z",
            },
            workspace,
        ]);
        const review = payload(
            { state: "no_evidence", noEvidence: { code: "none", message: "None", cta: "None" } },
            { state: "no_evidence", noEvidence: { code: "none", message: "None", cta: "None" } }
        );
        review.sections.whatShipped = {
            state: "evidence",
            items: [
                {
                    kind: "observed_fact",
                    text: "Recovery workflow launched in the April release.",
                    sourceIds: ["change-1", "workspace-1"],
                    confidence: 0.8,
                },
            ],
        };
        const result = evaluateFounderWeeklyReview(evidence, review);
        expect(result.failures).toEqual(
            expect.arrayContaining([expect.objectContaining({ category: "future_release_claim" })])
        );
        expect(result.hasHardFailure).toBe(true);
    });

    it("rejects workspace-only temporal claims but permits workspace context with temporal evidence", () => {
        const evidence = snapshot([
            { ...change, excerpt: "The workflow shipped during the reporting period." },
            workspace,
        ]);
        const invalid = payload(
            { state: "no_evidence", noEvidence: { code: "none", message: "None", cta: "None" } },
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "The current document changed this week.",
                        sourceIds: ["workspace-1"],
                        confidence: 0.8,
                    },
                ],
            }
        );
        expect(evaluateFounderWeeklyReview(evidence, invalid).failures).toEqual(
            expect.arrayContaining([expect.objectContaining({ category: "invalid_source_type" })])
        );
        const valid = payload(
            { state: "no_evidence", noEvidence: { code: "none", message: "None", cta: "None" } },
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "The workflow shipped this period and remains current.",
                        sourceIds: ["change-1", "workspace-1"],
                        confidence: 0.8,
                    },
                ],
            }
        );
        expect(evaluateFounderWeeklyReview(evidence, valid).failures).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ category: "invalid_source_type" })])
        );
    });

    it("measures theme coverage rather than requiring one bullet per source", () => {
        const evidence = snapshot([
            { ...change, sourceId: "change-1" },
            {
                ...change,
                sourceId: "change-2",
                title: "Scope",
                excerpt: "Rollout expanded globally.",
            },
            feedback,
        ]);
        const review = payload(
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "Customers requested reliable recovery.",
                        sourceIds: ["feedback-1"],
                        confidence: 0.8,
                    },
                ],
            },
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "The launch shipped and rollout expanded globally.",
                        sourceIds: ["change-1", "change-2"],
                        confidence: 0.8,
                    },
                ],
            }
        );
        const result = evaluateFounderWeeklyReview(evidence, review);
        expect(result.deterministic.evidenceCoverage).toBe(1);
        expect(result.deterministic.duplicateClaimRate).toBe(0);
    });

    it("allows section-specific reuse of the same evidence", () => {
        const evidence = snapshot([change]);
        const review = payload(
            { state: "no_evidence", noEvidence: { code: "none", message: "None", cta: "None" } },
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "The launch shipped.",
                        sourceIds: ["change-1"],
                        confidence: 0.8,
                    },
                ],
            }
        );
        review.sections.currentBlockers = {
            state: "evidence",
            items: [
                {
                    kind: "observed_fact",
                    text: "The shipped launch still has a current blocker.",
                    sourceIds: ["change-1"],
                    confidence: 0.7,
                },
            ],
        };
        expect(evaluateFounderWeeklyReview(evidence, review).deterministic.duplicateClaimRate).toBe(
            0
        );
    });

    it("accepts an evidence-grounded action without requiring invented owner or deadline", () => {
        const evidence = snapshot([change]);
        const review = payload(
            { state: "no_evidence", noEvidence: { code: "none", message: "None", cta: "None" } },
            { state: "no_evidence", noEvidence: { code: "none", message: "None", cta: "None" } }
        );
        review.sections.nextPriorities = {
            state: "evidence",
            items: [
                {
                    kind: "recommendation",
                    label: "Recommendation",
                    text: "Confirm the launch readiness gap.",
                    rationale: "The release evidence indicates the gap remains relevant.",
                    sourceIds: ["change-1"],
                    confidence: 0.7,
                },
            ],
        };
        const result = evaluateFounderWeeklyReview(evidence, review);
        expect(
            result.failures.filter(failure => failure.category === "unsupported_claim")
        ).toHaveLength(0);
    });

    it("keeps lexical support as a soft diagnostic rather than a hard gate", () => {
        const evidence = snapshot([change]);
        const review = payload(
            { state: "no_evidence", noEvidence: { code: "none", message: "None", cta: "None" } },
            {
                state: "evidence",
                items: [
                    {
                        kind: "observed_fact",
                        text: "A release occurred.",
                        sourceIds: ["change-1"],
                        confidence: 0.8,
                    },
                ],
            }
        );
        const result = evaluateFounderWeeklyReview(evidence, review);
        expect(result.hasHardFailure).toBe(false);
        expect(result.deterministic.unsupportedClaimRate).toBeGreaterThanOrEqual(0);
    });

    it("builds a rubric-aware semantic grading prompt", () => {
        const prompt = buildFounderWeeklyReviewEvaluationPrompt(
            snapshot([change]),
            payload(
                {
                    state: "no_evidence",
                    noEvidence: { code: "none", message: "None", cta: "None" },
                },
                { state: "no_evidence", noEvidence: { code: "none", message: "None", cta: "None" } }
            )
        );
        expect(prompt).toContain("document_change is reporting-period temporal evidence");
        expect(prompt).toContain("concise founder-level synthesis");
        expect(prompt).toContain("future-dated release is not shipped");
        expect(prompt).toContain("supports, indicates, and suggests");
        expect(prompt).toContain("invented owners");
    });
});
