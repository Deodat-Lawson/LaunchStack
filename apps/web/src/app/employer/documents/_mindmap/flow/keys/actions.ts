/**
 * What the flowchart's keys do: Tab, ⇧Tab, the arrows, Delete and typing on
 * an empty board. Each is one undo step. Boxes and arrows are made by the
 * editor's own `addNextStep`, so they wear the flowchart look and get their
 * Yes/No exactly as the toolbar's + does; whether the chart is laid out again
 * afterwards is the document's `flowLayout` (`arrangeIfAuto`).
 */

import {
    addNextStep,
    arrangeIfAuto,
    arrangesItself,
    insertShape,
    moveSelection,
} from "../../model/commands";
import { activePage, nodeById } from "../../model/doc";
import { screenToWorld, worldToScreen } from "../../model/geometry";
import type { EditorStore } from "../../model/store";
import type { Point, Viewport } from "../../model/types";
import {
    edgeBetween,
    firstStep,
    moveEdgeAfter,
    parentOf,
    removeStepJoining,
    tidyChart,
    walkFrom,
    type Walk,
} from "../../model/flowchart/arrange";
import { flowchartLook } from "../../model/flowchart/look";
import { firstStepAt, flowStage } from "./env";

const page = (store: EditorStore) => activePage(store.getState().doc);

/** Tab: the next step after `sourceId` — below it, joined, label open. */
export function addNext(store: EditorStore, sourceId: string): string | null {
    const added = addNextStep(store, sourceId);
    if (added) follow(store, added);
    return added;
}

/**
 * ⇧Tab: a branch beside `nodeId` — another step after the same box, placed
 * right after it in the row. A box nothing leads into has no row to share,
 * so it gets its next step instead.
 */
export function addBranch(store: EditorStore, nodeId: string): string | null {
    const before = page(store);
    const parent = parentOf(before, nodeId);
    if (!parent) return addNext(store, nodeId);
    const beside = edgeBetween(before, parent, nodeId);
    let added: string | null = null;
    store.group("Add branch", () => {
        const id = addNextStep(store, parent, { branch: true });
        if (!id) return;
        added = id;
        const edge = edgeBetween(page(store), parent, id);
        if (edge && beside) {
            // The arrow's place in the page's order is the branch's place in
            // its row when the chart is arranged.
            store.updatePage(p => moveEdgeAfter(p, edge.id, beside.id), { transient: true });
        }
        arrangeIfAuto(store, [id]);
    });
    if (added) follow(store, added);
    return added;
}

/**
 * Delete on a step: it goes, the boxes before it are joined to the boxes
 * after it, and — on a chart that arranges itself — the chart closes up. The
 * step before it is selected, so the keyboard carries on from there.
 */
export function removeStep(store: EditorStore, nodeId: string): void {
    const { page: next, parents, children } = removeStepJoining(page(store), nodeId);
    const arrange = arrangesItself(store.getState().doc);
    store.updatePage(() => (arrange ? tidyChart(next, [...parents, ...children]) : next), {
        label: "Delete step",
    });
    const focus = parents[0] ?? children[0] ?? null;
    if (focus) {
        store.selectNodes([focus]);
        follow(store, focus);
    } else {
        store.clearSelection();
    }
}

/**
 * An arrow key with one step selected, or none: walk to the next step that
 * way. With nothing selected, any arrow picks the chart's first step. Nowhere
 * to go is not an error — the selection stays put.
 */
export function walk(store: EditorStore, dir: Walk): void {
    const { selection } = store.getState();
    const p = page(store);
    const from = selection.length === 1 && selection[0]!.kind === "node" ? selection[0]!.id : null;
    const to = from ? walkFrom(p, from, dir) : firstStep(p);
    if (!to) return;
    store.selectNodes([to]);
    follow(store, to);
}

/** How far a nudge moves the selection: 1px, or 10px with ⇧ (Figma's). */
export const NUDGE = 1;
export const NUDGE_FAR = 10;

/** An arrow key on a selection of several boxes, or ⌥/⇧ on one: move it. */
export function nudge(store: EditorStore, dir: Walk, far: boolean): void {
    const d = far ? NUDGE_FAR : NUDGE;
    const delta: Point = {
        up: { x: 0, y: -d },
        down: { x: 0, y: d },
        left: { x: -d, y: 0 },
        right: { x: d, y: 0 },
    }[dir];
    moveSelection(store, delta, "Nudge");
}

/**
 * The first box, where the empty prompt's ghost is (the middle of the stage
 * without one), its label open. With `seed`, the key that was pressed is
 * already in it (type-to-start).
 */
export function startChart(store: EditorStore, seed?: string): string {
    const at = screenToWorld(store.getState().viewport, firstStepAt(store));
    const id = insertShape(store, flowchartLook.stepShape, at);
    store.setEditing(seed === undefined ? { kind: "node", id } : { kind: "node", id, seed });
    return id;
}

/**
 * Esc on a step that was never given words: it is taken back, the line
 * closed up around it, and the step before it selected.
 */
export function discardEmpty(store: EditorStore, nodeId: string, commit: () => void): void {
    commit();
    removeStep(store, nodeId);
}

// ---------------------------------------------------------------------------
// Keeping the step being worked on in view
// ---------------------------------------------------------------------------

/** Room kept between a followed box and the stage's edges (screen px). */
const MARGIN = { top: 72, right: 48, bottom: 96, left: 48 };

/**
 * The viewport that brings `nodeId` fully on screen with the least movement,
 * or null when it already is. Pure in the store's state.
 */
export function viewportToShow(
    store: EditorStore,
    nodeId: string,
    stage: { w: number; h: number }
): Pick<Viewport, "x" | "y"> | null {
    const nd = nodeById(page(store), nodeId);
    if (!nd || stage.w <= 0 || stage.h <= 0) return null;
    const v = store.getState().viewport;
    const tl = worldToScreen(v, { x: nd.x, y: nd.y });
    const br = worldToScreen(v, { x: nd.x + nd.w, y: nd.y + nd.h });
    const shift = (lo: number, hi: number, min: number, max: number): number => {
        if (hi - lo > max - min) return min - lo; // bigger than the room: show its start
        if (lo < min) return min - lo;
        if (hi > max) return max - hi;
        return 0;
    };
    const dx = shift(tl.x, br.x, MARGIN.left, stage.w - MARGIN.right);
    const dy = shift(tl.y, br.y, MARGIN.top, stage.h - MARGIN.bottom);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
    return { x: v.x - dx / v.zoom, y: v.y - dy / v.zoom };
}

const panning = new WeakMap<EditorStore, number>();

/** Glide to `target` over a few frames (at once if motion is reduced). */
function glide(store: EditorStore, target: Pick<Viewport, "x" | "y">): void {
    const reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previous = panning.get(store);
    if (previous !== undefined) cancelAnimationFrame(previous);
    const from = store.getState().viewport;
    if (reduced) {
        store.setViewport(target);
        return;
    }
    const start = performance.now();
    const DURATION = 180;
    const frame = (now: number) => {
        const k = Math.min(1, (now - start) / DURATION);
        const ease = 1 - Math.pow(1 - k, 3);
        store.setViewport({
            x: from.x + (target.x - from.x) * ease,
            y: from.y + (target.y - from.y) * ease,
        });
        if (k < 1) panning.set(store, requestAnimationFrame(frame));
        else panning.delete(store);
    };
    panning.set(store, requestAnimationFrame(frame));
}

/** After a keyboard step, bring `nodeId` into view if it is not. */
export function follow(store: EditorStore, nodeId: string): void {
    if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return;
    const target = viewportToShow(store, nodeId, flowStage(store));
    if (target) glide(store, target);
}
