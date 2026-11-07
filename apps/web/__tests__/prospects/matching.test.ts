const mockScope = jest.fn();
const mockChatConfigured = jest.fn();
const mockEmbeddingConfig = jest.fn();
const mockGetEmbeddings = jest.fn();

jest.mock("~/server/workspace-models/scope", () => ({
    loadWorkspaceChatModelsScope: (...a: unknown[]) => mockScope(...a),
}));
jest.mock("~/server/prospects/run-mode", () => ({
    readRunEnvironment: (_env: unknown, own: boolean) => ({
        hasModel: own || mockChatConfigured(),
        hasSearch: false,
    }),
}));
jest.mock("@launchstack/llm/embeddings", () => ({
    getCompanyEmbeddingConfig: (...a: unknown[]) => mockEmbeddingConfig(...a),
    resolveEmbeddingIndex: () => ({ indexKey: "test-index" }),
}));
jest.mock("~/lib/models", () => ({
    getEmbeddings: (...a: unknown[]) => mockGetEmbeddings(...a),
}));
jest.mock("@launchstack/pipelines/distribution", () => ({
    createFitJudge: () => async () => new Map(),
}));

import { prospectEmbedder, prospectFitJudge } from "~/server/prospects/matching";

beforeEach(() => {
    jest.clearAllMocks();
    mockScope.mockResolvedValue({ source: "deployment", config: null });
    mockChatConfigured.mockReturnValue(false);
    mockEmbeddingConfig.mockResolvedValue(null);
});

describe("what Find companies matches with", () => {
    it("embeds through the workspace's embedding model, batched", async () => {
        const embedDocuments = jest.fn(async (texts: string[]) => texts.map(() => [1, 0]));
        mockGetEmbeddings.mockReturnValue({ embedQuery: jest.fn(), embedDocuments });
        const embed = await prospectEmbedder(5n);
        await expect(embed!(["a", "b"])).resolves.toEqual([
            [1, 0],
            [1, 0],
        ]);
        expect(mockGetEmbeddings).toHaveBeenCalledWith("test-index", undefined);
        expect(embedDocuments).toHaveBeenCalledWith(["a", "b"]);
    });

    it("has no embedder when none is configured, so the run matches by words", async () => {
        mockGetEmbeddings.mockImplementation(() => {
            throw new Error("EMBEDDING_API_KEY is not set");
        });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        await expect(prospectEmbedder(5n)).resolves.toBeNull();
        warn.mockRestore();
    });

    it("checks fit when the deployment or the workspace has a chat model", async () => {
        await expect(prospectFitJudge(5n)).resolves.toBeNull();
        mockChatConfigured.mockReturnValue(true);
        await expect(prospectFitJudge(5n)).resolves.toEqual(expect.any(Function));
        mockChatConfigured.mockReturnValue(false);
        mockScope.mockResolvedValue({ source: "workspace", config: { routes: {} } });
        await expect(prospectFitJudge(5n)).resolves.toEqual(expect.any(Function));
    });
});
