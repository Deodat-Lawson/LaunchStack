/**
 * The segment brief's language, on the benchmark's three Norwegian pools,
 * through production's relevance and today's fixed order.
 *
 * On the local model a Norwegian brief finds more than twice as many good
 * companies as an English one (E4's finding). On the app's two built-in
 * embedding models it finds no more, which is why Prospects does not translate
 * the brief. Both halves are checked here.
 *
 * Needs the recorded pools and vectors, which are not in git; without them the
 * suite is skipped, so it runs on the machine that recorded them and not in
 * CI. Three seeds by default; COMPANY_SEARCH_REPLAY_SEEDS=20 replays all
 * twenty and then also checks the numbers against the committed results file.
 */
import { describe, expect, it } from "vitest";

import { SIMULATION } from "../e4-whom-to-check/config";
import { briefTable, runBriefLanguageReplay } from "./brief-language";
import { offlineEmbedder, REPLAY_MODELS } from "./models";
import { readBriefResults } from "./run";
import { LOCAL_MODEL, recordingsPresent } from "./vectors";

const seedCount = Math.min(
    SIMULATION.seeds.length,
    Math.max(1, Number(process.env.COMPANY_SEARCH_REPLAY_SEEDS ?? 3))
);
const seeds = SIMULATION.seeds.slice(0, seedCount);
const full = seedCount === SIMULATION.seeds.length;
const production = REPLAY_MODELS.filter(model => model.indexKey !== null);

describe.skipIf(!recordingsPresent())(
    "production replay: the brief in the buyers' language",
    () => {
        it("reproduces E4's gap on the local model", async () => {
            const summary = await runBriefLanguageReplay({
                embedder: offlineEmbedder(LOCAL_MODEL),
                seeds,
            });
            console.log(`\n${briefTable(LOCAL_MODEL, summary)}\n`);
            // 25.0 against 58.5 with all twenty seeds.
            expect(summary.norwegianMinusEnglish.found100.mean).toBeGreaterThan(20);
            const kept = Object.fromEntries(
                summary.perSegment.map(s => [s.segment, s.zeroScoreRule.english.goodKept])
            );
            // With an English brief the zero-score rule drops 40% and 89% of the good companies.
            expect(kept["brreg-breweries"]).toBeLessThan(0.65);
            expect(kept["brreg-dental-bergen"]).toBeLessThan(0.15);
            if (full) expect(summary).toEqual(readBriefResults()?.byEmbedding[LOCAL_MODEL]);
        }, 300_000);

        for (const model of production) {
            it.skipIf(!recordingsPresent(model.id))(
                `finds no such gap on ${model.id}`,
                async () => {
                    const summary = await runBriefLanguageReplay({
                        embedder: offlineEmbedder(model.id),
                        seeds,
                    });
                    console.log(`\n${briefTable(model.id, summary)}\n`);
                    const gap = summary.norwegianMinusEnglish.found100;
                    // The Norwegian brief is not reliably better: the interval reaches zero or below.
                    expect(gap.mean).toBeLessThan(5);
                    expect(gap.lo).toBeLessThanOrEqual(0);
                    // And today's ranking is far better than on the local model either way.
                    expect(summary.overall.english.found100.mean).toBeGreaterThan(60);
                    // The zero-score rule keeps most good companies, English brief or not.
                    for (const segment of summary.perSegment)
                        expect(
                            segment.zeroScoreRule.english.goodKept,
                            `${segment.segment}: good companies the zero-score rule keeps`
                        ).toBeGreaterThan(0.8);
                    if (full) expect(summary).toEqual(readBriefResults()?.byEmbedding[model.id]);
                },
                300_000
            );
        }
    }
);

describe.skipIf(recordingsPresent())("production replay: the brief (recordings absent)", () => {
    it("is skipped where the recorded pools are not on the machine", () => {
        console.log(
            "The company-search recordings are not here (COMPANY_SEARCH_BENCH_CACHE), so the replay did not run. Its last full result is results/production-brief-language.json."
        );
        const results = readBriefResults();
        expect(results?.byEmbedding[LOCAL_MODEL]).toBeDefined();
        // What the decision rests on is in the committed file: no gap on the built-in models.
        for (const model of production) {
            const gap = results?.byEmbedding[model.id]?.norwegianMinusEnglish.found100;
            expect(gap, `${model.id} in the results file`).toBeDefined();
            expect(gap!.mean).toBeLessThan(5);
        }
    });
});
