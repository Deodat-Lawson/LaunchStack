/**
 * E1 against production: the keyless place search as the app calls it
 * (`createKeylessPorts().searchPlaces`), run offline against the recorded
 * servers of each segment.
 *
 * What is replayed, and how exactly:
 *  - Photon: by URL. Production's sweep must send requests that were
 *    recorded, byte for byte; one that was not is an error, never a live
 *    request. So the numbers are Photon's real answers, capped pages and all.
 *  - OSM API: by place. The recording looked the same places up in other
 *    groups of 100, so a request is answered with the recorded tags of the
 *    ids it names.
 *  - Overpass: the recorded answer to the same statement (every named place
 *    with the segment's tag in the country), or, to make the sweep run, an
 *    Overpass that is down.
 *
 * This module never opens a connection: the recorder is forced to replay.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { countryBox } from "../../../src/distribution/keyless/geo";
import { searchPhoton } from "../../../src/distribution/keyless/photon";
import {
    createMemoryPlacePoolStore,
    placePoolKey,
    type PlacePoolState,
    type PlacePoolStore,
} from "../../../src/distribution/keyless/pool";
import { createKeylessPorts } from "../../../src/distribution/keyless/ports";
import { newSweep, runSweep, type SweepHit } from "../../../src/distribution/keyless/sweep";
import { createHostThrottle } from "../../../src/distribution/keyless/throttle";
import { Recorder, type RecordedExchange } from "../lib/recorder";
import { round } from "../lib/stats";
import { SEGMENTS, type PlaceSegment } from "./segments";
import { loadWorld, type World } from "./world";

/** Photon request caps the sweep is measured at. */
export const BUDGETS = [16, 32, 64, 96] as const;
/** The cap one run gets in the resume check: production's default. */
export const RESUME_CAP = 64;
/** Shares of all places whose cost in requests is reported. */
const COVERAGE_MARKS = [0.5, 0.8, 0.9, 0.95] as const;

const OVERPASS_HOSTS = ["overpass-api.de", "overpass.kumi.systems", "maps.mail.ru"];
/** Recorded with these instance URLs and up to five rounds (see ./record.ts). */
const TRUTH_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const TRUTH_ROUNDS = 5;

const noWait = createHostThrottle({ gapMs: {} });
const urlOf = (input: RequestInfo | URL): string =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
const json = (body: string | object, status = 200) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

interface OsmElement {
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
}

/** Every element the recording read from the OSM API, by "node/123". */
function recordedElements(recorder: Recorder): Map<string, OsmElement> {
    const dir = path.join(recorder.dir, "api.openstreetmap.org");
    const elements = new Map<string, OsmElement>();
    for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json.gz")) continue;
        const exchange = JSON.parse(
            gunzipSync(readFileSync(path.join(dir, file))).toString("utf8")
        ) as RecordedExchange;
        if (exchange.status !== 200) continue;
        const body = JSON.parse(exchange.body) as { elements?: OsmElement[] };
        for (const el of body.elements ?? []) {
            // Place facts only: the recording also holds who edited each element.
            elements.set(`${el.type}/${el.id}`, {
                type: el.type,
                id: el.id,
                ...(el.lat !== undefined ? { lat: el.lat, lon: el.lon } : {}),
                tags: el.tags,
            });
        }
    }
    return elements;
}

/** The recorded Overpass answer for the segment: every named place with its tag in the country. */
function recordedTruthAnswer(segment: PlaceSegment, recorder: Recorder): string | null {
    for (let attempt = 0; attempt < TRUTH_ROUNDS; attempt++) {
        for (const url of TRUTH_URLS) {
            const query =
                `[out:json][timeout:90]; // attempt ${attempt}\n` +
                `area["ISO3166-1"="${segment.country}"]->.c;\n` +
                `nwr(area.c)${segment.selector}["name"];\nout tags center;`;
            const exchange = recorder.lookup(
                url,
                "POST",
                new URLSearchParams({ data: query }).toString()
            );
            if (exchange?.status !== 200) continue;
            const parsed = JSON.parse(exchange.body) as { elements?: unknown[]; remark?: string };
            if ((parsed.elements?.length ?? 0) > 0 && !parsed.remark) return exchange.body;
        }
    }
    return null;
}

export interface ReplayServer {
    fetchImpl: typeof fetch;
    /** Requests production sent, per kind. */
    sent: { photon: number; osmApi: number; overpass: number };
    /** Photon place-search URLs that were answered, in the order they were sent. */
    answeredPhotonUrls: string[];
    /** Photon requests the recorded server failed (a recorded 503 replays as one). */
    failedPhotonRequests: number;
}

export function createReplayServer(
    segment: PlaceSegment,
    recorder: Recorder,
    elements: ReadonlyMap<string, OsmElement>,
    overpass: "answers" | "down"
): ReplayServer {
    const truth = overpass === "answers" ? recordedTruthAnswer(segment, recorder) : null;
    const server: ReplayServer = {
        sent: { photon: 0, osmApi: 0, overpass: 0 },
        answeredPhotonUrls: [],
        failedPhotonRequests: 0,
        fetchImpl: async (input, init) => {
            const href = urlOf(input);
            const url = new URL(href);
            if (url.hostname === "photon.komoot.io") {
                server.sent.photon += 1;
                // Strict: throws NotRecordedError for a request the recording does not hold.
                const response = await recorder.fetchImpl(href, { method: "GET" });
                if (response.ok) server.answeredPhotonUrls.push(href);
                else server.failedPhotonRequests += 1;
                return response;
            }
            if (url.hostname === "api.openstreetmap.org") {
                server.sent.osmApi += 1;
                const type = /\/(node|way|relation)s\.json$/.exec(url.pathname)?.[1];
                const ids = (type ? url.searchParams.get(`${type}s`) : null)?.split(",") ?? [];
                if (!type || ids.length === 0 || ids.length > 100)
                    throw new Error(`Unexpected OSM API request: ${href}`);
                const found = ids.map(id => elements.get(`${type}/${id}`));
                const missing = ids.filter((_, i) => !found[i]);
                if (missing.length > 0)
                    throw new Error(`Not recorded: ${type} ${missing.slice(0, 5).join(", ")}`);
                return json({ elements: found });
            }
            if (OVERPASS_HOSTS.includes(url.hostname)) {
                server.sent.overpass += 1;
                if (overpass === "down") return new Response("<html>busy</html>", { status: 504 });
                const query =
                    init?.body instanceof URLSearchParams ? (init.body.get("data") ?? "") : "";
                // The recorded answer is served only to the statement it answers.
                const sameStatement =
                    query.includes(`area["ISO3166-1"="${segment.country}"]->.c;`) &&
                    query.includes(`nwr(area.c)${segment.selector}["name"];`) &&
                    query.trimEnd().endsWith("out tags center;") &&
                    (query.match(/nwr\(/g) ?? []).length === 1;
                if (!sameStatement || !truth)
                    throw new Error(`No recorded Overpass answer for this query:\n${query}`);
                return json(truth);
            }
            throw new Error(`Unexpected request in replay: ${href}`);
        },
    };
    return server;
}

const request = (segment: PlaceSegment) => ({
    country: segment.country,
    keywords: segment.keywords.join(" ").split(/\s+/).filter(Boolean),
    selectors: [segment.selector],
});

/** The app's own call: one place query for the segment's country, with the given sweep cap. */
async function searchOnce(
    segment: PlaceSegment,
    server: ReplayServer,
    store: PlacePoolStore,
    sweepRequests: number
): Promise<{ returned: number; state: PlacePoolState }> {
    const ports = createKeylessPorts({
        fetchImpl: server.fetchImpl,
        placePools: store,
        sweepRequestsPerRun: sweepRequests,
        throttle: noWait,
        // No cut: the question here is what the search knows.
        placesPerTerritory: Number.MAX_SAFE_INTEGER,
    });
    const places = await ports.searchPlaces!({
        query: segment.keywords.join(" "),
        categoryIds: [segment.selector],
        territory: { country: segment.country },
    });
    const state = await store.load(placePoolKey(request(segment)));
    if (!state) throw new Error("The search stored no pool");
    return { returned: places.length, state };
}

/** OSM ids as the benchmark writes them: "N123". */
const benchId = (id: string): string => {
    const [, type, number] = /^osm:(node|way|relation)\/(\d+)$/.exec(id) ?? [];
    return `${(type ?? "?")[0]!.toUpperCase()}${number}`;
};

function knownIds(state: PlacePoolState): Set<string> {
    const ids = new Set<string>(state.without.map(benchId));
    for (const id of Object.keys(state.places)) ids.add(benchId(id));
    for (const hit of state.unread) ids.add(benchId(hit.id));
    return ids;
}

function shares(state: PlacePoolState, world: World) {
    const all = new Set(world.truth?.all ?? []);
    const withWebsite = new Set(world.truth?.withWebsite ?? []);
    const known = knownIds(state);
    const sites = new Set(Object.keys(state.places).map(benchId));
    const count = (ids: Set<string>, of: Set<string>) => [...ids].filter(id => of.has(id)).length;
    return {
        /** Places the search knows, with or without a website. */
        known: known.size,
        /** Of all named places Overpass lists for the segment, the share it knows. */
        knownShare: round(count(known, all) / all.size, 3),
        withWebsite: sites.size,
        withWebsiteShare: round(count(sites, withWebsite) / withWebsite.size, 3),
    };
}

/** Today's first step, `searchPhoton`, unchanged, replayed request by request. */
async function replayToday(segment: PlaceSegment, recorder: Recorder) {
    let photonRequests = 0;
    let osmApiRequests = 0;
    const counting: typeof fetch = (input, init) => {
        if (urlOf(input).startsWith("https://photon.komoot.io/")) photonRequests += 1;
        else osmApiRequests += 1;
        return recorder.fetchImpl(input, init);
    };
    const kept = await searchPhoton(
        { ...request(segment), region: null, limit: 40 },
        { fetchImpl: counting }
    );
    const [key, value] = segment.tag.split(":");
    return {
        photonRequests,
        osmApiRequests,
        placesKept: kept.length,
        onTargetWithWebsite: kept.filter(p => p.categories.includes(`${key}=${value}`)).length,
    };
}

/** Places known after each Photon request of a sweep with no request cap. */
async function sweepCurve(segment: PlaceSegment, world: World, server: ReplayServer) {
    const box = countryBox(segment.country);
    if (!box) throw new Error(`No sweep box for ${segment.country}`);
    const all = new Set(world.truth?.all ?? []);
    const state = newSweep(box, [segment.tag]);
    const known = new Set<string>();
    // curve[i] = places known after i + 1 requests: read as each next request starts.
    const curve: number[] = [];
    let started = 0;
    const counting: typeof fetch = (input, init) => {
        if (started > 0) curve.push(known.size);
        started += 1;
        return server.fetchImpl(input, init);
    };
    for (let run = 0; run < 10; run++) {
        const result = await runSweep(state, {
            country: segment.country,
            maxRequests: Number.MAX_SAFE_INTEGER,
            fetchImpl: counting,
            onHits: (hits: SweepHit[]) => {
                for (const hit of hits) {
                    const id = benchId(hit.id);
                    if (all.has(id)) known.add(id);
                }
            },
        });
        // "deferred": a box failed and is asked once more on the next run.
        if (result.stopped !== "deferred") break;
    }
    curve.push(known.size);
    const requestsTo = Object.fromEntries(
        COVERAGE_MARKS.map(mark => {
            const at = curve.findIndex(found => found / all.size >= mark);
            return [`${Math.round(mark * 100)}%`, at === -1 ? null : at + 1];
        })
    );
    return { requests: curve.length, requestsTo, cutOff: state.cutOff, dropped: state.dropped };
}

async function replaySegment(segment: PlaceSegment, world: World, recorder: Recorder) {
    const elements = recordedElements(recorder);
    const today = await replayToday(segment, recorder);

    // Overpass answers: one request, the whole population.
    const answering = createReplayServer(segment, recorder, elements, "answers");
    const overpassStore = createMemoryPlacePoolStore();
    const first = await searchOnce(segment, answering, overpassStore, RESUME_CAP);
    const afterFirst = { ...answering.sent };
    const again = await searchOnce(segment, answering, overpassStore, RESUME_CAP);
    const overpassFirst = {
        requests: afterFirst,
        ...shares(first.state, world),
        /** What the search hands to ranking: one place per website. */
        placesReturned: first.returned,
        complete: first.state.complete,
        secondRun: {
            requests: {
                photon: answering.sent.photon - afterFirst.photon,
                osmApi: answering.sent.osmApi - afterFirst.osmApi,
                overpass: answering.sent.overpass - afterFirst.overpass,
            },
            placesReturned: again.returned,
        },
    };

    // Overpass down: the sweep, from nothing, at each request cap.
    const budgets = [...new Set([today.photonRequests, ...BUDGETS])].sort((a, b) => a - b);
    const atBudget: Record<string, ReturnType<typeof shares> & Record<string, number>> = {};
    for (const budget of budgets) {
        const down = createReplayServer(segment, recorder, elements, "down");
        const { returned, state } = await searchOnce(
            segment,
            down,
            createMemoryPlacePoolStore(),
            budget
        );
        if (down.sent.photon > budget) throw new Error("The sweep went over its cap");
        atBudget[String(budget)] = {
            photonRequests: down.sent.photon,
            osmApiRequests: down.sent.osmApi,
            ...shares(state, world),
            placesReturned: returned,
        };
    }

    // Run after run at the default cap until nothing is left to ask.
    const resuming = createReplayServer(segment, recorder, elements, "down");
    const store = createMemoryPlacePoolStore();
    const knownAfterRun: number[] = [];
    let last = await searchOnce(segment, resuming, store, RESUME_CAP);
    knownAfterRun.push(shares(last.state, world).known);
    while (!last.state.complete && knownAfterRun.length < 50) {
        last = await searchOnce(segment, resuming, store, RESUME_CAP);
        knownAfterRun.push(shares(last.state, world).known);
    }
    const sentBeforeExtraRun = { ...resuming.sent };
    await searchOnce(segment, resuming, store, RESUME_CAP);
    const curve = await sweepCurve(
        segment,
        world,
        createReplayServer(segment, recorder, elements, "down")
    );
    const resume = {
        capPerRun: RESUME_CAP,
        runsToComplete: knownAfterRun.length,
        knownAfterRun,
        photonRequests: sentBeforeExtraRun.photon,
        osmApiRequests: sentBeforeExtraRun.osmApi,
        /** Answered requests that were sent again on a later run: must be 0. */
        repeatedPhotonRequests:
            resuming.answeredPhotonUrls.length - new Set(resuming.answeredPhotonUrls).size,
        /** Requests the recorded server failed; each is asked once more on the next run. */
        failedPhotonRequests: resuming.failedPhotonRequests,
        /** One uninterrupted sweep sends this many: stopping and resuming must cost the same. */
        photonRequestsInOneRun: curve.requests,
        /** Requests a run sends once the pool is complete: must be 0. */
        requestsAfterComplete:
            resuming.sent.photon +
            resuming.sent.osmApi +
            resuming.sent.overpass -
            (sentBeforeExtraRun.photon + sentBeforeExtraRun.osmApi + sentBeforeExtraRun.overpass),
        complete: last.state.complete,
        ...shares(last.state, world),
        placesReturned: last.returned,
        boxesCutOffAtDepthLimit: curve.cutOff,
        boxesGivenUp: curve.dropped,
    };

    return {
        id: segment.id,
        label: segment.label,
        category: segment.tag,
        population: {
            /** Named places with the category in the country, from Overpass. */
            overpassNamed: world.truth?.all.length ?? 0,
            overpassWithWebsite: world.truth?.withWebsite.length ?? 0,
        },
        /** Today's first step (`searchPhoton`, unchanged), replayed. */
        today,
        /** Today's whole search, one live sample recorded 2026-11-24 (old order: Photon, Overpass, Nominatim). */
        todayWholeSearch: world.productionFull
            ? { kept: world.productionFull.kept, onTarget: world.productionFull.keptOnTarget }
            : null,
        overpassFirst,
        sweep: { atBudget, requestsToKnow: curve.requestsTo, resume },
    };
}

export type SegmentReplay = Awaited<ReturnType<typeof replaySegment>>;

export interface ProductionReplay {
    experiment: "e1-production-sweep";
    question: string;
    costModel: string;
    budgets: readonly number[];
    segments: SegmentReplay[];
    overall: {
        /** Mean over segments of the share of all places known, per request cap. */
        knownShareAt: Record<string, number>;
        withWebsiteShareAt: Record<string, number>;
        todayFirstStepWithWebsiteShare: number;
        todayWholeSearchWithWebsiteShare: number;
    };
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Replays every recorded segment. Returns null when this machine has no recordings. */
export async function replayProduction(): Promise<ProductionReplay | null> {
    const recorder = new Recorder({ namespace: "e1", mode: "replay" });
    const segments: SegmentReplay[] = [];
    for (const segment of SEGMENTS) {
        const world = loadWorld(segment.id);
        if (!world?.truth) return null;
        segments.push(await replaySegment(segment, world, recorder));
    }
    return {
        experiment: "e1-production-sweep",
        question:
            "What does production's keyless place search return for each recorded segment: when Overpass answers, and when it does not and Photon is swept under a request cap?",
        costModel:
            "A cap counts Photon requests. Reading websites costs one OSM API request per 100 places found, reported beside it. Shares are of the named places Overpass lists for the segment.",
        budgets: BUDGETS,
        segments,
        overall: {
            knownShareAt: Object.fromEntries(
                BUDGETS.map(b => [
                    b,
                    round(mean(segments.map(s => s.sweep.atBudget[String(b)]!.knownShare)), 3),
                ])
            ),
            withWebsiteShareAt: Object.fromEntries(
                BUDGETS.map(b => [
                    b,
                    round(
                        mean(segments.map(s => s.sweep.atBudget[String(b)]!.withWebsiteShare)),
                        3
                    ),
                ])
            ),
            todayFirstStepWithWebsiteShare: round(
                mean(
                    segments.map(
                        s => s.today.onTargetWithWebsite / s.population.overpassWithWebsite
                    )
                ),
                4
            ),
            todayWholeSearchWithWebsiteShare: round(
                mean(
                    segments.map(
                        s => (s.todayWholeSearch?.onTarget ?? 0) / s.population.overpassWithWebsite
                    )
                ),
                4
            ),
        },
    };
}

export function printReplay(replay: ProductionReplay): void {
    const pct = (share: number) => `${Math.round(share * 100)}%`;
    for (const s of replay.segments) {
        console.log(
            `\n== ${s.label}: ${s.population.overpassNamed} named places, ${s.population.overpassWithWebsite} with a website`
        );
        console.log(
            `   today, first step:   ${s.today.photonRequests} Photon requests -> ${s.today.onTargetWithWebsite} on-target places with a website (kept ${s.today.placesKept})`
        );
        if (s.todayWholeSearch)
            console.log(
                `   today, whole search: kept ${s.todayWholeSearch.kept}, ${s.todayWholeSearch.onTarget} on target (one live sample)`
            );
        const o = s.overpassFirst;
        console.log(
            `   new, Overpass answers: ${o.requests.overpass} request -> ${o.known} known (${pct(o.knownShare)}), ${o.withWebsite} with a website, ${o.placesReturned} handed to ranking; second run: ${o.secondRun.requests.overpass + o.secondRun.requests.photon + o.secondRun.requests.osmApi} requests`
        );
        console.log("   new, Overpass down (Photon sweep):");
        for (const [budget, at] of Object.entries(s.sweep.atBudget))
            console.log(
                `     ${budget.padStart(3)} requests -> ${String(at.known).padStart(5)} known (${pct(at.knownShare).padStart(4)}), ${String(at.withWebsite).padStart(5)} with a website (${pct(at.withWebsiteShare).padStart(4)}), +${at.osmApiRequests} tag lookups`
            );
        const r = s.sweep.resume;
        console.log(
            `     runs of ${r.capPerRun}: complete after ${r.runsToComplete} runs and ${r.photonRequests} requests (${r.failedPhotonRequests} failed); answered requests sent again ${r.repeatedPhotonRequests}; known per run ${r.knownAfterRun.join(", ")}; requests to know 95%: ${s.sweep.requestsToKnow["95%"] ?? "not reached"}`
        );
    }
    console.log("\nmean over segments, share of all places known when sweeping:");
    console.log("  ", JSON.stringify(replay.overall));
}
