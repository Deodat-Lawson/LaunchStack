/**
 * Tidying a page's connectors as a set.
 *
 * Each connector is routed on its own (routing.ts), so two elbows between the
 * same columns of boxes both take the channel halfway between them and run on
 * top of each other — and their labels, each at the middle of its own line,
 * print over each other ("e SQL e"). These two passes look at all the routes
 * at once:
 *
 * - `nudgeRoutes` moves the middle segments of elbow connectors that lie on
 *   the same line apart, the way libavoid's nudging does. Only segments
 *   between two bends move — never the stubs at a box — and never so far that
 *   a neighbouring segment would turn back on itself.
 * - `placeLabels` slides a label that would cover another one, or a box,
 *   along its own line to the nearest free spot. The document is not
 *   changed: this is where the label is drawn, not where it is stored.
 *
 * Pure, and cheap enough to run every frame: segments are bucketed by
 * coordinate before they are compared.
 */

import { segmentCrossesRect } from "./avoid";
import { nodeBounds } from "./geometry";
import { labelAnchor, renderPath, type RoutedEdge } from "./routing";
import { isContainer } from "./shapes";
import { layoutText } from "./text";
import type { DiagramEdge, DiagramNode, Point, Rect } from "./types";

/**
 * Space kept between connectors running alongside each other — wide enough
 * that a label on one does not sit on the other.
 */
export const NUDGE_GAP = 16;

interface Segment {
    edgeId: string;
    /** Index of the segment's first point. */
    i: number;
    /** The coordinate the segment lies on (x for vertical, y for horizontal). */
    at: number;
    lo: number;
    hi: number;
    /** How far `at` may move each way before a neighbouring segment reverses. */
    min: number;
    max: number;
    /**
     * Where this segment sits across the channel relative to its neighbours
     * so corners nest instead of crossing (see `nestKey`).
     */
    nest: number;
    /** Which side the segment is entered from: -1 from the low side, 1 from the high side. */
    from: number;
}

function segmentsOf(id: string, points: readonly Point[], vertical: boolean): Segment[] {
    const out: Segment[] = [];
    const along = vertical ? "y" : "x";
    const across = vertical ? "x" : "y";
    // Interior segments only: both ends are bends, so the stubs at the boxes
    // (first and last segment) stay where the ports put them.
    for (let i = 1; i + 2 < points.length; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        if (Math.abs(a[across] - b[across]) > 0.5 || Math.abs(a[along] - b[along]) < 1) continue;
        const before = points[i - 1]![across];
        const after = points[i + 2]![across];
        const at = a[across];
        // The neighbours run from `before` to `at` and from `at` to `after`;
        // `at` may move toward either but not past it.
        let min = -Infinity;
        let max = Infinity;
        for (const n of [before, after]) {
            if (n < at - 0.5) min = Math.max(min, n + 2);
            else if (n > at + 0.5) max = Math.min(max, n - 2);
            else {
                min = at;
                max = at;
            }
        }
        // Two lines entering a shared channel from the same side and turning
        // the same way cross unless their corners nest: entering from the
        // low side and turning toward high, the one that enters further
        // along takes the inside of the bend (the low position).
        const fromLow = before < at;
        const towardHigh = b[along] > a[along];
        out.push({
            edgeId: id,
            i,
            at,
            lo: Math.min(a[along], b[along]),
            hi: Math.max(a[along], b[along]),
            min,
            max,
            nest: (fromLow === towardHigh ? -1 : 1) * a[along],
            from: fromLow ? -1 : 1,
        });
    }
    return out;
}

/**
 * Routes with overlapping middle segments pulled `gap` apart. Connectors that
 * were not moved keep their `RoutedEdge` object, so memoised views still hit.
 */
export function nudgeRoutes(
    routes: ReadonlyMap<string, RoutedEdge>,
    edges: readonly DiagramEdge[],
    gap = NUDGE_GAP
): Map<string, RoutedEdge> {
    const out = new Map(routes);
    const elbows = edges.filter(
        e => e.kind === "elbow" && (routes.get(e.id)?.points.length ?? 0) >= 4
    );
    if (elbows.length < 2) return out;

    const moved = new Map<string, Point[]>();
    for (const vertical of [true, false]) {
        const across = vertical ? "x" : "y";
        const segs: Segment[] = [];
        for (const e of elbows) segs.push(...segmentsOf(e.id, routes.get(e.id)!.points, vertical));
        if (segs.length < 2) continue;
        segs.sort((p, q) => p.at - q.at);
        // Group segments of different connectors that run alongside each other
        // closer than `gap` with overlapping spans (union–find over a sliding
        // window, since `segs` is sorted by position).
        const parent = segs.map((_, i) => i);
        const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
        for (let i = 0; i < segs.length; i++) {
            for (let j = i + 1; j < segs.length && segs[j]!.at - segs[i]!.at < gap; j++) {
                const p = segs[i]!;
                const q = segs[j]!;
                if (p.edgeId === q.edgeId) continue;
                if (p.lo < q.hi - 1 && q.lo < p.hi - 1) parent[find(i)] = find(j);
            }
        }
        const groups = new Map<number, Segment[]>();
        segs.forEach((seg, i) => {
            const root = find(i);
            const list = groups.get(root) ?? [];
            list.push(seg);
            groups.set(root, list);
        });
        for (const cluster of groups.values()) {
            if (new Set(cluster.map(c => c.edgeId)).size < 2) continue;
            // Lines entering from the low side go low, nested so their corners
            // do not cross; ties keep their order across the channel.
            cluster.sort(
                (p, q) =>
                    p.from - q.from ||
                    p.nest - q.nest ||
                    p.at - q.at ||
                    (p.edgeId < q.edgeId ? -1 : 1)
            );
            const mid = cluster.reduce((sum, c) => sum + c.at, 0) / cluster.length;
            const n = cluster.length;
            cluster.forEach((seg, j) => {
                const want = mid + (j - (n - 1) / 2) * gap;
                const to = Math.min(Math.max(want, seg.min), seg.max);
                if (Math.abs(to - seg.at) < 0.01) return;
                const pts =
                    moved.get(seg.edgeId) ?? routes.get(seg.edgeId)!.points.map(p => ({ ...p }));
                pts[seg.i] = { ...pts[seg.i]!, [across]: to };
                pts[seg.i + 1] = { ...pts[seg.i + 1]!, [across]: to };
                moved.set(seg.edgeId, pts);
            });
        }
    }

    for (const [id, points] of moved) {
        const edge = elbows.find(e => e.id === id)!;
        const before = routes.get(id)!;
        out.set(id, { ...before, points, path: renderPath(edge.kind, points) });
    }
    return out;
}

function labelBox(edge: DiagramEdge, index: number, at: Point): Rect {
    const laid = layoutText(edge.labels[index]!.text, edge.textStyle, 240);
    const w = laid.width + 12;
    const h = laid.height + 6;
    return { x: at.x - w / 2, y: at.y - h / 2, w, h };
}

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Does any segment of `points` pass through `r`? */
function crossesBox(points: readonly Point[], r: Rect): boolean {
    for (let i = 0; i < points.length - 1; i++) {
        if (segmentCrossesRect(points[i]!, points[i + 1]!, r)) return true;
    }
    return false;
}

/** Room kept between a label and a bend on its own line (the bend's handle is 8px across). */
const BEND_CLEAR = 6;

/** Where along its line a label may slide to, nearest first. */
const STEPS = [0, 0.06, -0.06, 0.12, -0.12, 0.18, -0.18, 0.24, -0.24, 0.3, -0.3, 0.36, -0.36];

/**
 * Where along its line (t) each label is drawn, keyed `edgeId` → one t per
 * label: off other labels, off the bends someone put in its own line, off
 * the boxes (`nodes`, when given) and off other connectors' lines when there
 * is a free spot nearby, else where it was put. A label on a bend sits on the
 * corner, and while the line is selected the bend's handle covers it and
 * takes the press meant for the label; one on a box hides the box's words —
 * a Yes or No at the middle of a short branch sat on the step it led to once
 * the line re-routed round the boxes.
 */
export function placeLabels(
    edges: readonly DiagramEdge[],
    routes: ReadonlyMap<string, RoutedEdge>,
    nodes: readonly DiagramNode[] = []
): Map<string, number[]> {
    const out = new Map<string, number[]>();
    const placed: Rect[] = [];
    const boxes = nodes
        .filter(nd => !nd.hidden && !isContainer(nd.shape) && nd.shape !== "ink")
        .map(nodeBounds);
    const offBoxes = (box: Rect) => !boxes.some(r => overlaps(r, box));
    const offBends = (edge: DiagramEdge, box: Rect) =>
        !edge.waypoints.some(
            p =>
                p.x > box.x - BEND_CLEAR &&
                p.x < box.x + box.w + BEND_CLEAR &&
                p.y > box.y - BEND_CLEAR &&
                p.y < box.y + box.h + BEND_CLEAR
        );
    const offLabels = (edge: DiagramEdge, box: Rect) =>
        offBends(edge, box) && !placed.some(r => overlaps(r, box));
    const clear = (edge: DiagramEdge, box: Rect) =>
        offLabels(edge, box) &&
        offBoxes(box) &&
        !edges.some(
            other =>
                other.id !== edge.id &&
                routes.has(other.id) &&
                crossesBox(routes.get(other.id)!.points, box)
        );
    for (const edge of edges) {
        const routed = routes.get(edge.id);
        if (!routed || edge.labels.length === 0) continue;
        const ts: number[] = [];
        edge.labels.forEach((label, i) => {
            if (!label.text) {
                ts.push(label.t);
                return;
            }
            let chosen = label.t;
            let box = labelBox(edge, i, labelAnchor(routed, label.t, label.offset));
            const candidates = STEPS.map(step => label.t + step)
                .filter(t => t >= 0.08 && t <= 0.92)
                .map(t => ({ t, box: labelBox(edge, i, labelAnchor(routed, t, label.offset)) }));
            // Best: clear of other labels, its own bends, the boxes and other
            // lines. Else clear of all but the lines, else at least of labels
            // and bends — a label printed over another is unreadable, one on a
            // box hides it, one crossing a line is only untidy.
            const pick =
                candidates.find(c => clear(edge, c.box)) ??
                candidates.find(c => offLabels(edge, c.box) && offBoxes(c.box)) ??
                candidates.find(c => offLabels(edge, c.box));
            if (pick) {
                chosen = pick.t;
                box = pick.box;
            }
            placed.push(box);
            ts.push(chosen);
        });
        out.set(edge.id, ts);
    }
    return out;
}
