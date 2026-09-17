/**
 * Keyless ports: the whole pipeline with no API key and no model.
 *
 * Discovery reads OpenStreetMap (Overpass) and the Y Combinator directory,
 * both public and free; every candidate's own website is then read by the
 * page profiler, which records evidence and assembles the dossier the
 * research agent would. Persistence, exclusions, scoring, stages and
 * publishing are the real code, exactly as in live and fixture modes.
 *
 * What it cannot do without a model is written into every dossier's open
 * questions: brands carried, decision makers, and any reasoning beyond what
 * a page literally says.
 */
import type { AgentModelPort } from "@launchstack/llm";
import { fetchReadable } from "@launchstack/tools/web-research";

import type { DistributionPorts, PublishDossierInput } from "../run";
import { overpassAreas } from "./geo";
import { searchNominatim } from "./nominatim";
import { searchOverpass, KEYLESS_USER_AGENT, type OsmPlace } from "./osm";
import { buildKeylessPlan, KEYLESS_MODEL_ID, KEYLESS_PLAYBOOK_HASH, keywordsFor } from "./plan";
import { profileFromPages } from "./profile";
import { searchYc } from "./yc";

export interface KeylessPortsOptions {
    publishDossier?: ((input: PublishDossierInput) => Promise<{ documentId: number }>) | null;
    debitCredits?: DistributionPorts["debitCredits"];
    /** Injectable for tests and for the harness. Defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Places per territory from OpenStreetMap (default 40). */
    placesPerTerritory?: number;
    /** Directory hits per territory (default 20). */
    directoryPerTerritory?: number;
    /** Pages read per candidate (default 4). */
    pagesPerCandidate?: number;
}

const noModel: AgentModelPort = {
    respond: () =>
        Promise.reject(
            new Error("Keyless mode has no model; the page profiler replaces the agent.")
        ),
};

export function createKeylessPorts(options: KeylessPortsOptions = {}): DistributionPorts {
    const fetchImpl = options.fetchImpl ?? fetch;
    return {
        model: noModel,
        fetchPage: (url, signal) =>
            fetchReadable(url, {
                signal,
                timeoutMs: 10_000,
                fetchImpl,
                userAgent: KEYLESS_USER_AGENT,
            }),
        searchWeb: async queries => {
            const out = [];
            const seen = new Set<string>();
            for (const q of queries) {
                const country = /country:([A-Za-z]{2})/.exec(q.searchQuery)?.[1];
                if (!country) continue;
                const keywords = q.searchQuery
                    .replace(/country:[A-Za-z]{2}/g, "")
                    .split(/\s+/)
                    .filter(Boolean);
                const hits = await searchYc(
                    { country, keywords, limit: options.directoryPerTerritory ?? 20 },
                    { fetchImpl }
                );
                for (const hit of hits) {
                    if (seen.has(hit.url)) continue;
                    seen.add(hit.url);
                    out.push(hit);
                }
            }
            return out;
        },
        searchPlaces: async ({ query, categoryIds, territory }) => {
            const keywords = query.split(/\s+/).filter(Boolean);
            const limit = options.placesPerTerritory ?? 40;
            // Overpass finds organisations by what they are; Nominatim by what they
            // are called. Both are OpenStreetMap; the second is a lighter service
            // that still answers when the shared Overpass servers are overloaded.
            let places: OsmPlace[] = [];
            let overpassError: Error | null = null;
            try {
                places = await searchOverpass(
                    {
                        country: territory.country,
                        region: territory.region ?? null,
                        keywords,
                        selectors: categoryIds,
                        limit,
                    },
                    { fetchImpl }
                );
            } catch (error) {
                overpassError = error instanceof Error ? error : new Error(String(error));
            }
            if (places.length < limit) {
                try {
                    const named = await searchNominatim(
                        {
                            country: territory.country,
                            areas: overpassAreas(territory.country, territory.region ?? null),
                            keywords,
                            limit: limit - places.length,
                        },
                        { fetchImpl }
                    );
                    for (const p of named)
                        if (!places.some(x => x.website === p.website)) places.push(p);
                } catch (error) {
                    if (places.length === 0 && overpassError === null)
                        overpassError = error instanceof Error ? error : new Error(String(error));
                }
            }
            if (places.length === 0 && overpassError) throw overpassError;
            return places.map(p => ({
                fsqId: p.id,
                name: p.name,
                website: p.website ?? undefined,
                formattedAddress: p.address,
                location: { lat: p.lat, lng: p.lng },
                categories: p.categories.map(c => ({ id: c, name: c.split("=")[1] ?? c })),
            }));
        },
        tradeData: null,
        compliance: null,
        publishDossier: options.publishDossier ?? null,
        debitCredits: options.debitCredits ?? null,
        writeRationale: null,
        creditsPerCandidate: 0,
        plan: async input => ({
            plan: buildKeylessPlan(input),
            modelId: KEYLESS_MODEL_ID,
            playbookHash: KEYLESS_PLAYBOOK_HASH,
        }),
        profile: (ports, input) =>
            profileFromPages(ports, input, { maxPages: options.pagesPerCandidate ?? 4 }),
    };
}

export { keywordsFor };
