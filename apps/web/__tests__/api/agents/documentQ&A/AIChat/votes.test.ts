/**
 * `chatId` and `messageId` are independent keys on the vote table, so
 * authorizing the chat alone let an owned chat be paired with a message from
 * a different chat. These tests drive the real ownership helpers through a
 * mocked database so the route is proven to reject that pairing before any
 * vote row is read or written.
 */

import type { NextRequest } from "next/server";

import { GET, POST } from "~/app/api/agents/documentQ&A/AIChat/votes/route";
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

/** Drizzle builders chain then resolve; one recorder covers every shape. */
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
  agentAiChatbotVote: {
    chatId: "vote.chatId",
    messageId: "vote.messageId",
  },
  agentAiChatbotChat: { id: "chat.id", userId: "chat.userId" },
  agentAiChatbotMessage: { id: "msg.id", chatId: "msg.chatId" },
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
  clerkUserId: "user-a",
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
  return new Request("http://localhost/api/agents/documentQ&A/AIChat/votes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function getRequest(query: string) {
  return new Request(
    `http://localhost/api/agents/documentQ&A/AIChat/votes?${query}`,
  ) as unknown as NextRequest;
}

const OWNED_CHAT = [{ id: "c1", userId: "user-a" }];

describe("/api/agents/documentQ&A/AIChat/votes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueuedRows = [];
    mockSelectCount.value = 0;
  });

  describe("POST", () => {
    it("rejects a message that belongs to another chat", async () => {
      authenticate();
      mockQueuedRows = [OWNED_CHAT, [{ id: "m1", chatId: "other-chat" }]];

      const response = await POST(
        postRequest({ chatId: "c1", messageId: "m1", isUpvoted: true }),
      );

      expect(response.status).toBe(404);
      // Chat lookup + message lookup only: the vote row was never touched.
      expect(mockSelectCount.value).toBe(2);
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("rejects a message the caller does not own", async () => {
      authenticate();
      mockQueuedRows = [OWNED_CHAT, []];

      const response = await POST(
        postRequest({ chatId: "c1", messageId: "m1", isUpvoted: true }),
      );

      expect(response.status).toBe(404);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("creates a vote when chat and message agree", async () => {
      authenticate();
      mockQueuedRows = [
        OWNED_CHAT,
        [{ id: "m1", chatId: "c1" }],
        [], // no existing vote
      ];
      mockInsert.mockReturnValue({
        values: () => ({
          returning: () =>
            Promise.resolve([{ chatId: "c1", messageId: "m1", isUpvoted: true }]),
        }),
      });

      const response = await POST(
        postRequest({ chatId: "c1", messageId: "m1", isUpvoted: true }),
      );
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.updated).toBe(false);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("GET", () => {
    it("rejects a message that belongs to another chat", async () => {
      authenticate();
      mockQueuedRows = [OWNED_CHAT, [{ id: "m1", chatId: "other-chat" }]];

      const response = await GET(getRequest("chatId=c1&messageId=m1"));

      expect(response.status).toBe(404);
      expect(mockSelectCount.value).toBe(2);
    });

    it("returns the vote when chat and message agree", async () => {
      authenticate();
      mockQueuedRows = [
        OWNED_CHAT,
        [{ id: "m1", chatId: "c1" }],
        [{ chatId: "c1", messageId: "m1", isUpvoted: false }],
      ];

      const response = await GET(getRequest("chatId=c1&messageId=m1"));
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.vote.messageId).toBe("m1");
    });
  });
});
