const mockCompanyEnsembleSearch = jest.fn();
const mockEmbeddings = { embedQuery: jest.fn() };

jest.mock("~/lib/tools/rag", () => ({
    companyEnsembleSearch: (...args: unknown[]) => mockCompanyEnsembleSearch(...args),
    createOpenAIEmbeddings: jest.fn(() => mockEmbeddings),
}));

import { createAppRagPort } from "~/server/rag/port";

describe("RagPort note metadata propagation", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("keeps ordinary document metadata unchanged", async () => {
        mockCompanyEnsembleSearch.mockResolvedValueOnce([
            {
                pageContent: "Document evidence",
                pageNumber: 2,
                title: "Plan",
                documentId: 11,
                source: "document",
                retrievalMethod: "ensemble_rrf",
                metadata: {
                    chunkId: 7,
                    page: 2,
                    documentId: 11,
                    documentTitle: "Plan",
                    distance: 0.2,
                    confidence: 0.8,
                    source: "document",
                    searchScope: "company",
                    embeddingIndexKey: "document-index",
                    rerankScore: 0.9,
                    timestamp: "2026-08-21T00:00:00.000Z",
                },
            },
        ]);

        const [result] = await createAppRagPort().companyEnsembleSearch("plan", {
            companyId: 42,
        });

        expect(result).toEqual({
            pageContent: "Document evidence",
            pageNumber: 2,
            title: "Plan",
            documentId: 11,
            source: "document",
            retrievalMethod: "ensemble_rrf",
            metadata: {
                chunkId: 7,
                page: 2,
                documentId: 11,
                documentTitle: "Plan",
                distance: 0.2,
                confidence: 0.8,
                source: "document",
                embeddingIndexKey: "document-index",
                rerankScore: 0.9,
                timestamp: "2026-08-21T00:00:00.000Z",
            },
        });
    });

    it("preserves ordinary Note source and noteId from metadata", async () => {
        mockCompanyEnsembleSearch.mockResolvedValueOnce([
            {
                pageContent: "Ordinary Note",
                metadata: {
                    source: "note",
                    noteId: 10,
                    searchScope: "company",
                },
            },
        ]);

        const [result] = await createAppRagPort().companyEnsembleSearch("note", {
            companyId: 42,
        });

        expect(result?.source).toBe("note");
        expect(result?.metadata).toMatchObject({ source: "note", noteId: 10 });
        expect(result?.metadata).not.toHaveProperty("callId");
    });

    it("preserves Call Note source, noteId, callId, and revision", async () => {
        mockCompanyEnsembleSearch.mockResolvedValueOnce([
            {
                pageContent: "Accepted Call Note",
                metadata: {
                    source: "call_note",
                    noteId: 20,
                    callId: "call-20",
                    revision: 4,
                    searchScope: "company",
                },
            },
        ]);

        const [result] = await createAppRagPort().companyEnsembleSearch("customer", {
            companyId: 42,
        });

        expect(result?.source).toBe("call_note");
        expect(result?.metadata).toMatchObject({
            source: "call_note",
            noteId: 20,
            callId: "call-20",
            revision: 4,
        });
        expect(result?.metadata).not.toHaveProperty("deepLink");
    });
});
