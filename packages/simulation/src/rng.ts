/**
 * Seeded randomness. Every random choice in a round draws from a generator
 * seeded with (run seed, round, purpose), so re-running a round after a crash
 * makes the same choices.
 */

export type Rng = () => number;

/** mulberry32: small, fast, good enough for sampling. Returns [0, 1). */
export function createRng(seed: number): Rng {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** FNV-1a over the parts, for deriving per-round, per-purpose seeds. */
export function hashSeed(...parts: Array<string | number>): number {
    let h = 0x811c9dc5;
    for (const part of parts) {
        const s = String(part);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        h ^= 0x7c;
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = out[i]!;
        out[i] = out[j]!;
        out[j] = tmp;
    }
    return out;
}

export function pick<T>(items: readonly T[], rng: Rng): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(rng() * items.length)];
}
