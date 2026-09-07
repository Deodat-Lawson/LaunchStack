/**
 * The Q&A route answers from the caller's document scope, not their role.
 *
 * Every member holding `documents.read` may run every search scope. A search
 * is always over a set of document ids: "company" is every id in the
 * caller's scope, "archive" the scope's ids in one archive, "selected" the
 * supplied ids the scope allows — and all three take the one multi-document
 * path. A document outside the scope reads as missing (404, never 403), and
 * history logging only ever attaches to the document authorized in the same
 * request — `QuestionSchema` still accepts a stray `documentId` on
 * company/archive/selected searches.
 */

import { POST } from "~/app/api/agents/documentQ&A/AIChat/query/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import { recordAuthzDenied } from "~/server/metrics/authz";
import { documentEnsembleSearch, multiDocEnsembleSearch } from "~/server/rag/ensemble";

import { makeWorkspaceContext } from "../../../../helpers/workspace-context";

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

jest.mock("~/server/metrics/authz", () => ({
    recordAuthzDenied: jest.fn(),
    recordRetrievalDropped: jest.fn(),
    observeScopeSize: jest.fn(),
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

const FINANCE_HIDDEN: DocumentScope = {
    kind: "except",
    deniedCategories: ["Finance"],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

function useContext(overrides: Parameters<typeof makeWorkspaceContext>[0] = {}) {
    (requireWorkspaceContext as jest.Mock).mockResolvedValue({
        success: true,
        data: makeWorkspaceContext(overrides),
    });
}

function queryRequest(body: unknown) {
    return new Request("http://localhost/api/agents/documentQ&A/AIChat/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/agents/documentQ&A/AIChat/query", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockQueuedRows = [];
        mockSelectCount.value = 0;
        useContext({ role: "owner" });
        (documentEnsembleSearch as jest.Mock).mockResolvedValue(RETRIEVED);
        (multiDocEnsembleSearch as jest.Mock).mockResolvedValue(RETRIEVED);
    });

    describe("history logging", () => {
        it("logs a document-scope query against the authorized row", async () => {
            mockQueuedRows = [[{ id: 42, title: "Owned Report" }]];

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
            mockQueuedRows = [[{ id: 1 }, { id: 2 }]];

            const response = await POST(
                queryRequest({
                    documentId: 999,
                    question: "what is this?",
                    searchScope: "company",
                })
            );

            expect(response.status).toBe(200);
            // The only lookup on company scope resolves the readable ids; the
            // stray id is never read, and nothing is attached to it.
            expect(mockSelectCount.value).toBe(1);
            expect(mockInsertValues).not.toHaveBeenCalled();
        });
    });

    describe("who may search", () => {
        it.each(["admin", "member", "viewer", "editor"])(
            "lets a %s run a company-scope search",
            async role => {
                useContext({ role });
                mockQueuedRows = [[{ id: 1 }]];

                const response = await POST(
                    queryRequest({ question: "what is this?", searchScope: "company" })
                );

                expect(response.status).toBe(200);
                expect(multiDocEnsembleSearch).toHaveBeenCalledTimes(1);
            }
        );

        it("refuses a role without documents.read, and counts the refusal", async () => {
            useContext({ role: "reporting", permissions: ["analytics.view"] });

            const response = await POST(
                queryRequest({ question: "what is this?", searchScope: "company" })
            );

            expect(response.status).toBe(403);
            expect(await response.json()).toEqual({
                error: "Forbidden",
                permission: "documents.read",
            });
            expect(mockSelectCount.value).toBe(0);
            expect(multiDocEnsembleSearch).not.toHaveBeenCalled();
            expect(recordAuthzDenied).toHaveBeenCalledWith(
                "documents.read",
                "agents/documentQ&A/AIChat/query"
            );
        });
    });

    describe("the document scope", () => {
        it("resolves a company-scope search to the readable ids and searches those", async () => {
            useContext({ role: "member", scope: FINANCE_HIDDEN });
            mockQueuedRows = [[{ id: 1 }, { id: 3 }]];

            const response = await POST(
                queryRequest({ question: "what is this?", searchScope: "company" })
            );

            expect(response.status).toBe(200);
            expect(scopedDocumentWhere).toHaveBeenCalledWith(BigInt(5), FINANCE_HIDDEN);
            expect(multiDocEnsembleSearch).toHaveBeenCalledWith(
                "what is this?",
                expect.objectContaining({ documentIds: [1, 3], companyId: 5 }),
                expect.anything()
            );
        });

        it("answers empty when the caller may read no documents at all", async () => {
            useContext({
                role: "guest",
                scope: {
                    kind: "only",
                    allowedCategories: [],
                    deniedDocumentIds: [],
                    allowedDocumentIds: [],
                },
            });
            mockQueuedRows = [[]];

            const response = await POST(
                queryRequest({ question: "what is this?", searchScope: "company" })
            );

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                success: false,
                message: "No relevant content found for the given question.",
            });
            expect(multiDocEnsembleSearch).not.toHaveBeenCalled();
        });

        it("reads a document outside the scope as missing, not forbidden", async () => {
            useContext({ role: "member", scope: FINANCE_HIDDEN });
            // The scoped query matches nothing for a document the caller cannot see.
            mockQueuedRows = [[]];

            const response = await POST(
                queryRequest({
                    documentId: 42,
                    question: "what is this?",
                    searchScope: "document",
                })
            );

            expect(response.status).toBe(404);
            expect(scopedDocumentWhere).toHaveBeenCalledWith(BigInt(5), FINANCE_HIDDEN);
            expect(documentEnsembleSearch).not.toHaveBeenCalled();
            expect(mockInsertValues).not.toHaveBeenCalled();
        });

        it("searches only the selected documents the caller may read", async () => {
            useContext({ role: "member", scope: FINANCE_HIDDEN });
            // Of the two selected ids, the scoped query returns one.
            mockQueuedRows = [[{ id: 1 }]];

            const response = await POST(
                queryRequest({
                    question: "what is this?",
                    searchScope: "selected",
                    selectedDocumentIds: [1, 2],
                })
            );

            expect(response.status).toBe(200);
            expect(multiDocEnsembleSearch).toHaveBeenCalledWith(
                "what is this?",
                expect.objectContaining({ documentIds: [1] }),
                expect.anything()
            );
        });

        it("is a 404 when none of the selected documents are readable", async () => {
            useContext({ role: "member", scope: FINANCE_HIDDEN });
            mockQueuedRows = [[]];

            const response = await POST(
                queryRequest({
                    question: "what is this?",
                    searchScope: "selected",
                    selectedDocumentIds: [1, 2],
                })
            );

            expect(response.status).toBe(404);
            expect(multiDocEnsembleSearch).not.toHaveBeenCalled();
        });

        it("resolves an archive through the scope", async () => {
            useContext({ role: "member", scope: FINANCE_HIDDEN });
            mockQueuedRows = [[{ id: 3 }, { id: 4 }]];

            const response = await POST(
                queryRequest({
                    question: "what is this?",
                    searchScope: "archive",
                    archiveName: "q2.zip",
                })
            );

            expect(response.status).toBe(200);
            expect(scopedDocumentWhere).toHaveBeenCalledWith(BigInt(5), FINANCE_HIDDEN);
            expect(multiDocEnsembleSearch).toHaveBeenCalledWith(
                "what is this?",
                expect.objectContaining({ documentIds: [3, 4] }),
                expect.anything()
            );
        });
    });
});
