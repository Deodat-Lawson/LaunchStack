/**
 * Keyless ports: the whole pipeline with no API key and no model.
 *
 * Discovery reads OpenStreetMap: real places — shops, cafés, workshops,
 * offices — in the segment's area, with their own addresses and websites.
 * Which kinds of place a segment wants is chosen by meaning from
 * OpenStreetMap's own categories when an embedder is given. The place search
 * returns the whole pool of those places (./pool): Overpass first, since one
 * answered request holds every tagged place; a letter-by-letter Photon sweep
 * when Overpass does not answer; and what was asked is kept, so a second run
 * carries on where the first stopped. The run then ranks the pool and takes
 * its shortlist from all of it.
 * Every candidate's own website is then read by the page profiler (its
 * homepage and the pages its own links name as contact, about, team or
 * imprint, four requests a site), which records evidence and assembles the
 * dossier the research agent would.
 * Persistence, exclusions, scoring, stages and publishing are the real code,
 * exactly as in live and fixture modes.
 *
 * There is no startup directory: a directory of venture-backed startups
 * answered every segment with software companies, whatever it sold.
 *
 * What it cannot do without a model is written into every dossier's open
 * questions: brands carried, decision makers, and any reasoning beyond what
 * a page literally says.
 */
import type { AgentModelPort } from "@launchstack/llm";
import { fetchReadable } from "@launchstack/tools/web-research";

import type { DistributionPorts, PublishDossierInput } from "../run";
import type { EmbedTexts, JudgeFit } from "../semantic";
import { nativeTermsFor, overpassAreas } from "./geo";
import { searchNominatim } from "./nominatim";
import { rolesForOsmCategories, KEYLESS_USER_AGENT, type OsmPlace } from "./osm";
import { PHOTON_URL, searchPhoton } from "./photon";
import { buildKeylessPlan, KEYLESS_MODEL_ID, KEYLESS_PLAYBOOK_HASH, keywordsFor } from "./plan";
import {
    createMemoryPlacePoolStore,
    gatherPlacePool,
    poolPlaces,
    type PlacePoolLimits,
    type PlacePoolReport,
    type PlacePoolStore,
} from "./pool";
import { profileFromPages } from "./profile";
import { osmVocabulary } from "./taginfo";
import { requestHost, sharedHostThrottle, throttledFetch, type HostThrottle } from "./throttle";

/** Places handed to ranking per territory unless told otherwise. */
export const DEFAULT_PLACES_PER_TERRITORY = 2_000;
/**
 * Photon requests one run may send, over all its territories: the sweep, the
 * lookup that places a region on the map, and the name search for a
 * territory where nothing carries the tags. In the benchmark a letter sweep
 * knew about 90% of a country's places of one kind after 64.
 */
export const DEFAULT_SWEEP_REQUESTS_PER_RUN = 64;
const MAX_SWEEP_REQUESTS_PER_RUN = 500;
const PHOTON_HOST = new URL(PHOTON_URL).hostname;

/**
 * The run's Photon request cap from the environment:
 * PROSPECTS_PLACE_SWEEP_REQUESTS, a whole number from 0 (Photon is asked
 * nothing; Overpass only) to 500. Anything else means the default.
 */
export function readSweepRequestsPerRun(
    env: Record<string, string | undefined> = process.env
): number {
    const raw = env.PROSPECTS_PLACE_SWEEP_REQUESTS?.trim();
    if (!raw || !/^\d+$/.test(raw)) return DEFAULT_SWEEP_REQUESTS_PER_RUN;
    return Math.min(MAX_SWEEP_REQUESTS_PER_RUN, Number(raw));
}

/** Pools for hosts that pass no store: kept for as long as the process runs. */
const processPlacePools = createMemoryPlacePoolStore();

export interface KeylessPortsOptions {
    publishDossier?: ((input: PublishDossierInput) => Promise<{ documentId: number }>) | null;
    debitCredits?: DistributionPorts["debitCredits"];
    /** Injectable for tests and for the harness. Defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /**
     * Most places handed to ranking per territory (default 2,000). A pool
     * larger than this is cut to an even spread over the territory.
     */
    placesPerTerritory?: number;
    /** Where place pools are kept between runs; this process's memory when absent. */
    placePools?: PlacePoolStore;
    /**
     * Photon requests one run may send over all its territories (default:
     * PROSPECTS_PLACE_SWEEP_REQUESTS, else 64).
     */
    sweepRequestsPerRun?: number;
    /** Per-host pauses for the map servers; the process-wide throttle when absent. */
    throttle?: HostThrottle;
    /** Overrides for the pool's time limits (tests, the benchmark). */
    placeLimits?: Partial<PlacePoolLimits>;
    /** Overpass instances to try in order. */
    overpassUrls?: readonly string[];
    /** Embedder for choosing place categories and matching companies by meaning. */
    embed?: EmbedTexts | null;
    /** Chat-model check of the shortlist (a workspace with a model and no search keys). */
    judgeFit?: JudgeFit | null;
    /** Requests per candidate site, the homepage included (default 4). */
    requestsPerCandidate?: number;
}

const noModel: AgentModelPort = {
    respond: () =>
        Promise.reject(
            new Error("Keyless mode has no model; the page profiler replaces the agent.")
        ),
};

const selectorLabel = (selectors: readonly string[]) =>
    selectors.length > 0 ? selectors.join(" ").replace(/["[\]]/g, "") : "by name";

function describePool(where: string, selectors: readonly string[], report: PlacePoolReport) {
    const sent = report.requests;
    const state = report.complete
        ? `complete (${report.completedBy})`
        : report.pendingBoxes > 0
          ? `${report.pendingBoxes} boxes left for the next run`
          : "not complete";
    return `place pool ${where} ${selectorLabel(selectors)}: ${report.withWebsite} places with a website of ${report.known} known, ${state}; requests this run: overpass ${sent.overpass}, photon ${sent.photon}, osm api ${sent.osmApi}`;
}

export function createKeylessPorts(options: KeylessPortsOptions = {}): DistributionPorts {
    const fetchImpl = options.fetchImpl ?? fetch;
    // Photon, the OSM API and Nominatim are asked one request at a time per
    // host, with a pause.
    const throttle = options.throttle ?? sharedHostThrottle;
    const politeFetch = throttledFetch(fetchImpl, throttle);
    const placePools = options.placePools ?? processPlacePools;
    // The run's sweep cap, shared fairly by the place queries still to come.
    let sweepRequestsLeft = options.sweepRequestsPerRun ?? readSweepRequestsPerRun();
    let placeQueriesToCome = 0;
    return {
        model: noModel,
        fetchPage: (url, signal) =>
            fetchReadable(url, {
                signal,
                timeoutMs: 10_000,
                fetchImpl,
                userAgent: KEYLESS_USER_AGENT,
            }),
        // Web search needs a key; the startup directory that stood in for it
        // returned software companies for every segment.
        searchWeb: null,
        searchPlaces: async ({ query, categoryIds, territory }) => {
            const keywords = query.split(/\s+/).filter(Boolean);
            const max = options.placesPerTerritory ?? DEFAULT_PLACES_PER_TERRITORY;
            const selectors = categoryIds ?? [];
            const region = territory.region ?? null;
            const where = region ? `${region}, ${territory.country}` : territory.country;
            const errors: Error[] = [];

            const share = Math.ceil(sweepRequestsLeft / Math.max(1, placeQueriesToCome));
            placeQueriesToCome = Math.max(0, placeQueriesToCome - 1);
            const { state, report } = await gatherPlacePool(
                { country: territory.country, region, keywords, selectors },
                {
                    store: placePools,
                    sweepRequests: share,
                    fetchImpl,
                    throttle,
                    limits: options.placeLimits,
                    overpassUrls: options.overpassUrls,
                }
            );
            sweepRequestsLeft = Math.max(0, sweepRequestsLeft - report.requests.photon);
            console.info(`[distribution] ${describePool(where, selectors, report)}`);
            const unanswered = report.overpassAttempts.filter(a => !a.ok);
            if (report.asked.includes("overpass") && unanswered.length > 0 && !report.complete)
                errors.push(
                    new Error(
                        `Overpass did not answer (${unanswered.map(a => `${a.host}: ${a.detail}`).join("; ")})`
                    )
                );
            if (report.sweepStopped === "failing")
                errors.push(new Error("Photon stopped answering during the place sweep"));

            const places: OsmPlace[] = poolPlaces(state, max);
            // Nothing carries the segment's tags here (or none was chosen and
            // Overpass was silent): look for its words in place names instead.
            if (places.length === 0) {
                const add = (batch: OsmPlace[]) => {
                    for (const p of batch) {
                        if (places.length >= max) break;
                        if (!places.some(x => x.website === p.website || x.id === p.id))
                            places.push(p);
                    }
                };
                // The name search asks Photon as well (a lookup and two searches
                // per city): those requests come out of the run's same cap.
                let nameRequests = 0;
                const withinCap: typeof fetch = (input, init) => {
                    if (requestHost(input) === PHOTON_HOST) {
                        if (nameRequests >= sweepRequestsLeft)
                            return Promise.reject(
                                new Error("The run's Photon request cap is reached")
                            );
                        nameRequests += 1;
                    }
                    return politeFetch(input, init);
                };
                if (sweepRequestsLeft > 0) {
                    try {
                        add(
                            await searchPhoton(
                                {
                                    country: territory.country,
                                    region,
                                    keywords,
                                    selectors: [],
                                    limit: Math.min(max, 40),
                                },
                                { fetchImpl: withinCap }
                            )
                        );
                    } catch (error) {
                        errors.push(error instanceof Error ? error : new Error(String(error)));
                    }
                    sweepRequestsLeft = Math.max(0, sweepRequestsLeft - nameRequests);
                }
                // Nominatim by name, in the local languages ("koffiebranderij", "Bäckerei").
                const terms = [
                    ...new Set([...nativeTermsFor(keywords), ...keywords.slice(0, 1)]),
                ].slice(0, 4);
                try {
                    add(
                        await searchNominatim(
                            {
                                country: territory.country,
                                areas: overpassAreas(territory.country, region),
                                terms,
                                limit: Math.min(max, 40),
                            },
                            // The throttle already spaces requests to Nominatim.
                            { fetchImpl: politeFetch, pauseMs: 0 }
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
        embed: options.embed ?? null,
        judgeFit: options.judgeFit ?? null,
        plan: async input => {
            const plan = await buildKeylessPlan(input, {
                embed: options.embed ?? null,
                vocabulary: () => osmVocabulary({ fetchImpl }),
            });
            placeQueriesToCome = plan.queries.filter(q => q.kind === "place").length;
            return { plan, modelId: KEYLESS_MODEL_ID, playbookHash: KEYLESS_PLAYBOOK_HASH };
        },
        profile: (ports, input) =>
            profileFromPages(
                ports,
                input,
                options.requestsPerCandidate === undefined
                    ? {}
                    : { maxRequests: options.requestsPerCandidate }
            ),
    };
}

export { keywordsFor };
