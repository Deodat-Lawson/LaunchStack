/**
 * Fixture mode — the whole pipeline with every external dependency replaced
 * by deterministic stand-ins (design §8 "end-to-end dry run", made
 * repeatable):
 *
 *  - a plan built from the program, not from a model;
 *  - web search that returns canned organisations for the requested country;
 *  - pages served from an in-memory site per organisation;
 *  - a *scripted* research agent that fetches, records evidence with verbatim
 *    quotes, and submits a dossier — through the real tools, the real
 *    grounding gate, and the real scoring rubric;
 *  - static trade records and a static sanctions screen that flags one org.
 *
 * Persistence, exclusions, stages, dashboards and publishing are the real
 * code paths. Only the outside world is fake.
 */
import type { AgentModelPort, AgentModelResponse, AgentTranscriptItem } from "@launchstack/llm";
import { SUBMIT_TOOL_NAME } from "@launchstack/llm";
import { createStaticComplianceProvider } from "@launchstack/tools/compliance-screen";
import { createStaticTradeDataProvider } from "@launchstack/tools/trade-data";
import type { RawSearchResult, ReadablePage } from "@launchstack/tools/web-research";

import type { PlanInput } from "./plan";
import type { DistributionPorts, PublishDossierInput } from "./run";
import type { DiscoveryPlan, Dossier, PartnerKind, PlannedSourceQuery, Territory } from "./types";

export const FIXTURE_PLAYBOOK_HASH = "fixture-deterministic-plan";
export const FIXTURE_MODEL_ID = "fixture/scripted-research-agent";

// ─── The fixture world ───────────────────────────────────────────────────────

interface FixtureOrgTemplate {
    slug: string;
    name: string;
    country: string;
    city: string;
    kinds: PartnerKind[];
    /** Brands it carries; "{category}" is replaced with the program's first category. */
    brands: string[];
    retail: string[];
    certifications: string[];
    contactEmail: string;
    size: "micro" | "small" | "medium" | "large";
    /** Set on the organisation the static sanctions screen flags. */
    flagged?: boolean;
    /** A deliberately thin site: one page, few facts. */
    thin?: boolean;
}

const TEMPLATES: readonly FixtureOrgTemplate[] = [
    {
        slug: "nordwind-import",
        name: "Nordwind Import GmbH",
        country: "DE",
        city: "Hamburg",
        kinds: ["importer", "distributor"],
        brands: ["Beta Roasters", "Gamma {category}", "Kaffeehaus Nord"],
        retail: ["independent cafés", "Edeka regional stores"],
        certifications: ["EU organic", "IFS Broker"],
        contactEmail: "import@nordwind-import.example",
        size: "medium",
    },
    {
        slug: "rheinland-handel",
        name: "Rheinland Handel & Co. KG",
        country: "DE",
        city: "Köln",
        kinds: ["wholesaler"],
        brands: ["Delta {category}", "Bergland Foods"],
        retail: ["foodservice", "hotel groups"],
        certifications: ["ISO 22000"],
        contactEmail: "einkauf@rheinland-handel.example",
        size: "large",
    },
    {
        slug: "dutch-delights",
        name: "Dutch Delights B.V.",
        country: "NL",
        city: "Amsterdam",
        kinds: ["distributor", "importer"],
        brands: ["Beta Roasters", "Tulip {category}"],
        retail: ["Albert Heijn (regional)", "specialty shops"],
        certifications: ["Skal organic"],
        contactEmail: "sales@dutch-delights.example",
        size: "small",
    },
    {
        slug: "canal-concept-stores",
        name: "Canal Concept Stores",
        country: "NL",
        city: "Amsterdam",
        kinds: ["retailer"],
        brands: ["local {category} brands"],
        retail: ["own stores"],
        certifications: [],
        contactEmail: "hello@canal-concept.example",
        size: "micro",
        thin: true,
    },
    {
        slug: "maison-comptoir",
        name: "Maison Comptoir SAS",
        country: "FR",
        city: "Lyon",
        kinds: ["importer", "agent"],
        brands: ["Épicerie {category}", "Gamma {category}"],
        retail: ["épiceries fines", "La Grande Épicerie"],
        certifications: ["AB organic"],
        contactEmail: "contact@maison-comptoir.example",
        size: "medium",
    },
    {
        slug: "shady-trading",
        name: "Shady Trading Ltd",
        country: "GB",
        city: "London",
        kinds: ["importer", "distributor"],
        brands: ["assorted {category}"],
        retail: ["cash and carry"],
        certifications: [],
        contactEmail: "info@shady-trading.example",
        size: "small",
        flagged: true,
    },
    {
        slug: "iberia-distribucion",
        name: "Iberia Distribución S.L.",
        country: "ES",
        city: "Madrid",
        kinds: ["distributor"],
        brands: ["Sol {category}", "Beta Roasters"],
        retail: ["El Corte Inglés", "specialty shops"],
        certifications: ["IFS Broker"],
        contactEmail: "compras@iberia-distribucion.example",
        size: "medium",
    },
    {
        slug: "alpen-vertrieb",
        name: "Alpen Vertrieb AG",
        country: "CH",
        city: "Zürich",
        kinds: ["distributor", "importer"],
        brands: ["Bergland Foods", "Alpen {category}"],
        retail: ["Coop regional", "specialty shops"],
        certifications: ["Bio Suisse"],
        contactEmail: "office@alpen-vertrieb.example",
        size: "medium",
    },
];

export interface FixtureOrg extends FixtureOrgTemplate {
    domain: string;
    pages: Record<string, string>;
}

function fill(text: string, category: string): string {
    return text.replace(/\{category\}/g, category);
}

/** Materialise the fixture world for one program's category. */
export function buildFixtureWorld(category: string): FixtureOrg[] {
    const cat = category.trim() || "specialty goods";
    return TEMPLATES.map(t => {
        const domain = `${t.slug}.example`;
        const brands = t.brands.map(b => fill(b, cat));
        const home = [
            `${t.name}`,
            `${t.kinds.map(k => k[0]!.toUpperCase() + k.slice(1)).join(" and ")} of ${cat} based in ${t.city}.`,
            `We supply ${t.retail.join(" and ")} across ${countryName(t.country)}.`,
            t.certifications.length ? `Certified: ${t.certifications.join(", ")}.` : "",
            `Contact: ${t.contactEmail}`,
        ]
            .filter(Boolean)
            .join("\n");
        const brandsPage = [
            `Our brands`,
            `We carry ${brands.join(", ")}.`,
            `Founded in ${t.city}; team of ${t.size === "large" ? "120" : t.size === "medium" ? "40" : t.size === "small" ? "12" : "3"} people.`,
        ].join("\n");
        const pages: Record<string, string> = { "/": home };
        if (!t.thin) pages["/brands"] = brandsPage;
        return { ...t, brands, domain, pages };
    });
}

function countryName(code: string): string {
    return (
        (
            {
                DE: "Germany",
                NL: "the Netherlands",
                FR: "France",
                GB: "the United Kingdom",
                ES: "Spain",
                CH: "Switzerland",
                AT: "Austria",
                IT: "Italy",
                US: "the United States",
            } as Record<string, string>
        )[code] ?? code
    );
}

// ─── Deterministic plan ──────────────────────────────────────────────────────

export function buildFixturePlan(input: PlanInput): DiscoveryPlan {
    const queries: PlannedSourceQuery[] = [];
    for (const territory of input.territories) {
        for (const kind of input.partnerKinds) {
            queries.push({
                kind: "web",
                territory,
                partnerKind: kind,
                // The country name lets gather's query attribution match results
                // to the right territory, as a real localised query would.
                query: `${kind} ${input.program.categories[0] ?? input.program.offering.slice(0, 40)} ${countryName(territory.country)} country:${territory.country}`,
                label: "fixture",
                rationale: "Deterministic fixture query.",
            });
        }
    }
    if (queries.length === 0) {
        queries.push({
            kind: "web",
            territory: { country: "DE" },
            partnerKind: "distributor",
            query: "distributor country:DE",
            label: "fixture",
            rationale: "fallback",
        });
    }
    return {
        adjacentBrands: ["Beta Roasters", "Gamma", "Bergland Foods"],
        strategy: "Fixture plan: one canned query per territory × partner kind.",
        queries,
    };
}

// ─── Scripted research agent ─────────────────────────────────────────────────

function extractDomain(prompt: string): string | null {
    const match = /\(([a-z0-9.-]+\.[a-z]{2,})\)/i.exec(prompt);
    return match ? match[1]!.toLowerCase() : null;
}

function recordedIds(transcript: readonly AgentTranscriptItem[]): number[] {
    const ids: number[] = [];
    for (const item of transcript) {
        if (item.role !== "tool") continue;
        const m = /Recorded evidence (\d+)/.exec(item.content);
        if (m) ids.push(Number(m[1]));
    }
    return ids;
}

function assistantTurns(transcript: readonly AgentTranscriptItem[]): number {
    return transcript.filter(t => t.role === "assistant").length;
}

interface Fact {
    kind:
        | "role"
        | "brands_carried"
        | "retail_coverage"
        | "certification"
        | "contact"
        | "firmographic"
        | "territory";
    claim: string;
    quote: string;
    page: string;
}

function factsFor(org: FixtureOrg): Fact[] {
    const home = org.pages["/"]!;
    const facts: Fact[] = [
        {
            kind: "role",
            claim: `${org.name} acts as ${org.kinds.join(" and ")}.`,
            quote: home.split("\n")[1]!,
            page: "/",
        },
        {
            kind: "retail_coverage",
            claim: `Supplies ${org.retail.join(" and ")}.`,
            quote: home.split("\n")[2]!,
            page: "/",
        },
        {
            kind: "contact",
            claim: `Public mailbox ${org.contactEmail}.`,
            quote: `Contact: ${org.contactEmail}`,
            page: "/",
        },
    ];
    if (org.certifications.length) {
        facts.push({
            kind: "certification",
            claim: `Holds ${org.certifications.join(", ")}.`,
            quote: `Certified: ${org.certifications.join(", ")}.`,
            page: "/",
        });
    }
    const brands = org.pages["/brands"];
    if (brands) {
        facts.push({
            kind: "brands_carried",
            claim: `Carries ${org.brands.join(", ")}.`,
            quote: brands.split("\n")[1]!,
            page: "/brands",
        });
        facts.push({
            kind: "firmographic",
            claim: `Team size and origin.`,
            quote: brands.split("\n")[2]!,
            page: "/brands",
        });
    }
    return facts;
}

function dossierFor(org: FixtureOrg, ids: number[], byKind: Map<string, number[]>): Dossier {
    const pick = (kind: string) => byKind.get(kind) ?? ids.slice(0, 1);
    return {
        summary: `${org.name} is a ${org.kinds.join(" and ")} of ${org.brands.length} lines based in ${org.city}, supplying ${org.retail.join(" and ")} across ${countryName(org.country)}. ${org.certifications.length ? `It holds ${org.certifications.join(" and ")}.` : "No certifications are listed."} A first conversation should go to purchasing.`,
        roles: org.kinds,
        brandsCarried: org.pages["/brands"]
            ? org.brands.map(brand => ({ brand, evidenceIds: pick("brands_carried") }))
            : [],
        territories: [
            { territory: countryName(org.country), evidenceIds: pick("retail_coverage") },
        ],
        retailCoverage: org.retail.map(account => ({
            account,
            evidenceIds: pick("retail_coverage"),
        })),
        certifications: org.certifications.map(certification => ({
            certification,
            evidenceIds: pick("certification"),
        })),
        decisionMakers: [{ title: "Head of Purchasing", evidenceIds: pick("contact") }],
        contactChannels: [
            { channel: "email", value: org.contactEmail, evidenceIds: pick("contact") },
        ],
        risks: org.flagged
            ? [
                  {
                      risk: "Appears on a watchlist screen; confirm identity before any contact.",
                      evidenceIds: pick("role"),
                  },
              ]
            : [],
        sizeBand: org.pages["/brands"] ? org.size : "unknown",
        openQuestions: org.thin ? ["Range and ordering terms are not published."] : [],
    };
}

/** A model that behaves like a diligent researcher, every time. */
export function createScriptedResearchModel(world: readonly FixtureOrg[]): AgentModelPort {
    const byDomain = new Map(world.map(o => [o.domain, o]));
    return {
        async respond({ transcript }): Promise<AgentModelResponse> {
            const firstUser = transcript.find(t => t.role === "user");
            const prompt = firstUser && firstUser.role === "user" ? firstUser.text : "";
            const usage = { inputTokens: 400, outputTokens: 120, totalTokens: 520 };

            // Repair turn: the runner hands back the exact valid ids.
            if (prompt.startsWith("Your dossier failed validation")) {
                const domain =
                    extractDomain(prompt) ??
                    extractDomain(
                        transcript.map(t => (t.role === "user" ? t.text : "")).join("\n")
                    );
                const org = domain ? byDomain.get(domain) : undefined;
                const ids = [...prompt.matchAll(/^(\d+): /gm)].map(m => Number(m[1]));
                const dossier = org ? dossierFor(org, ids, new Map()) : null;
                return {
                    text: "",
                    toolCalls: [{ id: "repair", name: SUBMIT_TOOL_NAME, arguments: dossier ?? {} }],
                    usage,
                    modelId: FIXTURE_MODEL_ID,
                };
            }

            const domain = extractDomain(prompt);
            const org = domain ? byDomain.get(domain) : undefined;
            const turn = assistantTurns(transcript);
            if (!org) {
                // Unknown organisation: honest empty dossier.
                return {
                    text: "",
                    toolCalls: [
                        {
                            id: "s",
                            name: SUBMIT_TOOL_NAME,
                            arguments: {
                                summary:
                                    "No public information could be found for this organisation in the fixture world; treat as unresearched.",
                                roles: [],
                                brandsCarried: [],
                                territories: [],
                                retailCoverage: [],
                                certifications: [],
                                decisionMakers: [],
                                contactChannels: [],
                                risks: [],
                                sizeBand: "unknown",
                                openQuestions: ["Not in fixture set"],
                            },
                        },
                    ],
                    usage,
                    modelId: FIXTURE_MODEL_ID,
                };
            }
            if (turn === 0) {
                const calls = Object.keys(org.pages).map((path, i) => ({
                    id: `f${i}`,
                    name: "fetch_page",
                    arguments: { url: `https://${org.domain}${path}` },
                }));
                return { text: "", toolCalls: calls, usage, modelId: FIXTURE_MODEL_ID };
            }
            if (turn === 1) {
                const calls = factsFor(org).map((fact, i) => ({
                    id: `e${i}`,
                    name: "record_evidence",
                    arguments: {
                        kind: fact.kind,
                        claim: fact.claim,
                        sourceUrl: `https://${org.domain}${fact.page}`,
                        quote: fact.quote,
                        confidence: 0.9,
                    },
                }));
                return { text: "", toolCalls: calls, usage, modelId: FIXTURE_MODEL_ID };
            }
            const ids = recordedIds(transcript);
            const facts = factsFor(org);
            const byKind = new Map<string, number[]>();
            ids.forEach((id, i) => {
                const kind = facts[i]?.kind;
                if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
            });
            return {
                text: "",
                toolCalls: [
                    {
                        id: "submit",
                        name: SUBMIT_TOOL_NAME,
                        arguments: dossierFor(org, ids, byKind),
                    },
                ],
                usage,
                modelId: FIXTURE_MODEL_ID,
            };
        },
    };
}

// ─── Ports ───────────────────────────────────────────────────────────────────

export interface FixturePortsOptions {
    /** The program's first category, used to write the fixture pages. */
    category: string;
    publishDossier?: ((input: PublishDossierInput) => Promise<{ documentId: number }>) | null;
    debitCredits?: DistributionPorts["debitCredits"];
    /** Override the world (tests). */
    world?: FixtureOrg[];
}

function normalize(url: string): { domain: string; path: string } | null {
    try {
        const u = new URL(url);
        const path = u.pathname.replace(/\/+$/, "") || "/";
        return { domain: u.hostname.toLowerCase(), path };
    } catch {
        return null;
    }
}

export function createFixturePorts(options: FixturePortsOptions): DistributionPorts {
    const world = options.world ?? buildFixtureWorld(options.category);
    const byDomain = new Map(world.map(o => [o.domain, o]));

    const fetchPage = async (url: string): Promise<ReadablePage> => {
        const parsed = normalize(url);
        const org = parsed ? byDomain.get(parsed.domain) : undefined;
        const text = org && parsed ? org.pages[parsed.path] : undefined;
        if (!org || !parsed || text === undefined) {
            throw new Error(`fixture: no page at ${url}`);
        }
        return {
            url,
            finalUrl: url,
            status: 200,
            contentType: "text/plain",
            title: org.name,
            text,
            truncated: false,
            fetchedAt: new Date().toISOString(),
        };
    };

    const searchWeb = async (
        queries: Array<{ searchQuery: string }>
    ): Promise<RawSearchResult[]> => {
        const countries = new Set<string>();
        for (const q of queries)
            for (const m of q.searchQuery.matchAll(/country:([A-Za-z]{2})/g))
                countries.add(m[1]!.toUpperCase());
        const hits = world.filter(o => countries.size === 0 || countries.has(o.country));
        return hits.map(o => ({
            url: `https://${o.domain}/`,
            title: `${o.name} | ${o.kinds.join(", ")} in ${o.city}`,
            content: o.pages["/"]!.split("\n").slice(1, 3).join(" "),
            score: 1,
        }));
    };

    const tradeData = createStaticTradeDataProvider(
        world
            .filter(o => o.kinds.includes("importer"))
            .map(o => ({
                consignee: o.name,
                consigneeCountry: o.country,
                shipper: "Origin Exporter SA",
                shipperCountry: "CO",
                hsCode: "0901",
                description: `${options.category} shipment`,
                date: "2026-06-01",
                source: "fixture",
                sourceUrl: `https://${o.domain}/`,
            })),
        "fixture"
    );

    const compliance = createStaticComplianceProvider(
        Object.fromEntries(
            world
                .filter(o => o.flagged)
                .map(o => [
                    o.name,
                    [
                        {
                            entityId: `fixture-${o.slug}`,
                            matchedName: o.name,
                            score: 0.86,
                            topics: ["sanction"],
                            datasets: ["fixture_watchlist"],
                            url: `https://${o.domain}/`,
                        },
                    ],
                ])
        ),
        "fixture-screen"
    );

    return {
        model: createScriptedResearchModel(world),
        fetchPage,
        searchWeb,
        searchPlaces: null,
        tradeData,
        compliance,
        publishDossier: options.publishDossier ?? null,
        debitCredits: options.debitCredits ?? null,
        writeRationale: null,
        creditsPerCandidate: 0,
        plan: async input => ({
            plan: buildFixturePlan(input),
            modelId: FIXTURE_MODEL_ID,
            playbookHash: FIXTURE_PLAYBOOK_HASH,
        }),
    };
}

/** Territories the fixture world can serve, for programs that want a sensible default. */
export const FIXTURE_TERRITORIES: readonly Territory[] = [
    { country: "DE" },
    { country: "NL" },
    { country: "FR" },
];
