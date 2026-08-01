import {
  assertChatOwnedByUser,
  assertTaskOwnedByUser,
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

jest.mock("@launchstack/core/db/schema", () => ({
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
});
