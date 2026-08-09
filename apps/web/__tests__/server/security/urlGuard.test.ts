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
    ])("classifies %s as private", ip => {
        expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "2606:4700::1111", "93.184.216.34"])(
        "classifies %s as public",
        ip => {
            expect(isPrivateAddress(ip)).toBe(false);
        }
    );
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
});
