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
    /** Rows of the shortlisted organisations, in the shortlist's order. */
    shortlist: [] as string[],
    wonCalls: 0,
    /** What listFitExamples returns: verdicts known before the run. */
    examples: [] as Array<{ resolveKey: string; text: string; good: boolean; source: string }>,
    /** Every saveFitVerdicts call. */
    saved: [] as Array<{
        basis: string;
        segmentKey: string;
        verdicts: Array<{ resolveKey: string; name: string; text: string; fit: boolean }>;
    }>,
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
    listFitExamples: async () => store.examples,
    saveFitVerdicts: async (args: (typeof store.saved)[number]) => {
        store.saved.push(args);
    },
    upsertCandidateRelationships: async ({
        items,
    }: {
        items: Array<{ orgId: string; kind: string }>;
    }) => {
        store.shortlist = items.map(item => item.orgId);
        return items.map((item, i) => ({ id: `rel-${i}`, ...item, stage: "lead" }));
    },
}));

import { createFixturePorts } from "./fixture";
import { prepareRun, type DistributionPorts } from "./run";
import { fakeEmbed } from "./semantic.fixture";
import { LEARNING_ROUND, segmentKey } from "./shortlist";

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
    store.shortlist = [];
    store.wonCalls = 0;
    store.examples = [];
    store.saved = [];
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
            detail: "needs Exa as the search engine",
        });
        expect(store.upserted.some(o => o.domain !== null && NEVER.includes(o.domain))).toBe(false);
    });
});

describe("prepareRun with a ranking that learns", () => {
    // Two kinds of company the search returns. More of the brief's own words
    // sit in the agencies' listings, so the fixed ranking puts every agency
    // first; only the warehouse operators would buy picking robots.
    const AGENCIES = 30;
    const OPERATORS = 30;
    const companies: CompanyHit[] = [
        ...Array.from({ length: AGENCIES }, (_, i) => ({
            ...hit(`agency-${i}.example`, `Agency ${i}`),
            description:
                "Picking robots and fulfilment warehouses: software consultancy and marketing agency for webshops.",
        })),
        ...Array.from({ length: OPERATORS }, (_, i) => ({
            ...hit(`operator-${i}.example`, `Operator ${i}`),
            description:
                "Fulfilment warehouses operator: picking, storage and shipping for webshops.",
        })),
    ];
    const isOperator = (name: string): boolean => name.startsWith("Operator");

    function learningPorts(rounds: string[][], judge = true): DistributionPorts {
        return {
            ...livePorts({ described: [], searches: [] }),
            searchCompanies: async query =>
                query.startsWith("Companies similar to") ? [] : companies,
            embed: fakeEmbed,
            judgeFit: judge
                ? async ({ candidates }) => {
                      rounds.push(candidates.map(c => c.name));
                      return new Map(
                          candidates.map(c => [
                              c.id,
                              isOperator(c.name)
                                  ? { fit: true, reason: "Runs a warehouse." }
                                  : { fit: false, reason: "An agency." },
                          ])
                      );
                  }
                : null,
        };
    }

    it("asks in small rounds, turns to the kind the verdicts favour, and keeps every verdict", async () => {
        const rounds: string[][] = [];
        const prepared = await prepareRun(ctx, learningPorts(rounds));

        expect(rounds[0]).toHaveLength(LEARNING_ROUND);
        const asked = rounds.flat();
        // The fixed ranking would ask all thirty agencies before the first operator.
        expect(asked.filter(name => !isOperator(name)).length).toBeLessThan(AGENCIES / 2);
        expect(prepared.candidateRelationshipIds).toHaveLength(25);
        expect(prepared.fitCheck).toEqual({
            checked: asked.length,
            rounds: rounds.length,
            rejected: asked.filter(name => !isOperator(name)).length,
            learning: true,
            startedFrom: 0,
        });

        expect(store.saved).toHaveLength(1);
        const saved = store.saved[0]!;
        expect(saved.basis).toBe("listing");
        expect(saved.segmentKey).toBe(segmentKey(program));
        expect(saved.verdicts.map(v => v.name).sort()).toEqual([...asked].sort());
        expect(saved.verdicts.every(v => v.fit === isOperator(v.name))).toBe(true);
        expect(saved.verdicts[0]!.text).toContain(saved.verdicts[0]!.name);
    });

    it("starts from the verdicts it is given and asks the right kind first", async () => {
        // An earlier run met four companies of each kind; none of them comes back.
        store.examples = [
            ...Array.from({ length: 4 }, (_, i) => ({
                resolveKey: `d:old-agency-${i}.example`,
                text: `Old Agency ${i}. Picking robots and fulfilment warehouses: software consultancy and marketing agency for webshops.`,
                good: false,
                source: "listing",
            })),
            ...Array.from({ length: 4 }, (_, i) => ({
                resolveKey: `d:old-operator-${i}.example`,
                text: `Old Operator ${i}. Fulfilment warehouses operator: picking, storage and shipping for webshops.`,
                good: true,
                // Two were won by a person, two judged a fit by an earlier run.
                source: i < 2 ? "person" : "listing",
            })),
        ];
        const rounds: string[][] = [];
        const prepared = await prepareRun(ctx, learningPorts(rounds));

        expect(prepared.fitCheck?.startedFrom).toBe(8);
        expect(rounds[0]!.filter(isOperator).length).toBeGreaterThanOrEqual(LEARNING_ROUND - 2);
        // Nearly every check lands on a company that fits: about thirty for twenty-five places.
        expect(prepared.fitCheck!.checked).toBeLessThanOrEqual(34);
    });

    it("without a fit check, orders the list by what earlier verdicts taught", async () => {
        const before = await prepareRun(ctx, learningPorts([], false));
        expect(before.fitCheck).toBeUndefined();
        // By relevance alone: the agencies lead.
        expect(store.upserted.slice(0, 10).every(o => !isOperator(o.name))).toBe(true);

        store.examples = [
            ...Array.from({ length: 4 }, (_, i) => ({
                resolveKey: `d:old-agency-${i}.example`,
                text: `Old Agency ${i}. Picking robots and fulfilment warehouses: software consultancy and marketing agency for webshops.`,
                good: false,
                source: "person",
            })),
            ...Array.from({ length: 4 }, (_, i) => ({
                resolveKey: `d:old-operator-${i}.example`,
                text: `Old Operator ${i}. Fulfilment warehouses operator: picking, storage and shipping for webshops.`,
                good: true,
                source: "person",
            })),
        ];
        await prepareRun(ctx, learningPorts([], false));
        expect(store.upserted.slice(0, 10).every(o => isOperator(o.name))).toBe(true);
        expect(store.saved).toHaveLength(0);
    });

    it("keeps the fixed order and today's rounds when companies are matched by words", async () => {
        const rounds: string[][] = [];
        const prepared = await prepareRun(ctx, { ...learningPorts(rounds), embed: null });
        expect(rounds[0]).toHaveLength(50);
        expect(prepared.fitCheck?.learning).toBe(false);
        expect(prepared.fitCheck?.startedFrom).toBe(0);
    });

    /** The shortlist's company names, in its order. */
    const shortlisted = (): string[] =>
        store.shortlist.map(id => store.upserted[Number(id.replace("org-", ""))]!.name);
    const COULD_NOT_FINISH =
        "The fit check could not finish; part of the list is ranked by meaning only.";
    const COULD_NOT_RUN = "The fit check could not run; nobody on the list was checked.";
    const ONLY_THE_READ =
        "The fit check could not finish; the list holds only the companies it read.";

    it("fills the places a broken-off fit check left open from the ranking", async () => {
        const rounds: string[][] = [];
        const ports = learningPorts(rounds);
        let calls = 0;
        const prepared = await prepareRun(ctx, {
            ...ports,
            judgeFit: async input => {
                calls += 1;
                if (calls === 2) throw new Error("model down");
                return ports.judgeFit!(input);
            },
        });

        // One round was read; the model failed on the second.
        expect(rounds).toHaveLength(1);
        const read = rounds[0]!;
        const turnedAway = read.filter(name => !isOperator(name));
        expect(prepared.fitCheck).toEqual({
            checked: LEARNING_ROUND,
            rounds: 1,
            rejected: turnedAway.length,
            learning: true,
            startedFrom: 0,
            incomplete: true,
        });
        expect(prepared.warnings).toContain(COULD_NOT_FINISH);

        // The list is full all the same, and nobody the check turned away is on it.
        const names = shortlisted();
        expect(names).toHaveLength(25);
        expect(names.filter(name => turnedAway.includes(name))).toEqual([]);
        // First the companies it read and kept, then the ranking's next ones, unread.
        const kept = read.filter(isOperator);
        expect(kept.length).toBeGreaterThan(0);
        expect(names.slice(0, kept.length).sort()).toEqual([...kept].sort());
        const unread = store.upserted.map(o => o.name).filter(name => !read.includes(name));
        expect(names.slice(kept.length)).toEqual(unread.slice(0, 25 - kept.length));
        // What was read is still kept for the next run.
        expect(store.saved[0]!.verdicts.map(v => v.name).sort()).toEqual([...read].sort());
    });

    it("leaves the whole list to the ranking when the fit check fails at once", async () => {
        const prepared = await prepareRun(ctx, {
            ...learningPorts([]),
            judgeFit: async () => {
                throw new Error("model down");
            },
        });
        expect(prepared.fitCheck).toMatchObject({ checked: 0, rounds: 0, incomplete: true });
        expect(prepared.warnings).toContain(COULD_NOT_RUN);
        expect(prepared.warnings).not.toContain(COULD_NOT_FINISH);
        expect(shortlisted()).toEqual(store.upserted.slice(0, 25).map(o => o.name));
    });

    it("says so when a broken-off fit check leaves only the companies it read", async () => {
        // Every listing names Germany, outside this Dutch segment. The fit check
        // reads such a company and may keep it; unread, it is out, as with no check.
        const elsewhere: CompanyHit[] = Array.from({ length: 30 }, (_, i) => ({
            ...hit(`german-operator-${i}.example`, `German Operator ${i}`),
            description:
                "Fulfilment warehouses operator, with customers in Hamburg, Germany: picking, storage and shipping for webshops.",
        }));
        let calls = 0;
        const prepared = await prepareRun(ctx, {
            ...learningPorts([]),
            searchCompanies: async query =>
                query.startsWith("Companies similar to") ? [] : elsewhere,
            judgeFit: async ({ candidates }) => {
                calls += 1;
                if (calls === 2) throw new Error("model down");
                return new Map(
                    candidates.map(c => [c.id, { fit: true, reason: "Ships to the Netherlands." }])
                );
            },
        });
        expect(prepared.fitCheck).toMatchObject({ checked: LEARNING_ROUND, incomplete: true });
        // The ten it read and kept; the twenty it never reached stay out of the area.
        expect(shortlisted()).toHaveLength(LEARNING_ROUND);
        expect(prepared.warnings).toContain(ONLY_THE_READ);
        expect(prepared.warnings).not.toContain(COULD_NOT_FINISH);
    });

    it("still checks every round when an earlier verdict's embedding is broken", async () => {
        store.examples = [
            {
                resolveKey: "d:broken.example",
                text: "Broken Listing. Fulfilment warehouses operator.",
                good: true,
                source: "listing",
            },
        ];
        const rounds: string[][] = [];
        const prepared = await prepareRun(ctx, {
            ...learningPorts(rounds),
            embed: async texts =>
                (await fakeEmbed(texts)).map((vector, i) =>
                    texts[i]!.startsWith("Broken") ? vector.map(() => Number.NaN) : vector
                ),
        });
        // The broken verdict is left out; the fit check runs as on a first run.
        expect(prepared.fitCheck).toMatchObject({ learning: true, startedFrom: 0 });
        expect(prepared.fitCheck!.checked).toBeGreaterThanOrEqual(25);
        expect(rounds[0]).toHaveLength(LEARNING_ROUND);
        expect(shortlisted()).toHaveLength(25);
        expect(shortlisted().every(isOperator)).toBe(true);
    });

    it("keeps verdicts under the question this run asked, not the segment's widest one", async () => {
        const options = {
            ...run.options,
            territories: [{ country: "NL", region: "Utrecht" }],
            partnerKinds: ["retailer" as const],
        };
        store.program = {
            ...program,
            targetTerritories: [{ country: "NL" }, { country: "BE" }],
            partnerKinds: ["distributor", "retailer"],
        };
        store.run = { ...run, options };
        await prepareRun(ctx, learningPorts([]));

        const narrowed = segmentKey(store.program as ProgramRecord, options);
        expect(store.saved[0]!.segmentKey).toBe(narrowed);
        expect(narrowed).not.toBe(segmentKey(store.program as ProgramRecord));
    });
});
