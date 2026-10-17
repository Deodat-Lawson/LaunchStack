/**
 * Checking predictions against what happened. A run predicts an engagement
 * rate among simulated readers; the real post reports its own engagement.
 * The two are on different scales, so we compare order, not size: do the
 * posts the simulation liked best also do best for real?
 */

/** Average ranks (1-based), ties share the mean of their positions. */
export function ranks(values: number[]): number[] {
    const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const out = new Array<number>(values.length);
    for (let start = 0; start < order.length; ) {
        let end = start;
        while (end + 1 < order.length && order[end + 1]!.v === order[start]!.v) end++;
        const rank = (start + end) / 2 + 1;
        for (let k = start; k <= end; k++) out[order[k]!.i] = rank;
        start = end + 1;
    }
    return out;
}

/** Spearman's rank correlation; undefined when there are fewer than 3 pairs or no variation. */
export function spearman(xs: number[], ys: number[]): number | undefined {
    if (xs.length !== ys.length || xs.length < 3) return undefined;
    const rx = ranks(xs);
    const ry = ranks(ys);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(rx);
    const my = mean(ry);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < rx.length; i++) {
        const a = rx[i]! - mx;
        const b = ry[i]! - my;
        num += a * b;
        dx += a * a;
        dy += b * b;
    }
    if (dx === 0 || dy === 0) return undefined;
    return Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000;
}

function median(values: number[]): number {
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/**
 * For each pair: did the simulation put the post on the same side of the
 * median as reality did? Pairs exactly on a median count as misses.
 */
export function directionHits(
    predicted: number[],
    actual: number[]
): { hits: number; total: number } {
    if (predicted.length !== actual.length || predicted.length === 0) return { hits: 0, total: 0 };
    const mp = median(predicted);
    const ma = median(actual);
    let hits = 0;
    for (let i = 0; i < predicted.length; i++) {
        const p = predicted[i]! - mp;
        const a = actual[i]! - ma;
        if (p !== 0 && a !== 0 && Math.sign(p) === Math.sign(a)) hits++;
    }
    return { hits, total: predicted.length };
}
