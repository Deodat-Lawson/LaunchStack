/**
 * Production wiring of the pipeline's ports from the tools layer. Anything
 * that needs apps/web (publishing to Sources, metering) stays a host concern
 * and is passed in by the Inngest function.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLangchainAgentPort, modelContentToText, resolveChatModel } from "@launchstack/llm";
import { resolveComplianceProvider } from "@launchstack/tools/compliance-screen";
import {
    geocodeLocation,
    isPlaceSearchConfigured,
    searchPlaces,
} from "@launchstack/tools/place-search";
import { resolveTradeDataProvider } from "@launchstack/tools/trade-data";
import {
    companySearchAvailable,
    configuredWebSearchProvider,
    describeCompanies,
    fetchReadable,
    searchCompanies,
    searchWeb,
    type RawSearchResult,
} from "@launchstack/tools/web-research";

import { loadPlaybook } from "./skills";
import type { DistributionPorts, PublishDossierInput } from "./run";

export const DEFAULT_CREDITS_PER_CANDIDATE = 2_000;

export interface CreateDefaultPortsOptions {
    publishDossier?: ((input: PublishDossierInput) => Promise<{ documentId: number }>) | null;
    debitCredits?: DistributionPorts["debitCredits"];
    creditsPerCandidate?: number;
    /** Set false to disable a source regardless of configuration. */
    enableWeb?: boolean;
    enablePlaces?: boolean;
}

/** Companies asked for per company search (Exa bills each one past ten). */
const COMPANIES_PER_QUERY = 10;

/**
 * Each query through general web search (Exa first, Serper when it is the
 * only key), results merged by URL. A query that fails contributes nothing;
 * every query failing is the source failing.
 */
async function searchWebAll(queries: Array<{ searchQuery: string }>): Promise<RawSearchResult[]> {
    const settled = await Promise.allSettled(
        queries.map(q => searchWeb(q.searchQuery, { maxResults: 10 }))
    );
    const failed = settled.filter(o => o.status === "rejected");
    if (failed.length > 0 && failed.length === settled.length) {
        const reason: unknown = failed[0]!.reason;
        throw reason instanceof Error ? reason : new Error("Web search failed");
    }
    const seen = new Set<string>();
    const results: RawSearchResult[] = [];
    for (const outcome of settled) {
        if (outcome.status === "rejected") continue;
        for (const hit of outcome.value.results) {
            if (seen.has(hit.url)) continue;
            seen.add(hit.url);
            results.push({
                url: hit.url,
                title: hit.title,
                content: hit.snippet,
                score: 1,
                ...(hit.publishedDate ? { publishedDate: hit.publishedDate } : {}),
            });
        }
    }
    return results;
}

export function createDefaultPorts(options: CreateDefaultPortsOptions = {}): DistributionPorts {
    const webEnabled = options.enableWeb !== false;
    // Exa's company index finds companies themselves; general search is the
    // fallback for discovery (Serper only) and the research agent's search.
    const companies = webEnabled && companySearchAvailable();
    const chat = resolveChatModel();
    const fast = resolveChatModel({ route: "fast", temperature: 0.3 });
    const scorePlaybook = loadPlaybook("score");
    return {
        model: createLangchainAgentPort(chat),
        fetchPage: (url, signal) => fetchReadable(url, { signal }),
        searchWeb: !webEnabled || configuredWebSearchProvider() === null ? null : searchWebAll,
        searchCompanies: companies
            ? (query, { country, excludeDomains, signal }) =>
                  searchCompanies(query, {
                      maxResults: COMPANIES_PER_QUERY,
                      country,
                      excludeDomains,
                      signal,
                  })
            : null,
        describeCompanies: companies ? (urls, signal) => describeCompanies(urls, { signal }) : null,
        searchPlaces:
            options.enablePlaces === false || !isPlaceSearchConfigured()
                ? null
                : async ({ query, categoryIds, territory }) => {
                      const location = await geocodeLocation(
                          `${territory.region ?? ""}, ${territory.country}`.replace(/^,\s*/, "")
                      );
                      return searchPlaces(
                          [
                              {
                                  searchQuery: query,
                                  categoryIds: categoryIds ?? [],
                                  rationale: "planned",
                              },
                          ],
                          location,
                          territory.radiusMeters ?? 15_000,
                          {
                              excludeChains: false,
                          }
                      );
                  },
        tradeData: resolveTradeDataProvider(),
        compliance: resolveComplianceProvider(),
        publishDossier: options.publishDossier ?? null,
        debitCredits: options.debitCredits ?? null,
        writeRationale: async input => {
            const response = await fast.chat.invoke(
                fast.prepareMessages([
                    new SystemMessage(scorePlaybook.content),
                    new HumanMessage(input),
                ])
            );
            return modelContentToText(response.content);
        },
        creditsPerCandidate: options.creditsPerCandidate ?? DEFAULT_CREDITS_PER_CANDIDATE,
    };
}
