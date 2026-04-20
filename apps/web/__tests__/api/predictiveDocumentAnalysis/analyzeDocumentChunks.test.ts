const mockStructuredInvoke = jest.fn().mockResolvedValue({
    missingDocuments: [],
    recommendations: [],
});

jest.mock("p-limit", () => ({
    __esModule: true,
    default: () => (fn: () => Promise<unknown>) => fn(),
}));

jest.mock("@langchain/openai", () => {
    const MockChatOpenAI = class {
        withStructuredOutput() {
            return {
                invoke: mockStructuredInvoke,
            };
        }
    };
    return {
        __esModule: true,
        ChatOpenAI: MockChatOpenAI,
    };
});

import * as AnalysisEngine from "~/app/api/agents/predictive-document-analysis/services/analysisEngine";
import { createChunkBatches } from "~/app/api/agents/predictive-document-analysis/utils/batching";
import type { PdfChunk, AnalysisSpecification } from "~/app/api/agents/predictive-document-analysis/types";

describe("predictive analysis batching", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStructuredInvoke.mockClear();
    });

    it("groups chunks according to the configured limits", () => {
        const chunks: PdfChunk[] = [
            { id: 1, page: 1, content: "a".repeat(1000) },
            { id: 2, page: 2, content: "b".repeat(1000) },
            { id: 3, page: 3, content: "c".repeat(1000) },
            { id: 4, page: 4, content: "d".repeat(1000) },
            { id: 5, page: 5, content: "e".repeat(1000) },
        ];

        const batches = createChunkBatches(chunks, {
            maxChunksPerCall: 2,
            maxCharactersPerCall: 2500,
        });

        expect(batches).toHaveLength(3);
        expect(batches[0]).toHaveLength(2);
        expect(batches[1]).toHaveLength(2);
        expect(batches[2]).toHaveLength(1);
    });

    it("caps OpenAI round trips for large documents", async () => {
        const chunks: PdfChunk[] = Array.from({ length: 120 }, (_, index) => ({
            id: index + 1,
            page: index + 1,
            content: `Chunk content ${index + 1}`,
        }));

        const specification: AnalysisSpecification = {
            type: "general",
            includeRelatedDocs: false,
            existingDocuments: [],
            title: "Sample",
            category: "general",
            companyId: 1,
            documentId: 10,
        };

        const { stats } = await AnalysisEngine.analyzeDocumentChunks(
            chunks,
            specification,
            2000,
            8
        );

        expect(stats.aiCalls).toBeLessThanOrEqual(15);
        expect(stats.totalChunks).toBe(120);
        expect(mockStructuredInvoke).toHaveBeenCalledTimes(stats.aiCalls);
    });
});
