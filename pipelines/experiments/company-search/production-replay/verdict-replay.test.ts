/**
 * The learning shortlist on real fit-check verdicts: one pool whose every
 * company production's fit check was asked about, replayed through
 * production's loop and learner.
 *
 * Needs the recorded pool, vectors and verdicts, none of which are in git;
 * without them the suite is skipped. Three seeds by default;
 * COMPANY_SEARCH_REPLAY_SEEDS=20 replays all twenty and then also checks the
 * numbers against the committed results file.
 */
import { describe, expect, it } from "vitest";

import { SIMULATION } from "../e4-whom-to-check/config";
import { offlineEmbedder, REPLAY_MODELS } from "./models";
import { JUDGED_SEGMENT, readVerdictResults } from "./run";
import { LOCAL_MODEL, recordingsPresent } from "./vectors";
import { runVerdictReplay, verdictTable } from "./verdict-replay";
import { readVerdicts } from "./verdicts";

const seedCount = Math.min(
    SIMULATION.seeds.length,
    Math.max(1, Number(process.env.COMPANY_SEARCH_REPLAY_SEEDS ?? 3))
);
const seeds = SIMULATION.seeds.slice(0, seedCount);
const full = seedCount === SIMULATION.seeds.length;
const recorded = recordingsPresent() && readVerdicts(JUDGED_SEGMENT, "en") !== null;

describe.skipIf(!recorded)("production replay: the shortlist on real fit-check verdicts", () => {
    for (const model of REPLAY_MODELS) {
        it.skipIf(!recordingsPresent(model.id))(
            `learns from what the fit check really said, on ${model.id}`,
            async () => {
                const summary = await runVerdictReplay({
                    embedder: offlineEmbedder(model.id),
                    segment: JUDGED_SEGMENT,
                    seeds,
                });
                console.log(`\n${verdictTable(model.id, summary)}\n`);

                // The fit check and the register mostly call the same companies good.
                expect(summary.agreement.agree).toBeGreaterThan(0.9);
                // Asked again in another batch, a verdict rarely changes.
                expect(summary.stability!.changed / summary.stability!.asked).toBeLessThan(0.05);

                for (const counted of [summary.judged, summary.register]) {
                    const today = counted.overall.today;
                    const learner = counted.overall.learner;
                    // Never much behind today's ranking, however good that already is.
                    expect(learner.found100.mean).toBeGreaterThan(today.found100.mean - 2);
                    expect(learner.spent.mean).toBeLessThanOrEqual(today.spent.mean);
                }
                // Where today's ranking is weak (the local model reads Norwegian
                // poorly against an English brief), real verdicts rescue it.
                if (model.id === LOCAL_MODEL)
                    expect(summary.judged.vsToday.learner.found100.mean).toBeGreaterThan(30);

                if (full) expect(summary).toEqual(readVerdictResults()?.byEmbedding[model.id]);
            },
            900_000
        );
    }
});

describe.skipIf(recorded)("production replay: real verdicts (recordings absent)", () => {
    it("is skipped where the recorded verdicts are not on the machine", () => {
        console.log(
            "The recorded fit-check verdicts are not here (COMPANY_SEARCH_BENCH_CACHE), so the replay did not run. Its last full result is results/production-verdicts.json."
        );
        expect(readVerdictResults()?.byEmbedding[LOCAL_MODEL]).toBeDefined();
    });
});
