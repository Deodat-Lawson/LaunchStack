import { describe, expect, it } from "vitest";

import { buildPlanPrompt, sanitizePlan, type PlanInput } from "./plan";
import type { DiscoveryPlan } from "./types";

const input: PlanInput = {
    program: {
        id: "p",
        companyId: 1n,
        createdByUserId: "u",
        name: "EU coffee",
        offering: "Roasted specialty coffee",
        categories: ["coffee"],
        hsCodes: ["0901"],
        targetTerritories: [
            { country: "DE" },
            { country: "NL", region: "Amsterdam", radiusMeters: 15000 },
        ],
        partnerKinds: ["importer", "retailer"],
        constraints: null,
        knownPartnerDomains: [],
        status: "active",
        createdAt: new Date(),
        updatedAt: null,
    },
    profile: {
        companyName: "Kohi Roasters",
        industry: "Food",
        identity: "Kohi Roasters — specialty roaster",
        knowledgeContext: "",
    },
    territories: [{ country: "DE" }, { country: "NL", region: "Amsterdam", radiusMeters: 15000 }],
    partnerKinds: ["importer", "retailer"],
    sources: { web: true, place: true, trade: false },
};

const plan: DiscoveryPlan = {
    adjacentBrands: ["Beta Roasters"],
    strategy: "Map Beta's channels first.",
    queries: [
        {
            kind: "web",
            territory: { country: "DE" },
            partnerKind: "importer",
            query: "Beta Roasters Importeur Deutschland",
            label: "brand-channel",
            rationale: "r",
        },
        {
            kind: "trade",
            territory: { country: "DE" },
            partnerKind: "importer",
            query: "coffee",
            label: "trade",
            rationale: "r",
        },
        {
            kind: "web",
            territory: { country: "FR" },
            partnerKind: "importer",
            query: "importateur café",
            label: "directory",
            rationale: "r",
        },
        {
            kind: "web",
            territory: { country: "DE" },
            partnerKind: "distributor",
            query: "Kaffee Großhandel",
            label: "directory",
            rationale: "r",
        },
        {
            kind: "place",
            territory: { country: "DE" },
            partnerKind: "retailer",
            query: "specialty coffee shop",
            label: "place",
            rationale: "r",
        },
        {
            kind: "place",
            territory: { country: "NL" },
            partnerKind: "retailer",
            query: "koffiebranderij",
            label: "place",
            rationale: "r",
            categoryIds: ["13035"],
        },
        {
            kind: "web",
            territory: { country: "DE" },
            partnerKind: "importer",
            query: "Kohi Roasters Deutschland",
            label: "brand-channel",
            rationale: "r",
        },
    ],
};

describe("sanitizePlan", () => {
    it("drops unavailable sources, foreign territories, unwanted kinds, country-only place queries and seller-named queries", () => {
        const out = sanitizePlan(plan, input);
        expect(out.queries.map(q => q.query)).toEqual([
            "Beta Roasters Importeur Deutschland",
            "koffiebranderij",
        ]);
    });
    it("snaps a country-only territory onto the program's territory so place queries inherit region and radius", () => {
        const out = sanitizePlan(plan, input);
        const place = out.queries.find(q => q.kind === "place")!;
        expect(place.territory).toEqual({
            country: "NL",
            region: "Amsterdam",
            radiusMeters: 15000,
        });
    });
});

describe("buildPlanPrompt", () => {
    it("names the available sources and every territory and kind", () => {
        const prompt = buildPlanPrompt(input);
        expect(prompt).toContain("web search (kind: web)");
        expect(prompt).toContain("place search");
        expect(prompt).not.toContain("kind: trade");
        expect(prompt).toContain("Amsterdam, NL");
        expect(prompt).toContain("importer, retailer");
    });
});
