/**
 * Keyless mode has to hold up with no key and no model: the plan is built
 * from the program alone, the two public sources map cleanly onto the
 * gather stage's shapes, and the page profiler produces a dossier that
 * passes the same grounding gate as the agent's. Network is stubbed.
 */
import { describe, expect, it } from "vitest";

import type { ReadablePage } from "@launchstack/tools/web-research";

import type { PlanInput } from "../plan";
import type { PartnerOrgRecord, ProgramRecord } from "../types";
import { countriesMentioned, nativeTermsFor, overpassAreas } from "./geo";
import {
    buildOverpassQuery,
    mapOverpassElements,
    nameRegexFor,
    searchOverpass,
    tagSelectorsFor,
} from "./osm";
import { searchNominatim } from "./nominatim";
import { locateCity, photonAreas, photonTagsFor, searchPhoton } from "./photon";
import { buildKeylessPlan, keywordsFor } from "./plan";
import { createKeylessPorts } from "./ports";
import { extractFacts, firstDescription, profileFromPages } from "./profile";
import { filterYc, resetYcCache, type YcCompany } from "./yc";

const urlOf = (input: RequestInfo | URL): string =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const program: ProgramRecord = {
    id: "prog-1",
    companyId: 1n,
    createdByUserId: "u1",
    name: "Specialty coffee · NL",
    offering: "Single-origin roasted specialty coffee for cafés and roasters",
    categories: ["specialty coffee", "coffee roaster"],
    hsCodes: [],
    targetTerritories: [{ country: "NL" }, { country: "DE", region: "Hamburg" }],
    partnerKinds: ["retailer", "wholesaler"],
    constraints: null,
    knownPartnerDomains: [],
    status: "active",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: null,
};

const planInput: PlanInput = {
    program,
    profile: { companyName: "Acme Roasters", industry: "Food", identity: "", knowledgeContext: "" },
    territories: program.targetTerritories,
    partnerKinds: program.partnerKinds,
    sources: { web: true, place: true, trade: false },
};

describe("keyless plan", () => {
    it("uses categories as keywords and falls back to the offering's words", () => {
        expect(keywordsFor(program)).toEqual(["specialty coffee", "coffee roaster"]);
        expect(
            keywordsFor({ categories: [], offering: "Picking robots for e-commerce warehouses" })
        ).toEqual(["picking", "robots", "commerce", "warehouses"]);
    });

    it("plans one OpenStreetMap and one directory query per territory, with tag selectors", () => {
        const plan = buildKeylessPlan(planInput);
        expect(plan.queries).toHaveLength(4);
        const place = plan.queries.filter(q => q.kind === "place");
        expect(place.map(q => q.territory.country)).toEqual(["NL", "DE"]);
        expect(place[0]!.categoryIds).toContain('["shop"="coffee"]');
        expect(place[0]!.categoryIds).toContain('["shop"="wholesale"]');
        const web = plan.queries.filter(q => q.kind === "web");
        expect(web[1]!.query).toContain("Hamburg, Germany country:DE");
        expect(plan.strategy).toMatch(/No model/);
    });
});

describe("OpenStreetMap adapter", () => {
    it("derives selectors and a name regex from the segment's words", () => {
        expect(tagSelectorsFor(["specialty coffee"])).toEqual(
            expect.arrayContaining(['["shop"="coffee"]', '["craft"="coffee_roaster"]'])
        );
        expect(tagSelectorsFor(["quantum flux capacitors"])).toEqual([]);
        expect(nameRegexFor(["specialty coffee", "roaster"])).toBe("specialty|coffee|roaster");
    });

    it("scopes big countries to cities and small ones to the whole country", () => {
        expect(overpassAreas("NL")).toEqual([{ country: "NL", city: null }]);
        expect(overpassAreas("DE").map(a => a.city)).toEqual([
            "Berlin",
            "Hamburg",
            "Munich",
            "Cologne",
        ]);
        expect(overpassAreas("DE", "Hamburg")).toEqual([{ country: "DE", city: "Hamburg" }]);
    });

    it("builds a query that requires a website and honours the city scope", () => {
        const q = buildOverpassQuery(
            { country: "DE", city: "Hamburg" },
            { country: "DE", keywords: ["coffee"] }
        );
        expect(q).toContain('area["ISO3166-1"="DE"]');
        expect(q).toContain('area["name"="Hamburg"]');
        expect(q).toContain('nwr(area.c)(area.r)["shop"="coffee"]["website"];');
        expect(q).not.toContain("admin_level");
        expect(q).toContain('["name"~"coffee",i]');
        expect(q).toMatch(/out center \d+;$/);
    });

    it("maps elements to places with provenance ids and skips those without a name or position", () => {
        const places = mapOverpassElements(
            [
                {
                    type: "node",
                    id: 1,
                    lat: 52.37,
                    lon: 4.89,
                    tags: {
                        name: "Bocca Coffee",
                        shop: "coffee",
                        website: "bocca.nl",
                        "addr:city": "Amsterdam",
                        "addr:street": "Kerkstraat",
                        "addr:housenumber": "96",
                    },
                },
                {
                    type: "way",
                    id: 2,
                    center: { lat: 51.9, lon: 4.5 },
                    tags: {
                        name: "Man Met Bril",
                        craft: "coffee_roaster",
                        "contact:website": "https://manmetbrilkoffie.nl/",
                    },
                },
                {
                    type: "node",
                    id: 3,
                    lat: 52,
                    lon: 4,
                    tags: { shop: "coffee", website: "nameless.example" },
                },
                { type: "node", id: 4, tags: { name: "No position", website: "x.example" } },
            ],
            { country: "NL", city: null }
        );
        expect(places.map(p => p.id)).toEqual(["osm:node/1", "osm:way/2"]);
        expect(places[0]!.website).toBe("https://bocca.nl/");
        expect(places[0]!.address).toBe("Kerkstraat 96, Amsterdam");
        expect(places[0]!.categories).toEqual(["shop=coffee"]);
        expect(places[1]!.website).toBe("https://manmetbrilkoffie.nl/");
    });

    it("falls over to the next public instance when one is overloaded or times out", async () => {
        const tried: string[] = [];
        const fetchImpl: typeof fetch = async (url, init) => {
            tried.push(urlOf(url));
            if (tried.length === 1)
                return new Response("<html>Gateway Timeout</html>", { status: 504 });
            if (tried.length === 2)
                return new Response(
                    JSON.stringify({
                        elements: [],
                        remark: 'runtime error: Query timed out in "query" at line 4 after 26 seconds.',
                    }),
                    { status: 200 }
                );
            const body = init?.body instanceof URLSearchParams ? init.body.get("data") : "";
            expect(body).toContain('["website"]');
            return new Response(
                JSON.stringify({
                    elements: [
                        {
                            type: "node",
                            id: 5,
                            lat: 52,
                            lon: 4,
                            tags: { name: "Late Bloomer", website: "late.example" },
                        },
                    ],
                })
            );
        };
        const places = await searchOverpass(
            { country: "NL", keywords: ["coffee"] },
            { fetchImpl, urls: ["https://a.example", "https://b.example", "https://c.example"] }
        );
        expect(tried).toEqual(["https://a.example", "https://b.example", "https://c.example"]);
        expect(places.map(p => p.name)).toEqual(["Late Bloomer"]);
    });

    it("throws only when every instance failed", async () => {
        const fetchImpl: typeof fetch = async () => new Response("busy", { status: 504 });
        await expect(
            searchOverpass(
                { country: "NL", keywords: ["coffee"] },
                { fetchImpl, urls: ["https://a.example"] }
            )
        ).rejects.toThrow(/Overpass 504/);
    });

    it("posts to Overpass with a user agent and merges areas", async () => {
        const calls: Array<{ url: string; ua: string | undefined; body: string }> = [];
        const fetchImpl: typeof fetch = async (url, init) => {
            const headers = init?.headers as Record<string, string>;
            calls.push({
                url: urlOf(url),
                ua: headers["User-Agent"],
                body: init?.body instanceof URLSearchParams ? init.body.toString() : "",
            });
            return new Response(
                JSON.stringify({
                    elements: [
                        {
                            type: "node",
                            id: calls.length,
                            lat: 1,
                            lon: 2,
                            tags: {
                                name: `Place ${calls.length}`,
                                website: `p${calls.length}.example`,
                            },
                        },
                    ],
                }),
                { status: 200 }
            );
        };
        const places = await searchOverpass(
            { country: "DE", keywords: ["coffee"], limit: 10 },
            { fetchImpl, urls: ["https://overpass.example"] }
        );
        expect(calls).toHaveLength(4);
        expect(calls[0]!.ua).toMatch(/LaunchStack-Prospects/);
        expect(decodeURIComponent(calls[0]!.body)).toContain('area["name"="Berlin"]');
        expect(places.map(p => p.name)).toEqual(["Place 1", "Place 2", "Place 3", "Place 4"]);
    });
});

describe("Nominatim adapter", () => {
    it("keeps named results that carry a website and rate-limits between areas", async () => {
        const calls: string[] = [];
        const fetchImpl: typeof fetch = async url => {
            calls.push(urlOf(url));
            return new Response(
                JSON.stringify([
                    {
                        osm_type: "node",
                        osm_id: 7,
                        name: "Koffiebranderij Blanche Dael",
                        lat: "50.85",
                        lon: "5.69",
                        category: "shop",
                        type: "coffee",
                        extratags: { website: "https://blanchedael.example" },
                        address: { road: "Wolfstraat", house_number: "28", city: "Maastricht" },
                    },
                    {
                        osm_type: "node",
                        osm_id: 8,
                        name: "No Site Roasters",
                        lat: "52",
                        lon: "4",
                        extratags: {},
                        address: {},
                    },
                ])
            );
        };
        const places = await searchNominatim(
            {
                country: "NL",
                areas: [
                    { country: "NL", city: null },
                    { country: "NL", city: "Utrecht" },
                ],
                terms: ["koffiebranderij"],
            },
            { fetchImpl, pauseMs: 1 }
        );
        expect(calls).toHaveLength(2);
        expect(calls[0]).toContain("countrycodes=nl");
        expect(calls[0]).toContain("extratags=1");
        expect(places).toEqual([
            expect.objectContaining({
                id: "osm:node/7",
                name: "Koffiebranderij Blanche Dael",
                website: "https://blanchedael.example/",
                address: "Wolfstraat 28, Maastricht",
                categories: ["shop=coffee"],
            }),
        ]);
    });
});

describe("Photon + OSM API", () => {
    it("turns selectors into osm_tag filters and picks cities to box", () => {
        expect(
            photonTagsFor(['["shop"="coffee"]', '["craft"="coffee_roaster"]', '["healthcare"~"."]'])
        ).toEqual(["shop:coffee", "craft:coffee_roaster"]);
        expect(photonAreas("NL")).toEqual(["Amsterdam", "Rotterdam", "Utrecht"]);
        expect(photonAreas("DE", "Hamburg")).toEqual(["Hamburg"]);
        expect(nativeTermsFor(["specialty coffee"])).toEqual([
            "koffiebranderij",
            "kaffeerösterei",
            "torréfacteur",
            "tostador",
        ]);
    });

    it("boxes searches to the city, keeps only the country's results, and reads website tags from the OSM API", async () => {
        const calls: string[] = [];
        const fetchImpl: typeof fetch = async url => {
            const u = urlOf(url);
            calls.push(u);
            if (u.includes("photon") && u.includes("q=Amsterdam"))
                return new Response(
                    JSON.stringify({
                        features: [
                            {
                                geometry: { coordinates: [4.9, 52.37] },
                                properties: {
                                    osm_key: "place",
                                    countrycode: "NL",
                                    name: "Amsterdam",
                                },
                            },
                        ],
                    })
                );
            if (u.includes("photon"))
                return new Response(
                    JSON.stringify({
                        features: [
                            {
                                geometry: { coordinates: [4.88, 52.36] },
                                properties: {
                                    osm_type: "N",
                                    osm_id: 1,
                                    osm_key: "shop",
                                    osm_value: "coffee",
                                    name: "Bocca",
                                    countrycode: "NL",
                                    city: "Amsterdam",
                                },
                            },
                            {
                                geometry: { coordinates: [30.5, 50.4] },
                                properties: {
                                    osm_type: "N",
                                    osm_id: 2,
                                    osm_key: "shop",
                                    osm_value: "coffee",
                                    name: "Coffee",
                                    countrycode: "UA",
                                    city: "Kyiv",
                                },
                            },
                            {
                                geometry: { coordinates: [4.5, 51.9] },
                                properties: {
                                    osm_type: "W",
                                    osm_id: 3,
                                    osm_key: "craft",
                                    osm_value: "coffee_roaster",
                                    name: "Man Met Bril",
                                    countrycode: "NL",
                                    city: "Rotterdam",
                                },
                            },
                        ],
                    })
                );
            if (u.includes("/nodes.json"))
                return new Response(
                    JSON.stringify({
                        elements: [
                            {
                                type: "node",
                                id: 1,
                                lat: 52.36,
                                lon: 4.88,
                                tags: {
                                    name: "Bocca Coffee",
                                    shop: "coffee",
                                    website: "bocca.nl",
                                    "addr:city": "Amsterdam",
                                },
                            },
                        ],
                    })
                );
            if (u.includes("/ways.json"))
                return new Response(
                    JSON.stringify({
                        elements: [
                            {
                                type: "way",
                                id: 3,
                                tags: {
                                    name: "Man Met Bril Koffie",
                                    craft: "coffee_roaster",
                                    "contact:website": "https://manmetbrilkoffie.nl/",
                                },
                            },
                        ],
                    })
                );
            return new Response("nope", { status: 404 });
        };
        expect(await locateCity("Amsterdam", "NL", { fetchImpl })).toEqual({
            lat: 52.37,
            lon: 4.9,
        });
        const places = await searchPhoton(
            {
                country: "NL",
                region: "Amsterdam",
                keywords: ["coffee"],
                selectors: ['["shop"="coffee"]', '["craft"="coffee_roaster"]'],
                limit: 10,
            },
            { fetchImpl }
        );
        const search = calls.find(c => c.includes("osm_tag=shop%3Acoffee"));
        expect(search).toContain("bbox=4.5500%2C52.1200%2C5.2500%2C52.6200");
        expect(places.map(p => [p.id, p.name, p.website, p.city])).toEqual([
            ["osm:node/1", "Bocca Coffee", "https://bocca.nl/", "Amsterdam"],
            ["osm:way/3", "Man Met Bril Koffie", "https://manmetbrilkoffie.nl/", "Rotterdam"],
        ]);
        expect(calls.some(c => c.includes("nodes=2"))).toBe(false);
    });
});

describe("YC directory", () => {
    const companies: YcCompany[] = [
        {
            id: 1,
            name: "Beanly",
            slug: "beanly",
            website: "https://beanly.example",
            all_locations: "Amsterdam, Netherlands",
            one_liner: "Subscription coffee for offices",
            industries: ["Consumer", "Food and Beverage"],
            status: "Active",
        },
        {
            id: 2,
            name: "Oldco",
            slug: "oldco",
            website: null,
            all_locations: "Amsterdam, Netherlands",
            one_liner: "Coffee",
            industries: [],
            status: "Inactive",
        },
        {
            id: 3,
            name: "Berlinbot",
            slug: "berlinbot",
            website: "https://berlinbot.example",
            all_locations: "Berlin, Germany",
            one_liner: "Coffee robots",
            industries: ["Hardware"],
            status: "Active",
        },
        {
            id: 4,
            name: "Fintechly",
            slug: "fintechly",
            website: "https://fintechly.example",
            all_locations: "Rotterdam, Netherlands",
            one_liner: "Payments for SMEs",
            industries: ["Fintech"],
            status: "Active",
        },
    ];

    it("keeps active companies in the country whose blurb matches", () => {
        resetYcCache();
        const hits = filterYc(companies, { country: "NL", keywords: ["specialty coffee"] });
        expect(hits.map(h => h.name)).toEqual(["Beanly"]);
        const anyNl = filterYc(companies, { country: "NL", keywords: [] });
        expect(anyNl.map(h => h.name)).toEqual(["Beanly", "Fintechly"]);
    });
});

describe("page profiler", () => {
    const page = (url: string, title: string, text: string): ReadablePage => ({
        url,
        finalUrl: url,
        status: 200,
        contentType: "text/html",
        title,
        text,
        truncated: false,
        fetchedAt: new Date().toISOString(),
    });
    const home = page(
        "https://bocca.example/",
        "Bocca Coffee Roasters",
        "Menu Shop Wholesale About Contact. Bocca is a specialty coffee roaster in Amsterdam supplying cafés, restaurants and offices across the Netherlands and Belgium with freshly roasted beans. We are a wholesaler for over 400 hospitality customers. Certified organic (EU Organic) and Fairtrade. Contact wholesale@bocca.example for prices. © 2026"
    );
    const about = page(
        "https://bocca.example/about",
        "About",
        "Founded in 2000, Bocca has grown to a team of 45 employees across our roastery and three cafés. We import green coffee directly from farmers in Ethiopia and Colombia."
    );
    const org: PartnerOrgRecord = {
        id: "org-1",
        companyId: 1n,
        resolveKey: "d:bocca.example",
        name: "Bocca Coffee",
        domain: "bocca.example",
        country: "NL",
        region: null,
        city: "Amsterdam",
        lat: null,
        lng: null,
        roles: [],
        categories: [],
        sizeBand: null,
        description: null,
        kgEntityId: null,
        firstSeenRunId: null,
        lastEnrichedAt: null,
        createdAt: new Date(),
        updatedAt: null,
    };

    it("extracts what a page literally says", () => {
        const facts = extractFacts(home);
        expect(facts.description).toMatch(/^Bocca is a specialty coffee roaster/);
        expect(facts.emails).toEqual(["wholesale@bocca.example"]);
        expect(facts.roles.map(r => r.role)).toEqual(["wholesaler"]);
        expect(facts.certifications.map(c => c.name.toLowerCase())).toEqual([
            "eu organic",
            "fairtrade",
        ]);
        expect(facts.countries.map(c => c.code).sort()).toEqual(["BE", "NL"]);
        expect(extractFacts(about).staff).toMatchObject({ count: 45, band: "small" });
        expect(firstDescription("Accept all cookies. Log in. Short.", null)).toBeNull();
        expect(countriesMentioned("Ships to the UK and Deutschland")).toEqual(
            expect.arrayContaining(["DE", "GB"])
        );
    });

    it("assembles a grounded dossier from the pages it could read", async () => {
        const recorded: Array<{ kind: string; claim: string; sourceUrl: string }> = [];
        let nextId = 1;
        const result = await profileFromPages(
            {
                fetchPage: async (url: string) => {
                    if (url === "https://bocca.example/") return home;
                    if (url === "https://bocca.example/about") return about;
                    throw new Error("404");
                },
                recordEvidence: async e => {
                    recorded.push({ kind: e.kind, claim: e.claim, sourceUrl: e.sourceUrl });
                    return nextId++;
                },
            },
            {
                program,
                sellerSummary: "Acme Roasters",
                org,
                kind: "wholesaler",
                territory: { country: "NL" },
                seedUrls: ["https://bocca.example/"],
                hsCodes: [],
            }
        );
        expect(result.outcome.status).toBe("ok");
        if (result.outcome.status !== "ok") return;
        const d = result.outcome.dossier;
        expect(d.summary).toMatch(/specialty coffee roaster/);
        expect(d.roles).toEqual(expect.arrayContaining(["wholesaler", "importer"]));
        expect(d.sizeBand).toBe("small");
        expect(d.contactChannels).toEqual([
            {
                channel: "email",
                value: "wholesale@bocca.example",
                evidenceIds: [expect.any(Number)],
            },
        ]);
        expect(d.certifications.map(c => c.certification.toLowerCase())).toEqual([
            "eu organic",
            "fairtrade",
        ]);
        expect(d.territories.map(t => t.territory)).toEqual(
            expect.arrayContaining(["Netherlands", "Belgium"])
        );
        expect(d.openQuestions.some(q => q.includes("Brands carried"))).toBe(true);
        expect(result.fetchedUrls).toEqual([
            "https://bocca.example/",
            "https://bocca.example/about",
        ]);
        expect(recorded.every(e => e.sourceUrl.startsWith("https://bocca.example/"))).toBe(true);
        expect(result.modelId).toBe("keyless/page-reader");
    });

    it("fails the gate honestly when the site cannot be read", async () => {
        const result = await profileFromPages(
            {
                fetchPage: async () => {
                    throw new Error("ECONNREFUSED");
                },
                recordEvidence: async () => 1,
            },
            {
                program,
                sellerSummary: "",
                org,
                kind: "wholesaler",
                territory: { country: "NL" },
                seedUrls: [],
                hsCodes: [],
            }
        );
        expect(result.outcome.status).toBe("gate_failed");
        expect(result.evidence).toEqual([]);
    });
});

describe("keyless ports", () => {
    it("wires the sources and the profiler with no model and no credits", async () => {
        const fetchImpl: typeof fetch = async url => {
            const u = urlOf(url);
            if (u.includes("overpass"))
                return new Response(
                    JSON.stringify({
                        elements: [
                            {
                                type: "node",
                                id: 9,
                                lat: 52.1,
                                lon: 4.3,
                                tags: {
                                    name: "Roast & Co",
                                    shop: "coffee",
                                    website: "roastco.example",
                                },
                            },
                        ],
                    })
                );
            if (u.includes("nominatim")) return new Response(JSON.stringify([]));
            if (u.includes("photon")) return new Response(JSON.stringify({ features: [] }));
            if (u.includes("openstreetmap.org/api"))
                return new Response(JSON.stringify({ elements: [] }));
            if (u.includes("yc-oss"))
                return new Response(
                    JSON.stringify([
                        {
                            id: 1,
                            name: "Beanly",
                            slug: "beanly",
                            website: "https://beanly.example",
                            all_locations: "Amsterdam, Netherlands",
                            one_liner: "Coffee subscriptions",
                            industries: ["Food"],
                            status: "Active",
                        },
                    ])
                );
            return new Response("not found", { status: 404 });
        };
        resetYcCache();
        const ports = createKeylessPorts({ fetchImpl });
        expect(ports.creditsPerCandidate).toBe(0);
        expect(ports.compliance).toBeNull();
        expect(ports.profile).toBeDefined();
        await expect(
            ports.model.respond({ system: "", transcript: [], tools: [] })
        ).rejects.toThrow(/no model/);

        const places = await ports.searchPlaces!({
            query: "specialty coffee",
            categoryIds: ['["shop"="coffee"]'],
            territory: { country: "NL" },
        });
        expect(places).toEqual([
            expect.objectContaining({
                fsqId: "osm:node/9",
                name: "Roast & Co",
                website: "https://roastco.example/",
                categories: [{ id: "shop=coffee", name: "coffee" }],
            }),
        ]);
        const web = await ports.searchWeb!([
            {
                searchQuery: "coffee Netherlands country:NL",
                category: "directories",
                rationale: "",
            },
        ]);
        expect(web.map(r => r.title)).toEqual(["Beanly | Food"]);
        expect(web[0]!.content).toContain("country:NL");
        const { plan } = await ports.plan!(planInput);
        expect(plan.queries.filter(q => q.kind === "place")).toHaveLength(2);
    });
});
