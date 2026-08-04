import {
    buildWorkspaceDocumentEvidence,
    normalizeFounderContextRetrievalQuery,
    selectWorkspaceDocumentHits,
    type WorkspaceDocumentHit,
} from "@launchstack/features/founder-weekly-review";

const hit = (documentId: bigint, chunkId: number, score: number, content = `content ${chunkId}`): WorkspaceDocumentHit => ({
    documentId, documentTitle: `Document ${documentId}`, versionId: 9n, contextChunkId: chunkId, content, similarityScore: score,
    structureId: 4n, structurePath: "/1", structureTitle: "Section", pageNumber: 1, lineStart: 1, lineEnd: 2,
});

describe("workspace document evidence", () => {
    it("normalizes bounded founder context and skips blank queries", () => {
        expect(normalizeFounderContextRetrievalQuery("  founder   priority ")).toBe("founder priority");
        expect(normalizeFounderContextRetrievalQuery("  ")).toBeNull();
    });

    it("selects diverse stable hits and normalizes JSON-safe evidence", () => {
        const selected = selectWorkspaceDocumentHits([hit(2n, 3, 0.8), hit(1n, 2, 0.9), hit(1n, 1, 0.9), hit(1n, 1, 0.7)]);
        expect(selected.map((item) => [item.documentId, item.contextChunkId])).toEqual([[1n, 1], [1n, 2], [2n, 3]]);
        const evidence = buildWorkspaceDocumentEvidence(selected);
        expect(evidence).toEqual(buildWorkspaceDocumentEvidence(selected));
        expect(evidence[0]).toMatchObject({ sourceType: "workspace_document", sourceId: "workspace_document:doc:1:version:9:chunk:1", metadata: { documentId: "1", documentVersionId: "9", retrievalReason: "founder_context_relevance" } });
        expect(() => JSON.stringify(evidence)).not.toThrow();
    });

    it("uses exact BigInt ordering to break equal-score ties", () => {
        const selected = selectWorkspaceDocumentHits([
            hit(9007199254740993n, 1, 0.9),
            hit(9007199254740992n, 1, 0.9),
        ]);
        expect(selected.map((item) => item.documentId)).toEqual([9007199254740992n, 9007199254740993n]);
    });

    it("bounds excerpts", () => {
        const evidence = buildWorkspaceDocumentEvidence([hit(1n, 1, 0.5, "x".repeat(5000))]);
        expect(evidence[0]!.excerpt.length).toBe(4000);
    });
});
