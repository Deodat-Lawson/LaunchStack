import type { SearchResult } from "@launchstack/retrieval/search-types";
import { createAppRagPort } from "~/server/rag/port";

const mockSearch = jest.fn();
const mockEmbeddings = {};
jest.mock("~/server/rag/ensemble", () => ({
    companyEnsembleSearch: (...args: unknown[]) => mockSearch(...args),
    createOpenAIEmbeddings: () => mockEmbeddings,
}));

beforeEach(() => {
    mockSearch.mockReset();
    jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function hit(versionId?: unknown): SearchResult {
    return {
        pageContent: "backend text",
        documentId: 2,
        retrievalMethod: "ensemble_rrf",
        metadata: { documentId: 2, versionId, chunkId: 4, searchScope: "company" },
    } as SearchResult;
}

describe("app RAG exact-version metadata", () => {
    it("preserves backend versions, ranking order and query options through the actual mapper", async () => {
        mockSearch.mockResolvedValue([hit(12), hit(11)]);
        const options = {
            companyId: 7,
            topK: 2,
            embeddingIndexKey: "test-index",
            filters: { documentIds: [2] },
        };
        const results = await createAppRagPort().companyEnsembleSearch("risks", options);
        expect(results.map(result => result.metadata.versionId)).toEqual([12, 11]);
        expect(results.map(result => result.pageContent)).toEqual(["backend text", "backend text"]);
        expect(mockSearch).toHaveBeenCalledWith(
            "risks",
            expect.objectContaining(options),
            mockEmbeddings
        );
    });

    it("preserves missing versions without inventing a current-head binding", async () => {
        mockSearch.mockResolvedValue([hit()]);
        expect(
            (await createAppRagPort().companyEnsembleSearch("risks", { companyId: 7 }))[0]?.metadata
                .versionId
        ).toBeUndefined();
    });

    it.each([null, "12", 12n, NaN, Infinity, 0, -1, Number.MAX_SAFE_INTEGER + 1])(
        "preserves untrusted version %s for the exact-version consumer to reject",
        async version => {
            mockSearch.mockResolvedValue([hit(version)]);
            expect(
                (await createAppRagPort().companyEnsembleSearch("risks", { companyId: 7 }))[0]
                    ?.metadata.versionId
            ).toBe(version);
        }
    );
});
