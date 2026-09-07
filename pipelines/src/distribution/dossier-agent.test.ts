import { describe, expect, it } from "vitest";
import { type z } from "zod";

import type { AgentModelPort, AgentModelResponse, AgentTranscriptItem } from "@launchstack/llm";
import { SUBMIT_TOOL_NAME } from "@launchstack/llm";
import type { ReadablePage } from "@launchstack/tools/web-research";

import {
    makeDossierTools,
    runDossierAgent,
    validateDossierGrounding,
    type DossierAgentInput,
    type DossierAgentPorts,
    type RecordedEvidence,
} from "./dossier-agent";
import type { Dossier, PartnerOrgRecord, ProgramRecord } from "./types";

const program = {
    id: "p1",
    companyId: 1n,
    createdByUserId: "u",
    name: "EU coffee",
    offering: "Roasted specialty coffee",
    categories: ["coffee"],
    hsCodes: ["0901"],
    targetTerritories: [{ country: "DE" }],
    partnerKinds: ["importer"],
    constraints: null,
    knownPartnerDomains: [],
    status: "active",
    createdAt: new Date(),
    updatedAt: null,
} as ProgramRecord;
const org = {
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
    categories: [],
    sizeBand: null,
    description: null,
    kgEntityId: null,
    firstSeenRunId: null,
    lastEnrichedAt: null,
    createdAt: new Date(),
    updatedAt: null,
} as PartnerOrgRecord;

const PAGE_TEXT =
    "Acme Import GmbH\nOur brands: Beta Roasters, Gamma Coffee.\nWe supply independent cafés across Germany.\nContact: import@acme-import.de";

function page(url: string): ReadablePage {
    return {
        url,
        finalUrl: url,
        status: 200,
        contentType: "text/html",
        title: "Acme",
        text: PAGE_TEXT,
        truncated: false,
        fetchedAt: new Date().toISOString(),
    };
}

function scriptedPort(
    steps: Array<(transcript: readonly AgentTranscriptItem[]) => AgentModelResponse>
): AgentModelPort & { calls: number } {
    let i = 0;
    const port = {
        calls: 0,
        async respond({
            transcript,
        }: {
            transcript: readonly AgentTranscriptItem[];
        }): Promise<AgentModelResponse> {
            port.calls += 1;
            const step = steps[Math.min(i, steps.length - 1)]!;
            i += 1;
            return step(transcript);
        },
    };
    return port;
}

function lastToolContent(transcript: readonly AgentTranscriptItem[]): string {
    for (let i = transcript.length - 1; i >= 0; i--) {
        const item = transcript[i]!;
        if (item.role === "tool") return item.content;
    }
    return "";
}

function evidenceIdFrom(content: string): number {
    const match = /Recorded evidence (\d+)/.exec(content);
    if (!match) throw new Error(`no evidence id in: ${content}`);
    return Number(match[1]);
}

function makePorts(model: AgentModelPort, store: RecordedEvidence[] = []): DossierAgentPorts {
    let nextId = 1;
    return {
        model,
        fetchPage: async url => page(url),
        searchWeb: async () => [
            {
                url: "https://acme-import.de/brands",
                title: "Brands",
                content: "Beta Roasters",
                score: 1,
            },
        ],
        searchPlaces: null,
        tradeData: null,
        recordEvidence: async e => {
            const id = nextId++;
            store.push({ id, ...e });
            return id;
        },
    };
}

const input: DossierAgentInput = {
    program,
    sellerSummary: "Kohi Roasters",
    org,
    kind: "importer",
    territory: { country: "DE" },
    seedUrls: ["https://acme-import.de/"],
    hsCodes: ["0901"],
    limits: { maxTurns: 6 },
};

function dossierCiting(ids: number[]): Dossier {
    return {
        summary:
            "Acme Import imports and distributes specialty coffee to independent cafés across Germany and already carries two adjacent roasters.",
        roles: ["importer", "distributor"],
        brandsCarried: [{ brand: "Beta Roasters", evidenceIds: ids }],
        territories: [],
        retailCoverage: [],
        certifications: [],
        decisionMakers: [],
        contactChannels: [],
        risks: [],
        sizeBand: "unknown",
        openQuestions: [],
    };
}

describe("dossier tools", () => {
    it("expose no tenant fields in any tool schema (tenancy gate)", () => {
        const { tools } = makeDossierTools(makePorts(scriptedPort([])), input);
        const forbidden = new Set([
            "companyId",
            "company_id",
            "programId",
            "program_id",
            "runId",
            "run_id",
            "orgId",
            "org_id",
            "relationshipId",
        ]);
        for (const tool of tools) {
            const shape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
            for (const key of Object.keys(shape))
                expect(forbidden.has(key), `${tool.name}.${key}`).toBe(false);
        }
        expect(tools.map(t => t.name)).toEqual(["fetch_page", "search_web", "record_evidence"]);
    });

    it("refuses evidence from a page that was not fetched and quotes that are not on the page", async () => {
        const toolset = makeDossierTools(makePorts(scriptedPort([])), input);
        const record = toolset.tools.find(t => t.name === "record_evidence")!;
        const fetch = toolset.tools.find(t => t.name === "fetch_page")!;
        const refused = await record.run(
            {
                kind: "brands_carried",
                claim: "Carries Beta Roasters",
                sourceUrl: "https://acme-import.de/brands",
                quote: "Our brands: Beta Roasters",
            },
            {}
        );
        expect(refused.isError).toBe(true);
        expect(refused.content).toMatch(/not fetched/);
        await fetch.run({ url: "https://acme-import.de/brands" }, {});
        const wrongQuote = await record.run(
            {
                kind: "brands_carried",
                claim: "Carries Delta",
                sourceUrl: "https://acme-import.de/brands",
                quote: "Our brands: Delta Coffee Roasters Inc",
            },
            {}
        );
        expect(wrongQuote.isError).toBe(true);
        const ok = await record.run(
            {
                kind: "brands_carried",
                claim: "Carries Beta Roasters",
                sourceUrl: "https://acme-import.de/brands",
                quote: "Our brands: Beta Roasters",
            },
            {}
        );
        expect(ok.isError).toBeUndefined();
        expect(toolset.getEvidence().size).toBe(1);
    });

    it("enforces the page budget", async () => {
        const toolset = makeDossierTools(makePorts(scriptedPort([])), {
            ...input,
            limits: { maxPagesPerCandidate: 1 },
        });
        const fetch = toolset.tools.find(t => t.name === "fetch_page")!;
        await fetch.run({ url: "https://acme-import.de/a" }, {});
        const second = await fetch.run({ url: "https://acme-import.de/b" }, {});
        expect(second.isError).toBe(true);
        expect(second.content).toMatch(/budget/);
    });
});

describe("validateDossierGrounding", () => {
    it("rejects unknown ids and unfetched sources, accepts grounded dossiers", () => {
        const evidence = new Map<number, RecordedEvidence>([
            [
                1,
                {
                    id: 1,
                    kind: "brands_carried",
                    claim: "c",
                    sourceUrl: "https://acme-import.de/brands",
                    quote: "q",
                    confidence: 0.8,
                },
            ],
        ]);
        const fetched = new Set(["https://acme-import.de/brands"]);
        expect(validateDossierGrounding(dossierCiting([1]), evidence, fetched)).toEqual([]);
        expect(validateDossierGrounding(dossierCiting([2]), evidence, fetched)[0]!.code).toBe(
            "unknown_evidence_id"
        );
        expect(validateDossierGrounding(dossierCiting([1]), evidence, new Set())[0]!.code).toBe(
            "unfetched_source"
        );
        expect(
            validateDossierGrounding(
                { ...dossierCiting([]), brandsCarried: [], roles: [] },
                evidence,
                fetched
            )[0]!.code
        ).toBe("empty_dossier");
    });
});

describe("runDossierAgent", () => {
    it("fetch → record → submit produces a grounded dossier", async () => {
        const port = scriptedPort([
            () => ({
                text: "",
                toolCalls: [
                    { id: "c1", name: "fetch_page", arguments: { url: "https://acme-import.de/" } },
                ],
            }),
            () => ({
                text: "",
                toolCalls: [
                    {
                        id: "c2",
                        name: "record_evidence",
                        arguments: {
                            kind: "brands_carried",
                            claim: "Acme carries Beta Roasters",
                            sourceUrl: "https://acme-import.de/",
                            quote: "Our brands: Beta Roasters",
                        },
                    },
                ],
            }),
            transcript => ({
                text: "",
                toolCalls: [
                    {
                        id: "c3",
                        name: SUBMIT_TOOL_NAME,
                        arguments: dossierCiting([evidenceIdFrom(lastToolContent(transcript))]),
                    },
                ],
            }),
        ]);
        const store: RecordedEvidence[] = [];
        const result = await runDossierAgent(makePorts(port, store), input);
        expect(result.outcome.status).toBe("ok");
        expect(result.evidence).toHaveLength(1);
        expect(result.fetchedUrls).toContain("https://acme-import.de");
        expect(store).toHaveLength(1);
        expect(result.playbookHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("fails the grounding gate once, repairs, then passes", async () => {
        const port = scriptedPort([
            () => ({
                text: "",
                toolCalls: [
                    { id: "c1", name: "fetch_page", arguments: { url: "https://acme-import.de/" } },
                ],
            }),
            () => ({
                text: "",
                toolCalls: [
                    {
                        id: "c2",
                        name: "record_evidence",
                        arguments: {
                            kind: "brands_carried",
                            claim: "Acme carries Beta Roasters",
                            sourceUrl: "https://acme-import.de/",
                            quote: "Our brands: Beta Roasters",
                        },
                    },
                ],
            }),
            // Cites an id that was never recorded → gate error → repair turn.
            () => ({
                text: "",
                toolCalls: [{ id: "c3", name: SUBMIT_TOOL_NAME, arguments: dossierCiting([999]) }],
            }),
            () => ({
                text: "",
                toolCalls: [{ id: "c4", name: SUBMIT_TOOL_NAME, arguments: dossierCiting([1]) }],
            }),
        ]);
        const result = await runDossierAgent(makePorts(port), input);
        expect(result.outcome.status).toBe("ok");
        expect(result.outcome.status === "ok" && result.outcome.repaired).toBe(true);
    });

    it("fails visibly when the repair still cites fabricated evidence", async () => {
        const port = scriptedPort([
            () => ({
                text: "",
                toolCalls: [{ id: "c3", name: SUBMIT_TOOL_NAME, arguments: dossierCiting([999]) }],
            }),
            () => ({
                text: "",
                toolCalls: [{ id: "c4", name: SUBMIT_TOOL_NAME, arguments: dossierCiting([998]) }],
            }),
        ]);
        const result = await runDossierAgent(makePorts(port), input);
        expect(result.outcome.status).toBe("gate_failed");
        expect(result.outcome.status === "gate_failed" && result.outcome.errors[0]!.code).toBe(
            "unknown_evidence_id"
        );
    });

    it("reports budget exhaustion instead of throwing when the model never submits", async () => {
        const port = scriptedPort([
            () => ({
                text: "",
                toolCalls: [
                    { id: "x", name: "fetch_page", arguments: { url: "https://acme-import.de/" } },
                ],
            }),
        ]);
        const result = await runDossierAgent(makePorts(port), {
            ...input,
            limits: { maxTurns: 3 },
        });
        expect(result.outcome.status).toBe("budget_exhausted");
        expect(result.outcome.status === "budget_exhausted" && result.outcome.reason).toBe("turns");
    });
});
