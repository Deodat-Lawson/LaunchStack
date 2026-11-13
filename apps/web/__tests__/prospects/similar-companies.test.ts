import type { EmbedTexts } from "@launchstack/pipelines/distribution";

/** Words hashed into dimensions: texts sharing words point the same way. */
const fakeEmbed: EmbedTexts = async texts =>
    texts.map(text => {
        const v = new Array<number>(256).fill(0);
        for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
            if (raw.length < 3) continue;
            const word = raw.replace(/(ies|es|s)$/, "");
            let h = 0;
            for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
            v[h % 256]! += 1;
        }
        v[0]! += 1;
        return v;
    });

import { SimilarCompaniesError, findSimilarCompanies } from "~/server/prospects/similar";

const vocabulary = async () => [
    {
        selector: '["shop"="coffee"]',
        description: "A shop that sells coffee beans and ground coffee",
    },
    { selector: '["amenity"="cafe"]', description: "A cafe serving coffee and light meals" },
    { selector: '["shop"="hardware"]', description: "A hardware store selling tools and paint" },
];
const baltimore = async () => ({ country: "US", region: "Baltimore" });
const place = (name: string, category: string) => ({
    name,
    website: `https://${name.toLowerCase().replace(/\W+/g, "")}.example/`,
    formattedAddress: `1 Main St, Baltimore`,
    categories: [{ id: category, name: category.split("=")[1]! }],
});

describe("findSimilarCompanies", () => {
    it("searches the kinds closest to the brief in the place, and keeps the buyers", async () => {
        const asked: Array<{ categoryIds: string[]; territory: unknown }> = [];
        const result = await findSimilarCompanies(
            {
                offering: "Specialty coffee beans",
                buyers: ["coffee shops"],
                place: "Baltimore, MD",
                limit: 5,
            },
            {
                embed: fakeEmbed,
                judgeFit: null,
                geocode: baltimore,
                vocabulary,
                searchCompanies: null,
                searchPlaces: async args => {
                    asked.push(args);
                    return [
                        place("Bean Coffee Shop", "shop=coffee"),
                        place("Tool Barn Hardware", "shop=hardware"),
                    ];
                },
            }
        );
        expect(asked[0]!.territory).toEqual({ country: "US", region: "Baltimore" });
        expect(asked[0]!.categoryIds).toContain('["shop"="coffee"]');
        expect(result.place).toEqual({
            country: "US",
            region: "Baltimore",
            label: "Baltimore, United States",
        });
        expect(result.matching).toBe("semantic");
        expect(result.companies.map(c => c.name)).toEqual(["Bean Coffee Shop"]);
        expect(result.companies[0]).toMatchObject({
            website: "https://beancoffeeshop.example/",
            source: "openstreetmap",
            reason: null,
        });
    });

    it("lets the fit check say no, and keeps its reason on the rest", async () => {
        const result = await findSimilarCompanies(
            {
                offering: "Specialty coffee beans",
                buyers: ["coffee shops"],
                place: "Baltimore",
                limit: 5,
            },
            {
                embed: fakeEmbed,
                geocode: baltimore,
                vocabulary,
                searchCompanies: null,
                searchPlaces: async () => [
                    place("Bean Coffee Shop", "shop=coffee"),
                    place("Closed Coffee Shop", "shop=coffee"),
                ],
                judgeFit: async ({ where, candidates }) => {
                    expect(where).toBe("Baltimore, United States");
                    return new Map(
                        candidates.map(c => [
                            c.id,
                            /closed/i.test(c.name)
                                ? { fit: false, reason: "It has closed." }
                                : { fit: true, reason: "Sells coffee to the public." },
                        ])
                    );
                },
            }
        );
        expect(result.companies.map(c => [c.name, c.reason])).toEqual([
            ["Bean Coffee Shop", "Sells coffee to the public."],
        ]);
    });

    it("takes companies from Exa too, placed by their own homepage, once per site", async () => {
        const result = await findSimilarCompanies(
            {
                offering: "Specialty coffee beans",
                buyers: ["coffee shops"],
                place: "Baltimore",
                limit: 5,
            },
            {
                embed: fakeEmbed,
                judgeFit: null,
                geocode: baltimore,
                vocabulary,
                searchPlaces: async () => [place("Bean Coffee Shop", "shop=coffee")],
                searchCompanies: async () => [
                    {
                        title: "Bean Coffee Shop",
                        url: "https://beancoffeeshop.example/",
                        domain: "beancoffeeshop.example",
                        description: "Coffee shop.",
                    },
                    {
                        title: "Harbor Coffee Shop",
                        url: "https://harbor.example/",
                        domain: "harbor.example",
                        description: "Coffee shop selling coffee beans in Baltimore, MD.",
                    },
                    {
                        title: "Berlin Coffee Shop",
                        url: "https://berlin.example/",
                        domain: "berlin.example",
                        description: "Coffee shop selling coffee beans in Berlin, Germany.",
                    },
                ],
            }
        );
        const names = result.companies.map(c => c.name);
        expect(names.filter(n => n === "Bean Coffee Shop")).toHaveLength(1);
        expect(names).toContain("Harbor Coffee Shop");
        expect(names).not.toContain("Berlin Coffee Shop");
        expect(result.companies.find(c => c.name === "Harbor Coffee Shop")).toMatchObject({
            source: "exa",
            country: "US",
            region: "Baltimore",
        });
    });

    it("refuses a place it cannot find", async () => {
        await expect(
            findSimilarCompanies(
                { offering: "Coffee", place: "Nowhereland", limit: 5 },
                {
                    embed: null,
                    judgeFit: null,
                    geocode: async () => null,
                    vocabulary,
                    searchCompanies: null,
                }
            )
        ).rejects.toBeInstanceOf(SimilarCompaniesError);
    });
});
