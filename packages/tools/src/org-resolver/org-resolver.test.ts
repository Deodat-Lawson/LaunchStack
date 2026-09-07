import { describe, expect, it } from "vitest";

import {
    isAggregatorDomain,
    makeResolveKey,
    normalizeCountry,
    normalizeDomain,
    normalizeOrgName,
    resolveOrganizations,
} from "./index";

describe("normalizeDomain", () => {
    it("strips protocol, www, paths and marketing subdomains", () => {
        expect(normalizeDomain("https://www.acme-foods.de/en/brands")).toBe("acme-foods.de");
        expect(normalizeDomain("shop.acme.com")).toBe("acme.com");
        expect(normalizeDomain("WWW.Acme.COM.")).toBe("acme.com");
    });
    it("keeps known second-level country domains", () => {
        expect(normalizeDomain("https://shop.acme.co.uk/")).toBe("acme.co.uk");
        expect(normalizeDomain("brands.example.com.au")).toBe("example.com.au");
    });
    it("rejects ips, bare hosts and garbage", () => {
        expect(normalizeDomain("127.0.0.1")).toBeNull();
        expect(normalizeDomain("localhost")).toBeNull();
        expect(normalizeDomain("not a url")).toBeNull();
        expect(normalizeDomain("")).toBeNull();
    });
});

describe("normalizeOrgName", () => {
    it("strips legal forms, punctuation and diacritics", () => {
        expect(normalizeOrgName("Müller Feinkost GmbH & Co. KG")).toBe("muller feinkost");
        expect(normalizeOrgName("ACME Distribution B.V.")).toBe("acme distribution");
        expect(normalizeOrgName("Acme Distribution, Inc.")).toBe("acme distribution");
        expect(normalizeOrgName("De Koffiehandel Ltd")).toBe("de koffiehandel");
    });
    it("does not strip words that merely end like a suffix", () => {
        expect(normalizeOrgName("Tobacco")).toBe("tobacco");
        expect(normalizeOrgName("Pasco")).toBe("pasco");
    });
});

describe("normalizeCountry", () => {
    it("maps names and codes to alpha-2", () => {
        expect(normalizeCountry("Germany")).toBe("DE");
        expect(normalizeCountry("de")).toBe("DE");
        expect(normalizeCountry("The Netherlands")).toBe("NL");
        expect(normalizeCountry("Atlantis")).toBeNull();
    });
});

describe("makeResolveKey", () => {
    it("prefers a real domain, falls back to name+country", () => {
        expect(makeResolveKey({ domain: "www.acme.de", name: "Acme" })).toBe("d:acme.de");
        expect(makeResolveKey({ name: "Acme GmbH", country: "Germany" })).toBe("n:acme|DE");
        expect(makeResolveKey({ url: "", name: "" } as never)).toBeNull();
    });
    it("never identifies an organisation by an aggregator domain", () => {
        expect(isAggregatorDomain("facebook.com")).toBe(true);
        expect(
            makeResolveKey({
                domain: "https://www.facebook.com/acmefoods",
                name: "Acme Foods",
                country: "NL",
            })
        ).toBe("n:acme foods|NL");
    });
});

describe("resolveOrganizations", () => {
    it("merges mentions of the same organisation from different sources", () => {
        const orgs = resolveOrganizations([
            {
                name: "Acme Foods B.V.",
                url: "https://www.acme-foods.nl/about",
                country: "NL",
                source: "web",
            },
            {
                name: "ACME FOODS",
                url: "https://acme-foods.nl/brands",
                roles: ["distributor"],
                source: "web",
            },
            {
                name: "Acme Foods",
                url: "https://www.facebook.com/acmefoods",
                country: "Netherlands",
                source: "places",
            },
        ]);
        // The facebook mention has no usable domain so it keys by name+country,
        // which differs from the domain key: two records, not three.
        expect(orgs.map(o => o.resolveKey).sort()).toEqual(["d:acme-foods.nl", "n:acme foods|NL"]);
        const byDomain = orgs.find(o => o.resolveKey === "d:acme-foods.nl")!;
        expect(byDomain.mentionCount).toBe(2);
        expect(byDomain.roles).toEqual(["distributor"]);
        expect(byDomain.urls).toHaveLength(2);
        expect(byDomain.country).toBe("NL");
    });

    it("excludes the tenant and known partners by domain and key", () => {
        const orgs = resolveOrganizations(
            [
                { name: "Tenant Co", url: "https://tenant.example/" },
                { name: "Known Partner", url: "https://partner.example/x" },
                { name: "Fresh Candidate", url: "https://fresh.example/" },
                { name: "Nameless Local", country: "DE" },
            ],
            {
                excludeDomains: ["www.tenant.example", "partner.example"],
                excludeKeys: ["n:nameless local|DE"],
            }
        );
        expect(orgs.map(o => o.name)).toEqual(["Fresh Candidate"]);
    });

    it("is deterministic and order-preserving", () => {
        const input = [
            { name: "B Corp", url: "https://b.example" },
            { name: "A Corp", url: "https://a.example" },
        ];
        expect(resolveOrganizations(input).map(o => o.name)).toEqual(["B Corp", "A Corp"]);
        expect(resolveOrganizations(input)).toEqual(resolveOrganizations(input));
    });
});
