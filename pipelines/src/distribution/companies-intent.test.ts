import { describe, expect, it } from "vitest";

import { buildMatchPrompt } from "./judge";
import { buildCompaniesPlanPrompt, sanitizePlan, type PlanInput } from "./plan";
import { computeFit, templateRationale } from "./score";
import { buyerBrief, judgeQuestionFor } from "./semantic";
import type { DiscoveryPlan, PartnerOrgRecord, ProgramRecord } from "./types";

const companies: ProgramRecord = {
    id: "p",
    companyId: 1n,
    createdByUserId: "u",
    name: "Big LA tech",
    offering: "Tech companies worth $3B or more",
    categories: [],
    hsCodes: [],
    targetTerritories: [{ country: "US", region: "Los Angeles" }],
    partnerKinds: ["distributor", "retailer", "wholesaler"],
    constraints: null,
    knownPartnerDomains: [],
    customerDomains: [],
    intent: "companies",
    status: "active",
    createdAt: new Date(),
    updatedAt: null,
};

const input: PlanInput = {
    program: companies,
    profile: {
        companyName: "Acme",
        industry: "Software",
        identity: "Acme sells CRM",
        knowledgeContext: "",
    },
    territories: companies.targetTerritories,
    partnerKinds: companies.partnerKinds,
    sources: { web: true, place: true, trade: true },
};

describe("a companies segment", () => {
    it("is matched against the description, with no seller or buying in the brief", () => {
        const brief = buyerBrief(companies, companies.partnerKinds, {
            identity: "Acme sells CRM to dentists",
        });
        expect(brief).toContain(
            "Companies matching this description: Tech companies worth $3B or more"
        );
        expect(brief).not.toMatch(/buy|resell|Acme|distributor/i);
        expect(judgeQuestionFor(companies)).toBe("match");
        expect(judgeQuestionFor({ ...companies, intent: "partners" })).toBe("buyer");
    });

    it("asks the judge about the description and place only", () => {
        const prompt = buildMatchPrompt("Companies matching: big tech", "Los Angeles, US", [
            { id: "1", name: "Snap", text: "Snap Inc., Santa Monica" },
        ]);
        expect(prompt).toContain("What they want: Companies matching: big tech");
        expect(prompt).toContain("Where: Los Angeles, US");
        expect(prompt).not.toContain("seller");
    });

    it("plans web searches only, each with a usable partner kind", () => {
        expect(buildCompaniesPlanPrompt(input)).toContain(
            "Companies wanted: Tech companies worth $3B or more"
        );
        const plan: DiscoveryPlan = {
            strategy: "s",
            adjacentBrands: [],
            queries: [
                {
                    kind: "web",
                    label: "company",
                    query: "software company Santa Monica",
                    rationale: "r",
                    territory: { country: "US", region: "Los Angeles" },
                    partnerKind: "agent",
                },
                {
                    kind: "place",
                    label: "place",
                    query: "tech",
                    rationale: "r",
                    territory: { country: "US", region: "Los Angeles" },
                    partnerKind: "distributor",
                },
                {
                    kind: "trade",
                    label: "trade",
                    query: "tech",
                    rationale: "r",
                    territory: { country: "US" },
                    partnerKind: "importer",
                },
            ],
        } as DiscoveryPlan;
        const out = sanitizePlan(plan, input);
        expect(out.queries).toHaveLength(1);
        expect(out.queries[0]!.kind).toBe("web");
        expect(out.queries[0]!.partnerKind).toBe("distributor");
    });

    it("gives role points to a company that passed the match check, and none once ruled out", () => {
        const org = {
            id: "o",
            name: "Snap Inc.",
            domain: "snap.com",
            country: "US",
            region: null,
            city: null,
            roles: [],
            categories: ["software"],
            description: "Snap Inc. is a technology company in Santa Monica.",
            sizeBand: "large",
            kgEntityId: null,
        } as unknown as PartnerOrgRecord;
        const args = {
            program: companies,
            org,
            kind: "distributor" as const,
            territory: { country: "US", region: "Los Angeles" },
            dossier: null,
            evidenceCount: 8,
            newestEvidenceAt: new Date(),
            knownEntity: false,
            sellerName: "Acme",
            relevance: 0.8,
        };
        expect(computeFit(args).roleMatch).toBe(20);
        const ruledOut = computeFit({ ...args, rejectedBecause: "Private, revenue under $3B." });
        expect(ruledOut.total).toBe(0);
        expect(
            templateRationale({ breakdown: ruledOut, orgName: "Snap Inc.", kind: "distributor" })
        ).toContain("Private, revenue under $3B.");
    });
});
