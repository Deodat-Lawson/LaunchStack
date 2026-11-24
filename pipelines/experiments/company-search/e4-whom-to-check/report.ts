/**
 * From per-seed outcomes to the results file: means with intervals, paired
 * differences against today's ranking, the sensitivity runs, and findings
 * written from the numbers so the sentences cannot drift from the data.
 *
 * Aggregates only: nothing here sees a company's text.
 */
import type { BriefLanguage } from "./briefs";
import { type Hyper, SIMULATION } from "./config";
import type { JobResult, PolicyRuns, Quality, SegmentResult, TaskResult } from "./job";
import type { PrefixDecision } from "./prefix";
import { REPORTED_SEGMENTS, segmentById } from "./segments";
import {
    clustered,
    difference,
    mean,
    paired,
    type Paired,
    quantile,
    round,
    spread,
    type Spread,
} from "./stats";

export const BASELINE = "today-semantic";
export const LEARNERS = [
    "rocchio",
    "cal-logreg",
    "cal-uncertainty",
    "cal-logreg-egreedy",
    "thompson",
    "linucb",
    "knn-feedback",
];
/** The batch-size runs leave out the two variants of cal-logreg and the batch-blind policies. */
export const BATCH_SENSITIVITY_POLICIES = [
    BASELINE,
    "rocchio",
    "cal-logreg",
    "thompson",
    "linucb",
    "knn-feedback",
];

const POLICY_NOTES: Record<string, string> = {
    "today-semantic":
        "production today: semanticRelevance(brief, company text), checked from the top down; nothing learned",
    "today-lexical":
        "production with no embedder: lexicalRelevance (word overlap with the segment's categories), top down; ties in seeded random order",
    rocchio:
        "after each batch the brief vector moves toward the mean of checked positives and away from checked negatives; companies are re-scored with production's formula",
    "cal-logreg":
        "continuous active learning: L2 logistic regression on the embedding plus today's score, retrained after every batch, checks the highest-scored",
    "cal-uncertainty": "the same model, but checks the company closest to even odds",
    "cal-logreg-egreedy": "cal-logreg with a share of checks spent on a random unchecked company",
    thompson:
        "Bayesian linear model on a projection of the embedding plus today's score (prior mean: today's score); checks the best company under one posterior sample per check",
    linucb: "the same Bayesian model; checks the highest predicted score plus an uncertainty bonus",
    "knn-feedback":
        "today's score plus mean cosine to the nearest checked positives minus mean cosine to the nearest checked negatives",
    random: "lower bound: a seeded random order",
    oracle: "upper bound: every good company first",
};

const BUDGETS = SIMULATION.budgets;
const SHORTLIST = SIMULATION.shortlist;

const foundAt = (runs: PolicyRuns, budgetIndex: number): number[] =>
    runs.found.map(f => f[budgetIndex]!);

function taskOf(segment: SegmentResult, language: BriefLanguage, batchSize: number): TaskResult {
    const task = segment.tasks.find(t => t.language === language && t.batchSize === batchSize);
    if (!task) throw new Error(`${segment.segmentId}: no task ${language}/${batchSize}`);
    return task;
}

interface PolicyReport {
    /** Good companies found after 25/50/100/200 checks: mean over seeds, 95% interval. */
    found: Record<string, Spread>;
    precisionAt25: Spread;
    /** Checks until 25 good companies were found (capped), and the share of seeds that got there. */
    checksTo25: Spread & { reached: number };
    /** Fixed rankings only: the figure without the cap. */
    checksTo25Uncapped?: { median: number; max: number; never: number };
    /** Policy minus today's semantic ranking, paired by seed. Negative checks = fewer checks. */
    vsToday?: { found: Record<string, Paired>; checksTo25: Paired };
}

function policyReport(runs: PolicyRuns, baseline: PolicyRuns | null): PolicyReport {
    const found: Record<string, Spread> = {};
    for (const [b, budget] of BUDGETS.entries()) found[String(budget)] = spread(foundAt(runs, b));
    const out: PolicyReport = {
        found,
        precisionAt25: spread(
            foundAt(runs, 0).map(v => v / SHORTLIST),
            3
        ),
        checksTo25: {
            ...spread(runs.checksToShortlist, 1),
            reached: round(mean(runs.reached), 2),
        },
    };
    if (runs.uncapped) {
        const reached = runs.uncapped.filter(v => v >= 0);
        out.checksTo25Uncapped = {
            median: reached.length > 0 ? round(quantile(reached, 0.5), 1) : -1,
            max: reached.length > 0 ? Math.max(...reached) : -1,
            never: round(1 - reached.length / Math.max(1, runs.uncapped.length), 2),
        };
    }
    if (baseline) {
        const versus: Record<string, Paired> = {};
        for (const [b, budget] of BUDGETS.entries())
            versus[String(budget)] = paired(foundAt(runs, b), foundAt(baseline, b));
        out.vsToday = {
            found: versus,
            checksTo25: paired(runs.checksToShortlist, baseline.checksToShortlist, 1),
        };
    }
    return out;
}

function taskReport(task: TaskResult): Record<string, PolicyReport> {
    const baseline = task.policies[BASELINE]!;
    const out: Record<string, PolicyReport> = {};
    for (const [name, runs] of Object.entries(task.policies))
        out[name] = policyReport(runs, name === BASELINE ? null : baseline);
    return out;
}

type Sided = Spread & { poolsBetter: number; poolsWorse: number };

interface OverallReport {
    found: Record<string, Spread>;
    precisionAt25: Spread;
    checksTo25: Spread & { reached: number };
    /**
     * Policy minus today's ranking. `poolsBetter` / `poolsWorse` count the pools
     * whose own paired interval lies wholly on the better or the worse side of zero.
     */
    vsToday?: { found: Record<string, Sided>; checksTo25: Sided };
}

/** Averages over pools (each pool counts once); intervals resample pools, then seeds. */
function overallReport(tasks: TaskResult[]): Record<string, OverallReport> {
    const names = Object.keys(tasks[0]?.policies ?? {});
    const out: Record<string, OverallReport> = {};
    for (const name of names) {
        const runs = tasks.map(t => t.policies[name]!);
        const base = tasks.map(t => t.policies[BASELINE]!);
        const found: Record<string, Spread> = {};
        for (const [b, budget] of BUDGETS.entries())
            found[String(budget)] = clustered(runs.map(r => foundAt(r, b)));
        const report: OverallReport = {
            found,
            precisionAt25: clustered(
                runs.map(r => foundAt(r, 0).map(v => v / SHORTLIST)),
                3
            ),
            checksTo25: {
                ...clustered(
                    runs.map(r => r.checksToShortlist),
                    1
                ),
                reached: round(mean(runs.map(r => mean(r.reached))), 2),
            },
        };
        if (name !== BASELINE) {
            const versus: Record<string, Sided> = {};
            for (const [b, budget] of BUDGETS.entries()) {
                const perPool = runs.map((r, p) => paired(foundAt(r, b), foundAt(base[p]!, b)));
                versus[String(budget)] = {
                    ...clustered(
                        runs.map((r, p) => difference(foundAt(r, b), foundAt(base[p]!, b)))
                    ),
                    poolsBetter: perPool.filter(d => d.lo > 0).length,
                    poolsWorse: perPool.filter(d => d.hi < 0).length,
                };
            }
            const perPool = runs.map((r, p) =>
                paired(r.checksToShortlist, base[p]!.checksToShortlist, 1)
            );
            report.vsToday = {
                found: versus,
                checksTo25: {
                    ...clustered(
                        runs.map((r, p) =>
                            difference(r.checksToShortlist, base[p]!.checksToShortlist)
                        ),
                        1
                    ),
                    poolsBetter: perPool.filter(d => d.hi < 0).length,
                    poolsWorse: perPool.filter(d => d.lo > 0).length,
                },
            };
        }
        out[name] = report;
    }
    return out;
}

/** The learner with the most good companies after `budget` checks, averaged over pools. */
function bestLearner(overall: Record<string, OverallReport>, budget: number): string {
    const candidates = LEARNERS.filter(name => overall[name]);
    let best = candidates[0]!;
    for (const name of candidates)
        if (overall[name]!.found[String(budget)]!.mean > overall[best]!.found[String(budget)]!.mean)
            best = name;
    return best;
}

/** Left-aligned first column, right-aligned numbers. */
export function formatTable(rows: string[][]): string {
    const widths: number[] = [];
    for (const row of rows)
        for (const [c, cell] of row.entries()) widths[c] = Math.max(widths[c] ?? 0, cell.length);
    return rows
        .map(row =>
            row
                .map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!)))
                .join("  ")
                .trimEnd()
        )
        .join("\n");
}

const fixed = (value: number, digits = 1): string => value.toFixed(digits);
const signed = (value: number, digits = 1): string =>
    `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(digits)}`;
const interval = (s: Spread, digits = 1): string =>
    `${signed(s.mean, digits)} (95% interval ${signed(s.lo, digits)} to ${signed(s.hi, digits)})`;
const percent = (share: number): string => `${Math.round(share * 100)}%`;
const list = (items: string[]): string =>
    items.length <= 1
        ? (items[0] ?? "none")
        : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** How good today's ranking starts out, by the good companies among its first 25 checks. */
type Regime = "near the oracle" | "room to improve" | "almost empty";
const REGIMES: Record<Regime, string> = {
    "near the oracle": "at least 20 good in today's first 25 checks",
    "room to improve": "between 5 and 20 good in today's first 25 checks",
    "almost empty": "5 or fewer good in today's first 25 checks",
};

function regimeOf(precisionAt25: number): Regime {
    if (precisionAt25 >= 0.8) return "near the oracle";
    if (precisionAt25 <= 0.2) return "almost empty";
    return "room to improve";
}

export interface ReportExtras {
    decision: PrefixDecision;
    /** tuning.json as tune.ts wrote it, or null when it has not been run. */
    tuning: Record<string, unknown> | null;
    hyper: Hyper;
    grids: Record<string, readonly number[]>;
    tuningSeeds: number[];
    devSegments: string[];
}

export function buildResults(
    jobs: JobResult[],
    extras: ReportExtras
): { results: Record<string, unknown>; table: string } {
    const located = new Map<string, { job: JobResult; segment: SegmentResult }>();
    for (const job of jobs)
        for (const segment of job.segments) located.set(segment.segmentId, { job, segment });
    const ids = REPORTED_SEGMENTS.map(s => s.id).filter(id => located.has(id));
    const main = (id: string): TaskResult =>
        taskOf(located.get(id)!.segment, "en", SIMULATION.batchSize);

    // ── Pools ───────────────────────────────────────────────────────────────
    const pools = ids.map(id => {
        const { job, segment } = located.get(id)!;
        const spec = segmentById(id);
        const task = main(id);
        return {
            segment: id,
            pool: job.pool.id,
            description: job.pool.description,
            goodWhen: spec.target,
            size: job.pool.size,
            subsample: job.pool.subsample,
            good: segment.good,
            prevalence: round(segment.good / job.pool.size, 4),
            offering: spec.offering,
            categories: spec.categories,
            brief: task.brief,
            fingerprint: job.pool.fingerprint,
            leftOut: job.pool.leftOut,
            averagePrecision: {
                "today-semantic": spread(task.averagePrecision["today-semantic"], 3),
                "today-lexical": spread(task.averagePrecision["today-lexical"], 3),
            },
            relevanceGate: {
                poolKept: round(task.gate.kept, 3),
                goodKept: round(task.gate.goodKept, 3),
            },
        };
    });

    // ── Main results ────────────────────────────────────────────────────────
    const perPool: Record<string, Record<string, PolicyReport>> = {};
    for (const id of ids) perPool[id] = taskReport(main(id));
    const overall = overallReport(ids.map(main));
    const names = Object.keys(overall);
    const best = bestLearner(overall, 100);
    const devChoice = typeof extras.tuning?.devChoice === "string" ? extras.tuning.devChoice : null;

    // ── Where learning helps ────────────────────────────────────────────────
    const regimes = ids.map(id => {
        const today = perPool[id]![BASELINE]!;
        const learner = perPool[id]![best]!;
        const oracle = perPool[id]!.oracle!;
        const shuffled = perPool[id]!.random!;
        const later = (report: PolicyReport): number =>
            round(report.found["100"]!.mean - report.found["25"]!.mean, 2);
        return {
            segment: id,
            regime: regimeOf(today.precisionAt25.mean),
            regimeMeans: REGIMES[regimeOf(today.precisionAt25.mean)],
            todayPrecisionAt25: today.precisionAt25.mean,
            todayFound: Object.fromEntries(
                BUDGETS.map(b => [String(b), today.found[String(b)]!.mean])
            ),
            oracleFound: Object.fromEntries(
                BUDGETS.map(b => [String(b), oracle.found[String(b)]!.mean])
            ),
            /** Good companies among checks 26 to 100: today's ranking, and a random order. */
            checks26to100: { today: later(today), random: later(shuffled) },
            /** Today's ranking past its first 25 checks does no better than a random order. */
            todayRunsDry: later(today) <= later(shuffled),
            learner: best,
            learnerVsToday: learner.vsToday!.found,
            checksTo25: {
                today: today.checksTo25.mean,
                learner: learner.checksTo25.mean,
                difference: learner.vsToday!.checksTo25,
            },
        };
    });

    // ── The best learner against the others ─────────────────────────────────
    const versusOthers: Record<string, Record<string, Sided>> = {};
    for (const name of LEARNERS) {
        if (name === best || !overall[name]) continue;
        versusOthers[name] = {};
        for (const [b, budget] of BUDGETS.entries()) {
            const perPoolDiff = ids.map(id =>
                paired(foundAt(main(id).policies[best]!, b), foundAt(main(id).policies[name]!, b))
            );
            versusOthers[name][String(budget)] = {
                ...clustered(
                    ids.map(id =>
                        difference(
                            foundAt(main(id).policies[best]!, b),
                            foundAt(main(id).policies[name]!, b)
                        )
                    )
                ),
                poolsBetter: perPoolDiff.filter(d => d.lo > 0).length,
                poolsWorse: perPoolDiff.filter(d => d.hi < 0).length,
            };
        }
    }

    // ── Sensitivity: batch size ─────────────────────────────────────────────
    const batchSize: Record<string, unknown> = {};
    for (const size of SIMULATION.otherBatchSizes) {
        const tasks = ids.map(id => taskOf(located.get(id)!.segment, "en", size));
        const sizeOverall = overallReport(tasks);
        const versusDefault: Record<string, Record<string, Sided>> = {};
        for (const name of Object.keys(sizeOverall)) {
            if (name === BASELINE) continue;
            versusDefault[name] = {};
            for (const [b, budget] of BUDGETS.entries()) {
                const perPoolDiff = ids.map((id, p) =>
                    paired(
                        foundAt(tasks[p]!.policies[name]!, b),
                        foundAt(main(id).policies[name]!, b)
                    )
                );
                versusDefault[name][String(budget)] = {
                    ...clustered(
                        ids.map((id, p) =>
                            difference(
                                foundAt(tasks[p]!.policies[name]!, b),
                                foundAt(main(id).policies[name]!, b)
                            )
                        )
                    ),
                    poolsBetter: perPoolDiff.filter(d => d.lo > 0).length,
                    poolsWorse: perPoolDiff.filter(d => d.hi < 0).length,
                };
            }
        }
        batchSize[String(size)] = {
            overall: sizeOverall,
            /** This batch size minus batches of 5, same policy, paired by seed. */
            versusBatchesOf5: versusDefault,
        };
    }

    // ── Sensitivity: Norwegian briefs ───────────────────────────────────────
    const norwegianIds = ids.filter(id => segmentById(id).norwegian);
    const norwegian: Record<string, unknown> = {};
    for (const id of norwegianIds) {
        const spec = segmentById(id);
        const task = taskOf(located.get(id)!.segment, "no", SIMULATION.batchSize);
        const english = main(id);
        const versusEnglish: Record<string, Record<string, Paired>> = {};
        for (const name of Object.keys(task.policies)) {
            versusEnglish[name] = {};
            for (const [b, budget] of BUDGETS.entries())
                versusEnglish[name][String(budget)] = paired(
                    foundAt(task.policies[name]!, b),
                    foundAt(english.policies[name]!, b)
                );
        }
        norwegian[id] = {
            offering: spec.norwegian!.offering,
            categories: spec.norwegian!.categories,
            brief: task.brief,
            averagePrecision: {
                "today-semantic": spread(task.averagePrecision["today-semantic"], 3),
                "today-lexical": spread(task.averagePrecision["today-lexical"], 3),
            },
            relevanceGate: {
                poolKept: round(task.gate.kept, 3),
                goodKept: round(task.gate.goodKept, 3),
            },
            policies: taskReport(task),
            /** Norwegian brief minus English brief, same policy, paired by seed. */
            versusEnglishBrief: versusEnglish,
        };
    }
    const gateWith = (language: "en" | "no"): string =>
        list(
            norwegianIds.map(
                id =>
                    `${percent(taskOf(located.get(id)!.segment, language, SIMULATION.batchSize).gate.goodKept)} on ${id}`
            )
        );
    const norwegianOverall =
        norwegianIds.length > 0
            ? overallReport(
                  norwegianIds.map(id =>
                      taskOf(located.get(id)!.segment, "no", SIMULATION.batchSize)
                  )
              )
            : {};
    const englishOnSamePools = norwegianIds.length > 0 ? overallReport(norwegianIds.map(main)) : {};

    // ── Sensitivity: task prefixes ──────────────────────────────────────────
    const prefixPerPool: Record<string, Record<string, Quality>> = {};
    for (const id of ids)
        for (const check of located.get(id)!.segment.prefixChecks) {
            const key = check.language === "en" ? id : `${id} (Norwegian brief)`;
            prefixPerPool[key] = {
                plain: {
                    averagePrecision: round(check.plain.averagePrecision, 3),
                    precisionAt25: round(check.plain.precisionAt25, 2),
                },
                prefixed: {
                    averagePrecision: round(check.prefixed.averagePrecision, 3),
                    precisionAt25: round(check.prefixed.precisionAt25, 2),
                },
            };
        }

    // ── Findings ────────────────────────────────────────────────────────────
    const findings: string[] = [];
    const today = overall[BASELINE]!;
    const top = overall[best]!;
    const at = (report: OverallReport | PolicyReport, budget: number): number =>
        report.found[String(budget)]!.mean;
    const meanOf = (values: number[]): number => round(mean(values), 3);
    const prevalence = meanOf(pools.map(p => p.prevalence));
    const precisionByPool = ids.map(id => perPool[id]![BASELINE]!.precisionAt25.mean);
    const lowest = ids[precisionByPool.indexOf(Math.min(...precisionByPool))]!;
    const highest = ids[precisionByPool.indexOf(Math.max(...precisionByPool))]!;

    findings.push(
        `Starting point: across the ${ids.length} pools today's semantic ranking has a mean average precision of ${meanOf(pools.map(p => p.averagePrecision["today-semantic"].mean))} (the word-overlap fallback: ${meanOf(pools.map(p => p.averagePrecision["today-lexical"].mean))}; a random order would score about the prevalence, ${prevalence}). Of its first 25 checks ${fixed(at(today, 25))} are good on average, from ${fixed(perPool[lowest]![BASELINE]!.found["25"]!.mean)} on ${lowest} to ${fixed(perPool[highest]![BASELINE]!.found["25"]!.mean)} on ${highest}.`
    );
    findings.push(
        `Same checks, more good companies: after 25 / 50 / 100 / 200 checks today's fixed ranking has found ${BUDGETS.map(b => fixed(at(today, b))).join(" / ")} good companies and the best learner, ${best}, has found ${BUDGETS.map(b => fixed(at(top, b))).join(" / ")} (the oracle: ${BUDGETS.map(b => fixed(at(overall.oracle!, b))).join(" / ")}). Paired difference to today: ${BUDGETS.map(b => `${interval(top.vsToday!.found[String(b)]!)} at ${b}`).join("; ")}. The intervals resample pools and seeds. Pool by pool (intervals over seeds), ${best} is ahead in ${top.vsToday!.found["25"]!.poolsBetter} of ${ids.length} pools at 25 checks and behind in ${top.vsToday!.found["25"]!.poolsWorse}; ahead in ${top.vsToday!.found["100"]!.poolsBetter} at 100 and behind in ${top.vsToday!.found["100"]!.poolsWorse}.`
    );
    const shortlistToday = ids.map(id => perPool[id]![BASELINE]!.checksTo25.mean);
    const shortlistBest = ids.map(id => perPool[id]![best]!.checksTo25.mean);
    findings.push(
        `Filling a shortlist of ${SHORTLIST}: today's ranking needs ${fixed(today.checksTo25.mean)} checks on average (${fixed(Math.min(...shortlistToday), 0)} to ${fixed(Math.max(...shortlistToday), 0)} by pool, median pool ${fixed(quantile(shortlistToday, 0.5), 0)}) and ${best} ${fixed(top.checksTo25.mean)} (${fixed(Math.min(...shortlistBest), 0)} to ${fixed(Math.max(...shortlistBest), 0)}, median ${fixed(quantile(shortlistBest, 0.5), 0)}), a difference of ${interval(top.vsToday!.checksTo25)} checks. The mean leans on the slowest pool; pool by pool ${best} needs fewer checks in ${top.vsToday!.checksTo25.poolsBetter} of ${ids.length} and more in ${top.vsToday!.checksTo25.poolsWorse}. Runs that did not fill the shortlist within ${SIMULATION.checksCap} checks count as ${SIMULATION.checksCap} (today filled it in ${percent(today.checksTo25.reached)} of runs, ${best} in ${percent(top.checksTo25.reached)}).`
    );
    const ranked = LEARNERS.filter(name => overall[name])
        .map(name => ({ name, gain: overall[name]!.vsToday!.found["100"]! }))
        .sort((a, b) => b.gain.mean - a.gain.mean);
    findings.push(
        `All learners at 100 checks, as good companies gained over today's ranking: ${ranked.map(r => `${r.name} ${signed(r.gain.mean)} (${signed(r.gain.lo)} to ${signed(r.gain.hi)})`).join("; ")}. At 25 checks: ${ranked
            .map(r => `${r.name} ${signed(overall[r.name]!.vsToday!.found["25"]!.mean)}`)
            .join("; ")}.`
    );
    const close = ranked
        .filter(r => r.name !== best)
        .filter(r => {
            const gap = versusOthers[r.name]!["100"]!;
            return gap.lo <= 0 && gap.hi >= 0;
        });
    findings.push(
        close.length > 0
            ? `The best learner is not clearly best: at 100 checks ${best} minus ${close
                  .map(r => `${r.name} is ${interval(versusOthers[r.name]!["100"]!)}`)
                  .join(
                      ", minus "
                  )}. ${list(close.map(r => r.name))} cannot be told apart from ${best} on these pools; the remaining learners are behind it.`
            : `At 100 checks ${best} is ahead of every other learner: ${ranked
                  .filter(r => r.name !== best)
                  .map(r => `${interval(versusOthers[r.name]!["100"]!)} against ${r.name}`)
                  .join("; ")}.`
    );
    const gains = (m: (typeof regimes)[number]): string =>
        `${m.segment} ${[25, 50, 100].map(b => signed(m.learnerVsToday[String(b)]!.mean)).join(" / ")}`;
    const near = regimes.filter(r => r.regime === "near the oracle");
    const room = regimes.filter(r => r.regime === "room to improve");
    const empty = regimes.filter(r => r.regime === "almost empty");
    if (near.length > 0)
        findings.push(
            `Where today's ranking is already near the oracle (${REGIMES["near the oracle"]}: ${list(near.map(m => `${m.segment} with ${fixed(m.todayFound["25"]!)}`))}), learning adds little early and does no harm: ${best} versus today after 25 / 50 / 100 checks is ${near.map(gains).join("; ")}. The gain comes later, once today's ranking has used up its obvious matches.`
        );
    if (room.length > 0)
        findings.push(
            `Where today's ranking leaves room (${REGIMES["room to improve"]}: ${list(room.map(m => `${m.segment} with ${fixed(m.todayFound["25"]!)}`))}), learning pays from the first batches: ${best} versus today after 25 / 50 / 100 checks is ${room.map(gains).join("; ")}.`
        );
    findings.push(
        empty.length > 0
            ? `Where today's ranking starts almost empty (${REGIMES["almost empty"]}: ${list(empty.map(m => `${m.segment} with ${fixed(m.todayFound["25"]!)}`))}), a learner has few positives to learn from: ${best} versus today after 25 / 50 / 100 checks is ${empty.map(gains).join("; ")}.`
            : `No pool starts almost empty (${REGIMES["almost empty"]}); the lowest is ${lowest} with ${fixed(perPool[lowest]![BASELINE]!.found["25"]!.mean)}. So this experiment does not show how a learner fares when the first batches bring back no positive at all.`
    );
    for (const dry of regimes.filter(r => r.todayRunsDry))
        findings.push(
            `Today's ranking can run dry: on ${dry.segment} it finds ${fixed(dry.todayFound["25"]!)} good companies in its first 25 checks and ${fixed(dry.checks26to100.today)} in the next 75, no better than a random order (${fixed(dry.checks26to100.random)}). ${best} finds ${fixed(perPool[dry.segment]![best]!.found["100"]!.mean)} by 100 checks there and fills the shortlist in ${fixed(dry.checksTo25.learner, 0)} checks instead of ${fixed(dry.checksTo25.today, 0)}.`
        );
    const lexical = overall["today-lexical"];
    if (lexical) {
        const ahead = ids.filter(
            id => perPool[id]!["today-lexical"]!.vsToday!.found["100"]!.lo > 0
        );
        const behind = ids.filter(
            id => perPool[id]!["today-lexical"]!.vsToday!.found["100"]!.hi < 0
        );
        findings.push(
            `The word-overlap fallback finds ${[25, 50, 100].map(b => fixed(at(lexical, b))).join(" / ")} good companies after 25 / 50 / 100 checks, ${interval(lexical.vsToday!.found["100"]!)} against the semantic ranking at 100. It is ahead on ${list(ahead)} and behind on ${list(behind)}.`
        );
    }
    if (overall["cal-uncertainty"] && overall["cal-logreg-egreedy"] && overall["cal-logreg"])
        findings.push(
            `Exploring costs checks at these budgets: against cal-logreg's ${fixed(at(overall["cal-logreg"], 100))} good companies after 100 checks, spending 10% of checks at random finds ${fixed(at(overall["cal-logreg-egreedy"], 100))}, checking the most uncertain company finds ${fixed(at(overall["cal-uncertainty"], 100))}${overall.thompson ? ` and Thompson sampling finds ${fixed(at(overall.thompson, 100))}` : ""} (today: ${fixed(at(today, 100))}).`
        );
    if (devChoice)
        findings.push(
            devChoice === best
                ? `The development segments alone, before any reported pool was run, also picked ${best} as the learner to ship, so the headline is not a best-of-${LEARNERS.length} chosen after the fact.`
                : `The development segments alone, before any reported pool was run, would have picked ${devChoice}, not ${best}. On the reported pools ${devChoice} gains ${interval(overall[devChoice]!.vsToday!.found["25"]!)} at 25 checks, ${interval(overall[devChoice]!.vsToday!.found["50"]!)} at 50 and ${interval(overall[devChoice]!.vsToday!.found["100"]!)} at 100, and needs ${fixed(overall[devChoice]!.checksTo25.mean)} checks for the shortlist. Those are the figures free of hindsight; the ones for ${best} are a best-of-${LEARNERS.length} picked on these same pools and lean optimistic.`
        );
    for (const size of SIMULATION.otherBatchSizes) {
        const sized = (batchSize[String(size)] as { overall: Record<string, OverallReport> })
            .overall;
        const sizedBest = sized[best];
        if (!sizedBest) continue;
        findings.push(
            `Batch size ${size} instead of ${SIMULATION.batchSize}: ${best} finds ${[25, 50, 100].map(b => fixed(at(sizedBest, b))).join(" / ")} good companies after 25 / 50 / 100 checks (batches of ${SIMULATION.batchSize}: ${[25, 50, 100].map(b => fixed(at(top, b))).join(" / ")}); its gain over today at 100 checks is ${interval(sizedBest.vsToday!.found["100"]!)}.`
        );
    }
    if (norwegianIds.length > 0) {
        const noToday = norwegianOverall[BASELINE]!;
        const enToday = englishOnSamePools[BASELINE]!;
        const noBest = norwegianOverall[best]!;
        const enBest = englishOnSamePools[best]!;
        findings.push(
            `Norwegian briefs on the ${norwegianIds.length} register pools: today's ranking finds ${[25, 50, 100].map(b => fixed(at(noToday, b))).join(" / ")} good companies after 25 / 50 / 100 checks with a Norwegian brief against ${[25, 50, 100].map(b => fixed(at(enToday, b))).join(" / ")} with the English one; ${best} finds ${[25, 50, 100].map(b => fixed(at(noBest, b))).join(" / ")} against ${[25, 50, 100].map(b => fixed(at(enBest, b))).join(" / ")}. With the Norwegian brief ${best}'s gain over today at 100 checks is ${interval(noBest.vsToday!.found["100"]!)}: a brief in the companies' own language lifts today's ranking and narrows the gap, and the learner still adds to it. Of the good companies, production's relevance gate keeps ${gateWith("no")} with the Norwegian brief, against ${gateWith("en")} with the English one.`
        );
    }
    const otherMode = extras.decision.used === "plain" ? "prefixed" : "plain";
    const prefixExceptions = ids.filter(
        id =>
            prefixPerPool[id]![extras.decision.used]!.averagePrecision <
            prefixPerPool[id]![otherMode]!.averagePrecision
    );
    findings.push(
        `Task prefixes: on the development segments today's ranking has a mean average precision of ${extras.decision.mean.plain} without nomic-embed-text's search_query/search_document prefixes and ${extras.decision.mean.prefixed} with them, so every policy uses the ${extras.decision.used} vectors. On the reported pools the ${extras.decision.used} vectors give today's ranking the higher average precision in ${ids.length - prefixExceptions.length} of ${ids.length}${prefixExceptions.length > 0 ? ` (the other way round on ${list(prefixExceptions.map(id => `${id}, ${prefixPerPool[id]![extras.decision.used]!.averagePrecision} against ${prefixPerPool[id]![otherMode]!.averagePrecision}`))})` : ""}.`
    );
    const gated = pools.filter(p => p.relevanceGate.goodKept < 0.999);
    findings.push(
        `Production drops companies whose relevance is not above zero before any check. That gate keeps ${percent(mean(pools.map(p => p.relevanceGate.poolKept)))} of a pool on average and ${percent(mean(pools.map(p => p.relevanceGate.goodKept)))} of its good companies${gated.length > 0 ? ` (lowest: ${percent(Math.min(...gated.map(p => p.relevanceGate.goodKept)))} on ${gated.sort((a, b) => a.relevanceGate.goodKept - b.relevanceGate.goodKept)[0]!.segment})` : ""}; the simulation ignores the gate, so a learner here may reach good companies that production never checks.`
    );

    const limits = [
        "Labels are directory tags and register codes, not buying decisions: a company can be a real prospect without the tag, and a register code can disagree with what the company's text says. Every policy is scored against the same labels.",
        "These labels follow from what a company's text is about (its industry, its registered activity), which is the kind of verdict that is easiest to learn from embeddings. A real verdict also turns on things the text does not say (size, timing, an existing supplier), so expect smaller gains in production than here.",
        "A check reveals the true label. In production the verdict comes from a chat model and then a person, both of which are sometimes wrong; no label noise is simulated.",
        "The embedding model is the local nomic-embed-text, weaker than a paid model, most of all on Norwegian text read against an English brief. A stronger model would lift today's ranking and leave the learners less to add.",
        "The briefs carry no seller profile and no partner kind, which production appends; a real brief is longer and drifts further from the buyers' own words.",
        "Hyper-parameters were picked on two other segments of the Y Combinator directory. The four reported YC segments share that pool's companies (not its labels); the three register pools were never seen before the reported run.",
        "Seven pools from two sources. The overall intervals resample pools and seeds, but seven pools cannot stand for every segment a customer will write.",
        `Runs that did not fill the shortlist within ${SIMULATION.checksCap} checks count as ${SIMULATION.checksCap}, which understates how much slower they are.`,
        "The simulation ignores production's relevance-above-zero gate and counts cost in checks only; a learner's own computation (a small model refit per batch) is not counted.",
        `The batch-size runs cover ${BATCH_SENSITIVITY_POLICIES.length} policies: the two variants of cal-logreg and the policies a batch size cannot change are left out.`,
    ];

    // ── Assemble ────────────────────────────────────────────────────────────
    const tuned = extras.tuning?.chosen as Record<string, number> | undefined;
    const results: Record<string, unknown> = {
        experiment: "e4-whom-to-check",
        question:
            "If the order of checking learned from each verdict, would the same number of checks find more good companies than today's fixed ranking?",
        design: {
            check: "one check reveals one company's hidden label and costs 1",
            batchSize: SIMULATION.batchSize,
            budgets: BUDGETS,
            shortlist: SHORTLIST,
            checksCap: SIMULATION.checksCap,
            seeds: SIMULATION.seeds.length,
            subsample: SIMULATION.subsample,
            pairing:
                "every policy sees the same subsample and tie-break order for a seed; differences are policy minus today-semantic, per seed",
            intervals:
                "95% percentile bootstrap, 2,000 resamples: over seeds within a pool; over pools and then seeds for the overall figures",
            policies: Object.fromEntries(names.map(name => [name, POLICY_NOTES[name] ?? ""])),
            hyperParameters: extras.hyper,
            tuning: {
                on: extras.devSegments,
                seeds: `${extras.tuningSeeds[0]}-${extras.tuningSeeds[extras.tuningSeeds.length - 1]}`,
                grids: extras.grids,
                rule: extras.tuning?.rule ?? "tune.ts has not been run",
                chosen: tuned ?? null,
                matchesConfig: tuned
                    ? tuned.logregC === extras.hyper.logreg.c &&
                      tuned.thompsonPriorSd === extras.hyper.thompson.priorSdProjection &&
                      tuned.linucbPriorSd === extras.hyper.linucb.priorSdProjection &&
                      tuned.linucbBonus === extras.hyper.linucb.bonus &&
                      tuned.knnWeight === extras.hyper.knn.weight
                    : false,
                learnerPickedOnDevelopmentSegments: devChoice,
            },
        },
        embedding: {
            model: "nomic-embed-text via Ollama, 768 dimensions",
            used: extras.decision.used,
            prefixDecision: extras.decision,
            /** Today's ranking on each whole reported pool, with both kinds of vectors. */
            todayPerPool: prefixPerPool,
        },
        pools,
        bestLearner: {
            at100Checks: best,
            pickedOnDevelopmentSegments: devChoice,
            /** The best learner minus each other learner, good companies found, overall. */
            versusOtherLearners: versusOthers,
        },
        results: { overall, perPool },
        regimes,
        sensitivity: {
            batchSize: { policies: BATCH_SENSITIVITY_POLICIES, ...batchSize },
            norwegianBriefs: {
                overall: norwegianOverall,
                englishBriefSamePools: englishOnSamePools,
                perPool: norwegian,
            },
        },
        findings,
        limits,
    };

    // ── Table ───────────────────────────────────────────────────────────────
    const lines: string[] = [];
    lines.push(
        `E4 whom to check: ${ids.length} pools, ${SIMULATION.seeds.length} seeds, batches of ${SIMULATION.batchSize}, ${extras.decision.used} vectors`
    );
    lines.push("");
    lines.push(
        formatTable([
            ["pool", "size", "good", "AP today", "AP lexical", "today@25"],
            ...pools.map(p => [
                p.segment,
                String(p.size),
                `${p.good} (${(100 * p.prevalence).toFixed(1)}%)`,
                p.averagePrecision["today-semantic"].mean.toFixed(3),
                p.averagePrecision["today-lexical"].mean.toFixed(3),
                fixed(perPool[p.segment]![BASELINE]!.found["25"]!.mean),
            ]),
        ])
    );
    lines.push("");
    lines.push(
        "Overall (mean over pools): good companies found, and paired difference to today-semantic"
    );
    lines.push(
        formatTable([
            [
                "policy",
                "@25",
                "@50",
                "@100",
                "@200",
                "to-25",
                "d@25",
                "d@50 [95%]",
                "d@100 [95%]",
                "d to-25 [95%]",
            ],
            ...names.map(name => {
                const o = overall[name]!;
                const v = o.vsToday;
                const ci = (s: Spread): string =>
                    `${signed(s.mean)} [${signed(s.lo)}, ${signed(s.hi)}]`;
                return [
                    name,
                    ...BUDGETS.map(b => fixed(at(o, b))),
                    fixed(o.checksTo25.mean),
                    v ? signed(v.found["25"]!.mean) : "",
                    v ? ci(v.found["50"]!) : "",
                    v ? ci(v.found["100"]!) : "",
                    v ? ci(v.checksTo25) : "",
                ];
            }),
        ])
    );
    for (const [title, cell] of [
        [
            "Good companies after 50 checks, per pool",
            (r: PolicyReport) => fixed(r.found["50"]!.mean),
        ],
        [
            "Good companies after 100 checks, per pool",
            (r: PolicyReport) => fixed(r.found["100"]!.mean),
        ],
        [
            `Checks to find ${SHORTLIST} (capped at ${SIMULATION.checksCap}), per pool`,
            (r: PolicyReport) => fixed(r.checksTo25.mean, 0),
        ],
    ] as Array<[string, (r: PolicyReport) => string]>) {
        lines.push("");
        lines.push(title);
        lines.push(
            formatTable([
                ["policy", ...ids.map(id => id.replace(/^brreg-/, "no-"))],
                ...names.map(name => [name, ...ids.map(id => cell(perPool[id]![name]!))]),
            ])
        );
    }
    lines.push("");
    lines.push("Findings");
    for (const finding of findings) lines.push(`- ${finding}`);
    return { results, table: lines.join("\n") };
}
