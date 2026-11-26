/**
 * The place sweep: every place with a tag inside a map box, from Photon,
 * when Overpass does not answer.
 *
 * Photon matches the search text against place names (the start of any word
 * in the name) and only then applies the category filter, and it returns at
 * most 50 places. So no request can ask for "every bicycle shop"; it can ask
 * for the bicycle shops with a name word starting with "a". The sweep asks
 * that for every letter, and whenever a box comes back with a full page it
 * splits the box in four and asks each quarter, until boxes come back short.
 * A box that comes back short is complete.
 *
 * The sweep is plain data (`SweepState`): a run stops at its request cap and
 * a later run carries on with the boxes still waiting, so nothing is asked
 * twice. No request here is chosen by anything learned; the order is fixed.
 *
 * Photon returns ids and names but not website tags, so the tags of what was
 * found are read afterwards from the OSM API, 100 places per request.
 */
import type { Bbox } from "./geo";
import {
    CATEGORY_KEYS,
    KEYLESS_USER_AGENT,
    normalizeWebsite,
    withTimeout,
    type OsmPlace,
} from "./osm";
import { OSM_API_URL, PHOTON_URL } from "./photon";
import type { HostThrottle } from "./throttle";

/** Photon's page size: a box that returns this many may hide more. */
export const PHOTON_PAGE = 50;
/** Boxes are not split below this depth; a box still full there is counted as cut off. */
export const SWEEP_MAX_DEPTH = 8;
/** The name prefixes asked. Photon folds accents, so "e" also finds "É". */
export const SWEEP_LETTERS: readonly string[] = "abcdefghijklmnopqrstuvwxyz".split("");
/**
 * This many failures in a row end the run's sweep: the server is not
 * answering. Those boxes go back in their queues with nothing held against
 * them, so an outage, however long, loses no part of the map.
 */
const MAX_FAILURES_IN_A_ROW = 3;
/** Places per OSM API request. */
const TAGS_PER_REQUEST = 100;

/** One name prefix for one tag, and the boxes it has not asked yet. */
export interface SweepArm {
    /** Photon `osm_tag` filter: "shop:bicycle". */
    tag: string;
    /** The name prefix: a letter. */
    term: string;
    /**
     * Boxes not asked yet, widest first: paths down the quadtree from the
     * root, "r", "r.0", "r.0.3" (quarters 0 SW, 1 SE, 2 NW, 3 NE).
     */
    queue: string[];
    /** Requests this arm has sent, answered or not. */
    turns: number;
}

export interface SweepState {
    /** The root box. */
    box: Bbox;
    arms: SweepArm[];
    /** Requests Photon answered, over every run. */
    answered: number;
    /** Boxes still full at the depth limit: places there may stay hidden. */
    cutOff: number;
    /** Boxes given up on: their request failed on two runs while Photon answered others. */
    dropped: number;
    /**
     * Boxes whose request failed while Photon was answering others: each is
     * asked once more, at the start of the next run, not seconds later. A
     * box that fails while nothing is answered (an outage) is not here: it
     * simply goes back in its queue.
     */
    deferred: Array<{ arm: number; node: string }>;
}

/** A place Photon returned; its tags are not read yet. */
export interface SweepHit {
    /** "osm:node/123", as `OsmPlace.id`. */
    id: string;
    name: string;
    lat: number;
    lng: number;
    /** The tag it was found under, as a category: "shop=bicycle". */
    category: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    /** Runs on which reading its tags failed. */
    tries?: number;
}

export function newSweep(
    box: Bbox,
    tags: readonly string[],
    letters: readonly string[] = SWEEP_LETTERS
): SweepState {
    return {
        box,
        arms: tags.flatMap(tag => letters.map(term => ({ tag, term, queue: ["r"], turns: 0 }))),
        answered: 0,
        cutOff: 0,
        dropped: 0,
        deferred: [],
    };
}

/** Boxes still to ask. Zero means every place a letter can reach has been returned. */
export function sweepPending(state: SweepState): number {
    return state.arms.reduce((sum, arm) => sum + arm.queue.length, state.deferred.length);
}

export function quarterBoxes(box: Bbox): [Bbox, Bbox, Bbox, Bbox] {
    const [minLon, minLat, maxLon, maxLat] = box;
    const midLon = (minLon + maxLon) / 2;
    const midLat = (minLat + maxLat) / 2;
    return [
        [minLon, minLat, midLon, midLat],
        [midLon, minLat, maxLon, midLat],
        [minLon, midLat, midLon, maxLat],
        [midLon, midLat, maxLon, maxLat],
    ];
}

/** The box a quadtree path names, from the root down. */
export function boxOfNode(root: Bbox, node: string): Bbox {
    let box = root;
    for (const part of node.split(".").slice(1)) box = quarterBoxes(box)[Number(part)]!;
    return box;
}

export function photonSweepUrl(base: string, tag: string, term: string, box: Bbox): string {
    const params = new URLSearchParams({
        q: term,
        limit: String(PHOTON_PAGE),
        lang: "en",
        bbox: box.map(n => n.toFixed(4)).join(","),
    });
    params.append("osm_tag", tag);
    return `${base}?${params.toString()}`;
}

/**
 * Whose turn it is: the arm that has sent the fewest requests, in arm order.
 * So every letter asks its widest box before any letter asks a quarter, and
 * the sweep deepens level by level.
 */
export function nextArm(state: SweepState): SweepArm | null {
    let best: SweepArm | null = null;
    for (const arm of state.arms) {
        if (arm.queue.length === 0) continue;
        if (!best || arm.turns < best.turns) best = arm;
    }
    return best;
}

interface PhotonFeature {
    geometry?: { coordinates?: [number, number] };
    properties: {
        osm_type?: "N" | "W" | "R";
        osm_id?: number;
        name?: string;
        city?: string;
        countrycode?: string;
        street?: string;
        housenumber?: string;
        postcode?: string;
    };
}

const OSM_TYPE = { N: "node", W: "way", R: "relation" } as const;

export interface SweepClientOptions {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    photonUrl?: string;
    osmApiUrl?: string;
    userAgent?: string;
    /**
     * Give up on one request after this long (default 15 s), counted from the
     * moment it is sent, not from when it joined its host's queue.
     */
    requestTimeoutMs?: number;
    /** Per-host pauses; each request waits its host's turn. None when absent. */
    throttle?: HostThrottle;
}

/** A response that was not a success, with its status. */
class HttpStatusError extends Error {
    constructor(
        host: string,
        readonly status: number
    ) {
        super(`${host} ${status}`);
        this.name = "HttpStatusError";
    }
    /** The server understood and refused this request: asking again will not help. */
    get requestsOwnFault(): boolean {
        return this.status >= 400 && this.status < 500 && this.status !== 429;
    }
}

async function getJson<T>(url: string, options: SweepClientOptions): Promise<T> {
    const host = new URL(url).hostname;
    const send = async (): Promise<T> => {
        const timed = withTimeout(options.signal, options.requestTimeoutMs ?? 15_000);
        try {
            const response = await (options.fetchImpl ?? fetch)(url, {
                headers: {
                    "User-Agent": options.userAgent ?? KEYLESS_USER_AGENT,
                    Accept: "application/json",
                },
                signal: timed.signal,
            });
            if (!response.ok) throw new HttpStatusError(host, response.status);
            return (await response.json()) as T;
        } finally {
            timed.clear();
        }
    };
    return options.throttle ? options.throttle(host, send) : send();
}

export interface SweepRunOptions extends SweepClientOptions {
    /** Two-letter country: places outside it are dropped (a box can reach into neighbours). */
    country: string;
    /** Photon requests this run may send. */
    maxRequests: number;
    maxDepth?: number;
    /** Receives the places of each answer; the same place can arrive more than once. */
    onHits: (hits: SweepHit[]) => void;
}

export interface SweepRunResult {
    /** Requests sent in this run. */
    sent: number;
    answered: number;
    failed: number;
    /**
     * Why the run ended: every box is asked ("complete"), the request cap was
     * reached, only boxes that failed in this run are left ("deferred": they
     * wait for the next run), Photon stopped answering, or the caller aborted.
     */
    stopped: "complete" | "cap" | "deferred" | "failing" | "aborted";
}

/** Carries the sweep on for up to `maxRequests` requests. Mutates `state`. */
export async function runSweep(
    state: SweepState,
    options: SweepRunOptions
): Promise<SweepRunResult> {
    const base = options.photonUrl ?? PHOTON_URL;
    const maxDepth = options.maxDepth ?? SWEEP_MAX_DEPTH;
    const country = options.country.toUpperCase();
    const result: SweepRunResult = { sent: 0, answered: 0, failed: 0, stopped: "cap" };
    if (options.maxRequests <= 0) {
        if (sweepPending(state) === 0) result.stopped = "complete";
        return result;
    }
    // Boxes that failed on an earlier run get their second and last try first.
    const secondTry = new Set<string>();
    for (const { arm, node } of state.deferred.splice(0)) {
        const owner = state.arms[arm];
        if (!owner) continue;
        owner.queue.unshift(node);
        secondTry.add(`${arm} ${node}`);
    }
    // Failures since the last answer. Whether they count against their boxes
    // is only known later: an answer after them says the server was up and
    // the box was the trouble; a run of failures says the server was down.
    let unsettled: Array<{ arm: SweepArm; index: number; node: string }> = [];
    const settle = (serverWasUp: boolean) => {
        for (const { arm, index, node } of unsettled) {
            const second = secondTry.has(`${index} ${node}`);
            if (serverWasUp) {
                if (second) state.dropped += 1;
                else state.deferred.push({ arm: index, node });
            } else if (second) {
                // Still owed its second try.
                state.deferred.push({ arm: index, node });
            } else {
                // As if it had not been asked.
                arm.queue.unshift(node);
                arm.turns -= 1;
            }
        }
        unsettled = [];
    };
    while (result.sent < options.maxRequests) {
        if (options.signal?.aborted) {
            settle(true);
            result.stopped = "aborted";
            return result;
        }
        const arm = nextArm(state);
        if (!arm) break;
        const node = arm.queue.shift()!;
        arm.turns += 1;
        result.sent += 1;
        let features: PhotonFeature[];
        try {
            const json = await getJson<{ features?: PhotonFeature[] }>(
                photonSweepUrl(base, arm.tag, arm.term, boxOfNode(state.box, node)),
                options
            );
            features = json.features ?? [];
        } catch {
            result.failed += 1;
            unsettled.push({ arm, index: state.arms.indexOf(arm), node });
            if (unsettled.length >= MAX_FAILURES_IN_A_ROW) {
                // Photon is not answering: nothing is held against these boxes.
                settle(false);
                result.stopped = "failing";
                return result;
            }
            continue;
        }
        settle(true);
        state.answered += 1;
        result.answered += 1;

        const [key, value] = arm.tag.split(":");
        const hits: SweepHit[] = [];
        for (const feature of features) {
            const p = feature.properties;
            const coords = feature.geometry?.coordinates;
            if (!p.osm_id || !p.osm_type || !p.name || !coords) continue;
            if ((p.countrycode ?? "").toUpperCase() !== country) continue;
            hits.push({
                id: `osm:${OSM_TYPE[p.osm_type]}/${p.osm_id}`,
                name: p.name,
                lat: coords[1],
                lng: coords[0],
                category: `${key}=${value}`,
                ...(p.street ? { street: p.street } : {}),
                ...(p.housenumber ? { housenumber: p.housenumber } : {}),
                ...(p.postcode ? { postcode: p.postcode } : {}),
                ...(p.city ? { city: p.city } : {}),
            });
        }
        if (hits.length > 0) options.onHits(hits);

        // A full page may hide more: ask each quarter of the box.
        if (features.length >= PHOTON_PAGE) {
            const depth = node.split(".").length - 1;
            if (depth < maxDepth) for (let i = 0; i < 4; i++) arm.queue.push(`${node}.${i}`);
            else state.cutOff += 1;
        }
    }
    // A failure or two at the very end of a run is taken as the box's own.
    settle(true);
    if (sweepPending(state) === 0) result.stopped = "complete";
    else if (!nextArm(state)) result.stopped = "deferred";
    return result;
}

interface OsmElement {
    type: "node" | "way" | "relation";
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
}

export interface TagReadResult {
    /** Places that carry a name and a website. */
    places: OsmPlace[];
    /** Ids read that carry no website (or are gone): never read again. */
    without: string[];
    /** Hits not read: their request failed, or the reads stopped before reaching them. */
    unread: SweepHit[];
    /**
     * Of `unread`, the ids whose failure looks like their own request's, not
     * an outage: the API refused the request outright, or it answered other
     * requests in the same read.
     */
    struck: string[];
    /** Requests sent, and how many of them were answered. */
    requests: number;
    answered: number;
}

/**
 * The tags of what the sweep found, from the OSM API, one request per 100
 * places of a type. Only what a place listing needs is kept: the element's
 * author and history are not.
 */
export async function readPlaceTags(
    hits: readonly SweepHit[],
    country: string,
    options: SweepClientOptions = {}
): Promise<TagReadResult> {
    const base = options.osmApiUrl ?? OSM_API_URL;
    const result: TagReadResult = {
        places: [],
        without: [],
        unread: [],
        struck: [],
        requests: 0,
        answered: 0,
    };
    const failed: string[] = [];
    const refused: string[] = [];
    let failuresInARow = 0;
    const byType: Record<OsmElement["type"], SweepHit[]> = { node: [], way: [], relation: [] };
    for (const hit of hits) {
        const type = /^osm:(node|way|relation)\//.exec(hit.id)?.[1] as
            | OsmElement["type"]
            | undefined;
        if (type) byType[type].push(hit);
    }
    for (const type of ["node", "way", "relation"] as const) {
        const list = byType[type];
        for (let i = 0; i < list.length; i += TAGS_PER_REQUEST) {
            const chunk = list.slice(i, i + TAGS_PER_REQUEST);
            // Aborted, or the API is not answering: the rest waits for the next run.
            if (options.signal?.aborted || failuresInARow >= MAX_FAILURES_IN_A_ROW) {
                result.unread.push(...chunk);
                continue;
            }
            const ids = chunk.map(hit => hit.id.slice(hit.id.indexOf("/") + 1));
            let elements: OsmElement[];
            result.requests += 1;
            try {
                const json = await getJson<{ elements?: OsmElement[] }>(
                    `${base}/${type}s.json?${type}s=${ids.join(",")}`,
                    options
                );
                elements = json.elements ?? [];
            } catch (error) {
                result.unread.push(...chunk);
                if (error instanceof HttpStatusError && error.requestsOwnFault) {
                    // The API is answering; it will not answer this.
                    refused.push(...chunk.map(hit => hit.id));
                } else {
                    failuresInARow += 1;
                    failed.push(...chunk.map(hit => hit.id));
                }
                continue;
            }
            failuresInARow = 0;
            result.answered += 1;
            const byId = new Map(elements.map(el => [`osm:${el.type}/${el.id}`, el]));
            for (const hit of chunk) {
                const place = placeFromTags(hit, byId.get(hit.id), country);
                if (place) result.places.push(place);
                else result.without.push(hit.id);
            }
        }
    }
    // A failure with no answer around it is an outage, held against no place.
    result.struck = result.answered > 0 ? [...refused, ...failed] : refused;
    return result;
}

function placeFromTags(
    hit: SweepHit,
    element: OsmElement | undefined,
    country: string
): OsmPlace | null {
    const tags = element?.tags ?? {};
    const rawSite = tags.website ?? tags["contact:website"];
    const name = tags.name?.trim();
    const website = rawSite ? normalizeWebsite(rawSite) : null;
    if (!name || !website) return null;
    const address = [
        [tags["addr:street"] ?? hit.street, tags["addr:housenumber"] ?? hit.housenumber]
            .filter(Boolean)
            .join(" "),
        tags["addr:postcode"] ?? hit.postcode,
        tags["addr:city"] ?? hit.city,
    ]
        .filter(Boolean)
        .join(", ");
    const categories = CATEGORY_KEYS.filter(k => tags[k]).map(k => `${k}=${tags[k]}`);
    const city = tags["addr:city"] ?? hit.city ?? null;
    return {
        id: hit.id,
        name,
        website,
        address: address || (city ?? country.toUpperCase()),
        lat: element?.lat ?? hit.lat,
        lng: element?.lon ?? hit.lng,
        categories: categories.length > 0 ? categories : [hit.category],
        country: country.toUpperCase(),
        city,
    };
}
