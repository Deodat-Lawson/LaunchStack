/**
 * AIChat CRUD family (/api/agents/documentQ&A/AIChat/**): every handler
 * requires a Clerk session, identity is taken from the session (client
 * userId values are ignored), and rows belonging to other users read as 404.
 */

const mockClerk: { userId: string | null } = { userId: null };

jest.mock("@clerk/nextjs/server", () => ({
    auth: () => Promise.resolve({ userId: mockClerk.userId }),
}));

jest.mock("~/server/security/aichat-authz", () => ({
    userOwnsChat: jest.fn(),
    userOwnsTask: jest.fn(),
    userOwnsMessage: jest.fn(),
    userOwnsToolCall: jest.fn(),
    userOwnsExecutionStep: jest.fn(),
}));

// Minimal chainable db mock: select/update/delete/insert return builders that
// are awaitable; select resolves from a FIFO queue, insert/update capture
// their values and resolve with them.
const mockSelectQueue: unknown[][] = [];
const mockInserted: Record<string, unknown>[] = [];
const mockUpdated: { set: Record<string, unknown> }[] = [];
const mockDeleted: unknown[] = [];

function mockSelectBuilder() {
    const resolve = () => Promise.resolve(mockSelectQueue.shift() ?? []);
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "where", "innerJoin", "leftJoin", "orderBy"]) {
        builder[method] = () => builder;
    }
    builder.limit = resolve;
    builder.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected);
    return builder;
}

jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(() => mockSelectBuilder()),
        insert: jest.fn(() => ({
            values: (values: Record<string, unknown>) => {
                mockInserted.push(values);
                return { returning: () => Promise.resolve([values]) };
            },
        })),
        update: jest.fn(() => ({
            set: (set: Record<string, unknown>) => {
                mockUpdated.push({ set });
                return {
                    where: () => ({
                        returning: () => Promise.resolve([set]),
                    }),
                };
            },
        })),
        delete: jest.fn(() => ({
            where: (condition: unknown) => {
                mockDeleted.push(condition);
                return Promise.resolve();
            },
        })),
    },
}));

import * as aichatAuthz from "~/server/security/aichat-authz";
import { GET as getChats, POST as createChat } from "~/app/api/agents/documentQ&A/AIChat/chats/route";
import {
    GET as getChat,
    PATCH as patchChat,
    DELETE as deleteChat,
} from "~/app/api/agents/documentQ&A/AIChat/chats/[chatId]/route";
import { GET as getMessages, POST as createMessage } from "~/app/api/agents/documentQ&A/AIChat/messages/route";
import { POST as createMemory } from "~/app/api/agents/documentQ&A/AIChat/memory/route";
import { GET as getTasks, POST as createTask } from "~/app/api/agents/documentQ&A/AIChat/tasks/route";
import { PATCH as patchTask } from "~/app/api/agents/documentQ&A/AIChat/tasks/[taskId]/route";
import { GET as getTools, POST as createToolCall } from "~/app/api/agents/documentQ&A/AIChat/tools/route";
import { PATCH as patchToolCall } from "~/app/api/agents/documentQ&A/AIChat/tools/[toolCallId]/route";
import { POST as createVote } from "~/app/api/agents/documentQ&A/AIChat/votes/route";
import {
    GET as getSteps,
    POST as createStep,
} from "~/app/api/agents/documentQ&A/AIChat/execution-steps/route";
import { PATCH as patchStep } from "~/app/api/agents/documentQ&A/AIChat/execution-steps/[stepId]/route";

import type { NextRequest } from "next/server";

const mockAuthz = aichatAuthz as jest.Mocked<typeof aichatAuthz>;

const SESSION_USER = "user_session";

function jsonRequest(path: string, body: unknown, method = "POST"): NextRequest {
    return new Request(`http://localhost${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }) as unknown as NextRequest;
}

function getRequest(path: string): NextRequest {
    return new Request(`http://localhost${path}`) as unknown as NextRequest;
}

const routeParams = <T extends Record<string, string>>(params: T) => ({
    params: Promise.resolve(params),
});

beforeEach(() => {
    jest.clearAllMocks();
    mockClerk.userId = SESSION_USER;
    mockSelectQueue.length = 0;
    mockInserted.length = 0;
    mockUpdated.length = 0;
    mockDeleted.length = 0;
    mockAuthz.userOwnsChat.mockResolvedValue(true);
    mockAuthz.userOwnsTask.mockResolvedValue(true);
    mockAuthz.userOwnsMessage.mockResolvedValue(true);
    mockAuthz.userOwnsToolCall.mockResolvedValue(true);
    mockAuthz.userOwnsExecutionStep.mockResolvedValue(true);
});

describe("session requirement (401 with no Clerk session)", () => {
    it.each<[string, () => Promise<Response>]>([
        ["GET chats", () => getChats(getRequest("/chats?userId=x"))],
        ["POST chats", () => createChat(jsonRequest("/chats", { userId: "x", title: "t" }))],
        ["GET chats/[id]", () => getChat(getRequest("/chats/c1"), routeParams({ chatId: "c1" }))],
        [
            "PATCH chats/[id]",
            () => patchChat(jsonRequest("/chats/c1", { title: "t" }, "PATCH"), routeParams({ chatId: "c1" })),
        ],
        [
            "DELETE chats/[id]",
            () => deleteChat(getRequest("/chats/c1"), routeParams({ chatId: "c1" })),
        ],
        ["GET messages", () => getMessages(getRequest("/messages?chatId=c1"))],
        [
            "POST messages",
            () => createMessage(jsonRequest("/messages", { chatId: "c1", role: "user", content: "hi" })),
        ],
        [
            "POST memory",
            () =>
                createMemory(
                    jsonRequest("/memory", { chatId: "c1", memoryType: "working", key: "k", value: 1 })
                ),
        ],
        ["GET tasks", () => getTasks(getRequest("/tasks?chatId=c1"))],
        [
            "POST tasks",
            () => createTask(jsonRequest("/tasks", { chatId: "c1", description: "d", objective: "o" })),
        ],
        [
            "PATCH tasks/[id]",
            () => patchTask(jsonRequest("/tasks/t1", { status: "completed" }, "PATCH"), routeParams({ taskId: "t1" })),
        ],
        ["GET tools", () => getTools(getRequest("/tools?messageId=m1"))],
        [
            "POST tools",
            () => createToolCall(jsonRequest("/tools", { messageId: "m1", toolName: "search", toolInput: {} })),
        ],
        [
            "PATCH tools/[id]",
            () =>
                patchToolCall(
                    jsonRequest("/tools/tc1", { status: "completed" }, "PATCH"),
                    routeParams({ toolCallId: "tc1" })
                ),
        ],
        [
            "POST votes",
            () => createVote(jsonRequest("/votes", { chatId: "c1", messageId: "m1", isUpvoted: true })),
        ],
        ["GET execution-steps", () => getSteps(getRequest("/execution-steps?taskId=t1"))],
        [
            "POST execution-steps",
            () =>
                createStep(
                    jsonRequest("/execution-steps", {
                        taskId: "t1",
                        stepNumber: 1,
                        stepType: "reasoning",
                        description: "d",
                    })
                ),
        ],
        [
            "PATCH execution-steps/[id]",
            () =>
                patchStep(
                    jsonRequest("/execution-steps/s1", { status: "completed" }, "PATCH"),
                    routeParams({ stepId: "s1" })
                ),
        ],
    ])("%s returns 401", async (_name, invoke) => {
        mockClerk.userId = null;
        const response = await invoke();
        expect(response.status).toBe(401);
    });
});

describe("chats", () => {
    it("GET lists the session user's chats and ignores the query userId", async () => {
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            mockSelectQueue.push([{ id: "c1", userId: SESSION_USER }]);

            const response = await getChats(getRequest("/chats?userId=attacker"));
            const json = await response.json();

            expect(response.status).toBe(200);
            expect(json.chats).toHaveLength(1);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Ignoring query userId=attacker")
            );
        } finally {
            consoleWarnSpy.mockRestore();
        }
    });

    it("POST creates the chat under the session user, ignoring the body userId", async () => {
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const response = await createChat(
                jsonRequest("/chats", { userId: "attacker", title: "My chat" })
            );

            expect(response.status).toBe(200);
            expect(mockInserted[0]).toMatchObject({ userId: SESSION_USER, title: "My chat" });
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Ignoring body userId=attacker")
            );
        } finally {
            consoleWarnSpy.mockRestore();
        }
    });

    it("GET [chatId] returns 404 for a chat owned by someone else", async () => {
        mockSelectQueue.push([]); // scoped select finds nothing
        const response = await getChat(getRequest("/chats/c1"), routeParams({ chatId: "c1" }));
        expect(response.status).toBe(404);
    });

    it("GET [chatId] returns the chat with its children when owned", async () => {
        mockSelectQueue.push(
            [{ id: "c1", userId: SESSION_USER }], // chat
            [{ id: "m1" }], // messages
            [{ id: "t1" }], // tasks
            [{ id: "d1" }] // documents
        );
        const response = await getChat(getRequest("/chats/c1"), routeParams({ chatId: "c1" }));
        const json = await response.json();
        expect(response.status).toBe(200);
        expect(json).toMatchObject({
            success: true,
            chat: { id: "c1" },
            messages: [{ id: "m1" }],
            tasks: [{ id: "t1" }],
            documents: [{ id: "d1" }],
        });
    });

    it("PATCH [chatId] returns 404 when the scoped update matches nothing", async () => {
        // update builder resolves with the set payload; simulate no row by
        // overriding returning() to []
        const dbModule = jest.requireMock("~/server/db");
        dbModule.db.update.mockReturnValueOnce({
            set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
        });

        const response = await patchChat(
            jsonRequest("/chats/c1", { title: "New" }, "PATCH"),
            routeParams({ chatId: "c1" })
        );
        expect(response.status).toBe(404);
    });

    it("DELETE [chatId] issues a user-scoped delete", async () => {
        const response = await deleteChat(getRequest("/chats/c1"), routeParams({ chatId: "c1" }));
        expect(response.status).toBe(200);
        expect(mockDeleted).toHaveLength(1);
    });
});

describe("chat-scoped children 404 on foreign ownership", () => {
    beforeEach(() => {
        mockAuthz.userOwnsChat.mockResolvedValue(false);
        mockAuthz.userOwnsTask.mockResolvedValue(false);
        mockAuthz.userOwnsMessage.mockResolvedValue(false);
        mockAuthz.userOwnsToolCall.mockResolvedValue(false);
        mockAuthz.userOwnsExecutionStep.mockResolvedValue(false);
    });

    it("GET/POST messages -> 404", async () => {
        expect((await getMessages(getRequest("/messages?chatId=c1"))).status).toBe(404);
        expect(
            (
                await createMessage(
                    jsonRequest("/messages", { chatId: "c1", role: "user", content: "hi" })
                )
            ).status
        ).toBe(404);
        expect(mockAuthz.userOwnsChat).toHaveBeenCalledWith("c1", SESSION_USER);
        expect(mockInserted).toHaveLength(0);
    });

    it("POST memory -> 404", async () => {
        const response = await createMemory(
            jsonRequest("/memory", { chatId: "c1", memoryType: "working", key: "k", value: 1 })
        );
        expect(response.status).toBe(404);
        expect(mockInserted).toHaveLength(0);
    });

    it("GET/POST tasks -> 404", async () => {
        expect((await getTasks(getRequest("/tasks?chatId=c1"))).status).toBe(404);
        expect(
            (await createTask(jsonRequest("/tasks", { chatId: "c1", description: "d", objective: "o" })))
                .status
        ).toBe(404);
    });

    it("PATCH tasks/[taskId] -> 404", async () => {
        const response = await patchTask(
            jsonRequest("/tasks/t1", { status: "completed" }, "PATCH"),
            routeParams({ taskId: "t1" })
        );
        expect(response.status).toBe(404);
        expect(mockAuthz.userOwnsTask).toHaveBeenCalledWith("t1", SESSION_USER);
        expect(mockUpdated).toHaveLength(0);
    });

    it("POST tools -> 404 on foreign message", async () => {
        const response = await createToolCall(
            jsonRequest("/tools", { messageId: "m1", toolName: "search", toolInput: {} })
        );
        expect(response.status).toBe(404);
        expect(mockAuthz.userOwnsMessage).toHaveBeenCalledWith("m1", SESSION_USER);
        expect(mockInserted).toHaveLength(0);
    });

    it("PATCH tools/[toolCallId] -> 404", async () => {
        const response = await patchToolCall(
            jsonRequest("/tools/tc1", { status: "completed" }, "PATCH"),
            routeParams({ toolCallId: "tc1" })
        );
        expect(response.status).toBe(404);
        expect(mockAuthz.userOwnsToolCall).toHaveBeenCalledWith("tc1", SESSION_USER);
    });

    it("POST votes -> 404", async () => {
        const response = await createVote(
            jsonRequest("/votes", { chatId: "c1", messageId: "m1", isUpvoted: true })
        );
        expect(response.status).toBe(404);
    });

    it("GET/POST execution-steps -> 404", async () => {
        expect((await getSteps(getRequest("/execution-steps?taskId=t1"))).status).toBe(404);
        expect(
            (
                await createStep(
                    jsonRequest("/execution-steps", {
                        taskId: "t1",
                        stepNumber: 1,
                        stepType: "reasoning",
                        description: "d",
                    })
                )
            ).status
        ).toBe(404);
    });

    it("PATCH execution-steps/[stepId] -> 404", async () => {
        const response = await patchStep(
            jsonRequest("/execution-steps/s1", { status: "completed" }, "PATCH"),
            routeParams({ stepId: "s1" })
        );
        expect(response.status).toBe(404);
        expect(mockAuthz.userOwnsExecutionStep).toHaveBeenCalledWith("s1", SESSION_USER);
    });
});

describe("owned resources succeed", () => {
    it("POST messages inserts when the chat is owned", async () => {
        const response = await createMessage(
            jsonRequest("/messages", { chatId: "c1", role: "user", content: "hello" })
        );
        expect(response.status).toBe(200);
        expect(mockInserted[0]).toMatchObject({ chatId: "c1", role: "user" });
    });

    it("GET messages lists when the chat is owned", async () => {
        mockSelectQueue.push([{ id: "m1", chatId: "c1" }]);
        const response = await getMessages(getRequest("/messages?chatId=c1"));
        const json = await response.json();
        expect(response.status).toBe(200);
        expect(json.messages).toHaveLength(1);
    });
});
