/**
 * Production wiring of the pipeline's ports from the tools layer. Anything
 * that needs apps/web (publishing to Sources, metering) stays a host concern
 * and is passed in by the Inngest function.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
    createLangchainAgentPort,
    normalizeModelContent,
    resolveChatModel,
} from "@launchstack/llm";
import { resolveComplianceProvider } from "@launchstack/tools/compliance-screen";
import {
    geocodeLocation,
    isPlaceSearchConfigured,
    searchPlaces,
} from "@launchstack/tools/place-search";
import { resolveTradeDataProvider } from "@launchstack/tools/trade-data";
import { executeSearch, fetchReadable } from "@launchstack/tools/web-research";

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

function hasWebSearch(): boolean {
    return Boolean(process.env.EXA_API_KEY) || Boolean(process.env.SERPER_API_KEY);
}

export function createDefaultPorts(options: CreateDefaultPortsOptions = {}): DistributionPorts {
    const chat = resolveChatModel();
    const fast = resolveChatModel({ route: "fast", temperature: 0.3 });
    const scorePlaybook = loadPlaybook("score");
    return {
        model: createLangchainAgentPort(chat),
        fetchPage: (url, signal) => fetchReadable(url, { signal }),
        searchWeb:
            options.enableWeb === false || !hasWebSearch()
                ? null
                : async queries => (await executeSearch(queries)).results,
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
            return normalizeModelContent(response.content);
        },
        creditsPerCandidate: options.creditsPerCandidate ?? DEFAULT_CREDITS_PER_CANDIDATE,
    };
}
