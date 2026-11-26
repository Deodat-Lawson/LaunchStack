import { describe, expect, it } from "vitest";

import {
    createShortlistLearner,
    learnerOverFeatures,
    LEARNER_SETTINGS,
    type LearnerSettings,
} from "./learn";

/** A small fixed stream of numbers in [0, 1). */
function stream(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/**
 * Two kinds of company in a 12-dimensional embedding: the first `a` sit around
 * one direction, the rest around another. Relevance says nothing about which
 * kind a company is.
 */
function twoKinds(a: number, b: number, seed = 7) {
    const next = stream(seed);
    const d = 12;
    const vectors: number[][] = [];
    for (let i = 0; i < a + b; i++) {
        const v = Array.from({ length: d }, () => (next() - 0.5) * 0.4);
        v[i < a ? 0 : 1]! += 1;
        vectors.push(v);
    }
    const relevance = vectors.map(() => 0.2 + (next() - 0.5) * 0.02);
    return { vectors, relevance, d };
}

/** The posterior by the textbook formula, for comparison: mean and covariance. */
function closedForm(
    rows: number[][],
    labels: number[],
    settings: LearnerSettings,
    p = rows[0]!.length
): { mean: number[]; cov: number[][] } {
    const dims = p - 2;
    const priorVar = (c: number): number =>
        c < dims
            ? settings.priorSdProjection ** 2
            : c === dims
              ? settings.priorSdScore ** 2
              : settings.priorSdBias ** 2;
    const noiseSq = settings.noiseSd ** 2;
    // Precision = prior precision + Σ f fᵀ / noise².
    const precision = Array.from({ length: p }, (_, r) =>
        Array.from({ length: p }, (_, c) => (r === c ? 1 / priorVar(c) : 0))
    );
    const evidence = Array.from({ length: p }, (_, c) => (c === dims ? 1 / priorVar(c) : 0));
    for (const [i, f] of rows.entries()) {
        for (let r = 0; r < p; r++) {
            for (let c = 0; c < p; c++) precision[r]![c]! += (f[r]! * f[c]!) / noiseSq;
            evidence[r]! += (f[r]! * labels[i]!) / noiseSq;
        }
    }
    // Invert by Gauss–Jordan.
    const a = precision.map((row, r) => [...row, ...row.map((_, c) => (r === c ? 1 : 0))]);
    for (let col = 0; col < p; col++) {
        let pivot = col;
        for (let r = col + 1; r < p; r++)
            if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
        [a[col], a[pivot]] = [a[pivot]!, a[col]!];
        const scale = a[col]![col]!;
        for (let c = 0; c < 2 * p; c++) a[col]![c]! /= scale;
        for (let r = 0; r < p; r++) {
            if (r === col) continue;
            const factor = a[r]![col]!;
            for (let c = 0; c < 2 * p; c++) a[r]![c]! -= factor * a[col]![c]!;
        }
    }
    const cov = a.map(row => row.slice(p));
    const mean = cov.map(row => row.reduce((sum, v, c) => sum + v * evidence[c]!, 0));
    return { mean, cov };
}

describe("shortlist learner", () => {
    it("predicts the relevance itself before any verdict", async () => {
        const { vectors, relevance } = twoKinds(6, 6);
        const learner = await createShortlistLearner({ vectors, relevance });
        expect(learner.predicted()).toEqual(relevance);
        expect(learner.learnedFrom).toBe(0);
    });

    it("with no bonus and no verdicts, checks in the fixed ranking's order", async () => {
        const { vectors } = twoKinds(5, 5);
        const relevance = [0.1, 0.9, 0.3, 0.3, 0.8, -0.2, 0.5, 0.0, 0.7, 0.6];
        const learner = await createShortlistLearner({
            vectors,
            relevance,
            settings: { bonus: 0 },
        });
        // 0.3 twice: the earlier candidate (2) goes first.
        expect(learner.next(10)).toEqual([1, 4, 8, 9, 6, 2, 3, 0, 7, 5]);
        expect(learner.next(3)).toEqual([]);
    });

    it("moves the kind that was judged good up, and the kind judged bad down", async () => {
        const { vectors, relevance } = twoKinds(20, 20);
        const learner = await createShortlistLearner({ vectors, relevance });
        // Four verdicts: the first kind fits, the second does not.
        learner.observe(0, true);
        learner.observe(1, true);
        learner.observe(20, false);
        learner.observe(21, false);
        const picked = learner.next(10);
        expect(picked).toHaveLength(10);
        expect(picked.every(j => j < 20)).toBe(true);
        const predicted = learner.predicted();
        const mean = (from: number, to: number): number =>
            predicted.slice(from, to).reduce((s, v) => s + v, 0) / (to - from);
        expect(mean(2, 20)).toBeGreaterThan(mean(22, 40) + 0.2);
        expect(learner.learnedFrom).toBe(4);
    });

    it("never returns a candidate twice and keeps to the candidates it may choose among", async () => {
        const { vectors, relevance } = twoKinds(8, 8);
        const learner = await createShortlistLearner({ vectors, relevance });
        const even = learner.next(5, j => j % 2 === 0);
        expect(even.every(j => j % 2 === 0)).toBe(true);
        const rest = learner.next(100);
        expect(new Set([...even, ...rest]).size).toBe(16);
        expect(learner.next(1)).toEqual([]);
    });

    it("gives the same picks for the same companies", async () => {
        const { vectors, relevance } = twoKinds(15, 25, 11);
        const run = async (): Promise<number[]> => {
            const learner = await createShortlistLearner({ vectors, relevance });
            const order: number[] = [];
            for (let round = 0; round < 4; round++) {
                const batch = learner.next(5);
                for (const j of batch) learner.observe(j, j < 15);
                order.push(...batch);
            }
            return order;
        };
        expect(await run()).toEqual(await run());
    });

    it("starts a later run from earlier verdicts as if it had seen them itself", async () => {
        const { vectors, relevance } = twoKinds(12, 12, 3);
        // Run A learns four verdicts itself.
        const a = await createShortlistLearner({ vectors, relevance });
        for (const [j, good] of [
            [0, true],
            [1, true],
            [12, false],
            [13, false],
        ] as const)
            a.observe(j, good);
        // Run B is told the same four as earlier verdicts; the same companies are candidates again.
        const b = await createShortlistLearner({
            vectors,
            relevance,
            earlier: [0, 1, 12, 13].map(j => ({
                vector: vectors[j]!,
                relevance: relevance[j]!,
                good: j < 12,
            })),
        });
        expect(b.learnedFrom).toBe(4);
        // B's directions come from 28 rows (four of them twice), so the two are
        // close, not equal: the same kind leads in both.
        const top = (learner: typeof a): number[] => {
            const predicted = learner.predicted();
            return predicted
                .map((value, j) => ({ value, j }))
                .filter(({ j }) => ![0, 1, 12, 13].includes(j))
                .sort((x, y) => y.value - x.value)
                .slice(0, 10)
                .map(({ j }) => j);
        };
        expect(top(a).every(j => j < 12)).toBe(true);
        expect(top(b).every(j => j < 12)).toBe(true);
    });

    it("leaves out an earlier verdict whose embedding is another model's", async () => {
        const { vectors, relevance } = twoKinds(4, 4);
        const learner = await createShortlistLearner({
            vectors,
            relevance,
            earlier: [{ vector: [1, 0, 0], relevance: 0.5, good: true }],
        });
        expect(learner.learnedFrom).toBe(0);
        expect(learner.predicted()).toEqual(relevance);
    });

    it("leaves out an earlier verdict that holds something that is not a number", async () => {
        const { vectors, relevance } = twoKinds(6, 6);
        const d = vectors[0]!.length;
        const sound = { vector: vectors[7]!, relevance: 0.2, good: true };
        const learner = await createShortlistLearner({
            vectors,
            relevance,
            earlier: [
                {
                    vector: Array.from({ length: d }, (_, a) => (a === 2 ? NaN : 0.1)),
                    relevance: 0.3,
                    good: false,
                },
                { vector: Array.from({ length: d }, () => Infinity), relevance: 0.3, good: true },
                { vector: vectors[0]!, relevance: NaN, good: false },
                sound,
            ],
        });
        // Only the sound one counts, and every candidate can still be ranked.
        expect(learner.learnedFrom).toBe(1);
        expect(learner.predicted().every(Number.isFinite)).toBe(true);
        expect(learner.next(vectors.length)).toHaveLength(vectors.length);

        const alone = await createShortlistLearner({ vectors, relevance, earlier: [sound] });
        expect(learner.predicted()).toEqual(alone.predicted());
    });

    it("refuses a candidate whose embedding or relevance is not a number", async () => {
        const { vectors, relevance } = twoKinds(3, 3);
        const broken = vectors.map((v, j) => (j === 4 ? v.map((x, a) => (a === 0 ? NaN : x)) : v));
        await expect(createShortlistLearner({ vectors: broken, relevance })).rejects.toThrow(
            /not a number/
        );
        await expect(
            createShortlistLearner({
                vectors,
                relevance: relevance.map((r, j) => (j === 1 ? Number.NaN : r)),
            })
        ).rejects.toThrow(/not a number/);
    });

    it("works on one candidate and on none", async () => {
        const one = await createShortlistLearner({ vectors: [[1, 0, 0]], relevance: [0.4] });
        expect(one.next(3)).toEqual([0]);
        one.observe(0, true);
        expect(one.next(3)).toEqual([]);
        const none = await createShortlistLearner({ vectors: [], relevance: [] });
        expect(none.size).toBe(0);
        expect(none.next(3)).toEqual([]);
        expect(none.predicted()).toEqual([]);
    });

    it("refuses embeddings of different sizes", async () => {
        await expect(
            createShortlistLearner({
                vectors: [
                    [1, 0],
                    [1, 0, 0],
                ],
                relevance: [0.1, 0.2],
            })
        ).rejects.toThrow(/different sizes/);
    });
});

describe("the model behind the learner", () => {
    const settings: LearnerSettings = { ...LEARNER_SETTINGS };
    const p = 5; // three directions, relevance, intercept
    const next = stream(21);
    const rows = Array.from({ length: 30 }, () => [
        (next() - 0.5) * 2,
        (next() - 0.5) * 2,
        (next() - 0.5) * 2,
        next() * 0.6 - 0.1,
        1,
    ]);
    const features = Float64Array.from(rows.flat());
    const labelOf = (j: number): boolean => rows[j]![0]! + rows[j]![3]! > 0.3;

    /** f_jᵀ · cov · f_j */
    const varianceOf = (cov: number[][], j: number): number =>
        rows[j]!.reduce(
            (sum, fr, r) => sum + fr * cov[r]!.reduce((s, v, c) => s + v * rows[j]![c]!, 0),
            0
        );

    it("matches the textbook posterior after a run of verdicts", () => {
        const learner = learnerOverFeatures({ features, p, candidates: 30, settings });
        const seen: number[] = [];
        for (let round = 0; round < 4; round++) {
            const batch = learner.next(3);
            for (const j of batch) learner.observe(j, labelOf(j));
            seen.push(...batch);
        }
        const exact = closedForm(
            seen.map(j => rows[j]!),
            seen.map(j => (labelOf(j) ? 1 : 0)),
            settings
        );
        const predicted = learner.predicted();
        for (let j = 0; j < 30; j++) {
            const want = rows[j]!.reduce((sum, v, c) => sum + v * exact.mean[c]!, 0);
            expect(predicted[j]).toBeCloseTo(want, 9);
        }
    });

    it("picks by predicted fit plus the bonus on what is still uncertain", () => {
        const learner = learnerOverFeatures({ features, p, candidates: 30, settings });
        const seen = learner.next(4);
        for (const j of seen) learner.observe(j, labelOf(j));
        const exact = closedForm(
            seen.map(j => rows[j]!),
            seen.map(j => (labelOf(j) ? 1 : 0)),
            settings
        );
        let best = -1;
        let bestScore = -Infinity;
        for (let j = 0; j < 30; j++) {
            if (seen.includes(j)) continue;
            const mean = rows[j]!.reduce((sum, v, c) => sum + v * exact.mean[c]!, 0);
            const score = mean + settings.bonus * Math.sqrt(varianceOf(exact.cov, j));
            if (score > bestScore) {
                bestScore = score;
                best = j;
            }
        }
        expect(learner.next(1)).toEqual([best]);
    });

    it("inside a batch, each pick lowers the bonus of companies like it", () => {
        const optimistic = { ...settings, bonus: 5 };
        const together = learnerOverFeatures({
            features,
            p,
            candidates: 30,
            settings: optimistic,
        });
        const batch = together.next(3);
        // The same three, picked one at a time with the model told about each pick.
        const oneByOne: number[] = [];
        const taken: number[] = [];
        for (let i = 0; i < 3; i++) {
            const exact = closedForm(
                taken.map(j => rows[j]!),
                taken.map(() => 0),
                optimistic,
                p
            );
            // The mean is not refreshed inside a batch: it is still the prior's.
            let best = -1;
            let bestScore = -Infinity;
            for (let j = 0; j < 30; j++) {
                if (taken.includes(j)) continue;
                const score = rows[j]![3]! + optimistic.bonus * Math.sqrt(varianceOf(exact.cov, j));
                if (score > bestScore) {
                    bestScore = score;
                    best = j;
                }
            }
            oneByOne.push(best);
            taken.push(best);
        }
        expect(batch).toEqual(oneByOne);
    });

    it("a picked company that was never judged teaches nothing", () => {
        const withSkip = learnerOverFeatures({ features, p, candidates: 30, settings });
        const batch = withSkip.next(3);
        withSkip.observe(batch[0]!, true);
        withSkip.skip(batch[1]!);
        withSkip.observe(batch[2]!, false);
        // The same two verdicts, and the skipped company never picked.
        const exact = closedForm([rows[batch[0]!]!, rows[batch[2]!]!], [1, 0], settings);
        const predicted = withSkip.predicted();
        for (let j = 0; j < 30; j++) {
            const want = rows[j]!.reduce((sum, v, c) => sum + v * exact.mean[c]!, 0);
            expect(predicted[j]).toBeCloseTo(want, 9);
        }
        expect(withSkip.learnedFrom).toBe(2);
        // It is not offered again.
        expect(withSkip.next(30)).not.toContain(batch[1]);
    });

    it("counts earlier verdicts like verdicts of its own", () => {
        const earlierRows = [3, 9, 17, 22];
        const stacked = Float64Array.from([...rows, ...earlierRows.map(j => rows[j]!)].flat());
        const seeded = learnerOverFeatures({
            features: stacked,
            p,
            candidates: 30,
            earlierGood: earlierRows.map(labelOf),
            settings,
        });
        const exact = closedForm(
            earlierRows.map(j => rows[j]!),
            earlierRows.map(j => (labelOf(j) ? 1 : 0)),
            settings
        );
        const predicted = seeded.predicted();
        for (let j = 0; j < 30; j++) {
            const want = rows[j]!.reduce((sum, v, c) => sum + v * exact.mean[c]!, 0);
            expect(predicted[j]).toBeCloseTo(want, 9);
        }
        expect(seeded.learnedFrom).toBe(4);
    });
});
