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

import { moreOnNextRun } from "../gather";
import type { DistributionPorts, PublishDossierInput } from "../run";
import type { EmbedTexts, JudgeFit } from "../semantic";
import { rolesForOsmCategories, KEYLESS_USER_AGENT } from "./osm";
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
import { sharedHostThrottle, type HostThrottle } from "./throttle";

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
    const waiting = [
        report.waiting.overpass ? "Overpass to ask again" : "",
        report.pendingBoxes > 0 ? `${report.pendingBoxes} boxes to ask` : "",
        report.unread > 0 ? `${report.unread} places to read` : "",
    ].filter(Boolean);
    const state = report.complete
        ? `complete (${report.completedBy})`
        : waiting.length > 0
          ? `not complete: ${waiting.join(", ")} on the next run`
          : "not complete";
    const cutOff = report.boxesCutOff > 0 ? `; ${report.boxesCutOff} boxes too dense to split` : "";
    return `place pool ${where} ${selectorLabel(selectors)}: ${report.withWebsite} places with a website of ${report.known} known, ${state}${cutOff}; requests this run: overpass ${sent.overpass}, photon ${sent.photon}, osm api ${sent.osmApi}, nominatim ${sent.nominatim}`;
}

export function createKeylessPorts(options: KeylessPortsOptions = {}): DistributionPorts {
    const fetchImpl = options.fetchImpl ?? fetch;
    // Photon, the OSM API and Nominatim are asked one request at a time per
    // host, with a pause.
    const throttle = options.throttle ?? sharedHostThrottle;
    const placePools = options.placePools ?? processPlacePools;
    // The run's Photon cap, shared fairly by the place queries still to come.
    const photonCap = options.sweepRequestsPerRun ?? readSweepRequestsPerRun();
    let photonRequestsLeft = photonCap;
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

            const share = Math.ceil(photonRequestsLeft / Math.max(1, placeQueriesToCome));
            placeQueriesToCome = Math.max(0, placeQueriesToCome - 1);
            const { state, report } = await gatherPlacePool(
                { country: territory.country, region, keywords, selectors },
                {
                    store: placePools,
                    photonRequests: share,
                    fetchImpl,
                    throttle,
                    limits: options.placeLimits,
                    overpassUrls: options.overpassUrls,
                }
            );
            photonRequestsLeft = Math.max(0, photonRequestsLeft - report.requests.photon);
            console.info(`[distribution] ${describePool(where, selectors, report)}`);

            const places = poolPlaces(state, max);
            // Nothing found and something did not answer: the source failed.
            const problem = report.problems[0];
            if (places.length === 0 && problem) throw new Error(problem);
            const found = places.map(p => ({
                fsqId: p.id,
                name: p.name,
                website: p.website ?? undefined,
                formattedAddress: p.address,
                location: { lat: p.lat, lng: p.lng },
                categories: p.categories.map(c => ({ id: c, name: c.split("=")[1] ?? c })),
                roles: rolesForOsmCategories(p.categories),
            }));
            // Not everything in the territory is known yet, and a later run
            // has something left to ask (a sweep only when Photon may be
            // asked at all): say so, so the run can.
            const { waiting } = report;
            const more = waiting.overpass || waiting.tags || (waiting.boxes && photonCap > 0);
            return more && found.length > 0 ? moreOnNextRun(found) : found;
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
