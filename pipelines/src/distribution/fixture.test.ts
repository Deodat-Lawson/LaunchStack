import { describe, expect, it } from "vitest";

import { runDossierAgent } from "./dossier-agent";
import { buildFixturePlan, buildFixtureWorld, createFixturePorts } from "./fixture";
import { gather } from "./gather";
import type { PartnerOrgRecord, ProgramRecord } from "./types";

const program = {
    id: "p",
    companyId: 1n,
    createdByUserId: "u",
    name: "EU coffee",
    offering: "Roasted specialty coffee",
    categories: ["specialty coffee"],
    hsCodes: ["0901"],
    targetTerritories: [{ country: "DE" }, { country: "NL" }],
    partnerKinds: ["importer", "distributor"],
    constraints: null,
    knownPartnerDomains: [],
    status: "active",
    createdAt: new Date(),
    updatedAt: null,
} as ProgramRecord;

describe("fixture world", () => {
    it("writes the program's category into every organisation's pages", () => {
        const world = buildFixtureWorld("specialty coffee");
        expect(world.length).toBeGreaterThanOrEqual(6);
        expect(world.every(o => o.pages["/"]!.includes("specialty coffee"))).toBe(true);
        expect(world.find(o => o.flagged)).toBeDefined();
        expect(world.find(o => o.thin)).toBeDefined();
    });

    it("plans one canned query per territory × kind", () => {
        const plan = buildFixturePlan({
            program,
            profile: { companyName: "K", industry: "Food", identity: "", knowledgeContext: "" },
            territories: program.targetTerritories,
            partnerKinds: program.partnerKinds,
            sources: { web: true, place: false, trade: true },
        });
        expect(plan.queries).toHaveLength(4);
        expect(plan.queries.every(q => q.query.includes("country:"))).toBe(true);
    });

    it("gathers only the requested countries through the fixture search", async () => {
        const ports = createFixturePorts({ category: "specialty coffee" });
        const plan = buildFixturePlan({
            program,
            profile: { companyName: "K", industry: "Food", identity: "", knowledgeContext: "" },
            territories: [{ country: "DE" }],
            partnerKinds: ["importer"],
            sources: { web: true, place: false, trade: true },
        });
        const result = await gather(plan.queries, {
            searchWeb: qs =>
                ports.searchWeb!(
                    qs.map(q => ({
                        searchQuery: q.query,
                        category: q.label,
                        rationale: q.rationale,
                    }))
                ),
            searchPlaces: null,
            tradeData: ports.tradeData,
            hsCodes: ["0901"],
        });
        const webMentions = result.mentions.filter(m => m.source?.startsWith("web:"));
        expect(webMentions.length).toBe(2);
        expect(webMentions.every(m => m.country === "DE")).toBe(true);
        expect(result.sources.find(s => s.source === "trade")!.status).toBe("ok");
    });

    it("the scripted agent produces a grounded dossier through the real tools and gate", async () => {
        const world = buildFixtureWorld("specialty coffee");
        const ports = createFixturePorts({ category: "specialty coffee", world });
        const target = world[0]!;
        const org = {
            id: "o1",
            companyId: 1n,
            resolveKey: `d:${target.domain}`,
            name: target.name,
            domain: target.domain,
            country: target.country,
            region: null,
            city: target.city,
            lat: null,
            lng: null,
            roles: target.kinds,
            categories: [],
            sizeBand: null,
            description: null,
            kgEntityId: null,
            firstSeenRunId: null,
            lastEnrichedAt: null,
            createdAt: new Date(),
            updatedAt: null,
        } as PartnerOrgRecord;
        const store: Array<{ id: number }> = [];
        let next = 1;
        const result = await runDossierAgent(
            {
                model: ports.model,
                fetchPage: ports.fetchPage,
                searchWeb: q =>
                    ports.searchWeb!([{ searchQuery: q, category: "x", rationale: "" }]),
                searchPlaces: null,
                tradeData: ports.tradeData,
                recordEvidence: async () => {
                    const id = next++;
                    store.push({ id });
                    return id;
                },
            },
            {
                program,
                sellerSummary: "K",
                org,
                kind: "importer",
                territory: { country: "DE" },
                seedUrls: [`https://${target.domain}/`],
                hsCodes: ["0901"],
            }
        );
        expect(result.outcome.status).toBe("ok");
        expect(result.evidence.length).toBeGreaterThanOrEqual(5);
        expect(
            result.outcome.status === "ok" && result.outcome.dossier.brandsCarried.length
        ).toBeGreaterThan(0);
        expect(result.modelId).toBe("fixture/scripted-research-agent");
    });

    it("the thin organisation yields fewer facts and an open question", async () => {
        const world = buildFixtureWorld("specialty coffee");
        const ports = createFixturePorts({ category: "specialty coffee", world });
        const target = world.find(o => o.thin)!;
        const org = {
            id: "o2",
            companyId: 1n,
            resolveKey: `d:${target.domain}`,
            name: target.name,
            domain: target.domain,
            country: target.country,
            region: null,
            city: null,
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
        } as PartnerOrgRecord;
        let next = 1;
        const result = await runDossierAgent(
            {
                model: ports.model,
                fetchPage: ports.fetchPage,
                searchWeb: null,
                searchPlaces: null,
                tradeData: null,
                recordEvidence: async () => next++,
            },
            {
                program,
                sellerSummary: "K",
                org,
                kind: "retailer",
                territory: { country: "NL" },
                seedUrls: [],
                hsCodes: [],
            }
        );
        expect(result.outcome.status).toBe("ok");
        expect(result.evidence.length).toBeLessThan(5);
        expect(result.outcome.status === "ok" && result.outcome.dossier.openQuestions.length).toBe(
            1
        );
    });

    it("screens the flagged organisation and clears the others", async () => {
        const ports = createFixturePorts({ category: "tea" });
        const world = buildFixtureWorld("tea");
        const flagged = world.find(o => o.flagged)!;
        expect((await ports.compliance!.screen({ name: flagged.name })).flags).toHaveLength(1);
        expect((await ports.compliance!.screen({ name: world[0]!.name })).flags).toHaveLength(0);
    });
});
