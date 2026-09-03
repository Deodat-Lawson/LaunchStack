import { POST as addChatHistory } from "~/app/api/Questions/add/route";
import { POST as fetchChatHistory } from "~/app/api/Questions/fetch/route";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

const mockSelect = jest.fn();
const mockInsert = jest.fn();
jest.mock("~/server/db/index", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
        insert: (...args: unknown[]) => mockInsert(...args),
    },
}));

// Identity and tenant now come from requireWorkspaceContext, so the routes no
// longer look the user up themselves — the first db.select() a handler makes
// is the document lookup.
function mockAuthenticated(companyId = BigInt(10)) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: {
            authUserId: "user-1",
            userPk: BigInt(1),
            companyId,
            role: "owner",
            status: "verified",
        },
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

const createWhereSelect = (rows: unknown[]) => ({
    from: () => ({
        where: () => Promise.resolve(rows),
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

        it("prevents writing to documents outside the user's company", async () => {
            mockAuthenticated();
            mockSelect.mockImplementationOnce(() =>
                createLimitedSelect([{ id: 5, companyId: 20n, title: "Doc" }])
            );

            const response = await addChatHistory(
                buildRequest({
                    documentId: 5,
                    question: "Q?",
                    documentTitle: "Doc",
                    response: "A",
                })
            );

            expect(response.status).toBe(403);
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
                .mockImplementationOnce(() => createLimitedSelect([{ id: 9, companyId: 10n }]))
                .mockImplementationOnce(() =>
                    createWhereSelect([{ id: 1, question: "Q?", response: "A" }])
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
    });
});
