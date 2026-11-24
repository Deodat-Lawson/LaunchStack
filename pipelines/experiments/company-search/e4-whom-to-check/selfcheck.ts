/**
 * Checks of the experiment's own machinery on a small synthetic pool: no
 * recorded data, no network, a few seconds.
 *
 *   pnpm exec tsx experiments/company-search/e4-whom-to-check/selfcheck.ts
 *
 * Each policy's shortcut arithmetic (similarities read from one matrix, sums
 * kept up to date check by check) is compared with the same quantity computed
 * the slow, obvious way from the vectors.
 */
import { createRng } from "../lib/rng";
import { HYPER } from "./config";
import { EMBED_DIM, type LoadedPool } from "./data";
import { dotAt, unitRows, unitVector } from "./linalg";
import { averagePrecision, buildPoolMath, type PoolVectors } from "./maths";
import {
    BayesLinear,
    calLogreg,
    fitDualLogistic,
    knnFeedback,
    oracle,
    type Policy,
    type RunContext,
    rocchio,
    type SegmentMath,
    todaySemantic,
} from "./policies";
import { POOLS } from "./segments";
import { contextFor, simulate } from "./simulate";

const D = EMBED_DIM;
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
    if (!ok) failures += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// ── A synthetic pool: three clusters, the first one is mostly "good" ────────
const rng = createRng(11);
const N = 360;
const DIMS = 6;
const centres = [0, 1, 2].map(() => Float64Array.from({ length: D }, () => rng.normal()));
const common = Float64Array.from({ length: D }, () => rng.normal());
const raw = new Float32Array(N * D);
const labels = new Uint8Array(N);
for (let i = 0; i < N; i++) {
    const cluster = i % 3;
    // Noisy on purpose, so whatever a policy checks holds both verdicts.
    labels[i] = rng.next() < (cluster === 0 ? 0.7 : 0.1) ? 1 : 0;
    for (let k = 0; k < D; k++)
        raw[i * D + k] = 1.5 * common[k]! + centres[cluster]![k]! + 0.9 * rng.normal();
}
const pool = {
    spec: POOLS[0]!,
    size: N,
    texts: [],
    parts: [],
    labels: () => labels,
    leftOut: {},
    fingerprint: "synthetic",
} satisfies LoadedPool;
const pv: PoolVectors = {
    pool,
    mode: "plain",
    raw: { data: raw, count: N },
    unit: unitRows(raw, N, D),
};
const math = buildPoolMath(pv, DIMS);
// The brief leans toward the good cluster but also toward a second one, so today's top holds both.
const briefUnit = unitVector(
    Float64Array.from(
        { length: D },
        (_, k) =>
            1.5 * common[k]! + 0.45 * centres[0]![k]! + 0.35 * centres[1]![k]! + 0.8 * rng.normal()
    )
);
const baselineUnit = unitVector(common);
const cosBrief = new Float64Array(N);
const cosBaseline = new Float64Array(N);
const today = new Float64Array(N);
const span = 1 - dotAt(briefUnit, 0, baselineUnit, 0, D);
for (let i = 0; i < N; i++) {
    cosBrief[i] = dotAt(pv.unit, i * D, briefUnit, 0, D);
    cosBaseline[i] = dotAt(pv.unit, i * D, baselineUnit, 0, D);
    today[i] = (cosBrief[i]! - cosBaseline[i]!) / span;
}
const segment: SegmentMath = {
    labels,
    today,
    lexical: new Float64Array(N),
    cosBrief,
    cosBaseline,
    briefMeanDot: dotAt(briefUnit, 0, math.mean, 0, D),
};
const active = Int32Array.from(
    createRng(5)
        .shuffle(Array.from({ length: N }, (_, i) => i))
        .slice(0, 300)
);
const context = (): RunContext => contextFor(math, segment, active, "selfcheck|1");
const cosine = (i: number, j: number): number => dotAt(pv.unit, i * D, pv.unit, j * D, D);

/** Feed a policy the first `count` companies of today's ranking; returns what it has seen. */
function warmUp(
    policy: Policy,
    count: number
): { run: ReturnType<Policy["start"]>; seen: number[] } {
    const run = policy.start(context());
    const seen: number[] = [];
    while (seen.length < count) {
        const batch = run.next(5);
        for (const j of batch) run.observe(j, labels[j] === 1);
        seen.push(...batch);
    }
    return { run, seen };
}

/** The best `count` unseen companies of the subsample under a score computed the slow way. */
function expectedTop(seen: number[], score: (j: number) => number, count: number): number[] {
    const taken = new Set(seen);
    return Array.from(active)
        .filter(j => !taken.has(j))
        .map((j, order) => ({ j, order, v: score(j) }))
        .sort((a, b) => b.v - a.v || a.order - b.order)
        .slice(0, count)
        .map(x => x.j);
}
const same = (a: number[], b: number[]): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i]);

// ── The similarity matrix ───────────────────────────────────────────────────
{
    let worst = 0;
    for (let t = 0; t < 200; t++) {
        const i = rng.int(N);
        const j = rng.int(N);
        worst = Math.max(worst, Math.abs(math.gram[i * N + j]! - cosine(i, j)));
    }
    check(
        "similarity matrix equals the cosines",
        worst < 1e-6,
        `max error ${worst.toExponential(1)}`
    );
    let meanSq = 0;
    for (let i = 0; i < N; i++)
        for (let c = 0; c < DIMS; c++) meanSq += math.proj[i * DIMS + c]! ** 2;
    check("projection has mean square length 1", Math.abs(meanSq / N - 1) < 1e-9);
}

// ── Fixed rankings, the oracle and the simulator ────────────────────────────
{
    const first = todaySemantic.start(context()).next(5);
    check(
        "today-semantic starts at the top of today's ranking",
        same(
            first,
            expectedTop([], j => today[j]!, 5)
        )
    );
    const options = { batchSize: 5, budgets: [25, 50, 100, 200], shortlist: 25, checksCap: 500 };
    const best = simulate(oracle, context(), options);
    const goodHere = Array.from(active).filter(j => labels[j] === 1).length;
    check(
        "oracle finds every good company first",
        best.found[0] === 25 &&
            best.found[3] === Math.min(200, goodHere) &&
            best.checksToShortlist === 25,
        `found ${best.found.join("/")}, ${goodHere} good in the subsample`
    );
    const order = [3, 0, 1, 2];
    const tiny = Uint8Array.from([1, 0, 0, 1]);
    check(
        "average precision of a known ranking",
        Math.abs(averagePrecision(order, tiny) - (1 + 2 / 2) / 2) < 1e-12
    );
}

// ── Rocchio ─────────────────────────────────────────────────────────────────
{
    const policy = rocchio(HYPER.rocchio);
    const start = policy.start(context()).next(5);
    check(
        "rocchio is today's ranking before any verdict",
        same(
            start,
            expectedTop([], j => today[j]!, 5)
        )
    );
    const { run, seen } = warmUp(policy, 40);
    const query = new Float64Array(D);
    const positives = seen.filter(j => labels[j] === 1);
    const negatives = seen.filter(j => labels[j] !== 1);
    for (let k = 0; k < D; k++) {
        let p = 0;
        let n = 0;
        for (const j of positives) p += pv.unit[j * D + k]!;
        for (const j of negatives) n += pv.unit[j * D + k]!;
        query[k] =
            HYPER.rocchio.alpha * briefUnit[k]! +
            (positives.length ? (HYPER.rocchio.beta * p) / positives.length : 0) -
            (negatives.length ? (HYPER.rocchio.gamma * n) / negatives.length : 0);
    }
    const queryUnit = unitVector(query);
    const expected = expectedTop(
        seen,
        j => dotAt(pv.unit, j * D, queryUnit, 0, D) - cosBaseline[j]!,
        10
    );
    check(
        "rocchio re-scores with the moved query vector",
        same(run.next(10), expected),
        `${positives.length} positives, ${negatives.length} negatives seen`
    );
}

// ── Nearest checked neighbours ──────────────────────────────────────────────
{
    const { run, seen } = warmUp(knnFeedback(HYPER.knn), 40);
    const k = HYPER.knn.neighbours;
    const nearest = (j: number, among: number[]): number => {
        const top = among
            .map(i => cosine(i, j))
            .sort((a, b) => b - a)
            .slice(0, k);
        return top.length ? top.reduce((s, v) => s + v, 0) / top.length : 0;
    };
    const positives = seen.filter(j => labels[j] === 1);
    const negatives = seen.filter(j => labels[j] !== 1);
    const expected = expectedTop(
        seen,
        j => today[j]! + HYPER.knn.weight * (nearest(j, positives) - nearest(j, negatives)),
        10
    );
    const got = run.next(10);
    // Single-precision similarities can swap two near-equal neighbours; the sets must agree.
    check(
        "knn-feedback adds nearest positives and subtracts nearest negatives",
        same([...got].sort(), [...expected].sort())
    );
}

// ── Logistic regression ─────────────────────────────────────────────────────
{
    // The dual solver against the optimality condition of the primal problem.
    const m = 40;
    const p = 10;
    const lambda = 0.5;
    const features = Float64Array.from({ length: m * p }, () => rng.normal());
    const y = Float64Array.from({ length: m }, () => (rng.next() < 0.4 ? 1 : 0));
    const kernel = new Float64Array(m * m);
    for (let a = 0; a < m; a++)
        for (let b = 0; b < m; b++) {
            let sum = 0;
            for (let c = 0; c < p; c++) sum += features[a * p + c]! * features[b * p + c]!;
            kernel[a * m + b] = sum;
        }
    const alpha = new Float64Array(m);
    fitDualLogistic(kernel, m, y, alpha, lambda);
    const w = new Float64Array(p);
    for (let a = 0; a < m; a++)
        for (let c = 0; c < p; c++) w[c]! += alpha[a]! * features[a * p + c]!;
    let gradSq = 0;
    for (let c = 0; c < p; c++) {
        let g = lambda * w[c]!;
        for (let a = 0; a < m; a++) {
            let f = 0;
            for (let e = 0; e < p; e++) f += features[a * p + e]! * w[e]!;
            g += (1 / (1 + Math.exp(-f)) - y[a]!) * features[a * p + c]!;
        }
        gradSq += g * g;
    }
    check(
        "logistic fit is at the primal optimum",
        Math.sqrt(gradSq) < 2e-3,
        `gradient norm ${Math.sqrt(gradSq).toExponential(1)}`
    );

    // cal-logreg against the same model built from explicit features.
    const policy = calLogreg(HYPER.logreg);
    const { run, seen } = warmUp(policy, 40);
    const negativesSeen = seen.filter(j => labels[j] !== 1).length;
    const provisional = context()
        .stream("provisional-negatives")
        .shuffle(Array.from(active))
        .slice(0, HYPER.logreg.provisionalNegatives)
        .filter(j => !seen.includes(j))
        .slice(0, Math.max(0, HYPER.logreg.provisionalNegatives - negativesSeen));
    let mu = 0;
    for (const j of active) mu += today[j]!;
    mu /= active.length;
    let sd = 0;
    for (const j of active) sd += (today[j]! - mu) ** 2;
    sd = Math.sqrt(sd / (active.length - 1));
    const rho = 1 / Math.sqrt(1 - math.meanSq);
    const width = D + 2;
    const featuresOf = (vector: Float64Array, offset: number, score: number): Float64Array => {
        const out = new Float64Array(width);
        for (let k = 0; k < D; k++) out[k] = rho * (vector[offset + k]! - math.mean[k]!);
        out[D] = (score - mu) / sd;
        out[D + 1] = 1;
        return out;
    };
    const training = [
        { x: featuresOf(briefUnit, 0, 1), y: 1 },
        ...seen.map(j => ({
            x: featuresOf(pv.unit, j * D, today[j]!),
            y: labels[j] === 1 ? 1 : 0,
        })),
        ...provisional.map(j => ({ x: featuresOf(pv.unit, j * D, today[j]!), y: 0 })),
    ];
    const size = training.length;
    const explicit = new Float64Array(size * size);
    for (let a = 0; a < size; a++)
        for (let b = a; b < size; b++) {
            let sum = 0;
            for (let k = 0; k < width; k++) sum += training[a]!.x[k]! * training[b]!.x[k]!;
            explicit[a * size + b] = sum;
            explicit[b * size + a] = sum;
        }
    const dual = new Float64Array(size);
    fitDualLogistic(
        explicit,
        size,
        Float64Array.from(training.map(t => t.y)),
        dual,
        1 / HYPER.logreg.c
    );
    const weights = new Float64Array(width);
    for (let a = 0; a < size; a++)
        for (let k = 0; k < width; k++) weights[k]! += dual[a]! * training[a]!.x[k]!;
    const expected = expectedTop(
        seen,
        j => {
            const x = featuresOf(pv.unit, j * D, today[j]!);
            let f = 0;
            for (let k = 0; k < width; k++) f += x[k]! * weights[k]!;
            return f;
        },
        10
    );
    const got = run.next(10);
    const overlap = got.filter(j => expected.includes(j)).length;
    check(
        "cal-logreg matches a model on explicit features",
        overlap >= 9,
        `${overlap} of its next 10 are that model's top 10; training set of ${size}`
    );
}

// ── Bayesian linear model ───────────────────────────────────────────────────
{
    const prior = 0.3;
    const model = new BayesLinear(math, segment, prior, HYPER.bayes);
    const p = DIMS + 2;
    const noiseSq = HYPER.bayes.noiseSd ** 2;
    const precision = new Float64Array(p * p);
    const rhs = new Float64Array(p);
    for (let i = 0; i < DIMS; i++) precision[i * p + i] = 1 / prior ** 2;
    precision[DIMS * p + DIMS] = 1 / HYPER.bayes.priorSdScore ** 2;
    precision[(DIMS + 1) * p + DIMS + 1] = 1 / HYPER.bayes.priorSdBias ** 2;
    rhs[DIMS] = 1 / HYPER.bayes.priorSdScore ** 2;
    for (let t = 0; t < 30; t++) {
        const j = active[t * 7]!;
        const good = labels[j] === 1;
        model.shrink(j);
        model.learn(j, good);
        const x = [...math.proj.subarray(j * DIMS, (j + 1) * DIMS), today[j]!, 1];
        for (let a = 0; a < p; a++) {
            for (let b = 0; b < p; b++) precision[a * p + b]! += (x[a]! * x[b]!) / noiseSq;
            if (good) rhs[a]! += x[a]! / noiseSq;
        }
    }
    // precision · cov must be the identity, and precision · mean the right-hand side.
    let worst = 0;
    for (let a = 0; a < p; a++)
        for (let b = 0; b < p; b++) {
            let sum = 0;
            for (let c = 0; c < p; c++) sum += precision[a * p + c]! * model.cov[c * p + b]!;
            worst = Math.max(worst, Math.abs(sum - (a === b ? 1 : 0)));
        }
    const mean = model.mean();
    let worstMean = 0;
    for (let a = 0; a < p; a++) {
        let sum = 0;
        for (let c = 0; c < p; c++) sum += precision[a * p + c]! * mean[c]!;
        worstMean = Math.max(worstMean, Math.abs(sum - rhs[a]!));
    }
    check(
        "Bayesian model: covariance is the inverse of the precision",
        worst < 1e-8,
        `max error ${worst.toExponential(1)}`
    );
    check(
        "Bayesian model: mean solves the normal equations",
        worstMean < 1e-6,
        `max error ${worstMean.toExponential(1)}`
    );
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
