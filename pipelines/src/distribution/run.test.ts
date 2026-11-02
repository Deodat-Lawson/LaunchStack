/**
 * prepareRun's discovery wiring over an in-memory program: lookalike seeds
 * come from the customers the program names and its won deals, company
 * search is told to leave out exclusions, customers and seeds, and none of
 * them reaches the shortlist even when a vendor sends them back. Fixture
 * ports (no company index) keep the old path and skip lookalikes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedOrg } from "@launchstack/tools/org-resolver";
import type { CompanyHit } from "@launchstack/tools/web-research";

import type { ProgramRecord, RunRecord } from "./types";

const store = vi.hoisted(() => ({
    program: null as unknown,
    run: null as unknown,
    exclusions: { domains: [] as string[], keys: [] as string[] },
    won: [] as string[],
    upserted: [] as ResolvedOrg[],
    wonCalls: 0,
}));

vi.mock("@launchstack/tools/company-context", () => ({
    getCompanyIdentity: async () => ({
        data: {
            name: "Seller BV",
            industry: "Logistics software",
            description: "",
            categories: [],
        },
    }),
    buildCompanyKnowledgeContext: async () => "",
    formatCompanyIdentity: () => "Company: Seller BV.",
}));

vi.mock("./db", () => ({
    getProgram: async () => store.program,
    getRun: async () => store.run,
    updateRun: async () => undefined,
    listExclusions: async () => store.exclusions,
    listWonDomains: async () => {
        store.wonCalls += 1;
        return store.won;
    },
    upsertOrgs: async ({ orgs }: { orgs: ResolvedOrg[] }) => {
        store.upserted = orgs;
        return orgs.map((o, i) => ({ id: `org-${i}`, resolveKey: o.resolveKey, kgEntityId: 1 }));
    },
    findKnownOrgEntity: async () => null,
    updateOrg: async () => undefined,
    upsertCandidateRelationships: async ({
        items,
    }: {
        items: Array<{ orgId: string; kind: string }>;
    }) => items.map((item, i) => ({ id: `rel-${i}`, ...item, stage: "lead" })),
}));

import { createFixturePorts } from "./fixture";
import { prepareRun, type DistributionPorts } from "./run";

const program = {
    id: "prog-1",
    companyId: 1n,
    createdByUserId: "u1",
    name: "NL fulfilment",
    offering: "Picking robots for fulfilment warehouses",
    categories: ["fulfilment"],
    hsCodes: [],
    targetTerritories: [{ country: "NL" }],
    partnerKinds: ["distributor"],
    constraints: null,
    knownPartnerDomains: ["partner.example"],
    customerDomains: ["customer-one.example", "customer-two.example"],
    status: "active",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: null,
} satisfies ProgramRecord;

const run = {
    id: "run-1",
    companyId: 1n,
    programId: "prog-1",
    userId: "u1",
    status: "queued",
    options: { maxCandidates: 25, mode: "live" },
    plan: null,
    summary: null,
    candidateOrgIds: null,
    creditsUsed: 0,
    errorMessage: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
} satisfies RunRecord;

const ctx = { runId: "run-1", companyId: 1n, programId: "prog-1" };

const hit = (domain: string, title: string): CompanyHit => ({
    title,
    url: `https://${domain}/`,
    domain,
    description: "Fulfilment and warehousing for webshops.",
});

/** Every company we must never prospect, sent back by a vendor that ignores exclusions. */
const NEVER = [
    "customer-one.example",
    "customer-two.example",
    "won.example",
    "partner.example",
    "contacted.example",
];

function livePorts(calls: {
    described: string[][];
    searches: Array<{ query: string; excludeDomains: readonly string[] }>;
}): DistributionPorts {
    return {
        model: { respond: vi.fn() },
        fetchPage: vi.fn(),
        searchWeb: async () => {
            throw new Error("discovery must use company search when it is configured");
        },
        searchCompanies: async (query, options) => {
            calls.searches.push({ query, excludeDomains: options.excludeDomains });
            const fresh = query.startsWith("Companies similar to")
                ? hit("lookalike-fulfilment.example", "Lookalike Fulfilment BV")
                : hit("fresh-warehouse.example", "Home | Fresh Warehouse BV");
            return [...NEVER.map(d => hit(d, d)), fresh];
        },
        describeCompanies: async urls => {
            calls.described.push(urls);
            return [];
        },
        searchPlaces: null,
        tradeData: null,
        compliance: null,
        publishDossier: null,
        debitCredits: null,
        writeRationale: null,
        creditsPerCandidate: 0,
        plan: async () => ({
            plan: {
                adjacentBrands: [],
                strategy: "",
                queries: [
                    {
                        kind: "web",
                        territory: { country: "NL" },
                        partnerKind: "distributor",
                        query: "fulfilment warehouses Netherlands",
                        label: "directory",
                        rationale: "r",
                    },
                ],
            },
            playbookHash: "test",
        }),
    };
}

beforeEach(() => {
    store.program = program;
    store.run = run;
    // What listExclusions returns for this program: its exclusions, the
    // customers it names, and every company already past candidate.
    store.exclusions = {
        domains: [
            "partner.example",
            "customer-one.example",
            "customer-two.example",
            "won.example",
            "contacted.example",
        ],
        keys: [],
    };
    store.won = ["won.example"];
    store.upserted = [];
    store.wonCalls = 0;
});

describe("prepareRun discovery", () => {
    it("ranks confirmed local first, and lets the fit check decide on a country a text names", async () => {
        const calls = { described: [] as string[][], searches: [] };
        const about = (domain: string, title: string, description: string): CompanyHit => ({
            ...hit(domain, title),
            description,
        });
        const asked: Array<{ where: string; seller: unknown; ids: string[] }> = [];
        const ports: DistributionPorts = {
            ...livePorts(calls),
            searchCompanies: async query =>
                query.startsWith("Companies similar to")
                    ? []
                    : [
                          about("silent.example", "Silent Fulfilment", "Fulfilment for webshops."),
                          about("berlin.example", "Berlin Fulfilment", "Fulfilment in Germany."),
                          about(
                              "sourcing.example",
                              "Sourcing Fulfilment",
                              "Fulfilment with parts from Germany."
                          ),
                          about(
                              "local.example",
                              "Local Fulfilment",
                              "Fulfilment in the Netherlands."
                          ),
                      ],
            judgeFit: async ({ where, seller, candidates }) => {
                asked.push({ where, seller, ids: candidates.map(c => c.name) });
                return new Map(
                    candidates.map(c => [
                        c.id,
                        c.name === "Berlin Fulfilment"
                            ? { fit: false, reason: "It is in Germany." }
                            : { fit: true, reason: "Fulfilment." },
                    ])
                );
            },
        };
        const prepared = await prepareRun(ctx, ports);

        expect(asked[0]!.where).toBe("Netherlands");
        expect(asked[0]!.seller).toBeTruthy();
        // Everything goes to the fit check: confirmed first, named elsewhere last.
        expect(asked[0]!.ids[0]).toBe("Local Fulfilment");
        expect(asked[0]!.ids.slice(-2).sort()).toEqual([
            "Berlin Fulfilment",
            "Sourcing Fulfilment",
        ]);
        const names = store.upserted.map(o => o.name);
        expect(names[0]).toBe("Local Fulfilment");
        expect(names).not.toContain("Berlin Fulfilment");
        // Kept by the fit check: the country its text named was not where it is.
        const sourcing = store.upserted.find(o => o.name === "Sourcing Fulfilment")!;
        expect(sourcing.country).toBeNull();
        expect(prepared.warnings.join(" ")).toMatch(/1 the fit check judged/);
    });

    it("seeds lookalikes from named customers and won deals, and never shortlists them", async () => {
        const calls = {
            described: [] as string[][],
            searches: [] as Array<{ query: string; excludeDomains: readonly string[] }>,
        };
        const prepared = await prepareRun(ctx, livePorts(calls));

        expect(calls.described).toEqual([
            [
                "https://customer-two.example/",
                "https://customer-one.example/",
                "https://won.example/",
            ],
        ]);
        expect(calls.searches.map(s => s.query)).toEqual(
            expect.arrayContaining([
                "fulfilment warehouses Netherlands",
                "Companies similar to customer-two.example",
                "Companies similar to customer-one.example",
                "Companies similar to won.example",
            ])
        );
        for (const s of calls.searches)
            expect(s.excludeDomains).toEqual(expect.arrayContaining(NEVER));

        expect(store.upserted.map(o => o.domain).sort()).toEqual([
            "fresh-warehouse.example",
            "lookalike-fulfilment.example",
        ]);
        expect(store.upserted.find(o => o.domain === "fresh-warehouse.example")!.name).toBe(
            "Fresh Warehouse BV"
        );
        expect(prepared.sources.map(s => [s.source, s.status, s.results])).toEqual([
            ["lookalike", "ok", 3],
            ["place", "skipped", 0],
            ["trade", "skipped", 0],
            ["web", "ok", 1],
        ]);
        expect(prepared.candidateRelationshipIds).toHaveLength(2);
    });

    it("keeps fixture runs on their own search and skips lookalikes", async () => {
        const prepared = await prepareRun(ctx, createFixturePorts({ category: "fulfilment" }));
        expect(store.wonCalls).toBe(0);
        const bySource = Object.fromEntries(prepared.sources.map(s => [s.source, s]));
        expect(bySource.web!.status).toBe("ok");
        expect(bySource.lookalike).toMatchObject({
            status: "skipped",
            detail: "needs EXA_API_KEY",
        });
        expect(store.upserted.some(o => o.domain !== null && NEVER.includes(o.domain))).toBe(false);
    });
});
