import {
    assertChatOwnedByUser,
    assertTaskOwnedByUser,
    assertMessageInChat,
    assertToolCallOwnedByUser,
    assertToolCallParentsOwnedByUser,
} from "~/lib/ai-chat-ownership";

const mockLimit = jest.fn();
const mockWhere = jest.fn();
const mockInnerJoin = jest.fn();
const mockFrom = jest.fn();
const mockSelect = jest.fn();

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args) as unknown,
    },
}));

jest.mock("@launchstack/store/schema", () => ({
    agentAiChatbotChat: {
        id: "chat.id",
        userId: "chat.userId",
    },
    agentAiChatbotMessage: {
        id: "msg.id",
        chatId: "msg.chatId",
    },
    agentAiChatbotTask: {
        id: "task.id",
        chatId: "task.chatId",
    },
    agentAiChatbotToolCall: {
        id: "tool.id",
        messageId: "tool.messageId",
        taskId: "tool.taskId",
    },
    agentAiChatbotExecutionStep: {
        id: "step.id",
        taskId: "step.taskId",
    },
}));

describe("ai-chat-ownership", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSelect.mockReturnValue({ from: mockFrom });
        mockFrom.mockReturnValue({
            where: mockWhere,
            innerJoin: mockInnerJoin,
        });
        mockWhere.mockReturnValue({ limit: mockLimit });
        mockInnerJoin.mockReturnValue({ where: mockWhere });
    });

    it("assertChatOwnedByUser returns chat when owned", async () => {
        mockLimit.mockResolvedValue([{ id: "c1", userId: "user-a" }]);

        const result = await assertChatOwnedByUser("c1", "user-a");

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.id).toBe("c1");
        }
    });

    it("assertChatOwnedByUser returns 404 when not owned", async () => {
        mockLimit.mockResolvedValue([]);

        const result = await assertChatOwnedByUser("c1", "user-b");

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.response.status).toBe(404);
        }
    });

    it("assertTaskOwnedByUser returns 404 when task chat is not owned", async () => {
        mockLimit.mockResolvedValue([]);

        const result = await assertTaskOwnedByUser("t1", "user-b");

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.response.status).toBe(404);
        }
    });

    it("assertMessageInChat rejects a message from another chat", async () => {
        mockLimit.mockResolvedValue([{ id: "m1", chatId: "other-chat" }]);

        const result = await assertMessageInChat("m1", "c1", "user-a");

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.response.status).toBe(404);
        }
    });

    it("assertMessageInChat accepts a message from the same chat", async () => {
        mockLimit.mockResolvedValue([{ id: "m1", chatId: "c1" }]);

        const result = await assertMessageInChat("m1", "c1", "user-a");

        expect(result.success).toBe(true);
    });

    describe("dual-parent tool calls", () => {
        it("rejects an owned task paired with a message from another chat", async () => {
            mockLimit
                .mockResolvedValueOnce([{ id: "m1", chatId: "chat-foreign" }])
                .mockResolvedValueOnce([{ id: "t1", chatId: "chat-owned" }]);

            const result = await assertToolCallParentsOwnedByUser("m1", "t1", "user-a");

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.response.status).toBe(404);
            }
        });

        it("accepts parents that name the same chat", async () => {
            mockLimit
                .mockResolvedValueOnce([{ id: "m1", chatId: "chat-owned" }])
                .mockResolvedValueOnce([{ id: "t1", chatId: "chat-owned" }]);

            const result = await assertToolCallParentsOwnedByUser("m1", "t1", "user-a");

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.chatId).toBe("chat-owned");
            }
        });

        it("rejects a message the caller does not own even when the task is owned", async () => {
            mockLimit.mockResolvedValueOnce([]);

            const result = await assertToolCallParentsOwnedByUser("m1", "t1", "user-a");

            expect(result.success).toBe(false);
        });

        it("assertToolCallOwnedByUser rejects a historical mixed-parent row", async () => {
            mockLimit
                // the tool call row itself
                .mockResolvedValueOnce([{ id: "tc1", messageId: "m1", taskId: "t1" }])
                .mockResolvedValueOnce([{ id: "m1", chatId: "chat-foreign" }])
                .mockResolvedValueOnce([{ id: "t1", chatId: "chat-owned" }]);

            const result = await assertToolCallOwnedByUser("tc1", "user-a");

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.response.status).toBe(404);
            }
        });
    });
});
