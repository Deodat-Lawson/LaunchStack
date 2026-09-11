/**
 * The post-retrieval gate is the last check before a chunk reaches the
 * prompt. Every leg filters by scope in SQL, so the gate should drop
 * nothing; when a leg leaks, the chunk must still never be used, and the
 * `authz_retrieval_dropped_total` counter must say so.
 */

import type { Registry as PromRegistry } from "prom-client";

import { POST } from "~/app/api/agents/documentQ&A/AIChat/query/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { DocumentScope } from "~/lib/authz/scope-types";
import { authzRetrievalDropped } from "~/server/metrics/authz";
import { multiDocEnsembleSearch } from "~/server/rag/ensemble";

import { makeWorkspaceContext } from "../helpers/workspace-context";

jest.mock("~/lib/require-workspace-context", () => {
    const actual = jest.requireActual("~/lib/require-workspace-context");
    return { ...actual, requireWorkspaceContext: jest.fn() };
});

let mockQueuedRows: Record<string, unknown>[][] = [];
const mockWhere = jest.fn();

function mockBuilder() {
    const rows = mockQueuedRows.shift() ?? [];
    const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => resolve(rows),
    };
    for (const method of ["from", "limit", "orderBy"]) {
        builder[method] = () => builder;
    }
    builder.where = (predicate: unknown) => {
        mockWhere(predicate);
        return builder;
    };
    return builder;
}

// A function declaration, so the hoisted mock factories can reach it.
function mockDbObject() {
    return {
        select: () => mockBuilder(),
        insert: () => ({ values: () => Promise.resolve(undefined) }),
    };
}
// The route reads `~/server/db/index`, the gate `~/server/db`; both share the queue.
jest.mock("~/server/db/index", () => ({ db: mockDbObject() }));
jest.mock("~/server/db", () => ({ db: mockDbObject() }));

jest.mock("@launchstack/store/schema", () => ({
    document: {
        id: "document.id",
        title: "document.title",
        category: "document.category",
        companyId: "document.companyId",
        sourceArchiveName: "document.sourceArchiveName",
    },
}));

jest.mock("~/server/db/schema", () => ({
    ChatHistory: { UserId: "history.userId" },
}));

jest.mock("drizzle-orm", () => ({
    eq: (...args: unknown[]) => ({ op: "eq", args }),
    and: (...args: unknown[]) => ({ op: "and", args }),
    inArray: (...args: unknown[]) => ({ op: "inArray", args }),
}));

jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: jest.fn((companyId: bigint, scope: unknown) => ({
        op: "scoped",
        companyId,
        scope,
    })),
}));

// A real registry so the real authz counters register and can be read back.
jest.mock("~/server/metrics/registry", () => {
    const { Registry: ActualRegistry } = jest.requireActual<{ Registry: typeof PromRegistry }>(
        "prom-client"
    );
    return {
        metricsRegistry: new ActualRegistry(),
        qaRequestCounter: { inc: jest.fn() },
        qaRequestDuration: { startTimer: () => jest.fn() },
    };
});

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { strict: {} },
}));

jest.mock("~/server/rag/ensemble", () => ({
    companyEnsembleSearch: jest.fn(),
    documentEnsembleSearch: jest.fn(),
    multiDocEnsembleSearch: jest.fn(),
}));

jest.mock("@launchstack/retrieval/algorithms/vector", () => ({
    createDocumentVectorRetriever: jest.fn(),
    ANNOptimizer: class {
        searchSimilarChunks = jest.fn().mockResolvedValue([]);
    },
}));

jest.mock("@launchstack/llm/embeddings", () => ({
    resolveEmbeddingIndex: () => ({ indexKey: "default" }),
    isLegacyEmbeddingIndex: () => false,
    getCompanyEmbeddingConfig: jest.fn().mockResolvedValue(null),
}));

jest.mock("~/app/api/agents/documentQ&A/services", () => ({
    normalizeModelContent: (content: unknown) => String(content),
    performWebSearch: jest
        .fn()
        .mockResolvedValue({ content: "", results: [], refinedQuery: "", reasoning: "" }),
    getSystemPrompt: () => "system",
    getWebSearchInstruction: () => "",
    describeChatError: () => null,
    getEmbeddings: () => ({ embedQuery: jest.fn() }),
    buildReferences: () => [],
    extractRecommendedPages: () => [1],
}));

const mockInvoke = jest.fn();
jest.mock("~/lib/models", () => ({
    selectChatRoute: () => ({ route: "default", requiredCapabilities: [] }),
    resolveConfiguredChatModel: () => ({
        modelId: "gpt-4o-mini",
        chat: { invoke: mockInvoke },
        behavior: {},
        prepareMessages: (messages: unknown) => messages,
    }),
}));

jest.mock("~/server/chat-request-compat", () => ({
    validateDeprecatedChatSelection: () => ({ ok: true }),
}));

jest.mock("@launchstack/llm", () => ({
    isChatRequestError: () => false,
    normalizeTokenUsage: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
}));

jest.mock("@launchstack/llm/types", () => ({
    ...jest.requireActual("@launchstack/llm/types"),
}));

jest.mock("~/lib/credits", () => ({
    debitTokens: jest.fn().mockResolvedValue(undefined),
    llmChatTokens: () => 0,
}));

jest.mock("@launchstack/store/credits", () => ({
    isMeteringEnabled: () => false,
}));

jest.mock("~/lib/agents/supervisor", () => ({
    validateQAResponse: () => ({ approved: true, issues: [] }),
}));

jest.mock("@langchain/core/messages", () => ({
    SystemMessage: class {
        content: unknown;
        constructor(content: unknown) {
            this.content = content;
        }
    },
    HumanMessage: class {
        content: unknown;
        constructor(content: unknown) {
            this.content = content;
        }
    },
}));

const SECRETS_HIDDEN: DocumentScope = {
    kind: "except",
    deniedCategories: ["Secret"],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

function queryRequest(body: unknown) {
    return new Request("http://localhost/api/agents/documentQ&A/AIChat/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

/** What the readable-id resolution returns before retrieval runs. */
const READABLE_IDS = [{ id: 1 }, { id: 3 }];

async function droppedCount(scope: string): Promise<number> {
    const metric = await authzRetrievalDropped.get();
    return metric.values.find(v => v.labels.scope === scope)?.value ?? 0;
}

function promptOf(call: unknown[]): string {
    const messages = call[0] as Array<{ content: unknown }>;
    return String(messages[messages.length - 1]?.content);
}

describe("post-retrieval scope gate", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockQueuedRows = [];
        authzRetrievalDropped.reset();
        mockInvoke.mockResolvedValue({ content: "answer", response_metadata: {} });
        (requireWorkspaceContext as jest.Mock).mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ role: "member", scope: SECRETS_HIDDEN }),
        });
    });

    it("drops an out-of-scope chunk before the prompt and counts it once", async () => {
        (multiDocEnsembleSearch as jest.Mock).mockResolvedValue([
            {
                pageContent: "public text",
                metadata: { page: 1, documentId: 1, category: "Public" },
            },
            // A leg that ignored its ids: the chunk's document was never searchable.
            {
                pageContent: "secret text",
                metadata: { page: 2, documentId: 2, category: "Secret" },
            },
            // No category on the chunk: the gate looks the document up through the scope.
            { pageContent: "looked-up text", metadata: { page: 3, documentId: 3 } },
        ]);
        mockQueuedRows = [READABLE_IDS, [{ id: 3, category: "Public" }]];

        const response = await POST(queryRequest({ question: "what?", searchScope: "company" }));

        expect(response.status).toBe(200);
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        const prompt = promptOf(mockInvoke.mock.calls[0]);
        expect(prompt).toContain("public text");
        expect(prompt).toContain("looked-up text");
        expect(prompt).not.toContain("secret text");

        expect(await droppedCount("company")).toBe(1);
        // The lookup for the uncategorised chunk went through the scoped predicate.
        expect(mockWhere).toHaveBeenLastCalledWith(
            expect.objectContaining({
                op: "and",
                args: expect.arrayContaining([
                    expect.objectContaining({ op: "inArray", args: ["document.id", [3]] }),
                    expect.objectContaining({ op: "scoped", scope: SECRETS_HIDDEN }),
                ]),
            })
        );
        expect((await response.json()).chunksAnalyzed).toBe(2);
    });

    it("drops a chunk whose document the scoped lookup does not return", async () => {
        (multiDocEnsembleSearch as jest.Mock).mockResolvedValue([
            {
                pageContent: "public text",
                metadata: { page: 1, documentId: 1, category: "Public" },
            },
            { pageContent: "vanished text", metadata: { page: 2, documentId: 9 } },
        ]);
        mockQueuedRows = [READABLE_IDS, []];

        const response = await POST(queryRequest({ question: "what?", searchScope: "company" }));

        expect(response.status).toBe(200);
        expect(promptOf(mockInvoke.mock.calls[0])).not.toContain("vanished text");
        expect(await droppedCount("company")).toBe(1);
    });

    it("keeps a freeform note, which has no document to gate on", async () => {
        (multiDocEnsembleSearch as jest.Mock).mockResolvedValue([
            { pageContent: "a sticky note", metadata: { source: "note", documentId: null } },
        ]);
        mockQueuedRows = [READABLE_IDS];

        const response = await POST(queryRequest({ question: "what?", searchScope: "company" }));

        expect(response.status).toBe(200);
        expect(promptOf(mockInvoke.mock.calls[0])).toContain("a sticky note");
        expect(await droppedCount("company")).toBe(0);
    });

    it("reads zero, and does no lookup, when nothing is out of scope", async () => {
        (multiDocEnsembleSearch as jest.Mock).mockResolvedValue([
            {
                pageContent: "public text",
                metadata: { page: 1, documentId: 1, category: "Public" },
            },
        ]);
        mockQueuedRows = [READABLE_IDS];

        const response = await POST(queryRequest({ question: "what?", searchScope: "company" }));

        expect(response.status).toBe(200);
        // One query resolved the readable ids; the gate needed none.
        expect(mockWhere).toHaveBeenCalledTimes(1);
        expect(await droppedCount("company")).toBe(0);
    });

    it("answers from everything when the caller may read everything", async () => {
        (requireWorkspaceContext as jest.Mock).mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ role: "owner" }),
        });
        (multiDocEnsembleSearch as jest.Mock).mockResolvedValue([
            {
                pageContent: "secret text",
                metadata: { page: 2, documentId: 2, category: "Secret" },
            },
        ]);
        mockQueuedRows = [[{ id: 2 }]];

        const response = await POST(queryRequest({ question: "what?", searchScope: "company" }));

        expect(response.status).toBe(200);
        expect(promptOf(mockInvoke.mock.calls[0])).toContain("secret text");
        expect(mockWhere).toHaveBeenCalledTimes(1);
    });
});
