import {
    mapDocumentVersionToEvidenceItem,
    FounderWeeklyReviewEvidenceItemSchema,
    type DocumentVersionRow,
} from "@launchstack/features/founder-weekly-review";

function completeRow(): DocumentVersionRow {
    return {
        documentId: 42n,
        documentTitle: "Weekly Product Notes",
        documentCategory: "Product",
        versionId: 100,
        versionNumber: 3,
        uploadedBy: "user_abc",
        changelog: "Fixed onboarding activation delay.",
        createdAt: new Date("2026-07-10T18:15:00.000Z"),
    };
}

describe("mapDocumentVersionToEvidenceItem", () => {
    it("maps a complete row to the exact expected evidence item", () => {
        const item = mapDocumentVersionToEvidenceItem(completeRow());

        expect(item).toEqual({
            sourceType: "document_change",
            sourceId: "document_change:doc:42:version:100",
            title: "Weekly Product Notes",
            sourceTimestamp: "2026-07-10T18:15:00.000Z",
            excerpt: "Fixed onboarding activation delay.",
            workspaceDeepLink: "/employer/documents/viewer?docId=42",
            metadata: {
                documentId: "42",
                documentVersionId: 100,
                versionNumber: 3,
                documentCategory: "Product",
                uploadedBy: "user_abc",
                hasChangelog: true,
                changelogTruncated: false,
            },
        });
    });

    it("produces an item that satisfies the evidence-item contract", () => {
        const item = mapDocumentVersionToEvidenceItem(completeRow());
        expect(() =>
            FounderWeeklyReviewEvidenceItemSchema.parse(item)
        ).not.toThrow();
    });

    it("falls back to a factual excerpt when changelog is absent", () => {
        const item = mapDocumentVersionToEvidenceItem({
            ...completeRow(),
            changelog: null,
        });

        expect(item.excerpt).toBe("Version 3 uploaded");
        expect(item.metadata.hasChangelog).toBe(false);
    });

    it("treats a whitespace-only changelog as absent", () => {
        const item = mapDocumentVersionToEvidenceItem({
            ...completeRow(),
            changelog: "   ",
        });

        expect(item.excerpt).toBe("Version 3 uploaded");
        expect(item.metadata.hasChangelog).toBe(false);
    });

    it("carries a null uploader through without inventing a value", () => {
        const item = mapDocumentVersionToEvidenceItem({
            ...completeRow(),
            uploadedBy: null,
        });

        expect(item.metadata.uploadedBy).toBeNull();
    });
});
