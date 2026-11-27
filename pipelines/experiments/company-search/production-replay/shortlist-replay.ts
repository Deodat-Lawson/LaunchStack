/**
 * "The shortlist learns from each verdict", replayed: the benchmark's pools
 * (E4) go through production's own fit-check loop
 * (src/distribution/shortlist.ts) and learner (src/distribution/learn.ts),
 * beside today's fixed ranking through the same loop.
 *
 * A check here reveals a company's hidden label, as in E4: the judge port
 * answers from the register code or the directory tag. No row leaves the
 * cache: the loop sees ids, and the results are counts.
 *
 * Three ways of checking, per pool and seed:
 *   today            the fixed ranking, production's loop as it was
 *   today-in-rounds  the fixed ranking asked in the learner's small rounds,
 *                    so what the round size alone changes is visible
 *   learner          production's learner picks every round
 */
import {
    learnerOverFeatures,
    shortlistFeatures,
    type LearnerSettings,
    type ShortlistLearner,
} from "../../../src/distribution/learn";
import {
    semanticRelevance,
    type EmbedTexts,
    type FitVerdict,
} from "../../../src/distribution/semantic";
import {
    fillShortlist,
    LEARNING_ROUND,
    type FillShortlistArgs,
    type ShortlistCandidate,
} from "../../../src/distribution/shortlist";
import { briefOf, segmentText, type BriefLanguage } from "../e4-whom-to-check/briefs";
import type { LoadedPool } from "../e4-whom-to-check/data";
import type { Segment } from "../e4-whom-to-check/segments";
import { subsampleOf } from "../e4-whom-to-check/simulate";
import type { ReplayEmbedder } from "./vectors";

export const BUDGETS = [25, 50, 100, 200] as const;
/** Production's default shortlist size (RunOptions.maxCandidates). */
export const SHORTLIST = 25;
/** As in E4: a run that has not found 25 good companies by here counts as this many checks. */
export const CHECKS_CAP = 500;

export const ARMS = ["today", "today-in-rounds", "learner"] as const;
export type Arm = (typeof ARMS)[number];

export interface SeedOutcome {
    /** Good companies among the first b checks, per budget. */
    found: number[];
    /** Checks until the 25th good company was checked; the cap when it never was. */
    checksTo25: number;
    /** Checks production's loop spent before a 25-place shortlist was full. */
    spent: number;
    /** Rounds of that run (the fit check makes one model call per twenty companies of a round). */
    rounds: number;
}

export interface PreparedSegment {
    segment: Segment;
    language: BriefLanguage;
    pool: LoadedPool;
    brief: string;
    /** Production's semanticRelevance of every company in the pool to the brief. */
    relevance: number[];
    vectors: number[][];
    /** 1 where a company counts as good: what the results count. */
    labels: Uint8Array;
    /**
     * What a check answers, when that is not the label itself: a recorded
     * fit-check verdict per company (verdict-replay.ts). The loop and the
     * learner see only this.
     */
    reveals?: Uint8Array;
}

/** Everything about a (segment, brief) that does not depend on the seed. */
export async function prepareSegment(
    embedder: ReplayEmbedder,
    pool: LoadedPool,
    segment: Segment,
    language: BriefLanguage
): Promise<PreparedSegment> {
    const brief = briefOf(segmentText(segment, language));
    const embed: EmbedTexts = texts => embedder.embed(texts);
    return {
        segment,
        language,
        pool,
        brief,
        relevance: await semanticRelevance(embed, brief, pool.texts),
        vectors: await embedder.embed(pool.texts),
        labels: pool.labels(segment.label),
    };
}

/** The fixed order, behind the learner's interface: it picks the next ones down the list. */
function fixedOrder(size: number): Pick<ShortlistLearner, "next" | "observe" | "skip"> {
    let at = 0;
    return {
        next(count) {
            const out = Array.from({ length: Math.min(count, size - at) }, (_, i) => at + i);
            at += out.length;
            return out;
        },
        observe() {
            /* a fixed order learns nothing */
        },
        skip() {
            /* nor from a company nobody judged */
        },
    };
}

export interface ReplayOptions {
    settings?: Partial<LearnerSettings>;
    roundSize?: number;
    arms?: readonly Arm[];
    /**
     * Drop the companies whose relevance is not above zero before anything is
     * ranked, as a run does (src/distribution/run.ts). Off in the committed
     * results, which rank every company of a pool as E4 does.
     */
    zeroScoreRule?: boolean;
}

/**
 * One seed of one segment: the seed's 80% draw of the pool is the run's
 * candidates, in today's order (relevance, ties in the draw's order).
 */
export async function replaySeed(
    prepared: PreparedSegment,
    seed: number,
    options: ReplayOptions = {}
): Promise<Partial<Record<Arm, SeedOutcome>>> {
    const { pool, relevance, vectors, labels } = prepared;
    const reveals = prepared.reveals ?? labels;
    const active = subsampleOf(pool.spec.id, pool.size, seed);
    const order = Array.from({ length: active.length }, (_, a) => a)
        .sort((a, b) => relevance[active[b]!]! - relevance[active[a]!]! || a - b)
        .map(a => active[a]!)
        .filter(i => !options.zeroScoreRule || relevance[i]! > 0);
    const queue: ShortlistCandidate[] = order.map(i => ({ id: String(i), name: "", text: "" }));
    const judge: FillShortlistArgs["judge"] = async batch =>
        new Map<string, FitVerdict>(
            batch.map(c => [c.id, { fit: reveals[Number(c.id)] === 1, reason: "" }])
        );
    const roundSize = options.roundSize ?? LEARNING_ROUND;

    const features = (options.arms ?? ARMS).includes("learner")
        ? await shortlistFeatures({
              vectors: order.map(i => vectors[i]!),
              relevance: order.map(i => relevance[i]!),
              settings: options.settings,
          })
        : null;
    const learnerFor = (arm: Arm): FillShortlistArgs["learner"] =>
        arm === "today"
            ? null
            : arm === "today-in-rounds"
              ? fixedOrder(queue.length)
              : learnerOverFeatures({ ...features!, settings: options.settings });

    const out: Partial<Record<Arm, SeedOutcome>> = {};
    for (const arm of options.arms ?? ARMS) {
        // How many good companies the first b checks find: the loop with no
        // shortlist to fill, stopped at the cap.
        const long = await fillShortlist({
            queue,
            wanted: queue.length + 1,
            judge,
            learner: learnerFor(arm),
            roundSize,
            maxChecks: CHECKS_CAP,
        });
        const found = BUDGETS.map(() => 0);
        let good = 0;
        let checksTo25 = CHECKS_CAP;
        for (const [at, id] of long.checked.entries()) {
            if (labels[Number(id)] !== 1) continue;
            good += 1;
            for (const [b, budget] of BUDGETS.entries()) if (at < budget) found[b]! += 1;
            if (good === SHORTLIST) checksTo25 = Math.min(checksTo25, at + 1);
        }
        // What a run spends: production's loop until 25 places are full.
        const run = await fillShortlist({
            queue,
            wanted: SHORTLIST,
            judge,
            learner: learnerFor(arm),
            roundSize,
        });
        out[arm] = { found, checksTo25, spent: run.checked.length, rounds: run.rounds };
    }
    return out;
}
