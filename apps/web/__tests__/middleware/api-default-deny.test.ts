/**
 * Middleware default-deny for /api/*: anything not on the public allowlist
 * needs a session, and the rejection is a JSON 401 rather than a page-shaped
 * redirect to /signin.
 */

import { NextRequest } from "next/server";

const mockGetSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();

jest.mock("~/server/auth", () => ({
    getSessionFromHeaders: () => mockGetSession(),
}));

import middleware from "~/middleware";

function run(pathname: string, userId: string | null) {
    mockGetSession.mockResolvedValue(userId ? { user: { id: userId } } : null);
    // The middleware only consults the session when a session cookie exists
    // (the anonymous fast-path), so an authenticated request must carry one.
    const req = new NextRequest(new URL(`http://localhost${pathname}`), {
        headers: userId ? { cookie: "better-auth.session_token=tok" } : {},
    });
    return middleware(req);
}

const PUBLIC_API_PATHS = [
    "/api/auth/sign-in/email",
    "/api/health",
    "/api/webhooks/uploadthing",
    "/api/inngest",
    "/api/invite-codes/validate",
    "/api/ocr/benchmark",
    "/api/metrics",
    "/api/uploadthing",
    "/api/files/123",
    "/api/collab/hub/v1/nodes",
    "/api/collab/slack/events",
    // Clicked from a mail client with no session. Its route docblock has always
    // said "Public (no auth)", but the allowlist entry was missing, so the
    // default-deny below answered every unsubscribe click with a 401 — including
    // the RFC 8058 one-click POST.
    "/api/email-pipeline/unsubscribe/some-hmac-token",
];

const PROTECTED_API_PATHS = [
    "/api/uploadDocument",
    "/api/signup/employee",
    "/api/config/ocr",
    "/api/experimental/embedding-search",
    "/api/upload-local",
    "/api/documents/1",
    "/api/invite-codes/generate",
    "/api/collab/agents",
    "/api/collab/meetings",
];

describe("middleware /api default-deny", () => {
    it.each(PUBLIC_API_PATHS)("lets anonymous requests through to %s", async path => {
        await expect(run(path, null)).resolves.toBeUndefined();
    });

    it.each(PROTECTED_API_PATHS)("rejects anonymous requests to %s with 401", async path => {
        const response = await run(path, null);

        expect(response?.status).toBe(401);
        await expect(response?.json()).resolves.toEqual({ error: "Unauthorized" });
    });

    it.each(PROTECTED_API_PATHS)("lets authenticated requests through to %s", async path => {
        await expect(run(path, "user_abc")).resolves.toBeUndefined();
    });

    it("does not redirect API callers to /signin", async () => {
        const response = await run("/api/uploadDocument", null);

        expect(response?.status).toBe(401);
        expect(response?.headers.get("location")).toBeNull();
    });

    it("treats a session cookie that fails verification as anonymous", async () => {
        // Cookie present, but the session read rejects (bad signature, DB gone).
        mockGetSession.mockRejectedValue(new Error("verification failed"));
        const consoleSpy = jest.spyOn(console, "error").mockImplementation();

        const req = new NextRequest(new URL("http://localhost/api/uploadDocument"), {
            headers: { cookie: "better-auth.session_token=garbage" },
        });
        const response = await middleware(req);

        expect(response?.status).toBe(401);
        consoleSpy.mockRestore();
    });
});
