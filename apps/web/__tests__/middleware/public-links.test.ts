/**
 * Public links (ADR-016) in the middleware: the page needs no session, and
 * `/s/<token>.md` (or the page asked for as Markdown) is answered by the
 * Markdown route, for an AI agent.
 */

import { NextRequest } from "next/server";

import { publicLinkMarkdownRewrite } from "~/lib/public-link-paths";

const mockGetSession = jest.fn<Promise<{ user: { id: string } } | null>, []>();
jest.mock("~/server/auth", () => ({
    getSessionFromHeaders: () => mockGetSession(),
}));

import middleware from "~/middleware";

const TOKEN = "public-link-test-token-xxxxxxxxxxxxxxxxxxxx";

function run(pathname: string, accept?: string) {
    mockGetSession.mockResolvedValue(null);
    return middleware(
        new NextRequest(new URL(`http://localhost${pathname}`), {
            headers: accept ? { accept } : {},
        })
    );
}

describe("publicLinkMarkdownRewrite", () => {
    it("sends /s/<token>.md to the Markdown route", () => {
        expect(publicLinkMarkdownRewrite(`/s/${TOKEN}.md`, null)).toBe(`/api/s/${TOKEN}/markdown`);
    });

    it("sends the page to the Markdown route only when Markdown is wanted and HTML is not", () => {
        expect(publicLinkMarkdownRewrite(`/s/${TOKEN}`, "text/markdown")).toBe(
            `/api/s/${TOKEN}/markdown`
        );
        expect(publicLinkMarkdownRewrite(`/s/${TOKEN}`, "text/markdown, text/plain;q=0.9")).toBe(
            `/api/s/${TOKEN}/markdown`
        );
        // A browser asks for HTML: it gets the page.
        expect(
            publicLinkMarkdownRewrite(`/s/${TOKEN}`, "text/html,application/xhtml+xml,*/*;q=0.8")
        ).toBeNull();
        expect(publicLinkMarkdownRewrite(`/s/${TOKEN}`, "text/markdown, text/html")).toBeNull();
        expect(publicLinkMarkdownRewrite(`/s/${TOKEN}`, null)).toBeNull();
    });

    it("ignores anything that is not a token-shaped public link", () => {
        expect(publicLinkMarkdownRewrite("/s/short.md", null)).toBeNull();
        expect(publicLinkMarkdownRewrite(`/s/${TOKEN}/x.md`, null)).toBeNull();
        expect(publicLinkMarkdownRewrite(`/employer/s/${TOKEN}.md`, null)).toBeNull();
        expect(publicLinkMarkdownRewrite(`/s/${TOKEN}!.md`, null)).toBeNull();
    });
});

describe("middleware and public links", () => {
    it("rewrites /s/<token>.md for an anonymous caller", async () => {
        const res = await run(`/s/${TOKEN}.md`);
        expect(res?.headers.get("x-middleware-rewrite")).toBe(
            `http://localhost/api/s/${TOKEN}/markdown`
        );
    });

    it("lets an anonymous browser open the page itself", async () => {
        const res = await run(`/s/${TOKEN}`, "text/html");
        expect(res?.headers.get("location") ?? null).toBeNull();
        expect(res?.headers.get("x-middleware-rewrite") ?? null).toBeNull();
    });
});

describe("the public link page's headers", () => {
    it("is never indexed, cached, or sent on as a Referer", async () => {
        const res = await run(`/s/${TOKEN}`, "text/html");
        expect(res?.headers.get("x-robots-tag")).toContain("noindex");
        expect(res?.headers.get("referrer-policy")).toBe("no-referrer");
        expect(res?.headers.get("cache-control")).toBe("private, no-store");
    });
});

describe("the public link page's rate limit", () => {
    it("gives each visitor 300 page views per 15 minutes, then a 429", async () => {
        const visit = () => {
            mockGetSession.mockResolvedValue(null);
            return middleware(
                new NextRequest(new URL(`http://localhost/s/${TOKEN}`), {
                    headers: { accept: "text/html", "x-forwarded-for": "203.0.113.9" },
                })
            );
        };
        for (let i = 0; i < 300; i++) {
            const res = await visit();
            expect(res?.status ?? 200).not.toBe(429);
        }
        const refused = await visit();
        expect(refused?.status).toBe(429);
        expect(refused?.headers.get("retry-after")).toBeTruthy();
        expect(refused?.headers.get("x-robots-tag")).toContain("noindex");

        // Another visitor is unaffected.
        mockGetSession.mockResolvedValue(null);
        const other = await middleware(
            new NextRequest(new URL(`http://localhost/s/${TOKEN}`), {
                headers: { accept: "text/html", "x-forwarded-for": "198.51.100.4" },
            })
        );
        expect(other?.status ?? 200).not.toBe(429);
    });
});
