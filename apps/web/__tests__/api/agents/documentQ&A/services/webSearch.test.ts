/**
 * Chat web search is skipped outright when no search provider is configured.
 *
 * The workspace client asks for web search on every send, and the search
 * starts with a model call that rewrites the question into a query. Without
 * an Exa key the search itself can only return nothing, so that model call
 * was pure latency on every Ask turn. It must not run, and the result must
 * say no search happened so the prompt doesn't claim one did.
 */

const mockEnv = { server: { EXA_API_KEY: undefined as string | undefined } };
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));

const mockAgent = jest.fn();
jest.mock("~/app/api/agents/documentQ&A/services/webSearchAgent", () => ({
    executeWebSearchAgent: (...args: unknown[]) => mockAgent(...args),
}));

import { performWebSearch } from "~/app/api/agents/documentQ&A/services/webSearch";

describe("performWebSearch", () => {
    beforeEach(() => {
        mockAgent.mockReset();
        mockEnv.server.EXA_API_KEY = undefined;
    });

    it("skips the search, and the model call before it, when no Exa key is set", async () => {
        const result = await performWebSearch("what changed?", "context", true, 5);

        expect(mockAgent).not.toHaveBeenCalled();
        expect(result).toEqual({
            searched: false,
            results: [],
            refinedQuery: "what changed?",
            content: "",
        });
    });

    it("skips the search when the caller did not ask for one", async () => {
        mockEnv.server.EXA_API_KEY = "exa-test-key";

        const result = await performWebSearch("what changed?", "context", false, 5);

        expect(mockAgent).not.toHaveBeenCalled();
        expect(result.searched).toBe(false);
    });

    it("runs the search agent when asked and a key is set", async () => {
        mockEnv.server.EXA_API_KEY = "exa-test-key";
        mockAgent.mockResolvedValue({
            results: [{ title: "T", url: "https://example.com", snippet: "S" }],
            refinedQuery: "refined",
            reasoning: "why",
        });

        const result = await performWebSearch("what changed?", "context", true, 5);

        expect(mockAgent).toHaveBeenCalledTimes(1);
        expect(result.searched).toBe(true);
        expect(result.results).toHaveLength(1);
        expect(result.content).toContain("[Source 1]");
    });

    it("reports a search that ran but found nothing as searched", async () => {
        mockEnv.server.EXA_API_KEY = "exa-test-key";
        mockAgent.mockResolvedValue({ results: [], refinedQuery: "refined", reasoning: "why" });

        const result = await performWebSearch("what changed?", undefined, true, 5);

        expect(result.searched).toBe(true);
        expect(result.results).toEqual([]);
    });
});
