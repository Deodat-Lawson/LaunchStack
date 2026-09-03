/**
 * `QuestionSchema` still accepts a `documentId` on company/archive/selected
 * searches, and history logging used to re-read that raw id with no company
 * predicate — attaching the caller's history to a document they were never
 * authorized for. History must now come from the document-scope row that was
 * authorized earlier in the request, or not be written at all.
 */

import { POST } from "~/app/api/agents/documentQ&A/AIChat/query/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { companyEnsembleSearch, documentEnsembleSearch } from "~/server/rag/ensemble";

jest.mock("~/lib/require-workspace-context", () => {
    const actual = jest.requireActual("~/lib/require-workspace-context");
    return { ...actual, requireWorkspaceContext: jest.fn() };
});

let mockQueuedRows: Record<string, unknown>[][] = [];
const mockSelectCount = { value: 0 };
const mockInsertValues = jest.fn();

function mockBuilder() {
    mockSelectCount.value += 1;
    const rows = mockQueuedRows.shift() ?? [];

    const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => resolve(rows),
    };
    for (const method of ["from", "where", "limit", "orderBy"]) {
        builder[method] = () => builder;
    }
    return builder;
}

jest.mock("~/server/db/index", () => ({
    db: {
        select: () => mockBuilder(),
        insert: () => ({
            values: (...args: unknown[]) => {
                mockInsertValues(...args);
                return Promise.resolve(undefined);
            },
        }),
    },
}));

jest.mock("@launchstack/store/schema", () => ({
    document: {
        id: "document.id",
        title: "document.title",
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

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));

jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: { strict: {} },
}));

jest.mock("~/server/metrics/registry", () => ({
    qaRequestCounter: { inc: jest.fn() },
    qaRequestDuration: { startTimer: () => jest.fn() },
}));

const RETRIEVED = [{ pageContent: "chunk text", metadata: { page: 1 } }];

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

jest.mock("~/lib/models", () => ({
    selectChatRoute: () => ({
        route: "default",
        requiredCapabilities: [],
    }),
    resolveConfiguredChatModel: () => ({
        modelId: "gpt-4o-mini",
        chat: {
            invoke: jest.fn().mockResolvedValue({ content: "answer", response_metadata: {} }),
            call: jest.fn().mockResolvedValue({ content: "answer", response_metadata: {} }),
        },
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

// Model/provider tables are still needed by the real request schema.
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

const CTX: WorkspaceContext = {
    authUserId: "user-a",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "owner",
    status: "verified",
};

function queryRequest(body: unknown) {
    return new Request("http://localhost/api/agents/documentQ&A/AIChat/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/agents/documentQ&A/AIChat/query history logging", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockQueuedRows = [];
        mockSelectCount.value = 0;
        (requireWorkspaceContext as jest.Mock).mockResolvedValue({
            success: true,
            data: CTX,
        });
        (documentEnsembleSearch as jest.Mock).mockResolvedValue(RETRIEVED);
        (companyEnsembleSearch as jest.Mock).mockResolvedValue(RETRIEVED);
    });

    it("logs a document-scope query against the authorized row", async () => {
        mockQueuedRows = [[{ id: 42, title: "Owned Report", companyId: BigInt(5) }]];

        const response = await POST(
            queryRequest({
                documentId: 42,
                question: "what is this?",
                searchScope: "document",
            })
        );

        expect(response.status).toBe(200);
        expect(mockInsertValues).toHaveBeenCalledTimes(1);
        expect(mockInsertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: BigInt(42),
                documentTitle: "Owned Report",
                UserId: "user-a",
            })
        );
    });

    it("ignores an extraneous documentId on a company-scope search", async () => {
        const response = await POST(
            queryRequest({
                documentId: 999,
                question: "what is this?",
                searchScope: "company",
            })
        );

        expect(response.status).toBe(200);
        // No document lookup happens on company scope, so the stray id is never
        // read, and nothing is attached to it.
        expect(mockSelectCount.value).toBe(0);
        expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it("allows an admin to run a company-scope search", async () => {
        (requireWorkspaceContext as jest.Mock).mockResolvedValue({
            success: true,
            data: { ...CTX, role: "admin" },
        });

        const response = await POST(
            queryRequest({
                question: "what is this?",
                searchScope: "company",
            })
        );

        expect(response.status).toBe(200);
    });

    it("rejects an editor from company-scope search", async () => {
        (requireWorkspaceContext as jest.Mock).mockResolvedValue({
            success: true,
            data: { ...CTX, role: "editor" },
        });

        const response = await POST(
            queryRequest({
                question: "what is this?",
                searchScope: "company",
            })
        );

        expect(response.status).toBe(403);
        expect(companyEnsembleSearch).not.toHaveBeenCalled();
    });

    it("refuses a document-scope query for another company's document", async () => {
        mockQueuedRows = [[{ id: 42, title: "Foreign Report", companyId: BigInt(9) }]];

        const response = await POST(
            queryRequest({
                documentId: 42,
                question: "what is this?",
                searchScope: "document",
            })
        );

        expect(response.status).toBe(403);
        expect(mockInsertValues).not.toHaveBeenCalled();
    });
});
