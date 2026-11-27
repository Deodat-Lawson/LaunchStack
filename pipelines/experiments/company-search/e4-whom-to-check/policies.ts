/**
 * The policies: each decides which unchecked company to check next.
 *
 * A policy starts with the brief and no labels. It sees a company's embedding,
 * today's relevance score and, for companies it has checked, the verdict.
 * It never reads `segment.labels`; only the oracle does.
 *
 * Similarities between companies come from one precomputed matrix per pool
 * (`pool.gram`), so a policy's cost per check is a pass over the pool rather
 * than a pass over the embeddings.
 */
import type { Rng } from "../lib/rng";
import type { Hyper } from "./config";
import { choleskyLower } from "./linalg";

export interface PoolMath {
    /** Companies in the pool. */
    n: number;
    /** [n × n] cosine similarity between companies. */
    gram: Float32Array;
    /** Each company's cosine-weighted dot with the pool's mean embedding. */
    meanDot: Float64Array;
    /** The mean embedding's squared length. */
    meanSq: number;
    /** [n × dims] the centred embeddings on the pool's principal directions, mean square length 1. */
    proj: Float64Array;
    dims: number;
}

export interface SegmentMath {
    /** 1 where the company is good. Only the simulator and the oracle read it. */
    labels: Uint8Array;
    /** Production's semanticRelevance of each company to the brief. */
    today: Float64Array;
    /** Production's lexicalRelevance of each company to the segment. */
    lexical: Float64Array;
    /** Cosine of each company to the brief. */
    cosBrief: Float64Array;
    /** Cosine of each company to production's baseline text. */
    cosBaseline: Float64Array;
    /** The brief's dot with the pool's mean embedding. */
    briefMeanDot: number;
}

export interface RunContext {
    pool: PoolMath;
    segment: SegmentMath;
    /** The seed's subsample of the pool, in tie-break order: earlier wins a tie. */
    active: Int32Array;
    /** A named random stream of this (segment, seed): the same name gives every policy the same draws. */
    stream(name: string): Rng;
}

export interface PolicyRun {
    /** The next companies to check, best first. Never returns a company twice. */
    next(count: number): number[];
    /** The verdict on a company `next` returned. */
    observe(index: number, good: boolean): void;
}

export interface Policy {
    name: string;
    /** A fixed order: no verdict changes it. */
    fixed: boolean;
    start(ctx: RunContext): PolicyRun;
}

// ── Shared pieces ───────────────────────────────────────────────────────────

/**
 * The `count` best companies not yet taken, best first; among equal scores the
 * one earlier in tie-break order. Marks them taken.
 */
function takeTop(
    active: Int32Array,
    taken: Uint8Array,
    scores: Float64Array,
    count: number
): number[] {
    const best: number[] = [];
    const bestScore: number[] = [];
    for (const j of active) {
        if (taken[j]) continue;
        const v = scores[j]!;
        if (best.length === count && !(v > bestScore[count - 1]!)) continue;
        let at = best.length;
        while (at > 0 && v > bestScore[at - 1]!) at--;
        best.splice(at, 0, j);
        bestScore.splice(at, 0, v);
        if (best.length > count) {
            best.pop();
            bestScore.pop();
        }
    }
    for (const j of best) taken[j] = 1;
    return best;
}

/** The subsample ordered by a score, best first, ties in tie-break order. */
function orderBy(active: Int32Array, scores: ArrayLike<number>): number[] {
    const positions = Array.from({ length: active.length }, (_, a) => a);
    positions.sort((a, b) => scores[active[b]!]! - scores[active[a]!]! || a - b);
    return positions.map(a => active[a]!);
}

function fixedOrder(name: string, order: (ctx: RunContext) => number[]): Policy {
    return {
        name,
        fixed: true,
        start(ctx) {
            const queue = order(ctx);
            let at = 0;
            return {
                next(count) {
                    const out = queue.slice(at, at + count);
                    at += out.length;
                    return out;
                },
                observe() {
                    /* a fixed order learns nothing */
                },
            };
        },
    };
}

/** Mean and spread of today's score over the subsample, for standardising it. */
function scoreScale(ctx: RunContext): { mean: number; sd: number } {
    const { active, segment } = ctx;
    let sum = 0;
    for (const j of active) sum += segment.today[j]!;
    const mean = sum / Math.max(1, active.length);
    let sq = 0;
    for (const j of active) {
        const v = segment.today[j]! - mean;
        sq += v * v;
    }
    const sd = Math.sqrt(sq / Math.max(1, active.length - 1));
    return { mean, sd: sd > 0 ? sd : 1 };
}

// ── Fixed rankings and bounds ───────────────────────────────────────────────

/** Production today: the semantic ranking, top down. */
export const todaySemantic: Policy = fixedOrder("today-semantic", ctx =>
    orderBy(ctx.active, ctx.segment.today)
);

/** Production with no embedder: the word-overlap ranking, top down. */
export const todayLexical: Policy = fixedOrder("today-lexical", ctx =>
    orderBy(ctx.active, ctx.segment.lexical)
);

/** Lower bound: a random order. */
export const random: Policy = fixedOrder("random", ctx =>
    ctx.stream("random").shuffle(Array.from(ctx.active))
);

/** Upper bound: every good company first. */
export const oracle: Policy = fixedOrder("oracle", ctx => orderBy(ctx.active, ctx.segment.labels));

// ── Rocchio ─────────────────────────────────────────────────────────────────

/**
 * Production's relevance with a brief vector that moves: after each batch the
 * query is alpha·brief + beta·(mean of checked positives) − gamma·(mean of
 * checked negatives), and a company's score is its cosine to that query minus
 * its cosine to the baseline text, as today. Before any verdict it is today's
 * ranking exactly.
 */
export function rocchio(hyper: Hyper["rocchio"]): Policy {
    return {
        name: "rocchio",
        fixed: false,
        start(ctx) {
            const { pool, segment, active } = ctx;
            const n = pool.n;
            const taken = new Uint8Array(n);
            const sumPos = new Float64Array(n);
            const sumNeg = new Float64Array(n);
            const scores = new Float64Array(n);
            let nPos = 0;
            let nNeg = 0;
            // Sums of similarities inside and between the two checked sets, and to the brief.
            let pp = 0;
            let nn = 0;
            let pn = 0;
            let bp = 0;
            let bn = 0;
            return {
                next(count) {
                    if (nPos + nNeg === 0) return takeTop(active, taken, segment.today, count);
                    const b = nPos > 0 ? hyper.beta / nPos : 0;
                    const c = nNeg > 0 ? hyper.gamma / nNeg : 0;
                    const a = hyper.alpha;
                    const normSq =
                        a * a +
                        b * b * pp +
                        c * c * nn +
                        2 * a * b * bp -
                        2 * a * c * bn -
                        2 * b * c * pn;
                    const norm = Math.sqrt(Math.max(normSq, 1e-12));
                    for (const j of active) {
                        const toQuery = a * segment.cosBrief[j]! + b * sumPos[j]! - c * sumNeg[j]!;
                        scores[j] = toQuery / norm - segment.cosBaseline[j]!;
                    }
                    return takeTop(active, taken, scores, count);
                },
                observe(index, good) {
                    const row = pool.gram.subarray(index * n, (index + 1) * n);
                    if (good) {
                        pp += 2 * sumPos[index]! + 1;
                        pn += sumNeg[index]!;
                        bp += segment.cosBrief[index]!;
                        for (let j = 0; j < n; j++) sumPos[j]! += row[j]!;
                        nPos += 1;
                    } else {
                        nn += 2 * sumNeg[index]! + 1;
                        pn += sumPos[index]!;
                        bn += segment.cosBrief[index]!;
                        for (let j = 0; j < n; j++) sumNeg[j]! += row[j]!;
                        nNeg += 1;
                    }
                },
            };
        },
    };
}

// ── Nearest checked neighbours ──────────────────────────────────────────────

/**
 * Today's score, plus the mean cosine to the nearest checked positives, minus
 * the mean cosine to the nearest checked negatives. A side with nothing
 * checked yet adds nothing.
 */
export function knnFeedback(hyper: Hyper["knn"]): Policy {
    return {
        name: "knn-feedback",
        fixed: false,
        start(ctx) {
            const { pool, segment, active } = ctx;
            const n = pool.n;
            const k = hyper.neighbours;
            const taken = new Uint8Array(n);
            // Per company, its k highest similarities to each checked set, descending.
            const topPos = new Float32Array(n * k).fill(-2);
            const topNeg = new Float32Array(n * k).fill(-2);
            const scores = new Float64Array(n);
            let nPos = 0;
            let nNeg = 0;
            const insert = (top: Float32Array, row: Float32Array): void => {
                for (let j = 0; j < n; j++) {
                    const v = row[j]!;
                    const o = j * k;
                    if (!(v > top[o + k - 1]!)) continue;
                    let at = k - 1;
                    while (at > 0 && v > top[o + at - 1]!) {
                        top[o + at] = top[o + at - 1]!;
                        at--;
                    }
                    top[o + at] = v;
                }
            };
            const meanTop = (top: Float32Array, j: number, have: number): number => {
                if (have === 0) return 0;
                let sum = 0;
                for (let i = 0; i < have; i++) sum += top[j * k + i]!;
                return sum / have;
            };
            return {
                next(count) {
                    const havePos = Math.min(k, nPos);
                    const haveNeg = Math.min(k, nNeg);
                    for (const j of active) {
                        scores[j] =
                            segment.today[j]! +
                            hyper.weight *
                                (meanTop(topPos, j, havePos) - meanTop(topNeg, j, haveNeg));
                    }
                    return takeTop(active, taken, scores, count);
                },
                observe(index, good) {
                    const row = pool.gram.subarray(index * n, (index + 1) * n);
                    if (good) {
                        insert(topPos, row);
                        nPos += 1;
                    } else {
                        insert(topNeg, row);
                        nNeg += 1;
                    }
                },
            };
        },
    };
}

// ── Continuous active learning: logistic regression ─────────────────────────

const sigmoid = (x: number): number =>
    x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
const softplus = (x: number): number => (x > 30 ? x : Math.log1p(Math.exp(x)));

function multiply(k: Float64Array, m: number, v: Float64Array, out: Float64Array): void {
    for (let i = 0; i < m; i++) {
        const o = i * m;
        let sum = 0;
        for (let j = 0; j < m; j++) sum += k[o + j]! * v[j]!;
        out[i] = sum;
    }
}

function dot(a: Float64Array, b: Float64Array, m: number): number {
    let sum = 0;
    for (let i = 0; i < m; i++) sum += a[i]! * b[i]!;
    return sum;
}

/**
 * L2-regularised logistic regression in its dual form: the weight vector is
 * Σ alpha_i · features_i and `kernel` holds the features' inner products, so a
 * fit over m training points costs m² per step whatever the feature count.
 * Truncated Newton (conjugate gradients inside, backtracking outside), warm
 * started from `alpha`. Minimises Σ log-loss + (lambda / 2)·|w|².
 */
export function fitDualLogistic(
    kernel: Float64Array,
    m: number,
    y: Float64Array,
    alpha: Float64Array,
    lambda: number
): void {
    const f = new Float64Array(m);
    const r = new Float64Array(m);
    const rf = new Float64Array(m);
    const w = new Float64Array(m);
    const d = new Float64Array(m);
    const df = new Float64Array(m);
    const cr = new Float64Array(m);
    const crf = new Float64Array(m);
    const cp = new Float64Array(m);
    const cpf = new Float64Array(m);
    const q = new Float64Array(m);
    const qf = new Float64Array(m);
    multiply(kernel, m, alpha, f);
    const objective = (step: number): number => {
        let loss = 0;
        let penalty = 0;
        for (let i = 0; i < m; i++) {
            const fi = f[i]! + step * df[i]!;
            loss += softplus(y[i]! > 0.5 ? -fi : fi);
            penalty += (alpha[i]! + step * d[i]!) * fi;
        }
        return loss + 0.5 * lambda * penalty;
    };
    for (let outer = 0; outer < 40; outer++) {
        for (let i = 0; i < m; i++) {
            const p = sigmoid(f[i]!);
            r[i] = -(p - y[i]! + lambda * alpha[i]!);
            w[i] = Math.max(p * (1 - p), 1e-10);
        }
        multiply(kernel, m, r, rf);
        const gradSq = dot(r, rf, m);
        if (!(gradSq > 1e-6)) break;
        // Conjugate gradients on the Newton system, in the weights' own metric.
        d.fill(0);
        df.fill(0);
        cr.set(r);
        crf.set(rf);
        cp.set(r);
        cpf.set(rf);
        let rr = gradSq;
        for (let it = 0; it < 200; it++) {
            for (let i = 0; i < m; i++) q[i] = lambda * cp[i]! + w[i]! * cpf[i]!;
            multiply(kernel, m, q, qf);
            const curvature = dot(cpf, q, m);
            if (!(curvature > 0)) break;
            const a = rr / curvature;
            for (let i = 0; i < m; i++) {
                d[i]! += a * cp[i]!;
                df[i]! += a * cpf[i]!;
                cr[i]! -= a * q[i]!;
                crf[i]! -= a * qf[i]!;
            }
            const rrNext = dot(cr, crf, m);
            if (!(rrNext > 1e-4 * gradSq)) break;
            const beta = rrNext / rr;
            for (let i = 0; i < m; i++) {
                cp[i] = cr[i]! + beta * cp[i]!;
                cpf[i] = crf[i]! + beta * cpf[i]!;
            }
            rr = rrNext;
        }
        const descent = dot(r, df, m);
        if (!(descent > 0)) break;
        const before = objective(0);
        let step = 1;
        for (let halving = 0; halving < 30; halving++) {
            if (objective(step) <= before - 1e-4 * step * descent) break;
            step /= 2;
        }
        for (let i = 0; i < m; i++) {
            alpha[i]! += step * d[i]!;
            f[i]! += step * df[i]!;
        }
    }
}

const BRIEF = -1;

interface LogregOptions {
    name: string;
    /** `top`: check the highest-scored; `uncertain`: check the one closest to even odds. */
    pick: "top" | "uncertain";
    /** Share of checks spent on a random unchecked company. */
    epsilon: number;
}

/**
 * Continuous active learning as in technology-assisted review. The model is a
 * logistic regression on the company's embedding (centred on the pool's mean)
 * plus today's score (standardised) and an intercept. It is retrained before
 * every batch on: the brief as a positive, every checked company with its
 * verdict, and random unchecked companies as provisional negatives, which
 * are retired one for one as real negatives arrive.
 */
function logreg(hyper: Hyper["logreg"], options: LogregOptions): Policy {
    return {
        name: options.name,
        fixed: false,
        start(ctx) {
            const { pool, segment, active } = ctx;
            const n = pool.n;
            const lambda = 1 / hyper.c;
            const taken = new Uint8Array(n);
            const verdict = new Int8Array(n).fill(-1);
            const checked: number[] = [];
            let negatives = 0;
            let remaining = active.length;
            // The same provisional negatives for every logistic policy of this seed.
            const provisional = ctx
                .stream("provisional-negatives")
                .shuffle(Array.from(active))
                .slice(0, hyper.provisionalNegatives);
            const sampler = ctx.stream(options.name);

            const scale = scoreScale(ctx);
            const z = new Float64Array(n);
            for (let j = 0; j < n; j++) z[j] = (segment.today[j]! - scale.mean) / scale.sd;
            // The brief's own relevance to itself is 1 by production's formula.
            const zBrief = (1 - scale.mean) / scale.sd;
            // Centred embeddings are scaled to mean square length 1.
            const rho2 = 1 / Math.max(1e-9, 1 - pool.meanSq);

            const alphaOf = new Float64Array(n);
            let alphaBrief = 0;
            const scores = new Float64Array(n);
            const acc = new Float64Array(n);
            let stale = true;

            const similarity = (a: number, b: number): number =>
                a === BRIEF
                    ? b === BRIEF
                        ? 1
                        : segment.cosBrief[b]!
                    : b === BRIEF
                      ? segment.cosBrief[a]!
                      : pool.gram[a * n + b]!;
            const meanDotOf = (a: number): number =>
                a === BRIEF ? segment.briefMeanDot : pool.meanDot[a]!;
            const zOf = (a: number): number => (a === BRIEF ? zBrief : z[a]!);

            const refit = (): void => {
                const keep = Math.max(0, hyper.provisionalNegatives - negatives);
                const stillProvisional: number[] = [];
                for (const j of provisional) {
                    if (verdict[j]! >= 0) continue;
                    if (stillProvisional.length < keep) stillProvisional.push(j);
                    else alphaOf[j] = 0;
                }
                const points = [BRIEF, ...checked, ...stillProvisional];
                const m = points.length;
                const kernel = new Float64Array(m * m);
                const y = new Float64Array(m);
                const alpha = new Float64Array(m);
                for (let s = 0; s < m; s++) {
                    const a = points[s]!;
                    y[s] = a === BRIEF || verdict[a] === 1 ? 1 : 0;
                    alpha[s] = a === BRIEF ? alphaBrief : alphaOf[a]!;
                    const ua = meanDotOf(a);
                    const za = zOf(a);
                    for (let t = s; t < m; t++) {
                        const b = points[t]!;
                        const v =
                            rho2 * (similarity(a, b) - ua - meanDotOf(b) + pool.meanSq) +
                            za * zOf(b) +
                            1;
                        kernel[s * m + t] = v;
                        kernel[t * m + s] = v;
                    }
                    kernel[s * m + s]! += 1e-6;
                }
                fitDualLogistic(kernel, m, y, alpha, lambda);

                // Score every company: the model's log-odds.
                acc.fill(0);
                let sumAlpha = 0;
                let sumAlphaMean = 0;
                let sumAlphaZ = 0;
                for (let s = 0; s < m; s++) {
                    const a = points[s]!;
                    const weight = alpha[s]!;
                    if (a === BRIEF) alphaBrief = weight;
                    else alphaOf[a] = weight;
                    sumAlpha += weight;
                    sumAlphaMean += weight * meanDotOf(a);
                    sumAlphaZ += weight * zOf(a);
                    if (weight === 0) continue;
                    if (a === BRIEF) {
                        for (let j = 0; j < n; j++) acc[j]! += weight * segment.cosBrief[j]!;
                    } else {
                        const row = pool.gram.subarray(a * n, (a + 1) * n);
                        for (let j = 0; j < n; j++) acc[j]! += weight * row[j]!;
                    }
                }
                for (let j = 0; j < n; j++) {
                    const logOdds =
                        rho2 *
                            (acc[j]! -
                                sumAlphaMean -
                                pool.meanDot[j]! * sumAlpha +
                                pool.meanSq * sumAlpha) +
                        z[j]! * sumAlphaZ +
                        sumAlpha;
                    scores[j] = options.pick === "top" ? logOdds : -Math.abs(logOdds);
                }
                stale = false;
            };

            // `remaining` is the number of untaken companies at this moment: it
            // is counted down on every pick, also inside a batch, so a random
            // draw never lands past the companies that are still unchecked.
            const takeRandom = (): number | null => {
                if (remaining <= 0) return null;
                let skip = sampler.int(remaining);
                for (const j of active) {
                    if (taken[j]) continue;
                    if (skip === 0) {
                        taken[j] = 1;
                        return j;
                    }
                    skip--;
                }
                return null;
            };

            return {
                next(count) {
                    if (stale) refit();
                    const out: number[] = [];
                    if (options.epsilon <= 0) {
                        out.push(...takeTop(active, taken, scores, count));
                        remaining -= out.length;
                    } else {
                        for (let i = 0; i < count; i++) {
                            const explore = sampler.next() < options.epsilon;
                            const j = explore
                                ? takeRandom()
                                : (takeTop(active, taken, scores, 1)[0] ?? null);
                            if (j === null) break;
                            out.push(j);
                            remaining -= 1;
                        }
                    }
                    return out;
                },
                observe(index, good) {
                    verdict[index] = good ? 1 : 0;
                    checked.push(index);
                    if (!good) negatives += 1;
                    stale = true;
                },
            };
        },
    };
}

/** Check the highest-scored unchecked company. */
export const calLogreg = (hyper: Hyper["logreg"]): Policy =>
    logreg(hyper, { name: "cal-logreg", pick: "top", epsilon: 0 });

/** The textbook contrast: check the company the model is least sure about. */
export const calUncertainty = (hyper: Hyper["logreg"]): Policy =>
    logreg(hyper, { name: "cal-uncertainty", pick: "uncertain", epsilon: 0 });

/** cal-logreg with a share of checks spent on a random unchecked company. */
export const calLogregEgreedy = (hyper: Hyper["logreg"]): Policy =>
    logreg(hyper, { name: "cal-logreg-egreedy", pick: "top", epsilon: hyper.epsilon });

// ── Bayesian linear model: Thompson sampling and LinUCB ─────────────────────

/**
 * verdict ≈ theta · [projected embedding, today's score, 1] + noise, with a
 * Gaussian prior on theta whose mean is "today's score, as it is": weight 1
 * on the score, 0 elsewhere. The posterior is exact and updated one verdict
 * at a time.
 */
export class BayesLinear {
    readonly p: number;
    /** Posterior covariance, [p × p]. */
    readonly cov: Float64Array;
    /** Prior precision·mean + Σ features·verdict / noise². */
    private readonly b: Float64Array;
    private readonly noiseSq: number;
    private readonly scratch: Float64Array;

    constructor(
        private readonly pool: PoolMath,
        private readonly segment: SegmentMath,
        priorSdProjection: number,
        hyper: Hyper["bayes"]
    ) {
        const dims = pool.dims;
        this.p = dims + 2;
        this.cov = new Float64Array(this.p * this.p);
        this.b = new Float64Array(this.p);
        this.scratch = new Float64Array(this.p);
        this.noiseSq = hyper.noiseSd * hyper.noiseSd;
        for (let i = 0; i < dims; i++)
            this.cov[i * this.p + i] = priorSdProjection * priorSdProjection;
        this.cov[dims * this.p + dims] = hyper.priorSdScore * hyper.priorSdScore;
        this.cov[(dims + 1) * this.p + dims + 1] = hyper.priorSdBias * hyper.priorSdBias;
        this.b[dims] = 1 / (hyper.priorSdScore * hyper.priorSdScore);
    }

    /** features(j) · v, for a parameter-shaped vector v. */
    dotFeatures(j: number, v: Float64Array): number {
        const dims = this.pool.dims;
        const o = j * dims;
        let sum = 0;
        for (let i = 0; i < dims; i++) sum += this.pool.proj[o + i]! * v[i]!;
        return sum + this.segment.today[j]! * v[dims]! + v[dims + 1]!;
    }

    /** cov · features(j), into the scratch vector. */
    private covTimesFeatures(j: number): Float64Array {
        const { p, cov, scratch } = this;
        const dims = this.pool.dims;
        const o = j * dims;
        const today = this.segment.today[j]!;
        for (let r = 0; r < p; r++) {
            const ro = r * p;
            let sum = 0;
            for (let i = 0; i < dims; i++) sum += cov[ro + i]! * this.pool.proj[o + i]!;
            scratch[r] = sum + cov[ro + dims]! * today + cov[ro + dims + 1]!;
        }
        return scratch;
    }

    /**
     * The covariance after a check of company j (it does not depend on the
     * verdict). Returns cov·features before the update and the divisor, so a
     * caller can update every company's predictive variance in one pass.
     */
    shrink(j: number): { direction: Float64Array; divisor: number } {
        const { p, cov } = this;
        const u = this.covTimesFeatures(j);
        const divisor = this.noiseSq + this.dotFeatures(j, u);
        for (let r = 0; r < p; r++) {
            const ur = u[r]! / divisor;
            for (let c = 0; c < p; c++) cov[r * p + c]! -= ur * u[c]!;
        }
        return { direction: u, divisor };
    }

    /** Add the verdict on company j to the evidence. */
    learn(j: number, good: boolean): void {
        if (!good) return;
        const dims = this.pool.dims;
        const o = j * dims;
        for (let i = 0; i < dims; i++) this.b[i]! += this.pool.proj[o + i]! / this.noiseSq;
        this.b[dims]! += this.segment.today[j]! / this.noiseSq;
        this.b[dims + 1]! += 1 / this.noiseSq;
    }

    /** Posterior mean of theta. */
    mean(): Float64Array {
        const { p, cov, b } = this;
        const out = new Float64Array(p);
        for (let r = 0; r < p; r++) {
            let sum = 0;
            for (let c = 0; c < p; c++) sum += cov[r * p + c]! * b[c]!;
            out[r] = sum;
        }
        return out;
    }

    /** features(j)ᵀ · cov · features(j). */
    variance(j: number): number {
        return this.dotFeatures(j, this.covTimesFeatures(j));
    }
}

/**
 * Thompson sampling: for each check, draw one plausible theta from the
 * posterior and check the company it scores highest.
 */
export function thompson(hyper: Hyper["bayes"], own: Hyper["thompson"]): Policy {
    return {
        name: "thompson",
        fixed: false,
        start(ctx) {
            const { pool, segment, active } = ctx;
            const model = new BayesLinear(pool, segment, own.priorSdProjection, hyper);
            const rng = ctx.stream("thompson");
            const taken = new Uint8Array(pool.n);
            const p = model.p;
            let mean = model.mean();
            let factor = choleskyLower(model.cov, p);
            let stale = false;
            const noise = new Float64Array(p);
            const theta = new Float64Array(p);
            return {
                next(count) {
                    if (stale) {
                        mean = model.mean();
                        factor = choleskyLower(model.cov, p);
                        stale = false;
                    }
                    const out: number[] = [];
                    for (let i = 0; i < count; i++) {
                        for (let r = 0; r < p; r++) noise[r] = rng.normal();
                        for (let r = 0; r < p; r++) {
                            let sum = mean[r]!;
                            for (let c = 0; c <= r; c++) sum += factor[r * p + c]! * noise[c]!;
                            theta[r] = sum;
                        }
                        let best = -1;
                        let bestScore = -Infinity;
                        for (const j of active) {
                            if (taken[j]) continue;
                            const v = model.dotFeatures(j, theta);
                            if (v > bestScore) {
                                bestScore = v;
                                best = j;
                            }
                        }
                        if (best < 0) break;
                        taken[best] = 1;
                        out.push(best);
                    }
                    return out;
                },
                observe(index, good) {
                    model.shrink(index);
                    model.learn(index, good);
                    stale = true;
                },
            };
        },
    };
}

/**
 * LinUCB: check the company with the highest predicted score plus a bonus
 * for how unsure the model is about it. Inside a batch the uncertainty is
 * updated after each pick (it does not depend on the verdict), so one batch
 * does not spend all its checks on the same unknown.
 */
export function linucb(hyper: Hyper["bayes"], own: Hyper["linucb"]): Policy {
    return {
        name: "linucb",
        fixed: false,
        start(ctx) {
            const { pool, segment, active } = ctx;
            const n = pool.n;
            const model = new BayesLinear(pool, segment, own.priorSdProjection, hyper);
            const taken = new Uint8Array(n);
            const predicted = new Float64Array(n);
            const variance = new Float64Array(n);
            for (const j of active) variance[j] = model.variance(j);
            let stale = true;
            return {
                next(count) {
                    if (stale) {
                        const mean = model.mean();
                        for (const j of active) predicted[j] = model.dotFeatures(j, mean);
                        stale = false;
                    }
                    const out: number[] = [];
                    for (let i = 0; i < count; i++) {
                        let best = -1;
                        let bestScore = -Infinity;
                        for (const j of active) {
                            if (taken[j]) continue;
                            const v =
                                predicted[j]! + own.bonus * Math.sqrt(Math.max(0, variance[j]!));
                            if (v > bestScore) {
                                bestScore = v;
                                best = j;
                            }
                        }
                        if (best < 0) break;
                        taken[best] = 1;
                        out.push(best);
                        const { direction, divisor } = model.shrink(best);
                        for (const j of active) {
                            if (taken[j]) continue;
                            const along = model.dotFeatures(j, direction);
                            variance[j]! -= (along * along) / divisor;
                        }
                    }
                    return out;
                },
                observe(index, good) {
                    model.learn(index, good);
                    stale = true;
                },
            };
        },
    };
}

/** The eleven policies of the experiment, in report order. */
export function allPolicies(hyper: Hyper): Policy[] {
    return [
        todaySemantic,
        todayLexical,
        rocchio(hyper.rocchio),
        calLogreg(hyper.logreg),
        calUncertainty(hyper.logreg),
        calLogregEgreedy(hyper.logreg),
        thompson(hyper.bayes, hyper.thompson),
        linucb(hyper.bayes, hyper.linucb),
        knnFeedback(hyper.knn),
        random,
        oracle,
    ];
}
