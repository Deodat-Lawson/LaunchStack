import { Document } from "@langchain/core/documents";

jest.mock("~/env", () => ({
    env: {
        server: {
            ENABLE_NOTES_RETRIEVER: true,
            ENABLE_GRAPH_RETRIEVER: false,
        },
    },
}));

const mockGetCompanyChunks = jest.fn();
const mockCreateCompanyBm25Retriever = jest.fn().mockResolvedValue({ kind: "bm25" });
jest.mock("~/lib/tools/rag/retrievers/bm25-retriever", () => ({
    getCompanyChunks: (...args: unknown[]) => mockGetCompanyChunks(...args),
    getDocumentChunks: jest.fn(),
    getMultiDocChunks: jest.fn(),
    chunksToDocuments: jest.fn(),
    createCompanyBM25Retriever: (...args: unknown[]) => mockCreateCompanyBm25Retriever(...args),
    createDocumentBM25Retriever: jest.fn(),
    createMultiDocBM25Retriever: jest.fn(),
}));

const mockCreateCompanyVectorRetriever = jest.fn().mockReturnValue({ kind: "vector" });
jest.mock("~/lib/tools/rag/retrievers/vector-retriever", () => ({
    createCompanyVectorRetriever: (...args: unknown[]) => mockCreateCompanyVectorRetriever(...args),
    createDocumentVectorRetriever: jest.fn(),
    createMultiDocVectorRetriever: jest.fn(),
}));

const mockNotesGetRelevantDocuments = jest.fn();
const mockCreateCompanyNotesRetriever = jest.fn().mockReturnValue({
    kind: "notes",
    getRelevantDocuments: (...args: unknown[]) => mockNotesGetRelevantDocuments(...args),
});
jest.mock("~/lib/tools/rag/retrievers/notes-retriever", () => ({
    createCompanyNotesRetriever: (...args: unknown[]) => mockCreateCompanyNotesRetriever(...args),
    createDocumentNotesRetriever: jest.fn(),
    createMultiDocNotesRetriever: jest.fn(),
}));

const mockEnsembleGetRelevantDocuments = jest.fn();
const mockEnsembleConstructor = jest.fn().mockImplementation(() => ({
    getRelevantDocuments: (...args: unknown[]) => mockEnsembleGetRelevantDocuments(...args),
}));
jest.mock("langchain/retrievers/ensemble", () => ({
    EnsembleRetriever: class {
        constructor(...args: unknown[]) {
            mockEnsembleConstructor(...args);
        }

        getRelevantDocuments(...args: unknown[]) {
            return mockEnsembleGetRelevantDocuments(...args);
        }
    },
}));

jest.mock("@langchain/community/retrievers/bm25", () => ({
    BM25Retriever: { fromDocuments: jest.fn() },
}));
jest.mock("~/lib/tools/rag/retrievers/neo4j-graph-retriever", () => ({
    createNeo4jGraphRetriever: jest.fn(),
    shouldUseNeo4jRetriever: jest.fn().mockReturnValue(false),
}));
jest.mock("~/lib/tools/rag/retrievers/graph-retriever", () => ({
    createGraphRetriever: jest.fn(),
}));
jest.mock("@launchstack/core/providers/reranking", () => ({
    getRerankProvider: jest.fn(),
    isRerankConfigured: jest.fn().mockReturnValue(false),
}));

const mockDocumentEmbeddings = { embedQuery: jest.fn() };
const mockNoteEmbeddings = { embedQuery: jest.fn() };
jest.mock("@launchstack/core/embeddings", () => ({
    createEmbeddingModel: jest.fn(() => mockDocumentEmbeddings),
    resolveEmbeddingIndex: jest.fn().mockReturnValue({
        indexKey: "document-index",
        dimension: 768,
    }),
}));
jest.mock("~/server/notes/embedding-config", () => ({
    resolveNoteEmbeddingRuntime: jest.fn(() => ({
        embeddings: mockNoteEmbeddings,
        index: { indexKey: "legacy-openai-1536" },
    })),
}));

import { companyEnsembleSearch } from "~/lib/tools/rag/search/ensemble-search";
import { env as mockedEnv } from "~/env";
import { resolveNoteEmbeddingRuntime } from "~/server/notes/embedding-config";

const mockEnv = mockedEnv as typeof mockedEnv & {
    server: { ENABLE_NOTES_RETRIEVER: boolean; ENABLE_GRAPH_RETRIEVER: boolean };
};
const mockResolveNoteEmbeddingRuntime = resolveNoteEmbeddingRuntime as jest.Mock;

function callNoteDocument(): Document {
    return new Document({
        pageContent: "Accepted Call Note",
        metadata: {
            source: "call_note",
            noteId: 20,
            callId: "call-20",
            revision: 4,
        },
    });
}

describe("companyEnsembleSearch notes-only behavior", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEnv.server.ENABLE_NOTES_RETRIEVER = true;
        mockGetCompanyChunks.mockResolvedValue([]);
        mockNotesGetRelevantDocuments.mockResolvedValue([]);
        mockEnsembleGetRelevantDocuments.mockResolvedValue([]);
    });

    it("returns [] with zero document chunks and no eligible notes", async () => {
        const results = await companyEnsembleSearch("customer", { companyId: 42, topK: 5 });

        expect(results).toEqual([]);
        expect(mockCreateCompanyNotesRetriever).toHaveBeenCalledWith(42, mockNoteEmbeddings, 8);
        expect(mockEnsembleConstructor).not.toHaveBeenCalled();
    });

    it("returns eligible Call Notes when the company has zero document chunks", async () => {
        mockNotesGetRelevantDocuments.mockResolvedValue([callNoteDocument()]);

        const [result] = await companyEnsembleSearch("customer", { companyId: 42, topK: 5 });

        expect(result).toMatchObject({
            pageContent: "Accepted Call Note",
            metadata: {
                retrievalMethod: "vector_ann",
                searchScope: "company",
                source: "call_note",
                noteId: 20,
                callId: "call-20",
                revision: 4,
            },
        });
        expect(mockEnsembleConstructor).not.toHaveBeenCalled();
    });

    it("preserves the normal ensemble when document chunks and notes exist", async () => {
        mockGetCompanyChunks.mockResolvedValue([{ id: 1, content: "document chunk" }]);
        mockEnsembleGetRelevantDocuments.mockResolvedValue([callNoteDocument()]);

        const [result] = await companyEnsembleSearch("customer", { companyId: 42, topK: 5 });

        expect(mockCreateCompanyBm25Retriever).toHaveBeenCalled();
        expect(mockCreateCompanyVectorRetriever).toHaveBeenCalled();
        expect(mockCreateCompanyNotesRetriever).toHaveBeenCalledWith(42, mockNoteEmbeddings, 8);
        expect(mockEnsembleConstructor).toHaveBeenCalledWith(
            expect.objectContaining({
                retrievers: expect.arrayContaining([
                    expect.objectContaining({ kind: "bm25" }),
                    expect.objectContaining({ kind: "vector" }),
                    expect.objectContaining({ kind: "notes" }),
                ]),
            })
        );
        expect(result?.metadata.retrievalMethod).toBe("ensemble_rrf");
    });

    it("fails safely when company chunk loading fails", async () => {
        mockGetCompanyChunks.mockRejectedValueOnce(new Error("database unavailable"));

        await expect(
            companyEnsembleSearch("customer", { companyId: 42, topK: 5 })
        ).resolves.toEqual([]);
    });

    it("fails safely when the note embedding runtime cannot be resolved", async () => {
        mockResolveNoteEmbeddingRuntime.mockImplementationOnce(() => {
            throw new Error("embedding configuration unavailable");
        });

        await expect(
            companyEnsembleSearch("customer", { companyId: 42, topK: 5 })
        ).resolves.toEqual([]);
    });
});
