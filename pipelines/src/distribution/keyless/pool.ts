/**
 * The place pool: every place of a segment's kinds in one territory, how the
 * keyless search fills it, and how it is kept between runs.
 *
 * 1. Overpass is asked first. One answered request per area returns every
 *    named place with the tags, website tags included.
 * 2. When Overpass does not answer, Photon is swept letter by letter (./sweep)
 *    for at most the run's request cap, and the tags of what was found are
 *    read from the OSM API.
 * 3. What was asked and what was found are stored. A later run starts from
 *    there: a complete pool costs no request at all, an unfinished sweep
 *    carries on with the boxes still waiting.
 *
 * The pool is public map data and holds nothing about who asked for it, so
 * the store is shared between workspaces: each tag and territory is swept
 * once, not once per workspace.
 */
import { createHash } from "node:crypto";

import { countryBox, overpassAreas, type Bbox } from "./geo";
import {
    fetchOverpassArea,
    nameRegexFor,
    type OsmPlace,
    type OverpassAttempt,
    type OverpassRequest,
} from "./osm";
import { BOX_LAT, BOX_LON, locateCity, photonTagsFor } from "./photon";
import {
    newSweep,
    readPlaceTags,
    runSweep,
    sweepPending,
    type SweepHit,
    type SweepRunResult,
    type SweepState,
} from "./sweep";
import { throttledFetch, type HostThrottle } from "./throttle";

export const PLACE_POOL_VERSION = 1;
/** Tags swept per pool: each one is a population of its own, 26 requests to start. */
const MAX_SWEEP_TAGS = 3;
/** Failed reads of a found place's tags, with the API otherwise answering, before it is given up. */
const MAX_TAG_READS = 2;

export interface PlacePoolRequest {
    country: string;
    region?: string | null;
    keywords: readonly string[];
    /** Overpass-style selectors chosen for the segment, best first. */
    selectors: readonly string[];
}

export interface PlacePoolState {
    version: number;
    country: string;
    region: string | null;
    selectors: string[];
    /** Places with a website, by OSM id ("osm:node/123"). */
    places: Record<string, OsmPlace>;
    /** Ids of places known to carry no website: counted, never read again. */
    without: string[];
    /** Found by the sweep; tags not read yet. */
    unread: SweepHit[];
    /** Overpass areas that answered ("NL", "DE/Berlin"). */
    overpassAreas: string[];
    sweep: SweepState | null;
    /** How the last sweep run ended; "failing" means Photon was not answering. */
    sweepStopped?: SweepRunResult["stopped"];
    /** True once every place in scope is known. */
    complete: boolean;
    completedBy: "overpass" | "sweep" | null;
    startedAt: string;
    updatedAt: string;
    /** Requests sent for this pool, over every run. */
    requests: { overpass: number; photon: number; osmApi: number };
}

/** Where pools are kept between runs. */
export interface PlacePoolStore {
    load(key: string): Promise<PlacePoolState | null>;
    save(key: string, state: PlacePoolState): Promise<void>;
}

/** A store that lasts as long as the process: the default, and what tests use. */
export function createMemoryPlacePoolStore(): PlacePoolStore {
    const pools = new Map<string, PlacePoolState>();
    return {
        load: key => Promise.resolve(structuredClone(pools.get(key) ?? null)),
        save: (key, state) => {
            pools.set(key, structuredClone(state));
            return Promise.resolve();
        },
    };
}

export interface PlacePoolLimits {
    /** All the time one area gets from Overpass, over every instance tried. */
    overpassBudgetMs: number;
    /** Give up on one Overpass instance after this long. */
    overpassTimeoutMs: number;
    /** The timeout Overpass is asked to apply to the query itself. */
    overpassServerTimeoutSeconds: number;
    /** A pool older than this is thrown away and filled again. */
    maxAgeMs: number;
    /** The same for a pool that holds no place: an empty answer is asked again sooner. */
    maxEmptyAgeMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_PLACE_POOL_LIMITS: PlacePoolLimits = {
    // Answered requests took 37 to 90 s on the public server when measured.
    overpassBudgetMs: 150_000,
    overpassTimeoutMs: 120_000,
    overpassServerTimeoutSeconds: 90,
    maxAgeMs: 30 * DAY_MS,
    maxEmptyAgeMs: DAY_MS,
};

export interface PlacePoolDeps {
    store: PlacePoolStore;
    /** Photon requests this call may send. */
    sweepRequests: number;
    fetchImpl?: typeof fetch;
    /**
     * Per-host pauses for Photon and the OSM API: one request at a time per
     * host. Overpass is not queued (see ./throttle). None when absent.
     */
    throttle?: HostThrottle;
    signal?: AbortSignal;
    now?: () => number;
    /** Overpass instances to try in order. */
    overpassUrls?: readonly string[];
    limits?: Partial<PlacePoolLimits>;
}

export interface PlacePoolReport {
    /** What this call did: nothing (the stored pool was enough), Overpass, the sweep, or both. */
    asked: Array<"overpass" | "sweep">;
    complete: boolean;
    completedBy: PlacePoolState["completedBy"];
    /** Places known, with or without a website. */
    known: number;
    withWebsite: number;
    /** Requests this call sent. */
    requests: { overpass: number; photon: number; osmApi: number };
    /** Boxes the sweep has still to ask. */
    pendingBoxes: number;
    overpassAttempts: OverpassAttempt[];
    sweepStopped: SweepRunResult["stopped"] | null;
}

/** The pool a request reads and fills: its territory, its tags, and the name words Overpass is given. */
export function placePoolKey(request: PlacePoolRequest): string {
    const selectors = [...request.selectors].sort();
    // Overpass matches names too inside a city, and when no tag was chosen.
    const names = request.region || selectors.length === 0 ? nameRegexFor(request.keywords) : null;
    return createHash("sha256")
        .update(
            JSON.stringify([
                request.country.toUpperCase(),
                (request.region ?? "").trim().toLowerCase(),
                selectors,
                names ?? "",
            ])
        )
        .digest("hex");
}

function emptyPool(request: PlacePoolRequest, now: number): PlacePoolState {
    const at = new Date(now).toISOString();
    return {
        version: PLACE_POOL_VERSION,
        country: request.country.toUpperCase(),
        region: request.region?.trim() ? request.region.trim() : null,
        selectors: [...request.selectors],
        places: {},
        without: [],
        unread: [],
        overpassAreas: [],
        sweep: null,
        complete: false,
        completedBy: null,
        startedAt: at,
        updatedAt: at,
        requests: { overpass: 0, photon: 0, osmApi: 0 },
    };
}

/** Places known so far, with or without a website. */
export function placesKnown(state: PlacePoolState): number {
    const ids = new Set<string>(state.without);
    for (const id of Object.keys(state.places)) ids.add(id);
    for (const hit of state.unread) ids.add(hit.id);
    return ids.size;
}

/** A stable pseudo-random number per id: an order that favours no letter, city or age. */
function spread(id: string): number {
    // FNV-1a over the id, then a finishing mix: ids differ only in their last
    // digits, and without the mix the order would follow them.
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    return hash >>> 0;
}

/**
 * The pool as a list for ranking: one place per website, at most `max`. A
 * pool larger than `max` is cut to an even spread, not to the first rows the
 * server happened to return.
 */
export function poolPlaces(state: PlacePoolState, max = Number.POSITIVE_INFINITY): OsmPlace[] {
    const ordered = Object.values(state.places).sort(
        (a, b) => spread(a.id) - spread(b.id) || a.id.localeCompare(b.id)
    );
    const seen = new Set<string>();
    const out: OsmPlace[] = [];
    for (const place of ordered) {
        if (out.length >= max) break;
        if (!place.website || seen.has(place.website)) continue;
        seen.add(place.website);
        out.push(place);
    }
    return out;
}

const areaKey = (area: { country: string; city: string | null }) =>
    area.city ? `${area.country}/${area.city}` : area.country;

/** Calls for the same pool in this process wait for each other instead of asking twice. */
const inFlight = new Map<string, Promise<unknown>>();

function oneAtATime<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = inFlight.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(
        () => undefined,
        () => undefined
    );
    inFlight.set(key, settled);
    void settled.then(() => {
        if (inFlight.get(key) === settled) inFlight.delete(key);
    });
    return next;
}

/**
 * The pool for a request: read from the store, filled as far as this call's
 * limits allow, stored again. It does not throw for an unanswered source;
 * the report says what happened.
 */
export function gatherPlacePool(
    request: PlacePoolRequest,
    deps: PlacePoolDeps
): Promise<{ state: PlacePoolState; report: PlacePoolReport }> {
    const key = placePoolKey(request);
    return oneAtATime(key, () => fillPool(key, request, deps));
}

async function fillPool(
    key: string,
    request: PlacePoolRequest,
    deps: PlacePoolDeps
): Promise<{ state: PlacePoolState; report: PlacePoolReport }> {
    const now = deps.now ?? Date.now;
    const limits = { ...DEFAULT_PLACE_POOL_LIMITS, ...deps.limits };
    const country = request.country.toUpperCase();

    let stored: PlacePoolState | null = null;
    try {
        stored = await deps.store.load(key);
    } catch (error) {
        console.warn("[distribution] place pool could not be read; starting it again:", error);
    }
    const usable = (pool: PlacePoolState): boolean => {
        if (pool.version !== PLACE_POOL_VERSION) return false;
        const age = now() - Date.parse(pool.startedAt);
        return age <= (placesKnown(pool) === 0 ? limits.maxEmptyAgeMs : limits.maxAgeMs);
    };
    const state: PlacePoolState = stored && usable(stored) ? stored : emptyPool(request, now());

    const report: PlacePoolReport = {
        asked: [],
        complete: state.complete,
        completedBy: state.completedBy,
        known: 0,
        withWebsite: 0,
        requests: { overpass: 0, photon: 0, osmApi: 0 },
        pendingBoxes: 0,
        overpassAttempts: [],
        sweepStopped: null,
    };
    const without = new Set(state.without);
    const save = async () => {
        state.without = [...without];
        state.updatedAt = new Date(now()).toISOString();
        try {
            await deps.store.save(key, state);
        } catch (error) {
            console.warn("[distribution] place pool could not be stored:", error);
        }
    };
    const finish = () => {
        state.without = [...without];
        report.complete = state.complete;
        report.completedBy = state.completedBy;
        report.known = placesKnown(state);
        report.withWebsite = Object.keys(state.places).length;
        report.pendingBoxes = state.sweep ? sweepPending(state.sweep) : 0;
        return { state, report };
    };
    if (state.complete) return finish();

    const tags = photonTagsFor(request.selectors).slice(0, MAX_SWEEP_TAGS);
    const areas = overpassAreas(country, request.region ?? null);
    const waiting = areas.filter(area => !state.overpassAreas.includes(areaKey(area)));
    // A sweep that can end within this call's cap is finished rather than
    // set aside for another wait on Overpass.
    const boxesWaiting = state.sweep ? sweepPending(state.sweep) : 0;
    const sweepNearlyDone =
        state.sweep !== null &&
        state.sweep.answered > 0 &&
        boxesWaiting > 0 &&
        boxesWaiting <= deps.sweepRequests &&
        // Photon was not answering last time: Overpass may be the way through.
        state.sweepStopped !== "failing";

    // 1. Overpass: everything in one answer per area.
    if (waiting.length > 0 && !sweepNearlyDone && !deps.signal?.aborted) {
        report.asked.push("overpass");
        const query: OverpassRequest = {
            country,
            region: request.region ?? null,
            keywords: request.keywords,
            selectors: request.selectors,
            timeoutSeconds: limits.overpassServerTimeoutSeconds,
        };
        for (const area of waiting) {
            const answer = await fetchOverpassArea(area, query, {
                fetchImpl: deps.fetchImpl,
                signal: deps.signal,
                urls: deps.overpassUrls,
                timeoutMs: limits.overpassTimeoutMs,
                deadline: now() + limits.overpassBudgetMs,
                now,
            });
            report.overpassAttempts.push(...answer.attempts);
            report.requests.overpass += answer.attempts.length;
            state.requests.overpass += answer.attempts.length;
            // An unanswered area means the servers are busy: the rest wait for the next run.
            if (!answer.answered) break;
            state.overpassAreas.push(areaKey(area));
            for (const place of answer.places) {
                if (place.website) {
                    state.places[place.id] = place;
                    without.delete(place.id);
                } else if (!state.places[place.id]) without.add(place.id);
            }
        }
        const everyAreaAnswered = areas.every(area => state.overpassAreas.includes(areaKey(area)));
        // An empty answer settles nothing (an unknown region name matches no
        // area); the sweep, which works on a map box, still gets its turn.
        if (everyAreaAnswered && Object.keys(state.places).length + without.size > 0) {
            state.complete = true;
            state.completedBy = "overpass";
            state.sweep = null;
            state.unread = [];
        }
        await save();
        if (state.complete) return finish();
    }

    // 2. The sweep: Photon, letter by letter, for what this call may send.
    if (tags.length > 0 && deps.sweepRequests > 0 && !deps.signal?.aborted) {
        if (!state.sweep) {
            const box = await sweepBox(country, request.region ?? null, deps);
            if (box) state.sweep = newSweep(box, tags);
        }
        if (state.sweep) {
            report.asked.push("sweep");
            const known = new Set<string>([...Object.keys(state.places), ...without]);
            for (const hit of state.unread) known.add(hit.id);
            const result = await runSweep(state.sweep, {
                country,
                maxRequests: deps.sweepRequests,
                fetchImpl: deps.fetchImpl,
                throttle: deps.throttle,
                signal: deps.signal,
                onHits: hits => {
                    for (const hit of hits) {
                        if (known.has(hit.id)) continue;
                        known.add(hit.id);
                        state.unread.push(hit);
                    }
                },
            });
            report.sweepStopped = result.stopped;
            state.sweepStopped = result.stopped;
            report.requests.photon += result.sent;
            state.requests.photon += result.sent;
            // Stored before the tags are read, so a crash there loses no sweep.
            await save();

            if (state.unread.length > 0) {
                const read = await readPlaceTags(state.unread, country, {
                    fetchImpl: deps.fetchImpl,
                    throttle: deps.throttle,
                    signal: deps.signal,
                });
                for (const place of read.places) state.places[place.id] = place;
                for (const id of read.without) without.add(id);
                // A place whose tags could not be read while the API answered
                // for others is tried on one more run, then counted as having
                // no website. When the API answered nothing, nothing is held
                // against it: the read waits, and Overpass can still complete
                // the pool on a later run.
                const struck = new Set(read.struck);
                state.unread = [];
                for (const hit of read.unread) {
                    const tries = (hit.tries ?? 0) + (struck.has(hit.id) ? 1 : 0);
                    if (tries >= MAX_TAG_READS) without.add(hit.id);
                    else state.unread.push(tries > 0 ? { ...hit, tries } : hit);
                }
                report.requests.osmApi += read.requests;
                state.requests.osmApi += read.requests;
            }
            if (result.stopped === "complete" && state.unread.length === 0) {
                state.complete = true;
                state.completedBy = "sweep";
            }
            await save();
        }
    }
    return finish();
}

/** The box the sweep covers: around the region's centre, or the whole country. */
async function sweepBox(
    country: string,
    region: string | null,
    deps: PlacePoolDeps
): Promise<Bbox | null> {
    if (!region) return countryBox(country);
    const fetchImpl = deps.fetchImpl ?? fetch;
    const centre = await locateCity(region, country, {
        fetchImpl: deps.throttle ? throttledFetch(fetchImpl, deps.throttle) : fetchImpl,
        signal: deps.signal,
    }).catch(() => null);
    if (!centre) return null;
    return [centre.lon - BOX_LON, centre.lat - BOX_LAT, centre.lon + BOX_LON, centre.lat + BOX_LAT];
}
