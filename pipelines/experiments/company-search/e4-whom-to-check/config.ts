/**
 * Every number the experiment depends on, in one place.
 *
 * The simulation's shape (budgets, batch sizes, seeds, the 80% subsample) and
 * Rocchio's weights come from the experiment's brief. The remaining
 * hyper-parameters were picked by tune.ts on the two development segments
 * (yc-education, yc-fintech) with seeds 101–110, before any reported segment
 * was run; the grids and the rule are in the README. Nothing here was changed
 * after looking at a reported result.
 */

export const SIMULATION = {
    /** Checks revealed together before a policy may re-rank. */
    batchSize: 5,
    /** Batch sizes of the sensitivity runs. */
    otherBatchSizes: [1, 10],
    budgets: [25, 50, 100, 200],
    /** Production's shortlist size: how many good companies a run is after. */
    shortlist: 25,
    /**
     * A policy that has not filled the shortlist after the largest budget keeps
     * going until this many checks, so "checks to 25" is rarely cut short.
     */
    checksCap: 500,
    seeds: Array.from({ length: 20 }, (_, i) => i + 1),
    /** Share of the pool each seed draws. */
    subsample: 0.8,
} as const;

export const TUNING = {
    seeds: Array.from({ length: 10 }, (_, i) => i + 101),
    /** The budget whose count of good companies the tuning maximises. */
    budget: 100,
} as const;

export interface Hyper {
    rocchio: { alpha: number; beta: number; gamma: number };
    logreg: {
        /** Inverse L2 strength (the usual C). */
        c: number;
        /** Random unchecked companies treated as negatives until real negatives replace them. */
        provisionalNegatives: number;
        /** Share of checks the ε-greedy variant spends on a random company. */
        epsilon: number;
    };
    bayes: {
        /** Principal directions of the pool's embeddings the linear model sees. */
        dims: number;
        /** Assumed spread of a verdict around the model's prediction. */
        noiseSd: number;
        /** Prior spread of the weight on today's score, around 1. */
        priorSdScore: number;
        /** Prior spread of the intercept. */
        priorSdBias: number;
    };
    thompson: {
        /** Prior spread of the weights on the projected embedding. */
        priorSdProjection: number;
    };
    linucb: {
        priorSdProjection: number;
        /** Standard deviations of optimism added to the predicted score. */
        bonus: number;
    };
    knn: {
        /** Nearest checked companies of each kind that count. */
        neighbours: number;
        /** Weight of the neighbour term against today's score. */
        weight: number;
    };
}

export const HYPER: Hyper = {
    rocchio: { alpha: 1, beta: 0.75, gamma: 0.15 },
    logreg: { c: 10, provisionalNegatives: 100, epsilon: 0.1 },
    bayes: { dims: 48, noiseSd: 0.5, priorSdScore: 0.25, priorSdBias: 1 },
    thompson: { priorSdProjection: 0.1 },
    linucb: { priorSdProjection: 0.4, bonus: 0.5 },
    knn: { neighbours: 3, weight: 4 },
};

/** The grids tune.ts searches; the first value wins a tie. */
export const GRIDS = {
    logregC: [1, 10, 100, 1000],
    thompsonPriorSd: [0.05, 0.1, 0.2, 0.4, 0.8],
    linucbPriorSd: [0.05, 0.1, 0.2, 0.4, 0.8],
    linucbBonus: [0.1, 0.25, 0.5, 1, 2],
    knnWeight: [0.5, 1, 2, 4, 8, 16],
} as const;
