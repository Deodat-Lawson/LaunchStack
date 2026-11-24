/**
 * Hyper-parameters, picked on the two development segments only.
 *
 *   pnpm exec tsx experiments/company-search/e4-whom-to-check/tune.ts
 *
 * Offline and deterministic, like run.ts. For each learner it tries the grid
 * in config.ts on yc-education and yc-fintech (seeds 101–110, batches of 5,
 * 200 checks) and keeps the setting that finds the most good companies after
 * 100 checks, averaged over both segments. It prints the table and writes
 * tuning.json next to this file; the chosen values are then copied by hand
 * into config.ts (run.ts refuses to report a mismatch as consistent).
 *
 * No reported segment is read here.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { round } from "../lib/stats";
import { segmentText } from "./briefs";
import { GRIDS, HYPER, SIMULATION, TUNING } from "./config";
import { createRecorder, createVectorSource, loadPool } from "./data";
import { buildPoolMath, buildSegmentMath, loadPoolVectors } from "./maths";
import {
    calLogreg,
    calLogregEgreedy,
    knnFeedback,
    linucb,
    type Policy,
    rocchio,
    type SegmentMath,
    thompson,
    todaySemantic,
} from "./policies";
import { decidePrefixMode } from "./prefix";
import { formatTable } from "./report";
import { DEV_SEGMENTS } from "./segments";
import { contextFor, simulate, subsampleOf } from "./simulate";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const recorder = createRecorder("replay");
const vectors = createVectorSource({ offline: true });
const decision = await decidePrefixMode(recorder, vectors);

const poolIds = [...new Set(DEV_SEGMENTS.map(s => s.pool))];
if (poolIds.length !== 1) throw new Error("The development segments must share one pool");
const pool = await loadPool(recorder, poolIds[0]!);
const pv = await loadPoolVectors(vectors, pool, decision.used);
const math = buildPoolMath(pv, HYPER.bayes.dims);
const segments: Array<{ id: string; math: SegmentMath }> = [];
for (const segment of DEV_SEGMENTS)
    segments.push({
        id: segment.id,
        math: await buildSegmentMath(vectors, pv, math, segment, segmentText(segment, "en")),
    });

interface Candidate {
    family: string;
    setting: Record<string, number>;
    policy: Policy;
}

const candidates: Candidate[] = [
    { family: "today-semantic", setting: {}, policy: todaySemantic },
    { family: "rocchio", setting: { ...HYPER.rocchio }, policy: rocchio(HYPER.rocchio) },
    ...GRIDS.logregC.map(c => ({
        family: "cal-logreg",
        setting: { c },
        policy: calLogreg({ ...HYPER.logreg, c }),
    })),
    ...GRIDS.thompsonPriorSd.map(priorSdProjection => ({
        family: "thompson",
        setting: { priorSdProjection },
        policy: thompson(HYPER.bayes, { priorSdProjection }),
    })),
    ...GRIDS.linucbPriorSd.flatMap(priorSdProjection =>
        GRIDS.linucbBonus.map(bonus => ({
            family: "linucb",
            setting: { priorSdProjection, bonus },
            policy: linucb(HYPER.bayes, { priorSdProjection, bonus }),
        }))
    ),
    ...GRIDS.knnWeight.map(weight => ({
        family: "knn-feedback",
        setting: { weight },
        policy: knnFeedback({ ...HYPER.knn, weight }),
    })),
];

const budgets = SIMULATION.budgets;
const horizon = Math.max(...budgets);
const options = {
    batchSize: SIMULATION.batchSize,
    budgets,
    shortlist: SIMULATION.shortlist,
    // Tuning looks at the budgets only; no run goes past the largest.
    checksCap: horizon,
};

/** Mean good companies found per budget: per development segment, then averaged. */
function evaluate(policy: Policy): { perSegment: Record<string, number[]>; mean: number[] } {
    const perSegment: Record<string, number[]> = {};
    for (const segment of segments) {
        const sums = budgets.map(() => 0);
        for (const seed of TUNING.seeds) {
            const active = subsampleOf(pool.spec.id, math.n, seed);
            const ctx = contextFor(math, segment.math, active, `${segment.id}|en|${seed}`);
            const outcome = simulate(policy, ctx, options);
            for (const [b, value] of outcome.found.entries()) sums[b]! += value;
        }
        perSegment[segment.id] = sums.map(s => round(s / TUNING.seeds.length, 2));
    }
    const mean = budgets.map((_, b) =>
        round(segments.reduce((sum, s) => sum + perSegment[s.id]![b]!, 0) / segments.length, 2)
    );
    return { perSegment, mean };
}

const target = budgets.indexOf(TUNING.budget);
const rows: Array<Candidate & { perSegment: Record<string, number[]>; mean: number[] }> = [];
for (const candidate of candidates) rows.push({ ...candidate, ...evaluate(candidate.policy) });

const chosen: Record<string, Record<string, number>> = {};
const bestOf: Record<string, number[]> = {};
for (const row of rows) {
    const best = bestOf[row.family];
    if (!best || row.mean[target]! > best[target]!) {
        bestOf[row.family] = row.mean;
        chosen[row.family] = row.setting;
    }
}

// ε-greedy inherits cal-logreg's C; it is scored here only to complete the comparison of learners.
const egreedy = evaluate(calLogregEgreedy({ ...HYPER.logreg, c: chosen["cal-logreg"]!.c! }));
bestOf["cal-logreg-egreedy"] = egreedy.mean;
const learners = Object.keys(bestOf).filter(name => name !== "today-semantic");
let devChoice = learners[0]!;
for (const name of learners)
    if (bestOf[name]![target]! > bestOf[devChoice]![target]!) devChoice = name;

const setting = (s: Record<string, number>): string =>
    Object.entries(s)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
console.log(
    formatTable([
        ["policy", "setting", ...budgets.map(b => `@${b}`), ""],
        ...rows.map(row => [
            row.family,
            setting(row.setting),
            ...row.mean.map(v => v.toFixed(1)),
            chosen[row.family] === row.setting && row.family !== "today-semantic" ? "<- kept" : "",
        ]),
        ["cal-logreg-egreedy", "(c as cal-logreg)", ...egreedy.mean.map(v => v.toFixed(1)), ""],
    ])
);
console.log(
    `\nvectors: ${decision.used} (today's average precision on the development segments: plain ${decision.mean.plain}, prefixed ${decision.mean.prefixed})`
);
console.log(
    `learner the development segments would pick (most found after ${TUNING.budget} checks): ${devChoice}`
);

const file = path.join(HERE, "tuning.json");
writeFileSync(
    file,
    `${JSON.stringify(
        {
            rule: `per learner, the grid setting with the most good companies after ${TUNING.budget} checks, averaged over the development segments and seeds; the first value wins a tie`,
            segments: segments.map(s => s.id),
            seeds: `${TUNING.seeds[0]}-${TUNING.seeds[TUNING.seeds.length - 1]}`,
            batchSize: SIMULATION.batchSize,
            budgets,
            vectors: decision.used,
            grid: rows.map(row => ({
                policy: row.family,
                setting: row.setting,
                found: row.mean,
                perSegment: row.perSegment,
            })),
            egreedy: egreedy.mean,
            chosen: {
                logregC: chosen["cal-logreg"]!.c,
                thompsonPriorSd: chosen.thompson!.priorSdProjection,
                linucbPriorSd: chosen.linucb!.priorSdProjection,
                linucbBonus: chosen.linucb!.bonus,
                knnWeight: chosen["knn-feedback"]!.weight,
            },
            devChoice,
        },
        null,
        2
    )}\n`
);
console.log(`wrote ${file} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
