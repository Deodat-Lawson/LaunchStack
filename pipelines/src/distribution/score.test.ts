import { describe, expect, it } from "vitest";

import { computeFit, deriveRiskFlags, templateRationale } from "./score";
import type { Dossier, PartnerOrgRecord, ProgramRecord } from "./types";

const program: ProgramRecord = {
    id: "p1",
    companyId: 1n,
    createdByUserId: "u",
    name: "EU specialty coffee",
    offering: "Single-origin roasted coffee beans and drip bags for specialty retail",
    categories: ["specialty coffee", "roasted coffee"],
    hsCodes: ["0901"],
    targetTerritories: [
        { country: "DE" },
        { country: "NL", region: "Amsterdam", radiusMeters: 20000 },
    ],
    partnerKinds: ["importer", "distributor", "retailer"],
    constraints: null,
    knownPartnerDomains: [],
    status: "active",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: null,
};

function org(overrides: Partial<PartnerOrgRecord> = {}): PartnerOrgRecord {
    return {
        id: "o1",
        companyId: 1n,
        resolveKey: "d:acme-import.de",
        name: "Acme Import GmbH",
        domain: "acme-import.de",
        country: "DE",
        region: null,
        city: null,
        lat: null,
        lng: null,
        roles: ["importer"],
        categories: ["coffee", "tea"],
        sizeBand: null,
        description: "Importer and distributor of specialty coffee and tea for the German market",
        kgEntityId: null,
        firstSeenRunId: null,
        lastEnrichedAt: null,
        createdAt: new Date(),
        updatedAt: null,
        ...overrides,
    };
}

const dossier: Dossier = {
    summary:
        "Acme imports specialty coffee from Latin America and distributes to independent cafés across Germany. It carries three adjacent roasters.",
    roles: ["importer", "distributor"],
    brandsCarried: [
        { brand: "Beta Roasters", evidenceIds: [1] },
        { brand: "Gamma Coffee", evidenceIds: [2] },
    ],
    territories: [{ territory: "Germany", evidenceIds: [1] }],
    retailCoverage: [{ account: "Independent cafés", evidenceIds: [3] }],
    certifications: [{ certification: "EU organic", evidenceIds: [4] }],
    decisionMakers: [{ title: "Head of Purchasing", evidenceIds: [5] }],
    contactChannels: [{ channel: "email", value: "import@acme-import.de", evidenceIds: [5] }],
    risks: [],
    sizeBand: "small",
    openQuestions: [],
};

const now = new Date("2026-09-03T00:00:00Z");

describe("computeFit", () => {
    it("scores a strong, fresh, well-evidenced match high and explains it", () => {
        const fit = computeFit({
            program,
            org: org(),
            kind: "importer",
            territory: { country: "DE" },
            dossier,
            evidenceCount: 12,
            newestEvidenceAt: new Date("2026-09-01T00:00:00Z"),
            knownEntity: true,
            sellerName: "Kōhī Roasters",
            now,
        });
        expect(fit.total).toBeGreaterThanOrEqual(85);
        expect(fit.roleMatch).toBe(20);
        expect(fit.territoryMatch).toBe(20);
        expect(fit.knownSignal).toBe(10);
        expect(fit.excludedBecause).toBeUndefined();
    });

    it("is deterministic", () => {
        const args = {
            program,
            org: org(),
            kind: "importer" as const,
            territory: { country: "DE" },
            dossier,
            evidenceCount: 5,
            newestEvidenceAt: now,
            knownEntity: false,
            sellerName: "x",
            now,
        };
        expect(computeFit(args)).toEqual(computeFit(args));
    });

    it("zeroes the seller itself and named competitors", () => {
        expect(
            computeFit({
                program,
                org: org({ name: "Kōhī Roasters" }),
                kind: "importer",
                territory: null,
                dossier: null,
                evidenceCount: 0,
                newestEvidenceAt: null,
                knownEntity: false,
                sellerName: "Kōhī Roasters",
                now,
            }).total
        ).toBe(0);
        const fit = computeFit({
            program,
            org: org({ name: "Rival Roasters" }),
            kind: "importer",
            territory: null,
            dossier: null,
            evidenceCount: 0,
            newestEvidenceAt: null,
            knownEntity: false,
            sellerName: "x",
            competitorNames: ["Rival Roasters"],
            now,
        });
        expect(fit.total).toBe(0);
        expect(fit.excludedBecause).toMatch(/competitor/);
    });

    it("penalises wrong territory, unconfirmed role and thin, stale evidence", () => {
        const fit = computeFit({
            program,
            org: org({
                country: "FR",
                roles: ["retailer"],
                categories: [],
                description: "Furniture",
            }),
            kind: "importer",
            territory: { country: "DE" },
            dossier: null,
            evidenceCount: 1,
            newestEvidenceAt: new Date("2023-01-01T00:00:00Z"),
            knownEntity: false,
            sellerName: "x",
            now,
        });
        expect(fit.territoryMatch).toBe(0);
        expect(fit.roleMatch).toBe(0);
        expect(fit.freshness).toBe(0);
        expect(fit.total).toBeLessThan(25);
    });

    it("never exceeds 100 or drops below 0", () => {
        const fit = computeFit({
            program,
            org: org(),
            kind: "importer",
            territory: { country: "DE" },
            dossier,
            evidenceCount: 100,
            newestEvidenceAt: now,
            knownEntity: true,
            sellerName: "x",
            now,
        });
        expect(fit.total).toBeLessThanOrEqual(100);
        expect(fit.total).toBeGreaterThanOrEqual(0);
    });
});

describe("risk flags and rationale", () => {
    it("derives flags deterministically from the inputs", () => {
        const breakdown = computeFit({
            program,
            org: org(),
            kind: "importer",
            territory: { country: "DE" },
            dossier: null,
            evidenceCount: 0,
            newestEvidenceAt: null,
            knownEntity: false,
            sellerName: "x",
            now,
        });
        const flags = deriveRiskFlags({
            dossier: null,
            breakdown,
            evidenceCount: 0,
            budgetExhausted: true,
        });
        expect(flags).toContain("no evidence recorded");
        expect(flags).toContain("research budget exhausted");
    });
    it("writes a template rationale that names the strongest and weakest factor", () => {
        const breakdown = computeFit({
            program,
            org: org(),
            kind: "importer",
            territory: { country: "DE" },
            dossier,
            evidenceCount: 12,
            newestEvidenceAt: now,
            knownEntity: false,
            sellerName: "x",
            now,
        });
        const text = templateRationale({
            breakdown,
            orgName: "Acme Import GmbH",
            kind: "importer",
        });
        expect(text).toMatch(/scores \d+\/100/);
        expect(text).toMatch(/Strongest:/);
        expect(text).toMatch(/Main reservation:/);
    });
});
