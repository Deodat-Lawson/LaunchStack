/**
 * Production's keyless place search on the six recorded segments, beside
 * what the search did before it swept: the measured case for sweeping.
 *
 * The replay needs the local recordings (not in git: see the README), so on a
 * machine without them the replay tests are skipped and only the box check
 * runs. With them, nothing leaves the machine either: every request is
 * answered from the recording (./production.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { countryBox } from "../../../src/distribution/keyless/geo";
import { DEFAULT_SWEEP_REQUESTS_PER_RUN } from "../../../src/distribution/keyless/ports";
import { stringifyResults } from "../lib/json";
import {
    BUDGETS,
    RESUME_CAP,
    printReplay,
    replayProduction,
    type ProductionReplay,
} from "./production";
import { SEGMENTS } from "./segments";
import { loadWorld } from "./world";

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.resolve(here, "..", "results", "e1-production-sweep.json");
const recorded = SEGMENTS.every(segment => loadWorld(segment.id)?.truth);

describe("the sweep's boxes", () => {
    it("sweeps each recorded country from the box the recording used", () => {
        // The replay answers by URL, and the box is part of every URL.
        for (const segment of SEGMENTS) expect(countryBox(segment.country)).toEqual(segment.bbox);
    });
});

describe.skipIf(!recorded)("production's place search on the recorded segments", () => {
    let replay: ProductionReplay;

    beforeAll(async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const result = await replayProduction();
        info.mockRestore();
        if (!result) throw new Error("recordings disappeared");
        replay = result;
    }, 120_000);

    afterAll(() => {
        // The numbers, for whoever runs the test: today beside the sweep.
        if (replay) printReplay(replay);
    });

    it("replays all six segments", () => {
        expect(replay.segments.map(s => s.id)).toEqual(SEGMENTS.map(s => s.id));
        expect(RESUME_CAP).toBe(DEFAULT_SWEEP_REQUESTS_PER_RUN);
    });

    it("gets every place from one Overpass request when Overpass answers, and nothing is asked on the next run", () => {
        for (const s of replay.segments) {
            const o = s.overpassFirst;
            expect(o.requests, s.id).toEqual({ overpass: 1, photon: 0, osmApi: 0 });
            expect(o.complete, s.id).toBe(true);
            expect(o.known, s.id).toBe(s.population.overpassNamed);
            expect(o.withWebsite, s.id).toBe(s.population.overpassWithWebsite);
            expect(o.knownShare, s.id).toBe(1);
            // Handed to ranking: every website once (branches of a chain share one).
            expect(o.placesReturned, s.id).toBeGreaterThan(0.8 * o.withWebsite);
            expect(o.placesReturned, s.id).toBeLessThanOrEqual(o.withWebsite);
            expect(o.secondRun.requests, s.id).toEqual({ overpass: 0, photon: 0, osmApi: 0 });
            expect(o.secondRun.placesReturned, s.id).toBe(o.placesReturned);
            // Before: the first 40 the servers returned.
            expect(o.placesReturned, s.id).toBeGreaterThan(3 * (s.todayWholeSearch?.kept ?? 40));
        }
    });

    it("knows far more than today's first step for the same number of Photon requests when it has to sweep", () => {
        for (const s of replay.segments) {
            const same = s.sweep.atBudget[String(s.today.photonRequests)]!;
            expect(same.photonRequests, s.id).toBeLessThanOrEqual(s.today.photonRequests);
            // Today: 0 to 17 on-target places with a website for these requests.
            expect(s.today.onTargetWithWebsite, s.id).toBeLessThanOrEqual(17);
            expect(same.withWebsite, s.id).toBeGreaterThanOrEqual(14);
            expect(same.withWebsite, s.id).toBeGreaterThan(5 * s.today.onTargetWithWebsite);
        }
    });

    it("knows about 90% of all places after 64 requests, and more with every larger cap", () => {
        expect(replay.overall.knownShareAt["16"]).toBeGreaterThan(0.4);
        expect(replay.overall.knownShareAt["32"]).toBeGreaterThan(0.65);
        expect(replay.overall.knownShareAt["64"]).toBeGreaterThan(0.85);
        expect(replay.overall.knownShareAt["96"]).toBeGreaterThan(0.9);
        for (const s of replay.segments) {
            let before = 0;
            for (const budget of BUDGETS) {
                const at = s.sweep.atBudget[String(budget)]!;
                expect(at.photonRequests, `${s.id} at ${budget}`).toBeLessThanOrEqual(budget);
                expect(at.known, `${s.id} at ${budget}`).toBeGreaterThanOrEqual(before);
                before = at.known;
            }
            // The largest segment (2,637 places) is the slow one; every other is near done at 64.
            const at64 = s.sweep.atBudget["64"]!.knownShare;
            expect(at64, s.id).toBeGreaterThan(s.population.overpassNamed > 1_000 ? 0.4 : 0.95);
        }
    });

    it("carries on over runs of 64 until every box is answered, never sending an answered request again", () => {
        for (const s of replay.segments) {
            const r = s.sweep.resume;
            expect(r.repeatedPhotonRequests, s.id).toBe(0);
            // Stopping at the cap and resuming costs the same as one sweep with no cap.
            expect(r.photonAnswered, s.id).toBe(r.photonAnsweredInOneSweep);
            expect(r.runs, s.id).toBeGreaterThanOrEqual(Math.ceil(r.photonAnswered / r.capPerRun));
            // Each run knows at least what the one before knew.
            expect(
                [...r.knownAfterRun].sort((a, b) => a - b),
                s.id
            ).toEqual(r.knownAfterRun);
            expect(r.knownShare, s.id).toBeGreaterThan(0.97);
            expect(r.boxesCutOffAtDepthLimit, s.id).toBe(0);
            if (r.complete) {
                expect(r.boxesUnanswered, s.id).toBe(0);
                // A complete pool is not asked about again.
                expect(r.requestsAfterComplete, s.id).toBe(0);
            } else {
                // Never "complete" with a box missing: it stays open and says so.
                expect(r.boxesUnanswered, s.id).toBeGreaterThan(0);
                expect(r.requestsAfterComplete, s.id).toBeNull();
            }
        }
        const largest = replay.segments.find(s => s.id === "nl-bicycle")!.sweep.resume;
        expect(largest.runs).toBeGreaterThan(3);
        // One recorded Photon request is a 503 (in the breweries sweep): that
        // pool waits for it; the other five finish.
        expect(replay.segments.filter(s => !s.sweep.resume.complete).map(s => s.id)).toEqual([
            "be-brewery",
        ]);
    });

    it("matches the committed result file", () => {
        expect(existsSync(RESULTS)).toBe(true);
        expect(stringifyResults(replay)).toBe(readFileSync(RESULTS, "utf8"));
    });
});
