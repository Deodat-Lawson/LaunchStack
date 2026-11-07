/**
 * /api/document-generator/research: the web leg is general web search
 * (@launchstack/tools/web-research `searchWeb`, on the server's engine,
 * SEARCH_PROVIDER), not a hand-rolled Exa call — and with no engine it is
 * skipped, leaving documents and arXiv to answer. The work runs in the
 * person's workspace scope, so each paid search is counted against them.
 */
import type * as Llm from "@launchstack/llm";

const mockRequireWorkspaceContext = jest.fn();
// The allowance gate reads the meter; this test doesn't model limits.
jest.mock("~/server/ai-usage/refusal", () => ({ refuseAtAiAllowance: jest.fn(async () => null) }));
// Runs the work in a chat scope whose recorder the test reads, as the real
// scope hands usage to the meter.
const mockScopes: unknown[][] = [];
const mockUsage: Llm.ChatUsageEvent[] = [];
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (companyId: unknown, use: unknown, fn: () => unknown) => {
        mockScopes.push([companyId, use]);
        const { runWithChatModelsScope } = jest.requireActual<typeof Llm>("@launchstack/llm");
        return runWithChatModelsScope(
            { source: "deployment", usage: { record: event => mockUsage.push(event) } },
            fn
        );
    },
}));

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/lib/authz/scope", () => ({ scopedDocumentWhere: jest.fn() }));
jest.mock("~/server/rag/ensemble", () => ({ multiDocEnsembleSearch: jest.fn() }));
jest.mock("~/server/rag/gate", () => ({ gateChunksByScope: jest.fn() }));
jest.mock("~/app/api/agents/documentQ&A/services", () => ({ getEmbeddings: jest.fn() }));

import { POST } from "~/app/api/document-generator/research/route";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

interface ResearchBody {
    success: boolean;
    results: { source: string; title?: string; url?: string; snippet?: string }[];
    stats: { webResults: number };
}

function request(body: Record<string, unknown>): Request {
    return new Request("http://localhost/api/document-generator/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

const SEARCH_ENV = [
    "EXA_API_KEY",
    "SERPER_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "TAVILY_API_KEY",
    "SEARXNG_URL",
    "SEARCH_PROVIDER",
] as const;
const savedEnv = Object.fromEntries(SEARCH_ENV.map(name => [name, process.env[name]]));
const realFetch = global.fetch;
const mockFetch = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

beforeEach(() => {
    jest.clearAllMocks();
    mockScopes.length = 0;
    mockUsage.length = 0;
    for (const name of SEARCH_ENV) delete process.env[name];
    global.fetch = mockFetch as unknown as typeof fetch;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role: "member" }),
    });
});

afterEach(() => {
    for (const name of SEARCH_ENV) {
        if (savedEnv[name] === undefined) delete process.env[name];
        else process.env[name] = savedEnv[name];
    }
    global.fetch = realFetch;
    jest.restoreAllMocks();
});

describe("POST /api/document-generator/research — web", () => {
    it("searches the whole web on Exa (no news category) with only an Exa key", async () => {
        process.env.EXA_API_KEY = "exa-test";
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    results: [
                        {
                            title: "Retrieval-augmented generation survey",
                            url: "https://papers.example/rag",
                            text: "A survey of retrieval-augmented generation.",
                        },
                    ],
                }),
                { status: 200 }
            )
        );

        const res = await POST(
            request({
                query: "retrieval augmented generation",
                sources: ["web"],
                options: { searchType: "academic", maxResults: 3 },
            })
        );

        expect(res.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0]!;
        expect(url).toBe("https://api.exa.ai/search");
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("exa-test");
        const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
        expect(sent).not.toHaveProperty("category");
        // The academic prefix still steers the query.
        expect(sent.query).toBe("academic research: retrieval augmented generation");
        expect(sent.numResults).toBe(3);

        const body = (await res.json()) as ResearchBody;
        expect(body.stats.webResults).toBe(1);
        expect(body.results[0]).toMatchObject({
            source: "web",
            title: "Retrieval-augmented generation survey",
            url: "https://papers.example/rag",
            snippet: "A survey of retrieval-augmented generation.",
        });

        // One Exa search, counted against the person who asked.
        expect(mockScopes).toEqual([[BigInt(5), { feature: "documentWriter", userId: "user-a" }]]);
        expect(mockUsage).toEqual([
            {
                kind: "web_search",
                calls: 1,
                modelId: "exa",
                owner: "deployment",
                inputTokens: 0,
                outputTokens: 0,
            },
        ]);
    });

    it("falls back to Serper's general search when it is the only key", async () => {
        process.env.SERPER_API_KEY = "serper-test";
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    organic: [
                        { title: "Hit", link: "https://hit.example/", snippet: "From Google." },
                    ],
                }),
                { status: 200 }
            )
        );

        const res = await POST(request({ query: "pricing pages", sources: ["web"] }));

        const [url] = mockFetch.mock.calls[0]!;
        expect(url).toBe("https://google.serper.dev/search");
        const body = (await res.json()) as ResearchBody;
        expect(body.results[0]).toMatchObject({ source: "web", url: "https://hit.example/" });
    });

    it("skips the web without a search key and still answers", async () => {
        const res = await POST(request({ query: "anything", sources: ["web"] }));

        expect(res.status).toBe(200);
        expect(mockFetch).not.toHaveBeenCalled();
        const body = (await res.json()) as ResearchBody;
        expect(body).toMatchObject({ success: true, results: [], stats: { webResults: 0 } });
    });

    it("keeps answering when the search provider fails", async () => {
        process.env.EXA_API_KEY = "exa-test";
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockFetch.mockResolvedValue(new Response("down", { status: 503 }));

        const res = await POST(request({ query: "anything", sources: ["web"] }));

        expect(res.status).toBe(200);
        const body = (await res.json()) as ResearchBody;
        expect(body.stats.webResults).toBe(0);
        // A refused search is not a paid one.
        expect(mockUsage).toEqual([]);
    });
});
