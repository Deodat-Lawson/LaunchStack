/**
 * Keyless mode has to hold up with no key and no model: the plan is built
 * from the program alone, OpenStreetMap maps cleanly onto the
 * gather stage's shapes, and the page profiler produces a dossier that
 * passes the same grounding gate as the agent's. Network is stubbed.
 */
import { describe, expect, it } from "vitest";

import type { PageLink, ReadablePage } from "@launchstack/tools/web-research";

import type { PlanInput } from "../plan";
import type { PartnerOrgRecord, ProgramRecord } from "../types";
import { countriesMentioned, nativeTermsFor, overpassAreas } from "./geo";
import {
    buildOverpassQuery,
    mapOverpassElements,
    nameRegexFor,
    rolesForOsmCategories,
    chooseOsmCategories,
    resetOsmCategoryVectors,
    searchOverpass,
    tagSelectorsFor,
} from "./osm";
import { fakeEmbed } from "../semantic.fixture";
import { searchNominatim } from "./nominatim";
import { locateCity, photonAreas, photonTagsFor, searchPhoton } from "./photon";
import { buildKeylessPlan, keywordsFor } from "./plan";
import { createFakeMap, fakePopulation, noWait } from "./map.fixture";
import { createMemoryPlacePoolStore } from "./pool";
import {
    DEFAULT_SWEEP_REQUESTS_PER_RUN,
    createKeylessPorts,
    readSweepRequestsPerRun,
} from "./ports";
import { extractFacts, firstDescription, profileFromPages, readSite } from "./profile";

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
    customerDomains: [],
    status: "active",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: null,
};

/** A few of OpenStreetMap's tags with their wiki descriptions, as taginfo serves them. */
const VOCABULARY = [
    {
        selector: '["shop"="coffee"]',
        description: "A shop that sells coffee beans, ground coffee and coffee accessories",
    },
    {
        selector: '["craft"="coffee_roaster"]',
        description: "A coffee roaster: a place where green coffee beans are roasted",
    },
    {
        selector: '["amenity"="cafe"]',
        description: "A cafe: a place serving coffee, tea and light meals",
    },
    {
        selector: '["shop"="hardware"]',
        description: "A shop that sells hardware: tools, building supplies and paint",
    },
    {
        selector: '["shop"="wholesale"]',
        description: "A wholesaler selling goods in bulk to other businesses",
    },
    { selector: '["shop"="clothes"]', description: "A shop that primarily sells clothing" },
];
const vocabulary = async () => VOCABULARY;

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

    it("plans one OpenStreetMap query per territory and no startup directory", async () => {
        const plan = await buildKeylessPlan(planInput, { vocabulary });
        expect(plan.queries).toHaveLength(2);
        expect(plan.queries.every(q => q.kind === "place")).toBe(true);
        const place = plan.queries;
        expect(place.map(q => q.territory.country)).toEqual(["NL", "DE"]);
        expect(place[0]!.categoryIds).toContain('["shop"="coffee"]');
        // The segment's own tags fill the budget; partner-kind tags don't crowd them out.
        expect(place[0]!.categoryIds).not.toContain('["shop"="wholesale"]');
        expect(plan.strategy).toMatch(/No paid provider/);
        expect(plan.strategy).toMatch(/shared words/);
    });

    it("picks place categories by meaning when an embedder is given", async () => {
        resetOsmCategoryVectors();
        const plan = await buildKeylessPlan(planInput, { embed: fakeEmbed, vocabulary });
        expect(plan.queries[0]!.categoryIds).toEqual(
            expect.arrayContaining(['["shop"="coffee"]', '["craft"="coffee_roaster"]'])
        );
        expect(plan.strategy).toMatch(/closest in meaning/);
    });

    it("falls back to partner-kind tags only when the topic maps to none", async () => {
        const plan = await buildKeylessPlan(
            {
                ...planInput,
                program: { ...planInput.program, categories: ["quantum widgets"] },
            },
            { vocabulary }
        );
        const place = plan.queries.find(q => q.kind === "place")!;
        expect(place.categoryIds).toContain('["shop"="wholesale"]');
    });
});

describe("OpenStreetMap adapter", () => {
    it("derives selectors and a name regex from the segment's words", () => {
        expect(tagSelectorsFor(["specialty coffee"], VOCABULARY)).toEqual(
            expect.arrayContaining(['["shop"="coffee"]', '["craft"="coffee_roaster"]'])
        );
        expect(tagSelectorsFor(["quantum flux capacitors"], VOCABULARY)).toEqual([]);
        expect(tagSelectorsFor(["specialty coffee"], [])).toEqual([]);
        expect(nameRegexFor(["specialty coffee", "roaster"])).toBe("specialty|coffee|roaster");
    });

    it("chooses categories by meaning from OpenStreetMap's own vocabulary", async () => {
        resetOsmCategoryVectors();
        const hardware = await chooseOsmCategories(
            fakeEmbed,
            "Retailers and shops that would buy, stock or resell this: power tools and building supplies",
            VOCABULARY
        );
        expect(hardware).toContain('["shop"="hardware"]');
        expect(hardware).not.toContain('["shop"="coffee"]');
        expect(hardware.length).toBeLessThanOrEqual(4);
    });

    it("reads a role from a directory tag only when the tag states one", () => {
        expect(rolesForOsmCategories(["shop=coffee", "cuisine=coffee_shop"])).toEqual(["retailer"]);
        expect(rolesForOsmCategories(["shop=wholesale"])).toEqual(["wholesaler"]);
        expect(rolesForOsmCategories(["craft=coffee_roaster", "amenity=cafe"])).toEqual([
            "supplier",
            "retailer",
        ]);
        expect(rolesForOsmCategories(["office=company", "building=yes"])).toEqual([]);
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
            { country: "DE", keywords: ["coffee"], selectors: ['["shop"="coffee"]'] }
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

    it("boxes searches to the city, keeps only the country's businesses, and reads website tags from the OSM API", async () => {
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
                            {
                                geometry: { coordinates: [4.9, 52.37] },
                                properties: {
                                    osm_type: "W",
                                    osm_id: 4,
                                    osm_key: "highway",
                                    osm_value: "residential",
                                    name: "Coffee Lane",
                                    countrycode: "NL",
                                    city: "Amsterdam",
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
        // The street named after coffee is never looked up.
        expect(calls.filter(c => c.includes("/ways.json")).map(c => c.split("ways=")[1])).toEqual([
            "3",
        ]);
    });
});

describe("page profiler", () => {
    const page = (url: string, title: string, text: string, links?: PageLink[]): ReadablePage => ({
        url,
        finalUrl: url,
        status: 200,
        contentType: "text/html",
        title,
        text,
        ...(links ? { links } : {}),
        truncated: false,
        fetchedAt: new Date().toISOString(),
    });
    const home = page(
        "https://bocca.example/",
        "Bocca Coffee Roasters",
        "Menu Shop Wholesale About Contact. Bocca is a specialty coffee roaster in Amsterdam supplying cafés, restaurants and offices across the Netherlands and Belgium with freshly roasted beans. We are a wholesaler for over 400 hospitality customers. Certified organic (EU Organic) and Fairtrade. Contact wholesale@bocca.example for prices. © 2026",
        [
            { url: "https://bocca.example/", text: "Home" },
            { url: "https://bocca.example/shop", text: "Shop" },
            { url: "https://bocca.example/about", text: "About" },
            { url: "https://instagram.com/bocca", text: "Instagram" },
        ]
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

    it("passes over links, price lists and entity soup when picking a self-description", () => {
        expect(
            firstDescription(
                "Peru Decaf &euro; 23.50 Ethiopia Sidamo &euro; 24.00 Bestel nu in onze webshop vandaag. Home (https://hocc.example/) is where our chocolate and coffee story begins for everyone who visits us in Amsterdam. Wij zijn een specialty koffiebranderij in Utrecht die sinds 2010 koffie brandt voor caf\u00e9s en restaurants in heel Nederland.",
                "Shop",
                "Bocca"
            )
        ).toMatch(/^Wij zijn een specialty koffiebranderij/);
        expect(
            firstDescription(
                "Home (https://hocc.example/) is where it all begins for us and our friends in the city.",
                null
            )
        ).toBeNull();
    });

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
        expect(
            firstDescription(
                "<!doctype html> Interactive Map Found 156 coffeeshops Open Now Sort by: Highest Rated Nearest Newest. Home Shop Wholesale Blog Contact Careers Press Partners Locations. Harar Coffee is a family-run roastery in Amsterdam that imports green beans directly from Ethiopian cooperatives and roasts them weekly for cafés across the Netherlands. Sign up for our newsletter to get 10% off.",
                null,
                "Harar Coffee"
            )
        ).toMatch(/^Harar Coffee is a family-run roastery/);
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
        expect(result.promptVersion).toBe("keyless-profile/v2");
    });

    describe("which pages it reads", () => {
        const body =
            "Welkom bij Bocca. Wij branden specialty koffie in Amsterdam voor horeca en kantoren in heel Nederland, elke week vers en met de hand verpakt.";
        const site = "https://bocca.example";
        const site_ = (path: string): string => `${site}${path}`;
        const input = { org, seedUrls: [site_("/")] };
        /** A `fetchPage` over a map of pages; anything else is a 404. Records what was asked. */
        const serve = (pages: Record<string, ReadablePage>) => {
            const asked: string[] = [];
            const fetchPage = async (url: string): Promise<ReadablePage> => {
                asked.push(url);
                const found = pages[url];
                if (!found) throw new Error("404");
                return found;
            };
            return { asked, fetchPage };
        };

        it("follows the homepage's own links, best words first, and never guesses a path", async () => {
            const linked = page(site_("/"), "Bocca", body, [
                { url: site_("/"), text: "Home" },
                { url: site_("/webshop"), text: "Webshop" },
                { url: site_("/nieuws"), text: "Nieuws" },
                { url: site_("/het-verhaal-van-bocca"), text: "Over ons" },
                { url: site_("/werken-bij"), text: "Werken bij Bocca" },
                { url: site_("/klantenservice/bereik-ons"), text: "Contact" },
                { url: site_("/mijn-account"), text: "Inloggen" },
                { url: site_("/colofon"), text: "Colofon" },
                { url: "https://instagram.com/bocca", text: "Instagram" },
            ]);
            const { asked, fetchPage } = serve({
                [site_("/")]: linked,
                [site_("/klantenservice/bereik-ons")]: page(
                    site_("/klantenservice/bereik-ons"),
                    "Contact",
                    `${body} Mail naar verkoop@bocca.example.`
                ),
                [site_("/colofon")]: page(site_("/colofon"), "Colofon", `${body} KvK 12345678.`),
                [site_("/het-verhaal-van-bocca")]: page(
                    site_("/het-verhaal-van-bocca"),
                    "Over",
                    body
                ),
                [site_("/werken-bij")]: page(site_("/werken-bij"), "Vacatures", body),
            });
            const read = await readSite({ fetchPage }, input);
            // Contact, then the imprint, then about: the paths say none of that, the words do.
            expect(asked).toEqual([
                site_("/"),
                site_("/klantenservice/bereik-ons"),
                site_("/colofon"),
                site_("/het-verhaal-van-bocca"),
            ]);
            expect(read.requested).toEqual(asked);
            expect(read.pages).toHaveLength(4);
            expect(read.guessed).toBe(false);
        });

        it("guesses paths only when the homepage has no link to follow", async () => {
            const bare = page(site_("/"), "Bocca", body, [
                { url: site_("/"), text: "Bocca" },
                { url: site_("/login"), text: "Log in" },
                { url: "https://instagram.com/bocca", text: "Instagram" },
            ]);
            const contact = page(site_("/contact"), "Contact", `${body} Bel 020 123 45 67.`);
            const { asked, fetchPage } = serve({
                [site_("/")]: bare,
                [site_("/contact")]: contact,
            });
            const read = await readSite({ fetchPage }, input);
            expect(asked).toEqual([
                site_("/"),
                site_("/contact"),
                site_("/kontakt"),
                site_("/about"),
            ]);
            expect(read.guessed).toBe(true);
            expect(read.pages).toEqual([bare, contact]);

            // One link is enough to stop guessing, even when it leaves requests unused.
            const one = serve({
                [site_("/")]: page(site_("/"), "Bocca", body, [
                    { url: site_("/koffie"), text: "Onze koffie" },
                ]),
            });
            const single = await readSite({ fetchPage: one.fetchPage }, input);
            expect(one.asked).toEqual([site_("/"), site_("/koffie")]);
            expect(single.guessed).toBe(false);
        });

        it("counts every request against the budget, whatever comes back", async () => {
            const many = page(
                site_("/"),
                "Bocca",
                body,
                ["contact", "about", "team", "careers", "products", "blog"].map(word => ({
                    url: site_(`/${word}`),
                    text: word,
                }))
            );
            const thin = page(site_("/about"), "About", "Coming soon.");
            const gone = { ...page(site_("/team"), "Not found", body), status: 404 };
            const { asked, fetchPage } = serve({
                [site_("/")]: many,
                [site_("/about")]: thin,
                [site_("/team")]: gone,
                [site_("/careers")]: page(site_("/careers"), "Careers", body),
            });
            // /contact throws, /about is too thin to read, /team is a 404 page: three requests, no page.
            const read = await readSite({ fetchPage }, input);
            expect(asked).toEqual([site_("/"), site_("/contact"), site_("/about"), site_("/team")]);
            expect(read.pages).toEqual([many]);

            const wider = serve({
                [site_("/")]: many,
                [site_("/careers")]: page(site_("/careers"), "Careers", body),
            });
            const more = await readSite({ fetchPage: wider.fetchPage }, input, { maxRequests: 6 });
            expect(wider.asked).toHaveLength(6);
            expect(more.pages.map(p => p.finalUrl)).toEqual([site_("/"), site_("/careers")]);

            const none = serve({ [site_("/")]: many });
            await readSite({ fetchPage: none.fetchPage }, input, { maxRequests: 1 });
            expect(none.asked).toEqual([site_("/")]);
        });

        it("does not spend a request on a page it already read through a redirect", async () => {
            const linked = page(site_("/"), "Bocca", body, [
                { url: site_("/contact-us"), text: "Contact" },
                { url: site_("/contact"), text: "Contact page" },
                { url: site_("/about"), text: "About" },
                { url: site_("/team"), text: "Team" },
                { url: site_("/jobs"), text: "Jobs" },
            ]);
            const { asked, fetchPage } = serve({
                [site_("/")]: linked,
                // /contact-us answers as /contact.
                [site_("/contact-us")]: {
                    ...page(site_("/contact"), "Contact", `${body} Bel ons.`),
                    url: site_("/contact-us"),
                },
                [site_("/about")]: page(site_("/about"), "About", `${body} Sinds 2000.`),
                [site_("/team")]: page(site_("/team"), "Team", `${body} Ons team.`),
            });
            const read = await readSite({ fetchPage }, input);
            expect(asked).toEqual([
                site_("/"),
                site_("/contact-us"),
                site_("/about"),
                site_("/team"),
            ]);
            expect(read.pages).toHaveLength(4);
        });

        it("reads nothing more when the homepage cannot be read, or the run was stopped", async () => {
            const down = serve({});
            const read = await readSite({ fetchPage: down.fetchPage }, input);
            expect(down.asked).toEqual([site_("/")]);
            expect(read).toEqual({ pages: [], requested: [site_("/")], guessed: false });

            const stopped = new AbortController();
            stopped.abort();
            const idle = serve({ [site_("/")]: home });
            await readSite({ fetchPage: idle.fetchPage, signal: stopped.signal }, input);
            expect(idle.asked).toEqual([]);
        });
    });

    it("reads within the request budget its ports were given", async () => {
        const run = async (requestsPerCandidate?: number): Promise<string[]> => {
            const asked: string[] = [];
            const ports = createKeylessPorts(
                requestsPerCandidate === undefined ? {} : { requestsPerCandidate }
            );
            await ports.profile!(
                {
                    model: ports.model,
                    fetchPage: async (url: string) => {
                        asked.push(url);
                        if (url === "https://bocca.example/") return home;
                        if (url === "https://bocca.example/about") return about;
                        throw new Error("404");
                    },
                    searchWeb: null,
                    searchPlaces: null,
                    tradeData: null,
                    recordEvidence: async () => asked.length,
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
            return asked;
        };
        // The homepage links two pages of its own: about, then the shop.
        expect(await run()).toEqual([
            "https://bocca.example/",
            "https://bocca.example/about",
            "https://bocca.example/shop",
        ]);
        expect(await run(2)).toEqual(["https://bocca.example/", "https://bocca.example/about"]);
    });

    it("leaves roles empty when the site names none instead of echoing the requested kind", async () => {
        const quiet = page(
            "https://quiet.example/",
            "Quiet",
            "Welcome to Quiet, a small neighbourhood café in the centre of Utrecht. We serve breakfast and lunch every day of the week and our espresso bar pours coffee from morning to evening. Questions? Write to hello@quiet.example and we will get back to you."
        );
        let nextId = 1;
        const result = await profileFromPages(
            {
                fetchPage: async (url: string) => {
                    if (url === "https://quiet.example/") return quiet;
                    throw new Error("404");
                },
                recordEvidence: async () => nextId++,
            },
            {
                program,
                sellerSummary: "Acme Roasters",
                org: { ...org, name: "Quiet", domain: "quiet.example" },
                kind: "retailer",
                territory: { country: "NL" },
                seedUrls: ["https://quiet.example/"],
                hsCodes: [],
            }
        );
        expect(result.outcome.status).toBe("ok");
        if (result.outcome.status !== "ok") return;
        expect(result.outcome.dossier.roles).toEqual([]);
        expect(
            result.outcome.dossier.openQuestions.some(q => q.includes("does not say whether"))
        ).toBe(true);
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
            if (u.includes("taginfo"))
                return new Response(
                    JSON.stringify({
                        data: [
                            { value: "coffee", in_wiki: true, description: "Sells coffee beans" },
                        ],
                    })
                );
            if (u.includes("nominatim")) return new Response(JSON.stringify([]));
            if (u.includes("photon")) return new Response(JSON.stringify({ features: [] }));
            if (u.includes("openstreetmap.org/api"))
                return new Response(JSON.stringify({ elements: [] }));
            return new Response("not found", { status: 404 });
        };
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
                roles: ["retailer"],
            }),
        ]);
        expect(ports.searchWeb).toBeNull();
        const { plan } = await ports.plan!(planInput);
        expect(plan.queries.filter(q => q.kind === "place")).toHaveLength(2);
    }, 20_000);
});

describe("keyless place search", () => {
    const bicycles = {
        query: "bicycle shop",
        categoryIds: ['["shop"="bicycle"]'],
        territory: { country: "NL" },
    };
    const quiet = <T>(work: () => Promise<T>): Promise<T> => {
        const info = console.info;
        console.info = () => undefined;
        return work().finally(() => {
            console.info = info;
        });
    };

    it("hands the whole pool to ranking, not the first 40, one place per website", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places);
        const ports = createKeylessPorts({
            fetchImpl: map.fetchImpl,
            placePools: createMemoryPlacePoolStore(),
            throttle: noWait,
        });
        const found = await quiet(() => ports.searchPlaces!(bicycles));
        const withSite = places.filter(p => p.website ?? p.contactWebsite);
        expect(found).toHaveLength(withSite.length);
        expect(found.length).toBeGreaterThan(400);
        expect(new Set(found.map(p => p.website)).size).toBe(found.length);
        expect(found[0]).toMatchObject({
            fsqId: expect.stringMatching(/^osm:(node|way)\/\d+$/),
            categories: [{ id: "shop=bicycle", name: "bicycle" }],
            roles: ["retailer"],
        });
        // Overpass was asked first and answered: Photon was never needed.
        expect(map.calls).toEqual(["overpass overpass-api.de"]);
    });

    it("cuts a pool larger than the limit instead of passing thousands on", async () => {
        const map = createFakeMap(fakePopulation(700));
        const ports = createKeylessPorts({
            fetchImpl: map.fetchImpl,
            placePools: createMemoryPlacePoolStore(),
            throttle: noWait,
            placesPerTerritory: 100,
        });
        expect(await quiet(() => ports.searchPlaces!(bicycles))).toHaveLength(100);
    });

    it("sweeps Photon when Overpass is down, within the run's request cap, and resumes on the next run", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { overpass: 504 });
        const placePools = createMemoryPlacePoolStore();
        const run = () =>
            createKeylessPorts({
                fetchImpl: map.fetchImpl,
                placePools,
                throttle: noWait,
                sweepRequestsPerRun: 40,
            });
        const first = await quiet(() => run().searchPlaces!(bicycles));
        expect(map.sweepUrls()).toHaveLength(40);
        expect(first.length).toBeGreaterThan(40);

        const second = await quiet(() => run().searchPlaces!(bicycles));
        expect(map.sweepUrls()).toHaveLength(80);
        expect(new Set(map.sweepUrls()).size).toBe(80);
        expect(second.length).toBeGreaterThan(first.length);
        // The first run's places are all still there.
        const secondIds = new Set(second.map(p => p.fsqId));
        expect(first.every(p => secondIds.has(p.fsqId))).toBe(true);
    });

    it("shares one run's cap between the territories it planned", async () => {
        const places = [
            ...fakePopulation(400),
            ...fakePopulation(400, {
                country: "BE",
                box: [2.5, 49.45, 6.45, 51.55],
                firstId: 5_000,
            }),
        ];
        const map = createFakeMap(places, { overpass: 504 });
        const ports = createKeylessPorts({
            fetchImpl: map.fetchImpl,
            placePools: createMemoryPlacePoolStore(),
            throttle: noWait,
            sweepRequestsPerRun: 60,
            embed: null,
        });
        const { plan } = await createPlanFor(ports, [{ country: "NL" }, { country: "BE" }]);
        expect(plan.queries.filter(q => q.kind === "place")).toHaveLength(2);
        await quiet(() => ports.searchPlaces!(bicycles));
        expect(map.sweepUrls()).toHaveLength(30);
        await quiet(() => ports.searchPlaces!({ ...bicycles, territory: { country: "BE" } }));
        // 30 each: the cap is the run's, whatever the number of territories.
        expect(map.sweepUrls()).toHaveLength(60);
        // A third query in the same run has nothing left to send: not a sweep
        // request, and not the name search's Photon requests either.
        await quiet(() =>
            ports.searchPlaces!({ ...bicycles, categoryIds: ['["shop"="sports"]'] }).catch(() => [])
        );
        expect(map.sweepUrls()).toHaveLength(60);
        expect(map.count("photon")).toBe(60);
    });

    it("reads the request cap from the environment", () => {
        expect(DEFAULT_SWEEP_REQUESTS_PER_RUN).toBe(64);
        expect(readSweepRequestsPerRun({})).toBe(64);
        expect(readSweepRequestsPerRun({ PROSPECTS_PLACE_SWEEP_REQUESTS: " 120 " })).toBe(120);
        // Zero: Photon is asked nothing; Overpass only.
        expect(readSweepRequestsPerRun({ PROSPECTS_PLACE_SWEEP_REQUESTS: "0" })).toBe(0);
        expect(readSweepRequestsPerRun({ PROSPECTS_PLACE_SWEEP_REQUESTS: "100000" })).toBe(500);
        expect(readSweepRequestsPerRun({ PROSPECTS_PLACE_SWEEP_REQUESTS: "many" })).toBe(64);
        expect(readSweepRequestsPerRun({ PROSPECTS_PLACE_SWEEP_REQUESTS: "-5" })).toBe(64);
    });

    it("looks for the segment's words in place names when nothing carries its tags", async () => {
        const nameSearch = (sweepRequestsPerRun?: number) => {
            const calls: string[] = [];
            const fetchImpl: typeof fetch = async url => {
                const u = urlOf(url);
                calls.push(new URL(u).hostname);
                if (u.includes("overpass")) return new Response(JSON.stringify({ elements: [] }));
                if (u.includes("photon")) return new Response(JSON.stringify({ features: [] }));
                if (u.includes("nominatim"))
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
                                address: { city: "Maastricht" },
                            },
                        ])
                    );
                return new Response("not found", { status: 404 });
            };
            const ports = createKeylessPorts({
                fetchImpl,
                placePools: createMemoryPlacePoolStore(),
                throttle: noWait,
                sweepRequestsPerRun,
            });
            const found = quiet(() =>
                ports.searchPlaces!({
                    query: "specialty coffee",
                    categoryIds: ['["shop"="coffee"]'],
                    territory: { country: "NL" },
                })
            );
            return { calls, found };
        };

        const { calls, found } = nameSearch();
        expect((await found).map(p => p.name)).toEqual(["Koffiebranderij Blanche Dael"]);
        // Overpass first; then Photon (the sweep finds nothing, then the name
        // search); Nominatim last.
        expect(calls[0]).toBe("overpass-api.de");
        const photon = calls.filter(host => host === "photon.komoot.io").length;
        // 26 letters, then a city lookup for each of the three largest cities.
        expect(photon).toBe(26 + 3);
        expect(calls.lastIndexOf("nominatim.openstreetmap.org")).toBeGreaterThan(
            calls.lastIndexOf("photon.komoot.io")
        );

        // The cap holds for the name search too: with a cap of 27, one lookup; with 0, none.
        const tight = nameSearch(27);
        await tight.found;
        expect(tight.calls.filter(host => host === "photon.komoot.io")).toHaveLength(27);
        const none = nameSearch(0);
        expect((await none.found).map(p => p.name)).toEqual(["Koffiebranderij Blanche Dael"]);
        expect(none.calls).not.toContain("photon.komoot.io");
    });

    it("fails the source, with the reason, when no server answers and nothing is found", async () => {
        const map = createFakeMap([], { overpass: 504, photonFails: () => true });
        const ports = createKeylessPorts({
            fetchImpl: map.fetchImpl,
            placePools: createMemoryPlacePoolStore(),
            throttle: noWait,
        });
        await expect(quiet(() => ports.searchPlaces!(bicycles))).rejects.toThrow(
            /Overpass did not answer \(overpass-api\.de: Overpass 504/
        );
    });
});

/** The keyless plan for a segment with these territories, through the ports. */
async function createPlanFor(
    ports: ReturnType<typeof createKeylessPorts>,
    territories: Array<{ country: string }>
) {
    return ports.plan!({
        ...planInput,
        program: { ...program, targetTerritories: territories },
        territories,
    });
}
