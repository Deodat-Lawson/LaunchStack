/**
 * The shortlist that learns, on the benchmark's pools: E4's seven segments go
 * through production's fit-check loop and learner, beside today's fixed
 * ranking through the same loop, on the local model and on each of the app's
 * built-in embedding models whose vectors are here.
 *
 * Needs the recorded pools and vectors, which are not in git (they hold public
 * contact details); without them the suite is skipped, so it runs on the
 * machine that recorded them and not in CI. Three seeds by default (a minute
 * or two a model); COMPANY_SEARCH_REPLAY_SEEDS=20 replays all twenty and then
 * also checks the numbers against the committed results file. All twenty
 * take 8 to 30 minutes a model, the 1,536-dimension one longest and longer
 * still on a busy machine, so a model gets an hour before it counts as stuck.
 */
import { describe, expect, it } from "vitest";

import { SIMULATION } from "../e4-whom-to-check/config";
import { offlineEmbedder, REPLAY_MODELS } from "./models";
import { readShortlistResults } from "./run";
import { table } from "./shortlist-report";
import { runShortlistReplay } from "./shortlist-run";
import { LOCAL_MODEL, recordingsPresent } from "./vectors";

const seedCount = Math.min(
    SIMULATION.seeds.length,
    Math.max(1, Number(process.env.COMPANY_SEARCH_REPLAY_SEEDS ?? 3))
);
const seeds = SIMULATION.seeds.slice(0, seedCount);
const full = seedCount === SIMULATION.seeds.length;

describe.skipIf(!recordingsPresent())(
    "production replay: the shortlist learns from each verdict",
    () => {
        for (const model of REPLAY_MODELS) {
            it.skipIf(!recordingsPresent(model.id))(
                `finds more good companies per check than today's ranking on ${model.id}`,
                async () => {
                    const { summary } = await runShortlistReplay({
                        embedder: offlineEmbedder(model.id),
                        seeds,
                    });
                    console.log(`\n${model.id}\n${table(summary)}\n`);

                    for (const segment of summary.perSegment) {
                        // Where today's ranking already puts a good company at nearly
                        // every place there is nothing to gain, and looking around
                        // costs a little: under two companies in a hundred over all
                        // twenty seeds, a few more over three.
                        expect(
                            segment.arms.learner.found100,
                            `${segment.segment}: found in 100 checks`
                        ).toBeGreaterThan(segment.arms.today.found100 - (full ? 2 : 6));
                    }
                    const better = summary.perSegment.filter(
                        s => s.arms.learner.found100 > s.arms.today.found100
                    );
                    expect(better.length).toBeGreaterThanOrEqual(5);
                    if (model.id === LOCAL_MODEL) expect(better).toHaveLength(7);

                    const gain = summary.vsToday.learner;
                    expect(gain.found100.mean).toBeGreaterThan(8);
                    expect(gain.found100.lo).toBeGreaterThan(0);
                    expect(gain.found200.lo).toBeGreaterThan(0);
                    // A run fills its 25 places with fewer checks than today's loop.
                    expect(summary.overall.learner.spent.mean).toBeLessThan(
                        summary.overall.today.spent.mean - 10
                    );
                    expect(summary.overall.learner.spent.mean).toBeLessThanOrEqual(
                        summary.overall["today-in-rounds"].spent.mean
                    );

                    if (full) {
                        // The whole replay is deterministic: the committed numbers are these.
                        expect(summary).toEqual(readShortlistResults()?.byEmbedding[model.id]);
                    }
                },
                3_600_000
            );
        }

        // A run drops the companies whose relevance is not above zero before
        // it ranks; the committed results rank the whole pool, as E4 does.
        it.skipIf(!recordingsPresent(LOCAL_MODEL))(
            "is not moved for today's ranking by a run's relevance-above-zero rule, and little for the learner",
            async () => {
                const embedder = offlineEmbedder(LOCAL_MODEL);
                const three = SIMULATION.seeds.slice(0, 3);
                const whole = await runShortlistReplay({ embedder, seeds: three });
                const ruled = await runShortlistReplay({
                    embedder,
                    seeds: three,
                    zeroScoreRule: true,
                });
                // Nobody at or below zero is among the first hundred of the fixed ranking.
                expect(ruled.summary.overall.today.found100).toEqual(
                    whole.summary.overall.today.found100
                );
                const moved =
                    ruled.summary.vsToday.learner.found100.mean -
                    whole.summary.vsToday.learner.found100.mean;
                console.log(
                    `\nlearner minus today in 100 checks, three seeds: ${whole.summary.vsToday.learner.found100.mean} on the whole pool, ${ruled.summary.vsToday.learner.found100.mean} with the rule applied first\n`
                );
                expect(Math.abs(moved)).toBeLessThan(3);
                expect(ruled.summary.vsToday.learner.found100.lo).toBeGreaterThan(0);
            },
            600_000
        );
    }
);

describe.skipIf(recordingsPresent())("production replay: the shortlist (recordings absent)", () => {
    it("is skipped where the recorded pools are not on the machine", () => {
        console.log(
            "The company-search recordings are not here (COMPANY_SEARCH_BENCH_CACHE), so the replay did not run. Its last full result is results/production-shortlist.json."
        );
        const results = readShortlistResults();
        for (const model of REPLAY_MODELS) {
            const gain = results?.byEmbedding[model.id]?.vsToday.learner.found100;
            expect(gain, `${model.id} in the results file`).toBeDefined();
            expect(gain!.lo).toBeGreaterThan(0);
        }
    });
});
