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
    statuses: [] as string[],
    relationships: new Map<string, { id: string; orgId: string; kind: string }>(),
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
    updateRun: async (_id: string, _companyId: bigint, patch: { status?: string }) => {
        if (patch.status) store.statuses.push(patch.status);
    },
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
    }) => {
        const rows = items.map((item, i) => ({ id: `rel-${i}`, ...item, stage: "lead" }));
        for (const row of rows) store.relationships.set(row.id, row);
        return rows;
    },
    getRelationship: async (id: string) => ({
        ...store.relationships.get(id),
        territory: { country: "NL" },
    }),
    getOrg: async (id: string) => ({
        id,
        name: id,
        domain: `${id}.example`,
        country: "NL",
        region: null,
        city: null,
        roles: [],
        categories: [],
        description: null,
        sizeBand: null,
        kgEntityId: 1,
    }),
    listEvidenceForOrg: async () => [],
    setResearchResult: async () => undefined,
    addEvent: async () => undefined,
}));

import { createFixturePorts } from "./fixture";
import { prepareRun, runDistributionPipeline, type DistributionPorts } from "./run";

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
    store.statuses = [];
    store.relationships = new Map();
});

describe("prepareRun discovery", () => {
    it("keeps checking down the ranking when the fit check rejects a whole batch", async () => {
        const calls = { described: [] as string[][], searches: [] };
        const companies = Array.from({ length: 80 }, (_, i) =>
            hit(`firm-${i}.example`, `Fulfilment Firm ${i}`)
        );
        const rounds: number[] = [];
        const ports: DistributionPorts = {
            ...livePorts(calls),
            searchCompanies: async query =>
                query.startsWith("Companies similar to") ? [] : companies,
            // The first batch is all no's; everyone after it is a yes.
            judgeFit: async ({ candidates }) => {
                rounds.push(candidates.length);
                const no = rounds.length === 1;
                return new Map(
                    candidates.map(c => [c.id, { fit: !no, reason: no ? "No." : "Yes." }])
                );
            },
        };
        const prepared = await prepareRun(ctx, ports);

        expect(rounds.length).toBeGreaterThan(1);
        expect(prepared.candidateRelationshipIds.length).toBeGreaterThan(0);
        expect(prepared.warnings.join(" ")).toContain(`${rounds[0]} the fit check judged`);
    });

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

describe("runDistributionPipeline research", () => {
    /** Ports over `count` companies whose research records how many ran at once. */
    function trackingPorts(
        count: number,
        onProfile: (orgId: string) => void = () => undefined
    ): { ports: DistributionPorts; seen: { peak: number; orgs: string[] } } {
        const seen = { peak: 0, orgs: [] as string[] };
        let running = 0;
        const ports: DistributionPorts = {
            ...livePorts({ described: [], searches: [] }),
            searchCompanies: async query =>
                query.startsWith("Companies similar to")
                    ? []
                    : Array.from({ length: count }, (_, i) =>
                          hit(`firm-${i}.example`, `Fulfilment Firm ${i}`)
                      ),
            profile: async (_ports, input) => {
                running += 1;
                seen.peak = Math.max(seen.peak, running);
                seen.orgs.push(input.org.id);
                await new Promise(resolve => setTimeout(resolve, 1));
                running -= 1;
                onProfile(input.org.id);
                return {
                    outcome: { status: "gate_failed", dossier: null, errors: [] },
                    evidence: [],
                    fetchedUrls: [],
                    turns: 0,
                    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                    modelId: "test",
                    playbookHash: "test",
                    promptVersion: "test",
                };
            },
        };
        return { ports, seen };
    }

    it("researches every candidate once, up to the ports' limit at a time", async () => {
        const { ports, seen } = trackingPorts(12);
        const summary = await runDistributionPipeline(ctx, { ...ports, enrichConcurrency: 3 });

        expect(seen.peak).toBe(3);
        expect(new Set(seen.orgs).size).toBe(12);
        expect(seen.orgs).toHaveLength(12);
        expect(summary.shortlisted).toBe(12);
        expect(summary.gateRejections).toBe(12);
        expect(store.statuses.at(-1)).toBe("completed");
    });

    it("can stop at the shortlist without researching anyone", async () => {
        const { ports, seen } = trackingPorts(8);
        const summary = await runDistributionPipeline(
            ctx,
            { ...ports, enrichConcurrency: 3 },
            { enrich: false }
        );
        expect(seen.orgs).toHaveLength(0);
        expect(summary.shortlisted).toBe(8);
        expect(summary.enriched).toBe(0);
        expect(store.statuses.at(-1)).toBe("completed");
    });

    it("stays one at a time when the ports set no limit", async () => {
        const { ports, seen } = trackingPorts(4);
        await runDistributionPipeline(ctx, ports);
        expect(seen.peak).toBe(1);
        expect(seen.orgs).toHaveLength(4);
    });

    it("marks the run failed and starts no one else when a candidate throws", async () => {
        const { ports, seen } = trackingPorts(12, orgId => {
            if (orgId === seen.orgs[0]) throw new Error("database went away");
        });
        await expect(
            runDistributionPipeline(ctx, { ...ports, enrichConcurrency: 3 })
        ).rejects.toThrow("database went away");

        expect(seen.orgs.length).toBeLessThan(12);
        expect(store.statuses.at(-1)).toBe("failed");
    });
});
