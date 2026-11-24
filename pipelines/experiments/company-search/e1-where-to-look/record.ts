/**
 * E1 recording: builds the world each policy is replayed against.
 *
 *   COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e1-where-to-look/record.ts [segment-id ...]
 *
 * Per segment:
 *  1. production's own `searchPhoton`, unchanged, through the recorder;
 *  2. for every search word a policy could ask (the words known up front,
 *     the letters a to z, and the words that occur in found places' names),
 *     a quadtree sweep of Photon from the country box down, splitting every
 *     box that came back full;
 *  3. the OSM tags of every place found (who has a website);
 *  4. the true population from Overpass, with every attempt logged, since
 *     the public mirrors are often at capacity.
 *
 * Words are taken from names the sweeps themselves found, never from the
 * Overpass truth, so the recorded world holds nothing a policy could not
 * have reached.
 */
import { nativeTermsFor } from "../../../src/distribution/keyless/geo";
import { createKeylessPorts } from "../../../src/distribution/keyless/ports";
import { searchPhoton } from "../../../src/distribution/keyless/photon";
import { Recorder } from "../lib/recorder";
import { SEGMENTS, type Bbox, type PlaceSegment } from "./segments";
import {
    PHOTON_CAP,
    childBboxes,
    loadWorld,
    nameTokens,
    photonUrl,
    saveWorld,
    type NodeAnswer,
    type Place,
    type World,
} from "./world";

const MAX_DEPTH = 8;
/** Mined words recorded per round, most frequent first. */
const MINED_PER_ROUND = [70, 30];
/**
 * In a large population every frequent word has a deep quadtree, so fewer
 * mined words are recorded there: this keeps the load on the public Photon
 * server modest. Policies can only ask words that were recorded.
 */
const LARGE_POPULATION = 1_500;
const MINED_PER_ROUND_LARGE = [20];
/** A word must occur in at least this many found names to be recorded. */
const MIN_NAME_COUNT = 3;
const OSM_API_URL = "https://api.openstreetmap.org/api/0.6";
const OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const OVERPASS_ROUNDS = 5;
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

interface PhotonFeature {
    geometry?: { coordinates?: [number, number] };
    properties: {
        osm_type?: "N" | "W" | "R";
        osm_id?: number;
        name?: string;
        countrycode?: string;
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function websiteOf(tags: Record<string, string> | undefined): string | null {
    const raw = tags?.website ?? tags?.["contact:website"];
    if (!raw) return null;
    try {
        const first = raw.split(/[;\s]+/)[0]!;
        const url = new URL(/^https?:\/\//i.test(first) ? first : `https://${first}`);
        return url.hostname.includes(".") ? url.href : null;
    } catch {
        return null;
    }
}

function inCountryPlaces(features: PhotonFeature[], country: string): Place[] {
    const out: Place[] = [];
    for (const f of features) {
        const p = f.properties;
        const coords = f.geometry?.coordinates;
        if (!p.osm_id || !p.osm_type || !p.name || !coords) continue;
        if ((p.countrycode ?? "").toUpperCase() !== country) continue;
        out.push({ id: `${p.osm_type}${p.osm_id}`, name: p.name, lon: coords[0], lat: coords[1] });
    }
    return out;
}

/** The whole quadtree for one search word. */
async function sweep(
    segment: PlaceSegment,
    term: string,
    recorder: Recorder,
    places: Record<string, Place>
): Promise<{ nodes: Record<string, NodeAnswer>; requests: number }> {
    const nodes: Record<string, NodeAnswer> = {};
    let requests = 0;
    const queue: Array<{ id: string; bbox: Bbox; depth: number }> = [
        { id: "r", bbox: segment.bbox, depth: 0 },
    ];
    while (queue.length > 0) {
        const node = queue.shift()!;
        let features: PhotonFeature[];
        try {
            features = (
                await recorder.getJson<{ features: PhotonFeature[] }>(
                    photonUrl(segment, term, node.bbox)
                )
            ).features;
        } catch (error) {
            console.warn(`  photon failed for "${term}" ${node.id}: ${String(error)}`);
            features = [];
        }
        requests += 1;
        const found = inCountryPlaces(features, segment.country);
        for (const p of found) places[p.id] ??= p;
        const capped = features.length >= PHOTON_CAP;
        nodes[node.id] = {
            id: node.id,
            bbox: node.bbox,
            depth: node.depth,
            places: found.map(p => p.id),
            capped,
        };
        if (capped && node.depth < MAX_DEPTH) {
            for (const [i, bbox] of childBboxes(node.bbox).entries())
                queue.push({ id: `${node.id}.${i}`, bbox, depth: node.depth + 1 });
        }
    }
    return { nodes, requests };
}

/** Words in found names, most frequent first, that are not recorded yet. */
function minedTerms(
    places: Record<string, Place>,
    recorded: ReadonlySet<string>,
    max: number
): string[] {
    const counts = new Map<string, number>();
    for (const place of Object.values(places)) {
        for (const token of new Set(nameTokens(place.name))) {
            if (token.length < 3 || /^\d+$/.test(token)) continue;
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .filter(([token, count]) => count >= MIN_NAME_COUNT && !recorded.has(token))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, max)
        .map(([token]) => token);
}

async function fetchWebsites(ids: readonly string[], recorder: Recorder): Promise<string[]> {
    const byType: Record<"node" | "way" | "relation", string[]> = {
        node: [],
        way: [],
        relation: [],
    };
    for (const id of ids) {
        const type = id.startsWith("N") ? "node" : id.startsWith("W") ? "way" : "relation";
        byType[type].push(id.slice(1));
    }
    const withWebsite: string[] = [];
    for (const type of ["node", "way", "relation"] as const) {
        const list = byType[type];
        for (let i = 0; i < list.length; i += 100) {
            const chunk = list.slice(i, i + 100);
            try {
                const json = await recorder.getJson<{
                    elements: Array<{ type: string; id: number; tags?: Record<string, string> }>;
                }>(`${OSM_API_URL}/${type}s.json?${type}s=${chunk.join(",")}`);
                for (const el of json.elements) {
                    if (websiteOf(el.tags) && el.tags?.name)
                        withWebsite.push(`${type[0]!.toUpperCase()}${el.id}`);
                }
            } catch (error) {
                console.warn(
                    `  osm api chunk failed (${type}, ${chunk.length} ids):`,
                    String(error)
                );
            }
        }
    }
    return withWebsite;
}

/** Production's keyless place search, exactly as the app calls it. */
async function runProduction(
    segment: PlaceSegment,
    recorder: Recorder
): Promise<World["production"]> {
    let photonRequests = 0;
    let osmApiRequests = 0;
    const counting: typeof fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://photon.komoot.io/")) photonRequests += 1;
        else osmApiRequests += 1;
        return recorder.fetchImpl(input, init);
    };
    // keyless/ports.ts splits the planned query on whitespace before calling searchPhoton.
    const keywords = segment.keywords.join(" ").split(/\s+/).filter(Boolean);
    const kept = await searchPhoton(
        {
            country: segment.country,
            region: null,
            keywords,
            selectors: [segment.selector],
            limit: 40,
        },
        { fetchImpl: counting }
    );
    const [key, value] = segment.tag.split(":");
    const onTarget = kept.filter(p => p.categories.includes(`${key}=${value}`));
    return {
        photonRequests,
        osmApiRequests,
        kept: kept.length,
        keptOnTarget: onTarget.map(p => {
            const [type, id] = p.id.replace("osm:", "").split("/");
            return `${type![0]!.toUpperCase()}${id}`;
        }),
    };
}

/** Production's whole keyless place search, as the pipeline calls it for a country segment. */
async function runProductionFull(
    segment: PlaceSegment,
    recorder: Recorder
): Promise<NonNullable<World["productionFull"]>> {
    const requestsByHost: Record<string, number> = {};
    const failedByHost: Record<string, number> = {};
    const counting: typeof fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const host = new URL(url).hostname;
        requestsByHost[host] = (requestsByHost[host] ?? 0) + 1;
        try {
            const response = await recorder.fetchImpl(input, init);
            if (!response.ok) failedByHost[host] = (failedByHost[host] ?? 0) + 1;
            return response;
        } catch (error) {
            failedByHost[host] = (failedByHost[host] ?? 0) + 1;
            throw error;
        }
    };
    const ports = createKeylessPorts({ fetchImpl: counting });
    const [key, value] = segment.tag.split(":");
    try {
        const places = await ports.searchPlaces!({
            query: segment.keywords.join(" "),
            categoryIds: [segment.selector],
            territory: { country: segment.country },
        });
        return {
            requestsByHost,
            failedByHost,
            kept: places.length,
            keptOnTarget: places.filter(p => p.categories.some(c => c.id === `${key}=${value}`))
                .length,
            error: null,
        };
    } catch (error) {
        return {
            requestsByHost,
            failedByHost,
            kept: 0,
            keptOnTarget: 0,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function fetchTruth(segment: PlaceSegment, recorder: Recorder): Promise<World["truth"]> {
    const attempts: NonNullable<World["truth"]>["attempts"] = [];
    for (let round = 0; round < OVERPASS_ROUNDS; round++) {
        for (const url of OVERPASS_MIRRORS) {
            const query =
                `[out:json][timeout:90]; // attempt ${round}\n` +
                `area["ISO3166-1"="${segment.country}"]->.c;\n` +
                `nwr(area.c)${segment.selector}["name"];\nout tags center;`;
            const exchange = await recorder.exchange(url, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ data: query }),
            });
            const host = new URL(url).hostname;
            if (exchange.status !== 200) {
                attempts.push({
                    host,
                    ok: false,
                    ms: exchange.ms,
                    detail: exchange.error ?? `HTTP ${exchange.status}`,
                });
                continue;
            }
            let json: {
                elements?: Array<{ type: string; id: number; tags?: Record<string, string> }>;
                remark?: string;
            };
            try {
                json = JSON.parse(exchange.body) as typeof json;
            } catch {
                attempts.push({ host, ok: false, ms: exchange.ms, detail: "unparseable body" });
                continue;
            }
            const elements = json.elements ?? [];
            if (elements.length === 0 || (json.remark && /timed out|error/i.test(json.remark))) {
                attempts.push({
                    host,
                    ok: false,
                    ms: exchange.ms,
                    detail: json.remark?.slice(0, 80) ?? "no elements",
                });
                continue;
            }
            attempts.push({
                host,
                ok: true,
                ms: exchange.ms,
                detail: `${elements.length} elements`,
            });
            const all: string[] = [];
            const withWebsite: string[] = [];
            for (const el of elements) {
                const id = `${el.type[0]!.toUpperCase()}${el.id}`;
                all.push(id);
                if (websiteOf(el.tags)) withWebsite.push(id);
            }
            return { all, withWebsite, attempts };
        }
        if (recorder.mode === "record") await sleep(20_000);
    }
    console.warn(`  overpass: no mirror answered for ${segment.id}`);
    return { all: [], withWebsite: [], attempts };
}

async function main(): Promise<void> {
    const wanted = process.argv.slice(2);
    const segments = wanted.length > 0 ? SEGMENTS.filter(s => wanted.includes(s.id)) : SEGMENTS;
    const recorder = new Recorder({
        namespace: "e1",
        timeoutMs: 120_000,
        hostDelayMs: {
            "photon.komoot.io": 1_100,
            "api.openstreetmap.org": 1_500,
            "nominatim.openstreetmap.org": 1_600,
        },
        minDelayMs: 3_000,
    });
    for (const segment of segments) {
        console.log(`\n== ${segment.id} (${segment.label})`);
        const production = await runProduction(segment, recorder);
        console.log(
            `  production: ${production.photonRequests} photon + ${production.osmApiRequests} osm-api requests, kept ${production.kept} (${production.keptOnTarget.length} on target)`
        );

        const productionFull = await runProductionFull(segment, recorder);
        console.log(
            `  production, whole place search: kept ${productionFull.kept} (${productionFull.keptOnTarget} on target); requests ${JSON.stringify(productionFull.requestsByHost)}; failed ${JSON.stringify(productionFull.failedByHost)}${productionFull.error ? `; error: ${productionFull.error}` : ""}`
        );

        const places: Record<string, Place> = {};
        const sweeps: World["sweeps"] = {};
        let photonRequests = 0;
        const run = async (terms: readonly string[]): Promise<void> => {
            for (const term of terms) {
                if (sweeps[term]) continue;
                const swept = await sweep(segment, term, recorder, places);
                sweeps[term] = swept.nodes;
                photonRequests += swept.requests;
            }
        };
        const keywords = segment.keywords.join(" ").split(/\s+/).filter(Boolean);
        const plan = [
            ...new Set(
                [segment.q, ...keywords, ...nativeTermsFor(keywords)].map(t => t.toLowerCase())
            ),
        ];
        await run(plan);
        await run(LETTERS);
        console.log(
            `  plan + letters: ${photonRequests} requests, ${Object.keys(places).length} places`
        );
        const mined: string[] = [];
        const rounds =
            Object.keys(places).length > LARGE_POPULATION ? MINED_PER_ROUND_LARGE : MINED_PER_ROUND;
        for (const max of rounds) {
            const next = minedTerms(places, new Set(Object.keys(sweeps)), max);
            await run(next);
            mined.push(...next);
            console.log(
                `  + ${next.length} mined words: ${photonRequests} requests, ${Object.keys(places).length} places`
            );
        }

        const withWebsite = await fetchWebsites(Object.keys(places), recorder);
        console.log(`  with a website: ${withWebsite.length} of ${Object.keys(places).length}`);
        const previous = loadWorld(segment.id);
        const truth =
            previous?.truth && previous.truth.all.length > 0
                ? previous.truth
                : await fetchTruth(segment, recorder);
        console.log(
            `  overpass truth: ${truth?.all.length ?? 0} named places, ${truth?.withWebsite.length ?? 0} with a website (${truth?.attempts.filter(a => a.ok).length ?? 0}/${truth?.attempts.length ?? 0} attempts answered)`
        );
        saveWorld({
            segment,
            sweeps,
            terms: { plan, letters: LETTERS, mined },
            places,
            withWebsite,
            production,
            productionFull,
            truth,
            photonRequests,
        });
    }
    console.log(`\nlive requests: ${recorder.live}, replayed: ${recorder.replayed}`);
}

await main();
