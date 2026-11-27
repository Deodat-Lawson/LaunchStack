/**
 * Whom to check next: a shortlist that learns from each verdict.
 *
 * The fixed ranking is a company's relevance to the segment's brief
 * (./semantic), checked from the top down; no verdict changes who is checked
 * next. Here every verdict does: the fit check's during a run, and the ones
 * kept from earlier runs and from people's own decisions (won, not a fit).
 *
 * The model is a Bayesian linear regression of the verdict on three things:
 * where the company's embedding sits along the main directions in which this
 * run's companies differ from each other, its relevance to the brief, and an
 * intercept. Its prior is "the relevance, as it is": before any verdict it
 * predicts exactly the fixed ranking. The company checked next is the one with
 * the highest predicted fit plus a bonus for how unsure the model still is
 * about it (LinUCB), so a kind of company nobody has checked yet gets a look
 * before the list settles on what it already knows.
 *
 * Measured in pipelines/experiments/company-search (E4 for the choice,
 * production-replay for this code): over seven pools it finds 15 to 21 more
 * good companies in 100 checks than the fixed ranking, depending on the
 * embedding model. Where the fixed ranking already puts a good company at
 * nearly every place it gives up a company or two in a hundred. Thompson
 * sampling and checking the least certain company first found fewer in E4, so
 * neither is offered here. The settings below are E4's: it tuned two of them
 * on its two development segments (the prior spread of the direction weights
 * and the bonus) and fixed the others by design. One is not E4's: the main
 * directions are found in 6 passes where E4 makes 20, to keep a large run's
 * arithmetic short.
 */

export interface LearnerSettings {
    /** Main directions of the companies' embeddings the model sees. */
    dims: number;
    /** Assumed spread of a verdict (0 or 1) around the model's prediction. */
    noiseSd: number;
    /** Prior spread of the weight on relevance, around 1. */
    priorSdScore: number;
    /** Prior spread of the intercept, around 0. */
    priorSdBias: number;
    /** Prior spread of the weights on the embedding's directions, around 0. */
    priorSdProjection: number;
    /** Standard deviations of optimism added to the predicted fit. */
    bonus: number;
    /** Passes of the search for the main directions. */
    rounds: number;
}

export const LEARNER_SETTINGS: Readonly<LearnerSettings> = {
    dims: 48,
    noiseSd: 0.5,
    priorSdScore: 0.25,
    priorSdBias: 1,
    priorSdProjection: 0.4,
    bonus: 0.5,
    rounds: 6,
};

/** A verdict known before the run starts: an earlier run's, or a person's decision. */
export interface EarlierVerdict {
    /** The company's embedding, from the same model as the candidates'. */
    vector: readonly number[];
    /** Its relevance to this run's brief. */
    relevance: number;
    good: boolean;
}

export interface ShortlistLearner {
    /** Candidates, in the order they were given. */
    readonly size: number;
    /** Verdicts learned from so far, earlier ones included. */
    readonly learnedFrom: number;
    /**
     * The next candidates to check, best first: the highest predicted fit plus
     * the uncertainty bonus. Never returns a candidate twice. `among` narrows
     * the choice; fewer than `count` come back when fewer are left.
     */
    next(count: number, among?: (index: number) => boolean): number[];
    /** The verdict on a candidate. */
    observe(index: number, good: boolean): void;
    /** A candidate `next` returned that was never judged: it teaches nothing. */
    skip(index: number): void;
    /** Predicted fit of every candidate from the verdicts so far; the relevance itself before any. */
    predicted(): number[];
}

// ── The model ───────────────────────────────────────────────────────────────

/**
 * verdict ≈ theta · features + noise, with a Gaussian prior on theta. The
 * posterior is exact and moves one company at a time: the covariance when a
 * company is picked (it does not depend on the verdict), the evidence when
 * its verdict arrives.
 */
class Posterior {
    /** Posterior covariance, [p × p]. */
    readonly cov: Float64Array;
    /** Prior precision · prior mean + Σ features · verdict / noise². */
    private readonly evidence: Float64Array;
    private readonly noiseSq: number;

    constructor(
        readonly p: number,
        settings: LearnerSettings
    ) {
        const dims = p - 2;
        this.cov = new Float64Array(p * p);
        this.evidence = new Float64Array(p);
        this.noiseSq = settings.noiseSd * settings.noiseSd;
        for (let i = 0; i < dims; i++)
            this.cov[i * p + i] = settings.priorSdProjection * settings.priorSdProjection;
        this.cov[dims * p + dims] = settings.priorSdScore * settings.priorSdScore;
        this.cov[(dims + 1) * p + dims + 1] = settings.priorSdBias * settings.priorSdBias;
        // Prior mean: weight 1 on relevance, 0 elsewhere.
        this.evidence[dims] = 1 / (settings.priorSdScore * settings.priorSdScore);
    }

    /** cov · f, for the features starting at `at`. */
    private covTimes(features: Float64Array, at: number): Float64Array {
        const { p, cov } = this;
        const out = new Float64Array(p);
        for (let r = 0; r < p; r++) {
            const ro = r * p;
            let sum = 0;
            for (let c = 0; c < p; c++) sum += cov[ro + c]! * features[at + c]!;
            out[r] = sum;
        }
        return out;
    }

    /**
     * The covariance after one more company is checked. Returns cov · f from
     * before the update and the divisor, so a caller can move every other
     * company's variance in one pass.
     */
    shrink(features: Float64Array, at: number): { direction: Float64Array; divisor: number } {
        const { p, cov } = this;
        const u = this.covTimes(features, at);
        let own = 0;
        for (let c = 0; c < p; c++) own += features[at + c]! * u[c]!;
        const divisor = this.noiseSq + own;
        for (let r = 0; r < p; r++) {
            const ur = u[r]! / divisor;
            for (let c = 0; c < p; c++) cov[r * p + c]! -= ur * u[c]!;
        }
        return { direction: u, divisor };
    }

    /**
     * Undo `shrink` for a company that was picked and never judged. Returns
     * cov · f from before the update and the divisor, as `shrink` does.
     */
    restore(features: Float64Array, at: number): { direction: Float64Array; divisor: number } {
        const { p, cov } = this;
        const u = this.covTimes(features, at);
        let own = 0;
        for (let c = 0; c < p; c++) own += features[at + c]! * u[c]!;
        // Always positive: a checked company's variance is below the noise.
        const divisor = Math.max(this.noiseSq - own, 1e-12);
        for (let r = 0; r < p; r++) {
            const ur = u[r]! / divisor;
            for (let c = 0; c < p; c++) cov[r * p + c]! += ur * u[c]!;
        }
        return { direction: u, divisor };
    }

    /** Add a verdict to the evidence. A "no" adds nothing: its target is zero. */
    learn(features: Float64Array, at: number, good: boolean): void {
        if (!good) return;
        for (let c = 0; c < this.p; c++) this.evidence[c]! += features[at + c]! / this.noiseSq;
    }

    /** Posterior mean of theta. */
    mean(): Float64Array {
        const { p, cov, evidence } = this;
        const out = new Float64Array(p);
        for (let r = 0; r < p; r++) {
            let sum = 0;
            for (let c = 0; c < p; c++) sum += cov[r * p + c]! * evidence[c]!;
            out[r] = sum;
        }
        return out;
    }

    /** fᵀ · cov · f. */
    variance(features: Float64Array, at: number): number {
        const u = this.covTimes(features, at);
        let sum = 0;
        for (let c = 0; c < this.p; c++) sum += features[at + c]! * u[c]!;
        return sum;
    }
}

function dotRow(features: Float64Array, at: number, v: Float64Array): number {
    let sum = 0;
    for (let c = 0; c < v.length; c++) sum += features[at + c]! * v[c]!;
    return sum;
}

/**
 * The learner over features that are already built: `rows` companies of `p`
 * numbers each (the projected embedding, then relevance, then 1). The first
 * `candidates` rows can be picked; the rest are earlier verdicts, whose labels
 * are `earlierGood`. `createShortlistLearner` is the way in for production;
 * this is the seam the experiment's checks compare against its own arithmetic.
 */
export function learnerOverFeatures(args: {
    features: Float64Array;
    p: number;
    candidates: number;
    earlierGood?: readonly boolean[];
    settings?: Partial<LearnerSettings>;
}): ShortlistLearner {
    const settings: LearnerSettings = { ...LEARNER_SETTINGS, ...args.settings };
    const { features, p, candidates: n } = args;
    const earlierGood = args.earlierGood ?? [];
    if (features.length !== (n + earlierGood.length) * p)
        throw new Error("The learner's features do not match its companies");
    const model = new Posterior(p, settings);
    const relevanceAt = p - 2;

    let learnedFrom = 0;
    for (const [e, good] of earlierGood.entries()) {
        const at = (n + e) * p;
        model.shrink(features, at);
        model.learn(features, at, good);
        learnedFrom += 1;
    }

    /** 0 open; 1 picked, verdict pending; 2 judged or set aside. */
    const state = new Uint8Array(n);
    const variance = new Float64Array(n);
    for (let j = 0; j < n; j++) variance[j] = model.variance(features, j * p);
    const predicted = new Float64Array(n);
    let stale = true;

    const refresh = (): void => {
        if (!stale) return;
        const theta = model.mean();
        for (let j = 0; j < n; j++) predicted[j] = dotRow(features, j * p, theta);
        stale = false;
    };

    /** Move every open company's variance after the covariance moved along `direction`. */
    const moveVariances = (direction: Float64Array, divisor: number, sign: 1 | -1): void => {
        for (let j = 0; j < n; j++) {
            if (state[j] !== 0) continue;
            const along = dotRow(features, j * p, direction);
            variance[j]! += (sign * (along * along)) / divisor;
        }
    };

    const take = (index: number): void => {
        state[index] = 1;
        const { direction, divisor } = model.shrink(features, index * p);
        moveVariances(direction, divisor, -1);
    };

    return {
        size: n,
        get learnedFrom() {
            return learnedFrom;
        },
        next(count, among) {
            refresh();
            const out: number[] = [];
            for (let i = 0; i < count; i++) {
                let best = -1;
                let bestScore = -Infinity;
                for (let j = 0; j < n; j++) {
                    if (state[j] !== 0 || (among && !among(j))) continue;
                    const score =
                        predicted[j]! + settings.bonus * Math.sqrt(Math.max(0, variance[j]!));
                    // Strictly higher: among equals the earlier candidate wins.
                    if (score > bestScore) {
                        bestScore = score;
                        best = j;
                    }
                }
                if (best < 0) break;
                out.push(best);
                // Inside one batch the uncertainty moves after each pick, so a
                // batch does not spend all its checks on the same unknown.
                take(best);
            }
            return out;
        },
        observe(index, good) {
            if (index < 0 || index >= n) throw new Error("No such candidate");
            if (state[index] === 2) return;
            if (state[index] === 0) take(index);
            state[index] = 2;
            model.learn(features, index * p, good);
            learnedFrom += 1;
            stale = true;
        },
        skip(index) {
            if (index < 0 || index >= n) throw new Error("No such candidate");
            if (state[index] !== 1) return;
            state[index] = 2;
            const { direction, divisor } = model.restore(features, index * p);
            moveVariances(direction, divisor, 1);
            stale = true;
        },
        predicted() {
            refresh();
            // Before any verdict the prediction is the relevance itself; say so
            // exactly, without the rounding of a trip through the model.
            if (learnedFrom === 0)
                return Array.from({ length: n }, (_, j) => features[j * p + relevanceAt]!);
            return Array.from(predicted);
        },
    };
}

// ── From embeddings to features ─────────────────────────────────────────────

/** A fixed stream of normal draws, so the same companies always give the same directions. */
function normalDraws(seed: number): () => number {
    let state = seed >>> 0;
    const uniform = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return () =>
        Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12))) * Math.cos(2 * Math.PI * uniform());
}

/** Modified Gram–Schmidt on [k × d] rows, in place; a row with nothing left becomes zero. */
function orthonormalise(rows: Float64Array, k: number, d: number): void {
    for (let c = 0; c < k; c++) {
        const co = c * d;
        for (let prev = 0; prev < c; prev++) {
            const po = prev * d;
            let along = 0;
            for (let a = 0; a < d; a++) along += rows[co + a]! * rows[po + a]!;
            for (let a = 0; a < d; a++) rows[co + a]! -= along * rows[po + a]!;
        }
        let sq = 0;
        for (let a = 0; a < d; a++) sq += rows[co + a]! * rows[co + a]!;
        const scale = sq > 1e-18 ? 1 / Math.sqrt(sq) : 0;
        for (let a = 0; a < d; a++) rows[co + a]! *= scale;
    }
}

/**
 * Let the process serve something else between passes. Measured on made-up
 * vectors: 500 companies take half a second in all, 5,000 at 1,536 dimensions
 * under five seconds, and no single pass holds the process for more than half
 * a second.
 */
const breathe = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/**
 * Each row of `unit` [m × d] on the `k` main directions of the rows about
 * their mean, as [m × k]. Block power iteration on the rows themselves from a
 * fixed start: what the model needs is the span of the leading directions, and
 * a handful of passes finds it without ever building a d × d matrix.
 */
async function onMainDirections(
    unit: Float32Array,
    m: number,
    d: number,
    k: number,
    rounds: number
): Promise<Float64Array> {
    const projected = new Float64Array(m * k);
    if (k === 0 || m === 0) return projected;
    const mean = new Float64Array(d);
    for (let i = 0; i < m; i++) {
        const io = i * d;
        for (let a = 0; a < d; a++) mean[a]! += unit[io + a]!;
    }
    for (let a = 0; a < d; a++) mean[a]! /= m;

    const draw = normalDraws(0x5eed);
    let basis = new Float64Array(k * d);
    for (let i = 0; i < basis.length; i++) basis[i] = draw();
    orthonormalise(basis, k, d);

    const meanAlong = new Float64Array(k);
    /** projected = (rows − mean) · basisᵀ */
    const project = (): void => {
        for (let c = 0; c < k; c++) {
            const co = c * d;
            let sum = 0;
            for (let a = 0; a < d; a++) sum += mean[a]! * basis[co + a]!;
            meanAlong[c] = sum;
        }
        for (let i = 0; i < m; i++) {
            const io = i * d;
            for (let c = 0; c < k; c++) {
                const co = c * d;
                let sum = 0;
                for (let a = 0; a < d; a++) sum += unit[io + a]! * basis[co + a]!;
                projected[i * k + c] = sum - meanAlong[c]!;
            }
        }
    };

    for (let round = 0; round < rounds; round++) {
        project();
        await breathe();
        // basis ← projectedᵀ · (rows − mean); the mean's share is zero, since
        // every column of `projected` sums to zero.
        const next = new Float64Array(k * d);
        for (let i = 0; i < m; i++) {
            const io = i * d;
            for (let c = 0; c < k; c++) {
                const weight = projected[i * k + c]!;
                const co = c * d;
                for (let a = 0; a < d; a++) next[co + a]! += weight * unit[io + a]!;
            }
        }
        orthonormalise(next, k, d);
        basis = next;
        await breathe();
    }
    project();
    return projected;
}

/** What the model reads about every company: `rows` of `p` numbers, candidates first. */
export interface LearnerFeatures {
    features: Float64Array;
    p: number;
    candidates: number;
    earlierGood: boolean[];
}

/**
 * From embeddings to the model's features: each company on the main
 * directions of this run's companies, then its relevance, then 1. The slow
 * half of building a learner, and the half that does not depend on verdicts.
 */
export async function shortlistFeatures(args: {
    vectors: ReadonlyArray<readonly number[]>;
    relevance: readonly number[];
    earlier?: readonly EarlierVerdict[];
    settings?: Partial<LearnerSettings>;
}): Promise<LearnerFeatures> {
    const settings: LearnerSettings = { ...LEARNER_SETTINGS, ...args.settings };
    const n = args.vectors.length;
    if (args.relevance.length !== n)
        throw new Error("The learner needs one relevance per candidate");
    const d = args.vectors[0]?.length ?? 0;
    const numbers = (vector: readonly number[]): boolean => vector.every(Number.isFinite);
    // One number that is not a number would spread to every company's score:
    // better no learner than one that can rank nobody.
    for (let j = 0; j < n; j++)
        if (!Number.isFinite(args.relevance[j]) || !numbers(args.vectors[j]!))
            throw new Error("A candidate's embedding or relevance is not a number");
    // An earlier verdict that cannot be compared is left out: embedded by
    // another model (another size), or holding something that is not a number.
    const earlier = (args.earlier ?? []).filter(
        e => e.vector.length === d && Number.isFinite(e.relevance) && numbers(e.vector)
    );
    const m = n + earlier.length;

    const unit = new Float32Array(m * d);
    const fill = (row: number, vector: readonly number[]): void => {
        if (vector.length !== d) throw new Error("Embeddings of different sizes cannot be ranked");
        let sq = 0;
        for (let a = 0; a < d; a++) sq += vector[a]! * vector[a]!;
        const scale = sq > 0 ? 1 / Math.sqrt(sq) : 0;
        const o = row * d;
        for (let a = 0; a < d; a++) unit[o + a] = vector[a]! * scale;
    };
    for (let j = 0; j < n; j++) fill(j, args.vectors[j]!);
    for (const [e, verdict] of earlier.entries()) fill(n + e, verdict.vector);

    const k = Math.max(0, Math.min(settings.dims, m - 1, d));
    const projected = await onMainDirections(unit, m, d, k, settings.rounds);
    // Mean square length 1 over the candidates, so the prior spread means the
    // same thing whatever the embedding model's scale.
    let sumSq = 0;
    for (let i = 0; i < n * k; i++) sumSq += projected[i]! * projected[i]!;
    const scale = sumSq > 0 ? Math.sqrt(n / sumSq) : 1;

    const p = k + 2;
    const features = new Float64Array(m * p);
    for (let i = 0; i < m; i++) {
        const o = i * p;
        for (let c = 0; c < k; c++) features[o + c] = projected[i * k + c]! * scale;
        features[o + k] = i < n ? args.relevance[i]! : earlier[i - n]!.relevance;
        features[o + k + 1] = 1;
    }
    return { features, p, candidates: n, earlierGood: earlier.map(e => e.good) };
}

/**
 * A learner over this run's candidates. `vectors` are their embeddings as the
 * embedder returned them, `relevance` their relevance to the brief
 * (./semantic's semanticRelevance); `earlier` are verdicts known before the
 * run. Candidates keep their order: among equals, `next` prefers the earlier.
 */
export async function createShortlistLearner(args: {
    vectors: ReadonlyArray<readonly number[]>;
    relevance: readonly number[];
    earlier?: readonly EarlierVerdict[];
    settings?: Partial<LearnerSettings>;
}): Promise<ShortlistLearner> {
    return learnerOverFeatures({ ...(await shortlistFeatures(args)), settings: args.settings });
}
