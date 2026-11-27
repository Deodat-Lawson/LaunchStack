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
 * A box that comes back short is complete. Splitting stops when a box is
 * about a kilometre across; one still full there is counted as cut off.
 *
 * The sweep is plain data (`SweepState`): a run stops at its request cap and
 * a later run carries on with the boxes still waiting, so nothing is asked
 * twice. No request here is chosen by anything learned; the order is fixed.
 * Nothing is ever given up: a box whose request fails waits and is asked
 * again, so a sweep is only over when every box has been answered.
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
/** A box is split until its longer side is about this short. */
const SWEEP_CELL_KM = 1;
/** The depth limit is never lower than this (a region's box is small to begin with)… */
export const SWEEP_BASE_DEPTH = 8;
/** …and never higher than this. */
export const SWEEP_DEPTH_CAP = 14;
/** The name prefixes asked. Photon folds accents, so "e" also finds "É". */
export const SWEEP_LETTERS: readonly string[] = "abcdefghijklmnopqrstuvwxyz".split("");
/**
 * This many failures in a row end the run's sweep or its tag reads: the
 * server is not answering, and asking on would only add to its trouble.
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
    /**
     * Boxes whose request failed while Photon was answering others. Each is
     * asked again at the start of the next run, not seconds later, and on
     * every run after that until it is answered. A box that fails while
     * nothing is answered (an outage) is not here: it simply goes back in
     * its queue.
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
        deferred: [],
    };
}

/** Boxes still to ask. Zero means every place a letter can reach has been returned. */
export function sweepPending(state: SweepState): number {
    return state.arms.reduce((sum, arm) => sum + arm.queue.length, state.deferred.length);
}

/**
 * How deep a box may be split: until a quarter's longer side is about a
 * kilometre, so a dense town is listed whatever the size of the territory
 * around it. The Netherlands gets 9 levels, Germany 10, the United States
 * 13; a region's box keeps 8. A box still full at that depth is counted as
 * cut off (`SweepState.cutOff`).
 */
export function sweepDepthFor(box: Bbox): number {
    const [west, south, east, north] = box;
    const midLatitude = (((south + north) / 2) * Math.PI) / 180;
    const widthKm = Math.abs(east - west) * 111.32 * Math.cos(midLatitude);
    const heightKm = Math.abs(north - south) * 110.57;
    const depth = Math.ceil(Math.log2(Math.max(widthKm, heightKm, 1) / SWEEP_CELL_KM));
    return Math.min(SWEEP_DEPTH_CAP, Math.max(SWEEP_BASE_DEPTH, depth));
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
            if (!response.ok) throw new Error(`${host} ${response.status}`);
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
    /** How deep a full box may be split; `sweepDepthFor` the sweep's box when absent. */
    maxDepth?: number;
    /** Receives the places of each answer; the same place can arrive more than once. */
    onHits: (hits: SweepHit[]) => void;
    /**
     * Called after each answered request, with the requests sent so far in
     * this run: where a caller stores the sweep so a crash loses little.
     */
    onAnswered?: (progress: { sent: number }) => void | Promise<void>;
}

export interface SweepRunResult {
    /** Requests sent in this run. */
    sent: number;
    answered: number;
    failed: number;
    /**
     * Why the run ended: every box has been answered ("complete"), the
     * request cap was reached, only boxes whose request failed in this run
     * are left ("deferred": they wait for the next run), Photon stopped
     * answering, or the caller aborted.
     */
    stopped: "complete" | "cap" | "deferred" | "failing" | "aborted";
}

/** Carries the sweep on for up to `maxRequests` requests. Mutates `state`. */
export async function runSweep(
    state: SweepState,
    options: SweepRunOptions
): Promise<SweepRunResult> {
    const base = options.photonUrl ?? PHOTON_URL;
    const maxDepth = options.maxDepth ?? sweepDepthFor(state.box);
    const country = options.country.toUpperCase();
    const result: SweepRunResult = { sent: 0, answered: 0, failed: 0, stopped: "cap" };
    if (options.maxRequests <= 0) {
        if (sweepPending(state) === 0) result.stopped = "complete";
        return result;
    }
    // Boxes that failed on an earlier run are asked again first.
    for (const { arm, node } of state.deferred.splice(0)) state.arms[arm]?.queue.unshift(node);
    // Failures since the last answer. What they mean is only known later: an
    // answer after them says Photon was up and the request was the trouble,
    // so the box waits for the next run; a run of failures says Photon was
    // down, and the boxes go back in their queues as if never asked.
    let unsettled: Array<{ arm: SweepArm; node: string }> = [];
    const settle = (photonWasUp: boolean) => {
        // Last first, so boxes go back to the front of a queue in the order they left it.
        for (const { arm, node } of unsettled.reverse()) {
            if (photonWasUp) state.deferred.push({ arm: state.arms.indexOf(arm), node });
            else {
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
            unsettled.push({ arm, node });
            if (unsettled.length >= MAX_FAILURES_IN_A_ROW) {
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
        await options.onAnswered?.({ sent: result.sent });
    }
    // A failure or two at the very end of a run: the boxes wait for the next.
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
    /**
     * Hits not read: their request failed, the answer left them out, or the
     * reads stopped before reaching them. They stay unread until a read
     * succeeds; a failure is never taken to mean "no website".
     */
    unread: SweepHit[];
    /** Requests sent, and how many of them were answered. */
    requests: number;
    answered: number;
}

/**
 * The tags of what the sweep found, from the OSM API, one request per 100
 * places of a type. Only what a place listing needs is kept: the element's
 * author and history are not. Three failures in a row end the reads.
 */
export async function readPlaceTags(
    hits: readonly SweepHit[],
    country: string,
    options: SweepClientOptions = {}
): Promise<TagReadResult> {
    const base = options.osmApiUrl ?? OSM_API_URL;
    const result: TagReadResult = { places: [], without: [], unread: [], requests: 0, answered: 0 };
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
            } catch {
                failuresInARow += 1;
                result.unread.push(...chunk);
                continue;
            }
            failuresInARow = 0;
            result.answered += 1;
            const byId = new Map(elements.map(el => [`osm:${el.type}/${el.id}`, el]));
            for (const hit of chunk) {
                const element = byId.get(hit.id);
                // An id the answer does not mention has not been told: it stays unread.
                // (The API returns every id it was asked for, deleted ones included.)
                if (!element) {
                    result.unread.push(hit);
                    continue;
                }
                const place = placeFromTags(hit, element, country);
                if (place) result.places.push(place);
                else result.without.push(hit.id);
            }
        }
    }
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
