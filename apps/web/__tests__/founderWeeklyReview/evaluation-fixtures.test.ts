import {
    FounderWeeklyReviewEvidenceSnapshotSchema,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewV2Payload,
    generateFounderWeeklyReview,
} from "@launchstack/features/founder-weekly-review";

const period = { start: "2026-07-06", end: "2026-07-12" };
function fixture(items: FounderWeeklyReviewEvidenceSnapshot["items"]): FounderWeeklyReviewEvidenceSnapshot {
    return FounderWeeklyReviewEvidenceSnapshotSchema.parse({
        schemaVersion: "founder-weekly-review-evidence/v1", capturedAt: "2026-07-13T00:00:00.000Z",
        reportingPeriod: period, workspaceTimezone: "UTC", items, sourceWarnings: [],
    });
}
export const completeWorkspaceFixture = fixture([
    { sourceType: "document_change", sourceId: "doc:release", title: "Release notes", sourceTimestamp: "2026-07-10T00:00:00.000Z", excerpt: "Export shipped.", metadata: {} },
    { sourceType: "customer_feedback", sourceId: "feedback:1", title: "Customer call", excerpt: "Audit logs requested.", metadata: {} },
    { sourceType: "founder_context", sourceId: "context:1", title: "Founder context", excerpt: "SSO remains blocked.", metadata: {} },
]);
export const partialWorkspaceFixture = fixture([
    { sourceType: "document_change", sourceId: "doc:release", title: "Release notes", sourceTimestamp: "2026-07-10T00:00:00.000Z", excerpt: "Export shipped.", metadata: {} },
    { sourceType: "founder_context", sourceId: "context:1", title: "Founder context", excerpt: "A founder heard customers ask about audit logs.", metadata: {} },
]);
export const emptyWorkspaceFixture = fixture([]);

function payload(customerEvidence: boolean): FounderWeeklyReviewV2Payload {
    const noEvidence = { state: "no_evidence" as const, noEvidence: { code: "none", message: "No evidence", cta: "Add evidence" } };
    return { schemaVersion: "founder-weekly-review/v2", sections: {
        whatChanged: { state: "evidence", items: [{ kind: "observed_fact", text: "Exports shipped.", sourceIds: ["doc:release"], confidence: 0.9 }] },
        whatShipped: noEvidence,
        whatCustomersSaid: customerEvidence ? { state: "evidence", items: [{ kind: "observed_fact", text: "Audit logs were requested.", sourceIds: ["feedback:1"], confidence: 0.8 }] } : noEvidence,
        currentBlockers: noEvidence,
        nextPriorities: noEvidence,
    }};
}
function assertGrounded(review: FounderWeeklyReviewV2Payload, snapshot: FounderWeeklyReviewEvidenceSnapshot) {
    const ids = new Set(snapshot.items.map((item) => item.sourceId));
    for (const section of [review.sections.whatChanged, review.sections.whatShipped, review.sections.whatCustomersSaid, review.sections.currentBlockers]) {
        if (section.state === "evidence") for (const item of section.items) {
            expect(item.sourceIds.length).toBeGreaterThan(0);
            for (const id of item.sourceIds) expect(ids.has(id)).toBe(true);
        }
    }
}

describe("LAU-9 grounding evaluation fixtures", () => {
    it("grounds the complete fixture, including customer attribution", async () => {
        const generate = jest.fn().mockResolvedValue({ object: payload(true), metadata: { provider: "test", model: "fixed", capability: "founderWeeklyReview", temperature: 0 } });
        const result = await generateFounderWeeklyReview({ evidenceSnapshot: completeWorkspaceFixture, generate });
        assertGrounded(result.reviewPayload, completeWorkspaceFixture);
        expect(result.reviewPayload.sections.whatCustomersSaid).toMatchObject({ state: "evidence" });
    });
    it("keeps the partial fixture customer section at explicit no-evidence", async () => {
        const generate = jest.fn().mockResolvedValue({ object: payload(false), metadata: { provider: "test", model: "fixed", capability: "founderWeeklyReview", temperature: 0 } });
        const result = await generateFounderWeeklyReview({ evidenceSnapshot: partialWorkspaceFixture, generate });
        assertGrounded(result.reviewPayload, partialWorkspaceFixture);
        expect(result.reviewPayload.sections.whatCustomersSaid.state).toBe("no_evidence");
    });
    it("completes the empty fixture without calling a provider or inventing facts", async () => {
        const generate = jest.fn();
        const result = await generateFounderWeeklyReview({ evidenceSnapshot: emptyWorkspaceFixture, generate });
        expect(generate).not.toHaveBeenCalled();
        for (const section of Object.values(result.reviewPayload.sections)) expect(section.state).toBe("no_evidence");
    });
});
