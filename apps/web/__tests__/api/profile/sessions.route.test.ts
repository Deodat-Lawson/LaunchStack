/**
 * Settings › Account's devices list. What must not regress: it answers on a
 * sign-in of any age (Better Auth's own list-sessions said "Session is not
 * fresh" after a day), it never sends a session's token, and ending a
 * session works by id on the caller's own sessions only — never the current
 * one, never someone else's.
 */

/** @jest-environment node */

const mockGetServerSession = jest.fn();
const mockListSessions = jest.fn();
const mockDeleteSession = jest.fn();
jest.mock("~/server/auth", () => ({
    getServerSession: () => mockGetServerSession(),
    auth: {
        $context: Promise.resolve({
            internalAdapter: {
                listSessions: (...args: unknown[]) => mockListSessions(...args),
                deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
            },
        }),
    },
}));

import { DELETE, GET } from "~/app/api/profile/sessions/route";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function row(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        token: `token-${id}`,
        userId: "u1",
        createdAt: new Date(now - 10 * DAY),
        updatedAt: new Date(now - DAY),
        expiresAt: new Date(now + 5 * DAY),
        ipAddress: "10.0.0.1",
        userAgent: "Mozilla/5.0 (Macintosh) Chrome/130",
        ...overrides,
    };
}

/** Signed in ten days ago: far past Better Auth's one-day freshAge. */
const staleSession = {
    user: { id: "u1" },
    session: { id: "s-current", createdAt: new Date(now - 10 * DAY) },
};

const del = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/profile/sessions", {
        method: "DELETE",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    });

beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue(staleSession);
    mockListSessions.mockResolvedValue([
        row("s-old", { updatedAt: new Date(now - 3 * DAY) }),
        row("s-current", { updatedAt: new Date(now) }),
        row("s-expired", { expiresAt: new Date(now - 1000) }),
        row("s-recent", { updatedAt: new Date(now - 1000) }),
    ]);
});

describe("GET /api/profile/sessions", () => {
    it("lists the caller's devices on a sign-in older than a day", async () => {
        const res = await GET(new Request("http://localhost/api/profile/sessions"));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { sessions: Array<Record<string, unknown>> };
        expect(mockListSessions).toHaveBeenCalledWith("u1", { onlyActiveSessions: true });
        // Current first, then by last activity; the expired one is gone.
        expect(body.sessions.map(s => s.id)).toEqual(["s-current", "s-recent", "s-old"]);
        expect(body.sessions.map(s => s.current)).toEqual([true, false, false]);
    });

    it("never sends a session token", async () => {
        const res = await GET(new Request("http://localhost/api/profile/sessions"));
        const text = await res.text();
        expect(text).not.toContain("token");
    });

    it("refuses a caller who isn't signed in", async () => {
        mockGetServerSession.mockResolvedValue(null);
        const res = await GET(new Request("http://localhost/api/profile/sessions"));
        expect(res.status).toBe(401);
        expect(mockListSessions).not.toHaveBeenCalled();
    });
});

describe("DELETE /api/profile/sessions", () => {
    it("ends one of the caller's other sessions by id", async () => {
        const res = await DELETE(del({ id: "s-old" }));
        expect(res.status).toBe(200);
        expect(mockDeleteSession).toHaveBeenCalledWith("token-s-old");
    });

    it("won't end the current session", async () => {
        const res = await DELETE(del({ id: "s-current" }));
        expect(res.status).toBe(400);
        expect(mockDeleteSession).not.toHaveBeenCalled();
    });

    it("treats an id that isn't the caller's as already ended", async () => {
        const res = await DELETE(del({ id: "someone-elses" }));
        expect(res.status).toBe(404);
        expect(mockDeleteSession).not.toHaveBeenCalled();
    });

    it("refuses a cross-site request", async () => {
        const res = await DELETE(del({ id: "s-old" }, { "sec-fetch-site": "same-site" }));
        expect(res.status).toBe(403);
        expect(mockDeleteSession).not.toHaveBeenCalled();
    });

    it("refuses a body with no id", async () => {
        const res = await DELETE(del({}));
        expect(res.status).toBe(400);
        expect(mockDeleteSession).not.toHaveBeenCalled();
    });
});
