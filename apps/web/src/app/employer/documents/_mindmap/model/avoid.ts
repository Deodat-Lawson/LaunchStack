/**
 * Connectors that go around boxes instead of through them.
 *
 * A connector's default route (routing.ts) only knows its own two ends, so a
 * line between two steps drew straight under or over whatever sat between
 * them. When that happens, this finds an orthogonal route around the boxes
 * in the way: an A* search over a sparse grid made of the boxes' (padded)
 * edges, the channels between them and the connector's possible stubs — the
 * orthogonal-visibility approach of libavoid and draw.io, small enough to run
 * per connector per frame.
 *
 * Costs are length plus a fixed price per bend, so among routes of similar
 * length the one with fewer turns wins, and a side other than the one facing
 * the other end costs a little extra, so a detour only changes sides when it
 * has to. Several start and end sides are searched at once (multi-source,
 * multi-target), which is what lets a loop back to an earlier step leave over
 * the top instead of cutting back through the row.
 *
 * Pure geometry: no nodes, no document. routing.ts decides when to call it
 * and turns the orthogonal route into the connector's own style.
 */

import type { Point, Rect } from "./types";

/** Clearance kept between a detour and the boxes it passes. */
export const AVOID_MARGIN = 14;
/** What one extra turn is worth, in px of length. */
const BEND_COST = 36;

export interface PortOption {
    /** On the box's outline. */
    point: Point;
    /** Unit vector out of the box; axis-aligned. */
    normal: Point;
    /** Extra cost for leaving (or arriving) through this side. */
    penalty: number;
}

/** Directions are indices: 0 +x, 1 −x, 2 +y, 3 −y. */
const OPPOSITE = [1, 0, 3, 2] as const;

function dirOf(v: Point): number {
    if (Math.abs(v.x) >= Math.abs(v.y)) return v.x >= 0 ? 0 : 1;
    return v.y >= 0 ? 2 : 3;
}

function strictlyInside(p: Point, r: Rect): boolean {
    const e = 0.01;
    return p.x > r.x + e && p.x < r.x + r.w - e && p.y > r.y + e && p.y < r.y + r.h - e;
}

/** Sorted, de-duplicated, with the midpoint of every gap added (channel centres). */
function axis(values: number[], lo: number, hi: number): number[] {
    const sorted = [
        ...new Set(values.filter(v => v >= lo && v <= hi).map(v => Math.round(v * 100) / 100)),
    ].sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
        out.push(sorted[i]!);
        const next = sorted[i + 1];
        if (next !== undefined && next - sorted[i]! > 1) out.push((sorted[i]! + next) / 2);
    }
    return out;
}

class MinHeap {
    private keys: number[] = [];
    private vals: number[] = [];
    get size(): number {
        return this.keys.length;
    }
    push(key: number, val: number): void {
        this.keys.push(key);
        this.vals.push(val);
        let i = this.keys.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.keys[p]! <= this.keys[i]!) break;
            this.swap(i, p);
            i = p;
        }
    }
    pop(): number {
        const top = this.vals[0]!;
        const lastK = this.keys.pop()!;
        const lastV = this.vals.pop()!;
        if (this.keys.length > 0) {
            this.keys[0] = lastK;
            this.vals[0] = lastV;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1;
                const r = l + 1;
                let m = i;
                if (l < this.keys.length && this.keys[l]! < this.keys[m]!) m = l;
                if (r < this.keys.length && this.keys[r]! < this.keys[m]!) m = r;
                if (m === i) break;
                this.swap(i, m);
                i = m;
            }
        }
        return top;
    }
    private swap(a: number, b: number): void {
        [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
        [this.vals[a], this.vals[b]] = [this.vals[b]!, this.vals[a]!];
    }
}

/**
 * The cheapest orthogonal route from any of `starts` to any of `ends` that
 * stays out of every rectangle in `blocked` (already padded) and inside
 * `bounds`, as a polyline from the chosen start port to the chosen end port.
 * Null when there is none inside `bounds`.
 */
export function orthogonalDetour(opts: {
    starts: readonly PortOption[];
    ends: readonly PortOption[];
    blocked: readonly Rect[];
    bounds: Rect;
    stub: number;
}): Point[] | null {
    const { blocked, bounds, stub } = opts;
    const stubOf = (o: PortOption) => ({
        x: o.point.x + o.normal.x * stub,
        y: o.point.y + o.normal.y * stub,
    });
    const free = (p: Point) => !blocked.some(r => strictlyInside(p, r));
    const starts = opts.starts.filter(o => free(stubOf(o)));
    const ends = opts.ends.filter(o => free(stubOf(o)));
    if (starts.length === 0 || ends.length === 0) return null;

    const lo = { x: bounds.x, y: bounds.y };
    const hi = { x: bounds.x + bounds.w, y: bounds.y + bounds.h };
    const xs = axis(
        [
            lo.x,
            hi.x,
            ...blocked.flatMap(r => [r.x, r.x + r.w]),
            ...[...starts, ...ends].map(o => stubOf(o).x),
        ],
        lo.x,
        hi.x
    );
    const ys = axis(
        [
            lo.y,
            hi.y,
            ...blocked.flatMap(r => [r.y, r.y + r.h]),
            ...[...starts, ...ends].map(o => stubOf(o).y),
        ],
        lo.y,
        hi.y
    );
    const nx = xs.length;
    const ny = ys.length;
    const xIndex = new Map(xs.map((v, i) => [v, i]));
    const yIndex = new Map(ys.map((v, i) => [v, i]));
    const at = (i: number): Point => ({ x: xs[i % nx]!, y: ys[Math.floor(i / nx)]! });
    const indexOf = (p: Point): number | undefined => {
        const ix = xIndex.get(Math.round(p.x * 100) / 100);
        const iy = yIndex.get(Math.round(p.y * 100) / 100);
        return ix === undefined || iy === undefined ? undefined : iy * nx + ix;
    };

    const blockedPoint = new Uint8Array(nx * ny);
    for (let i = 0; i < nx * ny; i++) blockedPoint[i] = free(at(i)) ? 0 : 1;

    /** Neighbour of `i` one grid step in `dir`, or -1 when off the grid or walled. */
    const step = (i: number, dir: number): number => {
        const ix = i % nx;
        const iy = Math.floor(i / nx);
        const jx = ix + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
        const jy = iy + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
        if (jx < 0 || jx >= nx || jy < 0 || jy >= ny) return -1;
        const j = jy * nx + jx;
        if (blockedPoint[j]) return -1;
        const a = at(i);
        const b = at(j);
        if (!free({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) return -1;
        return j;
    };

    const targets = new Map<number, { need: number; penalty: number; option: PortOption }[]>();
    for (const o of ends) {
        const idx = indexOf(stubOf(o));
        if (idx === undefined) continue;
        const list = targets.get(idx) ?? [];
        // Arriving means travelling into the box: against its normal.
        list.push({ need: OPPOSITE[dirOf(o.normal)]!, penalty: o.penalty, option: o });
        targets.set(idx, list);
    }
    if (targets.size === 0) return null;
    const targetPoints = [...targets.keys()].map(at);
    const h = (i: number) => {
        const p = at(i);
        let best = Infinity;
        for (const t of targetPoints)
            best = Math.min(best, Math.abs(p.x - t.x) + Math.abs(p.y - t.y));
        return best;
    };

    const states = nx * ny * 4;
    const GOAL = states;
    const g = new Float64Array(states + 1).fill(Infinity);
    const parent = new Int32Array(states + 1).fill(-1);
    const startOf = new Map<number, PortOption>();
    let goalEnd: PortOption | null = null;
    const heap = new MinHeap();

    for (const o of starts) {
        const idx = indexOf(stubOf(o));
        if (idx === undefined) continue;
        const s = idx * 4 + dirOf(o.normal);
        if (o.penalty < g[s]!) {
            g[s] = o.penalty;
            startOf.set(s, o);
            heap.push(o.penalty + h(idx), s);
        }
    }

    const closed = new Uint8Array(states + 1);
    while (heap.size > 0) {
        const s = heap.pop();
        if (closed[s]) continue;
        closed[s] = 1;
        if (s === GOAL) break;
        const point = Math.floor(s / 4);
        const dir = s % 4;
        const cost = g[s]!;

        const arrivals = targets.get(point);
        if (arrivals) {
            for (const t of arrivals) {
                const total = cost + (dir === t.need ? 0 : BEND_COST) + t.penalty;
                if (total < g[GOAL]!) {
                    g[GOAL] = total;
                    parent[GOAL] = s;
                    goalEnd = t.option;
                    heap.push(total, GOAL);
                }
            }
        }

        for (let d = 0; d < 4; d++) {
            if (d === OPPOSITE[dir]) continue;
            const j = step(point, d);
            if (j < 0) continue;
            const a = at(point);
            const b = at(j);
            const next = j * 4 + d;
            const c =
                cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (d === dir ? 0 : BEND_COST);
            if (c < g[next]!) {
                g[next] = c;
                parent[next] = s;
                heap.push(c + h(j), next);
            }
        }
    }

    if (!goalEnd || parent[GOAL]! < 0) return null;
    const chain: Point[] = [];
    let s = parent[GOAL]!;
    let first = s;
    while (s >= 0) {
        chain.push(at(Math.floor(s / 4)));
        first = s;
        s = parent[s]!;
    }
    chain.reverse();
    const start = startOf.get(first);
    if (!start) return null;
    return [start.point, ...chain, goalEnd.point];
}

/** Does the segment a→b pass through the inside of `r`? */
export function segmentCrossesRect(a: Point, b: Point, r: Rect): boolean {
    if (strictlyInside(a, r) || strictlyInside(b, r)) return true;
    // Liang–Barsky clip against the open rectangle.
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edges: [number, number][] = [
        [-dx, a.x - r.x],
        [dx, r.x + r.w - a.x],
        [-dy, a.y - r.y],
        [dy, r.y + r.h - a.y],
    ];
    for (const [p, q] of edges) {
        if (Math.abs(p) < 1e-9) {
            if (q <= 0) return false;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > t1) return false;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return false;
            if (t < t1) t1 = t;
        }
    }
    return t1 - t0 > 1e-6;
}

export function polylineCrosses(points: readonly Point[], rects: readonly Rect[]): boolean {
    for (let i = 0; i < points.length - 1; i++) {
        for (const r of rects) if (segmentCrossesRect(points[i]!, points[i + 1]!, r)) return true;
    }
    return false;
}

/**
 * Straighten an orthogonal route for a straight or curved connector: from
 * each point, jump to the farthest later point still in clear sight. The
 * line keeps clear of the boxes but loses the right angles it does not need.
 */
export function pullTight(points: readonly Point[], rects: readonly Rect[]): Point[] {
    if (points.length <= 2) return points.map(p => ({ ...p }));
    const out: Point[] = [{ ...points[0]! }];
    let i = 0;
    while (i < points.length - 1) {
        let j = points.length - 1;
        while (j > i + 1 && rects.some(r => segmentCrossesRect(points[i]!, points[j]!, r))) j--;
        out.push({ ...points[j]! });
        i = j;
    }
    return out;
}
