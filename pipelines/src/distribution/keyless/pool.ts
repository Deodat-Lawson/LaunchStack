/**
 * The place pool: every place of a segment's kinds in one territory, how the
 * keyless search fills it, and how it is kept between runs.
 *
 * 1. Overpass is asked first, when one request can cover the territory (a
 *    named region, or a country small enough to ask as one). Its answer holds
 *    every named place with the tags, website tags included.
 * 2. When Overpass does not answer, or the country is too large to ask as
 *    one, Photon is swept letter by letter (./sweep) for at most the run's
 *    request cap, and the tags of what was found are read from the OSM API.
 * 3. What was asked and what was found are stored. A later run starts from
 *    there: a complete pool costs no request at all, an unfinished one
 *    carries on with what is still waiting.
 *
 * "Complete" is only said of a pool that has been told everything: an
 * Overpass answer for the whole territory, or a sweep with every box
 * answered, none of them too dense to split, and every found place's tags
 * read. A failed request settles
 * nothing; it waits for a later run. A complete pool that has grown old is
 * filled again, and keeps what it knew until the new filling is complete.
 * An unfinished one never starts over: it carries on, however long ago it
 * stopped, so no answered request is asked twice.
 *
 * The pool is public map data and holds nothing about who asked for it, so
 * the store is shared between workspaces: each tag and territory is swept
 * once, not once per workspace.
 */
import { createHash } from "node:crypto";

import {
    countryBox,
    nativeTermsFor,
    oneAreaCoversTerritory,
    overpassAreas,
    type Bbox,
} from "./geo";
import { NOMINATIM_URL, searchNominatim } from "./nominatim";
import {
    MAX_SELECTORS,
    fetchOverpassArea,
    nameRegexFor,
    searchOverpass,
    type OsmPlace,
    type OverpassAttempt,
} from "./osm";
import {
    BOX_LAT,
    BOX_LON,
    OSM_API_URL,
    PHOTON_URL,
    locateCity,
    photonTagsFor,
    searchPhoton,
} from "./photon";
import {
    newSweep,
    readPlaceTags,
    runSweep,
    sweepPending,
    type SweepHit,
    type SweepRunResult,
    type SweepState,
} from "./sweep";
import { requestHost, throttledFetch, type HostThrottle } from "./throttle";

export const PLACE_POOL_VERSION = 1;
/** The pool is stored again after this many answered sweep requests, so a run cut short loses little. */
const SAVE_EVERY_ANSWERS = 8;
/** Places a name search may add: it is a stand-in for an empty pool, not a pool. */
const NAME_SEARCH_LIMIT = 40;

const PHOTON_HOST = new URL(PHOTON_URL).hostname;
const OSM_API_HOST = new URL(OSM_API_URL).hostname;
const NOMINATIM_HOST = new URL(NOMINATIM_URL).hostname;

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
    /** Ids of places read and found to carry no website: counted, never read again. */
    without: string[];
    /** Found by the sweep; tags not read yet. */
    unread: SweepHit[];
    /** True once Overpass has answered for the whole territory, even with nothing. */
    overpassAnswered: boolean;
    sweep: SweepState | null;
    /** How the last sweep run ended, and how many of its requests were answered. */
    lastSweep: { stopped: SweepRunResult["stopped"]; answered: number } | null;
    /**
     * Places found by name, for a territory where nothing with a website
     * carries the tags (or no tag was chosen). Used only while `places` is empty.
     */
    byName: OsmPlace[];
    /** True once the name search has been answered for this filling. */
    namesSearched: boolean;
    /**
     * Ids kept from the filling this one replaces. They leave the list when
     * a server vouches for them again, and leave the pool if it completes
     * without them: a refresh never knows less than what it replaces.
     */
    carried: string[];
    /** True once every place in scope is known and nothing is waiting. */
    complete: boolean;
    completedBy: "overpass" | "sweep" | null;
    /** When it became complete: what its age is counted from. */
    completedAt: string | null;
    startedAt: string;
    updatedAt: string;
    /** Requests sent for this pool, over every run. */
    requests: { overpass: number; photon: number; osmApi: number; nominatim: number };
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
    /** All the time Overpass gets for the territory, over every instance tried. */
    overpassBudgetMs: number;
    /** Give up on one Overpass instance after this long. */
    overpassTimeoutMs: number;
    /** The timeout Overpass is asked to apply to the query itself. */
    overpassServerTimeoutSeconds: number;
    /** A pool older than this is filled again. */
    maxAgeMs: number;
    /** The same for a pool that knows no place: an empty answer is asked again sooner. */
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
    /**
     * Photon requests this call may send, all told: the sweep, the lookup
     * that places a region on the map, and the name search.
     */
    photonRequests: number;
    fetchImpl?: typeof fetch;
    /**
     * Per-host pauses for Photon, the OSM API and Nominatim: one request at
     * a time per host. Overpass is not queued (see ./throttle). None when absent.
     */
    throttle?: HostThrottle;
    signal?: AbortSignal;
    now?: () => number;
    /** Overpass instances to try in order. */
    overpassUrls?: readonly string[];
    limits?: Partial<PlacePoolLimits>;
}

export interface PlacePoolReport {
    /** What this call asked: nothing (the stored pool was enough), or these in order. */
    asked: Array<"overpass" | "sweep" | "names">;
    complete: boolean;
    completedBy: PlacePoolState["completedBy"];
    /** Places known, with or without a website. */
    known: number;
    withWebsite: number;
    /** Requests this call sent. */
    requests: { overpass: number; photon: number; osmApi: number; nominatim: number };
    /** Boxes the sweep has still to ask. */
    pendingBoxes: number;
    /** Found places whose tags are still to be read. */
    unread: number;
    /**
     * Boxes still full at the sweep's depth limit. Places there stay hidden,
     * so a sweep with any cannot make the pool complete.
     */
    boxesCutOff: number;
    /** What a later run would still ask for this pool. */
    waiting: PoolWaiting;
    overpassAttempts: OverpassAttempt[];
    sweepStopped: SweepRunResult["stopped"] | null;
    /** What did not answer on the way, in words. */
    problems: string[];
}

/** The pool a request reads and fills: its territory, its tags, and the name words Overpass is given. */
export function placePoolKey(request: PlacePoolRequest): string {
    const selectors = request.selectors.slice(0, MAX_SELECTORS).sort();
    // Overpass matches names too inside a region, and when no tag was chosen.
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
        selectors: request.selectors.slice(0, MAX_SELECTORS),
        places: {},
        without: [],
        unread: [],
        overpassAnswered: false,
        sweep: null,
        lastSweep: null,
        byName: [],
        namesSearched: false,
        carried: [],
        complete: false,
        completedBy: null,
        completedAt: null,
        startedAt: at,
        updatedAt: at,
        requests: { overpass: 0, photon: 0, osmApi: 0, nominatim: 0 },
    };
}

/** A new filling that starts out knowing what the old one knew. */
function successor(old: PlacePoolState, request: PlacePoolRequest, now: number): PlacePoolState {
    return {
        ...emptyPool(request, now),
        places: old.places,
        without: old.without,
        byName: old.byName,
        carried: [...Object.keys(old.places), ...old.without],
    };
}

/** Places known so far, with or without a website. */
export function placesKnown(state: PlacePoolState): number {
    const ids = new Set<string>(state.without);
    for (const id of Object.keys(state.places)) ids.add(id);
    for (const hit of state.unread) ids.add(hit.id);
    return ids.size;
}

/** What a later run would still ask for a pool. All false: it has been told all it can be. */
export interface PoolWaiting {
    /** Overpass has not answered for the territory yet, and is asked again. */
    overpass: boolean;
    /** The sweep has boxes to ask, or has yet to start. */
    boxes: boolean;
    /** Found places whose tags are still to be read. */
    tags: boolean;
}

export function poolWaiting(state: PlacePoolState): PoolWaiting {
    if (state.complete) return { overpass: false, boxes: false, tags: false };
    // A sweep needs a tag to filter by and a box to cover.
    const canSweep =
        photonTagsFor(state.selectors.slice(0, MAX_SELECTORS)).length > 0 &&
        (state.region !== null || countryBox(state.country) !== null);
    return {
        overpass: oneAreaCoversTerritory(state.country, state.region) && !state.overpassAnswered,
        boxes: canSweep && (state.sweep === null || sweepPending(state.sweep) > 0),
        tags: state.unread.length > 0,
    };
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
 * server happened to return. A pool with no such place gives what the name
 * search found.
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
    if (out.length > 0) return out;
    return state.byName.slice(0, Math.min(max, state.byName.length));
}

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
    const region = request.region?.trim() ? request.region.trim() : null;
    const fetchImpl = deps.fetchImpl ?? fetch;
    const politeFetch = deps.throttle ? throttledFetch(fetchImpl, deps.throttle) : fetchImpl;
    const aborted = () => deps.signal?.aborted === true;

    let stored: PlacePoolState | null = null;
    try {
        stored = await deps.store.load(key);
    } catch (error) {
        console.warn("[distribution] place pool could not be read; starting it again:", error);
    }
    if (stored && stored.version !== PLACE_POOL_VERSION) stored = null;
    const grownOld = (pool: PlacePoolState): boolean => {
        const age = (since: string) => now() - Date.parse(since);
        const empty = placesKnown(pool) === 0;
        if (pool.complete)
            return (
                age(pool.completedAt ?? pool.updatedAt) >
                (empty ? limits.maxEmptyAgeMs : limits.maxAgeMs)
            );
        // Not complete. With nothing found and no box answered there is no
        // progress to lose: the question is put again, sooner.
        if (empty && (pool.sweep?.answered ?? 0) === 0)
            return age(pool.startedAt) > limits.maxEmptyAgeMs;
        // Otherwise it carries on from where it stopped, however long ago:
        // starting over would ask answered boxes again. Only a pool with
        // nothing left to ask is filled afresh.
        const waiting = poolWaiting(pool);
        const stuck = !waiting.overpass && !waiting.boxes && !waiting.tags;
        return stuck && age(pool.startedAt) > limits.maxAgeMs;
    };
    const state: PlacePoolState = !stored
        ? emptyPool(request, now())
        : grownOld(stored)
          ? successor(stored, request, now())
          : stored;

    const report: PlacePoolReport = {
        asked: [],
        complete: state.complete,
        completedBy: state.completedBy,
        known: 0,
        withWebsite: 0,
        requests: { overpass: 0, photon: 0, osmApi: 0, nominatim: 0 },
        pendingBoxes: 0,
        unread: 0,
        boxesCutOff: 0,
        waiting: { overpass: false, boxes: false, tags: false },
        overpassAttempts: [],
        sweepStopped: null,
        problems: [],
    };
    const without = new Set(state.without);
    const carried = new Set(state.carried);
    const sync = () => {
        state.without = [...without];
        state.carried = [...carried];
    };
    const save = async () => {
        sync();
        state.updatedAt = new Date(now()).toISOString();
        try {
            await deps.store.save(key, state);
        } catch (error) {
            console.warn("[distribution] place pool could not be stored:", error);
        }
    };
    const finish = () => {
        sync();
        report.complete = state.complete;
        report.completedBy = state.completedBy;
        report.known = placesKnown(state);
        report.withWebsite = Object.keys(state.places).length;
        report.pendingBoxes = state.sweep ? sweepPending(state.sweep) : 0;
        report.unread = state.unread.length;
        report.boxesCutOff = state.sweep?.cutOff ?? 0;
        report.waiting = poolWaiting(state);
        return { state, report };
    };
    /** A place a server has just described, with a website. */
    const keep = (place: OsmPlace) => {
        state.places[place.id] = place;
        without.delete(place.id);
        carried.delete(place.id);
    };
    /** A place a server has just described, without one. */
    const hasNoWebsite = (id: string) => {
        delete state.places[id];
        without.add(id);
        carried.delete(id);
    };
    /** Everything in scope has been told: what the old filling knew and nobody confirmed goes. */
    const settle = (by: NonNullable<PlacePoolState["completedBy"]>) => {
        for (const id of carried) {
            delete state.places[id];
            without.delete(id);
        }
        carried.clear();
        state.complete = true;
        state.completedBy = by;
        state.completedAt = new Date(now()).toISOString();
    };
    const count = (kind: keyof PlacePoolReport["requests"], requests: number) => {
        report.requests[kind] += requests;
        state.requests[kind] += requests;
    };
    const hasPlaces = () => Object.keys(state.places).length > 0;
    // Complete, and either it has places or the names have been tried: nothing to ask.
    if (state.complete && (hasPlaces() || state.namesSearched)) return finish();

    let photonLeft = Math.max(0, Math.floor(deps.photonRequests));
    const asked = request.selectors.slice(0, MAX_SELECTORS);
    const tags = photonTagsFor(asked);
    // A sweep can only speak for the selectors it can ask Photon for.
    const sweepCoversSelectors = tags.length > 0 && tags.length === asked.length;
    const overpassCovers = oneAreaCoversTerritory(country, region);
    const boxesWaiting = state.sweep ? sweepPending(state.sweep) : 0;
    // A sweep that can end within this call's cap is finished rather than set
    // aside for another wait on Overpass; unless Photon answered nothing last
    // time, when Overpass may be the way through.
    const sweepNearlyDone =
        state.sweep !== null &&
        boxesWaiting > 0 &&
        boxesWaiting <= photonLeft &&
        (state.lastSweep?.answered ?? 0) > 0 &&
        state.lastSweep?.stopped !== "failing";

    // 1. Overpass: everything in one answer, when one area is the whole territory.
    if (
        !state.complete &&
        overpassCovers &&
        !state.overpassAnswered &&
        !sweepNearlyDone &&
        !aborted()
    ) {
        report.asked.push("overpass");
        const [area] = overpassAreas(country, region);
        const answer = await fetchOverpassArea(
            area!,
            {
                country,
                region,
                keywords: request.keywords,
                selectors: request.selectors,
                timeoutSeconds: limits.overpassServerTimeoutSeconds,
            },
            {
                fetchImpl,
                signal: deps.signal,
                urls: deps.overpassUrls,
                timeoutMs: limits.overpassTimeoutMs,
                deadline: now() + limits.overpassBudgetMs,
                now,
            }
        );
        report.overpassAttempts.push(...answer.attempts);
        count("overpass", answer.attempts.length);
        if (answer.answered) {
            state.overpassAnswered = true;
            for (const place of answer.places) {
                if (place.website) keep(place);
                else hasNoWebsite(place.id);
            }
            // An empty answer settles nothing (a region name that matches no
            // area); the sweep, which works on a map box, still gets its turn.
            if (answer.places.length > 0) {
                settle("overpass");
                state.sweep = null;
                state.unread = [];
            }
        } else {
            const tried = answer.attempts.map(a => `${a.host}: ${a.detail}`).join("; ");
            report.problems.push(`Overpass did not answer${tried ? ` (${tried})` : ""}`);
        }
        await save();
    }

    // 2. The sweep: Photon, letter by letter, then the tags of what it found.
    if (!state.complete && tags.length > 0 && !aborted()) {
        if (photonLeft > 0 && !state.sweep) {
            // Placing a region on the map is a Photon request too.
            const located = await sweepBox(country, region, politeFetch, deps.signal);
            count("photon", located.photonRequests);
            photonLeft -= located.photonRequests;
            if (located.box) state.sweep = newSweep(located.box, tags);
        }
        if (photonLeft > 0 && state.sweep && sweepPending(state.sweep) > 0) {
            report.asked.push("sweep");
            const known = new Set<string>([...Object.keys(state.places), ...without]);
            for (const hit of state.unread) known.add(hit.id);
            const before = { report: report.requests.photon, state: state.requests.photon };
            let sinceSave = 0;
            const result = await runSweep(state.sweep, {
                country,
                maxRequests: photonLeft,
                fetchImpl,
                throttle: deps.throttle,
                signal: deps.signal,
                onHits: hits => {
                    for (const hit of hits) {
                        // Photon still lists it: the old filling was right that it exists.
                        carried.delete(hit.id);
                        if (known.has(hit.id)) continue;
                        known.add(hit.id);
                        state.unread.push(hit);
                    }
                },
                onAnswered: async ({ sent }) => {
                    report.requests.photon = before.report + sent;
                    state.requests.photon = before.state + sent;
                    sinceSave += 1;
                    if (sinceSave >= SAVE_EVERY_ANSWERS) {
                        sinceSave = 0;
                        await save();
                    }
                },
            });
            report.requests.photon = before.report + result.sent;
            state.requests.photon = before.state + result.sent;
            photonLeft -= result.sent;
            report.sweepStopped = result.stopped;
            state.lastSweep = { stopped: result.stopped, answered: result.answered };
            if (result.stopped === "failing")
                report.problems.push("Photon stopped answering during the place sweep");
            // Stored before the tags are read, so a crash there loses no sweep.
            await save();
        }
        if (state.unread.length > 0 && !aborted()) {
            const read = await readPlaceTags(state.unread, country, {
                fetchImpl,
                throttle: deps.throttle,
                signal: deps.signal,
            });
            for (const place of read.places) keep(place);
            for (const id of read.without) hasNoWebsite(id);
            // What could not be read stays unread: a failure is not "no website".
            state.unread = read.unread;
            count("osmApi", read.requests);
            if (read.answered < read.requests)
                report.problems.push("The OSM API did not answer every read of place tags");
        }
        // Every box answered, none of them cut off, every tag read: told everything.
        if (
            state.sweep !== null &&
            sweepPending(state.sweep) === 0 &&
            state.sweep.cutOff === 0 &&
            state.unread.length === 0 &&
            sweepCoversSelectors
        )
            settle("sweep");
        await save();
    }

    // 3. Names: nothing with a website carries the tags here (or no tag was
    //    chosen), so look for the segment's words in place names instead.
    if (!hasPlaces() && !state.namesSearched && !aborted()) {
        report.asked.push("names");
        const named = await searchByName(request, {
            country,
            region,
            politeFetch,
            fetchImpl,
            photonLeft,
            // Asked city by city only where one area could not cover the territory.
            overpassByCity: !overpassCovers,
            overpassUrls: deps.overpassUrls,
            overpassTimeoutMs: limits.overpassTimeoutMs,
            signal: deps.signal,
        });
        count("photon", named.requests.photon);
        count("osmApi", named.requests.osmApi);
        count("nominatim", named.requests.nominatim);
        count("overpass", named.requests.overpass);
        report.problems.push(...named.problems);
        // Kept only when some server answered: silence is not "nothing by that name".
        if (named.answered) {
            state.byName = named.places;
            state.namesSearched = true;
        }
        await save();
    }
    return finish();
}

/**
 * The box the sweep covers: around the region's centre (one Photon request
 * to place it), or the whole country (from the table, no request).
 */
async function sweepBox(
    country: string,
    region: string | null,
    politeFetch: typeof fetch,
    signal: AbortSignal | undefined
): Promise<{ box: Bbox | null; photonRequests: number }> {
    if (!region) return { box: countryBox(country), photonRequests: 0 };
    const centre = await locateCity(region, country, { fetchImpl: politeFetch, signal }).catch(
        () => null
    );
    return {
        box: centre
            ? [
                  centre.lon - BOX_LON,
                  centre.lat - BOX_LAT,
                  centre.lon + BOX_LON,
                  centre.lat + BOX_LAT,
              ]
            : null,
        photonRequests: 1,
    };
}

interface NameSearch {
    places: OsmPlace[];
    requests: { overpass: number; photon: number; osmApi: number; nominatim: number };
    /** True when at least one server answered a request. */
    answered: boolean;
    problems: string[];
}

/**
 * Places whose names hold the segment's words: Photon by keyword in the
 * largest cities (inside the run's Photon cap), then Nominatim in the local
 * languages ("koffiebranderij", "Bäckerei"), and, where the country is too
 * large to ask as one, Overpass city by city first.
 */
async function searchByName(
    request: PlacePoolRequest,
    context: {
        country: string;
        region: string | null;
        politeFetch: typeof fetch;
        fetchImpl: typeof fetch;
        photonLeft: number;
        overpassByCity: boolean;
        overpassUrls?: readonly string[];
        overpassTimeoutMs: number;
        signal?: AbortSignal;
    }
): Promise<NameSearch> {
    const { country, region } = context;
    const result: NameSearch = {
        places: [],
        requests: { overpass: 0, photon: 0, osmApi: 0, nominatim: 0 },
        answered: false,
        problems: [],
    };
    const add = (batch: readonly OsmPlace[]) => {
        for (const place of batch) {
            if (result.places.length >= NAME_SEARCH_LIMIT) break;
            if (!place.website) continue;
            if (!result.places.some(p => p.website === place.website || p.id === place.id))
                result.places.push(place);
        }
    };
    // Every request is counted by the server it goes to, and Photon's stop at the cap.
    const tallied =
        (inner: typeof fetch): typeof fetch =>
        async (input, init) => {
            const host = requestHost(input);
            const kind =
                host === PHOTON_HOST
                    ? "photon"
                    : host === OSM_API_HOST
                      ? "osmApi"
                      : host === NOMINATIM_HOST
                        ? "nominatim"
                        : "overpass";
            if (kind === "photon" && result.requests.photon >= context.photonLeft)
                throw new Error("The run's Photon request cap is reached");
            result.requests[kind] += 1;
            const response = await inner(input, init);
            if (response.ok) result.answered = true;
            return response;
        };
    const problem = (error: unknown) =>
        result.problems.push(error instanceof Error ? error.message : String(error));

    if (context.overpassByCity) {
        try {
            add(
                await searchOverpass(
                    {
                        country,
                        region,
                        keywords: request.keywords,
                        selectors: request.selectors,
                        limit: NAME_SEARCH_LIMIT,
                    },
                    {
                        fetchImpl: tallied(context.fetchImpl),
                        urls: context.overpassUrls,
                        timeoutMs: context.overpassTimeoutMs,
                        signal: context.signal,
                    }
                )
            );
        } catch (error) {
            problem(error);
        }
    }
    if (context.photonLeft > 0) {
        try {
            add(
                await searchPhoton(
                    {
                        country,
                        region,
                        keywords: request.keywords,
                        selectors: [],
                        limit: NAME_SEARCH_LIMIT,
                    },
                    { fetchImpl: tallied(context.politeFetch), signal: context.signal }
                )
            );
        } catch (error) {
            problem(error);
        }
    }
    const terms = [
        ...new Set([...nativeTermsFor(request.keywords), ...request.keywords.slice(0, 1)]),
    ].slice(0, 4);
    try {
        add(
            await searchNominatim(
                {
                    country,
                    areas: overpassAreas(country, region),
                    terms,
                    limit: NAME_SEARCH_LIMIT,
                },
                // The throttle already spaces requests to Nominatim.
                { fetchImpl: tallied(context.politeFetch), signal: context.signal, pauseMs: 0 }
            )
        );
    } catch (error) {
        problem(error);
    }
    return result;
}
