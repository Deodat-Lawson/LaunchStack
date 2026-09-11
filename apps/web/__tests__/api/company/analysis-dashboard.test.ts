/**
 * The dashboard aggregates used to be keyed on the legacy `users.companyId`
 * roster and on Clerk user ids alone, so a member of several workspaces
 * carried their activity from every one of them into whichever dashboard was
 * open. These tests pin the roster to memberships and the query counts to the
 * active company's own documents.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { GET } from "~/app/api/company/analysis-dashboard/route";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

// The scope predicate is exercised by its own tests; here the recorder only
// needs to see which scope the route asked for.
jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: (companyId: bigint, scope: { kind: string }) => ({
        op: "scoped",
        companyId,
        scope,
    }),
}));

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

jest.mock("@launchstack/store/schema", () => ({
    document: {
        id: { name: "document.id" },
        title: { name: "title" },
        category: { name: "category" },
        createdAt: { name: "document.created_at" },
        companyId: { name: "document.company_id" },
    },
}));

jest.mock("~/server/db/schema", () => ({
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
        status: { name: "membership.status" },
        createdAt: { name: "membership.created_at" },
    },
    agentAiChatbotMessage: { role: { name: "message.role" } },
    agentAiChatbotChat: { userId: { name: "chat.user_id" } },
}));

jest.mock("drizzle-orm", () => {
    const tag =
        (name: string) =>
        (...args: unknown[]) => ({ op: name, args });
    const sqlFn = Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => ({
            op: "sql",
            strings: Array.from(strings),
            values,
            as: () => ({ op: "sql-alias" }),
        }),
        { raw: (v: unknown) => ({ op: "raw", v }) }
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

const OWNER_CTX: WorkspaceContext = makeWorkspaceContext({
    authUserId: "clerk_owner",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "owner",
});

function serialized() {
    return mockSelectCalls.map(c => JSON.stringify(c, mockReplacer)).join("\n");
}

describe("GET /api/company/analysis-dashboard", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSelectCalls.length = 0;
        mockQueuedResults = [];
    });

    it("denies a member without analytics.view", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({
                authUserId: "clerk_member",
                companyId: BigInt(5),
                role: "member",
            }),
        });

        const response = await GET();

        expect(response.status).toBe(403);
        expect((await response.json()).permission).toBe("analytics.view");
    });

    it("allows an admin member", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({
                authUserId: "clerk_admin",
                companyId: BigInt(5),
                role: "admin",
            }),
        });

        mockQueuedResults = [[], [{ count: 0 }], [], [], []];

        const response = await GET();

        expect(response.status).toBe(200);
    });

    it("counts and lists only documents in the caller's read scope", async () => {
        const scope = {
            kind: "except" as const,
            deniedCategories: ["Board"],
            deniedDocumentIds: [],
            allowedDocumentIds: [],
        };
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({
                authUserId: "clerk_analyst",
                companyId: BigInt(5),
                role: "custom-analyst",
                permissions: ["documents.read", "analytics.view"],
                scope,
            }),
        });
        mockQueuedResults = [[], [{ count: 0 }], [], [], []];

        const response = await GET();

        expect(response.status).toBe(200);
        const calls = serialized();
        // Both the total and the per-document stats read through the scope.
        const scopedWheres = mockSelectCalls.filter(c =>
            c.steps.some(step => step.startsWith("where:") && step.includes('"op":"scoped"'))
        );
        expect(scopedWheres).toHaveLength(2);
        expect(calls).toContain("deniedCategories");
        expect(calls).toContain("Board");
    });

    it("sources the roster from memberships and scopes chat history to company documents", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
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
                    status: "active",
                    lastActiveAt: new Date("2026-01-02T00:00:00Z"),
                    createdAt: new Date("2026-01-01T00:00:00Z"),
                    userId: "clerk_owner",
                },
                {
                    id: 8,
                    name: "Bo",
                    email: "bo@example.com",
                    role: "editor",
                    status: "pending",
                    lastActiveAt: null,
                    createdAt: new Date("2026-01-03T00:00:00Z"),
                    userId: "clerk_bo",
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
        // The displayed role and status are the ones granted in this workspace,
        // with the legacy `editor` slug normalised to `member`.
        expect(json.data.employees[0].role).toBe("owner");
        expect(json.data.employees[0].status).toBe("active");
        expect(json.data.employees[1].role).toBe("member");
        expect(json.data.employees[1].status).toBe("pending");
        // Totals and the trend are the membership roster, not a global user list.
        expect(json.data.totalEmployees).toBe(2);
        expect(json.data.employeeTrend).toHaveLength(30);
        expect(json.data.employeeTrend.at(-1).count).toBe(2);

        const calls = serialized();
        // Status comes from the membership row, never the legacy users column.
        expect(calls).toContain("membership.status");
        expect(calls).not.toContain('"name":"status"');
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
