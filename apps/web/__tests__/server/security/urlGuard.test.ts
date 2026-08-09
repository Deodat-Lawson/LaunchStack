/**
 * SSRF guard: only public http(s) URLs pass; literal or DNS-resolved private,
 * loopback, and link-local addresses are rejected.
 */

jest.mock("node:dns/promises", () => ({
    lookup: jest.fn(),
}));

import { lookup } from "node:dns/promises";
import {
    assertPublicHttpUrl,
    fetchPublicUrl,
    isPrivateAddress,
    UrlGuardError,
} from "~/server/security/url-guard";

const lookupMock = lookup as jest.MockedFunction<typeof lookup>;

function mockResolve(...addresses: string[]) {
    lookupMock.mockResolvedValue(
        addresses.map(address => ({ address, family: address.includes(":") ? 6 : 4 })) as never
    );
}

describe("isPrivateAddress", () => {
    it.each([
        "10.0.0.1",
        "10.255.255.255",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "172.31.99.99",
        "192.168.1.1",
        "0.0.0.0",
        "::1",
        "::",
        "fc00::1",
        "fd12:3456::1",
        "fe80::1",
        "::ffff:10.0.0.1",
        "::ffff:192.168.0.5",
        // IPv4-mapped (::ffff:0:0/96) in HEX notation — the bypass from the
        // review finding: ::ffff:7f00:1 is 127.0.0.1.
        "::ffff:7f00:1",
        "::ffff:a00:1", // 10.0.0.1
        "::ffff:c0a8:5", // 192.168.0.5
        "::ffff:a9fe:a9fe", // 169.254.169.254 (metadata service)
        // Uppercase and fully-uncompressed notations of the same address.
        "::FFFF:7F00:1",
        "0:0:0:0:0:ffff:7f00:1",
        "0000:0000:0000:0000:0000:ffff:7f00:0001",
        // IPv4-compatible (::/96, deprecated but still parsed by stacks).
        "::7f00:1", // 127.0.0.1
        "::127.0.0.1",
        // NAT64 (64:ff9b::/96) — translates to the embedded IPv4.
        "64:ff9b::7f00:1", // 127.0.0.1
        "64:ff9b::127.0.0.1",
        "64:ff9b::a9fe:a9fe", // 169.254.169.254
        "64:FF9B::0A00:0001", // 10.0.0.1, uppercase
    ])("classifies %s as private", ip => {
        expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each([
        "8.8.8.8",
        "1.1.1.1",
        "172.32.0.1",
        "172.15.0.1",
        "2606:4700::1111",
        "93.184.216.34",
        // Mapped/NAT64 forms of PUBLIC IPv4 addresses stay public.
        "::ffff:808:808", // ::ffff:8.8.8.8
        "::ffff:8.8.8.8",
        "64:ff9b::808:808", // NAT64 of 8.8.8.8
    ])("classifies %s as public", ip => {
        expect(isPrivateAddress(ip)).toBe(false);
    });
});

describe("assertPublicHttpUrl", () => {
    beforeEach(() => {
        lookupMock.mockReset();
    });

    it("rejects non-http(s) schemes", async () => {
        await expect(assertPublicHttpUrl("ftp://example.com/file")).rejects.toThrow(UrlGuardError);
        await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(UrlGuardError);
        expect(lookupMock).not.toHaveBeenCalled();
    });

    it("rejects malformed URLs", async () => {
        await expect(assertPublicHttpUrl("not a url")).rejects.toThrow(UrlGuardError);
    });

    it.each([
        "http://10.0.0.1/internal",
        "http://127.0.0.1:8000/admin",
        "http://169.254.169.254/latest/meta-data/",
        "http://172.16.0.10/",
        "http://192.168.1.1/router",
        "http://[::1]/",
        "http://[fc00::1]/",
        "http://[fe80::1]/",
        "http://[::ffff:7f00:1]/", // hex-mapped 127.0.0.1
        "http://[::ffff:a9fe:a9fe]/", // hex-mapped metadata service
        "http://[64:ff9b::7f00:1]/", // NAT64 of 127.0.0.1
    ])("rejects literal private IP %s without a DNS lookup", async url => {
        await expect(assertPublicHttpUrl(url)).rejects.toThrow(
            "URL resolves to a private or internal address"
        );
        expect(lookupMock).not.toHaveBeenCalled();
    });

    it("accepts a literal public IP without a DNS lookup", async () => {
        const parsed = await assertPublicHttpUrl("http://93.184.216.34/page");
        expect(parsed.hostname).toBe("93.184.216.34");
        expect(lookupMock).not.toHaveBeenCalled();
    });

    it("rejects localhost outright", async () => {
        await expect(assertPublicHttpUrl("http://localhost:3000/")).rejects.toThrow(UrlGuardError);
        await expect(assertPublicHttpUrl("http://foo.localhost/")).rejects.toThrow(UrlGuardError);
    });

    it("accepts a hostname that resolves to public addresses", async () => {
        mockResolve("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946");
        const parsed = await assertPublicHttpUrl("https://example.com/docs");
        expect(parsed.hostname).toBe("example.com");
        expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
    });

    it("rejects a hostname that resolves to a private address", async () => {
        mockResolve("10.20.30.40");
        await expect(assertPublicHttpUrl("https://internal.example.com/")).rejects.toThrow(
            "URL resolves to a private or internal address"
        );
    });

    it("rejects when ANY resolved address is private (rebinding-style split answer)", async () => {
        mockResolve("93.184.216.34", "192.168.0.10");
        await expect(assertPublicHttpUrl("https://sneaky.example.com/")).rejects.toThrow(
            "URL resolves to a private or internal address"
        );
    });

    it("rejects unresolvable hosts", async () => {
        lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
        await expect(assertPublicHttpUrl("https://does-not-exist.example/")).rejects.toThrow(
            "Unable to resolve URL host"
        );
    });

    it("rejects a hostname whose DNS answer is a hex-mapped private IPv6", async () => {
        mockResolve("::ffff:7f00:1");
        await expect(assertPublicHttpUrl("https://sneaky.example.com/")).rejects.toThrow(
            "URL resolves to a private or internal address"
        );
    });
});

describe("fetchPublicUrl", () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();

    /** Minimal Response stand-in: status + headers is all the loop reads. */
    function response(status: number, headers: Record<string, string> = {}): Response {
        const lower = Object.fromEntries(
            Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
        );
        return {
            status,
            ok: status >= 200 && status < 300,
            headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
            body: undefined,
        } as unknown as Response;
    }

    beforeEach(() => {
        lookupMock.mockReset();
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it("returns a non-redirect response directly, forcing manual redirects", async () => {
        const final = response(200);
        fetchMock.mockResolvedValueOnce(final);

        const result = await fetchPublicUrl("http://93.184.216.34/page");

        expect(result).toBe(final);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "http://93.184.216.34/page",
            expect.objectContaining({ redirect: "manual" })
        );
    });

    it("validates the initial URL before fetching at all", async () => {
        await expect(fetchPublicUrl("http://127.0.0.1/admin")).rejects.toThrow(UrlGuardError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("follows a public redirect chain and returns the final response", async () => {
        mockResolve("93.184.216.34");
        const final = response(200);
        fetchMock
            .mockResolvedValueOnce(response(301, { Location: "https://cdn.example.com/real" }))
            .mockResolvedValueOnce(final);

        const result = await fetchPublicUrl("http://93.184.216.34/start");

        expect(result).toBe(final);
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "https://cdn.example.com/real",
            expect.objectContaining({ redirect: "manual" })
        );
    });

    it("rejects a redirect to a literal private IP at the hop, without fetching it", async () => {
        fetchMock.mockResolvedValueOnce(
            response(302, { Location: "http://169.254.169.254/latest/meta-data/" })
        );

        await expect(fetchPublicUrl("http://93.184.216.34/start")).rejects.toThrow(
            "URL resolves to a private or internal address"
        );
        expect(fetchMock).toHaveBeenCalledTimes(1); // the private hop was never fetched
    });

    it("rejects a redirect whose host resolves to a private address via DNS", async () => {
        lookupMock.mockResolvedValue([{ address: "10.0.0.9", family: 4 }] as never);
        fetchMock.mockResolvedValueOnce(
            response(307, { Location: "https://internal.example.com/secret" })
        );

        await expect(fetchPublicUrl("http://93.184.216.34/start")).rejects.toThrow(
            "URL resolves to a private or internal address"
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects a redirect to the hex-mapped IPv6 loopback", async () => {
        fetchMock.mockResolvedValueOnce(
            response(302, { Location: "http://[::ffff:7f00:1]/" })
        );

        await expect(fetchPublicUrl("http://93.184.216.34/start")).rejects.toThrow(
            "URL resolves to a private or internal address"
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("refuses non-http(s) Location targets", async () => {
        fetchMock.mockResolvedValueOnce(
            response(303, { Location: "file:///etc/passwd" })
        );

        await expect(fetchPublicUrl("http://93.184.216.34/start")).rejects.toThrow(
            "Redirect target uses an unsupported scheme"
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("resolves relative Location headers against the current hop", async () => {
        const final = response(200);
        fetchMock
            .mockResolvedValueOnce(response(302, { Location: "/moved" }))
            .mockResolvedValueOnce(final);

        const result = await fetchPublicUrl("http://93.184.216.34/start");

        expect(result).toBe(final);
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "http://93.184.216.34/moved",
            expect.objectContaining({ redirect: "manual" })
        );
    });

    it("rejects a redirect with no Location header", async () => {
        fetchMock.mockResolvedValueOnce(response(301));

        await expect(fetchPublicUrl("http://93.184.216.34/start")).rejects.toThrow(
            "Redirect response is missing a Location header"
        );
    });

    it("gives up after the maximum number of redirect hops", async () => {
        fetchMock.mockResolvedValue(response(302, { Location: "http://93.184.216.34/loop" }));

        await expect(fetchPublicUrl("http://93.184.216.34/start")).rejects.toThrow(
            "Too many redirects"
        );
        // Initial request + MAX_REDIRECT_HOPS follows.
        expect(fetchMock).toHaveBeenCalledTimes(6);
    });
});
