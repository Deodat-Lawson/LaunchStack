import { describe, expect, it } from "vitest";

import { createStaticTradeDataProvider } from "@launchstack/tools/trade-data";

import type { CompanyHit } from "@launchstack/tools/web-research";

import {
    companyName,
    gather,
    lookalikeQuery,
    lookalikeSeeds,
    mentionFromWebResult,
    type CompanySearchPortOptions,
} from "./gather";
import type { PlannedSourceQuery } from "./types";

const webQuery: PlannedSourceQuery = {
    kind: "web",
    territory: { country: "DE" },
    partnerKind: "importer",
    query: "Kaffee Importeur Deutschland",
    label: "directory",
    rationale: "r",
};
const placeQuery: PlannedSourceQuery = {
    kind: "place",
    territory: { country: "NL", region: "Amsterdam" },
    partnerKind: "retailer",
    query: "coffee shop",
    label: "place",
    rationale: "r",
};
const tradeQuery: PlannedSourceQuery = {
    kind: "trade",
    territory: { country: "DE" },
    partnerKind: "importer",
    query: "coffee",
    label: "trade",
    rationale: "r",
};

describe("mentionFromWebResult", () => {
    it("takes the organisation name from the title and guesses roles from the text", () => {
        const m = mentionFromWebResult(
            {
                url: "https://acme-import.de/ueber-uns",
                title: "Acme Import GmbH | Kaffee Importeur & Vertrieb",
                content: "Wir sind Importeur ...",
                score: 1,
            },
            webQuery
        );
        expect(m.name).toBe("Acme Import GmbH");
        expect(m.roles).toEqual(expect.arrayContaining(["importer", "distributor"]));
        expect(m.country).toBe("DE");
        expect(m.source).toBe("web:directory");
    });
});

describe("gather", () => {
    it("degrades per source and never throws when one source fails", async () => {
        const result = await gather([webQuery, placeQuery, tradeQuery], {
            searchWeb: async () => {
                throw new Error("exa down");
            },
            searchPlaces: async () => [
                {
                    fsqId: "f1",
                    name: "Bean There",
                    formattedAddress: "Amsterdam",
                    location: { lat: 52.3, lng: 4.9 },
                    categories: [{ id: "1", name: "Coffee Shop" }],
                    website: "https://beanthere.nl",
                },
            ],
            tradeData: createStaticTradeDataProvider([
                {
                    consignee: "Acme Import GmbH",
                    consigneeCountry: "DE",
                    shipper: "Finca X",
                    shipperCountry: "CO",
                    hsCode: "0901",
                    description: "green coffee",
                    date: "2026-01-01",
                    source: "static",
                },
            ]),
            hsCodes: ["0901"],
        });
        const byName = Object.fromEntries(result.sources.map(s => [s.source, s]));
        expect(byName.web!.status).toBe("failed");
        expect(byName.place!.status).toBe("ok");
        expect(byName.trade!.status).toBe("ok");
        expect(result.mentions.map(m => m.name).sort()).toEqual(["Acme Import GmbH", "Bean There"]);
        expect(result.mentions.find(m => m.name === "Acme Import GmbH")!.roles).toEqual([
            "importer",
        ]);
    });

    it("reports skipped sources with a reason when not configured", async () => {
        const result = await gather([webQuery], {
            searchWeb: null,
            searchPlaces: null,
            tradeData: null,
            hsCodes: [],
        });
        expect(result.sources.every(s => s.status === "skipped")).toBe(true);
        expect(result.sources.find(s => s.source === "web")!.detail).toMatch(/not configured/);
        expect(result.mentions).toHaveLength(0);
    });
});

const hit = (domain: string, title: string, description = ""): CompanyHit => ({
    title,
    url: `https://${domain}/`,
    domain,
    description,
});

const noSearchWeb = async (): Promise<never> => {
    throw new Error("general web search must not run when company search is configured");
};

describe("companyName", () => {
    it("takes the company half of a homepage title", () => {
        expect(companyName("Acme Import GmbH | Kaffee Importeur", "acme-import.de")).toBe(
            "Acme Import GmbH"
        );
        expect(companyName("Home | Delta Logistics", "delta.example")).toBe("Delta Logistics");
        expect(companyName("Welcome to Pickpoint - Fulfilment", "pickpoint.example")).toBe(
            "Pickpoint"
        );
        expect(companyName("https://bare.example/", "bare.example")).toBe("bare.example");
    });
});

describe("gather with company search", () => {
    it("turns company hits into the companies themselves, never the general search", async () => {
        const calls: Array<{ query: string; options: CompanySearchPortOptions }> = [];
        const result = await gather([webQuery], {
            searchWeb: noSearchWeb,
            searchCompanies: async (query, options) => {
                calls.push({ query, options });
                return [
                    hit(
                        "acme-import.de",
                        "Acme Import GmbH | Kaffee Importeur & Vertrieb",
                        "Wir sind Importeur und Distributor für Rohkaffee."
                    ),
                    hit("roestwerk.de", "Home | Röstwerk Berlin", "Großhandel für Kaffee."),
                ];
            },
            searchPlaces: null,
            tradeData: null,
            hsCodes: [],
        });
        expect(calls).toEqual([
            {
                query: "Kaffee Importeur Deutschland",
                options: expect.objectContaining({ country: "DE", excludeDomains: [] }),
            },
        ]);
        expect(result.mentions.map(m => [m.name, m.url, m.source])).toEqual([
            ["Acme Import GmbH", "https://acme-import.de/", "web:company:directory"],
            ["Röstwerk Berlin", "https://roestwerk.de/", "web:company:directory"],
        ]);
        expect(result.mentions[0]!.roles).toEqual(
            expect.arrayContaining(["importer", "distributor"])
        );
        expect(result.mentions[1]!.roles).toEqual(["wholesaler"]);
        expect(result.mentions.every(m => m.country === "DE")).toBe(true);
        const web = result.sources.find(s => s.source === "web")!;
        expect(web).toMatchObject({ status: "ok", results: 2, queries: 1 });
        expect(result.webResults.map(r => r.url)).toEqual([
            "https://acme-import.de/",
            "https://roestwerk.de/",
        ]);
    });

    it("tells company search what to leave out, and drops it if it comes back anyway", async () => {
        let excludeDomains: readonly string[] = [];
        const result = await gather([webQuery], {
            searchWeb: noSearchWeb,
            // A careless vendor: ignores the exclusions it is given.
            searchCompanies: async (_query, options) => {
                excludeDomains = options.excludeDomains;
                return [
                    hit("www.partner.de", "Partner GmbH"),
                    hit("shop.customer.de", "Customer AG"),
                    hit("new-buyer.de", "New Buyer GmbH"),
                ];
            },
            excludeDomains: ["https://www.Partner.de/about", "customer.de"],
            searchPlaces: null,
            tradeData: null,
            hsCodes: [],
        });
        expect(excludeDomains).toEqual(["partner.de", "customer.de"]);
        expect(result.mentions.map(m => m.name)).toEqual(["New Buyer GmbH"]);
    });

    it("reports failed company queries without throwing", async () => {
        const result = await gather([webQuery, { ...webQuery, query: "Kaffee Großhandel" }], {
            searchWeb: noSearchWeb,
            searchCompanies: async query => {
                if (query === "Kaffee Großhandel") throw new Error("Exa company search failed");
                return [hit("acme-import.de", "Acme Import GmbH")];
            },
            searchPlaces: null,
            tradeData: null,
            hsCodes: [],
        });
        expect(result.sources.find(s => s.source === "web")).toMatchObject({
            status: "degraded",
            results: 1,
            detail: "1 queries failed",
        });
    });
});

describe("lookalikes", () => {
    it("picks named customers first (newest entry first), then won deals, each once, at most five", () => {
        expect(
            lookalikeSeeds(
                ["first.example", "https://www.Second.example/about"],
                ["won-1.example", "second.example", "won-2.example", "won-3.example"]
            )
        ).toEqual([
            "second.example",
            "first.example",
            "won-1.example",
            "won-2.example",
            "won-3.example",
        ]);
        expect(lookalikeSeeds([], ["won-1.example"])).toEqual(["won-1.example"]);
    });

    it("keeps the query under 300 characters", () => {
        const query = lookalikeQuery("Delta Logistics", "Fulfilment for webshops. ".repeat(40));
        expect(query.startsWith("Companies similar to Delta Logistics: Fulfilment")).toBe(true);
        expect(query.length).toBeLessThanOrEqual(300);
        expect(lookalikeQuery("delta.example", null)).toBe("Companies similar to delta.example");
    });

    it("searches companies like each seed and never returns a seed, customer or exclusion", async () => {
        const described: string[][] = [];
        const searches: Array<{ query: string; options: CompanySearchPortOptions }> = [];
        const result = await gather([webQuery], {
            searchWeb: noSearchWeb,
            searchCompanies: async (query, options) => {
                searches.push({ query, options });
                if (!query.startsWith("Companies similar to")) return [];
                return [
                    hit("delta.example", "Delta Logistics"),
                    hit("www.pickpoint.example", "Pickpoint"),
                    hit("partner.example", "Partner BV"),
                    hit(
                        query.includes("Delta") ? "tulip-post.example" : "kanaal.example",
                        query.includes("Delta") ? "Tulip Post | Fulfilment" : "Kanaal Fulfilment",
                        "E-commerce fulfilment and returns for webshops."
                    ),
                ];
            },
            describeCompanies: async urls => {
                described.push(urls);
                return [
                    {
                        url: "https://delta.example/",
                        domain: "delta.example",
                        title: "Home | Delta Logistics",
                        description: "Warehousing and fulfilment for Dutch webshops.",
                    },
                ];
            },
            excludeDomains: ["partner.example", "delta.example", "pickpoint.example"],
            lookalikes: {
                seeds: ["delta.example", "pickpoint.example"],
                country: "NL",
                partnerKind: "distributor",
            },
            searchPlaces: null,
            tradeData: null,
            hsCodes: [],
        });
        expect(described).toEqual([["https://delta.example/", "https://pickpoint.example/"]]);
        const lookalikeSearches = searches.filter(s => s.query.startsWith("Companies similar to"));
        expect(lookalikeSearches.map(s => s.query)).toEqual([
            "Companies similar to Delta Logistics: Warehousing and fulfilment for Dutch webshops.",
            // Exa could not describe this one: its domain still finds companies like it.
            "Companies similar to pickpoint.example",
        ]);
        for (const s of lookalikeSearches) {
            expect(s.options.country).toBe("NL");
            expect(s.options.excludeDomains).toEqual(
                expect.arrayContaining(["partner.example", "delta.example", "pickpoint.example"])
            );
        }
        const lookalikes = result.mentions.filter(m => m.source?.startsWith("lookalike:"));
        expect(lookalikes.map(m => [m.name, m.source])).toEqual([
            ["Tulip Post", "lookalike:delta.example"],
            ["Kanaal Fulfilment", "lookalike:pickpoint.example"],
        ]);
        expect(lookalikes.every(m => m.country === "NL")).toBe(true);
        expect(lookalikes[0]!.roles).toEqual(["distributor"]);
        expect(result.sources.find(s => s.source === "lookalike")).toEqual({
            source: "lookalike",
            queries: 2,
            results: 2,
            status: "ok",
            detail: "from 2 customers",
        });
    });

    it("is skipped with a reason when there are no customers yet", async () => {
        const result = await gather([webQuery], {
            searchWeb: noSearchWeb,
            searchCompanies: async () => [],
            describeCompanies: async () => {
                throw new Error("must not describe without seeds");
            },
            lookalikes: { seeds: [], country: "DE", partnerKind: "importer" },
            searchPlaces: null,
            tradeData: null,
            hsCodes: [],
        });
        expect(result.sources.find(s => s.source === "lookalike")).toMatchObject({
            status: "skipped",
            detail: "no customers yet",
        });
    });

    it("needs an Exa key: with general search only, web uses it and lookalikes are skipped", async () => {
        const searched: string[] = [];
        const result = await gather([webQuery], {
            searchWeb: async queries => {
                searched.push(...queries.map(q => q.query));
                return [
                    {
                        url: "https://acme-import.de/",
                        title: "Acme Import GmbH | Importeur",
                        content: "Importeur",
                        score: 1,
                    },
                ];
            },
            searchCompanies: null,
            describeCompanies: null,
            lookalikes: { seeds: ["delta.example"], country: "DE", partnerKind: "importer" },
            searchPlaces: null,
            tradeData: null,
            hsCodes: [],
        });
        expect(searched).toEqual(["Kaffee Importeur Deutschland"]);
        expect(result.mentions.map(m => [m.name, m.source])).toEqual([
            ["Acme Import GmbH", "web:directory"],
        ]);
        expect(result.sources.find(s => s.source === "lookalike")).toMatchObject({
            status: "skipped",
            detail: "needs EXA_API_KEY",
        });
    });
});
