/**
 * An anonymous visit to a protected page is sent to /signin with the page it
 * asked for in `?next=`, so a link opened from an email or a bookmark lands
 * where it pointed once the person has signed in. The sign-in page only
 * follows same-origin paths (safeNextPath), which is why carrying the raw
 * path and query here is safe.
 */

import { NextRequest } from "next/server";

const mockGetSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();

jest.mock("~/server/auth", () => ({
    getSessionFromHeaders: () => mockGetSession(),
}));

import middleware from "~/middleware";

function runAnonymous(pathAndQuery: string) {
    mockGetSession.mockResolvedValue(null);
    return middleware(new NextRequest(new URL(`http://localhost${pathAndQuery}`)));
}

describe("middleware sign-in redirect", () => {
    it("keeps the requested page and its query in ?next=", async () => {
        const response = await runAnonymous("/employer/documents?source=m12&edit=1");

        expect(response?.status).toBe(307);
        const location = new URL(response!.headers.get("location")!);
        expect(location.pathname).toBe("/signin");
        expect(location.searchParams.get("next")).toBe("/employer/documents?source=m12&edit=1");
    });

    it("carries a bare protected path too", async () => {
        const response = await runAnonymous("/workspaces");

        const location = new URL(response!.headers.get("location")!);
        expect(location.searchParams.get("next")).toBe("/workspaces");
    });

    it("sends the bare root to /signin without a next", async () => {
        const response = await runAnonymous("/");

        expect(response?.headers.get("location")).toBe("http://localhost/signin");
    });
});
