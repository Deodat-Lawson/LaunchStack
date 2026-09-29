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
import { nativeTermsFor, overpassAreas } from "./geo";
import { searchNominatim } from "./nominatim";
import {
    OVERPASS_MIRRORS,
    OVERPASS_URL,
    searchOverpass,
    rolesForOsmCategories,
    KEYLESS_USER_AGENT,
    type OsmPlace,
} from "./osm";
import { searchPhoton } from "./photon";
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
            const areas = overpassAreas(territory.country, territory.region ?? null);
            const places: OsmPlace[] = [];
            const errors: Error[] = [];
            const add = (batch: OsmPlace[]) => {
                for (const p of batch)
                    if (!places.some(x => x.website === p.website || x.id === p.id)) places.push(p);
            };
            // 1. Photon + OSM API: category search boxed to each city; fast and rarely overloaded.
            try {
                add(
                    await searchPhoton(
                        {
                            country: territory.country,
                            region: territory.region ?? null,
                            keywords,
                            selectors: categoryIds,
                            limit,
                        },
                        { fetchImpl }
                    )
                );
            } catch (error) {
                errors.push(error instanceof Error ? error : new Error(String(error)));
            }
            // 2. Overpass: the richest query, but the shared servers stall under load, so
            //    only the primary instance is tried once something was already found.
            if (places.length < limit) {
                try {
                    add(
                        await searchOverpass(
                            {
                                country: territory.country,
                                region: territory.region ?? null,
                                keywords,
                                selectors: categoryIds,
                                limit: limit - places.length,
                            },
                            {
                                fetchImpl,
                                urls: places.length > 0 ? [OVERPASS_URL] : OVERPASS_MIRRORS,
                            }
                        )
                    );
                } catch (error) {
                    errors.push(error instanceof Error ? error : new Error(String(error)));
                }
            }
            // 3. Nominatim by name, in the local languages ("koffiebranderij", "Bäckerei").
            if (places.length < limit) {
                const terms = [
                    ...new Set([...nativeTermsFor(keywords), ...keywords.slice(0, 1)]),
                ].slice(0, 4);
                try {
                    add(
                        await searchNominatim(
                            {
                                country: territory.country,
                                areas,
                                terms,
                                limit: limit - places.length,
                            },
                            { fetchImpl }
                        )
                    );
                } catch (error) {
                    errors.push(error instanceof Error ? error : new Error(String(error)));
                }
            }
            const firstError = errors[0];
            if (places.length === 0 && firstError) throw firstError;
            return places.map(p => ({
                fsqId: p.id,
                name: p.name,
                website: p.website ?? undefined,
                formattedAddress: p.address,
                location: { lat: p.lat, lng: p.lng },
                categories: p.categories.map(c => ({ id: c, name: c.split("=")[1] ?? c })),
                roles: rolesForOsmCategories(p.categories),
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
