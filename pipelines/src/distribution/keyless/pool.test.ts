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
const DE_BOX = [5.85, 47.25, 15.05, 55.1] as const;
const idOf = (p: FakePlace) => `osm:${p.type === "N" ? "node" : "way"}/${p.id}`;
const withSite = (places: readonly FakePlace[]) =>
    places.filter(p => p.website ?? p.contactWebsite);
const hostOf = (input: Parameters<typeof fetch>[0]) =>
    new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
        .hostname;

/** How many Photon requests a whole sweep of these places takes. */
async function wholeSweep(places: readonly FakePlace[], poolRequest = request): Promise<number> {
    const scratch = createFakeMap(places, { overpass: 504 });
    await gatherPlacePool(poolRequest, {
        store: createMemoryPlacePoolStore(),
        photonRequests: 100_000,
        fetchImpl: scratch.fetchImpl,
    });
    return scratch.sweepUrls().length;
}

describe("Overpass first", () => {
    it("takes the whole population from one answered request and asks nothing else", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places);
        const store = createMemoryPlacePoolStore();
        const { state, report } = await gatherPlacePool(request, {
            store,
            photonRequests: 64,
            fetchImpl: map.fetchImpl,
        });

        expect(map.calls).toEqual(["overpass overpass-api.de"]);
        expect(report).toMatchObject({
            asked: ["overpass"],
            complete: true,
            completedBy: "overpass",
            known: 700,
            withWebsite: withSite(places).length,
            requests: { overpass: 1, photon: 0, osmApi: 0, nominatim: 0 },
            pendingBoxes: 0,
            problems: [],
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
        const deps = { store, photonRequests: 64, fetchImpl: map.fetchImpl };
        const first = await gatherPlacePool(request, deps);
        const before = map.calls.length;
        const second = await gatherPlacePool(request, deps);
        expect(map.calls.length).toBe(before);
        expect(second.report).toMatchObject({
            asked: [],
            complete: true,
            requests: { overpass: 0, photon: 0, osmApi: 0, nominatim: 0 },
        });
        expect(poolPlaces(second.state)).toEqual(poolPlaces(first.state));
    });

    it("tries the next instance when one is overloaded", async () => {
        const map = createFakeMap(fakePopulation(50), {
            overpassByHost: { "overpass-api.de": 504, "maps.mail.ru": 429 },
        });
        const { report } = await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            photonRequests: 64,
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
            if (hostOf(input) !== "overpass-api.de") return map.fetchImpl(input, init);
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
            photonRequests: 0,
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
            photonRequests: 0,
            fetchImpl: map.fetchImpl,
        });
        expect(report.overpassAttempts.map(a => a.ok)).toEqual([false, false, true]);
        expect(report.overpassAttempts[0]!.detail).toMatch(/^Overpass remark: runtime error/);
        expect(report).toMatchObject({ complete: true, known: 200 });

        // Every instance cut short: the pool is not complete, and the sweep takes over.
        const allCut = createFakeMap(fakePopulation(700), { overpass: "cut" });
        const swept = await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            photonRequests: 26,
            fetchImpl: allCut.fetchImpl,
        });
        expect(swept.report).toMatchObject({
            asked: ["overpass", "sweep"],
            complete: false,
            completedBy: null,
            requests: { overpass: 3, photon: 26 },
        });
        expect(swept.state.overpassAnswered).toBe(false);
        expect(swept.report.problems[0]).toMatch(/^Overpass did not answer \(overpass-api\.de: /);
    });

    it("does not ask Overpass for a country too large for one request: it is swept, whole", async () => {
        const places = fakePopulation(700, { country: "DE", box: DE_BOX });
        const de: PlacePoolRequest = { ...request, country: "DE" };
        const whole = await wholeSweep(places, de);
        const map = createFakeMap(places);
        const store = createMemoryPlacePoolStore();
        const run = () =>
            gatherPlacePool(de, { store, photonRequests: 64, fetchImpl: map.fetchImpl });

        const first = await run();
        // Four city answers would not be the country: Overpass is left alone.
        expect(map.count("overpass")).toBe(0);
        expect(first.report).toMatchObject({ asked: ["sweep"], complete: false });
        expect(new URL(map.sweepUrls()[0]!).searchParams.get("bbox")).toBe(
            "5.8500,47.2500,15.0500,55.1000"
        );
        let last = first;
        while (!last.report.complete) last = await run();
        // Complete means the whole country was swept, not its largest cities.
        expect(last.report).toMatchObject({ completedBy: "sweep", known: 700 });
        expect(map.sweepUrls()).toHaveLength(whole);
        expect(map.count("overpass")).toBe(0);
    });
});

describe("the sweep, when Overpass does not answer", () => {
    it("sweeps Photon up to the cap, reads websites, and stores what is left to ask", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const { state, report } = await gatherPlacePool(request, {
            store,
            photonRequests: 40,
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
            unread: 0,
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
            photonRequests: 30,
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
        const deps = { store, photonRequests: 40, fetchImpl: map.fetchImpl };
        const knownAfter: number[] = [];
        let last = await gatherPlacePool(request, deps);
        knownAfter.push(last.report.known);
        while (!last.report.complete) {
            last = await gatherPlacePool(request, deps);
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
        await gatherPlacePool(request, deps);
        expect(map.calls.length).toBe(before);
    });

    it("stores the sweep as it goes, so a run cut short repeats little", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { overpass: 504 });
        const inner = createMemoryPlacePoolStore();
        const stored: PlacePoolState[] = [];
        const store: PlacePoolStore = {
            load: key => inner.load(key),
            save: async (key, state) => {
                stored.push(structuredClone(state));
                await inner.save(key, state);
            },
        };
        await gatherPlacePool(request, { store, photonRequests: 40, fetchImpl: map.fetchImpl });
        // Stored after every eighth answered request, not only at the end of the run.
        const during = stored.filter(s => s.sweep && s.sweep.answered > 0 && s.sweep.answered < 40);
        expect(during.map(s => s.sweep!.answered)).toEqual([8, 16, 24, 32]);

        // The process dies after the 24th answer; a new one starts from what was stored then.
        const atCrash = during[2]!;
        expect(placesKnown(atCrash)).toBeGreaterThan(0);
        expect(atCrash.requests.photon).toBe(24);
        const afterCrash = createMemoryPlacePoolStore();
        await afterCrash.save(placePoolKey(request), atCrash);
        const answeredBefore = map.sweepUrls().slice(0, 24);
        const again = createFakeMap(places, { overpass: 504 });
        const resumed = await gatherPlacePool(request, {
            store: afterCrash,
            photonRequests: 40,
            fetchImpl: again.fetchImpl,
        });
        // Nothing answered before the stored point is asked again.
        expect(again.sweepUrls().filter(url => answeredBefore.includes(url))).toEqual([]);
        expect(resumed.report.known).toBeGreaterThan(placesKnown(atCrash));
    });

    it("asks Overpass again on the next run while much of the sweep is left, and stops sweeping once it answers", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 30, fetchImpl: map.fetchImpl };
        const first = await gatherPlacePool(request, deps);
        expect(first.report.pendingBoxes).toBeGreaterThan(30);

        map.options.overpass = "answers";
        const photonBefore = map.count("photon");
        const second = await gatherPlacePool(request, deps);
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
        const whole = await wholeSweep(places);
        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const first = await gatherPlacePool(request, {
            store,
            photonRequests: whole - 12,
            fetchImpl: map.fetchImpl,
        });
        expect(first.report.complete).toBe(false);
        expect(first.report.pendingBoxes).toBeGreaterThan(0);
        expect(first.report.pendingBoxes).toBeLessThanOrEqual(12);
        const overpassBefore = map.count("overpass");
        const second = await gatherPlacePool(request, {
            store,
            photonRequests: 64,
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

    it("sweeps a region as a box around its centre, the lookup inside the cap, when Overpass has nothing", async () => {
        const hamburg = fakePopulation(80, { country: "DE", box: [9.8, 53.4, 10.2, 53.7] });
        const cities = { Hamburg: { lon: 10.0, lat: 53.55, country: "DE" } };
        const inHamburg: PlacePoolRequest = { ...request, country: "DE", region: "Hamburg" };
        const map = createFakeMap(hamburg, { overpass: "empty", cities });
        const { report } = await gatherPlacePool(inHamburg, {
            store: createMemoryPlacePoolStore(),
            photonRequests: 200,
            fetchImpl: map.fetchImpl,
        });
        // A region is one area, so Overpass is asked; its empty answer settles nothing.
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
        const capped = createFakeMap(hamburg, { overpass: 504, cities });
        const tight = await gatherPlacePool(inHamburg, {
            store: createMemoryPlacePoolStore(),
            photonRequests: 10,
            fetchImpl: capped.fetchImpl,
        });
        expect(capped.count("photon")).toBe(10);
        expect(tight.report.requests.photon).toBe(10);
    });

    it("sweeps every tag it was given, and is complete only when all of them are", async () => {
        const tags = ["shop:bicycle", "shop:sports", "craft:bicycle_repair", "shop:outdoor"];
        const places = tags.flatMap((tag, i) =>
            fakePopulation(60, { tag, firstId: 1 + i * 1_000 })
        );
        const four: PlacePoolRequest = {
            ...request,
            selectors: tags.map(tag => `["${tag.split(":")[0]}"="${tag.split(":")[1]}"]`),
        };
        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const run = () =>
            gatherPlacePool(four, { store, photonRequests: 64, fetchImpl: map.fetchImpl });
        const first = await run();
        // 104 whole-box requests come before any tag is done: three tags are not four.
        expect(first.state.sweep!.arms).toHaveLength(4 * 26);
        expect(first.report.complete).toBe(false);
        let last = first;
        while (!last.report.complete) last = await run();
        expect(last.report).toMatchObject({ completedBy: "sweep", known: 240 });
        const asked = new Set(map.sweepUrls().map(u => new URL(u).searchParams.get("osm_tag")));
        expect(asked).toEqual(new Set(tags));
    });

    it("does not sweep without a tag to filter by, and asks Photon nothing when the cap is zero", async () => {
        const map = createFakeMap(fakePopulation(50), { overpass: 504 });
        const noTags = await gatherPlacePool(
            { country: "NL", keywords: ["fulfilment"], selectors: [] },
            { store: createMemoryPlacePoolStore(), photonRequests: 0, fetchImpl: map.fetchImpl }
        );
        expect(noTags.report.asked).toEqual(["overpass", "names"]);
        const capZero = await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            photonRequests: 0,
            fetchImpl: map.fetchImpl,
        });
        expect(capZero.report.asked).toEqual(["overpass", "names"]);
        expect(map.count("photon")).toBe(0);
    });
});

describe("a failed request settles nothing", () => {
    it("does not call a pool complete, or a place without a website, because tag reads failed", async () => {
        const places = fakePopulation(300);
        const sites = withSite(places).length;
        // Overpass is down and the OSM API refuses every read, run after run.
        const map = createFakeMap(places, { overpass: 504, osmApiFails: () => true });
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 64, fetchImpl: map.fetchImpl };
        for (let run = 1; run <= 3; run++) {
            const { state, report } = await gatherPlacePool(request, deps);
            expect(report.complete).toBe(false);
            expect(state.without).toEqual([]);
            expect(report.withWebsite).toBe(0);
            expect(report.problems).toContain(
                "The OSM API did not answer every read of place tags"
            );
        }
        // Every box was swept once; the found places wait to be read.
        const waiting = await store.load(placePoolKey(request));
        expect(waiting).toMatchObject({ complete: false });
        expect(sweepPending(waiting!.sweep!)).toBe(0);
        expect(waiting!.unread).toHaveLength(300);
        expect(new Set(map.sweepUrls()).size).toBe(map.sweepUrls().length);

        // The servers come back: every website is there.
        map.options.osmApiFails = undefined;
        map.options.overpass = "answers";
        const healed = await gatherPlacePool(request, deps);
        expect(healed.report).toMatchObject({ complete: true, known: 300, withWebsite: sites });
    });

    it("reads the tags it could not read on a later run, and stops asking an API that is down after three tries", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { overpass: 504, osmApiFails: () => 503 });
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 100_000, fetchImpl: map.fetchImpl };
        const first = await gatherPlacePool(request, deps);
        expect(first.report).toMatchObject({ complete: false, known: 700, unread: 700 });
        // Seven hundred places are eight requests; three failures in a row end the reads.
        expect(map.count("osmapi")).toBe(3);
        // With the sweep done and reads failing, Overpass is asked again on the next run.
        const overpassBefore = map.count("overpass");
        const photonBefore = map.count("photon");
        map.options.osmApiFails = undefined;
        const second = await gatherPlacePool(request, deps);
        expect(map.count("overpass")).toBe(overpassBefore + 3);
        expect(map.count("photon")).toBe(photonBefore);
        expect(second.report).toMatchObject({
            complete: true,
            completedBy: "sweep",
            known: 700,
            withWebsite: withSite(places).length,
            unread: 0,
        });
    });

    it("keeps a pool open while one box will not answer, and lets Overpass close it", async () => {
        const places = fakePopulation(300);
        const map = createFakeMap(places, {
            overpass: 504,
            photonFails: url => new URL(url).searchParams.get("q") === "b",
        });
        const store = createMemoryPlacePoolStore();
        const run = () =>
            gatherPlacePool(request, { store, photonRequests: 64, fetchImpl: map.fetchImpl });

        const first = await run();
        expect(first.report).toMatchObject({ complete: false, pendingBoxes: 1 });
        // The box is asked once more per run; the pool is never "complete" with it missing.
        const overpassAfterFirst = map.count("overpass");
        const second = await run();
        expect(second.report).toMatchObject({
            asked: ["sweep"],
            complete: false,
            pendingBoxes: 1,
            requests: { photon: 1, overpass: 0 },
        });
        // A run that got no answer from Photon turns to Overpass again next time.
        const third = await run();
        expect(map.count("overpass")).toBe(overpassAfterFirst + 3);
        expect(third.report).toMatchObject({ complete: false, pendingBoxes: 1 });
        map.options.overpass = "answers";
        const fourth = await run();
        expect(fourth.report).toMatchObject({
            complete: true,
            completedBy: "overpass",
            known: 300,
        });
    });

    it("turns to Overpass again after Photon stopped answering, even with few boxes left", async () => {
        const places = fakePopulation(700);
        const whole = await wholeSweep(places);
        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const run = (photonRequests: number) =>
            gatherPlacePool(request, { store, photonRequests, fetchImpl: map.fetchImpl });
        await run(whole - 12);
        // Photon goes down. The few boxes left fit in a run, so Overpass is not asked first…
        map.options.photonFails = () => true;
        const overpassBefore = map.count("overpass");
        const failing = await run(64);
        expect(map.count("overpass")).toBe(overpassBefore);
        expect(failing.report).toMatchObject({ sweepStopped: "failing", complete: false });
        expect(failing.report.problems).toContain(
            "Photon stopped answering during the place sweep"
        );
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
});

describe("keeping the pool", () => {
    const DAY = 24 * 60 * 60 * 1000;

    it("fills a pool again once it is older than the limit, and keeps what it knew until the new filling is complete", async () => {
        const places = fakePopulation(60);
        const map = createFakeMap(places);
        const store = createMemoryPlacePoolStore();
        let clock = Date.parse("2026-11-24T00:00:00Z");
        const deps = { store, photonRequests: 0, fetchImpl: map.fetchImpl, now: () => clock };
        const original = await gatherPlacePool(request, deps);
        clock += 29 * DAY;
        await gatherPlacePool(request, deps);
        expect(map.count("overpass")).toBe(1);

        // Past the limit, with every server down: the run still gets the old places.
        clock += 2 * DAY;
        map.options.overpass = 504;
        const stale = await gatherPlacePool(request, deps);
        expect(map.count("overpass")).toBe(4);
        expect(stale.report).toMatchObject({ complete: false, known: 60 });
        expect(poolPlaces(stale.state)).toEqual(poolPlaces(original.state));
        expect(stale.state.startedAt).toBe(new Date(clock).toISOString());

        // The servers answer again, with one shop gone and one new: the pool follows.
        const gone = withSite(places)[0]!;
        const opened: FakePlace = {
            type: "N",
            id: 9_001,
            name: "Nieuw Rijwiel 9001",
            lon: 5,
            lat: 52,
            tag: "shop:bicycle",
            country: "NL",
            website: "https://place-9001.example/",
        };
        const changed = createFakeMap([...places.filter(p => p !== gone), opened]);
        const fresh = await gatherPlacePool(request, { ...deps, fetchImpl: changed.fetchImpl });
        expect(fresh.report).toMatchObject({
            complete: true,
            completedBy: "overpass",
            known: 60,
        });
        expect(fresh.state.places[idOf(gone)]).toBeUndefined();
        expect(fresh.state.places[idOf(opened)]?.website).toBe("https://place-9001.example/");
        expect(fresh.state.carried).toEqual([]);
    });

    it("asks again after a day when the answer was that nothing is there", async () => {
        const empty = createFakeMap([], { overpass: "empty" });
        const store = createMemoryPlacePoolStore();
        let clock = Date.parse("2026-11-24T00:00:00Z");
        const deps = { store, photonRequests: 0, fetchImpl: empty.fetchImpl, now: () => clock };
        await gatherPlacePool(request, deps);
        await gatherPlacePool(request, deps);
        expect(empty.count("overpass")).toBe(1);
        clock += 25 * 60 * 60 * 1000;
        await gatherPlacePool(request, deps);
        expect(empty.count("overpass")).toBe(2);
    });

    it("carries an unfinished sweep on however long ago it stopped, and counts a pool's age from when it was complete", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        let clock = Date.parse("2026-11-24T00:00:00Z");
        const deps = { store, photonRequests: 40, fetchImpl: map.fetchImpl, now: () => clock };
        let last = await gatherPlacePool(request, deps);
        expect(last.report.complete).toBe(false);
        // Runs five weeks apart: each carries on, none starts the sweep over.
        let runs = 1;
        while (!last.report.complete) {
            clock += 35 * DAY;
            last = await gatherPlacePool(request, deps);
            runs += 1;
        }
        expect(runs).toBeGreaterThan(2);
        expect(last.report).toMatchObject({ completedBy: "sweep", known: 700 });
        expect(last.state.startedAt).toBe("2026-11-24T00:00:00.000Z");
        expect(last.state.completedAt).toBe(new Date(clock).toISOString());
        const sweep = map.sweepUrls();
        expect(new Set(sweep).size).toBe(sweep.length);

        // Complete ten weeks after it started: its age counts from now, not from then.
        const asked = map.calls.length;
        clock += 29 * DAY;
        await gatherPlacePool(request, deps);
        expect(map.calls.length).toBe(asked);
        clock += 2 * DAY;
        const refilled = await gatherPlacePool(request, deps);
        expect(map.calls.length).toBeGreaterThan(asked);
        expect(refilled.report.known).toBe(700);
    });

    it("carries on a sweep that has found nothing yet, instead of asking its answered boxes again", async () => {
        const four: PlacePoolRequest = {
            ...request,
            selectors: ["a", "b", "c", "d"].map(value => `["shop"="${value}"]`),
        };
        const map = createFakeMap([], { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        let clock = Date.parse("2026-11-24T00:00:00Z");
        const deps = { store, photonRequests: 64, fetchImpl: map.fetchImpl, now: () => clock };
        // Four tags are 104 boxes: more than one run's 64, and none holds a place.
        const first = await gatherPlacePool(four, deps);
        expect(first.report).toMatchObject({ complete: false, known: 0, pendingBoxes: 40 });
        clock += 7 * DAY;
        const second = await gatherPlacePool(four, deps);
        expect(second.report).toMatchObject({ complete: true, completedBy: "sweep", known: 0 });
        const sweep = map.sweepUrls();
        expect(sweep).toHaveLength(104);
        expect(new Set(sweep).size).toBe(104);
    });

    it("keys a pool by the selectors it asks for: the first four", () => {
        const five = ["a", "b", "c", "d", "e"].map(value => `["shop"="${value}"]`);
        const key = placePoolKey({ ...request, selectors: five });
        expect(placePoolKey({ ...request, selectors: five.slice(0, 4) })).toBe(key);
        expect(placePoolKey({ ...request, selectors: [...five.slice(0, 4)].reverse() })).toBe(key);
        expect(placePoolKey({ ...request, selectors: five.slice(1) })).not.toBe(key);
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
            photonRequests: 64,
            fetchImpl: map.fetchImpl,
        });
        expect(report.complete).toBe(true);
        expect(poolPlaces(state).length).toBeGreaterThan(0);
    });

    it("ignores a stored pool written by another version", async () => {
        const map = createFakeMap(fakePopulation(40));
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 0, fetchImpl: map.fetchImpl };
        const { state } = await gatherPlacePool(request, deps);
        await store.save(placePoolKey(request), { ...state, version: PLACE_POOL_VERSION + 1 });
        await gatherPlacePool(request, deps);
        expect(map.count("overpass")).toBe(2);
    });

    it("makes two runs for the same pool at the same moment share one set of requests", async () => {
        const map = createFakeMap(fakePopulation(200), { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 500, fetchImpl: map.fetchImpl };
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

describe("what a later run would still ask", () => {
    const nothing = { overpass: false, boxes: false, tags: false };

    it("says Overpass and the sweep's boxes are waiting after a sweep cut by the cap, and nothing once complete", async () => {
        const map = createFakeMap(fakePopulation(700), { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 40, fetchImpl: map.fetchImpl };
        const cut = await gatherPlacePool(request, deps);
        expect(cut.report.waiting).toEqual({ overpass: true, boxes: true, tags: false });
        map.options.overpass = "answers";
        const done = await gatherPlacePool(request, deps);
        expect(done.report).toMatchObject({ complete: true, waiting: nothing });
    });

    it("says found places are waiting for their tags while the OSM API is down", async () => {
        const map = createFakeMap(fakePopulation(60), { overpass: 504, osmApiFails: () => 503 });
        const { report } = await gatherPlacePool(request, {
            store: createMemoryPlacePoolStore(),
            photonRequests: 500,
            fetchImpl: map.fetchImpl,
        });
        expect(report.unread).toBe(60);
        expect(report.waiting).toEqual({ overpass: true, boxes: false, tags: true });
    });

    it("says the sweep has yet to start when the cap left it no request", async () => {
        const map = createFakeMap(fakePopulation(60, { country: "DE", box: DE_BOX }));
        const { report } = await gatherPlacePool(
            { ...request, country: "DE" },
            { store: createMemoryPlacePoolStore(), photonRequests: 0, fetchImpl: map.fetchImpl }
        );
        // Too large for one Overpass request, so only the sweep can fill it.
        expect(report).toMatchObject({
            complete: false,
            waiting: { overpass: false, boxes: true, tags: false },
        });
    });

    it("says nothing is waiting, without calling the pool complete, when no server can be asked for more", async () => {
        // No tag to filter by: Overpass answered (nothing by that name) and a sweep cannot run.
        const noTag = createFakeMap([], { overpass: "empty" });
        const named = await gatherPlacePool(
            { country: "NL", keywords: ["fulfilment"], selectors: [] },
            { store: createMemoryPlacePoolStore(), photonRequests: 64, fetchImpl: noTag.fetchImpl }
        );
        expect(named.report).toMatchObject({ complete: false, waiting: nothing });

        // A country with no box in the table: Overpass is the only source, and it has answered.
        const noBox = createFakeMap([], { overpass: "empty" });
        const hungary = { ...request, country: "HU" };
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 64, fetchImpl: noBox.fetchImpl };
        const first = await gatherPlacePool(hungary, deps);
        expect(first.report).toMatchObject({ complete: false, waiting: nothing });
        expect(noBox.sweepUrls()).toEqual([]);
        // While Overpass has not answered, it is what waits.
        noBox.options.overpass = 504;
        const down = await gatherPlacePool(
            { ...request, country: "HU", selectors: ['["shop"="books"]'] },
            deps
        );
        expect(down.report.waiting).toEqual({ overpass: true, boxes: false, tags: false });
    });
});

describe("a box too dense to split", () => {
    /** Sixty shops at one address whose names start alike: no box can hold fewer than a full page. */
    const oneAddress = (country: string, lon: number, lat: number): FakePlace[] =>
        Array.from({ length: 60 }, (_, i) => ({
            type: "N" as const,
            id: i + 1,
            name: `Alfa ${i + 1}`,
            lon,
            lat,
            tag: "shop:bicycle",
            country,
            website: `https://alfa-${i + 1}.example/`,
        }));

    it("keeps a swept pool from being called complete, and asks nothing more once every box is answered", async () => {
        const map = createFakeMap(oneAddress("DE", 10, 51));
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 500, fetchImpl: map.fetchImpl };
        const germany = { ...request, country: "DE" };
        const first = await gatherPlacePool(germany, deps);
        expect(first.report).toMatchObject({
            complete: false,
            known: 50,
            pendingBoxes: 0,
            boxesCutOff: 1,
            // Nothing a later run could ask would show the other ten.
            waiting: { overpass: false, boxes: false, tags: false },
        });
        expect(poolPlaces(first.state)).toHaveLength(50);

        const asked = map.calls.length;
        const second = await gatherPlacePool(germany, deps);
        expect(map.calls.length).toBe(asked);
        expect(second.report).toMatchObject({ complete: false, asked: [], boxesCutOff: 1 });
    });

    it("lets Overpass complete the pool where it can be asked", async () => {
        const map = createFakeMap(oneAddress("NL", 5, 52), { overpass: 504 });
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 500, fetchImpl: map.fetchImpl };
        const swept = await gatherPlacePool(request, deps);
        expect(swept.report).toMatchObject({
            complete: false,
            known: 50,
            boxesCutOff: 1,
            waiting: { overpass: true, boxes: false, tags: false },
        });
        map.options.overpass = "answers";
        const told = await gatherPlacePool(request, deps);
        expect(told.report).toMatchObject({ complete: true, completedBy: "overpass", known: 60 });
    });
});

describe("a territory where nothing carries the tags", () => {
    const named = [
        {
            osm_type: "node",
            osm_id: 7,
            name: "Koffiebranderij Blanche Dael",
            lat: "50.85",
            lon: "5.69",
            category: "shop",
            type: "coffee",
            extratags: { website: "https://blanchedael.example" },
            address: { city: "Maastricht" },
        },
    ];
    /** No tagged place anywhere; Nominatim knows one by name. */
    const nothingTagged = (overpass: "empty" | 504 = "empty") => {
        const map = createFakeMap([], { overpass });
        const fetchImpl: typeof fetch = (input, init) => {
            if (hostOf(input) !== "nominatim.openstreetmap.org") return map.fetchImpl(input, init);
            map.calls.push("nominatim (one place by name)");
            return Promise.resolve(new Response(JSON.stringify(named)));
        };
        return { map, fetchImpl };
    };
    const coffee: PlacePoolRequest = {
        country: "NL",
        keywords: ["specialty", "coffee"],
        selectors: ['["shop"="coffee"]'],
    };

    it("looks for the segment's words in place names once, and keeps what it found", async () => {
        const { map, fetchImpl } = nothingTagged();
        const store = createMemoryPlacePoolStore();
        const deps = { store, photonRequests: 64, fetchImpl };
        const first = await gatherPlacePool(coffee, deps);
        expect(first.report.asked).toEqual(["overpass", "sweep", "names"]);
        // The sweep found nothing in 26 requests; the name search then asked
        // Photon for the three largest cities, inside the same cap.
        expect(first.report.requests).toMatchObject({ overpass: 1, photon: 26 + 3 });
        expect(first.report.requests.nominatim).toBeGreaterThan(0);
        expect(first.report).toMatchObject({ complete: true, completedBy: "sweep", known: 0 });
        expect(poolPlaces(first.state).map(p => p.name)).toEqual(["Koffiebranderij Blanche Dael"]);

        // A second run asks nobody: what the names gave is in the pool.
        const before = map.calls.length;
        const second = await gatherPlacePool(coffee, deps);
        expect(map.calls.length).toBe(before);
        expect(poolPlaces(second.state).map(p => p.name)).toEqual(["Koffiebranderij Blanche Dael"]);
    });

    it("keeps the name search's Photon requests inside the run's cap", async () => {
        const tight = nothingTagged();
        const { report } = await gatherPlacePool(coffee, {
            store: createMemoryPlacePoolStore(),
            photonRequests: 27,
            fetchImpl: tight.fetchImpl,
        });
        expect(tight.map.count("photon")).toBe(27);
        expect(report.requests.photon).toBe(27);

        const none = nothingTagged();
        const { state } = await gatherPlacePool(coffee, {
            store: createMemoryPlacePoolStore(),
            photonRequests: 0,
            fetchImpl: none.fetchImpl,
        });
        expect(none.map.count("photon")).toBe(0);
        expect(poolPlaces(state)).toHaveLength(1);
    });

    it("searches names again next run when no server answered, instead of concluding there are none", async () => {
        const down = createFakeMap([], { overpass: 504, photonFails: () => true });
        const silent: typeof fetch = (input, init) =>
            hostOf(input) === "nominatim.openstreetmap.org"
                ? Promise.resolve(new Response("busy", { status: 503 }))
                : down.fetchImpl(input, init);
        const store = createMemoryPlacePoolStore();
        const first = await gatherPlacePool(coffee, {
            store,
            photonRequests: 64,
            fetchImpl: silent,
        });
        expect(first.state.namesSearched).toBe(false);
        expect(first.report.problems.length).toBeGreaterThan(0);
        expect(poolPlaces(first.state)).toEqual([]);

        const back = nothingTagged();
        const second = await gatherPlacePool(coffee, {
            store,
            photonRequests: 64,
            fetchImpl: back.fetchImpl,
        });
        expect(second.state.namesSearched).toBe(true);
        expect(poolPlaces(second.state)).toHaveLength(1);
    });

    it("prefers tagged places as soon as there are any", async () => {
        const { fetchImpl } = nothingTagged(504);
        const store = createMemoryPlacePoolStore();
        // Overpass down and no Photon allowed: only the names answer.
        const first = await gatherPlacePool(coffee, { store, photonRequests: 0, fetchImpl });
        expect(poolPlaces(first.state)).toHaveLength(1);
        expect(first.report.complete).toBe(false);

        // Next run Overpass answers with coffee shops: the pool is those, not the name match.
        const shops = fakePopulation(30, { tag: "shop:coffee" });
        const answering = createFakeMap(shops);
        const second = await gatherPlacePool(coffee, {
            store,
            photonRequests: 0,
            fetchImpl: answering.fetchImpl,
        });
        expect(second.report).toMatchObject({ complete: true, completedBy: "overpass" });
        expect(poolPlaces(second.state)).toHaveLength(withSite(shops).length);
        expect(poolPlaces(second.state).some(p => p.name.startsWith("Koffiebranderij"))).toBe(
            false
        );
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
        overpassAnswered: true,
        sweep: null,
        lastSweep: null,
        byName: [],
        namesSearched: false,
        carried: [],
        complete: true,
        completedBy: "overpass",
        completedAt: "2026-11-24T00:00:00.000Z",
        startedAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
        requests: { overpass: 1, photon: 0, osmApi: 0, nominatim: 0 },
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

    it("gives the places found by name only while no tagged place has a website", () => {
        const byName = [place(70, "https://named.example/")];
        expect(poolPlaces({ ...pool([]), byName })).toEqual(byName);
        expect(
            poolPlaces({ ...pool([place(1, "https://tagged.example/")]), byName }).map(p => p.id)
        ).toEqual(["osm:node/1"]);
    });
});
