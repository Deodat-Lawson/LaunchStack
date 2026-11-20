/**
 * "Add another account" sends a signed-in person to /signin?add=1 (or
 * /signup?add=1). Plain /signin still bounces a signed-in person to their
 * workspace — the loop protection the sign-in page relies on — but the flag
 * lets them through to the form, whatever their memberships look like.
 */

import { NextRequest } from "next/server";

const mockGetSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();

jest.mock("~/server/auth", () => ({
    getSessionFromHeaders: () => mockGetSession(),
}));

// The middleware's own DB client: each select answers from this queue, in
// order — the users row, then the membership counts by status.
const mockSelects: unknown[][] = [];
jest.mock("postgres", () => () => ({}));
jest.mock("drizzle-orm/postgres-js", () => ({
    drizzle: () => ({
        select: () => {
            const result = mockSelects.shift() ?? [];
            const chain: Record<string, unknown> = {};
            for (const method of ["from", "where", "groupBy"]) chain[method] = () => chain;
            chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(result);
            return chain;
        },
    }),
}));

import middleware from "~/middleware";

let nextUser = 0;

/** A signed-in request from a fresh user id (the middleware caches by id). */
function signedIn(pathAndQuery: string, memberships: { status: string; c: number }[]) {
    const userId = `user_${++nextUser}`;
    mockGetSession.mockResolvedValue({ user: { id: userId } });
    mockSelects.length = 0;
    mockSelects.push([{ id: nextUser }], memberships);
    return middleware(
        new NextRequest(new URL(`http://localhost${pathAndQuery}`), {
            headers: { cookie: "better-auth.session_token=tok" },
        })
    );
}

const TWO_WORKSPACES = [{ status: "active", c: 2 }];
const NONE_ACTIVE = [{ status: "pending", c: 1 }];

describe("middleware and adding another account", () => {
    beforeAll(() => {
        process.env.DATABASE_URL ??= "postgres://test@localhost/test";
    });
    beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
    afterEach(() => jest.restoreAllMocks());

    it("still sends a signed-in person away from plain /signin", async () => {
        const response = await signedIn("/signin", TWO_WORKSPACES);

        expect(response?.status).toBe(307);
        expect(response?.headers.get("location")).toBe("http://localhost/workspaces");
    });

    it("and from plain /signup", async () => {
        const response = await signedIn("/signup", TWO_WORKSPACES);

        expect(response?.headers.get("location")).toBe("http://localhost/workspaces");
    });

    it("lets a signed-in person through to /signin?add=1", async () => {
        await expect(signedIn("/signin?add=1", TWO_WORKSPACES)).resolves.toBeUndefined();
    });

    it("keeps ?next= working alongside the flag", async () => {
        await expect(
            signedIn("/signin?add=1&next=%2Fworkspaces", TWO_WORKSPACES)
        ).resolves.toBeUndefined();
    });

    it("lets them through to /signup?add=1 to make a brand-new account", async () => {
        await expect(signedIn("/signup?add=1", TWO_WORKSPACES)).resolves.toBeUndefined();
    });

    it("lets someone with no active workspace add an account too", async () => {
        // Without the flag this person is held on the pending page.
        const held = await signedIn("/signin", NONE_ACTIVE);
        expect(held?.headers.get("location")).toBe("http://localhost/employer/pending-approval");

        await expect(signedIn("/signin?add=1", NONE_ACTIVE)).resolves.toBeUndefined();
    });

    it.each(["/signin?add=0", "/signin?add=true", "/signin?add"])(
        "only takes add=1 as the flag (%s is plain sign-in)",
        async path => {
            const response = await signedIn(path, TWO_WORKSPACES);
            expect(response?.headers.get("location")).toBe("http://localhost/workspaces");
        }
    );

    it("doesn't open anything else: the flag on a protected page changes nothing", async () => {
        mockGetSession.mockResolvedValue(null);
        const response = await middleware(
            new NextRequest(new URL("http://localhost/workspaces?add=1"))
        );

        expect(response?.status).toBe(307);
        expect(new URL(response!.headers.get("location")!).pathname).toBe("/signin");
    });

    it("leaves an anonymous visitor on /signin?add=1", async () => {
        mockGetSession.mockResolvedValue(null);
        await expect(
            middleware(new NextRequest(new URL("http://localhost/signin?add=1")))
        ).resolves.toBeUndefined();
    });
});
