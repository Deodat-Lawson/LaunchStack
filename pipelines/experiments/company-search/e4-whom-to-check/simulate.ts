/**
 * The simulation: a policy asks for a batch, each company in it costs one
 * check and reveals its hidden label, the policy sees the verdicts, repeat.
 */
import { createRng, hashSeed, type Rng } from "../lib/rng";
import { SIMULATION } from "./config";
import type { Policy, PoolMath, RunContext, SegmentMath } from "./policies";

/** The seed's subsample of a pool, shuffled: the order doubles as the tie-break. */
export function subsampleOf(poolId: string, size: number, seed: number): Int32Array {
    const rng = createRng(hashSeed(`${poolId}|subsample|${seed}`));
    const order = rng.shuffle(Array.from({ length: size }, (_, i) => i));
    return Int32Array.from(order.slice(0, Math.round(size * SIMULATION.subsample)));
}

export function contextFor(
    pool: PoolMath,
    segment: SegmentMath,
    active: Int32Array,
    streamKey: string
): RunContext {
    return {
        pool,
        segment,
        active,
        stream: (name: string): Rng => createRng(hashSeed(`${streamKey}|${name}`)),
    };
}

export interface RunOutcome {
    /** Good companies among the first b checks, per budget. */
    found: number[];
    /** Checks until the shortlist was full, or null when the run ended first. */
    checksToShortlist: number | null;
    /** Checks the run made. */
    checks: number;
}

export interface SimulateOptions {
    batchSize: number;
    budgets: readonly number[];
    shortlist: number;
    /** Checks after which a run stops even if the shortlist is not full. */
    checksCap: number;
}

/**
 * Run one policy on one (segment, seed). The run lasts for the largest budget
 * and then, if the shortlist is not full, on to the cap; a fixed ranking has
 * no cap, since following it further costs nothing to compute.
 */
export function simulate(policy: Policy, ctx: RunContext, options: SimulateOptions): RunOutcome {
    const run = policy.start(ctx);
    const labels = ctx.segment.labels;
    const horizon = Math.max(...options.budgets);
    const cap = policy.fixed ? ctx.active.length : Math.min(options.checksCap, ctx.active.length);
    const found = options.budgets.map(() => 0);
    let checks = 0;
    let good = 0;
    let checksToShortlist: number | null = null;
    while (
        checks < Math.min(horizon, ctx.active.length) ||
        (checksToShortlist === null && checks < cap)
    ) {
        const limit = checks < horizon ? horizon : cap;
        const batch = run.next(Math.min(options.batchSize, limit - checks));
        if (batch.length === 0) break;
        for (const index of batch) {
            const isGood = labels[index] === 1;
            checks += 1;
            if (isGood) {
                good += 1;
                for (const [b, budget] of options.budgets.entries())
                    if (checks <= budget) found[b]! += 1;
                if (good === options.shortlist) checksToShortlist = checks;
            }
        }
        for (const index of batch) run.observe(index, labels[index] === 1);
    }
    return { found, checksToShortlist, checks };
}
