/**
 * The place pool: Overpass first, the Photon sweep when Overpass does not
 * answer, and a store that lets a second run start where the first stopped.
 * The map servers are pretend ones (./map.fixture) that count every request.
 */
import { describe, expect, it } from "vitest";

import { createFakeMap, fakePopulation, type FakePlace } from "./map.fixture";
import {
    PLACE_POOL_VERSION,
    createMemoryPlacePoolStore,
    gatherPlacePool,
    placePoolKey,
    placesKnown,
    poolPlaces,
    type PlacePoolRequest,
    type PlacePoolState,
    type PlacePoolStore,
} from "./pool";
import { sweepPending } from "./sweep";
import type { HostThrottle } from "./throttle";

const request: PlacePoolRequest = {
    country: "NL",
    keywords: ["bicycle", "shop"],
    selectors: ['["shop"="bicycle"]'],
};
const idOf = (p: FakePlace) => `osm:${p.type === "N" ? "node" : "way"}/${p.id}`;
const withSite = (places: readonly FakePlace[]) =>
    places.filter(p => p.website ?? p.contactWebsite);

describe("Overpass first", () => {
    it("takes the whole population from one answered request and asks nothing else", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places);
        const store = createMemoryPlacePoolStore();
        const { state, report } = await gatherPlacePool(request, {
            store,
            sweepRequests: 64,
            fetchImpl: map.fetchImpl,
        });

        expect(map.calls).toEqual(["overpass overpass-api.de"]);
        expect(report).toMatchObject({
            asked: ["overpass"],
            complete: true,
            completedBy: "overpass",
            known: 700,
            withWebsite: withSite(places).length,
            requests: { overpass: 1, photon: 0, osmApi: 0 },
            pendingBoxes: 0,
        });
        expect(report.overpassAttempts).toEqual([
            expect.objectContaining({ host: "overpass-api.de", ok: true, detail: "700 elements" }),
        ]);
        // Every named place with the tag, positions and tags only, and time to answer.
        expect(map.overpassQueries[0]).toBe(
            '[out:json][timeout:90];\narea["ISO3166-1"="NL"]->.c;\n(\n  nwr(area.c)["shop"="bicycle"]["name"];\n);\nout tags center;'
        );
        // A site given as contact:website counts as a website.
        const viaContact = places.find(p => p.contactWebsite)!;
        expect(state.places[idOf(viaContact)]?.website).toBe(
            `https://place-${viaContact.id}.example/`
        );
    });

    it("answers a second run from the stored pool with no request at all", async () => {
        const map = createFakeMap(fakePopulation(300));
        const store = createMemoryPlacePoolStore();
        const first = await gatherPlacePool(request, {
            store,
            sweepRequests: 64,
            fetchImpl: map.fetchImpl,
        });
        const before = map.calls.length;
        const second = await gatherPlacePool(request, {
            store,
            sweepRequests: 64,
            fetchImpl: map.fetchImpl,
        });
        expect(map.calls.length).toBe(before);
        expect(second.report).toMatchObject({
            asked: [],
            complete: true,
            requests: { overpass: 0, photon: 0, osmApi: 0 },
        });
        expect(poolPlaces(second.state)).toEqual(poolPlaces(first.state));
    });

    it("tries the next instance when one is overloaded", async () => {
        const map = createFakeMap(fakePopulation(50), {
            overpassByHost: { "overpass-api.de": 504, "maps.mail.ru": 429 },
        });
        const { report } = await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            sweepRequests: 64,
            fetchImpl: map.fetchImpl,
        });
        expect(map.calls).toEqual([
            "overpass overpass-api.de",
            "overpass maps.mail.ru",
            "overpass overpass.kumi.systems",
        ]);
        expect(report.overpassAttempts.map(a => a.ok)).toEqual([false, false, true]);
        expect(report.complete).toBe(true);
        expect(map.count("photon")).toBe(0);
    });

    it("gives an instance that does not answer a time limit, then moves on", async () => {
        const places = fakePopulation(40);
        const map = createFakeMap(places);
        const hanging: typeof fetch = (input, init) => {
            const url =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (!url.includes("overpass-api.de")) return map.fetchImpl(input, init);
            map.calls.push("overpass overpass-api.de");
            return new Promise<Response>((_, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    const reason: unknown = init.signal?.reason;
                    reject(reason instanceof Error ? reason : new Error("aborted"));
                });
            });
        };
        const { report } = await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            sweepRequests: 0,
            fetchImpl: hanging,
            limits: { overpassTimeoutMs: 30 },
        });
        expect(report.overpassAttempts[0]).toMatchObject({
            host: "overpass-api.de",
            ok: false,
            detail: "no answer after 0 s",
        });
        expect(report.overpassAttempts[1]).toMatchObject({ host: "maps.mail.ru", ok: true });
        expect(report.complete).toBe(true);
    });

    it("does not take an answer the server cut short for the whole population", async () => {
        const places = fakePopulation(200);
        // Two instances run out of time and return half; the third answers in full.
        const map = createFakeMap(places, {
            overpassByHost: { "overpass-api.de": "cut", "maps.mail.ru": "cut" },
        });
        const { report } = await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            sweepRequests: 0,
            fetchImpl: map.fetchImpl,
        });
        expect(report.overpassAttempts.map(a => a.ok)).toEqual([false, false, true]);
        expect(report.overpassAttempts[0]!.detail).toMatch(/^Overpass remark: runtime error/);
        expect(report).toMatchObject({ complete: true, known: 200 });

        // Every instance cut short: the pool is not complete, and the sweep takes over.
        const allCut = createFakeMap(fakePopulation(700), { overpass: "cut" });
        const swept = await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            sweepRequests: 26,
            fetchImpl: allCut.fetchImpl,
        });
        expect(swept.report).toMatchObject({
            asked: ["overpass", "sweep"],
            complete: false,
            completedBy: null,
            requests: { overpass: 3, photon: 26 },
        });
        expect(swept.state.overpassAreas).toEqual([]);
    });

    it("asks a large country city by city and remembers the cities that answered", async () => {
        const berlin: FakePlace[] = fakePopulation(30, {
            country: "DE",
            box: [13.1, 52.3, 13.7, 52.7],
        });
        const map = createFakeMap(berlin);
        const store = createMemoryPlacePoolStore();
        // The first city answers, then the servers stop.
        let overpassCalls = 0;
        const flaky: typeof fetch = (input, init) => {
            const url =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.endsWith("/interpreter")) {
                overpassCalls += 1;
                if (overpassCalls > 1)
                    return Promise.resolve(new Response("busy", { status: 504 }));
            }
            return map.fetchImpl(input, init);
        };
        const de: PlacePoolRequest = { ...request, country: "DE" };
        const first = await gatherPlacePool(de, { store, sweepRequests: 0, fetchImpl: flaky });
        expect(first.state.overpassAreas).toEqual(["DE/Berlin"]);
        expect(first.report.complete).toBe(false);
        expect(first.report.known).toBe(30);
        // Berlin once, then Hamburg on each of the three instances.
        expect(overpassCalls).toBe(4);
        expect(decodeURIComponent(map.overpassQueries[0]!)).toContain('area["name"="Berlin"]');

        // Next run: Berlin is not asked again; the other three cities are.
        const second = await gatherPlacePool(de, {
            store,
            sweepRequests: 0,
            fetchImpl: map.fetchImpl,
        });
        expect(
            map.overpassQueries.slice(1).map(q => /area\["name"="([^"]+)"\]/.exec(q)?.[1])
        ).toEqual(["Hamburg", "Munich", "Cologne"]);
        expect(second.report).toMatchObject({ complete: true, completedBy: "overpass" });
    });
});

describe("the sweep, when Overpass does not answer", () => {
    it("sweeps Photon up to the cap, reads websites, and stores what is left to ask", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const { state, report } = await gatherPlacePool(request, {
            store,
            sweepRequests: 40,
            fetchImpl: map.fetchImpl,
        });

        // Order: Overpass (all three instances), then Photon, then the OSM API.
        expect(map.calls.slice(0, 3).every(c => c.startsWith("overpass "))).toBe(true);
        expect(map.calls.findIndex(c => c.startsWith("osmapi "))).toBeGreaterThan(
            map.calls.map(c => c.startsWith("photon ")).lastIndexOf(true)
        );
        expect(report).toMatchObject({
            asked: ["overpass", "sweep"],
            complete: false,
            sweepStopped: "cap",
            requests: { overpass: 3, photon: 40 },
        });
        expect(map.sweepUrls()).toHaveLength(40);
        expect(report.known).toBeGreaterThan(300);
        expect(report.known).toBeLessThan(700);
        expect(report.pendingBoxes).toBeGreaterThan(0);
        expect(state.unread).toEqual([]);
        // Every found place was looked up, 100 per request and type.
        expect(report.requests.osmApi).toBe(map.count("osmapi"));
        expect(report.withWebsite + state.without.length).toBe(report.known);
        // What the store holds is what the next run starts from.
        const stored = await store.load(placePoolKey(request));
        expect(stored && sweepPending(stored.sweep!)).toBe(report.pendingBoxes);
    });

    it("sends every Photon and OSM API request through its host's queue, and Overpass through none", async () => {
        const map = createFakeMap(fakePopulation(300), { overpass: 504 });
        const queued: string[] = [];
        const throttle: HostThrottle = (host, task) => {
            queued.push(host);
            return task();
        };
        await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            sweepRequests: 30,
            fetchImpl: map.fetchImpl,
            throttle,
        });
        expect(map.count("overpass")).toBe(3);
        expect(queued.filter(host => host === "photon.komoot.io")).toHaveLength(30);
        expect(queued.filter(host => host === "api.openstreetmap.org")).toHaveLength(
            map.count("osmapi")
        );
        expect(map.count("osmapi")).toBeGreaterThan(0);
        // An Overpass request can take a minute: runs do not wait in line for each other's.
        expect(new Set(queued)).toEqual(new Set(["photon.komoot.io", "api.openstreetmap.org"]));
    });

    it("carries on from the stored sweep on later runs, never repeating a request, until every place is known", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const knownAfter: number[] = [];
        let last = await gatherPlacePool(request, {
            store,
            sweepRequests: 40,
            fetchImpl: map.fetchImpl,
        });
        knownAfter.push(last.report.known);
        while (!last.report.complete) {
            last = await gatherPlacePool(request, {
                store,
                sweepRequests: 40,
                fetchImpl: map.fetchImpl,
            });
            knownAfter.push(last.report.known);
            expect(last.report.requests.photon).toBeLessThanOrEqual(40);
        }
        expect(knownAfter.length).toBeGreaterThan(2);
        // Each run knows more than the one before.
        expect([...knownAfter].sort((a, b) => a - b)).toEqual(knownAfter);
        expect(last.report).toMatchObject({ complete: true, completedBy: "sweep", known: 700 });
        expect(new Set(Object.keys(last.state.places))).toEqual(
            new Set(withSite(places).map(idOf))
        );
        // No Photon request and no tag lookup was ever sent twice.
        const sweep = map.sweepUrls();
        expect(new Set(sweep).size).toBe(sweep.length);
        const lookups = map.calls.filter(c => c.startsWith("osmapi "));
        const lookedUp = lookups.flatMap(c => new URL(c.slice(7)).search.split("=")[1]!.split(","));
        expect(new Set(lookedUp).size).toBe(lookedUp.length);

        // Complete: the next run asks no server at all.
        const before = map.calls.length;
        await gatherPlacePool(request, { store, sweepRequests: 40, fetchImpl: map.fetchImpl });
        expect(map.calls.length).toBe(before);
    });

    it("asks Overpass again on the next run while much of the sweep is left, and stops sweeping once it answers", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const first = await gatherPlacePool(request, {
            store,
            sweepRequests: 30,
            fetchImpl: map.fetchImpl,
        });
        expect(first.report.pendingBoxes).toBeGreaterThan(30);

        map.options.overpass = "answers";
        const photonBefore = map.count("photon");
        const second = await gatherPlacePool(request, {
            store,
            sweepRequests: 30,
            fetchImpl: map.fetchImpl,
        });
        expect(second.report).toMatchObject({
            asked: ["overpass"],
            complete: true,
            completedBy: "overpass",
            known: 700,
            pendingBoxes: 0,
        });
        expect(map.count("photon")).toBe(photonBefore);
        expect(second.state.sweep).toBeNull();
    });

    it("finishes a sweep that fits in this run's cap instead of waiting on Overpass again", async () => {
        const places = fakePopulation(700);
        // How many requests the whole sweep takes.
        const scratch = createFakeMap(places, { overpass: 504 });
        await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            sweepRequests: 10_000,
            fetchImpl: scratch.fetchImpl,
        });
        const whole = scratch.sweepUrls().length;

        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const first = await gatherPlacePool(request, {
            store,
            sweepRequests: whole - 12,
            fetchImpl: map.fetchImpl,
        });
        expect(first.report.complete).toBe(false);
        expect(first.report.pendingBoxes).toBeGreaterThan(0);
        expect(first.report.pendingBoxes).toBeLessThanOrEqual(12);
        const overpassBefore = map.count("overpass");
        const second = await gatherPlacePool(request, {
            store,
            sweepRequests: 64,
            fetchImpl: map.fetchImpl,
        });
        expect(map.count("overpass")).toBe(overpassBefore);
        expect(second.report).toMatchObject({
            asked: ["sweep"],
            complete: true,
            completedBy: "sweep",
            known: 700,
        });
        expect(map.sweepUrls()).toHaveLength(whole);
    });

    it("still sweeps when Overpass answers with nothing, and sweeps a region as a box around its centre", async () => {
        const hamburg = fakePopulation(80, { country: "DE", box: [9.8, 53.4, 10.2, 53.7] });
        const map = createFakeMap(hamburg, {
            overpass: "empty",
            cities: { Hamburg: { lon: 10.0, lat: 53.55, country: "DE" } },
        });
        const { report } = await gatherPlacePool(
            { ...request, country: "DE", region: "Hamburg" },
            { store: createMemoryPlacePoolStore(), sweepRequests: 200, fetchImpl: map.fetchImpl }
        );
        expect(report).toMatchObject({
            asked: ["overpass", "sweep"],
            complete: true,
            completedBy: "sweep",
            known: 80,
        });
        expect(new URL(map.sweepUrls()[0]!).searchParams.get("bbox")).toBe(
            "9.6500,53.3000,10.3500,53.8000"
        );
        // Placing the region on the map is one more Photon request, and it is counted.
        expect(map.count("photon")).toBe(map.sweepUrls().length + 1);
        expect(report.requests.photon).toBe(map.count("photon"));

        // …inside the cap: a cap of 10 is the lookup and nine boxes.
        const capped = createFakeMap(hamburg, {
            overpass: 504,
            cities: { Hamburg: { lon: 10.0, lat: 53.55, country: "DE" } },
        });
        const tight = await gatherPlacePool(
            { ...request, country: "DE", region: "Hamburg" },
            { store: createMemoryPlacePoolStore(), sweepRequests: 10, fetchImpl: capped.fetchImpl }
        );
        expect(capped.count("photon")).toBe(10);
        expect(tight.report.requests.photon).toBe(10);
    });

    it("reads a failed tag request once more on the next run, then finishes without those places", async () => {
        const places = fakePopulation(120);
        const map = createFakeMap(places, {
            overpass: 504,
            osmApiFails: url => url.includes("/ways.json"),
        });
        const store = createMemoryPlacePoolStore();
        const ways = places.filter(p => p.type === "W").length;
        const first = await gatherPlacePool(request, {
            store,
            sweepRequests: 500,
            fetchImpl: map.fetchImpl,
        });
        // Every box is asked, but the pool is not complete: some places are unread.
        expect(first.report).toMatchObject({
            sweepStopped: "complete",
            complete: false,
            known: 120,
        });
        expect(first.state.unread).toHaveLength(ways);

        const photonBefore = map.count("photon");
        const second = await gatherPlacePool(request, {
            store,
            sweepRequests: 500,
            fetchImpl: map.fetchImpl,
        });
        // No box is asked again; only the tags are.
        expect(map.count("photon")).toBe(photonBefore);
        expect(second.report).toMatchObject({ complete: true, completedBy: "sweep", known: 120 });
        expect(second.state.unread).toEqual([]);
        expect(Object.keys(second.state.places).every(id => id.startsWith("osm:node/"))).toBe(true);
    });

    it("loses no website when the OSM API is down for several runs", async () => {
        const places = fakePopulation(120);
        const map = createFakeMap(places, { overpass: 504, osmApiFails: () => 503 });
        const store = createMemoryPlacePoolStore();
        const deps = { store, sweepRequests: 500, fetchImpl: map.fetchImpl };
        for (let run = 1; run <= 3; run++) {
            const { state, report } = await gatherPlacePool(request, deps);
            expect(report).toMatchObject({ complete: false, known: 120, withWebsite: 0 });
            expect(state.unread).toHaveLength(120);
            expect(state.unread.some(hit => hit.tries)).toBe(false);
            expect(state.without).toEqual([]);
            // With the sweep done and reads failing, Overpass is asked again each run.
            expect(map.count("overpass")).toBe(3 * run);
        }
        // Every box was asked in the first run and never again.
        expect(new Set(map.sweepUrls()).size).toBe(map.sweepUrls().length);
        map.options.osmApiFails = undefined;
        const healed = await gatherPlacePool(request, deps);
        expect(healed.report).toMatchObject({ complete: true, completedBy: "sweep", known: 120 });
        expect(Object.keys(healed.state.places)).toHaveLength(withSite(places).length);
    });

    it("turns to Overpass again after Photon stopped answering, even with few boxes left", async () => {
        const places = fakePopulation(700);
        const scratch = createFakeMap(places, { overpass: 504 });
        await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            sweepRequests: 10_000,
            fetchImpl: scratch.fetchImpl,
        });
        const whole = scratch.sweepUrls().length;

        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const run = (sweepRequests: number) =>
            gatherPlacePool(request, { store, sweepRequests, fetchImpl: map.fetchImpl });
        await run(whole - 12);
        // Photon goes down. The few boxes left fit in a run, so Overpass is not asked first…
        map.options.photonFails = () => true;
        const overpassBefore = map.count("overpass");
        const failing = await run(64);
        expect(map.count("overpass")).toBe(overpassBefore);
        expect(failing.report).toMatchObject({ sweepStopped: "failing", complete: false });
        // …but once Photon has failed a run, the next one asks Overpass, which now answers.
        map.options.overpass = "answers";
        const through = await run(64);
        expect(through.report).toMatchObject({
            asked: ["overpass"],
            complete: true,
            completedBy: "overpass",
            known: 700,
        });
    });

    it("does not sweep without a tag to filter by, or when the cap is zero", async () => {
        const map = createFakeMap(fakePopulation(50), { overpass: 504 });
        const noTags = await gatherPlacePool(
            { country: "NL", keywords: ["fulfilment"], selectors: [] },
            { store: createMemoryPlacePoolStore(), sweepRequests: 64, fetchImpl: map.fetchImpl }
        );
        expect(noTags.report.asked).toEqual(["overpass"]);
        const capZero = await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            sweepRequests: 0,
            fetchImpl: map.fetchImpl,
        });
        expect(capZero.report.asked).toEqual(["overpass"]);
        expect(map.count("photon")).toBe(0);
    });
});

describe("keeping the pool", () => {
    it("fills a pool again once it is older than the limit, sooner when it is empty", async () => {
        const map = createFakeMap(fakePopulation(60));
        const store = createMemoryPlacePoolStore();
        let clock = Date.parse("2026-11-24T00:00:00Z");
        const deps = { store, sweepRequests: 0, fetchImpl: map.fetchImpl, now: () => clock };
        await gatherPlacePool(request, deps);
        clock += 29 * 24 * 60 * 60 * 1000;
        await gatherPlacePool(request, deps);
        expect(map.count("overpass")).toBe(1);
        clock += 2 * 24 * 60 * 60 * 1000;
        const refreshed = await gatherPlacePool(request, deps);
        expect(map.count("overpass")).toBe(2);
        expect(refreshed.state.startedAt).toBe(new Date(clock).toISOString());

        // An empty answer is asked again after a day, not a month.
        const empty = createFakeMap([], { overpass: "empty" });
        const emptyStore = createMemoryPlacePoolStore();
        const emptyDeps = {
            store: emptyStore,
            sweepRequests: 0,
            fetchImpl: empty.fetchImpl,
            now: () => clock,
        };
        await gatherPlacePool(request, emptyDeps);
        await gatherPlacePool(request, emptyDeps);
        expect(empty.count("overpass")).toBe(1);
        clock += 25 * 60 * 60 * 1000;
        await gatherPlacePool(request, emptyDeps);
        expect(empty.count("overpass")).toBe(2);
    });

    it("keeps one pool per territory, tag set and (inside a region) name words", () => {
        const key = placePoolKey(request);
        expect(key).toMatch(/^[0-9a-f]{64}$/);
        // Country-wide, the words do not change what is asked.
        expect(placePoolKey({ ...request, keywords: ["cycling"] })).toBe(key);
        expect(placePoolKey({ ...request, country: "nl" })).toBe(key);
        expect(placePoolKey({ ...request, country: "BE" })).not.toBe(key);
        expect(placePoolKey({ ...request, selectors: ['["craft"="brewery"]'] })).not.toBe(key);
        const utrecht = placePoolKey({ ...request, region: "Utrecht" });
        expect(utrecht).not.toBe(key);
        // Inside a region Overpass matches names too, so the words are part of the pool.
        expect(placePoolKey({ ...request, region: "Utrecht", keywords: ["cycling"] })).not.toBe(
            utrecht
        );
    });

    it("works without a working store: the search still answers", async () => {
        const map = createFakeMap(fakePopulation(40));
        const broken: PlacePoolStore = {
            load: () => Promise.reject(new Error("relation does not exist")),
            save: () => Promise.reject(new Error("relation does not exist")),
        };
        const { state, report } = await gatherPlacePool(request, {
            store: broken,
            sweepRequests: 64,
            fetchImpl: map.fetchImpl,
        });
        expect(report.complete).toBe(true);
        expect(poolPlaces(state).length).toBeGreaterThan(0);
    });

    it("ignores a stored pool written by another version", async () => {
        const map = createFakeMap(fakePopulation(40));
        const store = createMemoryPlacePoolStore();
        const { state } = await gatherPlacePool(request, {
            store,
            sweepRequests: 0,
            fetchImpl: map.fetchImpl,
        });
        await store.save(placePoolKey(request), { ...state, version: PLACE_POOL_VERSION + 1 });
        await gatherPlacePool(request, { store, sweepRequests: 0, fetchImpl: map.fetchImpl });
        expect(map.count("overpass")).toBe(2);
    });

    it("makes two runs for the same pool at the same moment share one set of requests", async () => {
        const map = createFakeMap(fakePopulation(200), { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const deps = { store, sweepRequests: 500, fetchImpl: map.fetchImpl };
        const [a, b] = await Promise.all([
            gatherPlacePool(request, deps),
            gatherPlacePool(request, deps),
        ]);
        expect(a.report.complete).toBe(true);
        expect(b.report).toMatchObject({ complete: true, asked: [], requests: { photon: 0 } });
        const sweep = map.sweepUrls();
        expect(new Set(sweep).size).toBe(sweep.length);
    });
});

describe("the pool as a list for ranking", () => {
    const place = (id: number, website: string | null) => ({
        id: `osm:node/${id}`,
        name: `Place ${id}`,
        website,
        address: "NL",
        lat: 52,
        lng: 5,
        categories: ["shop=bicycle"],
        country: "NL",
        city: null,
    });
    const pool = (places: ReturnType<typeof place>[]): PlacePoolState => ({
        version: PLACE_POOL_VERSION,
        country: "NL",
        region: null,
        selectors: [],
        places: Object.fromEntries(places.map(p => [p.id, p])),
        without: ["osm:node/9001"],
        unread: [],
        overpassAreas: [],
        sweep: null,
        complete: true,
        completedBy: "overpass",
        startedAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
        requests: { overpass: 1, photon: 0, osmApi: 0 },
    });

    it("lists one place per website", () => {
        const state = pool([
            place(1, "https://chain.example/"),
            place(2, "https://chain.example/"),
            place(3, "https://own.example/"),
        ]);
        expect(placesKnown(state)).toBe(4);
        const listed = poolPlaces(state);
        expect(listed.map(p => p.website).sort()).toEqual([
            "https://chain.example/",
            "https://own.example/",
        ]);
    });

    it("cuts a pool over the limit to a spread that does not follow id order, the same every time", () => {
        const state = pool(
            Array.from({ length: 500 }, (_, i) => place(i + 1, `https://p${i + 1}.example/`))
        );
        const cut = poolPlaces(state, 50);
        expect(cut).toHaveLength(50);
        expect(poolPlaces(state, 50)).toEqual(cut);
        const ids = cut.map(p => Number(p.id.split("/")[1]));
        // Not the first 50 by id: the cut reaches across the whole pool.
        expect(Math.max(...ids)).toBeGreaterThan(400);
        expect(ids.filter(id => id <= 250).length).toBeGreaterThan(10);
        expect(ids.filter(id => id > 250).length).toBeGreaterThan(10);
        // A larger limit keeps the smaller cut and adds to it.
        expect(poolPlaces(state, 80).slice(0, 50)).toEqual(cut);
    });
});
