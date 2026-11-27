/**
 * "A later run starts from the verdicts it kept", replayed on real fit-check
 * verdicts.
 *
 * A pool is split in two at random. Run 1 works through the first half with
 * production's loop and learner until its shortlist is full; every verdict it
 * got is kept, as a run keeps them (src/distribution/db.ts). Run 2 then meets
 * the other half, companies it has never seen, three ways:
 *
 *   today    the fixed ranking, production's loop as it was
 *   fresh    the learner, starting from nothing
 *   seeded   the learner, starting from run 1's kept verdicts
 *
 * What a check answers is the recorded verdict of production's fit check
 * (verdicts.ts), and a company is good when that verdict was yes.
 */
import {
    learnerOverFeatures,
    shortlistFeatures,
    type EarlierVerdict,
} from "../../../src/distribution/learn";
import type { FitVerdict } from "../../../src/distribution/semantic";
import {
    fillShortlist,
    type FillShortlistArgs,
    type ShortlistCandidate,
} from "../../../src/distribution/shortlist";
import { mean, round } from "../e4-whom-to-check/stats";
import { bootstrapMean } from "../lib/stats";
import { createRng, hashSeed } from "../lib/rng";
import { SHORTLIST, type PreparedSegment } from "./shortlist-replay";

export const LATER_ARMS = ["today", "fresh", "seeded"] as const;
export type LaterArm = (typeof LATER_ARMS)[number];

const BUDGETS = [10, 25, 50] as const;
type Metric = "found10" | "found25" | "found50" | "spent";

export interface LaterRunSummary {
    seeds: number;
    /** Companies in each half. */
    half: number;
    /** Verdicts run 1 kept, mean over seeds. */
    kept: number;
    /** Run 2, mean over seeds: yes's in its first 10, 25 and 50 checks, and checks spent to fill 25 places. */
    arms: Record<LaterArm, Record<Metric, number>>;
    /** Seeded minus fresh, paired by seed, with a 95% interval over seeds. */
    seededMinusFresh: Record<Metric, { mean: number; lo: number; hi: number }>;
}

interface Outcome {
    found: number[];
    spent: number;
}

export async function runLaterRunReplay(
    prepared: PreparedSegment,
    seeds: readonly number[]
): Promise<LaterRunSummary> {
    const { pool, relevance, vectors } = prepared;
    const verdicts = prepared.reveals ?? prepared.labels;
    const judge: FillShortlistArgs["judge"] = async batch =>
        new Map<string, FitVerdict>(
            batch.map(c => [c.id, { fit: verdicts[Number(c.id)] === 1, reason: "" }])
        );
    /** A half in today's order: relevance, ties in the split's order. */
    const queueOf = (indexes: number[]): number[] =>
        indexes
            .map((index, at) => ({ index, at }))
            .sort((a, b) => relevance[b.index]! - relevance[a.index]! || a.at - b.at)
            .map(entry => entry.index);
    const candidates = (order: number[]): ShortlistCandidate[] =>
        order.map(i => ({ id: String(i), name: "", text: "" }));

    const runs = Object.fromEntries(LATER_ARMS.map(arm => [arm, [] as Outcome[]])) as Record<
        LaterArm,
        Outcome[]
    >;
    const kept: number[] = [];
    let half = 0;
    for (const seed of seeds) {
        const shuffled = createRng(hashSeed(`${pool.spec.id}|later-run|${seed}`)).shuffle(
            Array.from({ length: pool.size }, (_, i) => i)
        );
        half = Math.floor(pool.size / 2);
        const first = queueOf(shuffled.slice(0, half));
        const second = queueOf(shuffled.slice(half, 2 * half));

        // Run 1: the learner from nothing, until its shortlist is full.
        const one = await fillShortlist({
            queue: candidates(first),
            wanted: SHORTLIST,
            judge,
            learner: learnerOverFeatures(
                await shortlistFeatures({
                    vectors: first.map(i => vectors[i]!),
                    relevance: first.map(i => relevance[i]!),
                })
            ),
        });
        const earlier: EarlierVerdict[] = one.checked.map(id => ({
            vector: vectors[Number(id)]!,
            relevance: relevance[Number(id)]!,
            good: verdicts[Number(id)] === 1,
        }));
        kept.push(earlier.length);

        // Run 2 on the other half.
        const features = {
            fresh: await shortlistFeatures({
                vectors: second.map(i => vectors[i]!),
                relevance: second.map(i => relevance[i]!),
            }),
            seeded: await shortlistFeatures({
                vectors: second.map(i => vectors[i]!),
                relevance: second.map(i => relevance[i]!),
                earlier,
            }),
        };
        for (const arm of LATER_ARMS) {
            const learnerFor = (): FillShortlistArgs["learner"] =>
                arm === "today" ? null : learnerOverFeatures(features[arm]);
            const long = await fillShortlist({
                queue: candidates(second),
                wanted: second.length + 1,
                judge,
                learner: learnerFor(),
                maxChecks: Math.max(...BUDGETS),
            });
            const found = BUDGETS.map(
                budget =>
                    long.checked.slice(0, budget).filter(id => verdicts[Number(id)] === 1).length
            );
            const filled = await fillShortlist({
                queue: candidates(second),
                wanted: SHORTLIST,
                judge,
                learner: learnerFor(),
            });
            runs[arm].push({ found, spent: filled.checked.length });
        }
    }

    const valuesOf = (arm: LaterArm, metric: Metric): number[] =>
        metric === "spent"
            ? runs[arm].map(o => o.spent)
            : runs[arm].map(o => o.found[BUDGETS.indexOf(Number(metric.slice(5)) as 10)]!);
    const metrics: Metric[] = ["found10", "found25", "found50", "spent"];
    return {
        seeds: seeds.length,
        half,
        kept: round(mean(kept), 1),
        arms: Object.fromEntries(
            LATER_ARMS.map(arm => [
                arm,
                Object.fromEntries(
                    metrics.map(metric => [metric, round(mean(valuesOf(arm, metric)), 2)])
                ),
            ])
        ) as LaterRunSummary["arms"],
        seededMinusFresh: Object.fromEntries(
            metrics.map(metric => {
                const seeded = valuesOf("seeded", metric);
                const fresh = valuesOf("fresh", metric);
                const interval = bootstrapMean(
                    seeded.map((v, i) => v - fresh[i]!),
                    { resamples: 2_000, seed: 20261126 }
                );
                return [
                    metric,
                    {
                        mean: round(interval.mean, 2),
                        lo: round(interval.lo, 2),
                        hi: round(interval.hi, 2),
                    },
                ];
            })
        ) as LaterRunSummary["seededMinusFresh"],
    };
}
