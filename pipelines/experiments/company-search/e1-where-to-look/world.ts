/**
 * The recorded world for E1: for every search word, Photon's answers for
 * every useful box of a quadtree over the country; the tags of every place
 * found; and the true population from Overpass.
 *
 * Photon matches the search text against place NAMES (whole words, and the
 * start of a word), then applies the category filter, and returns at most 50
 * places for a box. So what a request finds depends on the word asked. A box
 * that came back full ("capped") hides places; splitting it into four and
 * asking again reveals them. A box that came back short is complete, so the
 * answer for any box inside it follows from the coordinates and needs no
 * request.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { DEFAULT_CACHE_DIR } from "../lib/recorder";
import type { Bbox, PlaceSegment } from "./segments";

export const PHOTON_URL = "https://photon.komoot.io/api/";
export const PHOTON_CAP = 50;

export interface Place {
    /** "N123", "W45", "R6": OSM type initial + id. */
    id: string;
    name: string;
    lon: number;
    lat: number;
}

export interface NodeAnswer {
    /** "r", "r.0", "r.0.3": the path from the root; quadrants 0 SW, 1 SE, 2 NW, 3 NE. */
    id: string;
    bbox: Bbox;
    depth: number;
    /** In-country places with the target tag, in Photon's order. */
    places: string[];
    /** True when Photon returned a full page, so the box may hide more. */
    capped: boolean;
}

/** Where a search word comes from: what a policy may ask without having learned it. */
export interface TermGroups {
    /** Known before any request: the category's English word (what production asks), its keywords, and the repo's native-word table. */
    plan: string[];
    /** Single letters: a prefix sweep over names. */
    letters: string[];
    /** Words that occur in found places' names; a policy may ask one only after seeing it. */
    mined: string[];
}

export interface World {
    segment: PlaceSegment;
    /** Per search word, every recorded quadtree node by id. */
    sweeps: Record<string, Record<string, NodeAnswer>>;
    terms: TermGroups;
    /** Every on-target place any request returned. */
    places: Record<string, Place>;
    /** Place ids whose OSM tags carry a website. */
    withWebsite: string[];
    /** What production's own search did for this segment. */
    production: {
        photonRequests: number;
        osmApiRequests: number;
        /** Every place production kept (has a website; capped at its limit), on target or not. */
        kept: number;
        /** The kept places that carry the segment's category. */
        keptOnTarget: string[];
    };
    /**
     * Production's whole keyless place search (`createKeylessPorts().searchPlaces`):
     * Photon, then Overpass for what is missing, then Nominatim. One live
     * sample per segment, so it reflects how the public servers were that minute.
     */
    productionFull: {
        requestsByHost: Record<string, number>;
        failedByHost: Record<string, number>;
        /** Places the search returned (it stops at 40). */
        kept: number;
        keptOnTarget: number;
        error: string | null;
    } | null;
    /** Ground truth from Overpass, or null when no mirror answered. */
    truth: {
        all: string[];
        withWebsite: string[];
        /** One entry per attempt: which mirror, whether it answered, how long. */
        attempts: Array<{ host: string; ok: boolean; ms: number; detail: string }>;
    } | null;
    photonRequests: number;
}

export function childBboxes(bbox: Bbox): [Bbox, Bbox, Bbox, Bbox] {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const midLon = (minLon + maxLon) / 2;
    const midLat = (minLat + maxLat) / 2;
    return [
        [minLon, minLat, midLon, midLat],
        [midLon, minLat, maxLon, midLat],
        [minLon, midLat, midLon, maxLat],
        [midLon, midLat, maxLon, maxLat],
    ];
}

export function contains(bbox: Bbox, place: Pick<Place, "lon" | "lat">): boolean {
    return (
        place.lon >= bbox[0] && place.lon <= bbox[2] && place.lat >= bbox[1] && place.lat <= bbox[3]
    );
}

export function bboxParam(bbox: Bbox): string {
    return bbox.map(n => n.toFixed(4)).join(",");
}

export function photonUrl(segment: Pick<PlaceSegment, "tag">, term: string, bbox: Bbox): string {
    const params = new URLSearchParams({
        q: term,
        limit: String(PHOTON_CAP),
        lang: "en",
        bbox: bboxParam(bbox),
    });
    params.append("osm_tag", segment.tag);
    return `${PHOTON_URL}?${params.toString()}`;
}

function worldFile(segmentId: string): string {
    return path.join(DEFAULT_CACHE_DIR, "e1-worlds", `${segmentId}.json.gz`);
}

export function saveWorld(world: World): void {
    const file = worldFile(world.segment.id);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(world), "utf8")));
}

export function loadWorld(segmentId: string): World | null {
    const file = worldFile(segmentId);
    if (!existsSync(file)) return null;
    return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as World;
}

/**
 * The answer for any quadtree node, recorded or not: a recorded node answers
 * for itself; a node under a complete (uncapped) ancestor is that ancestor's
 * places filtered by coordinates. Returns null for a node that was never
 * reachable (its parent was never asked).
 */
export function answerFor(world: World, term: string, id: string, bbox: Bbox): NodeAnswer | null {
    const nodes = world.sweeps[term];
    if (!nodes) return null;
    const recorded = nodes[id];
    if (recorded) return recorded;
    const parts = id.split(".");
    for (let cut = parts.length - 1; cut >= 1; cut--) {
        const ancestor = nodes[parts.slice(0, cut).join(".")];
        if (!ancestor) continue;
        if (ancestor.capped) return null;
        return {
            id,
            bbox,
            depth: parts.length - 1,
            places: ancestor.places.filter(p => contains(bbox, world.places[p]!)),
            capped: false,
        };
    }
    return null;
}

/**
 * Name words the way Photon indexes them: lower-case, accents folded, split
 * on anything that is not a letter or digit.
 */
export function nameTokens(name: string): string[] {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/** True when a place name would match the search word: some name word starts with it. */
export function nameMatches(name: string, term: string): boolean {
    const wanted = nameTokens(term);
    if (wanted.length === 0) return false;
    const tokens = nameTokens(name);
    return wanted.every(w => tokens.some(t => t.startsWith(w)));
}

/** Every search word a name answers to in Photon: each prefix of each name word. */
export function namePrefixes(name: string): string[] {
    const keys = new Set<string>();
    for (const token of nameTokens(name)) {
        for (let length = 1; length <= token.length; length++) keys.add(token.slice(0, length));
    }
    return [...keys];
}
