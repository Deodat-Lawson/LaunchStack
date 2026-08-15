import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";

describe("founder context evidence", () => {
    const service = new FounderWeeklyReviewEvidenceService({} as never);

    it("normalizes request-time founder context with a stable non-content id", () => {
        const result = service.collectFounderContextEvidence({
            founderContext: "  Customers  need  faster exports. ",
            contextEntryId: "request-123",
            actor: { externalUserId: "user_123" },
        });
        expect(result.items).toEqual([
            expect.objectContaining({
                sourceType: "founder_context",
                sourceId: "founder_context:entry:request-123",
                excerpt: "Customers need faster exports.",
                metadata: expect.objectContaining({
                    enteredBy: "user_123",
                    provenance: "request_time_founder_input",
                }),
            }),
        ]);
    });

    it("does not create evidence for blank context", () => {
        expect(service.collectFounderContextEvidence({ founderContext: "  " }).items).toEqual([]);
    });
});
