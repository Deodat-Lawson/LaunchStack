import { describe, expect, it } from "vitest";

import {
    UnsafeUrlError,
    assertPublicUrl,
    fetchReadable,
    htmlToReadableText,
    isPrivateAddress,
} from "./fetch";

const publicLookup = async () => ["93.184.216.34"];

describe("isPrivateAddress", () => {
    it("flags every private and special range", () => {
        for (const ip of [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
        ]) {
            expect(isPrivateAddress(ip), ip).toBe(true);
        }
    });
    it("passes public addresses", () => {
        expect(isPrivateAddress("93.184.216.34")).toBe(false);
        expect(isPrivateAddress("172.32.0.1")).toBe(false);
        expect(isPrivateAddress("2606:4700::1111")).toBe(false);
        expect(isPrivateAddress("::ffff:93.184.216.34")).toBe(false);
    });
});

describe("assertPublicUrl", () => {
    it("refuses non-http schemes, credentials, local names and private resolutions", async () => {
        await expect(assertPublicUrl("file:///etc/passwd", publicLookup)).rejects.toBeInstanceOf(
            UnsafeUrlError
        );
        await expect(
            assertPublicUrl("http://user:pw@example.com/", publicLookup)
        ).rejects.toBeInstanceOf(UnsafeUrlError);
        await expect(
            assertPublicUrl("http://localhost:3000/", publicLookup)
        ).rejects.toBeInstanceOf(UnsafeUrlError);
        await expect(
            assertPublicUrl("http://169.254.169.254/latest/meta-data", publicLookup)
        ).rejects.toBeInstanceOf(UnsafeUrlError);
        await expect(
            assertPublicUrl("http://internal.example.com/", async () => ["10.0.0.5"])
        ).rejects.toBeInstanceOf(UnsafeUrlError);
        await expect(
            assertPublicUrl("http://dual.example.com/", async () => [
                "93.184.216.34",
                "192.168.0.2",
            ])
        ).rejects.toBeInstanceOf(UnsafeUrlError);
    });
    it("accepts a public resolution", async () => {
        const url = await assertPublicUrl("https://example.com/path?q=1", publicLookup);
        expect(url.hostname).toBe("example.com");
    });
});

describe("htmlToReadableText", () => {
    it("drops scripts and styles, keeps block breaks and link targets", () => {
        const { title, text } = htmlToReadableText(`
            <html><head><title> Our  Brands </title><style>p{}</style></head>
            <body><script>alert(1)</script>
            <h1>Brands we carry</h1>
            <ul><li>Acme &amp; Sons</li><li><a href="https://beta.example/">Beta Foods</a></li></ul>
            <p>Since&nbsp;1990</p></body></html>`);
        expect(title).toBe("Our Brands");
        expect(text).toContain("Brands we carry");
        expect(text).toContain("Acme & Sons");
        expect(text).toContain("Beta Foods (https://beta.example/)");
        expect(text).toContain("Since 1990");
        expect(text).not.toContain("alert(1)");
        expect(text.split("\n").length).toBeGreaterThan(2);
    });
});

describe("fetchReadable", () => {
    function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
        return (async (input: RequestInfo | URL) => {
            const key =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const route = routes[key];
            if (!route) return new Response("not found", { status: 404 });
            return route();
        }) as typeof fetch;
    }

    it("follows a redirect, re-checks it, and returns readable text", async () => {
        const fetchImpl = fakeFetch({
            "https://example.com/": () =>
                new Response(null, { status: 301, headers: { location: "/brands" } }),
            "https://example.com/brands": () =>
                new Response(
                    "<html><title>B</title><body><p>Hello <b>world</b></p></body></html>",
                    {
                        status: 200,
                        headers: { "content-type": "text/html" },
                    }
                ),
        });
        const page = await fetchReadable("https://example.com/", {
            fetchImpl,
            lookup: publicLookup,
        });
        expect(page.finalUrl).toBe("https://example.com/brands");
        expect(page.title).toBe("B");
        expect(page.text).toBe("Hello world");
        expect(page.truncated).toBe(false);
    });

    it("refuses a redirect into a private network", async () => {
        const fetchImpl = fakeFetch({
            "https://example.com/": () =>
                new Response(null, {
                    status: 302,
                    headers: { location: "http://127.0.0.1:8080/admin" },
                }),
        });
        await expect(
            fetchReadable("https://example.com/", { fetchImpl, lookup: publicLookup })
        ).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it("caps the body and reports truncation", async () => {
        const big = "<html><body>" + "x".repeat(10_000) + "</body></html>";
        const fetchImpl = fakeFetch({
            "https://example.com/big": () =>
                new Response(big, { status: 200, headers: { "content-type": "text/html" } }),
        });
        const page = await fetchReadable("https://example.com/big", {
            fetchImpl,
            lookup: publicLookup,
            maxBytes: 1_000,
        });
        expect(page.truncated).toBe(true);
        expect(page.text.length).toBeLessThanOrEqual(1_000);
    });

    it("stops after maxRedirects", async () => {
        const fetchImpl = fakeFetch({
            "https://example.com/a": () =>
                new Response(null, { status: 302, headers: { location: "/b" } }),
            "https://example.com/b": () =>
                new Response(null, { status: 302, headers: { location: "/a" } }),
        });
        await expect(
            fetchReadable("https://example.com/a", {
                fetchImpl,
                lookup: publicLookup,
                maxRedirects: 2,
            })
        ).rejects.toMatchObject({ code: "too_many_redirects" });
    });
});
