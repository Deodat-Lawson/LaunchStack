/**
 * Owning the destination chat used to be the only check on message creation,
 * so a caller could thread a new message under a parent from someone else's
 * chat and persist invalid ancestry. These tests drive the real ownership
 * helpers through a mocked database to pin the parent-in-chat rule.
 */

import type { NextRequest } from "next/server";

import { POST } from "~/app/api/agents/documentQ&A/AIChat/messages/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

jest.mock("~/lib/require-workspace-context", () => {
    const actual = jest.requireActual("~/lib/require-workspace-context");
    return { ...actual, requireWorkspaceContext: jest.fn() };
});

let mockQueuedRows: Record<string, unknown>[][] = [];
const mockSelectCount = { value: 0 };
const mockInsert = jest.fn();
const mockUpdate = jest.fn();

function mockBuilder() {
    mockSelectCount.value += 1;
    const rows = mockQueuedRows.shift() ?? [];

    const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => resolve(rows),
    };
    for (const method of ["from", "where", "innerJoin", "limit", "orderBy"]) {
        builder[method] = () => builder;
    }
    return builder;
}

jest.mock("~/server/db", () => ({
    db: {
        select: () => mockBuilder(),
        insert: (...args: unknown[]) => mockInsert(...args) as unknown,
        update: (...args: unknown[]) => mockUpdate(...args) as unknown,
    },
}));

jest.mock("~/server/db/schema", () => ({
    agentAiChatbotChat: { id: "chat.id", userId: "chat.userId" },
    agentAiChatbotMessage: {
        id: "msg.id",
        chatId: "msg.chatId",
        createdAt: "msg.createdAt",
    },
    agentAiChatbotTask: { id: "task.id", chatId: "task.chatId" },
    agentAiChatbotToolCall: {
        id: "tool.id",
        messageId: "tool.messageId",
        taskId: "tool.taskId",
    },
    agentAiChatbotExecutionStep: { id: "step.id", taskId: "step.taskId" },
}));

jest.mock("drizzle-orm", () => ({
    eq: (...args: unknown[]) => ({ op: "eq", args }),
    and: (...args: unknown[]) => ({ op: "and", args }),
}));

const CTX: WorkspaceContext = {
    authUserId: "user-a",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "owner",
    status: "verified",
};

function authenticate() {
    (requireWorkspaceContext as jest.Mock).mockResolvedValue({
        success: true,
        data: CTX,
    });
}

function postRequest(body: unknown) {
    return new Request("http://localhost/api/agents/documentQ&A/AIChat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }) as unknown as NextRequest;
}

const OWNED_CHAT = [{ id: "c1", userId: "user-a" }];

describe("POST /api/agents/documentQ&A/AIChat/messages", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockQueuedRows = [];
        mockSelectCount.value = 0;
        mockInsert.mockReturnValue({
            values: () => ({
                returning: () => Promise.resolve([{ id: "new-message" }]),
            }),
        });
        mockUpdate.mockReturnValue({
            set: () => ({ where: () => Promise.resolve(undefined) }),
        });
    });

    it("rejects a parent message from another chat", async () => {
        authenticate();
        mockQueuedRows = [OWNED_CHAT, [{ id: "p1", chatId: "other-chat" }]];

        const response = await POST(
            postRequest({
                chatId: "c1",
                role: "user",
                content: "hello",
                parentMessageId: "p1",
            })
        );

        expect(response.status).toBe(404);
        expect(mockInsert).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("rejects a parent message the caller does not own", async () => {
        authenticate();
        mockQueuedRows = [OWNED_CHAT, []];

        const response = await POST(
            postRequest({
                chatId: "c1",
                role: "user",
                content: "hello",
                parentMessageId: "p1",
            })
        );

        expect(response.status).toBe(404);
        expect(mockInsert).not.toHaveBeenCalled();
    });

    it("inserts when the parent lives in the destination chat", async () => {
        authenticate();
        mockQueuedRows = [OWNED_CHAT, [{ id: "p1", chatId: "c1" }]];

        const response = await POST(
            postRequest({
                chatId: "c1",
                role: "user",
                content: "hello",
                parentMessageId: "p1",
            })
        );
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("inserts a root message without looking up a parent", async () => {
        authenticate();
        mockQueuedRows = [OWNED_CHAT];

        const response = await POST(postRequest({ chatId: "c1", role: "user", content: "hello" }));

        expect(response.status).toBe(200);
        // Only the chat ownership lookup ran.
        expect(mockSelectCount.value).toBe(1);
        expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("rejects a chat the caller does not own", async () => {
        authenticate();
        mockQueuedRows = [[]];

        const response = await POST(postRequest({ chatId: "c1", role: "user", content: "hello" }));

        expect(response.status).toBe(404);
        expect(mockInsert).not.toHaveBeenCalled();
    });
});
