/**
 * Join links used to be `/signup?code=…`, and that route lost the code the
 * moment a signed-out person clicked "Sign in" (the link carried no `next`).
 * Every such link now lands on `/join/<code>`, which keeps it across sign-in
 * and sign-up — for anonymous visitors and signed-in people alike — and the
 * join and invite pages themselves are reachable without a session.
 */

import { NextRequest } from "next/server";

const mockGetSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();

jest.mock("~/server/auth", () => ({
    getSessionFromHeaders: () => mockGetSession(),
}));

import middleware from "~/middleware";

function run(pathAndQuery: string, signedIn = false) {
    mockGetSession.mockResolvedValue(signedIn ? { user: { id: "user_abc" } } : null);
    return middleware(new NextRequest(new URL(`http://localhost${pathAndQuery}`)));
}

describe("middleware and join links", () => {
    beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
    afterEach(() => jest.restoreAllMocks());

    it("sends a legacy /signup?code= link to the join page", async () => {
        const response = await run("/signup?code=ABCD1234");

        expect(response?.status).toBe(307);
        expect(response?.headers.get("location")).toBe("http://localhost/join/abcd1234");
    });

    it("does the same for someone already signed in", async () => {
        const response = await run("/signup?code=ABCD1234", true);

        expect(response?.headers.get("location")).toBe("http://localhost/join/abcd1234");
    });

    it("leaves plain /signup alone", async () => {
        const response = await run("/signup");

        expect(response?.headers.get("location") ?? null).toBeNull();
    });

    it("lets anonymous visitors open the join and invite pages", async () => {
        for (const path of ["/join/abcd1234", "/invite/some-token"]) {
            const response = await run(path);
            expect(response?.headers.get("location") ?? null).toBeNull();
        }
    });
});
