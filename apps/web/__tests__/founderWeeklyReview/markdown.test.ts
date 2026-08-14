import { renderFounderWeeklyReviewMarkdown } from "~/server/founder-weekly-review/markdown";

function reviewRun() {
    return {
        reportingPeriod: { start: "2026-02-16", end: "2026-02-28" },
        modelMetadata: { model: "kimi-k2.6" },
        evidenceSnapshot: {
            items: [
                { sourceId: "customer_feedback:doc:7:version:3:section:15", sourceType: "customer_feedback", title: "Customer Interviews — February 2026", excerpt: "first raw excerpt", metadata: { pageNumber: 2, sectionId: 15, documentCategory: "Customer Feedback" } },
                { sourceId: "customer_feedback:doc:7:version:3:section:16", sourceType: "customer_feedback", title: "Customer Interviews — February 2026", excerpt: "second raw excerpt", metadata: { pageNumber: 3, sectionId: 16, documentCategory: "Customer Feedback" } },
                { sourceId: "document_change:doc:4:version:2", sourceType: "document_change", title: "Onboarding reliability plan", excerpt: "document changelog", metadata: { versionNumber: 2 } },
                { sourceId: "founder_context:request:secret", sourceType: "founder_context", title: "Founder context", excerpt: "private context", metadata: {} },
            ],
        },
        reviewPayload: {
            schemaVersion: "founder-weekly-review/v2",
            sections: {
                whatShipped: { state: "no_evidence", noEvidence: { code: "none", message: "No completed release evidence.", cta: "Add release evidence." } },
                whatChanged: { state: "no_evidence", noEvidence: { code: "none", message: "No other change evidence.", cta: "Add change evidence." } },
                whatCustomersSaid: { state: "evidence", items: [{ kind: "observed_fact", text: "Two distinct interview excerpts identify reporting setup and recovery concerns.", sourceIds: ["customer_feedback:doc:7:version:3:section:15", "customer_feedback:doc:7:version:3:section:16"], confidence: 0.8 }] },
                currentBlockers: { state: "evidence", items: [{ kind: "observed_fact", text: "The documented plan is operational preparation, not proof that retries are fixed.", sourceIds: ["document_change:doc:4:version:2"], confidence: 0.8 }] },
                nextPriorities: { state: "evidence", items: [{ kind: "recommendation", label: "Recommendation", text: "Improve recovery feedback.", rationale: "Founder-provided context identifies it as a priority.", sourceIds: ["founder_context:request:secret"], confidence: 0.7 }] },
            },
        },
    } as any;
}

describe("Founder Weekly Review Markdown", () => {
    it("renders useful no-evidence sections without an empty Key Outcomes container", () => {
        const rendered = renderFounderWeeklyReviewMarkdown(reviewRun());

        expect(rendered).not.toContain("## Key Outcomes");
        expect(rendered).toContain("## Shipped This Period\n\nNo completed release evidence.\n\nNext: Add release evidence.");
    });

    it("uses deterministic, distinct human-readable evidence labels with metadata", () => {
        const rendered = renderFounderWeeklyReviewMarkdown(reviewRun());

        expect(rendered).toContain("[1] Customer Interviews — February 2026 — page 2 — section 15");
        expect(rendered).toContain("[2] Customer Interviews — February 2026 — page 3 — section 16");
        expect(rendered).toContain("[3] Document change — Onboarding reliability plan");
        expect(rendered).toContain("[4] Founder-provided context");
        expect(rendered).not.toContain("[1] Customer Feedback");
    });

    it("uses the exact rendered Markdown for terminal and export paths without operational internals", () => {
        const terminalMarkdown = renderFounderWeeklyReviewMarkdown(reviewRun());
        const exportedMarkdown = renderFounderWeeklyReviewMarkdown(reviewRun());

        expect(exportedMarkdown).toBe(terminalMarkdown);
        for (const forbidden of ["customer_feedback:doc:7", "founder_context:request:secret", "first raw excerpt", "evidenceSnapshot", "MOONSHOT_API_KEY", "DATABASE_URL", "provider raw response", "internal error"]) {
            expect(terminalMarkdown).not.toContain(forbidden);
        }
    });
});
