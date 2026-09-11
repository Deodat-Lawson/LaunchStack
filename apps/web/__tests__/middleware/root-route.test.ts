/**
 * Middleware behaviour at `/` after the apps/landing split.
 *
 * This origin is the product; the public site moved to its own origin. `/` is
 * therefore a redirect to /signin for anonymous visitors, and the redirect has
 * to happen in middleware — before the role lookup — rather than only in
 * app/page.tsx.
 *
 * The reason is the loop these tests exist to prevent. The role lookup fails
 * open (its catch logs and falls through), and the sign-in page bounces an
 * already-authenticated visitor back to "/". So if middleware were to hand an
 * *authenticated* request at `/` on to a page component that redirects to
 * /signin, an unreachable database would produce
 * `/` -> /signin -> / -> /signin -> ... forever.
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

describe("middleware at /", () => {
    it("redirects an anonymous visitor to /signin", async () => {
        const response = await run("/", null);

        expect(response?.status).toBe(307);
        expect(response?.headers.get("location")).toBe("http://localhost/signin");
    });

    it("never sends an authenticated request at / to /signin", async () => {
        // No DATABASE_URL under Jest, so the role lookup throws and the handler
        // takes its fail-open path. The property that matters is that it does not
        // answer with a /signin redirect — that edge is what would close the loop.
        const response = await run("/", "user_abc");

        expect(response?.headers.get("location")).not.toBe("http://localhost/signin");
    });

    it("does not redirect anonymous visitors away from /signin itself", async () => {
        await expect(run("/signin", null)).resolves.toBeUndefined();
    });
});

describe("middleware after the apps/landing split", () => {
    // These used to be listed in isPublicRoute. They are gone from this origin
    // entirely, so middleware should have no opinion about them — the request
    // falls through and Next answers 404.
    it.each(["/pricing", "/contact", "/deployment", "/about"])(
        "has no special handling for the relocated route %s",
        async path => {
            await expect(run(path, null)).resolves.toBeUndefined();
        }
    );
});
