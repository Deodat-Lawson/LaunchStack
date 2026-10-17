/**
 * The MCP tools against a fake database and a fake retriever: who sees which
 * tool, what each returns, how search groups passages into documents and
 * keeps notes, company facts and unreadable documents out, and how
 * save_conversation turns the service's outcomes into words for the model.
 *
 * Scope is enforced in SQL, which a fake database cannot check; the
 * integration suite next door runs the same tools against Postgres.
 */
import type { Permission } from "~/lib/authz/permissions";
import type { DocumentScope } from "~/lib/authz/scope-types";
import type { McpPrincipal } from "~/server/mcp/principal";
import { handleMcpPost, type McpToolOutcome } from "~/server/mcp/protocol";
import { MCP_TOOLS } from "~/server/mcp/tools";
import { FETCH_MAX_CHARS, fetchTool, joinChunkText } from "~/server/mcp/tools/fetch";
import {
    decodeListCursor,
    encodeListCursor,
    listSourcesTool,
} from "~/server/mcp/tools/list-sources";
import { saveConversationTool } from "~/server/mcp/tools/save-conversation";
import { searchTool } from "~/server/mcp/tools/search";
import { documentNotFound } from "~/server/mcp/tools/shared";
import { snippetFor } from "~/server/mcp/workspace-search";
import { ConversationSaveError, saveAssistantConversation } from "~/server/assistant-conversations";
import { multiDocEnsembleSearch } from "~/server/rag/ensemble";
import { gateChunksByScope } from "~/server/rag/gate";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

// --- fakes ------------------------------------------------------------------

let mockQueuedRows: unknown[][] = [];
const mockSelects = jest.fn();

function mockBuilder() {
    const rows = mockQueuedRows.shift() ?? [];
    const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve, reject),
    };
    for (const method of ["from", "where", "limit", "orderBy", "groupBy", "innerJoin"]) {
        builder[method] = () => builder;
    }
    return builder;
}

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => {
            mockSelects(...args);
            return mockBuilder();
        },
    },
}));

jest.mock("~/server/rag/ensemble", () => ({ multiDocEnsembleSearch: jest.fn() }));
jest.mock("~/server/rag/gate", () => ({
    gateChunksByScope: jest.fn(async (chunks: unknown[]) => chunks),
}));
jest.mock("~/lib/models", () => ({ getEmbeddings: jest.fn(() => ({ embedQuery: jest.fn() })) }));
jest.mock("@launchstack/llm/embeddings", () => ({
    getCompanyEmbeddingConfig: jest.fn().mockResolvedValue(null),
    resolveEmbeddingIndex: () => ({ indexKey: "default" }),
}));
jest.mock("~/server/assistant-conversations", () => {
    class ConversationSaveError extends Error {
        readonly code: string;
        constructor(errorCode: string, message: string) {
            super(message);
            this.code = errorCode;
            this.name = "ConversationSaveError";
        }
    }
    return { ConversationSaveError, saveAssistantConversation: jest.fn() };
});

const ORIGIN = "https://launchstack.test";
const search = multiDocEnsembleSearch as jest.MockedFunction<typeof multiDocEnsembleSearch>;
const save = saveAssistantConversation as jest.MockedFunction<typeof saveAssistantConversation>;

function principal(
    options: {
        scopes?: string[];
        role?: string;
        permissions?: Permission[];
        scope?: DocumentScope;
    } = {}
): McpPrincipal {
    return {
        ctx: makeWorkspaceContext({
            role: options.role ?? "member",
            permissions: options.permissions,
            scope: options.scope,
            companyId: BigInt(50),
        }),
        scopes: new Set(options.scopes ?? ["launchstack:read", "launchstack:write"]),
        credential: { kind: "key", keyId: 3 },
        label: "Claude Code",
        family: "claude",
        rateLimitKey: "mcp:user-a:50",
    };
}

function run(tool: typeof searchTool, args: unknown, who = principal()) {
    return tool.call(args, { principal: who, origin: ORIGIN });
}

function okOf(outcome: McpToolOutcome) {
    if (!outcome.ok) throw new Error(`expected success, got: ${outcome.message}`);
    return outcome;
}

function messageOf(outcome: McpToolOutcome): string {
    if (outcome.ok) throw new Error(`expected an error, got: ${outcome.text}`);
    return outcome.message;
}

beforeEach(() => {
    mockQueuedRows = [];
    mockSelects.mockClear();
    search.mockReset();
    save.mockReset();
    (gateChunksByScope as jest.Mock).mockClear();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

// --- registry ---------------------------------------------------------------

describe("the tool registry", () => {
    async function listed(who: McpPrincipal) {
        const answer = await handleMcpPost(
            {
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
                accept: null,
                protocolVersion: "2025-06-18",
            },
            { principal: who, origin: ORIGIN, tools: MCP_TOOLS, instructions: "" }
        );
        const body = answer.body as { result: { tools: Record<string, unknown>[] } };
        return body.result.tools;
    }

    it("offers search, fetch, list_sources and save_conversation", () => {
        expect(MCP_TOOLS.map(tool => tool.name)).toEqual([
            "search",
            "fetch",
            "list_sources",
            "save_conversation",
        ]);
    });

    it("lists the read tools to a read-only key and all four to a read-write key of a member", async () => {
        expect(
            (await listed(principal({ scopes: ["launchstack:read"] }))).map(t => t.name)
        ).toEqual(["search", "fetch", "list_sources"]);
        expect((await listed(principal())).map(t => t.name)).toEqual([
            "search",
            "fetch",
            "list_sources",
            "save_conversation",
        ]);
    });

    it("keeps save_conversation from a read-write key whose person cannot upload", async () => {
        expect((await listed(principal({ role: "viewer" }))).map(t => t.name)).toEqual([
            "search",
            "fetch",
            "list_sources",
        ]);
    });

    it("gives every tool closed object schemas, an output schema and honest annotations", async () => {
        for (const tool of await listed(principal())) {
            const input = tool.inputSchema as {
                type: string;
                properties: Record<string, unknown>;
                required?: string[];
                additionalProperties?: boolean;
            };
            expect(input.type).toBe("object");
            expect(input.additionalProperties).toBe(false);
            for (const key of input.required ?? []) expect(input.properties).toHaveProperty(key);
            expect(JSON.stringify(input)).not.toMatch(/\$ref|\$schema|anyOf|oneOf/);
            expect(tool.outputSchema).toMatchObject({ type: "object" });
            expect(typeof tool.title).toBe("string");
            expect((tool.description as string).length).toBeGreaterThan(80);
            const annotations = tool.annotations as Record<string, boolean>;
            expect(annotations.destructiveHint).toBe(false);
            expect(annotations.openWorldHint).toBe(false);
            expect(annotations.readOnlyHint).toBe(tool.name !== "save_conversation");
        }
    });
});

// --- search -----------------------------------------------------------------

function chunk(documentId: number | string, content: string, extra: Record<string, unknown> = {}) {
    return {
        pageContent: content,
        metadata: { documentId, source: "vector_ann", searchScope: "multi-document", ...extra },
    };
}

describe("search", () => {
    const readable = [
        { id: 1, title: "Launch plan", category: "Team" },
        { id: 2, title: "Pricing tiers", category: "Q4 planning/Pricing" },
    ];

    it("groups passages by document, best first, three snippets each, with links", async () => {
        mockQueuedRows.push(readable);
        search.mockResolvedValue([
            chunk(1, "Alpha passage", { page: 2 }),
            chunk(2, "Pricing passage"),
            chunk(1, "Beta passage", { page: 5 }),
            chunk(1, "Gamma passage"),
            chunk(1, "Delta passage"),
        ] as never);

        const outcome = okOf(await run(searchTool, { query: "launch pricing" }));
        const expected = {
            results: [
                {
                    id: "1",
                    title: "Launch plan",
                    url: `${ORIGIN}/employer/documents?source=d1`,
                    text: "Alpha passage … Beta passage … Gamma passage",
                    page: 2,
                    folder: "Team",
                },
                {
                    id: "2",
                    title: "Pricing tiers",
                    url: `${ORIGIN}/employer/documents?source=d2`,
                    text: "Pricing passage",
                    folder: "Q4 planning/Pricing",
                },
            ],
        };
        expect(outcome.structured).toEqual(expected);
        expect(JSON.parse(outcome.text)).toEqual(expected);
    });

    it("searches only the readable ids and gates what comes back by the person's scope", async () => {
        const scope: DocumentScope = {
            kind: "except",
            deniedCategories: ["Board"],
            deniedDocumentIds: [9],
            allowedDocumentIds: [],
        };
        mockQueuedRows.push(readable);
        search.mockResolvedValue([] as never);
        await run(searchTool, { query: "plan", limit: 3 }, principal({ scope }));

        expect(search).toHaveBeenCalledWith(
            "plan",
            expect.objectContaining({ documentIds: [1, 2], companyId: 50 }),
            expect.anything()
        );
        expect(gateChunksByScope).toHaveBeenCalledWith([], {
            companyId: BigInt(50),
            scope,
            searchScope: "mcp",
        });
    });

    it("drops notes, company facts and anything outside the readable set", async () => {
        mockQueuedRows.push(readable);
        search.mockResolvedValue([
            chunk("1", "A colleague's private note", { source: "note" }),
            chunk(2, "A company fact", { source: "company_fact" }),
            chunk(99, "Someone else's document"),
            chunk(null as never, "A freeform note"),
            chunk(2, "The real passage", { source: "vector_ann" }),
        ] as never);

        const outcome = okOf(await run(searchTool, { query: "anything" }));
        expect(outcome.structured).toEqual({
            results: [expect.objectContaining({ id: "2", text: "The real passage" })],
        });
    });

    it("drops the lexical leg's zero-score padding but keeps its matches and every vector hit", async () => {
        mockQueuedRows.push(readable);
        search.mockResolvedValue([
            chunk(1, "Nothing in common here", { source: "bm25" }),
            chunk(1, "The Pricing review", { source: "bm25" }),
            chunk(2, "Semantically close, lexically not", { source: "vector_ann" }),
        ] as never);
        const outcome = okOf(await run(searchTool, { query: "pricing?" }));
        expect(outcome.structured).toEqual({
            results: [
                expect.objectContaining({ id: "1", text: "The Pricing review" }),
                expect.objectContaining({ id: "2", text: "Semantically close, lexically not" }),
            ],
        });
    });

    it("returns at most `limit` documents", async () => {
        mockQueuedRows.push(readable);
        search.mockResolvedValue([chunk(2, "two"), chunk(1, "one")] as never);
        const outcome = okOf(await run(searchTool, { query: "x", limit: 1 }));
        expect((outcome.structured.results as { id: string }[]).map(r => r.id)).toEqual(["2"]);
    });

    it("answers an empty index or no hits with an empty result list, not an error", async () => {
        mockQueuedRows.push([]);
        const empty = okOf(await run(searchTool, { query: "x" }));
        expect(empty.structured).toEqual({ results: [] });
        expect(empty.text).toBe('{"results":[]}');
        expect(search).not.toHaveBeenCalled();

        mockQueuedRows.push(readable);
        search.mockResolvedValue([] as never);
        expect(okOf(await run(searchTool, { query: "x" })).structured).toEqual({ results: [] });
    });

    it("rejects an empty or oversized query and an out-of-range limit", async () => {
        expect(messageOf(await run(searchTool, { query: "   " }))).toContain("query");
        expect(messageOf(await run(searchTool, { query: "x".repeat(1001) }))).toContain("query");
        expect(messageOf(await run(searchTool, { query: "x", limit: 21 }))).toContain("limit");
        expect(messageOf(await run(searchTool, {}))).toContain("query: Required");
        expect(search).not.toHaveBeenCalled();
    });

    it("takes a numeric-string limit", async () => {
        mockQueuedRows.push(readable);
        search.mockResolvedValue([chunk(1, "one"), chunk(2, "two")] as never);
        const outcome = okOf(await run(searchTool, { query: "x", limit: "1" }));
        expect(outcome.structured.results).toHaveLength(1);
    });

    it("cuts long passages to a window around the query", () => {
        const text = `${"lorem ipsum ".repeat(100)}the pricing decision was final ${"dolor ".repeat(100)}`;
        const snippet = snippetFor(text, "pricing decision");
        expect(snippet.length).toBeLessThanOrEqual(322);
        expect(snippet).toContain("pricing decision");
        expect(snippet.startsWith("…")).toBe(true);
        expect(snippetFor("  short\n\ntext ", "x")).toBe("short text");
    });
});

// --- fetch ------------------------------------------------------------------

describe("fetch", () => {
    const created = new Date("2026-10-01T10:00:00.000Z");
    const row = {
        id: 7,
        title: "Launch plan",
        category: "Team",
        currentVersionId: BigInt(3),
        mimeType: "text/markdown",
        createdAt: created,
        updatedAt: null,
    };

    it("returns the current version's text in order, with link and metadata", async () => {
        mockQueuedRows.push([row], [{ content: "# Plan\n" }, { content: "  Ship it.  " }]);
        const outcome = okOf(await run(fetchTool, { id: "7" }));
        const expected = {
            id: "7",
            title: "Launch plan",
            text: "# Plan\n\nShip it.",
            url: `${ORIGIN}/employer/documents?source=d7`,
            metadata: {
                folder: "Team",
                createdAt: created.toISOString(),
                updatedAt: created.toISOString(),
                truncated: false,
                characters: 16,
                indexed: true,
                mimeType: "text/markdown",
            },
        };
        expect(outcome.structured).toEqual(expected);
        expect(JSON.parse(outcome.text)).toEqual(expected);
    });

    it("accepts the app's d<id> form and a bare number", async () => {
        mockQueuedRows.push([row], [], [row], []);
        expect(okOf(await run(fetchTool, { id: "d7" })).structured.id).toBe("7");
        expect(okOf(await run(fetchTool, { id: 7 })).structured.id).toBe("7");
    });

    it("says the same thing for a missing id, an unreadable id and a malformed one", async () => {
        // The scoped lookup returns nothing for both a missing and an unreadable
        // document; the integration suite proves the two cases against Postgres.
        mockQueuedRows.push([]);
        const missing = messageOf(await run(fetchTool, { id: "12345" }));
        expect(missing).toBe(documentNotFound("12345"));
        expect(missing).not.toMatch(/permission|access|restricted|private/i);

        const selectsBefore = mockSelects.mock.calls.length;
        expect(messageOf(await run(fetchTool, { id: "not-an-id" }))).toBe(
            documentNotFound("not-an-id")
        );
        expect(mockSelects.mock.calls.length).toBe(selectsBefore);
    });

    it("has no text for a document without a current version, and does not read old chunks", async () => {
        mockQueuedRows.push([{ ...row, currentVersionId: null }]);
        const outcome = okOf(await run(fetchTool, { id: "7" }));
        expect(outcome.structured).toMatchObject({
            text: "",
            metadata: { indexed: false, characters: 0, truncated: false },
        });
        expect(mockSelects).toHaveBeenCalledTimes(1);
    });

    it(`cuts the text at ${FETCH_MAX_CHARS} characters and says so`, () => {
        const parts = ["a".repeat(120_000), "b".repeat(120_000)];
        const joined = joinChunkText(parts);
        expect(joined.truncated).toBe(true);
        expect(joined.text).toHaveLength(FETCH_MAX_CHARS);
        expect(joined.characters).toBe(240_002);
        expect(joinChunkText(["x"]).truncated).toBe(false);
    });
});

// --- list_sources -----------------------------------------------------------

describe("list_sources", () => {
    const at = (iso: string) => new Date(iso);

    it("lists folders with counts and documents newest first, with a cursor for more", async () => {
        mockQueuedRows.push(
            [
                { path: "Team", count: 2 },
                { path: "Unfiled", count: 1 },
            ],
            [
                {
                    id: 9,
                    title: "Newest",
                    category: "Team",
                    createdAt: at("2026-10-01T00:00:00Z"),
                    updatedAt: at("2026-10-12T08:00:00Z"),
                    sortKey: "2026-10-12 08:00:00.123456+00",
                },
                {
                    id: 4,
                    title: "Older",
                    category: "Unfiled",
                    createdAt: at("2026-09-01T00:00:00Z"),
                    updatedAt: null,
                    sortKey: "2026-09-01 00:00:00+00",
                },
                {
                    id: 3,
                    title: "Beyond the page",
                    category: "Team",
                    createdAt: at("2026-08-01T00:00:00Z"),
                    updatedAt: null,
                    sortKey: "2026-08-01 00:00:00+00",
                },
            ]
        );
        const outcome = okOf(await run(listSourcesTool, { limit: 2 }));
        expect(outcome.structured).toEqual({
            folders: [
                { path: "Team", documentCount: 2 },
                { path: "Unfiled", documentCount: 1 },
            ],
            documents: [
                {
                    id: "9",
                    title: "Newest",
                    folder: "Team",
                    url: `${ORIGIN}/employer/documents?source=d9`,
                    updatedAt: "2026-10-12T08:00:00.000Z",
                },
                {
                    id: "4",
                    title: "Older",
                    folder: "Unfiled",
                    url: `${ORIGIN}/employer/documents?source=d4`,
                    updatedAt: "2026-09-01T00:00:00.000Z",
                },
            ],
            nextCursor: expect.any(String),
        });
        expect(decodeListCursor(outcome.structured.nextCursor as string)).toEqual({
            at: "2026-09-01 00:00:00+00",
            id: 4,
        });
    });

    it("leaves nextCursor out on the last page", async () => {
        mockQueuedRows.push([], []);
        const outcome = okOf(await run(listSourcesTool, {}));
        expect(outcome.structured).toEqual({ folders: [], documents: [] });
    });

    it("refuses a cursor it did not issue", async () => {
        for (const cursor of ["garbage", encodeListCursor({ at: "yesterday", id: 1 })]) {
            expect(messageOf(await run(listSourcesTool, { cursor }))).toContain("cursor");
        }
        expect(mockSelects).not.toHaveBeenCalled();
    });

    it("round-trips a cursor and rejects tampered ones", () => {
        const cursor = { at: "2026-10-12 08:00:00.123456+00", id: 12 };
        expect(decodeListCursor(encodeListCursor(cursor))).toEqual(cursor);
        expect(
            decodeListCursor(
                Buffer.from('{"at":"2026-10-12 08:00:00+00","id":-1}').toString("base64url")
            )
        ).toBeNull();
        expect(
            decodeListCursor(
                Buffer.from('{"at":"2026-10-12\'; drop table x;--","id":1}').toString("base64url")
            )
        ).toBeNull();
    });

    it("rejects a limit above 100", async () => {
        expect(messageOf(await run(listSourcesTool, { limit: 101 }))).toContain("limit");
    });
});

// --- save_conversation ------------------------------------------------------

describe("save_conversation", () => {
    const transcript = {
        title: "Pricing call prep",
        messages: [
            { role: "user", content: "What did we decide on pricing?" },
            { role: "assistant", content: "Three tiers.", timestamp: "2026-10-16T10:00:00Z" },
        ],
    };

    it("hands the conversation to the service and tells the model how to update it next time", async () => {
        save.mockResolvedValue({
            conversationId: 41,
            status: "created",
            title: "Pricing call prep",
            url: `${ORIGIN}/employer/documents?source=d41`,
            followUp: "queued",
        });
        const who = principal();
        const outcome = okOf(
            await run(
                saveConversationTool,
                { ...transcript, assistant: "claude", model: "opus" },
                who
            )
        );

        expect(save).toHaveBeenCalledWith({
            ...transcript,
            assistant: "claude",
            model: "opus",
            principal: who,
            origin: ORIGIN,
        });
        expect(outcome.structured).toEqual({
            conversationId: 41,
            status: "created",
            title: "Pricing call prep",
            url: `${ORIGIN}/employer/documents?source=d41`,
            followUp: "queued",
        });
        expect(outcome.text).toContain(`${ORIGIN}/employer/documents?source=d41`);
        expect(outcome.text).toContain("pass conversationId 41");
        expect(outcome.text).toMatch(/^Saved the conversation/);
    });

    it("says when an update changed nothing", async () => {
        save.mockResolvedValue({
            conversationId: 41,
            status: "unchanged",
            title: "Pricing call prep",
            url: `${ORIGIN}/x`,
            followUp: "unchanged",
        });
        const outcome = okOf(
            await run(saveConversationTool, { ...transcript, conversationId: "41" })
        );
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 41 }));
        expect(outcome.text).toContain("already up to date");
    });

    it.each([
        ["invalid", /could not save/],
        ["too_large", /too large/],
        ["not_found", /conversationId 7 .*without conversationId/],
        ["forbidden", /not allowed/],
    ])("turns a %s refusal into a message the model can act on", async (code, pattern) => {
        save.mockRejectedValue(new ConversationSaveError(code as never, "service says no"));
        const message = messageOf(
            await run(saveConversationTool, { ...transcript, conversationId: 7 })
        );
        expect(message).toMatch(pattern);
        expect(message).toContain("service says no");
    });

    it("validates before calling the service", async () => {
        const bad = [
            { ...transcript, title: "" },
            { ...transcript, title: "t".repeat(201) },
            { ...transcript, messages: [] },
            { ...transcript, messages: [{ role: "system", content: "x" }] },
            { ...transcript, messages: Array.from({ length: 2001 }, () => transcript.messages[0]) },
            { ...transcript, conversationId: 0 },
            { ...transcript, assistant: "copilot" },
            { title: "No messages" },
        ];
        for (const args of bad) {
            expect(messageOf(await run(saveConversationTool, args))).toMatch(
                /^Invalid arguments for save_conversation: /
            );
        }
        expect(
            messageOf(
                await run(saveConversationTool, {
                    ...transcript,
                    messages: [{ role: "system", content: "x" }],
                })
            )
        ).toContain('messages.0.role: must be "user" or "assistant"');
        expect(save).not.toHaveBeenCalled();
    });

    it("lets anything else the service throws reach the dispatcher (logged, generic message)", async () => {
        save.mockRejectedValue(new Error("deadlock detected"));
        await expect(run(saveConversationTool, transcript)).rejects.toThrow("deadlock detected");
    });
});
