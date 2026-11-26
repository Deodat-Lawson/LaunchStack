/**
 * Production's site reader on the recorded company sites. The recording is
 * not in git (it holds page text with contact details), so this runs only
 * where it exists: in `.cache/`, or wherever COMPANY_SEARCH_BENCH_CACHE
 * points. It never touches the network.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CACHE_DIR } from "../lib/recorder";
import { buildDataset, CACHE_NAMESPACE } from "./dataset";
import { measureProductionReader } from "./production";

const recorded = existsSync(path.join(DEFAULT_CACHE_DIR, CACHE_NAMESPACE));

describe.skipIf(!recorded)("production's site reader on the recorded sites", () => {
    it("finds more than the guessed-path reader did, within four requests a site", async () => {
        const dataset = await buildDataset({ mode: "replay" });
        expect(dataset.live).toBe(0);
        const report = await measureProductionReader(dataset.ctx, dataset.sites);
        const all = report.byScope.all;

        // The budget holds on every site, and little of it is wasted.
        expect(report.requestsPerSite).toBe(4);
        expect(all.production.requests.max).toBeLessThanOrEqual(4);
        expect(all.production.requests.wastedShare).toBeLessThan(0.1);
        // The guessed-path reader spent three times as much.
        expect(all.today.meanRequests).toBeGreaterThan(3 * all.production.requests.mean);

        // What the experiment measured for following links at 4 requests: a contact
        // email on 74% of sites and 2.51 of 5 fact types, against 58% and 2.12.
        expect(all.production.found.email).toBeGreaterThanOrEqual(0.7);
        expect(all.production.meanScore.mean).toBeGreaterThanOrEqual(2.4);
        expect(all.versusToday.score.lo).toBeGreaterThan(0.2);
        expect(all.versusToday.email.lo).toBeGreaterThan(0.05);
        for (const group of ["no", "nlde", "en"] as const) {
            const scope = report.byScope[group];
            expect(scope.production.found.email, group).toBeGreaterThan(scope.today.email);
            expect(scope.versusToday.score.lo, group).toBeGreaterThan(0);
        }

        // Production's own link parser and word list choose the pages the
        // experiment's choose, except where the recording has no answer.
        expect(report.check.sameRanking).toBe(report.check.sites);
        expect(report.check.dossiers).toBe(report.check.sites);
        expect(report.check.sameRequests).toBeGreaterThanOrEqual(
            report.check.sites - report.check.sitesWithRequestsNotRecorded
        );
        expect(report.check.sameFacts).toBe(report.check.sameRequests);
        expect(report.check.sitesWithRequestsNotRecorded).toBeLessThanOrEqual(5);
    }, 180_000);
});
