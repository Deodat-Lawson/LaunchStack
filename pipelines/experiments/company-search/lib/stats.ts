/**
 * The few statistics the experiments report: means with a spread, bootstrap
 * confidence intervals, and paired comparisons against the baseline.
 */
import { createRng } from "./rng";

export function mean(values: readonly number[]): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

/** Sample standard deviation (n − 1). */
export function sd(values: readonly number[]): number {
    if (values.length < 2) return 0;
    const m = mean(values);
    let sum = 0;
    for (const v of values) sum += (v - m) * (v - m);
    return Math.sqrt(sum / (values.length - 1));
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(values: readonly number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const at = (sorted.length - 1) * Math.min(1, Math.max(0, q));
    const lo = Math.floor(at);
    const hi = Math.ceil(at);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

export interface Interval {
    mean: number;
    lo: number;
    hi: number;
    n: number;
}

/** Percentile bootstrap of the mean (95% by default), seeded. */
export function bootstrapMean(
    values: readonly number[],
    options: { resamples?: number; seed?: number; level?: number } = {}
): Interval {
    const n = values.length;
    if (n === 0) return { mean: 0, lo: 0, hi: 0, n: 0 };
    const resamples = options.resamples ?? 2_000;
    const level = options.level ?? 0.95;
    const rng = createRng(options.seed ?? 1);
    const means: number[] = [];
    for (let r = 0; r < resamples; r++) {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += values[rng.int(n)]!;
        means.push(sum / n);
    }
    return {
        mean: mean(values),
        lo: quantile(means, (1 - level) / 2),
        hi: quantile(means, 1 - (1 - level) / 2),
        n,
    };
}

/**
 * Paired comparison: `a[i]` and `b[i]` come from the same seed (or the same
 * site, or the same segment). Returns the mean difference a − b with a
 * bootstrap interval, and the share of pairs where a beat b.
 */
export function pairedDifference(
    a: readonly number[],
    b: readonly number[],
    options: { resamples?: number; seed?: number } = {}
): Interval & { wins: number; ties: number } {
    if (a.length !== b.length) throw new Error("pairedDifference needs equal-length samples");
    const diffs = a.map((v, i) => v - b[i]!);
    const interval = bootstrapMean(diffs, options);
    return {
        ...interval,
        wins: diffs.filter(d => d > 0).length / Math.max(1, diffs.length),
        ties: diffs.filter(d => d === 0).length / Math.max(1, diffs.length),
    };
}

/** Round for reports, so result files stay readable and diffs stay small. */
export function round(value: number, digits = 3): number {
    const f = Math.pow(10, digits);
    return Math.round(value * f) / f;
}
