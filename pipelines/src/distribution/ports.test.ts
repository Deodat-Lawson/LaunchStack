/**
 * Production wiring of the search ports. With an Exa key discovery reads the
 * company index and lookalikes can run; with only a Serper key both
 * discovery and the research agent use general web search (never the news
 * search that turned publishers into prospects), and lookalikes are skipped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.hoisted(() => ({
    provider: null as "exa" | "serper" | null,
    exa: false,
}));

vi.mock("@launchstack/llm", () => ({
    createLangchainAgentPort: () => ({ respond: vi.fn() }),
    modelContentToText: (content: unknown) => String(content),
    resolveChatModel: () => ({ chat: { invoke: vi.fn() }, prepareMessages: (m: unknown) => m }),
}));

vi.mock("@launchstack/tools/web-research", () => ({
    companySearchAvailable: () => search.exa,
    configuredWebSearchProvider: () => search.provider,
    searchWeb: vi.fn(),
    searchCompanies: vi.fn(),
    describeCompanies: vi.fn(),
    fetchReadable: vi.fn(),
    executeSearch: vi.fn(),
}));

import * as webResearch from "@launchstack/tools/web-research";

import { gather } from "./gather";
import { createDefaultPorts } from "./ports";
import type { PlannedSourceQuery } from "./types";

const searchWeb = vi.mocked(webResearch.searchWeb);
const searchCompanies = vi.mocked(webResearch.searchCompanies);
const executeSearch = vi.mocked(webResearch.executeSearch);

const query: PlannedSourceQuery = {
    kind: "web",
    territory: { country: "NL" },
    partnerKind: "distributor",
    query: "fulfilment warehouses Netherlands",
    label: "directory",
    rationale: "r",
};

beforeEach(() => {
    vi.clearAllMocks();
    searchWeb.mockImplementation(async q => ({
        provider: "serper",
        results: [
            {
                title: "Delta Logistics | Fulfilment",
                url: "https://delta.example/",
                snippet: `Fulfilment for ${q}`,
            },
        ],
    }));
    searchCompanies.mockResolvedValue([]);
});

describe("createDefaultPorts", () => {
    it("with an Exa key, searches the company index and keeps general search for the agent", async () => {
        search.exa = true;
        search.provider = "exa";
        const ports = createDefaultPorts();
        expect(ports.searchCompanies).toBeTypeOf("function");
        expect(ports.describeCompanies).toBeTypeOf("function");

        await ports.searchCompanies!("fulfilment warehouses", {
            country: "NL",
            excludeDomains: ["customer.example"],
        });
        expect(searchCompanies).toHaveBeenCalledWith("fulfilment warehouses", {
            maxResults: 10,
            country: "NL",
            excludeDomains: ["customer.example"],
            signal: undefined,
        });

        const results = await ports.searchWeb!([
            { searchQuery: "Delta Logistics contact", category: "dossier", rationale: "agent" },
        ]);
        expect(searchWeb).toHaveBeenCalledWith("Delta Logistics contact", { maxResults: 10 });
        expect(results.map(r => r.url)).toEqual(["https://delta.example/"]);
        expect(executeSearch).not.toHaveBeenCalled();
    });

    it("with only a Serper key, discovery uses general web search and lookalikes are skipped", async () => {
        search.exa = false;
        search.provider = "serper";
        const ports = createDefaultPorts();
        expect(ports.searchCompanies).toBeNull();
        expect(ports.describeCompanies).toBeNull();

        const result = await gather([query], {
            searchWeb: qs =>
                ports.searchWeb!(
                    qs.map(q => ({ searchQuery: q.query, category: q.label, rationale: "" }))
                ),
            searchCompanies: ports.searchCompanies,
            describeCompanies: ports.describeCompanies,
            lookalikes: { seeds: ["customer.example"], country: "NL", partnerKind: "distributor" },
            searchPlaces: null,
            tradeData: null,
            hsCodes: [],
        });
        expect(searchWeb).toHaveBeenCalledWith("fulfilment warehouses Netherlands", {
            maxResults: 10,
        });
        expect(executeSearch).not.toHaveBeenCalled();
        expect(result.mentions.map(m => [m.name, m.url])).toEqual([
            ["Delta Logistics", "https://delta.example/"],
        ]);
        expect(result.sources.find(s => s.source === "lookalike")).toMatchObject({
            status: "skipped",
            detail: "needs EXA_API_KEY",
        });
    });

    it("has no web search at all without a key", () => {
        search.exa = false;
        search.provider = null;
        const ports = createDefaultPorts();
        expect(ports.searchWeb).toBeNull();
        expect(ports.searchCompanies).toBeNull();
    });

    it("merges queries by URL, survives one failing, and fails only when all do", async () => {
        search.exa = false;
        search.provider = "serper";
        const ports = createDefaultPorts();
        searchWeb.mockImplementation(async q => {
            if (q === "broken") throw new Error("Serper search failed (HTTP 500)");
            return {
                provider: "serper",
                results: [{ title: "Delta", url: "https://delta.example/", snippet: "" }],
            };
        });
        const results = await ports.searchWeb!([
            { searchQuery: "one", category: "x", rationale: "" },
            { searchQuery: "two", category: "x", rationale: "" },
            { searchQuery: "broken", category: "x", rationale: "" },
        ]);
        expect(results).toHaveLength(1);
        await expect(
            ports.searchWeb!([{ searchQuery: "broken", category: "x", rationale: "" }])
        ).rejects.toThrow("HTTP 500");
    });
});
