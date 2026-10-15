/**
 * The workspace polls GET /api/folders while a source is processing. On
 * 2026-10-15 that poll spent the one per-IP bucket every preset shared, and
 * the next "New folder" (POST /api/folders) answered 429. These run the real
 * route through the real limiter: a person's polling can exhaust only the
 * poll's own budget, never their writes, and never a colleague's.
 */

import { DELETE, GET, POST } from "~/app/api/folders/route";
import { clearRateLimitStore, RateLimitPresets } from "~/lib/rate-limiter";
import { makeWorkspaceContext } from "../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual("../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/folders", () => ({
    listVisibleFolders: jest.fn().mockResolvedValue([]),
}));
jest.mock("~/server/workspace/item-access", () => ({
    accessSubject: jest.fn().mockResolvedValue({}),
}));
jest.mock("~/server/workspace/folder-actions", () => ({
    createFolderAs: jest.fn().mockResolvedValue({ path: "Reports", created: ["Reports"] }),
    deleteFolderAs: jest.fn().mockResolvedValue({ path: "Reports", movedTo: "" }),
    renameFolderAs: jest.fn(),
}));

// `better-auth.session_token=<user>` is <user>'s session.
jest.mock("~/server/auth", () => ({
    getSessionFromHeaders: (headers: Headers) => {
        const token = /better-auth\.session_token=([^;]+)/.exec(headers.get("cookie") ?? "")?.[1];
        return Promise.resolve(token ? { user: { id: token } } : null);
    },
}));

const OFFICE_IP = "198.51.100.20";
const POLL_BUDGET = RateLimitPresets.permissive.maxRequests;
const WRITE_BUDGET = RateLimitPresets.standard.maxRequests;

function request(method: string, user: string, body?: unknown): Request {
    return new Request("http://localhost/api/folders", {
        method,
        headers: {
            "x-forwarded-for": OFFICE_IP,
            cookie: `better-auth.session_token=${user}`,
            ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

/** What the workspace sends while a source is processing: GET /api/folders, until refused. */
async function pollUntilRefused(user: string): Promise<number> {
    for (let polls = 0; polls <= POLL_BUDGET * 2; polls++) {
        const response = await GET(request("GET", user));
        if (response.status === 429) return polls;
        expect(response.status).toBe(200);
    }
    throw new Error("GET /api/folders was never rate limited");
}

describe("/api/folders rate limits", () => {
    beforeEach(() => {
        clearRateLimitStore();
        mockRequireWorkspaceContext.mockImplementation(() => ({
            success: true,
            data: makeWorkspaceContext({ role: "owner" }),
        }));
    });

    it("a user's poll traffic does not cause a POST /api/folders 429", async () => {
        // The poll runs until it has spent its whole read budget...
        expect(await pollUntilRefused("user_alice")).toBe(POLL_BUDGET);

        // ...and the user's next folder write still goes through, with its
        // whole budget intact.
        const created = await POST(request("POST", "user_alice", { path: "Reports" }));
        expect(created.status).toBe(201);
        expect(created.headers.get("X-RateLimit-Limit")).toBe(String(WRITE_BUDGET));
        expect(created.headers.get("X-RateLimit-Remaining")).toBe(String(WRITE_BUDGET - 1));
    });

    it("keeps a write's budget from being spent by another write method", async () => {
        for (let i = 0; i < WRITE_BUDGET; i++) {
            expect(
                (await DELETE(request("DELETE", "user_alice", { path: "Reports" }))).status
            ).toBe(200);
        }
        expect((await DELETE(request("DELETE", "user_alice", { path: "Reports" }))).status).toBe(
            429
        );
        expect((await POST(request("POST", "user_alice", { path: "Reports" }))).status).toBe(201);
    });

    it("leaves a colleague behind the same office IP untouched", async () => {
        await pollUntilRefused("user_alice");

        const listed = await GET(request("GET", "user_bob"));
        expect(listed.status).toBe(200);
        expect(listed.headers.get("X-RateLimit-Remaining")).toBe(String(POLL_BUDGET - 1));
        expect((await POST(request("POST", "user_bob", { path: "Reports" }))).status).toBe(201);
    });
});
