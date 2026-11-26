import { describe, expect, it } from "vitest";

import { createRng, hashSeed, type Rng } from "../lib/rng";
import { HYPER } from "./config";
import { calLogregEgreedy, type RunContext } from "./policies";

const DIMS = 8;

function unit(values: number[]): number[] {
    const length = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
    return values.map(v => v / length);
}

const dot = (a: readonly number[], b: readonly number[]): number =>
    a.reduce((sum, v, i) => sum + v * b[i]!, 0);

/**
 * A small pool of random companies and a brief. `sampler`, when given, is the
 * random stream the epsilon-greedy policy draws its exploration from.
 */
function tinyContext(n: number, seed: number, sampler?: Rng): RunContext {
    const rng = createRng(seed);
    const vector = (): number[] => unit(Array.from({ length: DIMS }, () => rng.normal()));
    const companies = Array.from({ length: n }, vector);
    const brief = vector();
    const mean = Array.from(
        { length: DIMS },
        (_, k) => companies.reduce((sum, c) => sum + c[k]!, 0) / n
    );
    const gram = new Float32Array(n * n);
    for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) gram[i * n + j] = dot(companies[i]!, companies[j]!);
    const cosBrief = Float64Array.from(companies, c => dot(c, brief));
    return {
        pool: {
            n,
            gram,
            meanDot: Float64Array.from(companies, c => dot(c, mean)),
            meanSq: dot(mean, mean),
            proj: new Float64Array(n),
            dims: 1,
        },
        segment: {
            labels: Uint8Array.from({ length: n }, () => (rng.next() < 0.4 ? 1 : 0)),
            today: cosBrief,
            lexical: new Float64Array(n),
            cosBrief,
            cosBaseline: new Float64Array(n),
            briefMeanDot: dot(brief, mean),
        },
        active: Int32Array.from({ length: n }, (_, i) => i),
        stream: name =>
            sampler && name === "cal-logreg-egreedy"
                ? sampler
                : createRng(hashSeed(`policies.test|${seed}|${name}`)),
    };
}

describe("cal-logreg-egreedy", () => {
    it("fills a batch when exploration draws keep landing on the last unchecked company", () => {
        // Every pick explores, and every draw asks for the last position there is.
        const lastPosition: Rng = { ...createRng(1), int: n => n - 1 };
        const policy = calLogregEgreedy({ ...HYPER.logreg, epsilon: 1 });
        const batch = policy.start(tinyContext(10, 3, lastPosition)).next(5);
        expect(batch).toHaveLength(5);
        expect(new Set(batch).size).toBe(5);
    });

    it("checks every company once, in full batches until the pool runs out", () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            const ctx = tinyContext(12, seed);
            const run = calLogregEgreedy({ ...HYPER.logreg, epsilon: 0.5 }).start(ctx);
            const sizes: number[] = [];
            const seen = new Set<number>();
            for (;;) {
                const batch = run.next(5);
                if (batch.length === 0) break;
                sizes.push(batch.length);
                for (const j of batch) {
                    expect(seen.has(j)).toBe(false);
                    seen.add(j);
                    run.observe(j, ctx.segment.labels[j] === 1);
                }
            }
            expect(sizes).toEqual([5, 5, 2]);
            expect(seen.size).toBe(12);
        }
    });
});
