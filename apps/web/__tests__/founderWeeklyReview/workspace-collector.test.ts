import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";

describe("workspace document collection", () => {
    it("skips retrieval for blank Founder Context", async () => {
        const store = { retrieveRelevantCurrentDocumentChunks: jest.fn() };
        const service = new FounderWeeklyReviewEvidenceService(
            {} as never,
            undefined,
            { kind: "unconfigured" },
            store
        );
        await expect(service.collectWorkspaceDocumentEvidence(1n, "  ")).resolves.toEqual({
            items: [],
            warnings: [],
        });
        expect(store.retrieveRelevantCurrentDocumentChunks).not.toHaveBeenCalled();
    });

    it("maps relevant current hits and preserves unavailability as a bounded warning", async () => {
        const store = {
            retrieveRelevantCurrentDocumentChunks: jest
                .fn()
                .mockResolvedValueOnce({
                    state: "success",
                    hits: [
                        {
                            documentId: 1n,
                            documentTitle: "Current plan",
                            versionId: 2n,
                            contextChunkId: 3,
                            content: "Current blocker",
                            similarityScore: 0.9,
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    state: "unavailable",
                    hits: [],
                    warnings: ["workspace_document_retrieval_unavailable"],
                }),
        };
        const service = new FounderWeeklyReviewEvidenceService(
            {} as never,
            undefined,
            { kind: "unconfigured" },
            store
        );
        await expect(
            service.collectWorkspaceDocumentEvidence(1n, " blocker ")
        ).resolves.toMatchObject({
            items: [
                {
                    sourceType: "workspace_document",
                    metadata: { retrievalReason: "founder_context_relevance" },
                },
            ],
            warnings: [],
        });
        await expect(service.collectWorkspaceDocumentEvidence(1n, " blocker ")).resolves.toEqual({
            items: [],
            warnings: [
                {
                    code: "workspace_document_retrieval_unavailable",
                    message: "Founder Context workspace retrieval was unavailable.",
                    sourceType: "workspace_document",
                },
            ],
        });
    });
});
