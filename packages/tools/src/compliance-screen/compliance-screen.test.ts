import { describe, expect, it } from "vitest";

import { createStaticComplianceProvider, createYenteProvider } from "./index";

describe("yente provider", () => {
    it("posts a Company query and maps results above the threshold", async () => {
        let captured: { url: string; body: unknown } | null = null;
        const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
            captured = {
                url:
                    typeof input === "string"
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input.url,
                body: JSON.parse(init?.body as string),
            };
            return new Response(
                JSON.stringify({
                    responses: {
                        q: {
                            results: [
                                {
                                    id: "NK-1",
                                    caption: "Acme Import",
                                    score: 0.91,
                                    datasets: ["us_ofac_sdn"],
                                    properties: { topics: ["sanction"] },
                                },
                                {
                                    id: "NK-2",
                                    caption: "Acme Imports Ltd",
                                    score: 0.2,
                                    datasets: ["gb_hmt"],
                                    properties: { topics: ["sanction"] },
                                },
                            ],
                        },
                    },
                }),
                { status: 200, headers: { "content-type": "application/json" } }
            );
        }) as typeof fetch;
        const provider = createYenteProvider({ baseUrl: "http://yente:8000/", fetchImpl });
        const result = await provider.screen({ name: "Acme Import", country: "DE" });
        expect(captured!.url).toBe("http://yente:8000/match/default");
        expect(
            (captured!.body as { queries: { q: { properties: { country: string[] } } } }).queries.q
                .properties.country
        ).toEqual(["de"]);
        expect(result.flags).toHaveLength(1);
        expect(result.flags[0]).toMatchObject({
            entityId: "NK-1",
            topics: ["sanction"],
            datasets: ["us_ofac_sdn"],
        });
    });
});

describe("static provider", () => {
    it("matches by case-insensitive name", async () => {
        const provider = createStaticComplianceProvider({
            "Shady Trading": [
                {
                    entityId: "x",
                    matchedName: "Shady Trading",
                    score: 0.9,
                    topics: ["sanction"],
                    datasets: ["d"],
                },
            ],
        });
        expect((await provider.screen({ name: "shady trading" })).flags).toHaveLength(1);
        expect((await provider.screen({ name: "Fine Foods" })).flags).toHaveLength(0);
    });
});
