/**
 * The place sweep against a pretend Photon that behaves like the real one
 * where it matters: it matches the start of a name word, applies the tag,
 * and never returns more than 50 places. Network is stubbed.
 */
import { describe, expect, it } from "vitest";

import { createFakeMap, fakePopulation, type FakePlace } from "./map.fixture";
import {
    PHOTON_PAGE,
    SWEEP_LETTERS,
    boxOfNode,
    newSweep,
    nextArm,
    photonSweepUrl,
    quarterBoxes,
    readPlaceTags,
    runSweep,
    sweepDepthFor,
    sweepPending,
    type SweepHit,
    type SweepState,
} from "./sweep";
import type { HostThrottle } from "./throttle";

const NL = [3.3, 50.7, 7.25, 53.6] as const;
const TAG = "shop:bicycle";

async function sweepAll(
    state: SweepState,
    fetchImpl: typeof fetch,
    maxRequests = 10_000
): Promise<{ found: Map<string, SweepHit>; result: Awaited<ReturnType<typeof runSweep>> }> {
    const found = new Map<string, SweepHit>();
    const result = await runSweep(state, {
        country: "NL",
        maxRequests,
        fetchImpl,
        onHits: hits => {
            for (const hit of hits) found.set(hit.id, hit);
        },
    });
    return { found, result };
}

const idOf = (p: FakePlace) => `osm:${p.type === "N" ? "node" : "way"}/${p.id}`;

describe("sweep geometry and requests", () => {
    it("splits a box into quarters: south-west, south-east, north-west, north-east", () => {
        expect(quarterBoxes([0, 0, 4, 2])).toEqual([
            [0, 0, 2, 1],
            [2, 0, 4, 1],
            [0, 1, 2, 2],
            [2, 1, 4, 2],
        ]);
        expect(boxOfNode([0, 0, 4, 2], "r")).toEqual([0, 0, 4, 2]);
        expect(boxOfNode([0, 0, 4, 2], "r.3.0")).toEqual([2, 1, 3, 1.5]);
    });

    it("asks Photon for a name prefix inside a box, filtered by the tag", () => {
        // The exact request the benchmark recorded: its replay depends on this shape.
        expect(
            photonSweepUrl("https://photon.komoot.io/api/", TAG, "a", [8.0, 54.5, 15.3, 57.8])
        ).toBe(
            "https://photon.komoot.io/api/?q=a&limit=50&lang=en&bbox=8.0000%2C54.5000%2C15.3000%2C57.8000&osm_tag=shop%3Abicycle"
        );
    });

    it("starts with one whole-box request per letter and per tag", () => {
        const state = newSweep(NL, [TAG, "craft:brewery"]);
        expect(state.arms).toHaveLength(2 * SWEEP_LETTERS.length);
        expect(sweepPending(state)).toBe(52);
        expect(state.arms[0]).toEqual({ tag: TAG, term: "a", queue: ["r"], turns: 0 });
        expect(state.arms[26]!.tag).toBe("craft:brewery");
    });
});

describe("sweeping", () => {
    it("finds every place by splitting each box that comes back full", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places);
        const state = newSweep(NL, [TAG]);
        const { found, result } = await sweepAll(state, map.fetchImpl);

        expect(result.stopped).toBe("complete");
        expect(found.size).toBe(700);
        expect(new Set(found.keys())).toEqual(new Set(places.map(idOf)));
        expect(sweepPending(state)).toBe(0);
        expect(state.cutOff).toBe(0);
        // More than one page per letter was needed, and no box was asked twice.
        const urls = map.sweepUrls();
        expect(urls.length).toBeGreaterThan(26);
        expect(new Set(urls).size).toBe(urls.length);
        expect(state.answered).toBe(urls.length);
        // Far fewer requests than places: each returns up to a page.
        expect(urls.length).toBeLessThan(700 / 2);
    });

    it("goes level by level: every letter's whole box before any quarter", async () => {
        const map = createFakeMap(fakePopulation(700));
        await sweepAll(newSweep(NL, [TAG]), map.fetchImpl, 30);
        const asked = map.sweepUrls().map(u => {
            const url = new URL(u);
            return `${url.searchParams.get("q")}@${url.searchParams.get("bbox")}`;
        });
        expect(asked.slice(0, 26)).toEqual(
            SWEEP_LETTERS.map(letter => `${letter}@3.3000,50.7000,7.2500,53.6000`)
        );
        // The 27th request is a quarter of the first letter that came back full.
        expect(asked[26]).not.toContain("@3.3000,50.7000,7.2500,53.6000");
    });

    it.each([1, 7, 20])(
        "stops at a cap of %i requests and later runs carry on without repeating one",
        async cap => {
            const places = fakePopulation(700);
            const whole = createFakeMap(places);
            const oneGo = await sweepAll(newSweep(NL, [TAG]), whole.fetchImpl);

            const map = createFakeMap(places);
            const found = new Map<string, SweepHit>();
            let state = newSweep(NL, [TAG]);
            let runs = 0;
            for (;;) {
                const run = await sweepAll(state, map.fetchImpl, cap);
                for (const [id, hit] of run.found) found.set(id, hit);
                runs += 1;
                expect(run.result.sent).toBeLessThanOrEqual(cap);
                if (run.result.stopped === "complete") break;
                expect(run.result.stopped).toBe("cap");
                // Between runs the sweep is stored as JSON.
                state = JSON.parse(JSON.stringify(state)) as SweepState;
            }
            const urls = map.sweepUrls();
            // No run is spent finding out that the sweep is over.
            expect(runs).toBe(Math.ceil(urls.length / cap));
            expect(new Set(urls).size).toBe(urls.length);
            // Stopping and resuming costs nothing: the same requests, in the
            // same order, as one long run.
            expect(urls).toEqual(whole.sweepUrls());
            expect(found.size).toBe(oneGo.found.size);
        }
    );

    it("counts a request's time limit from when it is sent, not from when it joined the queue", async () => {
        const map = createFakeMap(fakePopulation(60));
        // Every request waits 80 ms for its host's turn; the limit for the request itself is 40 ms.
        const slowQueue: HostThrottle = async (_host, task) => {
            await new Promise(resolve => setTimeout(resolve, 80));
            return task();
        };
        const state = newSweep(NL, [TAG], ["a", "b", "c"]);
        const result = await runSweep(state, {
            country: "NL",
            maxRequests: 3,
            fetchImpl: map.fetchImpl,
            throttle: slowQueue,
            requestTimeoutMs: 40,
            onHits: () => undefined,
        });
        expect(result).toMatchObject({ sent: 3, answered: 3, failed: 0 });

        // A request that itself takes longer than the limit still fails.
        const slowServer: typeof fetch = async (input, init) => {
            await new Promise(resolve => setTimeout(resolve, 120));
            if (init?.signal?.aborted) throw new Error("aborted");
            return map.fetchImpl(input, init);
        };
        const timedOut = await runSweep(newSweep(NL, [TAG], ["a"]), {
            country: "NL",
            maxRequests: 1,
            fetchImpl: slowServer,
            requestTimeoutMs: 40,
            onHits: () => undefined,
        });
        expect(timedOut).toMatchObject({ answered: 0, failed: 1 });
    });

    it("keeps places of the asked country only", async () => {
        const places: FakePlace[] = [
            { type: "N", id: 1, name: "Alfa", lon: 5, lat: 52, tag: TAG, country: "NL" },
            { type: "N", id: 2, name: "Anders", lon: 6.9, lat: 51.2, tag: TAG, country: "DE" },
        ];
        const map = createFakeMap(places);
        const { found } = await sweepAll(newSweep(NL, [TAG]), map.fetchImpl);
        expect([...found.keys()]).toEqual(["osm:node/1"]);
        expect(found.get("osm:node/1")).toMatchObject({
            name: "Alfa",
            lat: 52,
            lng: 5,
            category: "shop=bicycle",
        });
    });

    it("counts a box that is still full at the depth limit instead of splitting for ever", async () => {
        // Sixty shops at one address: no amount of splitting separates them.
        const places: FakePlace[] = Array.from({ length: 60 }, (_, i) => ({
            type: "N" as const,
            id: i + 1,
            name: `Alfa ${i + 1}`,
            lon: 5,
            lat: 52,
            tag: TAG,
            country: "NL",
        }));
        const map = createFakeMap(places);
        const state = newSweep(NL, [TAG], ["a"]);
        const found = new Map<string, SweepHit>();
        const result = await runSweep(state, {
            country: "NL",
            maxRequests: 1_000,
            maxDepth: 3,
            fetchImpl: map.fetchImpl,
            onHits: hits => hits.forEach(hit => found.set(hit.id, hit)),
        });
        expect(result.stopped).toBe("complete");
        expect(state.cutOff).toBe(1);
        expect(found.size).toBe(PHOTON_PAGE);
        // One box per level holds the address; its three siblings come back empty.
        expect(result.sent).toBe(1 + 4 + 4 + 4);
    });

    it("splits until a box is about a kilometre across, however large the territory", () => {
        expect(sweepDepthFor(NL)).toBe(9);
        expect(sweepDepthFor([5.85, 47.25, 15.05, 55.1])).toBe(10);
        expect(sweepDepthFor([-124.85, 24.4, -66.85, 49.4])).toBe(13);
        // A region's box is small to begin with: it keeps the base depth.
        expect(sweepDepthFor([4.55, 52.12, 5.25, 52.62])).toBe(8);
    });

    it("lists a dense town inside a large country, which eight levels would cut off", async () => {
        // 300 shops whose names start alike, within a few kilometres, in a box the size of Germany.
        const DE = [5.85, 47.25, 15.05, 55.1] as const;
        const places: FakePlace[] = Array.from({ length: 300 }, (_, i) => ({
            type: "N" as const,
            id: i + 1,
            name: `Alfa ${i + 1}`,
            lon: 10 + (i % 20) * 0.003,
            lat: 51 + Math.floor(i / 20) * 0.003,
            tag: TAG,
            country: "DE",
        }));
        const sweep = async (maxDepth?: number) => {
            const state = newSweep(DE, [TAG], ["a"]);
            const found = new Set<string>();
            await runSweep(state, {
                country: "DE",
                maxRequests: 10_000,
                ...(maxDepth === undefined ? {} : { maxDepth }),
                fetchImpl: createFakeMap(places).fetchImpl,
                onHits: hits => hits.forEach(hit => found.add(hit.id)),
            });
            return { found: found.size, cutOff: state.cutOff };
        };
        const shallow = await sweep(8);
        expect(shallow.cutOff).toBeGreaterThan(0);
        expect(shallow.found).toBeLessThan(300);
        expect(await sweep()).toEqual({ found: 300, cutOff: 0 });
    });

    it("asks a failed box again on the next run, once per run, and never gives it up", async () => {
        const places = fakePopulation(120);
        // One letter's box fails; everything else answers.
        const map = createFakeMap(places, {
            photonFails: url => new URL(url).searchParams.get("q") === "b",
        });
        const asksForB = () => map.sweepUrls().filter(u => u.includes("q=b&")).length;
        let state = newSweep(NL, [TAG]);
        const found = new Map<string, SweepHit>();
        const run = async () => {
            const { found: hits, result } = await sweepAll(state, map.fetchImpl);
            hits.forEach((hit, id) => found.set(id, hit));
            // Between runs the sweep is stored as JSON.
            state = JSON.parse(JSON.stringify(state)) as SweepState;
            return result;
        };

        // Not retried seconds later: it waits, and the sweep is not over.
        expect(await run()).toMatchObject({ stopped: "deferred", failed: 1 });
        expect(state.deferred).toEqual([{ arm: 1, node: "r" }]);
        expect(sweepPending(state)).toBe(1);
        expect(asksForB()).toBe(1);

        // Each later run asks it once more, and it is still waiting after each.
        for (const asks of [2, 3]) {
            expect(await run()).toMatchObject({ stopped: "deferred", sent: 1, failed: 1 });
            expect(asksForB()).toBe(asks);
            expect(sweepPending(state)).toBe(1);
        }

        // Once Photon answers it, the sweep is over and nothing was lost.
        map.options.photonFails = undefined;
        expect((await run()).stopped).toBe("complete");
        expect(sweepPending(state)).toBe(0);
        expect(found.size).toBe(120);
    });

    it("tells its caller after each answered request", async () => {
        const map = createFakeMap(fakePopulation(120), {
            photonFails: url => new URL(url).searchParams.get("q") === "b",
        });
        const progress: number[] = [];
        await runSweep(newSweep(NL, [TAG]), {
            country: "NL",
            maxRequests: 5,
            fetchImpl: map.fetchImpl,
            onHits: () => undefined,
            onAnswered: ({ sent }) => {
                progress.push(sent);
            },
        });
        // "b" (the second request) failed: no call for it.
        expect(progress).toEqual([1, 3, 4, 5]);
    });

    it("stops the run when Photon stops answering, and holds nothing against the boxes it asked", async () => {
        const down = createFakeMap(fakePopulation(120), { photonFails: () => true });
        const stuck = newSweep(NL, [TAG]);
        const stopped = await sweepAll(stuck, down.fetchImpl);
        expect(stopped.result).toMatchObject({ stopped: "failing", sent: 3, answered: 0 });
        // As if nothing had been asked: every letter still has its whole box to ask.
        expect(sweepPending(stuck)).toBe(26);
        expect(stuck.deferred).toEqual([]);
        expect(stuck.arms.slice(0, 3).map(arm => [arm.queue, arm.turns])).toEqual([
            [["r"], 0],
            [["r"], 0],
            [["r"], 0],
        ]);
        expect(nextArm(stuck)?.term).toBe("a");
    });

    it("loses no part of the map in an outage, however many runs it lasts", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places);
        const state = newSweep(NL, [TAG]);
        const found = new Map<string, SweepHit>();
        const run = async (cap: number) => {
            const { found: hits, result } = await sweepAll(state, map.fetchImpl, cap);
            hits.forEach((hit, id) => found.set(id, hit));
            return result;
        };
        // Part of the sweep, then Photon goes away for four runs, then comes back.
        expect((await run(40)).stopped).toBe("cap");
        const answeredBefore = state.answered;
        map.options.photonFails = () => true;
        for (let i = 0; i < 4; i++) expect((await run(40)).stopped).toBe("failing");
        expect(state).toMatchObject({ answered: answeredBefore, deferred: [] });
        map.options.photonFails = undefined;
        expect((await run(10_000)).stopped).toBe("complete");
        expect(found.size).toBe(700);
        expect(sweepPending(state)).toBe(0);
        // The outage cost twelve failed requests and nothing else: no box was asked twice once answered.
        const answered = map.sweepUrls().filter((_, i) => i < 40 || i >= 40 + 12);
        expect(new Set(answered).size).toBe(answered.length);
    });
});

describe("reading tags of what was found", () => {
    const hit = (type: "node" | "way", id: number): SweepHit => ({
        id: `osm:${type}/${id}`,
        name: `Photon name ${id}`,
        lat: 52,
        lng: 5,
        category: "shop=bicycle",
        city: "Utrecht",
    });

    it("reads 100 places per request and keeps those with a name and a website", async () => {
        const places = fakePopulation(230);
        const map = createFakeMap(places);
        const hits = places.map(p => hit(p.type === "N" ? "node" : "way", p.id));
        const read = await readPlaceTags(hits, "NL", { fetchImpl: map.fetchImpl });

        const nodes = places.filter(p => p.type === "N").length;
        const ways = places.length - nodes;
        expect(read.requests).toBe(Math.ceil(nodes / 100) + Math.ceil(ways / 100));
        expect(map.count("osmapi")).toBe(read.requests);
        const withSite = places.filter(p => p.website ?? p.contactWebsite);
        expect(read.places).toHaveLength(withSite.length);
        expect(read.without).toHaveLength(places.length - withSite.length);
        expect(read.unread).toEqual([]);

        const viaContact = places.find(p => p.contactWebsite)!;
        expect(read.places.find(p => p.id === idOf(viaContact))).toMatchObject({
            name: viaContact.name,
            website: `https://place-${viaContact.id}.example/`,
            categories: ["shop=bicycle"],
            country: "NL",
            city: "Utrecht",
        });
        // Only place facts are kept: not who edited the element.
        expect(JSON.stringify(read.places)).not.toContain("a-mapper");
    });

    it("leaves a failed request's places unread, whatever the failure", async () => {
        const places = fakePopulation(30);
        const hits = places.map(p => hit(p.type === "N" ? "node" : "way", p.id));
        const ways = places.filter(p => p.type === "W").map(idOf);
        // A 404 (the API refuses the request) and a 503 (the API is in trouble) alike.
        for (const status of [404, 503]) {
            const map = createFakeMap(places, {
                osmApiFails: url => (url.includes("/ways.json") ? status : false),
            });
            const read = await readPlaceTags(hits, "NL", { fetchImpl: map.fetchImpl });
            expect(read.unread.map(h => h.id)).toEqual(ways);
            // Read places are settled either way; unread ones are in neither list.
            expect(read.places.length + read.without.length).toBe(
                places.filter(p => p.type === "N").length
            );
            expect(read.without.some(id => ways.includes(id))).toBe(false);
            expect(read).toMatchObject({ requests: 2, answered: 1 });
        }
    });

    it("stops asking when the API is down, and takes that to mean nothing about any place", async () => {
        const places = fakePopulation(700);
        const map = createFakeMap(places, { osmApiFails: () => 503 });
        const hits = places.map(p => hit(p.type === "N" ? "node" : "way", p.id));
        const read = await readPlaceTags(hits, "NL", { fetchImpl: map.fetchImpl });
        // Three failures in a row end the reads; the other chunks are not sent.
        expect(read).toMatchObject({
            requests: 3,
            answered: 0,
            places: [],
            without: [],
        });
        expect(map.count("osmapi")).toBe(3);
        expect(read.unread).toHaveLength(700);
    });
});
