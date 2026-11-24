/**
 * Runs every policy against one discovery environment and reduces the
 * traces to the numbers the report shows. Shared by E1 and E2 so both
 * experiments are measured the same way.
 */
import { policySet, type Policy } from "./bandits";
import { at, simulate, simulateOracle, type DiscoveryEnv, type Trace } from "./discovery";
import { hashSeed } from "./rng";
import { bootstrapMean, mean, pairedDifference, round } from "./stats";

export interface Spread {
    mean: number;
    lo: number;
    hi: number;
}

export interface PolicyResult {
    id: string;
    label: string;
    family: Policy["family"];
    /** True for a policy added after the frozen design was scored (exploratory). */
    postHoc: boolean;
    seeds: number;
    /** Mean targets known after each budget, with a 95% interval over seeds. */
    found: Record<string, Spread>;
    /** Of those, the ones the environment marks as bonus (e.g. has a website). */
    bonus: Record<string, Spread>;
    /** Share of requests that returned no new target, at the largest budget. */
    wastedShare: number;
    /** Mean requests needed to know a share of the reachable targets (null = not within the long budget). */
    requestsToCoverage: Record<string, number | null>;
    /** Mean curve, one point per request, for the charts. */
    curve: number[];
    bonusCurve: number[];
    /** Paired difference in targets known against the fixed-order plan (same budget). */
    versusPlanStatic: Record<string, Spread & { wins: number }>;
}

export interface EstimatorPoint {
    /** Share of the reachable targets actually known at this budget. */
    knownShare: number;
    /** Chao1 population estimate divided by the true reachable population (1 = exact). */
    chao1OverTruth: number;
    /** Good-Turing estimate of the share already seen. */
    goodTuringCoverage: number;
}

export interface EvaluateOptions {
    /** Used to derive seeds, so segments do not share random streams. */
    id: string;
    budgets: readonly number[];
    /** Budget for the reported curves. */
    maxBudget: number;
    /** Budget for "requests to reach x% of the population". */
    longBudget: number;
    seeds: number;
    /** Targets the recorded interface can return at all. */
    reachable: number;
    coverageMarks: readonly number[];
    letters: boolean;
    /** Policies whose runs also report the population estimators. */
    estimatorPolicies: readonly string[];
}

function spread(values: readonly number[]): Spread {
    const interval = bootstrapMean(values, { seed: 11 });
    return { mean: round(interval.mean, 2), lo: round(interval.lo, 2), hi: round(interval.hi, 2) };
}

function requestsTo(traces: readonly Trace[], target: number): number | null {
    const needed: number[] = [];
    for (const trace of traces) {
        const index = trace.found.findIndex(v => v >= target);
        if (index < 0) return null;
        needed.push(index + 1);
    }
    return round(mean(needed), 1);
}

export function evaluatePolicies(
    env: DiscoveryEnv,
    options: EvaluateOptions
): { policies: PolicyResult[]; estimators: Record<string, Record<string, EstimatorPoint>> } {
    const policies = policySet({ cap: env.cap, letters: options.letters });
    const run = (policy: Policy, budget: number): Trace[] =>
        Array.from({ length: policy.stochastic ? options.seeds : 1 }, (_, i) =>
            simulate(env, policy, { budget, seed: hashSeed(`${options.id}|${policy.id}|${i}`) })
        );

    // A run's first n requests do not depend on its budget, so one long run
    // per seed serves both the reported curve and the cost of deep coverage.
    const planStatic = policies.find(p => p.id === "plan-static")!;
    const baseline = run(planStatic, options.longBudget)[0]!;
    const results: PolicyResult[] = [];
    const estimators: Record<string, Record<string, EstimatorPoint>> = {};

    for (const policy of policies) {
        const traces = policy.id === planStatic.id ? [baseline] : run(policy, options.longBudget);
        const long = traces;
        const result: PolicyResult = {
            id: policy.id,
            label: policy.label,
            family: policy.family,
            postHoc: policy.postHoc === true,
            seeds: traces.length,
            found: {},
            bonus: {},
            wastedShare: round(
                mean(
                    traces.map(t => {
                        const n = Math.min(options.maxBudget, t.requests);
                        return n === 0 ? 0 : t.wastedBy[n - 1]! / n;
                    })
                ),
                3
            ),
            requestsToCoverage: {},
            curve: Array.from({ length: options.maxBudget }, (_, i) =>
                round(mean(traces.map(t => at(t.found, i + 1))), 2)
            ),
            bonusCurve: Array.from({ length: options.maxBudget }, (_, i) =>
                round(mean(traces.map(t => at(t.bonus, i + 1))), 2)
            ),
            versusPlanStatic: {},
        };
        for (const budget of options.budgets) {
            const mine = traces.map(t => at(t.found, budget));
            result.found[budget] = spread(mine);
            result.bonus[budget] = spread(traces.map(t => at(t.bonus, budget)));
            // The fixed-order plan is one deterministic run: every seed is compared with it.
            const diff = pairedDifference(
                mine,
                mine.map(() => at(baseline.found, budget)),
                { seed: 13 }
            );
            result.versusPlanStatic[budget] = {
                mean: round(diff.mean, 2),
                lo: round(diff.lo, 2),
                hi: round(diff.hi, 2),
                wins: round(diff.wins, 2),
            };
        }
        for (const mark of options.coverageMarks)
            result.requestsToCoverage[mark] = requestsTo(long, Math.ceil(options.reachable * mark));
        results.push(result);

        if (options.estimatorPolicies.includes(policy.id)) {
            estimators[policy.id] = Object.fromEntries(
                options.budgets.map(budget => [
                    budget,
                    {
                        knownShare: round(
                            mean(traces.map(t => at(t.found, budget))) / options.reachable,
                            3
                        ),
                        chao1OverTruth: round(
                            mean(traces.map(t => at(t.chao1, budget))) / options.reachable,
                            3
                        ),
                        goodTuringCoverage: round(mean(traces.map(t => at(t.coverage, budget))), 3),
                    },
                ])
            );
        }
    }

    const oracle = simulateOracle(env, options.longBudget);
    const bound: PolicyResult = {
        id: "oracle",
        label: "Oracle (knows every answer in advance)",
        family: "bound",
        postHoc: false,
        seeds: 1,
        found: {},
        bonus: {},
        wastedShare: round(
            (oracle.wastedBy[Math.min(options.maxBudget, oracle.requests) - 1] ?? 0) /
                Math.max(1, Math.min(options.maxBudget, oracle.requests)),
            3
        ),
        requestsToCoverage: {},
        curve: Array.from({ length: options.maxBudget }, (_, i) => at(oracle.found, i + 1)),
        bonusCurve: Array.from({ length: options.maxBudget }, (_, i) => at(oracle.bonus, i + 1)),
        versusPlanStatic: {},
    };
    for (const budget of options.budgets) {
        const found = at(oracle.found, budget);
        const bonus = at(oracle.bonus, budget);
        bound.found[budget] = { mean: found, lo: found, hi: found };
        bound.bonus[budget] = { mean: bonus, lo: bonus, hi: bonus };
        const diff = found - at(baseline.found, budget);
        bound.versusPlanStatic[budget] = { mean: diff, lo: diff, hi: diff, wins: diff > 0 ? 1 : 0 };
    }
    for (const mark of options.coverageMarks)
        bound.requestsToCoverage[mark] = requestsTo([oracle], Math.ceil(options.reachable * mark));
    results.push(bound);

    return { policies: results, estimators };
}

/** A fixed-width table of targets known at each budget, for the console. */
export function printPolicyTable(
    policies: readonly PolicyResult[],
    budgets: readonly number[],
    coverageMarks: readonly number[]
): void {
    console.log(
        `   ${"policy".padEnd(18)} ${budgets.map(b => `@${b}`.padStart(8)).join("")}   wasted ${coverageMarks.map(m => `to${Math.round(m * 100)}%`.padStart(7)).join("")}`
    );
    for (const p of policies) {
        console.log(
            `   ${p.id.padEnd(18)} ${budgets.map(b => String(p.found[b]!.mean).padStart(8)).join("")}   ${String(p.wastedShare).padStart(6)} ${coverageMarks.map(m => String(p.requestsToCoverage[m] ?? "-").padStart(7)).join("")}`
        );
    }
}
