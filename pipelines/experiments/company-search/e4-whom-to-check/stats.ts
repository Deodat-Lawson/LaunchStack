/**
 * Statistics on top of ../lib/stats: rounded intervals for the report, and a
 * two-level bootstrap for numbers that average over pools.
 *
 * Seeds within a pool share most of their companies, so they are not
 * independent draws of "a new segment". An interval over all (pool, seed)
 * pairs would pretend they are. The overall intervals therefore resample
 * pools first and seeds inside each drawn pool: they say how far the average
 * could move with a different set of pools, as far as seven pools can tell.
 */
import { createRng } from "../lib/rng";
import { bootstrapMean, mean, pairedDifference, quantile, round } from "../lib/stats";

/** One seed for every bootstrap, so the results file is the same on every run. */
const BOOTSTRAP_SEED = 20261124;
const RESAMPLES = 2_000;

export interface Spread {
    mean: number;
    lo: number;
    hi: number;
}

export interface Paired extends Spread {
    /** Share of seeds where the policy beat today's ranking. */
    wins: number;
    ties: number;
}

export function spread(values: readonly number[], digits = 2): Spread {
    const interval = bootstrapMean(values, { resamples: RESAMPLES, seed: BOOTSTRAP_SEED });
    return {
        mean: round(interval.mean, digits),
        lo: round(interval.lo, digits),
        hi: round(interval.hi, digits),
    };
}

/** Mean of a − b over seeds, with a bootstrap interval. */
export function paired(a: readonly number[], b: readonly number[], digits = 2): Paired {
    const d = pairedDifference(a, b, { resamples: RESAMPLES, seed: BOOTSTRAP_SEED });
    return {
        mean: round(d.mean, digits),
        lo: round(d.lo, digits),
        hi: round(d.hi, digits),
        wins: round(d.wins, 2),
        ties: round(d.ties, 2),
    };
}

/**
 * The mean of the pools' means, with a 95% interval from resampling pools and
 * then seeds within each drawn pool.
 */
export function clustered(byPool: ReadonlyArray<readonly number[]>, digits = 2): Spread {
    const pools = byPool.length;
    if (pools === 0) return { mean: 0, lo: 0, hi: 0 };
    const rng = createRng(BOOTSTRAP_SEED);
    const draws: number[] = [];
    for (let r = 0; r < RESAMPLES; r++) {
        let total = 0;
        for (let p = 0; p < pools; p++) {
            const values = byPool[rng.int(pools)]!;
            let sum = 0;
            for (let draw = values.length; draw > 0; draw--) sum += values[rng.int(values.length)]!;
            total += sum / Math.max(1, values.length);
        }
        draws.push(total / pools);
    }
    return {
        mean: round(mean(byPool.map(values => mean(values))), digits),
        lo: round(quantile(draws, 0.025), digits),
        hi: round(quantile(draws, 0.975), digits),
    };
}

export function difference(a: readonly number[], b: readonly number[]): number[] {
    return a.map((v, i) => v - b[i]!);
}

export { mean, quantile, round };
