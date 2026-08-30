import type { NextRequest } from "next/server";

import { GET } from "~/app/api/agents/documentQ&A/AIChat/tools/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { assertToolCallParentsOwnedByUser } from "~/lib/ai-chat-ownership";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: jest.fn(),
}));

jest.mock("~/lib/ai-chat-ownership", () => ({
    assertToolCallParentsOwnedByUser: jest.fn(),
}));

const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockFrom = jest.fn();
const mockSelect = jest.fn();

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args) as unknown,
    },
}));

jest.mock("~/server/db/schema", () => ({
    agentAiChatbotToolCall: {
        messageId: "tool.messageId",
        taskId: "tool.taskId",
        createdAt: "tool.createdAt",
    },
}));

const mockEq = jest.fn((...args: unknown[]) => ({
    op: "eq",
    column: args[0],
    value: args[1],
}));
const mockAnd = jest.fn((...conditions: unknown[]) => ({
    op: "and",
    conditions,
}));

jest.mock("drizzle-orm", () => ({
    eq: (...args: unknown[]) => mockEq(...args),
    and: (...args: unknown[]) => mockAnd(...args),
}));

const CTX: WorkspaceContext = {
    authUserId: "user-a",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "owner",
    status: "verified",
};

function getRequest(query: string): NextRequest {
    return new Request(
        `http://localhost/api/agents/documentQ&A/AIChat/tools?${query}`
    ) as unknown as NextRequest;
}

describe("GET /api/agents/documentQ&A/AIChat/tools", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireWorkspaceContext as jest.Mock).mockResolvedValue({
            success: true,
            data: CTX,
        });
        mockSelect.mockReturnValue({ from: mockFrom });
        mockFrom.mockReturnValue({ where: mockWhere });
        mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    });

    it("omits rows whose second parent belongs to another chat", async () => {
        const safeRow = {
            id: "safe",
            messageId: "message-owned",
            taskId: "task-owned",
            toolInput: { secret: "safe" },
        };
        const malformedRow = {
            id: "leak",
            messageId: "message-foreign",
            taskId: "task-owned",
            toolInput: { secret: "foreign" },
        };
        mockOrderBy.mockResolvedValue([safeRow, malformedRow]);
        (assertToolCallParentsOwnedByUser as jest.Mock)
            .mockResolvedValueOnce({ success: true, data: { chatId: "chat-a" } })
            .mockResolvedValueOnce({ success: true, data: { chatId: "chat-a" } })
            .mockResolvedValueOnce({
                success: false,
                response: new Response(JSON.stringify({ error: "Tool call not found" }), {
                    status: 404,
                }),
            });

        const response = await GET(getRequest("taskId=task-owned"));
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.toolCalls).toEqual([safeRow]);
        expect(assertToolCallParentsOwnedByUser).toHaveBeenNthCalledWith(
            1,
            null,
            "task-owned",
            "user-a"
        );
        expect(assertToolCallParentsOwnedByUser).toHaveBeenNthCalledWith(
            2,
            "message-owned",
            "task-owned",
            "user-a"
        );
        expect(assertToolCallParentsOwnedByUser).toHaveBeenNthCalledWith(
            3,
            "message-foreign",
            "task-owned",
            "user-a"
        );
    });

    it("combines messageId and taskId filters with AND", async () => {
        const row = {
            id: "safe",
            messageId: "message-owned",
            taskId: "task-owned",
            toolInput: { safe: true },
        };
        mockOrderBy.mockResolvedValue([row]);
        (assertToolCallParentsOwnedByUser as jest.Mock).mockResolvedValue({
            success: true,
            data: { chatId: "chat-a" },
        });

        const response = await GET(getRequest("messageId=message-owned&taskId=task-owned"));

        expect(response.status).toBe(200);
        expect(mockAnd).toHaveBeenCalledWith(
            {
                op: "eq",
                column: "tool.taskId",
                value: "task-owned",
            },
            {
                op: "eq",
                column: "tool.messageId",
                value: "message-owned",
            }
        );
    });
});
