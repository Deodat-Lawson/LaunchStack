/**
 * Direction A's commands: what Tab, ⇧Tab, the arrows, Delete and typing on an
 * empty board do. Each is one undo step and leaves the chart laid out (the
 * pure half is `chart.ts`). Boxes and arrows are made by the editor's own
 * `addNextStep`, so they wear the direction's look exactly as every other
 * path's do.
 */

import { addNextStep, docMode, insertShape } from "../../model/commands";
import { activePage, mapEdges, nodeById } from "../../model/doc";
import { screenToWorld, worldToScreen } from "../../model/geometry";
import { neutralsFor } from "../../model/palette";
import type { EditorStore } from "../../model/store";
import type { Viewport } from "../../model/types";
import {
    branchLabel,
    edgeBetween,
    firstStep,
    moveEdgeAfter,
    parentOf,
    removeStepJoining,
    tidyChart,
    walkFrom,
    type Walk,
} from "../../model/flowchart/arrange";
import { flowEnv } from "./env";
import { lookA } from "./look";

const page = (store: EditorStore) => activePage(store.getState().doc);

/**
 * Label the arrow `from → to` if `from` is a decision: "Yes" for its first
 * branch, "No" for its second, in the reader's language and the soft ink of
 * the arrows, so it reads on either paper.
 */
function labelBranch(store: EditorStore, from: string, to: string): void {
    const p = page(store);
    const text = branchLabel(p, from, flowEnv(store).words);
    const edge = edgeBetween(p, from, to);
    if (!text || !edge) return;
    const color = neutralsFor(docMode(store)).inkSoft;
    store.updatePage(
        pg =>
            mapEdges(pg, [edge.id], e => ({
                ...e,
                labels: [{ text, t: 0.5, offset: 0 }],
                textStyle: { ...e.textStyle, color, size: 12, bold: false, italic: false },
            })),
        { label: "Label branch" }
    );
}

/** Tab: the next step after `sourceId` — below it, joined, label open. */
export function addNext(store: EditorStore, sourceId: string): string | null {
    let added: string | null = null;
    store.group("Add step", () => {
        added = addNextStep(store, sourceId);
        if (added) labelBranch(store, sourceId, added);
    });
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
        const id = addNextStep(store, parent);
        if (!id) return;
        added = id;
        const edge = edgeBetween(page(store), parent, id);
        if (edge && beside) {
            store.updatePage(p => tidyChart(moveEdgeAfter(p, edge.id, beside.id), [id]), {
                label: "Add branch",
            });
        }
        labelBranch(store, parent, id);
    });
    if (added) follow(store, added);
    return added;
}

/**
 * Delete on a step: it goes, the boxes before it are joined to the boxes
 * after it, and the chart closes up. The step before it is selected, so the
 * keyboard carries on from there.
 */
export function removeStep(store: EditorStore, nodeId: string): void {
    const { page: next, parents, children } = removeStepJoining(page(store), nodeId);
    store.group("Delete step", () => {
        store.updatePage(() => tidyChart(next, [...parents, ...children]), {
            label: "Delete step",
        });
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
 * An arrow key: walk to the next step that way. With nothing selected, any
 * arrow picks the chart's first step. Nowhere to go is not an error — the
 * selection stays put.
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

/**
 * The first box, in the middle of the stage, its label open. With `seed`, the
 * key that was pressed is already in it (type-to-start).
 */
export function startChart(store: EditorStore, seed?: string): string {
    const { stage } = flowEnv(store);
    const at = screenToWorld(store.getState().viewport, { x: stage.w / 2, y: stage.h / 2 });
    const id = insertShape(store, lookA.stepShape, at);
    store.setEditing(seed === undefined ? { kind: "node", id } : { kind: "node", id, seed });
    return id;
}

/**
 * Finish typing into `nodeId` (the field's own `commit`) and tidy the chart
 * if the words changed the box — grew it, or made it a decision. The tidy is
 * folded into the words' undo step: it is written without an entry of its
 * own, so one ⌘Z takes back both.
 */
export function finishLabel(store: EditorStore, nodeId: string, commit: () => void): void {
    const before = store.getState().doc;
    commit();
    if (store.getState().doc === before) return;
    store.updatePage(p => tidyChart(p, [nodeId]), { transient: true });
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
    const target = viewportToShow(store, nodeId, flowEnv(store).stage);
    if (target) glide(store, target);
}
