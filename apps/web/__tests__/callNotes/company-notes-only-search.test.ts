import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";

const mockChunkRows: unknown[] = [];
let mockChunkError: Error | null = null;
jest.mock("@launchstack/store/client", () => ({
    getDb: () => ({
        select: () => ({
            from: () => ({
                innerJoin: () => ({
                    where: async () => {
                        if (mockChunkError) throw mockChunkError;
                        return mockChunkRows;
                    },
                }),
            }),
        }),
    }),
}));

const mockNotesGetRelevantDocuments = jest.fn<Promise<Document[]>, [string]>();

class TestNotesRetriever extends BaseRetriever {
    lc_namespace = ["test", "notes"];
    _getRelevantDocuments = mockNotesGetRelevantDocuments;
}

const mockCreateCompanyNotesRetriever = jest.fn(() => new TestNotesRetriever({}));
const mockNoteEmbeddings = { embedQuery: jest.fn() };

const notesLegs = {
    createDocumentLeg: jest.fn(),
    createCompanyLeg: mockCreateCompanyNotesRetriever,
    createMultiDocLeg: jest.fn(),
};

import {
    companyEnsembleSearch,
    configureEnsemble,
} from "@launchstack/retrieval/algorithms/ensemble";

function ordinaryNoteDocument(): Document {
    return new Document({
        pageContent: "Ordinary note evidence",
        metadata: {
            source: "note",
            noteId: 20,
        },
    });
}

describe("companyEnsembleSearch notes-only behavior", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockChunkRows.length = 0;
        mockChunkError = null;
        mockCreateCompanyNotesRetriever.mockClear();
        mockNotesGetRelevantDocuments.mockResolvedValue([]);
        configureEnsemble({
            graphRetrieval: false,
            notesLegs,
            factsLegs: null,
        });
    });

    it("returns [] with zero document chunks and no ordinary notes", async () => {
        const results = await companyEnsembleSearch(
            "customer",
            { companyId: 42, topK: 5 },
            mockNoteEmbeddings
        );

        expect(results).toEqual([]);
    });

    it("returns ordinary notes when the company has zero document chunks", async () => {
        mockNotesGetRelevantDocuments.mockResolvedValue([ordinaryNoteDocument()]);

        const [result] = await companyEnsembleSearch(
            "customer",
            { companyId: 42, topK: 5 },
            mockNoteEmbeddings
        );

        expect(result).toMatchObject({
            pageContent: "Ordinary note evidence",
            metadata: {
                retrievalMethod: "vector_ann",
                searchScope: "company",
                source: "note",
                noteId: 20,
            },
        });
    });

    it("fails safely when company chunk loading fails", async () => {
        mockChunkError = new Error("database unavailable");

        await expect(
            companyEnsembleSearch("customer", { companyId: 42, topK: 5 }, mockNoteEmbeddings)
        ).resolves.toEqual([]);
    });

    it("fails safely when the notes leg fails", async () => {
        mockCreateCompanyNotesRetriever.mockImplementationOnce(() => {
            throw new Error("notes unavailable");
        });

        await expect(
            companyEnsembleSearch("customer", { companyId: 42, topK: 5 }, mockNoteEmbeddings)
        ).resolves.toEqual([]);
    });
});
