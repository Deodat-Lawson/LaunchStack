/**
 * Seeded randomness. Every stochastic choice in an experiment draws from one
 * of these, so a (policy, segment, seed) triple always replays the same run.
 */
export interface Rng {
    /** Uniform in [0, 1). */
    next(): number;
    /** Uniform integer in [0, n). */
    int(n: number): number;
    /** Standard normal. */
    normal(): number;
    /** Gamma(shape, 1). */
    gamma(shape: number): number;
    /** Beta(a, b). */
    beta(a: number, b: number): number;
    /** A shuffled copy. */
    shuffle<T>(items: readonly T[]): T[];
    /** One item, uniformly. */
    pick<T>(items: readonly T[]): T;
}

/** mulberry32: small, fast, good enough for simulation. */
export function createRng(seed: number): Rng {
    let state = seed >>> 0 || 0x9e3779b9;
    const next = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const normal = (): number => {
        // Box–Muller; u is kept away from 0 so the log is finite.
        const u = Math.max(next(), 1e-12);
        const v = next();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const gamma = (shape: number): number => {
        if (shape < 1) {
            // Boost: Gamma(a) = Gamma(a + 1) · U^(1/a).
            return gamma(shape + 1) * Math.pow(Math.max(next(), 1e-12), 1 / shape);
        }
        // Marsaglia–Tsang.
        const d = shape - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);
        for (;;) {
            let x: number;
            let v: number;
            do {
                x = normal();
                v = 1 + c * x;
            } while (v <= 0);
            v = v * v * v;
            const u = next();
            if (u < 1 - 0.0331 * x * x * x * x) return d * v;
            if (Math.log(Math.max(u, 1e-12)) < 0.5 * x * x + d * (1 - v + Math.log(v)))
                return d * v;
        }
    };
    const rng: Rng = {
        next,
        int: n => Math.floor(next() * n),
        normal,
        gamma,
        beta: (a, b) => {
            const x = gamma(a);
            const y = gamma(b);
            return x + y === 0 ? 0.5 : x / (x + y);
        },
        shuffle: items => {
            const out = [...items];
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1));
                [out[i], out[j]] = [out[j]!, out[i]!];
            }
            return out;
        },
        pick: items => items[Math.floor(next() * items.length)]!,
    };
    return rng;
}

/** A stable 32-bit hash of a string, for deriving per-item seeds. */
export function hashSeed(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
