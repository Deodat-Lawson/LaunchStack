import { POST as addChatHistory } from "~/app/api/Questions/add/route";
import { POST as fetchChatHistory } from "~/app/api/Questions/fetch/route";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    ...jest.requireActual("~/lib/require-workspace-context"),
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

// `and` as data, so a test can see which predicates a query was built from.
jest.mock("drizzle-orm", () => ({
    ...jest.requireActual("drizzle-orm"),
    and: (...args: unknown[]) => ({ op: "and", args }),
}));

const mockSelect = jest.fn();
const mockInsert = jest.fn();
jest.mock("~/server/db/index", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
        insert: (...args: unknown[]) => mockInsert(...args),
    },
}));

jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: jest.fn((companyId: bigint, scope: unknown) => ({
        op: "scoped",
        companyId,
        scope,
    })),
}));

const FINANCE_HIDDEN: DocumentScope = {
    kind: "except",
    deniedCategories: ["Finance"],
    deniedDocumentIds: [],
    allowedDocumentIds: [],
};

// Identity and tenant now come from requireWorkspaceContext, so the routes no
// longer look the user up themselves — the first db.select() a handler makes
// is the document lookup, through the caller's document scope.
function mockAuthenticated(
    companyId = BigInt(10),
    overrides: Parameters<typeof makeWorkspaceContext>[0] = {}
) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({
            authUserId: "user-1",
            userPk: BigInt(1),
            companyId,
            role: "owner",
            ...overrides,
        }),
    });
}

function mockUnauthenticated() {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        }),
    });
}

const createLimitedSelect = (rows: unknown[]) => ({
    from: () => ({
        where: () => ({
            limit: () => Promise.resolve(rows),
        }),
    }),
});

// The history query joins the document under the scoped predicate.
const createJoinedSelect = (rows: unknown[], onWhere?: (predicate: unknown) => void) => ({
    from: () => ({
        innerJoin: () => ({
            where: (predicate: unknown) => {
                onWhere?.(predicate);
                return Promise.resolve(rows);
            },
        }),
    }),
});

describe("Chat history routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("POST /api/Questions/add", () => {
        const buildRequest = (body: Record<string, unknown>) =>
            new Request("http://localhost/api/Questions/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

        it("rejects unauthenticated requests", async () => {
            mockUnauthenticated();

            const response = await addChatHistory(
                buildRequest({
                    documentId: 1,
                    question: "Q?",
                    documentTitle: "Doc",
                    response: "A",
                    pages: [1],
                })
            );

            expect(response.status).toBe(401);
        });

        it("reads a document outside the user's company or scope as missing", async () => {
            mockAuthenticated(BigInt(10), { role: "member", scope: FINANCE_HIDDEN });
            // The scoped query matches nothing for a document the caller cannot see.
            mockSelect.mockImplementationOnce(() => createLimitedSelect([]));

            const response = await addChatHistory(
                buildRequest({
                    documentId: 5,
                    question: "Q?",
                    documentTitle: "Doc",
                    response: "A",
                })
            );

            expect(response.status).toBe(404);
            expect(scopedDocumentWhere).toHaveBeenCalledWith(BigInt(10), FINANCE_HIDDEN);
            expect(mockInsert).not.toHaveBeenCalled();
        });

        it("refuses a role without documents.read", async () => {
            mockAuthenticated(BigInt(10), { role: "reporting", permissions: ["analytics.view"] });

            const response = await addChatHistory(
                buildRequest({
                    documentId: 5,
                    question: "Q?",
                    documentTitle: "Doc",
                    response: "A",
                })
            );

            expect(response.status).toBe(403);
            expect(mockSelect).not.toHaveBeenCalled();
        });

        it("stores chat history when user and document are valid", async () => {
            mockAuthenticated();
            mockSelect.mockImplementationOnce(() =>
                createLimitedSelect([{ id: 7, companyId: 10n, title: "Actual Title" }])
            );

            const insertValues = jest.fn().mockResolvedValue(undefined);
            mockInsert.mockReturnValueOnce({ values: insertValues });

            const response = await addChatHistory(
                buildRequest({
                    documentId: 7,
                    question: "Q?",
                    documentTitle: "Ignored",
                    response: "Answer",
                    pages: [2, 3],
                })
            );

            expect(response.status).toBe(201);
            expect(insertValues).toHaveBeenCalledWith({
                UserId: "user-1",
                documentId: 7n,
                documentTitle: "Actual Title",
                question: "Q?",
                response: "Answer",
                pages: [2, 3],
            });
        });
    });

    describe("POST /api/Questions/fetch", () => {
        const buildRequest = (body: Record<string, unknown>) =>
            new Request("http://localhost/api/Questions/fetch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

        it("rejects unauthenticated requests", async () => {
            mockUnauthenticated();

            const response = await fetchChatHistory(
                buildRequest({
                    documentId: 9,
                })
            );

            expect(response.status).toBe(401);
        });

        it("returns chat history for valid users and documents", async () => {
            mockAuthenticated();
            mockSelect
                .mockImplementationOnce(() => createLimitedSelect([{ id: 9 }]))
                .mockImplementationOnce(() =>
                    createJoinedSelect([{ id: 1, question: "Q?", response: "A" }])
                );

            const response = await fetchChatHistory(
                buildRequest({
                    documentId: 9,
                })
            );

            expect(response.status).toBe(200);
            const payload = await response.json();
            expect(payload.chatHistory).toEqual([{ id: 1, question: "Q?", response: "A" }]);
        });

        it("lists history only through the caller's document scope", async () => {
            mockAuthenticated(BigInt(10), { role: "member", scope: FINANCE_HIDDEN });
            const historyWhere = jest.fn();
            mockSelect
                .mockImplementationOnce(() => createLimitedSelect([{ id: 9 }]))
                .mockImplementationOnce(() => createJoinedSelect([], historyWhere));

            const response = await fetchChatHistory(buildRequest({ documentId: 9 }));

            expect(response.status).toBe(200);
            expect(scopedDocumentWhere).toHaveBeenCalledWith(BigInt(10), FINANCE_HIDDEN);
            expect(historyWhere).toHaveBeenCalledTimes(1);
            // The join predicate carries the same scope the lookup used.
            expect(historyWhere.mock.calls[0]?.[0]).toEqual(
                expect.objectContaining({
                    op: "and",
                    args: expect.arrayContaining([
                        { op: "scoped", companyId: BigInt(10), scope: FINANCE_HIDDEN },
                    ]),
                })
            );
        });

        it("reads a document outside the scope as missing", async () => {
            mockAuthenticated(BigInt(10), { role: "member", scope: FINANCE_HIDDEN });
            mockSelect.mockImplementationOnce(() => createLimitedSelect([]));

            const response = await fetchChatHistory(buildRequest({ documentId: 9 }));

            expect(response.status).toBe(404);
        });
    });
});
