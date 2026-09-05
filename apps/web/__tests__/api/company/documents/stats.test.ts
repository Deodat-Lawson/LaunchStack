import type * as MockRequireWorkspaceContext from "../../../helpers/mock-require-workspace-context";

import type { NextRequest } from "next/server";

import { GET } from "~/app/api/company/documents/[documentId]/stats/route";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

import { makeWorkspaceContext } from "../../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: (companyId: bigint, scope: { kind: string }) => ({
        op: "scoped",
        companyId,
        scope,
    }),
}));

const whereCalls: unknown[] = [];
let queuedRows: unknown[][] = [];
const mockSelect = jest.fn();

jest.mock("~/server/db/index", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
    },
}));

jest.mock("@launchstack/store/schema", () => ({
    document: {
        id: "document.id",
        companyId: "document.companyId",
    },
}));

jest.mock("~/server/db/schema", () => ({
    documentViews: {
        documentId: "views.documentId",
        companyId: "views.companyId",
        userId: "views.userId",
        viewedAt: "views.viewedAt",
    },
    users: {
        id: "users.id",
        userId: "users.userId",
        name: "users.name",
        email: "users.email",
    },
    userCompanyMemberships: {
        userId: "membership.userId",
        companyId: "membership.companyId",
        role: "membership.role",
    },
}));

jest.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    count: (...args: unknown[]) => ({ op: "count", args }),
    desc: (value: unknown) => ({ op: "desc", value }),
    eq: (...args: unknown[]) => ({ op: "eq", args }),
    gte: (...args: unknown[]) => ({ op: "gte", args }),
    sql: Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => ({
            op: "sql",
            strings: Array.from(strings),
            values,
            as: () => ({ op: "sql-alias" }),
        }),
        { raw: (value: unknown) => ({ op: "raw", value }) }
    ),
}));

const CTX: WorkspaceContext = makeWorkspaceContext({
    authUserId: "user-a",
    userPk: BigInt(7),
    companyId: BigInt(5),
    role: "admin",
});

type QueryBuilder = {
    from: () => QueryBuilder;
    where: (predicate: unknown) => QueryBuilder;
    leftJoin: () => QueryBuilder;
    orderBy: () => QueryBuilder;
    limit: () => QueryBuilder;
    groupBy: () => QueryBuilder;
    then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
    ) => Promise<unknown>;
};

function setupRows(...rows: unknown[][]) {
    queuedRows = [...rows];
    mockSelect.mockImplementation(() => {
        const result = queuedRows.shift() ?? [];
        const builder: QueryBuilder = {
            from: () => builder,
            where: predicate => {
                whereCalls.push(predicate);
                return builder;
            },
            leftJoin: () => builder,
            orderBy: () => builder,
            limit: () => builder,
            groupBy: () => builder,
            then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
        };
        return builder;
    });
}

function getRequest(): NextRequest {
    return new Request("http://localhost/api/company/documents/1/stats") as unknown as NextRequest;
}

describe("GET document stats", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        whereCalls.length = 0;
        queuedRows = [];
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: CTX,
        });
    });

    it("denies a member without analytics.view", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({
                authUserId: "user-b",
                companyId: BigInt(5),
                role: "member",
            }),
        });

        const response = await GET(getRequest(), {
            params: Promise.resolve({ documentId: "1" }),
        });

        expect(response.status).toBe(403);
        expect(mockSelect).not.toHaveBeenCalled();
    });

    it("reads the document through the caller's scope and 404s on a miss", async () => {
        setupRows([]);

        const response = await GET(getRequest(), {
            params: Promise.resolve({ documentId: "1" }),
        });

        expect(response.status).toBe(404);
        expect(whereCalls[0]).toEqual(
            expect.objectContaining({
                op: "and",
                conditions: expect.arrayContaining([
                    expect.objectContaining({ op: "scoped", companyId: BigInt(5) }),
                ]),
            })
        );
    });

    it("reports each viewer's role in this workspace, normalised", async () => {
        setupRows(
            [{ id: 1, title: "Doc", category: "report", createdAt: new Date() }],
            [{ count: 1 }],
            [{ count: 1 }],
            [
                {
                    name: "Bo",
                    email: "bo@example.com",
                    viewedAt: new Date(),
                    role: "editor",
                },
                { name: "Gone", email: "gone@example.com", viewedAt: new Date(), role: null },
            ],
            []
        );

        const response = await GET(getRequest(), {
            params: Promise.resolve({ documentId: "1" }),
        });
        const json = await response.json();

        expect(json.data.recentViewers.map((v: { role: string }) => v.role)).toEqual([
            "member",
            "unknown",
        ]);
    });

    it("scopes every view aggregate to the active company", async () => {
        setupRows(
            [{ id: 1, title: "Doc", category: "report", createdAt: new Date() }],
            [{ count: 3 }],
            [{ count: 2 }],
            [],
            []
        );

        const response = await GET(getRequest(), {
            params: Promise.resolve({ documentId: "1" }),
        });

        expect(response.status).toBe(200);
        const viewPredicates = whereCalls.slice(1);
        expect(viewPredicates).toHaveLength(4);
        for (const predicate of viewPredicates) {
            expect(predicate).toEqual(
                expect.objectContaining({
                    op: "and",
                    conditions: expect.arrayContaining([
                        { op: "eq", args: ["views.companyId", BigInt(5)] },
                    ]),
                })
            );
        }
    });
});
