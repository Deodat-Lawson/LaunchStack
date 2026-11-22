/**
 * D · Write it, see it — the steps drawn as a chart.
 *
 * `applySteps` turns parsed lines (`syntax.ts`) into the page: a box per step,
 * an arrow per link, laid out top to bottom by the layered layout. Boxes are
 * matched to the boxes already there, so editing a line's words, or moving a
 * line, keeps its box (and the selection on it): first by id when the caller
 * knows which line is which box, then by words in order, then by position in
 * what is left. Only what the steps own is touched — a sticky note, a frame or
 * a dangling arrow someone drew stays as it was.
 *
 * Pure: no store, no React. The look comes in as an argument, so this file
 * never imports `../looks` (which imports this direction's look).
 */

import { createEdge, createNode } from "../factory";
import { GROW_MAX_TEXT_WIDTH } from "../grow";
import { layeredLayout } from "../layered";
import { neutralsFor, type ThemeMode } from "../palette";
import { isContainer, shapeDef, shapeHoldsText, shapeTextBox } from "../shapes";
import { layoutText } from "../text";
import type { DiagramEdge, DiagramNode, DiagramPage, Point, ShapeId, TextStyle } from "../types";
import { keepPlaced } from "./arrange";
import type { FlowLook } from "./lookTypes";
import { normalizeLabel, oneLine, type StepKind, type StepsParse } from "./syntax";

/** Space between ranks (down the page) and between neighbours in a rank. */
export const RANK_GAP = 56;
export const NODE_GAP = 48;

/** Shapes that are marks on the board, not steps in the process. */
const NOT_STEPS: ReadonlySet<string> = new Set(["text", "sticky", "image", "ink", "line"]);

/** Whether a box is one of the process's steps (and so has a line in the text). */
export function isStepNode(nd: DiagramNode): boolean {
    if (nd.hidden || NOT_STEPS.has(nd.shape)) return false;
    if (isContainer(nd.shape) || !shapeHoldsText(nd.shape)) return false;
    return true;
}

/**
 * A step box's words as one line of step text. A diamond always reads as a
 * question: a decision someone picked and labelled "Approve" is written
 * "Approve?", so it reads back as a decision.
 */
export function stepWords(nd: DiagramNode): string {
    const words = oneLine(nd.text);
    if (nd.shape === "decision" && words && !/[?？]$/.test(words)) return `${words}?`;
    return words;
}

/** The shape a step of this kind is drawn as, keeping a plain step's own shape. */
export function shapeForKind(
    kind: StepKind,
    existing: ShapeId | undefined,
    plain: ShapeId
): ShapeId {
    if (kind === "decision") return "decision";
    if (kind === "start" || kind === "end") return "terminator";
    if (existing && existing !== "decision" && existing !== "terminator") return existing;
    return plain;
}

/** Widest a label runs before it wraps: a diamond's text area is narrow, so it wraps sooner. */
function wrapWidth(shape: ShapeId): number {
    if (shape === "decision") return 140;
    if (shape === "terminator") return 160;
    return GROW_MAX_TEXT_WIDTH;
}

/** Smallest `v ≥ lo` with `fits(v)`, for a `fits` that only turns true as `v` grows. */
function smallest(lo: number, fits: (v: number) => boolean): number {
    if (fits(lo)) return lo;
    let hi = lo * 2;
    for (let i = 0; i < 12 && !fits(hi); i++) hi *= 2;
    let low = lo;
    for (let i = 0; i < 24 && hi - low > 0.5; i++) {
        const mid = (low + hi) / 2;
        if (fits(mid)) hi = mid;
        else low = mid;
    }
    return Math.ceil(hi / 2) * 2;
}

/**
 * The size a step's box needs for its words: never below the look's size for
 * its shape, wider until the label reaches its wrap width, then taller.
 */
export function stepSize(
    shape: ShapeId,
    label: string,
    textStyle: TextStyle,
    base: { w: number; h: number }
): { w: number; h: number } {
    const words = label.trim() || " ";
    const box0 = shapeTextBox(shape, base.w, base.h);
    const cap = Math.max(box0.w, wrapWidth(shape));
    const free = layoutText(words, textStyle, cap);
    const needW = Math.max(box0.w, Math.min(cap, Math.ceil(free.width) + 4));
    const laid = layoutText(words, textStyle, needW);
    const needH = Math.max(box0.h, Math.ceil(laid.height) + 4);
    let w = base.w;
    let h = base.h;
    for (let pass = 0; pass < 2; pass++) {
        const hNow = h;
        w = smallest(base.w, v => shapeTextBox(shape, v, hNow).w >= needW);
        const wNow = w;
        h = smallest(base.h, v => shapeTextBox(shape, wNow, v).h >= needH);
    }
    return { w: Math.max(base.w, w), h: Math.max(base.h, h) };
}

/** The look's size for a shape, else the shape's own. */
export function baseSize(
    look: FlowLook,
    shape: ShapeId,
    mode: ThemeMode
): { w: number; h: number } {
    return look.boxLook(shape, mode).size ?? shapeDef(shape).defaultSize;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Where the chart is pinned while it re-lays: its top, and its first step's centre line. */
export interface Anchor {
    top: number;
    cx: number;
}

/**
 * Where the old steps sat, so the chart grows downward from the same place
 * instead of jumping about: the top of what was there, and the centre line of
 * `firstId` (the new first step's box, if it was there) or else of the whole.
 */
export function anchorOf(old: readonly DiagramNode[], firstId?: string): Anchor | null {
    if (old.length === 0) return null;
    let top = Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (const nd of old) {
        top = Math.min(top, nd.y);
        left = Math.min(left, nd.x);
        right = Math.max(right, nd.x + nd.w);
    }
    const first = firstId ? old.find(nd => nd.id === firstId) : undefined;
    return { top, cx: first ? first.x + first.w / 2 : (left + right) / 2 };
}

/**
 * Lay steps out top to bottom, in their order, pinned at `anchor` (or with the
 * first step's top-centre at `origin` on an empty board).
 */
export function layoutSteps(
    nodes: readonly DiagramNode[],
    links: ReadonlyArray<{ from: string; to: string }>,
    anchor: Anchor | null,
    origin: Point = { x: 0, y: 0 }
): DiagramNode[] {
    if (nodes.length === 0) return [];
    const laid = layeredLayout(
        nodes.map(nd => ({ id: nd.id, w: nd.w, h: nd.h })),
        links,
        { direction: "down", rankGap: RANK_GAP, nodeGap: NODE_GAP }
    );
    const first = nodes[0]!;
    const p0 = laid.positions.get(first.id) ?? { x: 0, y: 0 };
    let top = Infinity;
    for (const nd of nodes) top = Math.min(top, laid.positions.get(nd.id)?.y ?? 0);
    const want = anchor ?? { top: origin.y, cx: origin.x };
    const dx = want.cx - (p0.x + first.w / 2);
    const dy = want.top - top;
    return nodes.map(nd => {
        const p = laid.positions.get(nd.id) ?? { x: 0, y: 0 };
        return { ...nd, x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
    });
}

// ---------------------------------------------------------------------------
// Matching lines to boxes
// ---------------------------------------------------------------------------

/**
 * Pair new steps with old boxes. `known[i]` is a box id the caller already
 * knows step `i` is; the rest are matched by words in order (a longest common
 * subsequence), and what is still unmatched between two matches is paired by
 * position, so retyping a line keeps its box.
 */
export function matchSteps(
    labels: readonly string[],
    old: readonly DiagramNode[],
    known: ReadonlyArray<string | null> = []
): Array<string | null> {
    const out: Array<string | null> = labels.map(() => null);
    const taken = new Set<string>();
    const present = new Set(old.map(nd => nd.id));
    labels.forEach((_, i) => {
        const id = known[i];
        if (id && present.has(id) && !taken.has(id)) {
            out[i] = id;
            taken.add(id);
        }
    });

    const newIdx = labels.map((_, i) => i).filter(i => out[i] === null);
    const oldLeft = old.filter(nd => !taken.has(nd.id));
    const a = newIdx.map(i => normalizeLabel(labels[i]!));
    const b = oldLeft.map(nd => normalizeLabel(oneLine(nd.text)));

    // LCS table, (n+1)×(m+1).
    const n = a.length;
    const m = b.length;
    const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i]![j] =
                a[i] !== "" && a[i] === b[j]
                    ? table[i + 1]![j + 1]! + 1
                    : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
        }
    }
    const pairs: Array<[number, number]> = [];
    for (let i = 0, j = 0; i < n && j < m; ) {
        if (a[i] !== "" && a[i] === b[j]) {
            pairs.push([i, j]);
            i += 1;
            j += 1;
        } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
        else j += 1;
    }

    const usedOld = new Set<number>();
    const usedNew = new Set<number>();
    for (const [i, j] of pairs) {
        out[newIdx[i]!] = oldLeft[j]!.id;
        usedNew.add(i);
        usedOld.add(j);
    }
    // A line that moved: the same words, out of order.
    for (let i = 0; i < n; i++) {
        if (usedNew.has(i) || a[i] === "") continue;
        const j = b.findIndex((key, k) => !usedOld.has(k) && key === a[i]);
        if (j < 0) continue;
        out[newIdx[i]!] = oldLeft[j]!.id;
        usedNew.add(i);
        usedOld.add(j);
    }
    // Between matches, pair what is left by position: a line retyped.
    const bounds: Array<[number, number]> = [[-1, -1], ...pairs, [n, m]];
    for (let k = 0; k + 1 < bounds.length; k++) {
        const [i0, j0] = bounds[k]!;
        const [i1, j1] = bounds[k + 1]!;
        const freeNew = range(i0 + 1, i1).filter(i => !usedNew.has(i));
        const freeOld = range(j0 + 1, j1).filter(j => !usedOld.has(j));
        for (let k2 = 0; k2 < Math.min(freeNew.length, freeOld.length); k2++) {
            out[newIdx[freeNew[k2]!]!] = oldLeft[freeOld[k2]!]!.id;
        }
    }
    return out;
}

function range(from: number, to: number): number[] {
    const out: number[] = [];
    for (let i = from; i < to; i++) out.push(i);
    return out;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface ApplyOptions {
    look: FlowLook;
    mode: ThemeMode;
    /** Box ids already known for steps, aligned with `parse.steps` (null: unknown). */
    ids?: ReadonlyArray<string | null>;
    /** The step boxes' order last time, so words are matched in that order. */
    order?: readonly string[];
    /** Where the first step's top-centre goes on an empty board. */
    origin?: Point;
    /**
     * A hand-placed chart (`flowLayout: "manual"`): boxes already on the page
     * keep their places (and arrows their bends); only new steps are placed,
     * beside the step they follow. See `keepPlaced` in `./arrange.ts`.
     */
    keepPlaced?: boolean;
    /**
     * Whether a pill (Start/End) whose line now reads as a plain step stays a
     * pill. The step language has no way to write a pill with other words
     * ("Order placed"), so by default every pill already on the page stays
     * one — the kind someone picked is never taken away by the words. The
     * Steps panel narrows it to the pills there were before the typing began,
     * so a line typed through "Start" on its way to "Start the timer" is not
     * left a pill.
     */
    keepsPill?: (id: string) => boolean;
}

export interface ApplyResult {
    page: DiagramPage;
    /** The box drawn for each step, aligned with `parse.steps`. */
    ids: string[];
}

/** Old step boxes in the order they were last written, then the rest in page order. */
function orderedSteps(page: DiagramPage, order: readonly string[] = []): DiagramNode[] {
    const steps = page.nodes.filter(isStepNode);
    const byId = new Map(steps.map(nd => [nd.id, nd]));
    const out: DiagramNode[] = [];
    const seen = new Set<string>();
    for (const id of order) {
        const nd = byId.get(id);
        if (nd && !seen.has(id)) {
            out.push(nd);
            seen.add(id);
        }
    }
    for (const nd of steps) if (!seen.has(nd.id)) out.push(nd);
    return out;
}

/** Edge label text, or "" when it has none. */
export function edgeLabel(e: DiagramEdge): string {
    return e.labels[0]?.text ?? "";
}

/** Draw the parsed steps onto the page. Returns the page itself when nothing changed. */
export function applySteps(page: DiagramPage, parse: StepsParse, opts: ApplyOptions): ApplyResult {
    const { look, mode } = opts;
    const old = orderedSteps(page, opts.order);
    const oldById = new Map(old.map(nd => [nd.id, nd]));
    const matched = matchSteps(
        parse.steps.map(s => s.label),
        old,
        opts.ids ?? []
    );

    const keepsPill = opts.keepsPill ?? (() => true);
    const nodes: DiagramNode[] = parse.steps.map((step, i) => {
        const id = matched[i];
        const prev = id ? oldById.get(id) : undefined;
        const pill = prev?.shape === "terminator" && step.kind === "step" && keepsPill(prev.id);
        const shape = pill ? "terminator" : shapeForKind(step.kind, prev?.shape, look.stepShape);
        const box = look.boxLook(shape, mode);
        // A line that says what the box says (a picked decision's "Approve"
        // written "Approve?", a label on two lines written on one) leaves
        // the box's own words alone.
        const text = prev && stepWords(prev) === step.label ? prev.text : step.label;
        let node: DiagramNode;
        if (prev && prev.shape === shape) {
            node = { ...prev, text };
        } else if (prev) {
            // A line became a question (or stopped being one): same box, new shape.
            node = {
                ...prev,
                shape,
                text,
                style: { ...prev.style, ...box.style },
                textStyle: { ...prev.textStyle, ...box.text },
            };
        } else {
            node = createNode({
                shape,
                x: 0,
                y: 0,
                text: step.label,
                style: box.style,
                textStyle: box.text,
                mode,
            });
        }
        const size = stepSize(shape, text, node.textStyle, baseSize(look, shape, mode));
        return { ...node, w: size.w, h: size.h };
    });
    const ids = nodes.map(nd => nd.id);

    const links = parse.links.map(l => ({ from: ids[l.from]!, to: ids[l.to]!, label: l.label }));
    const anchor = anchorOf(old, oldById.has(ids[0] ?? "") ? ids[0] : undefined);
    const placed = layoutSteps(nodes, links, anchor, opts.origin);

    // -- arrows --------------------------------------------------------------
    const stepIds = new Set(ids);
    const oldIds = new Set(old.map(nd => nd.id));
    const owned = (id: string | undefined) => !!id && (stepIds.has(id) || oldIds.has(id));
    const gone = (id: string | undefined) => !!id && oldIds.has(id) && !stepIds.has(id);
    const n = neutralsFor(mode);
    const used = new Set<string>();
    const between = (e: DiagramEdge, l: { from: string; to: string }) =>
        !used.has(e.id) && e.from.nodeId === l.from && e.to.nodeId === l.to;
    const edges: DiagramEdge[] = links.map(l => {
        // The same arrow: same ends and words, else same ends.
        const prev =
            page.edges.find(e => between(e, l) && edgeLabel(e) === (l.label ?? "")) ??
            page.edges.find(e => between(e, l));
        if (prev) {
            used.add(prev.id);
            const text = l.label ?? "";
            const labels =
                edgeLabel(prev) === text
                    ? prev.labels
                    : text
                      ? [{ text, t: prev.labels[0]?.t ?? 0.5, offset: prev.labels[0]?.offset ?? 0 }]
                      : [];
            return {
                ...prev,
                from: { ...prev.from, port: "auto" as const },
                to: { ...prev.to, port: "auto" as const },
                waypoints: [],
                labels,
            };
        }
        const e = look.edgeLook(mode);
        const made = createEdge({
            from: { nodeId: l.from, port: "auto" },
            to: { nodeId: l.to, port: "auto" },
            kind: e.kind,
            style: e.style,
            ...(e.startArrow ? { startArrow: e.startArrow } : {}),
            ...(e.endArrow ? { endArrow: e.endArrow } : {}),
            label: l.label ?? undefined,
        });
        return { ...made, textStyle: { ...made.textStyle, color: n.inkSoft, size: 12 } };
    });
    // Arrows the steps do not own stay — unless they hang off a box that is gone.
    const kept = page.edges.filter(e => {
        if (used.has(e.id)) return false;
        const a = e.from.nodeId;
        const b = e.to.nodeId;
        if (gone(a) || gone(b)) return false;
        return !(owned(a) && owned(b));
    });

    const others = page.nodes.filter(nd => !oldIds.has(nd.id));
    const laidOut: DiagramPage = {
        ...page,
        nodes: [...others, ...placed],
        edges: [...kept, ...edges],
    };
    const next = opts.keepPlaced ? keepPlaced(page, laidOut) : laidOut;
    return { page: samePage(page, next) ? page : next, ids };
}

/** Deep equality of nodes and edges: a keystroke that changes nothing commits nothing. */
export function samePage(a: DiagramPage, b: DiagramPage): boolean {
    if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
    for (let i = 0; i < a.nodes.length; i++) {
        if (
            a.nodes[i] !== b.nodes[i] &&
            JSON.stringify(a.nodes[i]) !== JSON.stringify(b.nodes[i])
        ) {
            return false;
        }
    }
    for (let i = 0; i < a.edges.length; i++) {
        if (
            a.edges[i] !== b.edges[i] &&
            JSON.stringify(a.edges[i]) !== JSON.stringify(b.edges[i])
        ) {
            return false;
        }
    }
    return true;
}

/**
 * What the chart says, without where things are: each step box's id, shape
 * and words, and each arrow between step boxes with its words. Two pages with
 * the same signature differ only in geometry.
 */
export function structureOf(page: DiagramPage): string {
    const steps = page.nodes.filter(isStepNode);
    const ids = new Set(steps.map(nd => nd.id));
    const boxes = steps.map(nd => `${nd.id}:${nd.shape}:${oneLine(nd.text)}`).sort();
    const arrows = page.edges
        .filter(e => ids.has(e.from.nodeId ?? "") && ids.has(e.to.nodeId ?? ""))
        .map(e => `${e.from.nodeId}>${e.to.nodeId}:${edgeLabel(e)}`)
        .sort();
    return `${boxes.join("|")}#${arrows.join("|")}`;
}

// ---------------------------------------------------------------------------
// After Tab on the canvas
// ---------------------------------------------------------------------------

/**
 * Tab on a box (`addNextStep`) puts the new step after it, as a new line would:
 * the arrows that left the box now leave the new step, and the chart is laid
 * out again. After a decision the new step is a branch, so its arrows stay.
 */
export function relayoutAfterStep(page: DiagramPage, added: string): DiagramPage {
    const node = page.nodes.find(nd => nd.id === added);
    if (!node) return page;
    const incoming = page.edges.find(e => e.to.nodeId === added && e.from.nodeId !== added);
    const fromId = incoming?.from.nodeId;
    const source = fromId ? page.nodes.find(nd => nd.id === fromId) : undefined;

    let edges = page.edges;
    let nodes = page.nodes.filter(nd => nd.id !== added);
    if (source) {
        if (source.shape !== "decision") {
            edges = edges.map(e =>
                e !== incoming && e.from.nodeId === source.id && e.to.nodeId !== added
                    ? { ...e, from: { ...e.from, nodeId: added }, waypoints: [] }
                    : e
            );
        }
        const at = nodes.findIndex(nd => nd.id === source.id);
        nodes = [...nodes.slice(0, at + 1), node, ...nodes.slice(at + 1)];
    } else {
        nodes = [...nodes, node];
    }

    const steps = nodes.filter(isStepNode);
    const ids = new Set(steps.map(nd => nd.id));
    const links = edges
        .filter(e => ids.has(e.from.nodeId ?? "") && ids.has(e.to.nodeId ?? ""))
        .map(e => ({ from: e.from.nodeId!, to: e.to.nodeId! }));
    const before = steps.filter(nd => nd.id !== added);
    const placed = new Map(
        layoutSteps(steps, links, anchorOf(before, steps[0]?.id)).map(nd => [nd.id, nd])
    );
    return {
        ...page,
        nodes: nodes.map(nd => placed.get(nd.id) ?? nd),
        edges: edges.map(e =>
            ids.has(e.from.nodeId ?? "") && ids.has(e.to.nodeId ?? "") && e.waypoints.length
                ? { ...e, waypoints: [] }
                : e
        ),
    };
}
