import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

/**
 * The HTTP edge of shared chats (ADR-014): sharing, "Continue in a new chat",
 * and each person's pins / archive / unread. The services are exercised
 * against Postgres in `__tests__/server/sessions/chat-sharing.integration.test.ts`;
 * what is pinned here is what the routes add — the caller's own context goes
 * down (never an id from the body), bodies are validated before any service
 * runs, and "can't read it" is a 404 while "can read but not change" is a 403.
 */

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

const mockSharing = { get: jest.fn(), set: jest.fn() };
jest.mock("~/server/sessions/sharing", () => ({
    getChatSharing: (...args: unknown[]) => mockSharing.get(...args),
    setChatSharing: (...args: unknown[]) => mockSharing.set(...args),
}));
const mockFork = jest.fn();
jest.mock("~/server/sessions/fork", () => ({
    forkSession: (...args: unknown[]) => mockFork(...args),
}));
const mockState = { set: jest.fn(), reorder: jest.fn() };
jest.mock("~/server/sessions/user-state", () => ({
    setSessionState: (...args: unknown[]) => mockState.set(...args),
    reorderPins: (...args: unknown[]) => mockState.reorder(...args),
}));

import {
    GET as getSharing,
    PUT as putSharing,
} from "~/app/api/workspace/sessions/[sessionId]/sharing/route";
import { POST as forkRoute } from "~/app/api/workspace/sessions/[sessionId]/fork/route";
import { PATCH as stateRoute } from "~/app/api/workspace/sessions/[sessionId]/state/route";
import { POST as pinOrderRoute } from "~/app/api/workspace/sessions/pins/order/route";
import { forbidden, notFound } from "~/server/workspace/errors";

import { jsonRequest, params } from "./_setup";

const SHARING = {
    general: "private",
    grants: [
        {
            principalType: "user",
            principalId: "8",
            principalName: "Bea",
            level: "view",
            authUserId: "user-b",
        },
    ],
    canManage: true,
    owner: { authUserId: "user-a", name: "Ada" },
    workspaceName: "Acme",
    audienceCount: 2,
};

function asMember(overrides: Parameters<typeof makeWorkspaceContext>[0] = {}) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({
            authUserId: "user-a",
            userPk: BigInt(7),
            companyId: BigInt(42),
            role: "member",
            ...overrides,
        }),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    asMember();
});

describe("GET/PUT /api/workspace/sessions/{id}/sharing", () => {
    it("returns the ChatSharing shape the Share dialog's adapter reads", async () => {
        mockSharing.get.mockResolvedValue(SHARING);

        const res = await getSharing(new Request("http://t"), params({ sessionId: "s1" }));

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual(SHARING);
        const [ctx, id] = mockSharing.get.mock.calls[0]!;
        expect(ctx).toMatchObject({ authUserId: "user-a", companyId: BigInt(42) });
        expect(id).toBe("s1");
    });

    it("answers 404 for a chat the caller can't read", async () => {
        mockSharing.get.mockRejectedValue(notFound("Session not found"));
        const res = await getSharing(new Request("http://t"), params({ sessionId: "x" }));
        expect(res.status).toBe(404);
    });

    it("saves the adapter's body for the caller", async () => {
        mockSharing.set.mockResolvedValue({ ...SHARING, general: "workspace" });

        const res = await putSharing(
            jsonRequest("/api/workspace/sessions/s1/sharing", "PUT", {
                general: "workspace",
                grants: [{ principalType: "user", principalId: "8", level: "view" }],
            }),
            params({ sessionId: "s1" })
        );

        expect(res.status).toBe(200);
        const [ctx, id, body] = mockSharing.set.mock.calls[0]!;
        expect(ctx).toMatchObject({ authUserId: "user-a" });
        expect(id).toBe("s1");
        expect(body).toEqual({
            general: "workspace",
            grants: [{ principalType: "user", principalId: "8", level: "view" }],
        });
    });

    it("refuses any level but view, and a workspace principal smuggled in as a grant", async () => {
        for (const grants of [
            [{ principalType: "user", principalId: "8", level: "edit" }],
            [{ principalType: "workspace", principalId: "*", level: "view" }],
        ]) {
            const res = await putSharing(
                jsonRequest("/api/workspace/sessions/s1/sharing", "PUT", {
                    general: "private",
                    grants,
                }),
                params({ sessionId: "s1" })
            );
            expect(res.status).toBe(400);
        }
        expect(mockSharing.set).not.toHaveBeenCalled();
    });

    it("passes a reader's 403 through", async () => {
        mockSharing.set.mockRejectedValue(
            forbidden("Only the person who started this chat can share it.")
        );
        const res = await putSharing(
            jsonRequest("/api/workspace/sessions/s1/sharing", "PUT", {
                general: "private",
                grants: [],
            }),
            params({ sessionId: "s1" })
        );
        expect(res.status).toBe(403);
    });

    it("needs documents.read to share", async () => {
        asMember({ permissions: [] });
        const res = await putSharing(
            jsonRequest("/api/workspace/sessions/s1/sharing", "PUT", {
                general: "private",
                grants: [],
            }),
            params({ sessionId: "s1" })
        );
        expect(res.status).toBe(403);
        expect(mockSharing.set).not.toHaveBeenCalled();
    });
});

describe("POST /api/workspace/sessions/{id}/fork", () => {
    it("creates the caller's copy and answers 201 with its id", async () => {
        mockFork.mockResolvedValue({ id: "new-1", title: "Cap (copy)" });

        const res = await forkRoute(
            jsonRequest("/api/workspace/sessions/s1/fork", "POST"),
            params({ sessionId: "s1" })
        );

        expect(res.status).toBe(201);
        await expect(res.json()).resolves.toEqual({ id: "new-1", title: "Cap (copy)" });
        expect(mockFork.mock.calls[0]![0]).toMatchObject({ authUserId: "user-a" });
        expect(mockFork.mock.calls[0]![1]).toBe("s1");
    });

    it("answers 404 when the caller can't read the chat", async () => {
        mockFork.mockResolvedValue(null);
        const res = await forkRoute(
            jsonRequest("/api/workspace/sessions/x/fork", "POST"),
            params({ sessionId: "x" })
        );
        expect(res.status).toBe(404);
    });
});

describe("PATCH /api/workspace/sessions/{id}/state", () => {
    it("updates the caller's own state", async () => {
        mockState.set.mockResolvedValue({
            pinned: true,
            pinRank: -1,
            archived: false,
            lastSeenAt: null,
        });

        const res = await stateRoute(
            jsonRequest("/api/workspace/sessions/s1/state", "PATCH", { pinned: true }),
            params({ sessionId: "s1" })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            state: { pinned: true, pinRank: -1, archived: false, lastSeenAt: null },
        });
        expect(mockState.set.mock.calls[0]!.slice(1)).toEqual(["s1", { pinned: true }]);
    });

    it("refuses an empty or nonsense patch before touching anything", async () => {
        for (const body of [{}, { seen: false }, { pinned: "yes" }]) {
            const res = await stateRoute(
                jsonRequest("/api/workspace/sessions/s1/state", "PATCH", body),
                params({ sessionId: "s1" })
            );
            expect(res.status).toBe(400);
        }
        expect(mockState.set).not.toHaveBeenCalled();
    });

    it("answers 404 for a chat the caller can't read", async () => {
        mockState.set.mockResolvedValue(null);
        const res = await stateRoute(
            jsonRequest("/api/workspace/sessions/x/state", "PATCH", { archived: true }),
            params({ sessionId: "x" })
        );
        expect(res.status).toBe(404);
    });
});

describe("POST /api/workspace/sessions/pins/order", () => {
    it("rewrites the caller's pin order", async () => {
        mockState.reorder.mockResolvedValue(["b", "a"]);

        const res = await pinOrderRoute(
            jsonRequest("/api/workspace/sessions/pins/order", "POST", { ids: ["b", "a"] })
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ ids: ["b", "a"] });
        expect(mockState.reorder.mock.calls[0]![0]).toMatchObject({ authUserId: "user-a" });
        expect(mockState.reorder.mock.calls[0]![1]).toEqual(["b", "a"]);
    });

    it("refuses a body without ids", async () => {
        const res = await pinOrderRoute(
            jsonRequest("/api/workspace/sessions/pins/order", "POST", { order: "b,a" })
        );
        expect(res.status).toBe(400);
        expect(mockState.reorder).not.toHaveBeenCalled();
    });
});

describe("authentication", () => {
    it("never reaches a service without a workspace context", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(null, { status: 401 }),
        });
        const id = params({ sessionId: "s1" });
        expect((await getSharing(new Request("http://t"), id)).status).toBe(401);
        expect((await forkRoute(jsonRequest("/x", "POST"), id)).status).toBe(401);
        expect((await stateRoute(jsonRequest("/x", "PATCH", { seen: true }), id)).status).toBe(401);
        expect((await pinOrderRoute(jsonRequest("/x", "POST", { ids: [] }))).status).toBe(401);
        expect(mockSharing.get).not.toHaveBeenCalled();
        expect(mockFork).not.toHaveBeenCalled();
        expect(mockState.set).not.toHaveBeenCalled();
        expect(mockState.reorder).not.toHaveBeenCalled();
    });
});
