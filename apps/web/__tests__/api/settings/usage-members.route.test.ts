/**
 * Settings › Usage › AI limits per person, the routes: an admin's choice for
 * one person is validated before it reaches the store, an unknown person is a
 * 404, and the list says whether the viewer may edit. The 403s for members
 * live in permission-gates.test.ts.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type * as MembersModule from "~/server/ai-usage/members";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

const mockList = jest.fn();
const mockUpdate = jest.fn();
jest.mock("~/server/ai-usage/members", () => ({
    memberLimitChoiceSchema: jest.requireActual<typeof MembersModule>("~/server/ai-usage/members")
        .memberLimitChoiceSchema,
    memberAllowances: (...args: unknown[]) => mockList(...args),
    updateMemberLimit: (...args: unknown[]) => mockUpdate(...args),
}));

import { GET } from "~/app/api/settings/usage/members/route";
import { PUT } from "~/app/api/settings/usage/members/[userId]/route";
import { notFound } from "~/server/workspace/errors";

const params = (userId: string) => ({ params: Promise.resolve({ userId }) });
const put = (body: unknown) =>
    new Request("http://localhost/api/settings/usage/members/u-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

function signedInAs(role: string) {
    const ctx = makeWorkspaceContext({ role });
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: ctx });
    return ctx;
}

beforeEach(() => {
    mockList.mockReset();
    mockUpdate.mockReset();
});

describe("PUT /api/settings/usage/members/[userId]", () => {
    it.each([
        [{ mode: "default" }],
        [{ mode: "none" }],
        [{ mode: "custom", monthlyTokens: 250_000 }],
    ])("stores %j for the person", async choice => {
        const ctx = signedInAs("admin");
        mockUpdate.mockResolvedValue({ authUserId: "u-1", choice });
        const response = await PUT(put(choice), params("u-1"));
        expect(response.status).toBe(200);
        expect(mockUpdate).toHaveBeenCalledWith(ctx, "u-1", choice);
        await expect(response.json()).resolves.toEqual({ member: { authUserId: "u-1", choice } });
    });

    it.each([
        [{ mode: "custom", monthlyTokens: 0 }],
        [{ mode: "custom", monthlyTokens: 1.5 }],
        [{ mode: "custom" }],
        [{ mode: "unlimited" }],
    ])("refuses %j before it reaches the store", async body => {
        signedInAs("admin");
        const response = await PUT(put(body), params("u-1"));
        expect(response.status).toBe(400);
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("answers 404 for someone who isn't in the workspace", async () => {
        signedInAs("admin");
        mockUpdate.mockRejectedValue(notFound());
        const response = await PUT(put({ mode: "none" }), params("stranger"));
        expect(response.status).toBe(404);
    });

    it("decodes an encoded user id", async () => {
        const ctx = signedInAs("owner");
        mockUpdate.mockResolvedValue({});
        await PUT(put({ mode: "none" }), params("user%3Aabc"));
        expect(mockUpdate).toHaveBeenCalledWith(ctx, "user:abc", { mode: "none" });
    });
});

describe("GET /api/settings/usage/members", () => {
    it("says whether the viewer may change limits", async () => {
        mockList.mockResolvedValue({ members: [] });
        signedInAs("admin");
        await expect((await GET(new Request("http://localhost/x"))).json()).resolves.toEqual({
            members: [],
            canEdit: true,
        });

        const analyst = makeWorkspaceContext({ permissions: ["analytics.view"] });
        mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: analyst });
        await expect((await GET(new Request("http://localhost/x"))).json()).resolves.toEqual({
            members: [],
            canEdit: false,
        });
    });
});
