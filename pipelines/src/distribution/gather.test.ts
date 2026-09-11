import { describe, expect, it } from "vitest";

import { createStaticTradeDataProvider } from "@launchstack/tools/trade-data";

import { gather, mentionFromWebResult } from "./gather";
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
