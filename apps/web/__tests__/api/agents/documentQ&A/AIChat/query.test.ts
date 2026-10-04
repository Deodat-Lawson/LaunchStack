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
import { resolveConfiguredChatModel } from "~/lib/models";
import { validateQAResponse } from "~/lib/agents/supervisor";
import { debitTokens } from "~/lib/credits";
import { getCompanyEmbeddingConfig } from "@launchstack/llm/embeddings";
import { env } from "~/env";
import { fetchPublicUrl, UrlGuardError } from "~/server/security/url-guard";

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
    for (const method of ["from", "where", "limit", "orderBy", "leftJoin"]) {
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
        url: "document.url",
    },
    fileUploads: { id: "files.id", companyId: "files.companyId", storageUrl: "files.storageUrl" },
    documentVersions: { documentId: "versions.documentId", url: "versions.url" },
}));

jest.mock("~/env", () => ({ env: { server: {}, client: {} } }));
jest.mock("~/server/security/url-guard", () => ({
    ...jest.requireActual("~/server/security/url-guard"),
    fetchPublicUrl: jest.fn((url: string, init: RequestInit) => fetch(url, init)),
}));

jest.mock("~/server/db/schema", () => ({
    ChatHistory: { UserId: "history.userId" },
}));

jest.mock("drizzle-orm", () => ({
    eq: (...args: unknown[]) => ({ op: "eq", args }),
    and: (...args: unknown[]) => ({ op: "and", args }),
    inArray: (...args: unknown[]) => ({ op: "inArray", args }),
    like: (...args: unknown[]) => ({ op: "like", args }),
    or: (...args: unknown[]) => ({ op: "or", args }),
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

const mockInvoke = jest.fn();
const mockStream = jest.fn();
let mockBehavior: Record<string, unknown> = {};
let mockMeteringEnabled = false;
let mockUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
};

jest.mock("~/lib/models", () => ({
    selectChatRoute: ({
        vision,
        reasoning,
        fast,
    }: {
        vision?: boolean;
        reasoning?: boolean;
        fast?: boolean;
    }) => ({
        route: vision ? "vision" : reasoning ? "reasoning" : fast ? "fast" : "default",
        requiredCapabilities: vision ? ["vision"] : reasoning ? ["reasoning"] : [],
    }),
    resolveConfiguredChatModel: jest.fn(() => ({
        modelId: "gpt-4o-mini",
        chat: { invoke: mockInvoke, stream: mockStream },
        behavior: mockBehavior,
        prepareMessages: (messages: unknown) => messages,
    })),
    describeChatResolutionFailure: (error: Error) => ({ status: 400, message: error.message }),
}));

jest.mock("~/server/chat-request-compat", () => ({
    validateDeprecatedChatSelection: () => ({ ok: true }),
}));

jest.mock("@launchstack/llm", () => ({
    isChatRequestError: () => false,
    normalizeTokenUsage: () => mockUsage,
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
    isMeteringEnabled: () => mockMeteringEnabled,
}));

jest.mock("~/lib/agents/supervisor", () => ({
    validateQAResponse: jest.fn(() => ({ approved: true, issues: [] })),
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
            this.content =
                content && typeof content === "object" && "content" in content
                    ? content.content
                    : content;
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
        mockBehavior = {};
        mockMeteringEnabled = false;
        mockUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        mockInvoke.mockReset().mockResolvedValue({ content: "answer", response_metadata: {} });
        mockStream.mockReset();
        (validateQAResponse as jest.Mock).mockReturnValue({ approved: true, issues: [] });
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

function fakeChunk(content: string, reasoning = ""): Record<string, unknown> {
    return {
        content,
        additional_kwargs: { reasoning_content: reasoning },
        response_metadata: {},
        concat(other: { content: string }) {
            return fakeChunk(content + other.content);
        },
    };
}

describe("chat transport and general scope", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockQueuedRows = [];
        useContext({ role: "owner" });
        mockBehavior = {};
        mockMeteringEnabled = false;
        mockUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        mockInvoke.mockReset().mockResolvedValue({ content: "answer", response_metadata: {} });
        mockStream.mockReset();
        (resolveConfiguredChatModel as jest.Mock).mockClear();
        (validateQAResponse as jest.Mock).mockReturnValue({ approved: true, issues: [] });
        (documentEnsembleSearch as jest.Mock).mockResolvedValue(RETRIEVED);
    });

    it("answers general turns without embeddings, document lookups or retrieval", async () => {
        const response = await POST(
            queryRequest({ question: "Write a greeting", searchScope: "none" })
        );
        expect(await response.json()).toMatchObject({
            success: true,
            summarizedAnswer: "answer",
            retrievalMethod: "none",
            chunksAnalyzed: 0,
        });
        expect(documentEnsembleSearch).not.toHaveBeenCalled();
        expect(multiDocEnsembleSearch).not.toHaveBeenCalled();
        expect(getCompanyEmbeddingConfig).not.toHaveBeenCalled();
        expect(mockInsertValues).not.toHaveBeenCalled();
        expect(mockInvoke).toHaveBeenCalledWith(
            expect.any(Array),
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
    });

    it.each([false, true])("omits unreported usage for stream=%p", async stream => {
        mockUsage = {};
        mockBehavior = { parameters: { streaming: "supported" } };
        mockStream.mockImplementation(async function* () {
            yield fakeChunk("answer");
        });
        const response = await POST(queryRequest({ question: "hi", searchScope: "none", stream }));
        expect(response.status).toBe(200);
        if (stream) {
            const events = (await response.text())
                .trim()
                .split("\n")
                .map(line => JSON.parse(line) as Record<string, unknown>);
            const result = events.find(event => event.type === "result");
            expect(result?.response).toMatchObject({ success: true, summarizedAnswer: "answer" });
            expect(result?.response).not.toHaveProperty("tokenUsage");
        } else {
            const result: unknown = await response.json();
            expect(result).toMatchObject({ success: true, summarizedAnswer: "answer" });
            expect(result).not.toHaveProperty("tokenUsage");
        }
    });

    it("still denies general turns without the chat reading permission", async () => {
        useContext({ role: "reporting", permissions: ["analytics.view"] });
        const response = await POST(queryRequest({ question: "hi", searchScope: "none" }));
        expect(response.status).toBe(403);
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("passes allowlisted route and effort to the configured factory and uses planning instructions", async () => {
        const response = await POST(
            queryRequest({
                question: "Plan a launch",
                searchScope: "none",
                modelRoute: "reasoning",
                reasoningEffort: "high",
                chatMode: "plan",
            })
        );
        expect(response.status).toBe(200);
        expect(resolveConfiguredChatModel).toHaveBeenCalledWith(
            expect.objectContaining({
                route: "reasoning",
                reasoningControl: { enabled: true, effort: "high" },
            })
        );
        const [messages] = mockInvoke.mock.calls[0] as [{ content: string }[]];
        expect(messages[0]?.content).toContain("PLAN MODE");
    });

    it("keeps an explicit fast model when thinking is requested and requires reasoning on that model", async () => {
        await POST(
            queryRequest({
                question: "hi",
                searchScope: "none",
                modelRoute: "fast",
                thinkingMode: true,
            })
        );
        expect(resolveConfiguredChatModel).toHaveBeenCalledWith(
            expect.objectContaining({
                route: "fast",
                requiredCapabilities: expect.arrayContaining(["reasoning"]),
                reasoningControl: { enabled: true, effort: undefined },
            })
        );
    });

    it("rejects unknown model routes and oversized prompts before model resolution", async () => {
        for (const body of [{ modelRoute: "custom" }, { question: "x".repeat(120_001) }]) {
            const response = await POST(
                queryRequest({ question: "hi", searchScope: "none", ...body })
            );
            expect(response.status).toBe(400);
        }
        expect(resolveConfiguredChatModel).not.toHaveBeenCalled();
    });

    it("rejects expanded history or retrieved context over the real provider input limit before invoking", async () => {
        let response = await POST(
            queryRequest({
                question: "x".repeat(90_000),
                conversationHistory: "h".repeat(40_000),
                searchScope: "none",
            })
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            success: false,
            message: expect.stringContaining("expanded chat input"),
        });
        mockQueuedRows = [[{ id: 42, title: "Owned Report" }]];
        (documentEnsembleSearch as jest.Mock).mockResolvedValue([
            { pageContent: "c".repeat(100_000), metadata: { page: 1 } },
        ]);
        response = await POST(
            queryRequest({
                question: "x".repeat(25_000),
                documentId: 42,
                searchScope: "document",
                stream: true,
            })
        );
        expect(response.status).toBe(400);
        expect(mockInvoke).not.toHaveBeenCalled();
        expect(mockStream).not.toHaveBeenCalled();
        expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it("uses ordinary JSON when streaming is unsupported", async () => {
        const response = await POST(
            queryRequest({ question: "hi", searchScope: "none", stream: true })
        );
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toMatchObject({ success: true });
        expect(mockStream).not.toHaveBeenCalled();
    });

    it("streams real chunks, then applies supervision, usage and authorized history", async () => {
        mockBehavior = { parameters: { streaming: "supported" } };
        mockMeteringEnabled = true;
        mockUsage = { inputTokens: 11, outputTokens: 7, totalTokens: 18 };
        mockQueuedRows = [[{ id: 42, title: "Owned Report" }]];
        mockStream.mockImplementation(async function* () {
            yield fakeChunk("Hel", "Checking the source");
            yield fakeChunk("lo");
        });
        (validateQAResponse as jest.Mock).mockReturnValue({
            approved: true,
            issues: [],
            adjustedOutput: "Hello, verified",
        });
        const response = await POST(
            queryRequest({ question: "hi", documentId: 42, searchScope: "document", stream: true })
        );
        expect(response.headers.get("content-type")).toContain("application/x-ndjson");
        const events = (await response.text())
            .trim()
            .split("\n")
            .map(line => JSON.parse(line) as Record<string, unknown>);
        expect(events).toEqual(
            expect.arrayContaining([
                { type: "text", delta: "Hel" },
                { type: "text", delta: "lo" },
                { type: "reasoning", delta: "Checking the source" },
            ])
        );
        expect(events.at(-1)).toMatchObject({
            type: "result",
            response: {
                success: true,
                summarizedAnswer: "Hello, verified",
                tokenUsage: { totalTokens: 18 },
            },
        });
        expect(mockInvoke).not.toHaveBeenCalled();
        expect(mockInsertValues).toHaveBeenCalledWith(
            expect.objectContaining({ response: "Hello, verified" })
        );
        expect(debitTokens).toHaveBeenCalledTimes(1);
        expect(mockStream).toHaveBeenCalledWith(
            expect.any(Array),
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
    });

    it("extracts only actual reasoning strings from raw provider chunks and never exposes the opaque payload", async () => {
        mockBehavior = { parameters: { streaming: "supported" } };
        mockStream.mockImplementation(async function* () {
            const chunk = fakeChunk("Answer");
            chunk.additional_kwargs = {
                __raw_response: {
                    secretField: "must-stay-server-side",
                    choices: [{ delta: { reasoning_content: "Checking facts" } }],
                },
            };
            yield chunk;
        });
        const response = await POST(
            queryRequest({ question: "hi", searchScope: "none", stream: true })
        );
        const text = await response.text();
        expect(text).toContain('{"type":"reasoning","delta":"Checking facts"}');
        expect(text).not.toContain("must-stay-server-side");
        expect(text).not.toContain("__raw_response");
    });

    it("emits an error event for a provider stream failure without saving a final answer", async () => {
        mockBehavior = { parameters: { streaming: "supported" } };
        mockStream.mockImplementation(async function* () {
            yield fakeChunk("Partial");
            throw new Error("Provider unavailable");
        });
        const response = await POST(
            queryRequest({ question: "hi", searchScope: "none", stream: true })
        );
        const text = await response.text();
        expect(text).toContain('"type":"error"');
        expect(text).toContain("Provider unavailable");
        expect(text).not.toContain('"type":"result"');
        expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it("aborts the provider when the response reader is cancelled and suppresses saves", async () => {
        mockBehavior = { parameters: { streaming: "supported" } };
        mockQueuedRows = [[{ id: 42, title: "Owned Report" }]];
        let providerSignal: AbortSignal | undefined;
        let release: (() => void) | undefined;
        mockStream.mockImplementation(async function* (
            _messages: unknown,
            options: { signal: AbortSignal }
        ) {
            providerSignal = options.signal;
            yield fakeChunk("Partial");
            await new Promise<void>(resolve => {
                release = resolve;
            });
            yield fakeChunk(" answer");
        });
        const response = await POST(
            queryRequest({ question: "hi", documentId: 42, searchScope: "document", stream: true })
        );
        const reader = response.body!.getReader();
        await reader.read();
        await reader.read();
        await reader.cancel();
        expect(providerSignal?.aborted).toBe(true);
        release?.();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockInsertValues).not.toHaveBeenCalled();
        expect(validateQAResponse).not.toHaveBeenCalled();
    });

    it("propagates request cancellation to attachment fetch and skips the model", async () => {
        const controller = new AbortController();
        const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
            expect(init?.signal).toBe(controller.signal);
            controller.abort();
            throw new DOMException("Aborted", "AbortError");
        });
        try {
            const request = new Request("http://localhost/api/chat", {
                method: "POST",
                signal: controller.signal,
                body: JSON.stringify({
                    question: "hi",
                    searchScope: "none",
                    attachments: [
                        {
                            name: "note.txt",
                            kind: "text",
                            mimeType: "text/plain",
                            url: "https://example.com/note.txt",
                        },
                    ],
                }),
            });
            // Request wraps the supplied signal; fetch must get that exact wrapped signal.
            fetchSpy.mockImplementation(async (_url, init) => {
                expect(init?.signal).toBe(request.signal);
                controller.abort();
                throw new DOMException("Aborted", "AbortError");
            });
            const response = await POST(request);
            expect(response.status).toBe(499);
            expect(mockInvoke).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });
});

describe("chat attachment limits and ownership", () => {
    let fetchSpy: jest.SpyInstance;
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const attachment = {
        name: "image.png",
        mimeType: "image/png",
        kind: "image",
        url: "https://example.com/image.png",
    };
    beforeEach(() => {
        jest.clearAllMocks();
        mockQueuedRows = [];
        useContext({ role: "owner" });
        mockBehavior = { image: { mimeTypes: ["image/png"], maxImages: 100 } };
        mockInvoke.mockReset().mockResolvedValue({ content: "answer", response_metadata: {} });
        for (const key of Object.keys(env.server))
            delete (env.server as Record<string, unknown>)[key];
        (fetchPublicUrl as jest.Mock).mockImplementation((url: string, init: RequestInit) =>
            fetch(url, init)
        );
        fetchSpy = jest
            .spyOn(global, "fetch")
            .mockImplementation(
                async () => new Response(pngBytes, { headers: { "content-type": "image/png" } })
            );
    });
    afterEach(() => fetchSpy.mockRestore());

    it("sends verified image bytes as a data URL rather than an unchecked remote URL", async () => {
        const response = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [attachment] })
        );
        expect(response.status).toBe(200);
        expect(fetchPublicUrl).toHaveBeenCalledWith(
            attachment.url,
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        const [messages] = mockInvoke.mock.calls[0] as [
            { content: { type: string; image_url?: { url: string } }[] }[],
        ];
        expect(messages[1]?.content[1]).toMatchObject({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}` },
        });
    });

    it("keeps an explicitly selected model for images and validates vision on that route", async () => {
        const response = await POST(
            queryRequest({
                question: "Review",
                searchScope: "none",
                modelRoute: "fast",
                attachments: [attachment],
            })
        );
        expect(response.status).toBe(200);
        expect(resolveConfiguredChatModel).toHaveBeenCalledWith(
            expect.objectContaining({
                route: "fast",
                requiredCapabilities: expect.arrayContaining(["vision"]),
            })
        );
    });

    it("honors configured image count before fetching", async () => {
        mockBehavior = { image: { maxImages: 1 } };
        const response = await POST(
            queryRequest({
                question: "Review",
                searchScope: "none",
                attachments: [attachment, attachment],
            })
        );
        expect(response.status).toBe(400);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("rejects mismatched image headers and actual model MIME limits", async () => {
        fetchSpy.mockResolvedValueOnce(
            new Response(pngBytes, { headers: { "content-type": "image/jpeg" } })
        );
        let response = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [attachment] })
        );
        expect(response.status).toBe(400);
        mockBehavior = { image: { mimeTypes: ["image/jpeg"] } };
        response = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [attachment] })
        );
        expect(response.status).toBe(400);
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("rejects oversized image and text downloads by announced and actual bytes", async () => {
        fetchSpy.mockResolvedValueOnce(
            new Response("", {
                headers: {
                    "content-type": "image/png",
                    "content-length": String(10 * 1024 * 1024 + 1),
                },
            })
        );
        let response = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [attachment] })
        );
        expect(response.status).toBe(400);
        fetchSpy.mockResolvedValueOnce(
            new Response("", {
                headers: {
                    "content-type": "text/plain",
                    "content-length": String(50 * 1024 * 1024 + 1),
                },
            })
        );
        response = await POST(
            queryRequest({
                question: "Review",
                searchScope: "none",
                attachments: [
                    { ...attachment, kind: "text", name: "note.txt", mimeType: "text/plain" },
                ],
            })
        );
        expect(response.status).toBe(400);
        fetchSpy.mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
                        controller.close();
                    },
                }),
                { headers: { "content-type": "image/png" } }
            )
        );
        response = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [attachment] })
        );
        expect(response.status).toBe(400);
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("fails before invoking for an unavailable text attachment", async () => {
        fetchSpy.mockResolvedValueOnce(new Response("Missing", { status: 404 }));
        const response = await POST(
            queryRequest({
                question: "Review",
                searchScope: "none",
                attachments: [
                    { ...attachment, kind: "text", name: "missing.txt", mimeType: "text/plain" },
                ],
            })
        );
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({
            success: false,
            message: expect.stringContaining('Attachment "missing.txt" is unavailable'),
        });
        expect(mockInvoke).not.toHaveBeenCalled();
        expect(mockStream).not.toHaveBeenCalled();
        expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it("fails before streaming for an invalid DOCX rather than answering without its content", async () => {
        mockBehavior = { parameters: { streaming: "supported" } };
        const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        fetchSpy.mockResolvedValueOnce(
            new Response("This is not a DOCX zip archive", {
                headers: { "content-type": mimeType },
            })
        );
        const response = await POST(
            queryRequest({
                question: "Review",
                searchScope: "none",
                stream: true,
                attachments: [{ ...attachment, kind: "text", name: "broken.docx", mimeType }],
            })
        );
        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toMatchObject({
            success: false,
            message: expect.stringContaining('Attachment "broken.docx" could not be read'),
        });
        expect(mockInvoke).not.toHaveBeenCalled();
        expect(mockStream).not.toHaveBeenCalled();
        expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it("enforces cumulative image bytes even when each file fits", async () => {
        fetchSpy.mockImplementation(async () => {
            const content = new Uint8Array(10 * 1024 * 1024);
            content.set(pngBytes);
            return new Response(content, { headers: { "content-type": "image/png" } });
        });
        const response = await POST(
            queryRequest({
                question: "Review",
                searchScope: "none",
                attachments: Array.from({ length: 9 }, () => attachment),
            })
        );
        expect(response.status).toBe(400);
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("truncates text by real UTF-8 bytes with an honest notice", async () => {
        fetchSpy.mockResolvedValue(
            new Response("é".repeat(20_000), { headers: { "content-type": "text/plain" } })
        );
        const response = await POST(
            queryRequest({
                question: "Review",
                searchScope: "none",
                attachments: [
                    { ...attachment, kind: "text", name: "note.txt", mimeType: "text/plain" },
                ],
            })
        );
        expect(response.status).toBe(200);
        const [messages] = mockInvoke.mock.calls[0] as [{ content: string }[]];
        const prompt = messages[1]!.content;
        expect(prompt).toContain("[…attachment truncated]");
        expect((prompt.match(/é/g) ?? []).length).toBe(15_000);
    });

    it("counts expanded attachment text in the provider input limit", async () => {
        fetchSpy.mockResolvedValue(
            new Response("a".repeat(30_000), { headers: { "content-type": "text/plain" } })
        );
        const response = await POST(
            queryRequest({
                question: "x".repeat(100_000),
                searchScope: "none",
                attachments: [
                    { ...attachment, kind: "text", name: "note.txt", mimeType: "text/plain" },
                ],
            })
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            message: expect.stringContaining("expanded chat input"),
        });
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("permits only recorded workspace files under the configured private storage bucket", async () => {
        Object.assign(env.server, {
            NEXT_PUBLIC_S3_ENDPOINT: "http://127.0.0.1:8333",
            S3_BUCKET_NAME: "files",
        });
        const own = { ...attachment, url: "http://127.0.0.1:8333/files/documents/owned.png" };
        mockQueuedRows = [[{ companyId: BigInt(5), storageUrl: own.url }], []];
        const response = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [own] })
        );
        expect(response.status).toBe(200);
        expect(fetchPublicUrl).not.toHaveBeenCalled();
        expect(fetchSpy).toHaveBeenCalledWith(
            own.url,
            expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) })
        );
        mockQueuedRows = [[], []];
        const denied = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [own] })
        );
        expect(denied.status).toBe(404);
    });

    it("does not treat a lookalike storage origin or different bucket as trusted", async () => {
        Object.assign(env.server, {
            NEXT_PUBLIC_S3_ENDPOINT: "http://127.0.0.1:8333",
            S3_BUCKET_NAME: "files",
        });
        (fetchPublicUrl as jest.Mock).mockRejectedValue(
            new UrlGuardError("URL resolves to a private or internal address")
        );
        for (const url of [
            "http://127.0.0.1:8333/other/documents/a.png",
            "http://127.0.0.1:8334/files/documents/a.png",
        ]) {
            const response = await POST(
                queryRequest({
                    question: "Review",
                    searchScope: "none",
                    attachments: [{ ...attachment, url }],
                })
            );
            expect(response.status).toBe(400);
        }
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a scoped source attached to a general turn before fetching its bytes", async () => {
        useContext({ scope: FINANCE_HIDDEN });
        Object.assign(env.server, {
            NEXT_PUBLIC_S3_ENDPOINT: "http://127.0.0.1:8333",
            S3_BUCKET_NAME: "files",
        });
        const hidden = { ...attachment, url: "http://127.0.0.1:8333/files/documents/hidden.png" };
        mockQueuedRows = [
            [{ companyId: BigInt(5), storageUrl: hidden.url }],
            [{ id: 42, category: "Finance", companyId: BigInt(5) }],
        ];
        const response = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [hidden] })
        );
        expect(response.status).toBe(404);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("reads internal database files using tenant metadata and source scope without an unsigned HTTP fetch", async () => {
        const internal = { ...attachment, url: "http://localhost/api/files/12" };
        mockQueuedRows = [
            [
                {
                    companyId: BigInt(5),
                    storageProvider: "database",
                    mimeType: "image/png",
                    fileData: Buffer.from(pngBytes).toString("base64"),
                },
            ],
            [],
        ];
        const response = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [internal] })
        );
        expect(response.status).toBe(200);
        expect(fetchSpy).not.toHaveBeenCalled();
        mockQueuedRows = [
            [
                {
                    companyId: BigInt(6),
                    storageProvider: "database",
                    mimeType: "image/png",
                    fileData: Buffer.from(pngBytes).toString("base64"),
                },
            ],
        ];
        const denied = await POST(
            queryRequest({ question: "Review", searchScope: "none", attachments: [internal] })
        );
        expect(denied.status).toBe(404);
    });
});
