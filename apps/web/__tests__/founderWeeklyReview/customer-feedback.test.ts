import {
    mapCustomerFeedbackChunkToEvidenceItem,
    type CustomerFeedbackChunkRow,
} from "@launchstack/features/founder-weekly-review";

function row(content: string | null): CustomerFeedbackChunkRow {
    return {
        documentId: 42n,
        versionId: 100,
        versionNumber: 3,
        documentTitle: "Customer interview",
        documentCategory: "Customer Feedback",
        createdAt: new Date("2026-07-10T18:15:00.000Z"),
        chunkId: 9,
        chunkContent: content,
        pageNumber: 4,
    };
}

describe("Customer Feedback chunk mapping", () => {
    it.each([null, "", "   "])("does not create cited evidence for missing content", (content) => {
        expect(mapCustomerFeedbackChunkToEvidenceItem(row(content))).toBeNull();
    });

    it("maps valid content with only document-context-chunk provenance", () => {
        expect(mapCustomerFeedbackChunkToEvidenceItem(row("  Export is too slow.  "))).toEqual({
            sourceType: "customer_feedback",
            sourceId: "customer_feedback:doc:42:version:100:section:9",
            title: "Customer interview",
            sourceTimestamp: "2026-07-10T18:15:00.000Z",
            excerpt: "Export is too slow.",
            workspaceDeepLink: "/employer/documents/viewer?docId=42",
            metadata: {
                documentId: "42",
                documentVersionId: 100,
                sectionId: 9,
                versionNumber: 3,
                documentCategory: "Customer Feedback",
                pageNumber: 4,
                excerptTruncated: false,
            },
        });
    });
});
