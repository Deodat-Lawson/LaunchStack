/**
 * The dashboard aggregates used to be keyed on the legacy `users.companyId`
 * roster and on Clerk user ids alone, so a member of several workspaces
 * carried their activity from every one of them into whichever dashboard was
 * open. These tests pin the roster to memberships and the query counts to the
 * active company's own documents.
 */

import { GET } from "~/app/api/company/analysis-dashboard/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

jest.mock("~/lib/require-workspace-context", () => {
  const actual = jest.requireActual("~/lib/require-workspace-context");
  return {
    ...actual,
    requireWorkspaceContext: jest.fn(),
  };
});

const mockSelectCalls: { fields: unknown; steps: string[] }[] = [];
let mockQueuedResults: Record<string, unknown>[][] = [];

/**
 * Drizzle builders are chainable and awaited at the end, so one recording
 * stand-in covers every query shape the route uses.
 */
function mockBuilder(fields: unknown) {
  const record = { fields, steps: [] as string[] };
  mockSelectCalls.push(record);

  const rows = mockQueuedResults.shift() ?? [];

  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve(rows),
  };
  for (const method of [
    "from",
    "where",
    "innerJoin",
    "leftJoin",
    "groupBy",
    "orderBy",
    "limit",
  ]) {
    builder[method] = (...args: unknown[]) => {
      record.steps.push(`${method}:${JSON.stringify(args, mockReplacer)}`);
      return builder;
    };
  }
  return builder;
}

function mockReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  return value;
}

jest.mock("~/server/db/index", () => ({
  db: {
    select: (fields: unknown) => mockBuilder(fields),
    update: () => ({
      set: () => ({ where: () => Promise.resolve(undefined) }),
    }),
  },
}));

jest.mock("@launchstack/core/db/schema", () => ({
  users: {
    id: { name: "id" },
    name: { name: "name" },
    email: { name: "email" },
    role: { name: "role" },
    status: { name: "status" },
    lastActiveAt: { name: "last_active_at" },
    createdAt: { name: "created_at" },
    userId: { name: "user_id" },
    companyId: { name: "company_id" },
  },
  document: {
    id: { name: "document.id" },
    title: { name: "title" },
    category: { name: "category" },
    createdAt: { name: "document.created_at" },
    companyId: { name: "document.company_id" },
  },
  documentViews: {
    id: { name: "views.id" },
    documentId: { name: "views.document_id" },
    viewedAt: { name: "viewed_at" },
    companyId: { name: "views.company_id" },
  },
  ChatHistory: {
    UserId: { name: "chat_history.user_id" },
    documentId: { name: "chat_history.document_id" },
  },
  userCompanyMemberships: {
    userId: { name: "membership.user_id" },
    companyId: { name: "membership.company_id" },
    role: { name: "membership.role" },
    createdAt: { name: "membership.created_at" },
  },
  agentAiChatbotMessage: { role: { name: "message.role" } },
  agentAiChatbotChat: { userId: { name: "chat.user_id" } },
}));

jest.mock("drizzle-orm", () => {
  const tag = (name: string) =>
    (...args: unknown[]) => ({ op: name, args });
  const sqlFn = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      op: "sql",
      strings: Array.from(strings),
      values,
      as: () => ({ op: "sql-alias" }),
    }),
    { raw: (v: unknown) => ({ op: "raw", v }) },
  );
  return {
    eq: tag("eq"),
    and: tag("and"),
    gte: tag("gte"),
    desc: tag("desc"),
    count: tag("count"),
    inArray: tag("inArray"),
    max: tag("max"),
    sql: sqlFn,
  };
});

const OWNER_CTX: WorkspaceContext = {
  clerkUserId: "clerk_owner",
  userPk: BigInt(7),
  companyId: BigInt(5),
  role: "owner",
  status: "verified",
};

function serialized() {
  return mockSelectCalls.map((c) => JSON.stringify(c, mockReplacer)).join("\n");
}

describe("GET /api/company/analysis-dashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectCalls.length = 0;
    mockQueuedResults = [];
  });

  it("denies a member without a management role", async () => {
    (requireWorkspaceContext as jest.Mock).mockResolvedValue({
      success: true,
      data: { ...OWNER_CTX, role: "editor" },
    });

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it("allows an admin member", async () => {
    (requireWorkspaceContext as jest.Mock).mockResolvedValue({
      success: true,
      data: { ...OWNER_CTX, role: "admin" },
    });

    mockQueuedResults = [[], [{ count: 0 }], [], [], []];

    const response = await GET();

    expect(response.status).toBe(200);
  });

  it("sources the roster from memberships and scopes chat history to company documents", async () => {
    (requireWorkspaceContext as jest.Mock).mockResolvedValue({
      success: true,
      data: OWNER_CTX,
    });

    mockQueuedResults = [
      // roster
      [
        {
          id: 7,
          name: "Ada",
          email: "ada@example.com",
          role: "owner",
          status: "verified",
          lastActiveAt: new Date("2026-01-02T00:00:00Z"),
          createdAt: new Date("2026-01-01T00:00:00Z"),
          userId: "clerk_owner",
        },
      ],
      [{ count: 1 }], // document count
      [], // document stats
      [], // employee trend
      [], // document views trend
      [{ userId: "clerk_owner", count: 3 }], // chat history counts
    ];

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.employees[0].queryCount).toBe(3);
    // The displayed role is the one granted in this workspace.
    expect(json.data.employees[0].role).toBe("owner");
    // Totals and the trend are the membership roster, not a global user list.
    expect(json.data.totalEmployees).toBe(1);
    expect(json.data.employeeTrend).toHaveLength(30);
    expect(json.data.employeeTrend.at(-1).count).toBe(1);

    const calls = serialized();
    // The joining trend is keyed on when the membership was created.
    expect(calls).toContain("membership.created_at");
    // Document totals and view trends stay filtered by the active company.
    expect(calls).toContain("views.company_id");
    // Roster and trend read memberships, not the legacy users.companyId.
    expect(calls).toContain("membership.company_id");
    expect(calls).not.toContain('"company_id"');
    // Chat history is joined to this company's documents.
    expect(calls).toContain("chat_history.document_id");
    expect(calls).toContain("document.company_id");
    // The AI chat aggregate had no company or document anchor and is gone.
    expect(calls).not.toContain("chat.user_id");
  });
});
